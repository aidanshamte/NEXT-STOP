import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { openDatabase } from './db.mjs';
import { attachRealtime } from './realtime.mjs';
import { hashPassword, verifyPassword, tokenHash } from './security.mjs';
export function createApp({
  dbPath = './data/next-stop.db',
  origins = ['http://localhost:8081'],
} = {}) {
  const db = openDatabase(dbPath);
  const attempts = new Map();
  const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };
  const membership = (uid, org) =>
    db.prepare('SELECT * FROM memberships WHERE user_id=? AND institution_id=?').get(uid, org);
  const server = createServer(async (req, res) => {
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
    };
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
      if (path === '/health' && req.method === 'GET')
        return send(200, { ok: true, service: 'next-stop', protocol: 2 });
      if (path === '/institutions' && req.method === 'GET')
        return send(200, db.prepare('SELECT * FROM institutions').all());
      if (['/auth/register', '/auth/login'].includes(path) && req.method === 'POST') {
        // Local-pilot protection. Use a distributed rate limiter behind a production gateway.
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        let rate = attempts.get(ip);
        if (!rate || now - rate.start > 60000) {
          rate = { start: now, count: 0 };
          attempts.set(ip, rate);
        }
        if (++rate.count > 30) fail(429, 'Too many attempts. Try again in a minute.');
        for (const [key, value] of attempts) if (now - value.start > 60000) attempts.delete(key);
        const email = text('email').toLowerCase();
        const password = text('password', 256);
        let user;
        if (path.endsWith('register')) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email.');
          if (password.length < 12) fail(400, 'Use at least 12 characters for your password.');
          const name = text('name', 80),
            role = text('role'),
            org = text('institutionId');
          if (!['student', 'parent', 'driver'].includes(role)) fail(400, 'Invalid role.');
          if (!db.prepare('SELECT id FROM institutions WHERE id=?').get(org))
            fail(404, 'Institution not found.');
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
            fail(409, 'Account exists. Sign in instead.');
          const id = randomUUID();
          db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(
            id,
            name,
            email,
            hashPassword(password),
          );
          // All memberships are pending until an operator verifies institution affiliation.
          db.prepare('INSERT INTO memberships VALUES (?,?,?,0)').run(id, org, role);
          user = { id };
          changedOrg = org;
        } else {
          user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
          if (!user || !verifyPassword(password, user.password))
            fail(401, 'Incorrect email or password.');
        }
        const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
          tokenHash(token),
          user.id,
          Date.now() + 86400000 * 7,
        );
        return send(200, { token });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const session =
        token &&
        db
          .prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?')
          .get(tokenHash(token), Date.now());
      if (!session) fail(401, 'Please sign in.');
      const uid = session.user_id;
      if (path === '/auth/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
        return send(200, { ok: true });
      }
      if (path === '/me' && req.method === 'GET') {
        return send(200, {
          user: db.prepare('SELECT id,name,email FROM users WHERE id=?').get(uid),
          memberships: db
            .prepare(
              'SELECT m.institution_id AS id,i.name,i.kind,m.role,m.approved FROM memberships m JOIN institutions i ON i.id=m.institution_id WHERE m.user_id=?',
            )
            .all(uid),
        });
      }
      const org = url.searchParams.get('institutionId') || body.institutionId;
      if (typeof org !== 'string') fail(400, 'Choose an institution.');
      const member = membership(uid, org);
      if (!member) fail(403, 'You do not belong to this institution.');
      changedOrg = org;
      if (path === '/snapshot' && req.method === 'GET') {
        const user = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(uid);
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
            requests.some((r) => r.trip_id === t.id && ['accepted', 'boarded'].includes(r.status)),
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
            "SELECT id FROM requests WHERE student_id=? AND institution_id=? AND status IN ('requested','accepted','boarded')",
          )
          .get(uid, org);
        if (existing) fail(409, 'You already have an active request.');
        const id = randomUUID();
        db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?)').run(
          id,
          org,
          uid,
          trip.id,
          stopId,
          destinationId,
          'requested',
          Date.now(),
        );
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
            !['requested', 'accepted'].includes(row.status)
          )
            fail(403, 'Cannot cancel this request.');
        } else {
          if (member.role !== 'admin' && !(member.role === 'driver' && trip.driver_id === uid))
            fail(403, 'Not assigned to this trip.');
          const transitions = {
            requested: ['accepted', 'cancelled'],
            accepted: ['boarded', 'cancelled'],
            boarded: ['arrived'],
          };
          if (!transitions[row.status]?.includes(next)) fail(409, 'Invalid request transition.');
          if (next === 'accepted' || next === 'boarded') {
            const occupied = db
              .prepare(
                "SELECT count(*) AS n FROM requests WHERE trip_id=? AND status IN ('accepted','boarded') AND id<>?",
              )
              .get(trip.id, row.id).n;
            if (occupied >= trip.capacity) fail(409, 'Shuttle capacity reached.');
          }
        }
        db.prepare('UPDATE requests SET status=? WHERE id=?').run(next, row.id);
        return send(200, { ok: true });
      }
      if (path.startsWith('/trips/')) {
        const trip = db
          .prepare('SELECT * FROM trips WHERE id=? AND institution_id=?')
          .get(text('tripId'), org);
        if (!trip) fail(404, 'Trip not found.');
        if (member.role !== 'admin' && !(member.role === 'driver' && trip.driver_id === uid))
          fail(403, 'Not assigned to this trip.');
        if (path === '/trips/service') {
          if (typeof body.active !== 'boolean') fail(400, 'Invalid service state.');
          if (
            !body.active &&
            db
              .prepare(
                "SELECT id FROM requests WHERE trip_id=? AND status IN ('requested','accepted','boarded')",
              )
              .get(trip.id)
          )
            fail(409, 'Resolve active pickup requests and onboard riders before ending service.');
          db.prepare('UPDATE trips SET active=? WHERE id=?').run(body.active ? 1 : 0, trip.id);
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
            body.issue,
            trip.id,
          );
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
        return send(200, { ok: true });
      }
      fail(404, 'Endpoint not found.');
    } catch (error) {
      if (!res.headersSent)
        send(error.status || 500, { error: error.status ? error.message : 'Server error.' });
    }
  });
  const realtime = attachRealtime(server, db, origins);
  return { server, db, realtime };
}
