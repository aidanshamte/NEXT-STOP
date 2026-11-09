// Rider services: institution settings, waiting demand and request expiry, onboard counts,
// stop details and photos, favorites, notification preferences, service alerts and timetables.
// Every handler runs after app.mjs has authenticated the session and confirmed an approved
// membership of `org`; each query is scoped to `org` again here.
import { randomUUID } from 'node:crypto';
import catalog from './catalog.json' with { type: 'json' };
import {
  addDays,
  localDate,
  parseClock,
  validDate,
  validTimeZone,
  weekday,
  zonedEpoch,
} from './time.mjs';

export const AMENITIES = Object.keys(catalog.amenities);
export const VEHICLE_FEATURES = Object.keys(catalog.vehicleFeatures);
// Vehicle types an administrator can save; blank means not set. The map never infers one.
export const VEHICLE_TYPES = ['', 'bus', 'shuttle'];
export const PHOTO_LIMIT = 900 * 1024;
const PHOTO_TYPES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};
const PREF_COLUMNS = {
  trip_updates: 'trip_updates',
  delay_alerts: 'delay_alerts',
  service_alerts: 'service_alerts',
  approach: 'approach_stops',
};
const DEFAULT_PREFS = { trip_updates: 1, delay_alerts: 1, service_alerts: 1, approach_stops: 1 };
const WAITING = "('requested','accepted','approaching')";

export function createService({ db, push, clock, fail }) {
  const settings = (org) => {
    const row = db
      .prepare(
        'SELECT timezone,request_expiry_minutes FROM institution_settings WHERE institution_id=?',
      )
      .get(org);
    return {
      timezone: row?.timezone || '',
      request_expiry_minutes: row?.request_expiry_minutes ?? 30,
    };
  };
  const requireAdmin = (member) => member.role !== 'admin' && fail(403, 'Admin access required.');
  const stopIn = (id, org) =>
    typeof id === 'string' &&
    db.prepare('SELECT * FROM stops WHERE id=? AND institution_id=?').get(id, org);
  const routeIn = (id, org) =>
    typeof id === 'string' &&
    db.prepare('SELECT * FROM routes WHERE id=? AND institution_id=?').get(id, org);
  const parseList = (json) => {
    try {
      const value = JSON.parse(json || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const nameOf = (uid) => db.prepare('SELECT name FROM users WHERE id=?').get(uid)?.name || '';

  /** Users from `userIds` who have not turned off notifications of `kind` for `org`. */
  function audience(userIds, org, kind) {
    const column = PREF_COLUMNS[kind];
    if (!column) return userIds;
    const off = new Set(
      db
        .prepare(`SELECT user_id FROM notification_prefs WHERE institution_id=? AND ${column}=0`)
        .all(org)
        .map((r) => r.user_id),
    );
    return userIds.filter((id) => !off.has(id));
  }

  /** Cancels pickup requests nobody accepted within the institution's expiry window. Returns
   * the institutions whose data changed. Accepted requests are left to the driver. */
  function expireRequests() {
    const now = clock();
    const rows = db
      .prepare(
        `SELECT r.id,r.institution_id,r.student_id,r.stop_id,r.updated_at,r.created_at,COALESCE(s.request_expiry_minutes,30) AS expiry
         FROM requests r LEFT JOIN institution_settings s ON s.institution_id=r.institution_id
         WHERE r.status='requested'`,
      )
      .all()
      .filter((r) => now - (r.updated_at ?? r.created_at) >= r.expiry * 60000);
    if (!rows.length) return [];
    const update = db.prepare(
      "UPDATE requests SET status='cancelled',cancel_reason='expired',updated_at=? WHERE id=? AND status='requested'",
    );
    const messages = [];
    for (const r of rows) {
      if (!update.run(now, r.id).changes) continue;
      const stop =
        db.prepare('SELECT name FROM stops WHERE id=?').get(r.stop_id)?.name || 'your stop';
      messages.push({
        userIds: audience([r.student_id], r.institution_id, 'trip_updates'),
        title: 'Pickup request expired',
        body: `No driver accepted your pickup at ${stop} within ${r.expiry} minutes. Request again if you still need a ride.`,
        data: { type: 'status', institutionId: r.institution_id },
      });
    }
    if (messages.length) push.notify(messages);
    return [...new Set(rows.map((r) => r.institution_id))];
  }

  /** Tells riders waiting further along the route that the shuttle just passed a stop, when
   * that is within the number of stops they chose (default 1). Sent once per request. */
  function approach(trip, passed, eta) {
    const waiting = db
      .prepare(
        "SELECT id,student_id,stop_id FROM requests WHERE trip_id=? AND status IN ('requested','accepted') AND approach_notified=0",
      )
      .all(trip.id);
    const passedName = db.prepare('SELECT name FROM stops WHERE id=?').get(passed.stopId)?.name;
    const messages = [];
    for (const r of waiting) {
      const ahead = eta.stopsUntil(passed.seq, passed.position, r.stop_id);
      const pref =
        db
          .prepare(
            'SELECT approach_stops FROM notification_prefs WHERE user_id=? AND institution_id=?',
          )
          .get(r.student_id, trip.institution_id)?.approach_stops ?? 1;
      if (ahead == null || ahead < 1 || ahead > pref) continue;
      db.prepare('UPDATE requests SET approach_notified=1 WHERE id=?').run(r.id);
      const stop =
        db.prepare('SELECT name FROM stops WHERE id=?').get(r.stop_id)?.name || 'your stop';
      messages.push({
        userIds: [r.student_id],
        title: 'Shuttle getting close',
        body: `${trip.name} just passed ${passedName}. ${stop} is ${ahead === 1 ? 'the next stop' : `${ahead} stops ahead`}.`,
        data: { type: 'approach', institutionId: trip.institution_id },
      });
    }
    if (messages.length) push.notify(messages);
  }

  /** Keeps the onboard estimate in step with driver-confirmed boarding and drop-off. */
  function onStatusChange(trip, previous, next) {
    const now = clock();
    if (next === 'boarded')
      db.prepare('UPDATE trips SET onboard=onboard+1,onboard_updated_at=? WHERE id=?').run(
        now,
        trip.id,
      );
    if (next === 'arrived' || (previous === 'boarded' && next === 'cancelled'))
      db.prepare('UPDATE trips SET onboard=max(0,onboard-1),onboard_updated_at=? WHERE id=?').run(
        now,
        trip.id,
      );
  }

  /** Seats committed on `trip`: riders on board plus accepted pickups not yet boarded. */
  function seatsCommitted(trip, excludeRequestId = '') {
    const reserved = db
      .prepare(
        "SELECT count(*) AS n FROM requests WHERE trip_id=? AND status IN ('accepted','approaching') AND id<>?",
      )
      .get(trip.id, excludeRequestId).n;
    const onboard = db.prepare('SELECT onboard FROM trips WHERE id=?').get(trip.id)?.onboard ?? 0;
    return { reserved, onboard };
  }

  function snapshotExtras({ member, org, uid }) {
    const now = clock();
    const prefs =
      db
        .prepare(
          'SELECT trip_updates,delay_alerts,service_alerts,approach_stops FROM notification_prefs WHERE user_id=? AND institution_id=?',
        )
        .get(uid, org) || DEFAULT_PREFS;
    return {
      settings: settings(org),
      // Aggregate counts only: no names or request identifiers.
      demand: db
        .prepare(
          `SELECT stop_id,count(*) AS waiting FROM requests WHERE institution_id=? AND status IN ${WAITING} GROUP BY stop_id`,
        )
        .all(org),
      alerts: db
        .prepare(
          'SELECT id,route_id,severity,title,body,starts_at,ends_at,created_at FROM service_alerts WHERE institution_id=? AND resolved_at IS NULL AND (ends_at IS NULL OR ends_at>?) AND starts_at<=? ORDER BY starts_at DESC',
        )
        .all(org, now, now + 7 * 86400000),
      favorites: db
        .prepare(
          'SELECT kind,target_id,label,created_at FROM favorites WHERE user_id=? AND institution_id=? ORDER BY created_at',
        )
        .all(uid, org),
      prefs: { ...prefs },
      rideCount:
        member.role === 'student'
          ? db
              .prepare(
                "SELECT count(*) AS n FROM requests WHERE student_id=? AND institution_id=? AND status='arrived'",
              )
              .get(uid, org).n
          : 0,
    };
  }

  /** Adds detail fields to snapshot stops. */
  function decorateStops(stops) {
    const photos = new Set(
      db
        .prepare(
          `SELECT stop_id FROM stop_photos WHERE stop_id IN (${stops.map(() => '?').join(',') || "''"})`,
        )
        .all(...stops.map((s) => s.id))
        .map((r) => r.stop_id),
    );
    return stops.map((s) => ({
      ...s,
      amenities: parseList(s.amenities),
      has_photo: photos.has(s.id) ? 1 : 0,
    }));
  }

  function schedule(org, date) {
    const { timezone } = settings(org);
    if (!timezone) return { configured: false };
    const day = date && validDate(date) ? date : localDate(clock(), timezone);
    const exceptions = db
      .prepare(
        'SELECT id,date,kind,route_id,note FROM service_exceptions WHERE institution_id=? AND date>=? AND date<=? ORDER BY date',
      )
      .all(org, addDays(day, -1), addDays(day, 120));
    const closedAll = exceptions.some((e) => e.date === day && e.kind === 'closed' && !e.route_id);
    const periods = db
      .prepare(
        'SELECT id,name,start_date,end_date,days FROM service_periods WHERE institution_id=? ORDER BY start_date',
      )
      .all(org);
    const active = periods.filter(
      (p) => p.start_date <= day && day <= p.end_date && p.days[weekday(day)] === '1',
    );
    const routes = db.prepare('SELECT id FROM routes WHERE institution_id=?').all(org);
    const rows = db
      .prepare(
        'SELECT d.route_id,d.period_id,d.minute FROM departures d JOIN routes r ON r.id=d.route_id WHERE r.institution_id=? ORDER BY d.minute',
      )
      .all(org);
    const activeIds = new Set(active.map((p) => p.id));
    return {
      configured: true,
      timezone,
      date: day,
      closed: closedAll,
      periods,
      activePeriodIds: [...activeIds],
      exceptions,
      // Raw minutes so administrators can edit what they entered.
      departures: rows,
      routes: routes.map((route) => {
        const closed =
          closedAll ||
          exceptions.some((e) => e.date === day && e.kind === 'closed' && e.route_id === route.id);
        const minutes = closed
          ? []
          : [
              ...new Set(
                rows
                  .filter((d) => d.route_id === route.id && activeIds.has(d.period_id))
                  .map((d) => d.minute),
              ),
            ].sort((a, b) => a - b);
        return {
          route_id: route.id,
          closed,
          departures: minutes.map((m) => zonedEpoch(day, m, timezone)),
        };
      }),
    };
  }

  function expandTimes(body) {
    let minutes;
    if (Array.isArray(body.times)) {
      if (body.times.length > 300) fail(400, 'Enter at most 300 departures.');
      minutes = body.times.map(parseClock);
      if (minutes.some((m) => m == null)) fail(400, 'Enter times as HH:MM (24-hour).');
    } else if (body.every != null) {
      const from = parseClock(body.from),
        to = parseClock(body.to),
        every = body.every;
      if (from == null || to == null || to < from) fail(400, 'Enter a valid first and last time.');
      if (!Number.isInteger(every) || every < 3 || every > 240)
        fail(400, 'Frequency must be 3 to 240 minutes.');
      minutes = [];
      for (let m = from; m <= to; m += every) minutes.push(m);
      if (minutes.length > 300) fail(400, 'That creates more than 300 departures.');
    } else fail(400, 'Enter departure times or a frequency.');
    return [...new Set(minutes)].sort((a, b) => a - b);
  }

  async function handle({ path, method, body, url, uid, member, org, send, text }) {
    if (method === 'GET') {
      if (path === '/schedule')
        return (send(200, schedule(org, url.searchParams.get('date'))), true);
      if (path === '/stops/photo') {
        const stop = stopIn(url.searchParams.get('stopId'), org);
        if (!stop || (stop.status !== 'confirmed' && member.role !== 'admin'))
          fail(404, 'Stop not found.');
        const photo = db
          .prepare('SELECT data,content_type,updated_at FROM stop_photos WHERE stop_id=?')
          .get(stop.id);
        if (!photo) fail(404, 'No photo for this stop.');
        send(200, {
          contentType: photo.content_type,
          data: Buffer.from(photo.data).toString('base64'),
          updatedAt: photo.updated_at,
        });
        return true;
      }
      return false;
    }
    const now = clock();
    switch (path) {
      case '/settings': {
        requireAdmin(member);
        const current = settings(org);
        const timezone = body.timezone ?? current.timezone;
        if (timezone && !validTimeZone(timezone))
          fail(400, 'Choose a valid time zone, for example America/New_York.');
        const expiry = body.requestExpiryMinutes ?? current.request_expiry_minutes;
        if (!Number.isInteger(expiry) || expiry < 5 || expiry > 240)
          fail(400, 'Request expiry must be 5 to 240 minutes.');
        db.prepare(
          `INSERT INTO institution_settings(institution_id,timezone,request_expiry_minutes,updated_at) VALUES (?,?,?,?)
           ON CONFLICT(institution_id) DO UPDATE SET timezone=excluded.timezone,request_expiry_minutes=excluded.request_expiry_minutes,updated_at=excluded.updated_at`,
        ).run(org, timezone, expiry, now);
        send(200, { ok: true });
        return true;
      }
      case '/prefs': {
        const flags = ['tripUpdates', 'delayAlerts', 'serviceAlerts'];
        if (!flags.every((k) => typeof body[k] === 'boolean')) fail(400, 'Invalid preferences.');
        if (
          !Number.isInteger(body.approachStops) ||
          body.approachStops < 0 ||
          body.approachStops > 3
        )
          fail(400, 'Approach alerts must be off or 1 to 3 stops ahead.');
        db.prepare(
          `INSERT INTO notification_prefs(user_id,institution_id,trip_updates,delay_alerts,service_alerts,approach_stops) VALUES (?,?,?,?,?,?)
           ON CONFLICT(user_id,institution_id) DO UPDATE SET trip_updates=excluded.trip_updates,delay_alerts=excluded.delay_alerts,service_alerts=excluded.service_alerts,approach_stops=excluded.approach_stops`,
        ).run(
          uid,
          org,
          +body.tripUpdates,
          +body.delayAlerts,
          +body.serviceAlerts,
          body.approachStops,
        );
        send(200, { ok: true });
        return true;
      }
      case '/favorites': {
        const kind = text('kind'),
          target = text('targetId');
        if (kind === 'stop') {
          const stop = stopIn(target, org);
          if (!stop || stop.status !== 'confirmed') fail(404, 'Stop not found.');
        } else if (kind === 'route') {
          if (!routeIn(target, org)) fail(404, 'Route not found.');
        } else fail(400, 'Invalid favorite.');
        const label = typeof body.label === 'string' ? body.label.trim() : '';
        if (label.length > 40) fail(400, 'Keep the label under 40 characters.');
        const count = db
          .prepare('SELECT count(*) AS n FROM favorites WHERE user_id=? AND institution_id=?')
          .get(uid, org).n;
        const exists = db
          .prepare(
            'SELECT 1 FROM favorites WHERE user_id=? AND institution_id=? AND kind=? AND target_id=?',
          )
          .get(uid, org, kind, target);
        if (!exists && count >= 50) fail(409, 'You can save up to 50 favorites.');
        db.prepare(
          `INSERT INTO favorites(user_id,institution_id,kind,target_id,label,created_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT(user_id,institution_id,kind,target_id) DO UPDATE SET label=excluded.label`,
        ).run(uid, org, kind, target, label, now);
        send(200, { ok: true });
        return true;
      }
      case '/favorites/remove': {
        db.prepare(
          'DELETE FROM favorites WHERE user_id=? AND institution_id=? AND kind=? AND target_id=?',
        ).run(uid, org, text('kind'), text('targetId'));
        send(200, { ok: true });
        return true;
      }
      case '/alerts': {
        requireAdmin(member);
        const severity = text('severity');
        if (!['info', 'delay', 'interruption'].includes(severity)) fail(400, 'Choose a severity.');
        const title = text('title', 80);
        const detail = typeof body.body === 'string' ? body.body.trim() : '';
        if (detail.length > 500) fail(400, 'Keep the details under 500 characters.');
        let routeId = null;
        if (body.routeId != null) {
          if (!routeIn(body.routeId, org)) fail(400, 'Choose a route in this institution.');
          routeId = body.routeId;
        }
        const startsAt = body.startsAt ?? now;
        const endsAt = body.endsAt ?? null;
        if (
          !Number.isFinite(startsAt) ||
          (endsAt != null && (!Number.isFinite(endsAt) || endsAt <= startsAt))
        )
          fail(400, 'Check the alert’s start and end times.');
        const id = randomUUID();
        db.prepare(
          'INSERT INTO service_alerts(id,institution_id,route_id,severity,title,body,starts_at,ends_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ).run(id, org, routeId, severity, title, detail, startsAt, endsAt, uid, now);
        // Delays and interruptions that apply now are pushed; notices stay in the app.
        if (severity !== 'info' && startsAt <= now + 60000) {
          const riders = routeId
            ? db
                .prepare(
                  `SELECT user_id AS id FROM favorites WHERE institution_id=? AND kind='route' AND target_id=?
                   UNION SELECT r.student_id FROM requests r JOIN trips t ON t.id=r.trip_id WHERE r.institution_id=? AND t.route_id=? AND r.status IN ('requested','accepted','approaching','boarded')`,
                )
                .all(org, routeId, org, routeId)
            : db
                .prepare(
                  "SELECT user_id AS id FROM memberships WHERE institution_id=? AND approved=1 AND role IN ('student','parent')",
                )
                .all(org);
          const route = routeId ? routeIn(routeId, org) : null;
          push.notify([
            {
              userIds: audience(
                riders.map((r) => r.id),
                org,
                'service_alerts',
              ),
              title: route ? `${route.name}: ${title}` : title,
              body: detail.slice(0, 160) || 'Open NEXT STOP for details.',
              data: { type: 'alert', institutionId: org },
            },
          ]);
        }
        send(201, { id });
        return true;
      }
      case '/alerts/resolve': {
        requireAdmin(member);
        const changed = db
          .prepare(
            'UPDATE service_alerts SET resolved_at=? WHERE id=? AND institution_id=? AND resolved_at IS NULL',
          )
          .run(now, text('alertId'), org).changes;
        if (!changed) fail(404, 'Alert not found.');
        send(200, { ok: true });
        return true;
      }
      case '/stops/details': {
        requireAdmin(member);
        const stop = stopIn(text('stopId'), org);
        if (!stop) fail(404, 'Stop not found.');
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        const accessibility =
          typeof body.accessibility === 'string' ? body.accessibility.trim() : '';
        if (description.length > 500 || accessibility.length > 300)
          fail(400, 'Keep the description under 500 and accessibility notes under 300 characters.');
        const amenities = body.amenities ?? [];
        if (
          !Array.isArray(amenities) ||
          amenities.length > AMENITIES.length ||
          !amenities.every(
            (a) =>
              a &&
              AMENITIES.includes(a.key) &&
              (a.detail == null || (typeof a.detail === 'string' && a.detail.length <= 80)),
          ) ||
          new Set(amenities.map((a) => a.key)).size !== amenities.length
        )
          fail(400, 'Invalid amenities.');
        const name = body.name == null ? stop.name : text('name', 100);
        // Any edit needs a fresh verification by an administrator.
        db.prepare(
          'UPDATE stops SET name=?,description=?,accessibility=?,amenities=?,details_verified_at=NULL,details_verified_by=NULL WHERE id=?',
        ).run(
          name,
          description,
          accessibility,
          JSON.stringify(amenities.map((a) => ({ key: a.key, detail: (a.detail || '').trim() }))),
          stop.id,
        );
        send(200, { ok: true });
        return true;
      }
      case '/stops/verify': {
        requireAdmin(member);
        const stop = stopIn(text('stopId'), org);
        if (!stop) fail(404, 'Stop not found.');
        if (stop.status !== 'confirmed')
          fail(409, 'Confirm the stop’s location before verifying its details.');
        db.prepare('UPDATE stops SET details_verified_at=?,details_verified_by=? WHERE id=?').run(
          now,
          nameOf(uid),
          stop.id,
        );
        send(200, { ok: true });
        return true;
      }
      case '/stops/photo': {
        requireAdmin(member);
        const stop = stopIn(text('stopId'), org);
        if (!stop) fail(404, 'Stop not found.');
        const type = text('contentType');
        if (!PHOTO_TYPES[type]) fail(400, 'Use a JPEG, PNG or WebP photo.');
        if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(body.data))
          fail(400, 'Invalid photo data.');
        const bytes = Buffer.from(body.data, 'base64');
        if (bytes.length > PHOTO_LIMIT) fail(413, 'Photo is too large. Use one under 900 KB.');
        if (bytes.length < 16 || !PHOTO_TYPES[type](bytes))
          fail(400, 'The file is not a valid photo.');
        db.prepare(
          `INSERT INTO stop_photos(stop_id,institution_id,data,content_type,updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(stop_id) DO UPDATE SET data=excluded.data,content_type=excluded.content_type,updated_at=excluded.updated_at`,
        ).run(stop.id, org, bytes, type, now);
        db.prepare(
          'UPDATE stops SET details_verified_at=NULL,details_verified_by=NULL WHERE id=?',
        ).run(stop.id);
        send(200, { ok: true });
        return true;
      }
      case '/stops/photo/delete': {
        requireAdmin(member);
        const stop = stopIn(text('stopId'), org);
        if (!stop) fail(404, 'Stop not found.');
        db.prepare('DELETE FROM stop_photos WHERE stop_id=?').run(stop.id);
        send(200, { ok: true });
        return true;
      }
      case '/trips/vehicle': {
        requireAdmin(member);
        const trip = db
          .prepare('SELECT * FROM trips WHERE id=? AND institution_id=?')
          .get(text('tripId'), org);
        if (!trip) fail(404, 'Trip not found.');
        const capacity = body.capacity;
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100)
          fail(400, 'Capacity must be 1 to 100.');
        const features = body.features ?? [];
        if (
          !Array.isArray(features) ||
          !features.every((f) => VEHICLE_FEATURES.includes(f)) ||
          new Set(features).size !== features.length
        )
          fail(400, 'Invalid vehicle features.');
        // Optional, so older clients that only send seats and features keep the saved type.
        const vehicleType = body.vehicleType ?? trip.vehicle_type;
        if (!VEHICLE_TYPES.includes(vehicleType)) fail(400, 'Choose bus, shuttle van, or not set.');
        db.prepare('UPDATE trips SET capacity=?,features=?,vehicle_type=? WHERE id=?').run(
          capacity,
          JSON.stringify(features),
          vehicleType,
          trip.id,
        );
        send(200, { ok: true });
        return true;
      }
      case '/trips/onboard': {
        const trip = db
          .prepare('SELECT * FROM trips WHERE id=? AND institution_id=?')
          .get(text('tripId'), org);
        if (!trip) fail(404, 'Trip not found.');
        if (member.role !== 'admin' && !(member.role === 'driver' && trip.driver_id === uid))
          fail(403, 'Not assigned to this trip.');
        if (!trip.active) fail(409, 'Start service first.');
        const count = body.count;
        if (!Number.isInteger(count) || count < 0 || count > 200)
          fail(400, 'Enter a count from 0 to 200.');
        db.prepare(
          "UPDATE trips SET onboard=?,onboard_updated_at=?,onboard_source='driver' WHERE id=?",
        ).run(count, now, trip.id);
        send(200, { ok: true });
        return true;
      }
      case '/schedule/period': {
        requireAdmin(member);
        const name = text('name', 80);
        const { startDate, endDate, days } = body;
        if (!validDate(startDate) || !validDate(endDate) || endDate < startDate)
          fail(400, 'Enter valid start and end dates (YYYY-MM-DD).');
        if (typeof days !== 'string' || !/^[01]{7}$/.test(days) || days === '0000000')
          fail(400, 'Choose at least one day of service.');
        if (!settings(org).timezone) fail(409, 'Set the institution’s time zone first.');
        let id = body.periodId;
        if (id != null) {
          if (
            !db
              .prepare('SELECT 1 FROM service_periods WHERE id=? AND institution_id=?')
              .get(id, org)
          )
            fail(404, 'Service period not found.');
          db.prepare(
            'UPDATE service_periods SET name=?,start_date=?,end_date=?,days=? WHERE id=?',
          ).run(name, startDate, endDate, days, id);
        } else {
          id = randomUUID();
          db.prepare(
            'INSERT INTO service_periods(id,institution_id,name,start_date,end_date,days,created_at) VALUES (?,?,?,?,?,?,?)',
          ).run(id, org, name, startDate, endDate, days, now);
        }
        send(200, { id });
        return true;
      }
      case '/schedule/period/delete': {
        requireAdmin(member);
        const id = text('periodId');
        if (
          !db.prepare('SELECT 1 FROM service_periods WHERE id=? AND institution_id=?').get(id, org)
        )
          fail(404, 'Service period not found.');
        db.prepare('DELETE FROM departures WHERE period_id=?').run(id);
        db.prepare('DELETE FROM service_periods WHERE id=?').run(id);
        send(200, { ok: true });
        return true;
      }
      case '/schedule/departures': {
        requireAdmin(member);
        const route = routeIn(text('routeId'), org);
        if (!route) fail(404, 'Route not found.');
        const period = text('periodId');
        if (
          !db
            .prepare('SELECT 1 FROM service_periods WHERE id=? AND institution_id=?')
            .get(period, org)
        )
          fail(404, 'Service period not found.');
        const minutes = expandTimes(body);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM departures WHERE route_id=? AND period_id=?').run(
            route.id,
            period,
          );
          const insert = db.prepare(
            'INSERT INTO departures(route_id,period_id,minute) VALUES (?,?,?)',
          );
          for (const m of minutes) insert.run(route.id, period, m);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        send(200, { count: minutes.length });
        return true;
      }
      case '/schedule/offsets': {
        requireAdmin(member);
        const route = routeIn(text('routeId'), org);
        if (!route) fail(404, 'Route not found.');
        const positions = db
          .prepare('SELECT position FROM route_stops WHERE route_id=? ORDER BY position')
          .all(route.id)
          .map((r) => r.position);
        const offsets = body.offsets;
        if (!Array.isArray(offsets) || offsets.length > positions.length)
          fail(400, 'Invalid offsets.');
        const byPosition = new Map();
        for (const o of offsets) {
          if (!o || !positions.includes(o.position) || byPosition.has(o.position))
            fail(400, 'Invalid route position.');
          if (
            o.minutes !== null &&
            (!Number.isInteger(o.minutes) || o.minutes < 0 || o.minutes > 600)
          )
            fail(400, 'Minutes from the first stop must be 0 to 600.');
          byPosition.set(o.position, o.minutes);
        }
        let last = -1;
        for (const p of positions) {
          const m = byPosition.has(p) ? byPosition.get(p) : null;
          if (m == null) continue;
          if (m < last) fail(400, 'Times must not decrease along the route.');
          last = m;
        }
        const update = db.prepare(
          'UPDATE route_stops SET offset_minutes=? WHERE route_id=? AND position=?',
        );
        for (const [p, m] of byPosition) update.run(m, route.id, p);
        send(200, { ok: true });
        return true;
      }
      case '/schedule/exception': {
        requireAdmin(member);
        const date = body.date;
        if (!validDate(date)) fail(400, 'Enter a valid date (YYYY-MM-DD).');
        const kind = text('kind');
        if (!['closed', 'note'].includes(kind)) fail(400, 'Choose closed or note.');
        const note = typeof body.note === 'string' ? body.note.trim() : '';
        if (note.length > 300 || (kind === 'note' && !note))
          fail(400, 'Write a note of up to 300 characters.');
        let routeId = null;
        if (body.routeId != null) {
          if (!routeIn(body.routeId, org)) fail(400, 'Choose a route in this institution.');
          routeId = body.routeId;
        }
        const id = randomUUID();
        db.prepare(
          'INSERT INTO service_exceptions(id,institution_id,date,kind,route_id,note) VALUES (?,?,?,?,?,?)',
        ).run(id, org, date, kind, routeId, note);
        send(201, { id });
        return true;
      }
      case '/schedule/exception/delete': {
        requireAdmin(member);
        if (
          !db
            .prepare('DELETE FROM service_exceptions WHERE id=? AND institution_id=?')
            .run(text('exceptionId'), org).changes
        )
          fail(404, 'Not found.');
        send(200, { ok: true });
        return true;
      }
    }
    return false;
  }

  /** Personal service data removed with an account or an institution membership. */
  function forget(uid, org = null) {
    for (const table of ['favorites', 'notification_prefs'])
      db.prepare(`DELETE FROM ${table} WHERE user_id=?${org ? ' AND institution_id=?' : ''}`).run(
        ...(org ? [uid, org] : [uid]),
      );
  }

  return {
    approach,
    audience,
    expireRequests,
    onStatusChange,
    seatsCommitted,
    snapshotExtras,
    decorateStops,
    schedule,
    handle,
    forget,
    settings,
  };
}
