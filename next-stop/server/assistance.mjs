// Boarding assistance, carried on the existing pickup request (not a separate request system).
//
// The rider says what helps them board: a ramp or lift, extra boarding time, or other help with
// an optional brief note. No diagnosis is asked for. The driver currently assigned to the
// request's shuttle acknowledges the current version, or reports being unable to accommodate,
// which alerts the institution's administrators (staff). Acknowledgement means "seen", never a
// guarantee. Every rider change and every driver handover requires a fresh acknowledgement.
//
// Who can see it: the rider, the driver currently assigned to that shuttle, and administrators.
// Enforced here and in the snapshot. Push notifications are generic ("Pickup details updated")
// so nothing about a rider's needs reaches lock screens; nothing is logged.
//
// Vehicle accessibility (ramp or lift, wheelchair space) is what an administrator recorded:
// available, unavailable or unknown. A ramp request on a vehicle where either is not confirmed
// available is routed to staff, never dropped.
export const ASSISTANCE_NEEDS = ['ramp', 'extra_time', 'other'];
export const CAPABILITY = ['available', 'unavailable', 'unknown'];
export const NOTE_MAX = 140;
const EDITABLE = ['requested', 'accepted', 'approaching'];
const ACTIVE = ['pending', 'acknowledged', 'unable'];
const STAFF_NOTE_MAX = 200;

/** Single-line text without control characters, trimmed. */
const clean = (value) =>
  String(value)
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function vehicleAttention(trip, needs) {
  if (!needs.includes('ramp') || !trip) return '';
  const caps = [trip.access_ramp || 'unknown', trip.access_space || 'unknown'];
  if (caps.includes('unavailable')) return 'vehicle_unavailable';
  if (caps.some((c) => c !== 'available')) return 'vehicle_unknown';
  return '';
}

export function createAssistance({ db, push, clock, fail }) {
  const admins = (org) =>
    db
      .prepare(
        "SELECT user_id FROM memberships WHERE institution_id=? AND role='admin' AND approved=1",
      )
      .all(org)
      .map((r) => r.user_id);
  // Generic wording only: lock screens must not reveal assistance details.
  const notify = (userIds, org, staff = false) => {
    const ids = userIds.filter(Boolean);
    if (!ids.length) return;
    push.notify([
      {
        userIds: ids,
        title: staff ? 'Staff attention needed' : 'Pickup details updated',
        body: staff ? 'A pickup needs review in NEXT STOP.' : 'Open NEXT STOP for details.',
        data: { type: 'request', institutionId: org },
      },
    ]);
  };

  /** Validates rider input. Empty needs means "no assistance". The note is kept only with
   * "other", and is limited to a brief single line. */
  function parse(input) {
    if (input == null) return { needs: [], note: '' };
    if (typeof input !== 'object' || Array.isArray(input)) fail(400, 'Invalid assistance.');
    const needs = input.needs ?? [];
    if (
      !Array.isArray(needs) ||
      !needs.every((n) => ASSISTANCE_NEEDS.includes(n)) ||
      new Set(needs).size !== needs.length
    )
      fail(400, 'Choose from the listed boarding assistance options.');
    if (input.note != null && typeof input.note !== 'string') fail(400, 'Invalid note.');
    const note = needs.includes('other') ? clean(input.note || '') : '';
    if (note.length > NOTE_MAX) fail(400, `Keep the note under ${NOTE_MAX} characters.`);
    return { needs: ASSISTANCE_NEEDS.filter((n) => needs.includes(n)), note };
  }
  const get = (requestId) =>
    db.prepare('SELECT * FROM request_assistance WHERE request_id=?').get(requestId);
  const isActive = (a) => !!a && ACTIVE.includes(a.status);
  const sameContent = (a, input) =>
    isActive(a)
      ? a.needs === JSON.stringify(input.needs) && a.note === input.note
      : !input.needs.length;

  /** Saves the rider's assistance for a request (insert, change or withdraw). Returns
   * `{ version, changed }`. Callers check the request's ownership and state first. */
  function save(request, trip, input, baseVersion) {
    const existing = get(request.id);
    const version = existing?.version || 0;
    if (sameContent(existing, input)) return { version, changed: false };
    // A withdrawn request is not in riders' snapshots, so its version reads as 0 to them.
    if (baseVersion !== version && !(baseVersion === 0 && !isActive(existing)))
      fail(
        409,
        'Your assistance details were changed on another device. Review them and try again.',
      );
    const now = clock();
    if (!input.needs.length) {
      db.prepare(
        "UPDATE request_assistance SET status='withdrawn',note='',staff_note='',attention='',version=?,updated_at=? WHERE request_id=?",
      ).run(version + 1, now, request.id);
      notify([trip?.driver_id], request.institution_id);
      return { version: version + 1, changed: true };
    }
    const attention = vehicleAttention(trip, input.needs);
    db.prepare(
      `INSERT INTO request_assistance(request_id,institution_id,needs,note,version,status,attention,created_at,updated_at)
       VALUES (?,?,?,?,?,'pending',?,?,?)
       ON CONFLICT(request_id) DO UPDATE SET needs=excluded.needs,note=excluded.note,version=excluded.version,
         status='pending',attention=excluded.attention,ack_by=NULL,ack_version=NULL,ack_at=NULL,unable_by=NULL,unable_at=NULL,
         staff_note='',staff_by=NULL,staff_at=NULL,updated_at=excluded.updated_at`,
    ).run(
      request.id,
      request.institution_id,
      JSON.stringify(input.needs),
      input.note,
      version + 1,
      attention,
      now,
      now,
    );
    notify([trip?.driver_id], request.institution_id);
    if (attention) notify(admins(request.institution_id), request.institution_id, true);
    return { version: version + 1, changed: true };
  }

  /** A new driver (or none) on a shuttle: every open assistance request on it needs a fresh
   * acknowledgement from whoever is assigned now. */
  function driverChanged(tripId) {
    const trip = db.prepare('SELECT * FROM trips WHERE id=?').get(tripId);
    const changed = db
      .prepare(
        `UPDATE request_assistance SET status='pending',ack_by=NULL,ack_version=NULL,ack_at=NULL,updated_at=?
         WHERE status IN ('acknowledged','unable') AND request_id IN (SELECT id FROM requests WHERE trip_id=? AND status IN ('requested','accepted','approaching'))`,
      )
      .run(clock(), tripId).changes;
    const open = db
      .prepare(
        `SELECT count(*) AS n FROM request_assistance a JOIN requests r ON r.id=a.request_id
         WHERE r.trip_id=? AND r.status IN ('requested','accepted','approaching') AND a.status='pending'`,
      )
      .get(tripId).n;
    if ((changed || open) && trip?.driver_id) notify([trip.driver_id], trip.institution_id);
  }

  /** The administrator changed a vehicle's recorded accessibility: re-route ramp requests. */
  function vehicleChanged(tripId) {
    const trip = db.prepare('SELECT * FROM trips WHERE id=?').get(tripId);
    if (!trip) return;
    let flagged = false;
    for (const a of db
      .prepare(
        `SELECT a.* FROM request_assistance a JOIN requests r ON r.id=a.request_id
         WHERE r.trip_id=? AND r.status IN ('requested','accepted','approaching') AND a.status IN ('pending','acknowledged')
         AND a.attention IN ('','vehicle_unavailable','vehicle_unknown')`,
      )
      .all(tripId)) {
      const next = vehicleAttention(trip, JSON.parse(a.needs));
      if (next === a.attention) continue;
      db.prepare('UPDATE request_assistance SET attention=?,updated_at=? WHERE request_id=?').run(
        next,
        clock(),
        a.request_id,
      );
      if (next) flagged = true;
    }
    if (flagged) notify(admins(trip.institution_id), trip.institution_id, true);
  }

  /** Assistance for the requests in a role-scoped snapshot. The driver sees only requests on
   * shuttles assigned to them now (the caller passes only those); parents get none. */
  function forSnapshot(member, requests, trips) {
    if (!['student', 'driver', 'admin'].includes(member.role) || !requests.length) return [];
    const open = requests.filter((r) => [...EDITABLE, 'boarded'].includes(r.status));
    if (!open.length) return [];
    const rows = db
      .prepare(
        `SELECT * FROM request_assistance WHERE request_id IN (${open.map(() => '?').join(',')}) AND status IN ('pending','acknowledged','unable')`,
      )
      .all(...open.map((r) => r.id));
    return rows.map((a) => {
      const request = open.find((r) => r.id === a.request_id);
      const trip = trips.find((t) => t.id === request.trip_id);
      // An acknowledgement counts only for the current version from the driver assigned now.
      const current = a.ack_by && a.ack_by === trip?.driver_id && a.ack_version === a.version;
      const status = a.status === 'acknowledged' && !current ? 'pending' : a.status;
      return {
        request_id: a.request_id,
        needs: JSON.parse(a.needs),
        note: a.note,
        version: a.version,
        status,
        attention: a.attention,
        ack_at: status === 'acknowledged' ? a.ack_at : null,
        unable_at: status === 'unable' ? a.unable_at : null,
        staff_note: a.staff_note,
        staff_at: a.staff_at,
        updated_at: a.updated_at,
      };
    });
  }

  async function handle({ path, body, uid, member, org, send, text }) {
    if (!path.startsWith('/requests/assistance')) return false;
    const request = db
      .prepare('SELECT * FROM requests WHERE id=? AND institution_id=?')
      .get(text('requestId'), org);
    // The same answer for "not yours" and "does not exist": no probing other riders' requests.
    const trip = request ? db.prepare('SELECT * FROM trips WHERE id=?').get(request.trip_id) : null;
    const allowed =
      request &&
      ((member.role === 'student' && request.student_id === uid) ||
        (member.role === 'driver' && trip?.driver_id === uid) ||
        member.role === 'admin');
    if (!allowed) fail(404, 'Pickup not found.');
    const editable = EDITABLE.includes(request.status);
    const a = get(request.id);
    const versionMatches = () => {
      if (!Number.isInteger(body.version) || body.version !== a.version)
        fail(409, 'The rider changed their assistance needs. Review the updated details.');
    };

    if (path === '/requests/assistance') {
      if (member.role !== 'student') fail(403, 'Only the rider can change their assistance.');
      if (!editable) fail(409, 'Assistance can be changed only before boarding.');
      const baseVersion = Number.isInteger(body.baseVersion) ? body.baseVersion : -1;
      const result = save(request, trip, parse(body.assistance ?? body), baseVersion);
      send(200, result);
      return true;
    }
    if (path === '/requests/assistance/ack' || path === '/requests/assistance/unable') {
      // Only the driver assigned now: a former driver or a dispatcher cannot acknowledge.
      if (member.role !== 'driver' || trip?.driver_id !== uid)
        fail(403, 'Only the driver assigned to this shuttle can respond.');
      if (!isActive(a)) fail(404, 'This pickup has no assistance request.');
      if (!editable) fail(409, 'This pickup has already boarded or ended.');
      versionMatches();
      const now = clock();
      if (path.endsWith('/ack')) {
        if (a.status === 'acknowledged' && a.ack_by === uid && a.ack_version === a.version) {
          send(200, { version: a.version, changed: false });
          return true;
        }
        db.prepare(
          `UPDATE request_assistance SET status='acknowledged',ack_by=?,ack_version=?,ack_at=?,unable_by=NULL,unable_at=NULL,
           attention=CASE WHEN attention='driver_unable' THEN '' ELSE attention END,updated_at=? WHERE request_id=?`,
        ).run(uid, a.version, now, now, request.id);
        notify([request.student_id], org);
      } else {
        if (a.status === 'unable' && a.unable_by === uid) {
          send(200, { version: a.version, changed: false });
          return true;
        }
        db.prepare(
          `UPDATE request_assistance SET status='unable',unable_by=?,unable_at=?,ack_by=NULL,ack_version=NULL,ack_at=NULL,
           attention='driver_unable',staff_note='',staff_by=NULL,staff_at=NULL,updated_at=? WHERE request_id=?`,
        ).run(uid, now, now, request.id);
        notify([request.student_id], org);
        notify(admins(org), org, true);
      }
      send(200, { version: a.version, changed: true });
      return true;
    }
    if (path === '/requests/assistance/resolve') {
      if (member.role !== 'admin') fail(403, 'Admin access required.');
      if (!isActive(a) || (!a.attention && a.status !== 'unable'))
        fail(409, 'This assistance request does not need staff attention.');
      if (!editable) fail(409, 'This pickup has already boarded or ended.');
      versionMatches();
      if (typeof body.message !== 'string') fail(400, 'Write a short message to the rider.');
      const message = clean(body.message);
      if (!message || message.length > STAFF_NOTE_MAX)
        fail(400, `Write a message to the rider (up to ${STAFF_NOTE_MAX} characters).`);
      if (!['resolved', 'driver_review'].includes(body.outcome)) fail(400, 'Choose an outcome.');
      const now = clock();
      db.prepare(
        `UPDATE request_assistance SET attention='',staff_note=?,staff_by=?,staff_at=?,updated_at=?,
         status=CASE WHEN ? THEN 'pending' ELSE status END,
         ack_by=CASE WHEN ? THEN NULL ELSE ack_by END,ack_version=CASE WHEN ? THEN NULL ELSE ack_version END,
         ack_at=CASE WHEN ? THEN NULL ELSE ack_at END WHERE request_id=?`,
      ).run(
        message,
        uid,
        now,
        now,
        ...Array(4).fill(body.outcome === 'driver_review' ? 1 : 0),
        request.id,
      );
      notify([request.student_id], org);
      if (body.outcome === 'driver_review') notify([trip?.driver_id], org);
      send(200, { version: a.version, changed: true });
      return true;
    }
    return false;
  }

  return { parse, save, driverChanged, vehicleChanged, forSnapshot, handle };
}
