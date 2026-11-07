// Rider passes, safety contacts, incident reports, escort requests and shared-ride coordination.
// Each is off until the institution's administrator turns it on, and none of them contacts
// emergency services or claims to: reports and escort requests reach the institution's NEXT
// STOP administrators, and their status changes only when a staff member acts.
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

export const PASS_STEP = 30000;
const PASS_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INCIDENT_CATEGORIES = [
  'safety_concern',
  'vehicle',
  'stop_condition',
  'driver_conduct',
  'rider_conduct',
  'shared_ride',
  'lost_item',
  'other',
];
const FEATURES = {
  passesEnabled: 'passes_enabled',
  incidentsEnabled: 'incidents_enabled',
  escortsEnabled: 'escorts_enabled',
  sharedRidesEnabled: 'shared_rides_enabled',
};
const firstName = (name) =>
  String(name || '')
    .trim()
    .split(/\s+/)[0] || 'Rider';

/** Six digits for `secret` at time step `step` (HMAC-SHA256, truncated as in RFC 4226). */
export function passCode(secret, step) {
  const mac = createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(Buffer.from(String(step)))
    .digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export function createSafety({ db, push, clock, fail, audience }) {
  const flags = (org) =>
    db
      .prepare(
        'SELECT passes_enabled,incidents_enabled,escorts_enabled,shared_rides_enabled,emergency_number,escort_note FROM institution_settings WHERE institution_id=?',
      )
      .get(org) || {
      passes_enabled: 0,
      incidents_enabled: 0,
      escorts_enabled: 0,
      shared_rides_enabled: 0,
      emergency_number: '',
      escort_note: '',
    };
  const requireAdmin = (member) => member.role !== 'admin' && fail(403, 'Admin access required.');
  const requireOn = (org, key, label) =>
    !flags(org)[key] && fail(403, `${label} is not offered by your institution in NEXT STOP.`);
  const admins = (org) =>
    db
      .prepare(
        "SELECT user_id FROM memberships WHERE institution_id=? AND role='admin' AND approved=1",
      )
      .all(org)
      .map((r) => r.user_id);
  const name = (uid) => db.prepare('SELECT name FROM users WHERE id=?').get(uid)?.name || '';
  const stopIn = (id, org) =>
    typeof id === 'string' &&
    db
      .prepare("SELECT id,name FROM stops WHERE id=? AND institution_id=? AND status='confirmed'")
      .get(id, org);
  const str = (value, max, label, required = false) => {
    const v = typeof value === 'string' ? value.trim() : '';
    if ((required && !v) || v.length > max)
      fail(400, `${label} must be ${required ? '1' : '0'}–${max} characters.`);
    return v;
  };

  // --- Passes -------------------------------------------------------------------------
  function activePass(uid, org) {
    return db
      .prepare('SELECT * FROM passes WHERE user_id=? AND institution_id=? AND revoked_at IS NULL')
      .get(uid, org);
  }
  function issuePass(uid, org) {
    const existing = activePass(uid, org);
    if (existing) return existing;
    let short;
    do
      short = Array.from({ length: 5 }, () => PASS_ALPHABET[randomInt(PASS_ALPHABET.length)]).join(
        '',
      );
    while (db.prepare('SELECT 1 FROM passes WHERE institution_id=? AND short=?').get(org, short));
    const row = {
      id: randomUUID(),
      short,
      secret: randomBytes(32).toString('hex'),
    };
    db.prepare(
      'INSERT INTO passes(id,user_id,institution_id,short,secret,created_at) VALUES (?,?,?,?,?,?)',
    ).run(row.id, uid, org, short, row.secret, clock());
    return activePass(uid, org);
  }
  function validate({ code, org, uid, member }) {
    const now = clock();
    const match = /^(?:NS1:)?([A-Z2-9]{5})[-:]?(\d{6})$/.exec(
      String(code || '')
        .trim()
        .toUpperCase(),
    );
    const record = (passId, result, tripId = null) =>
      db
        .prepare(
          'INSERT INTO pass_scans(institution_id,pass_id,trip_id,scanned_by,result,at) VALUES (?,?,?,?,?,?)',
        )
        .run(org, passId, tripId, uid, result, now);
    const trip =
      member.role === 'driver'
        ? db
            .prepare('SELECT * FROM trips WHERE institution_id=? AND driver_id=? AND active=1')
            .get(org, uid)
        : null;
    if (member.role === 'driver' && !trip) fail(409, 'Start service before checking passes.');
    if (!match) {
      record(null, 'malformed', trip?.id);
      return { valid: false, reason: 'This is not a NEXT STOP pass code.' };
    }
    const pass = db
      .prepare('SELECT * FROM passes WHERE institution_id=? AND short=?')
      .get(org, match[1]);
    if (!pass) {
      record(null, 'unknown', trip?.id);
      return { valid: false, reason: 'No pass with this code at your institution.' };
    }
    if (pass.revoked_at) {
      record(pass.id, 'revoked', trip?.id);
      return { valid: false, reason: 'This pass was replaced or revoked.' };
    }
    // Limits guessing: ten failed codes within ten minutes lock checks of this pass briefly.
    if (pass.failure_window && now - pass.failure_window < 600000 && pass.failures >= 10) {
      record(pass.id, 'locked', trip?.id);
      return {
        valid: false,
        reason:
          'Too many wrong codes for this pass. Ask the rider to refresh it and try again in a few minutes.',
      };
    }
    const step = Math.floor(now / PASS_STEP);
    const ok = [-1, 0, 1].some((d) => {
      const expected = Buffer.from(passCode(pass.secret, step + d));
      return timingSafeEqual(expected, Buffer.from(match[2]));
    });
    if (!ok) {
      const fresh = !pass.failure_window || now - pass.failure_window >= 600000;
      db.prepare('UPDATE passes SET failures=?,failure_window=? WHERE id=?').run(
        fresh ? 1 : pass.failures + 1,
        fresh ? now : pass.failure_window,
        pass.id,
      );
      record(pass.id, 'expired_code', trip?.id);
      return {
        valid: false,
        reason: 'This code has expired or is wrong. Ask the rider to show the live pass.',
      };
    }
    const holder = db
      .prepare(
        "SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.institution_id=? AND m.role='student' AND m.approved=1",
      )
      .get(pass.user_id, org);
    if (!holder) {
      record(pass.id, 'not_member', trip?.id);
      return { valid: false, reason: 'This rider is no longer an approved member.' };
    }
    const repeat = !!db
      .prepare(
        "SELECT 1 FROM pass_scans WHERE pass_id=? AND result='valid' AND at>? AND trip_id IS ?",
      )
      .get(pass.id, now - 120000, trip?.id ?? null);
    record(pass.id, 'valid', trip?.id);
    const request = trip
      ? db
          .prepare(
            "SELECT r.id,r.status,s.name AS stop FROM requests r JOIN stops s ON s.id=r.stop_id WHERE r.trip_id=? AND r.student_id=? AND r.status IN ('accepted','approaching')",
          )
          .get(trip.id, pass.user_id)
      : null;
    return {
      valid: true,
      firstName: firstName(holder.name),
      repeat,
      request: request ? { id: request.id, status: request.status, stop: request.stop } : null,
    };
  }

  // --- Shared rides ------------------------------------------------------------------
  function rideView(uid, org) {
    const now = clock();
    db.prepare('DELETE FROM ride_intents WHERE leave_before<?').run(now - 3600000);
    const mine = db
      .prepare('SELECT * FROM ride_intents WHERE user_id=? AND institution_id=?')
      .get(uid, org);
    if (!mine) return { intent: null, matches: 0, group: [] };
    const blocked = db
      .prepare(
        'SELECT blocked_id AS id FROM ride_blocks WHERE blocker_id=? AND institution_id=? UNION SELECT blocker_id FROM ride_blocks WHERE blocked_id=? AND institution_id=?',
      )
      .all(uid, org, uid, org)
      .map((r) => r.id);
    const others = db
      .prepare(
        'SELECT i.*,u.name FROM ride_intents i JOIN users u ON u.id=i.user_id JOIN memberships m ON m.user_id=i.user_id AND m.institution_id=i.institution_id AND m.approved=1 WHERE i.institution_id=? AND i.user_id<>? AND i.from_stop=? AND i.to_stop=? AND i.leave_after<? AND i.leave_before>?',
      )
      .all(org, uid, mine.from_stop, mine.to_stop, mine.leave_before, mine.leave_after)
      .filter((o) => !blocked.includes(o.user_id));
    // Group members see first names only, and only of others who also chose to coordinate.
    const group = mine.group_id
      ? others
          .filter((o) => o.group_id === mine.group_id)
          .map((o) => ({ userId: o.user_id, firstName: firstName(o.name) }))
      : [];
    return {
      intent: {
        from_stop: mine.from_stop,
        to_stop: mine.to_stop,
        leave_after: mine.leave_after,
        leave_before: mine.leave_before,
        coordinating: !!mine.group_id,
      },
      matches: others.length,
      group,
    };
  }

  function snapshotExtras({ member, org, uid }) {
    const f = flags(org);
    const pass = member.role === 'student' && f.passes_enabled ? activePass(uid, org) : null;
    const contacts = db
      .prepare(
        'SELECT id,label,phone,kind,hours,sms FROM institution_contacts WHERE institution_id=? ORDER BY position,label',
      )
      .all(org);
    const incidentCols =
      'id,category,description,trip_id,stop_id,created_at,status,staff_note,updated_at';
    return {
      safety: {
        passes_enabled: f.passes_enabled,
        incidents_enabled: f.incidents_enabled,
        escorts_enabled: f.escorts_enabled,
        shared_rides_enabled: f.shared_rides_enabled,
        emergency_number: f.emergency_number,
        escort_note: f.escort_note,
        contacts,
      },
      pass: pass ? { short: pass.short, created_at: pass.created_at } : null,
      incidents:
        member.role === 'admin'
          ? db
              .prepare(
                `SELECT i.${incidentCols.split(',').join(',i.')},u.name AS reporter_name FROM incidents i LEFT JOIN users u ON u.id=i.reporter_id WHERE i.institution_id=? ORDER BY i.status='resolved',i.created_at DESC LIMIT 100`,
              )
              .all(org)
          : db
              .prepare(
                `SELECT ${incidentCols} FROM incidents WHERE institution_id=? AND reporter_id=? ORDER BY created_at DESC LIMIT 20`,
              )
              .all(org, uid),
      escorts:
        member.role === 'admin'
          ? db
              .prepare(
                "SELECT e.id,e.stop_id,e.destination,e.note,e.status,e.staff_note,e.created_at,e.updated_at,u.name AS rider_name FROM escorts e JOIN users u ON u.id=e.rider_id WHERE e.institution_id=? AND (e.status IN ('requested','accepted') OR e.updated_at>?) ORDER BY e.created_at DESC",
              )
              .all(org, clock() - 86400000)
          : db
              .prepare(
                'SELECT id,stop_id,destination,note,status,staff_note,created_at,updated_at FROM escorts WHERE institution_id=? AND rider_id=? ORDER BY created_at DESC LIMIT 5',
              )
              .all(org, uid),
      rides: member.role === 'student' && f.shared_rides_enabled ? rideView(uid, org) : null,
    };
  }

  async function handle({ path, method, body, uid, member, org, send, text }) {
    const now = clock();
    const ok = (data = { ok: true }) => (send(200, data), true);
    if (method === 'GET') {
      if (path !== '/pass/code') return false;
      if (member.role !== 'student') fail(403, 'Only students have rider passes.');
      requireOn(org, 'passes_enabled', 'Rider passes');
      const pass = activePass(uid, org);
      if (!pass) fail(404, 'Create your pass first.');
      const step = Math.floor(now / PASS_STEP);
      const code = passCode(pass.secret, step);
      return ok({
        qr: `NS1:${pass.short}:${code}`,
        code: `${pass.short}-${code}`,
        firstName: firstName(name(uid)),
        expiresAt: (step + 1) * PASS_STEP,
      });
    }
    switch (path) {
      case '/safety/settings': {
        requireAdmin(member);
        const current = flags(org);
        const next = { ...current };
        for (const [key, column] of Object.entries(FEATURES))
          if (body[key] !== undefined) {
            if (typeof body[key] !== 'boolean') fail(400, 'Invalid setting.');
            next[column] = +body[key];
          }
        if (body.emergencyNumber !== undefined) {
          const v = str(body.emergencyNumber, 20, 'Emergency number');
          if (v && !/^[0-9+() -]{2,20}$/.test(v)) fail(400, 'Enter digits only, for example 911.');
          next.emergency_number = v;
        }
        if (body.escortNote !== undefined)
          next.escort_note = str(body.escortNote, 300, 'Escort note');
        db.prepare(
          `INSERT INTO institution_settings(institution_id,passes_enabled,incidents_enabled,escorts_enabled,shared_rides_enabled,emergency_number,escort_note,updated_at) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(institution_id) DO UPDATE SET passes_enabled=excluded.passes_enabled,incidents_enabled=excluded.incidents_enabled,escorts_enabled=excluded.escorts_enabled,shared_rides_enabled=excluded.shared_rides_enabled,emergency_number=excluded.emergency_number,escort_note=excluded.escort_note,updated_at=excluded.updated_at`,
        ).run(
          org,
          next.passes_enabled,
          next.incidents_enabled,
          next.escorts_enabled,
          next.shared_rides_enabled,
          next.emergency_number,
          next.escort_note,
          now,
        );
        return ok();
      }
      case '/safety/contacts': {
        requireAdmin(member);
        if (body.remove) {
          db.prepare('DELETE FROM institution_contacts WHERE id=? AND institution_id=?').run(
            text('contactId'),
            org,
          );
          return ok();
        }
        const label = str(body.label, 60, 'Label', true);
        const phone = str(body.phone, 30, 'Phone', true);
        if (!/^[0-9+() -]{2,30}$/.test(phone)) fail(400, 'Enter a phone number using digits.');
        if (!['safety', 'transport', 'escort', 'other'].includes(body.kind))
          fail(400, 'Choose a contact type.');
        const count = db
          .prepare('SELECT count(*) AS n FROM institution_contacts WHERE institution_id=?')
          .get(org).n;
        if (count >= 12) fail(409, 'Up to 12 contacts.');
        db.prepare(
          'INSERT INTO institution_contacts(id,institution_id,label,phone,kind,hours,sms,position) VALUES (?,?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          org,
          label,
          phone,
          body.kind,
          str(body.hours, 80, 'Hours'),
          body.sms === true ? 1 : 0,
          count,
        );
        return ok();
      }
      case '/pass/issue': {
        if (member.role !== 'student') fail(403, 'Only students have rider passes.');
        requireOn(org, 'passes_enabled', 'Rider passes');
        issuePass(uid, org);
        return ok();
      }
      case '/pass/revoke': {
        // A rider replaces their own pass (lost phone); an administrator can revoke anyone's.
        const target = member.role === 'admin' && body.userId ? text('userId') : uid;
        if (target !== uid) requireAdmin(member);
        db.prepare(
          'UPDATE passes SET revoked_at=? WHERE user_id=? AND institution_id=? AND revoked_at IS NULL',
        ).run(now, target, org);
        return ok();
      }
      case '/pass/validate': {
        if (!['driver', 'admin'].includes(member.role))
          fail(403, 'Only drivers and dispatch check passes.');
        requireOn(org, 'passes_enabled', 'Rider passes');
        return ok(validate({ code: body.code, org, uid, member }));
      }
      case '/incidents': {
        requireOn(org, 'incidents_enabled', 'In-app reports');
        if (!INCIDENT_CATEGORIES.includes(body.category))
          fail(400, 'Choose what the report is about.');
        const description = str(body.description, 1000, 'Description', true);
        const stop = body.stopId ? stopIn(body.stopId, org) : null;
        if (body.stopId && !stop) fail(400, 'Choose a stop in your institution.');
        const trip = body.tripId
          ? db.prepare('SELECT id FROM trips WHERE id=? AND institution_id=?').get(body.tripId, org)
          : null;
        if (body.tripId && !trip) fail(400, 'Choose a shuttle in your institution.');
        // A shared-ride report names the other rider internally; the reporter never sees more.
        let subject = null;
        if (body.category === 'shared_ride' && body.subjectId != null) {
          const group = rideView(uid, org).group;
          if (!group.some((m) => m.userId === body.subjectId))
            fail(400, 'You can report riders in your current group only.');
          subject = body.subjectId;
        }
        const id = randomUUID();
        db.prepare(
          'INSERT INTO incidents(id,institution_id,reporter_id,category,description,trip_id,stop_id,subject_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ).run(
          id,
          org,
          uid,
          body.category,
          description,
          trip?.id ?? null,
          stop?.id ?? null,
          subject,
          now,
          now,
        );
        push.notify([
          {
            userIds: admins(org),
            title: 'New report in NEXT STOP',
            body: 'A rider submitted a report. Review it in Alerts.',
            data: { type: 'incident', institutionId: org },
          },
        ]);
        send(201, { id });
        return true;
      }
      case '/incidents/update': {
        requireAdmin(member);
        const row = db
          .prepare('SELECT * FROM incidents WHERE id=? AND institution_id=?')
          .get(text('incidentId'), org);
        if (!row) fail(404, 'Report not found.');
        if (!['acknowledged', 'resolved'].includes(body.status)) fail(400, 'Invalid status.');
        const note = str(body.note, 500, 'Note');
        db.prepare(
          'UPDATE incidents SET status=?,staff_note=?,handled_by=?,updated_at=? WHERE id=?',
        ).run(body.status, note, uid, now, row.id);
        if (row.reporter_id)
          push.notify([
            {
              userIds: audience([row.reporter_id], org, 'trip_updates'),
              title:
                body.status === 'resolved'
                  ? 'Your report was resolved'
                  : 'Your report was received',
              body: note || 'Open NEXT STOP for details.',
              data: { type: 'incident', institutionId: org },
            },
          ]);
        return ok();
      }
      case '/escorts': {
        if (member.role !== 'student') fail(403, 'Only riders can request an escort.');
        requireOn(org, 'escorts_enabled', 'Escort requests');
        const stop = body.stopId ? stopIn(body.stopId, org) : null;
        if (!stop) fail(400, 'Choose where to meet.');
        const destination = str(body.destination, 100, 'Destination', true);
        const note = str(body.note, 300, 'Note');
        try {
          db.prepare(
            "INSERT INTO escorts(id,institution_id,rider_id,stop_id,destination,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'requested',?,?)",
          ).run(randomUUID(), org, uid, stop.id, destination, note, now, now);
        } catch {
          fail(409, 'You already have an open escort request.');
        }
        push.notify([
          {
            userIds: admins(org),
            title: 'Escort requested',
            body: `A rider asked for an escort from ${stop.name}. Accept or decline in NEXT STOP.`,
            data: { type: 'escort', institutionId: org },
          },
        ]);
        send(201, { ok: true });
        return true;
      }
      case '/escorts/update': {
        const row = db
          .prepare('SELECT * FROM escorts WHERE id=? AND institution_id=?')
          .get(text('escortId'), org);
        if (!row) fail(404, 'Request not found.');
        const next = body.status;
        if (member.role !== 'admin') {
          if (
            row.rider_id !== uid ||
            next !== 'cancelled' ||
            !['requested', 'accepted'].includes(row.status)
          )
            fail(403, 'You can only cancel your own open request.');
        } else {
          const allowed = {
            requested: ['accepted', 'declined'],
            accepted: ['completed', 'cancelled'],
          };
          if (!allowed[row.status]?.includes(next)) fail(409, 'Invalid change for this request.');
        }
        const note = member.role === 'admin' ? str(body.note, 300, 'Note') : row.staff_note;
        db.prepare(
          'UPDATE escorts SET status=?,staff_note=?,handled_by=?,updated_at=? WHERE id=?',
        ).run(next, note, member.role === 'admin' ? uid : row.handled_by, now, row.id);
        if (member.role === 'admin')
          push.notify([
            {
              userIds: [row.rider_id],
              title:
                next === 'accepted'
                  ? 'Escort request accepted'
                  : next === 'declined'
                    ? 'Escort request declined'
                    : next === 'completed'
                      ? 'Escort marked complete'
                      : 'Escort request cancelled',
              body: note || 'Open NEXT STOP for details.',
              data: { type: 'escort', institutionId: org },
            },
          ]);
        return ok();
      }
      case '/rides/intent': {
        if (member.role !== 'student') fail(403, 'Only riders can coordinate shared rides.');
        requireOn(org, 'shared_rides_enabled', 'Shared-ride coordination');
        if (body.clear === true) {
          db.prepare('DELETE FROM ride_intents WHERE user_id=? AND institution_id=?').run(uid, org);
          return ok();
        }
        if (body.consent !== true)
          fail(400, 'Confirm what other riders will see before continuing.');
        const from = stopIn(body.fromStop, org),
          to = stopIn(body.toStop, org);
        if (!from || !to || from.id === to.id) fail(400, 'Choose two different stops.');
        const after = body.leaveAfter,
          before = body.leaveBefore;
        if (
          !Number.isFinite(after) ||
          !Number.isFinite(before) ||
          before <= after ||
          before - after > 3 * 3600000 ||
          after < now - 600000 ||
          after > now + 86400000
        )
          fail(400, 'Choose a time window of up to 3 hours within the next day.');
        db.prepare(
          `INSERT INTO ride_intents(id,institution_id,user_id,from_stop,to_stop,leave_after,leave_before,group_id,created_at) VALUES (?,?,?,?,?,?,?,NULL,?)
           ON CONFLICT(user_id,institution_id) DO UPDATE SET from_stop=excluded.from_stop,to_stop=excluded.to_stop,leave_after=excluded.leave_after,leave_before=excluded.leave_before,group_id=NULL`,
        ).run(randomUUID(), org, uid, from.id, to.id, after, before, now);
        return ok();
      }
      case '/rides/coordinate': {
        requireOn(org, 'shared_rides_enabled', 'Shared-ride coordination');
        const mine = db
          .prepare('SELECT * FROM ride_intents WHERE user_id=? AND institution_id=?')
          .get(uid, org);
        if (!mine) fail(409, 'Post where and when you’re going first.');
        if (body.join === false) {
          db.prepare('UPDATE ride_intents SET group_id=NULL WHERE id=?').run(mine.id);
          return ok();
        }
        // Joins the group of an overlapping rider who also chose to coordinate (up to four
        // people), or starts one. Members meet at the pickup stop; they see first names only.
        const others = db
          .prepare(
            'SELECT user_id,group_id FROM ride_intents WHERE institution_id=? AND user_id<>? AND from_stop=? AND to_stop=? AND leave_after<? AND leave_before>? AND group_id IS NOT NULL',
          )
          .all(org, uid, mine.from_stop, mine.to_stop, mine.leave_before, mine.leave_after);
        const blocked = new Set(
          db
            .prepare(
              'SELECT blocked_id AS id FROM ride_blocks WHERE blocker_id=? AND institution_id=? UNION SELECT blocker_id FROM ride_blocks WHERE blocked_id=? AND institution_id=?',
            )
            .all(uid, org, uid, org)
            .map((r) => r.id),
        );
        const sizes = new Map();
        for (const o of others) sizes.set(o.group_id, (sizes.get(o.group_id) || 0) + 1);
        const open = others.find(
          (o) =>
            sizes.get(o.group_id) < 4 &&
            !others.some((x) => x.group_id === o.group_id && blocked.has(x.user_id)),
        );
        db.prepare('UPDATE ride_intents SET group_id=? WHERE id=?').run(
          open?.group_id || randomUUID(),
          mine.id,
        );
        return ok();
      }
      case '/rides/block': {
        requireOn(org, 'shared_rides_enabled', 'Shared-ride coordination');
        const target = text('userId');
        if (target === uid) fail(400, 'You cannot block yourself.');
        if (
          !db
            .prepare('SELECT 1 FROM memberships WHERE user_id=? AND institution_id=?')
            .get(target, org)
        )
          fail(404, 'Rider not found.');
        db.prepare(
          'INSERT OR IGNORE INTO ride_blocks(blocker_id,blocked_id,institution_id,created_at) VALUES (?,?,?,?)',
        ).run(uid, target, org, now);
        return ok();
      }
    }
    return false;
  }

  /** Removes a person's safety and coordination data with their account or membership.
   * Their reports stay with the institution but no longer identify them. */
  function forget(uid, org = null) {
    const scope = org ? ' AND institution_id=?' : '';
    const args = org ? [uid, org] : [uid];
    db.prepare(`UPDATE passes SET revoked_at=coalesce(revoked_at,?) WHERE user_id=?${scope}`).run(
      clock(),
      ...args,
    );
    if (!org) db.prepare('DELETE FROM passes WHERE user_id=?').run(uid);
    db.prepare(`DELETE FROM ride_intents WHERE user_id=?${scope}`).run(...args);
    db.prepare(`DELETE FROM escorts WHERE rider_id=?${scope}`).run(...args);
    db.prepare(`UPDATE incidents SET reporter_id=NULL WHERE reporter_id=?${scope}`).run(...args);
    if (!org) {
      db.prepare('UPDATE incidents SET subject_id=NULL WHERE subject_id=?').run(uid);
      db.prepare('DELETE FROM ride_blocks WHERE blocker_id=? OR blocked_id=?').run(uid, uid);
    }
  }

  /** Retention: pass scans 90 days, closed escorts 90 days, resolved reports 1 year. */
  function prune(now = clock()) {
    db.prepare('DELETE FROM pass_scans WHERE at<?').run(now - 90 * 86400000);
    db.prepare(
      "DELETE FROM escorts WHERE status NOT IN ('requested','accepted') AND updated_at<?",
    ).run(now - 90 * 86400000);
    db.prepare("DELETE FROM incidents WHERE status='resolved' AND updated_at<?").run(
      now - 365 * 86400000,
    );
    db.prepare('DELETE FROM ride_intents WHERE leave_before<?').run(now - 3600000);
  }

  return { handle, snapshotExtras, forget, prune, flags, issuePass, validate };
}
