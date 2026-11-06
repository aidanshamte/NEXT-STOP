import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { openDatabase, pruneExpired, SCHEMA_VERSION } from './db.mjs';
import { attachRealtime } from './realtime.mjs';
import { tokenHash, verifyPassword } from './security.mjs';
import { createAuth } from './auth.mjs';
import { createPush, createExpoTransport, EXPO_TOKEN } from './push.mjs';
import { OPEN_STATUSES } from './db.mjs';

const OPEN_SQL = OPEN_STATUSES.map((v) => `'${v}'`).join(',');
const firstName = (name) =>
  String(name || '')
    .trim()
    .split(/\s+/)[0] || 'Your student';
// Rider-facing wording for each driver-set status. No ETA or position is implied.
const statusText = {
  accepted: (trip, stop) => ['Pickup accepted', `${trip} accepted your pickup at ${stop}.`],
  approaching: (trip, stop) => ['Shuttle approaching', `${trip} is approaching ${stop}.`],
  boarded: (trip) => ['On board', `Boarding confirmed on ${trip}.`],
  arrived: (trip, stop, destination) => ['Arrived', `${trip} reports arrival at ${destination}.`],
  cancelled: (trip, stop) => ['Pickup cancelled', `Your pickup at ${stop} was cancelled.`],
};

// Behind a reverse proxy (Caddy on the Azure VM) every socket address is the
// proxy's. Only then is the proxy-set X-Forwarded-For trusted; its rightmost
// entry is the address the proxy itself observed.
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

export function createApp({
  dbPath = './data/next-stop.db',
  origins = ['http://localhost:8081'],
  authOptions = {},
  trustProxy = false,
  // Receives one record per request: no IPs, tokens, bodies, query strings or coordinates.
  log = null,
  sessionRateLimit = 240,
  // Identifies the deployed build in /health so a deploy can be verified from outside.
  release = process.env.RELEASE_ID || 'development',
  // Expo push transport. Off unless injected or PUSH_ENABLED=1 (the production service sets it).
  pushTransport = process.env.PUSH_ENABLED === '1' ? createExpoTransport() : null,
  clock = Date.now,
} = {}) {
  const db = openDatabase(dbPath);
  const auth = createAuth(db, authOptions);
  const push = createPush(db, { transport: pushTransport, log, clock });
  const receiptTimer = setInterval(() => void push.checkReceipts(), 5 * 60000);
  receiptTimer.unref();
  // Recipients for rider-facing updates: the student and parents the student currently shares with.
  const riderAudience = (request) => {
    const student = db.prepare('SELECT name FROM users WHERE id=?').get(request.student_id);
    const parents = db
      .prepare('SELECT parent_id FROM shares WHERE student_id=? AND institution_id=?')
      .all(request.student_id, request.institution_id)
      .map((r) => r.parent_id);
    return { studentName: firstName(student?.name), parents };
  };
  const stopName = (id) =>
    db.prepare('SELECT name FROM stops WHERE id=?').get(id)?.name || 'your stop';
  const startedAt = clock();
  const sessionRates = new Map();
  const limitSession = (hash) => {
    const now = clock();
    let value = sessionRates.get(hash);
    if (!value || now - value.start >= 60000) {
      value = { start: now, count: 0 };
      sessionRates.set(hash, value);
    }
    if (++value.count > sessionRateLimit) fail(429, 'Too many requests. Please slow down.');
  };
  const maintenance = setInterval(() => {
    try {
      pruneExpired(db, clock());
      const now = clock();
      for (const [key, value] of sessionRates)
        if (now - value.start > 60000) sessionRates.delete(key);
    } catch (error) {
      log?.({ level: 'error', event: 'maintenance_failed', message: error.message });
    }
  }, 3600000);
  maintenance.unref();
  const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };
  const membership = (uid, org) =>
    db.prepare('SELECT * FROM memberships WHERE user_id=? AND institution_id=?').get(uid, org);
  const server = createServer(async (req, res) => {
    const started = clock();
    const ip = clientIp(req, trustProxy);
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let changedOrg = null;
    const send = (status, data) => {
      if (req.method === 'POST' && status < 300 && changedOrg)
        queueMicrotask(() => realtime.invalidate(changedOrg));
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      logRequest(status);
    };
    const logRequest = (status) =>
      log?.({
        level: status >= 500 ? 'error' : 'info',
        event: 'request',
        method: req.method,
        // Path only: query strings can carry institution identifiers.
        path: new URL(req.url, 'http://localhost').pathname.slice(0, 80),
        status,
        ms: clock() - started,
      });
    if (req.method === 'OPTIONS') {
      res.writeHead(origin && !origins.includes(origin) ? 403 : 204);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (origin && !origins.includes(origin)) fail(403, 'Origin not allowed.');
      let body = {};
      if (req.method === 'POST') {
        let data = '';
        for await (const chunk of req) {
          data += chunk;
          if (Buffer.byteLength(data) > 16384) fail(413, 'Request too large.');
        }
        try {
          body = JSON.parse(data || '{}');
        } catch {
          fail(400, 'Invalid JSON.');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request.');
      }
      const text = (key, max = 200) => {
        if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > max)
          fail(400, `Invalid ${key}.`);
        return body[key].trim();
      };
      if (path === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        let database = false;
        try {
          database = db.prepare('SELECT 1 AS ok').get().ok === 1;
        } catch {
          /* reported below */
        }
        return send(database ? 200 : 503, {
          ok: database,
          service: 'next-stop',
          protocol: 3,
          schema: SCHEMA_VERSION,
          release,
          uptimeSeconds: Math.round((clock() - startedAt) / 1000),
        });
      }
      if (path === '/institutions' && req.method === 'GET')
        return send(200, db.prepare('SELECT * FROM institutions').all());
      if (
        path !== '/auth/google/link' &&
        (await auth.handle({ path, method: req.method, body, send, ip }))
      )
        return;
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const session =
        token &&
        db
          .prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?')
          .get(tokenHash(token), Date.now());
      if (!session) fail(401, 'Please sign in.');
      limitSession(tokenHash(token));
      const uid = session.user_id;
      if (path === '/auth/google/link') {
        await auth.handle({ path, method: req.method, body, send, uid, ip });
        return;
      }
      if (!db.prepare('SELECT email_verified FROM users WHERE id=?').get(uid)?.email_verified)
        fail(403, 'Verify your email before continuing.');
      if (path === '/push/register' && req.method === 'POST') {
        if (typeof body.token !== 'string' || !EXPO_TOKEN.test(body.token))
          fail(400, 'Invalid push token.');
        if (!['ios', 'android'].includes(body.platform)) fail(400, 'Invalid platform.');
        push.register(uid, tokenHash(token), body.token, body.platform);
        return send(200, { registered: true });
      }
      if (path === '/push/unregister' && req.method === 'POST') {
        if (typeof body.token === 'string') push.unregister(uid, body.token);
        return send(200, { ok: true });
      }
      if (path === '/auth/logout' && req.method === 'POST') {
        // This device stops receiving notifications for the signed-out account.
        db.prepare('DELETE FROM push_tokens WHERE session_hash=?').run(tokenHash(token));
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
        return send(200, { ok: true });
      }
      if (path === '/me' && req.method === 'GET') {
        return send(200, {
          user: db
            .prepare(
              'SELECT id,name,email,email_verified,password_enabled,google_sub IS NOT NULL AS google_linked FROM users WHERE id=?',
            )
            .get(uid),
          memberships: db
            .prepare(
              'SELECT m.institution_id AS id,i.name,i.kind,m.role,m.approved FROM memberships m JOIN institutions i ON i.id=m.institution_id WHERE m.user_id=?',
            )
            .all(uid),
        });
      }
      if (path === '/account/delete' && req.method === 'POST') {
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
        if (user.password_enabled) {
          if (
            typeof body.password !== 'string' ||
            body.password.length > 256 ||
            !verifyPassword(body.password, user.password)
          )
            fail(403, 'Enter your current password to delete your account.');
        } else if (
          typeof body.confirmEmail !== 'string' ||
          body.confirmEmail.trim().toLowerCase() !== user.email
        )
          fail(403, 'Type your account email to confirm deletion.');
        if (db.prepare("SELECT id FROM requests WHERE student_id=? AND status='boarded'").get(uid))
          fail(409, 'You are on board a shuttle. Delete your account after the ride ends.');
        if (db.prepare('SELECT id FROM trips WHERE driver_id=? AND active=1').get(uid))
          fail(409, 'End your active shuttle service before deleting your account.');
        for (const admin of db
          .prepare("SELECT institution_id FROM memberships WHERE user_id=? AND role='admin'")
          .all(uid)) {
          const others = db
            .prepare(
              "SELECT count(*) AS n FROM memberships WHERE institution_id=? AND role='admin' AND approved=1 AND user_id<>?",
            )
            .get(admin.institution_id, uid).n;
          if (!others)
            fail(
              409,
              'Add another administrator for your institution before deleting this account.',
            );
        }
        const orgs = db
          .prepare('SELECT institution_id FROM memberships WHERE user_id=?')
          .all(uid)
          .map((m) => m.institution_id);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(uid);
          db.prepare('DELETE FROM push_tokens WHERE user_id=?').run(uid);
          db.prepare('DELETE FROM shares WHERE student_id=? OR parent_id=?').run(uid, uid);
          // Ride history is personal data: removed with the account, not anonymised.
          db.prepare('DELETE FROM requests WHERE student_id=?').run(uid);
          db.prepare('UPDATE trips SET driver_id=NULL WHERE driver_id=?').run(uid);
          db.prepare('DELETE FROM memberships WHERE user_id=?').run(uid);
          db.prepare('DELETE FROM email_codes WHERE email=?').run(user.email);
          db.prepare('DELETE FROM mail_limits WHERE email=?').run(user.email);
          db.prepare('DELETE FROM users WHERE id=?').run(uid);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        for (const org of orgs) queueMicrotask(() => realtime.invalidate(org));
        return send(200, { deleted: true });
      }
      if (path === '/memberships' && req.method === 'POST') {
        const institutionId = text('institutionId'),
          role = text('role');
        if (!['student', 'parent', 'driver'].includes(role))
          fail(400, 'Choose Student, Parent, or Driver.');
        if (!db.prepare('SELECT id FROM institutions WHERE id=?').get(institutionId))
          fail(404, 'Institution not found.');
        if (membership(uid, institutionId)) fail(409, 'You already belong to this institution.');
        db.prepare('INSERT INTO memberships VALUES (?,?,?,0)').run(uid, institutionId, role);
        changedOrg = institutionId;
        send(201, { pending: true });
        return;
      }
      const org = url.searchParams.get('institutionId') || body.institutionId;
      if (typeof org !== 'string') fail(400, 'Choose an institution.');
      const member = membership(uid, org);
      if (!member) fail(403, 'You do not belong to this institution.');
      changedOrg = org;
      if (path === '/snapshot' && req.method === 'GET') {
        const user = db
          .prepare(
            'SELECT id,name,email,email_verified,google_sub IS NOT NULL AS google_linked FROM users WHERE id=?',
          )
          .get(uid);
        const memberships = db
          .prepare(
            'SELECT m.institution_id AS id,i.name,m.role,m.approved FROM memberships m JOIN institutions i ON i.id=m.institution_id WHERE user_id=?',
          )
          .all(uid);
        if (!member.approved)
          return send(200, {
            user,
            memberships,
            role: member.role,
            approved: false,
            stops: [],
            trips: [],
            requests: [],
            shares: [],
            members: [],
          });
        const stops = db
          .prepare('SELECT * FROM stops WHERE institution_id=? ORDER BY position')
          .all(org);
        let trips = db
          .prepare(
            'SELECT id,institution_id,driver_id,name,capacity,active,lat,lng,accuracy,updated_at,delay_minutes,issue FROM trips WHERE institution_id=?',
          )
          .all(org);
        let requests;
        if (member.role === 'admin')
          requests = db
            .prepare(
              'SELECT r.*,u.name AS student_name FROM requests r JOIN users u ON u.id=r.student_id WHERE r.institution_id=?',
            )
            .all(org);
        else if (member.role === 'driver') {
          trips = trips.filter((t) => t.driver_id === uid);
          requests = db
            .prepare(
              'SELECT r.*,u.name AS student_name FROM requests r JOIN users u ON u.id=r.student_id JOIN trips t ON t.id=r.trip_id WHERE r.institution_id=? AND t.driver_id=?',
            )
            .all(org, uid);
        } else if (member.role === 'parent') {
          requests = db
            .prepare(
              'SELECT r.*,u.name AS student_name FROM requests r JOIN shares s ON s.student_id=r.student_id AND s.institution_id=r.institution_id JOIN users u ON u.id=r.student_id WHERE r.institution_id=? AND s.parent_id=?',
            )
            .all(org, uid);
          trips = trips.filter((t) =>
            requests.some(
              (r) =>
                r.trip_id === t.id && ['accepted', 'approaching', 'boarded'].includes(r.status),
            ),
          );
        } else
          requests = db
            .prepare(
              'SELECT r.*,u.name AS student_name FROM requests r JOIN users u ON u.id=r.student_id WHERE r.institution_id=? AND r.student_id=?',
            )
            .all(org, uid);
        const shares = db
          .prepare(
            'SELECT s.student_id,s.parent_id,u.name,u.email FROM shares s JOIN users u ON u.id=s.parent_id WHERE s.institution_id=? AND s.student_id=?',
          )
          .all(org, uid);
        const members =
          member.role === 'admin'
            ? db
                .prepare(
                  'SELECT m.user_id,u.name,u.email,m.role,m.approved FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.institution_id=?',
                )
                .all(org)
            : [];
        return send(200, {
          user,
          memberships,
          role: member.role,
          approved: true,
          stops,
          trips,
          requests,
          shares,
          members,
        });
      }
      if (!member.approved) fail(403, 'Membership is awaiting institution approval.');
      if (req.method !== 'POST') fail(404, 'Endpoint not found.');
      if (path === '/stops') {
        if (member.role !== 'admin') fail(403, 'Admin access required.');
        const name = text('name', 100);
        const { lat, lng } = body;
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          Math.abs(lat) > 90 ||
          Math.abs(lng) > 180
        )
          fail(400, 'Enter valid latitude and longitude.');
        const id = randomUUID();
        const position = db
          .prepare('SELECT count(*) AS n FROM stops WHERE institution_id=?')
          .get(org).n;
        db.prepare('INSERT INTO stops VALUES (?,?,?,?,?,?)').run(id, org, name, lat, lng, position);
        return send(201, { id });
      }
      if (path === '/trips') {
        if (member.role !== 'admin') fail(403, 'Admin access required.');
        const name = text('name', 100),
          driverId = text('driverId'),
          capacity = body.capacity;
        const driver = membership(driverId, org);
        if (!driver || driver.role !== 'driver' || !driver.approved)
          fail(400, 'Choose an approved driver in this institution.');
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100)
          fail(400, 'Capacity must be 1 to 100.');
        const id = randomUUID();
        db.prepare(
          'INSERT INTO trips(id,institution_id,driver_id,name,capacity,active) VALUES (?,?,?,?,?,0)',
        ).run(id, org, driverId, name, capacity);
        return send(201, { id });
      }
      if (path === '/requests') {
        if (member.role !== 'student') fail(403, 'Only students can request pickup.');
        const trip = db
          .prepare('SELECT * FROM trips WHERE id=? AND institution_id=? AND active=1')
          .get(text('tripId'), org);
        if (!trip) fail(409, 'This trip is not in service.');
        const stopId = text('stopId'),
          destinationId = text('destinationId');
        const stops = db.prepare('SELECT id FROM stops WHERE institution_id=?').all(org);
        if (
          stopId === destinationId ||
          ![stopId, destinationId].every((id) => stops.some((s) => s.id === id))
        )
          fail(400, 'Choose different pickup and destination stops in your institution.');
        const existing = db
          .prepare(
            `SELECT id FROM requests WHERE student_id=? AND institution_id=? AND status IN (${OPEN_SQL})`,
          )
          .get(uid, org);
        if (existing) fail(409, 'You already have an active request.');
        const id = randomUUID();
        const now = clock();
        db.prepare(
          'INSERT INTO requests(id,institution_id,student_id,trip_id,stop_id,destination_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        ).run(id, org, uid, trip.id, stopId, destinationId, 'requested', now, now);
        if (trip.driver_id)
          push.notify([
            {
              userIds: [trip.driver_id],
              title: 'New pickup request',
              body: `Pickup requested at ${stopName(stopId)}.`,
              data: { type: 'request', institutionId: org },
            },
          ]);
        return send(201, { id });
      }
      if (path === '/requests/status') {
        const row = db
          .prepare('SELECT * FROM requests WHERE id=? AND institution_id=?')
          .get(text('requestId'), org);
        if (!row) fail(404, 'Request not found.');
        const next = text('status');
        const trip = db.prepare('SELECT * FROM trips WHERE id=?').get(row.trip_id);
        if (member.role === 'student') {
          if (
            row.student_id !== uid ||
            next !== 'cancelled' ||
            !['requested', 'accepted', 'approaching'].includes(row.status)
          )
            fail(403, 'Cannot cancel this request.');
        } else {
          if (member.role !== 'admin' && !(member.role === 'driver' && trip.driver_id === uid))
            fail(403, 'Not assigned to this trip.');
          const transitions = {
            requested: ['accepted', 'cancelled'],
            accepted: ['approaching', 'boarded', 'cancelled'],
            approaching: ['boarded', 'cancelled'],
            boarded: ['arrived'],
          };
          // Validated against the stored state, so a second conflicting action gets 409.
          if (!transitions[row.status]?.includes(next)) fail(409, 'Invalid request transition.');
          if (next === 'accepted' || next === 'boarded') {
            const occupied = db
              .prepare(
                "SELECT count(*) AS n FROM requests WHERE trip_id=? AND status IN ('accepted','approaching','boarded') AND id<>?",
              )
              .get(trip.id, row.id).n;
            if (occupied >= trip.capacity) fail(409, 'Shuttle capacity reached.');
          }
        }
        db.prepare('UPDATE requests SET status=?,updated_at=? WHERE id=?').run(
          next,
          clock(),
          row.id,
        );
        if (member.role === 'student') {
          if (trip.driver_id)
            push.notify([
              {
                userIds: [trip.driver_id],
                title: 'Pickup cancelled',
                body: `The rider cancelled the pickup at ${stopName(row.stop_id)}.`,
                data: { type: 'request', institutionId: org },
              },
            ]);
        } else {
          const [title, text] = statusText[next](
            trip.name,
            stopName(row.stop_id),
            stopName(row.destination_id),
          );
          const { studentName, parents } = riderAudience(row);
          push.notify([
            {
              userIds: [row.student_id],
              title,
              body: text,
              data: { type: 'status', institutionId: org },
            },
            {
              userIds: parents,
              title: `${studentName}: ${title.toLowerCase()}`,
              body: text.replace('your pickup', `${studentName}'s pickup`),
              data: { type: 'status', institutionId: org },
            },
          ]);
        }
        return send(200, { ok: true });
      }
      if (path.startsWith('/trips/')) {
        const trip = db
          .prepare('SELECT * FROM trips WHERE id=? AND institution_id=?')
          .get(text('tripId'), org);
        if (!trip) fail(404, 'Trip not found.');
        if (path === '/trips/assign') {
          if (member.role !== 'admin') fail(403, 'Admin access required.');
          const driverId = text('driverId');
          const driver = membership(driverId, org);
          if (!driver || driver.role !== 'driver' || !driver.approved)
            fail(400, 'Choose an approved driver in this institution.');
          // Handover keeps trip state; the new driver's device must start its own GPS.
          db.prepare('UPDATE trips SET driver_id=? WHERE id=?').run(driverId, trip.id);
          return send(200, { ok: true });
        }
        if (member.role !== 'admin' && !(member.role === 'driver' && trip.driver_id === uid))
          fail(403, 'Not assigned to this trip.');
        if (path === '/trips/service') {
          if (typeof body.active !== 'boolean') fail(400, 'Invalid service state.');
          if (body.active && !trip.driver_id) fail(409, 'Assign a driver before starting service.');
          if (
            !body.active &&
            db
              .prepare(`SELECT id FROM requests WHERE trip_id=? AND status IN (${OPEN_SQL})`)
              .get(trip.id)
          )
            fail(409, 'Resolve active pickup requests and onboard riders before ending service.');
          // Location is kept only while in service; ending service discards the last fix.
          if (body.active) db.prepare('UPDATE trips SET active=1 WHERE id=?').run(trip.id);
          else
            db.prepare(
              "UPDATE trips SET active=0,lat=NULL,lng=NULL,accuracy=NULL,updated_at=NULL,delay_minutes=0,issue='' WHERE id=?",
            ).run(trip.id);
        } else if (path === '/trips/location') {
          if (!trip.active) fail(409, 'Start service first.');
          const { lat, lng, accuracy, capturedAt } = body;
          if (
            !Number.isFinite(capturedAt) ||
            Date.now() - capturedAt > 30000 ||
            capturedAt > Date.now() + 5000
          )
            fail(400, 'GPS sample is old or has an invalid timestamp.');
          if (trip.updated_at && capturedAt <= trip.updated_at)
            fail(409, 'A newer GPS sample is already stored.');
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180 ||
            !Number.isFinite(accuracy) ||
            accuracy < 0 ||
            accuracy > 100
          )
            fail(400, 'Location accuracy must be within 100 meters.');
          db.prepare('UPDATE trips SET lat=?,lng=?,accuracy=?,updated_at=? WHERE id=?').run(
            lat,
            lng,
            accuracy,
            capturedAt,
            trip.id,
          );
        } else if (path === '/trips/issue') {
          if (
            !Number.isInteger(body.delayMinutes) ||
            body.delayMinutes < 0 ||
            body.delayMinutes > 240 ||
            typeof body.issue !== 'string' ||
            body.issue.length > 300
          )
            fail(400, 'Invalid incident details.');
          db.prepare('UPDATE trips SET delay_minutes=?,issue=? WHERE id=?').run(
            body.delayMinutes,
            body.issue.trim(),
            trip.id,
          );
          if (body.delayMinutes > 0 || body.issue.trim()) {
            const riders = db
              .prepare(`SELECT * FROM requests WHERE trip_id=? AND status IN (${OPEN_SQL})`)
              .all(trip.id);
            const detail = [
              body.delayMinutes > 0
                ? `Driver reports a delay of about ${body.delayMinutes} min.`
                : '',
              body.issue.trim().slice(0, 120),
            ]
              .filter(Boolean)
              .join(' ');
            push.notify(
              riders.flatMap((r) => {
                const { studentName, parents } = riderAudience(r);
                return [
                  {
                    userIds: [r.student_id],
                    title: `Service update: ${trip.name}`,
                    body: detail,
                    data: { type: 'issue', institutionId: org },
                  },
                  {
                    userIds: parents,
                    title: `${studentName}'s shuttle: service update`,
                    body: detail,
                    data: { type: 'issue', institutionId: org },
                  },
                ];
              }),
            );
          }
        } else fail(404, 'Endpoint not found.');
        return send(200, { ok: true });
      }
      if (path === '/shares') {
        if (member.role !== 'student') fail(403, 'Only the student can manage sharing.');
        const email = text('email').toLowerCase();
        const parent = db
          .prepare(
            "SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=? AND m.institution_id=? AND m.role='parent' AND m.approved=1",
          )
          .get(email, org);
        if (!parent) fail(404, 'No approved parent account found in your institution.');
        if (body.revoke === true)
          db.prepare(
            'DELETE FROM shares WHERE student_id=? AND parent_id=? AND institution_id=?',
          ).run(uid, parent.id, org);
        else db.prepare('INSERT OR IGNORE INTO shares VALUES (?,?,?)').run(uid, parent.id, org);
        return send(200, { ok: true });
      }
      if (path === '/members/approve') {
        if (member.role !== 'admin') fail(403, 'Admin access required.');
        const target = text('userId');
        if (!membership(target, org)) fail(404, 'Member not found.');
        db.prepare('UPDATE memberships SET approved=1 WHERE user_id=? AND institution_id=?').run(
          target,
          org,
        );
        const institution = db.prepare('SELECT name FROM institutions WHERE id=?').get(org);
        push.notify([
          {
            userIds: [target],
            title: 'Access approved',
            body: `${institution?.name || 'Your institution'} approved your NEXT STOP access.`,
            data: { type: 'membership', institutionId: org },
          },
        ]);
        return send(200, { ok: true });
      }
      if (path === '/members/revoke') {
        if (member.role !== 'admin') fail(403, 'Admin access required.');
        const target = text('userId');
        if (target === uid) fail(409, 'You cannot remove your own administrator access.');
        if (!membership(target, org)) fail(404, 'Member not found.');
        db.exec('BEGIN IMMEDIATE');
        try {
          // Pending pickups end. Riders already on board keep their record so they can be dropped off.
          db.prepare(
            "UPDATE requests SET status='cancelled' WHERE student_id=? AND institution_id=? AND status IN ('requested','accepted','approaching')",
          ).run(target, org);
          db.prepare(
            'DELETE FROM shares WHERE institution_id=? AND (student_id=? OR parent_id=?)',
          ).run(org, target, target);
          // A revoked driver loses the vehicle immediately; their GPS uploads are rejected.
          db.prepare('UPDATE trips SET driver_id=NULL WHERE institution_id=? AND driver_id=?').run(
            org,
            target,
          );
          db.prepare('DELETE FROM memberships WHERE user_id=? AND institution_id=?').run(
            target,
            org,
          );
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return send(200, { ok: true });
      }
      fail(404, 'Endpoint not found.');
    } catch (error) {
      if (!error.status)
        log?.({
          level: 'error',
          event: 'unhandled',
          message: String(error?.message).slice(0, 300),
        });
      if (!res.headersSent)
        send(error.status || 500, { error: error.status ? error.message : 'Server error.' });
    }
  });
  const realtime = attachRealtime(server, db, origins);
  server.on('close', () => {
    clearInterval(maintenance);
    clearInterval(receiptTimer);
  });
  return { server, db, realtime, push };
}
