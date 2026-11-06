// Production-operations behavior: migrations, backup/restore, proxy-aware rate
// limits, privacy-safe logs, health, admin revocation/reassignment, service-end
// location discard and account deletion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp, clientIp } from '../server/app.mjs';
import { openDatabase, migrate, SCHEMA_VERSION } from '../server/db.mjs';
import { createBackup, verifyBackup, restoreBackup, uploadBackup } from '../server/backup.mjs';
import { hashPassword } from '../server/security.mjs';
import { seedInstitutions } from './fixtures.mjs';

const pass = 'operations-test-password';

async function start(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-ops-'));
  const logs = [];
  const app = createApp({
    dbPath: join(dir, 'ops.db'),
    log: (record) => logs.push(record),
    authOptions: { mailer: async () => {} },
    ...options,
  });
  seedInstitutions(app.db);
  for (const org of ['northbridge', 'lakeside'])
    for (const role of ['student', 'driver', 'parent', 'admin']) {
      const id = `${org}-${role}`;
      app.db
        .prepare('INSERT INTO users(id,name,email,password,email_verified) VALUES (?,?,?,?,1)')
        .run(id, role, `${id}@example.com`, hashPassword(pass));
      app.db.prepare('INSERT INTO memberships VALUES (?,?,?,1)').run(id, org, role);
    }
  // A second approved driver for handover tests.
  app.db
    .prepare('INSERT INTO users(id,name,email,password,email_verified) VALUES (?,?,?,?,1)')
    .run(
      'northbridge-driver2',
      'driver two',
      'northbridge-driver2@example.com',
      hashPassword(pass),
    );
  app.db
    .prepare("INSERT INTO memberships VALUES ('northbridge-driver2','northbridge','driver',1)")
    .run();
  app.db
    .prepare(
      "INSERT INTO trips(id,institution_id,driver_id,name,capacity,active) VALUES ('bus','northbridge','northbridge-driver','Loop',4,1)",
    )
    .run();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    app.realtime.close();
    await new Promise((resolve) => app.server.close(resolve));
    try {
      app.db.close();
    } catch {
      /* already closed by a test */
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const call = async (path, token, body, headers = {}) => {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };
  let logins = 0;
  const login = async (id) => {
    const r = await call(
      '/auth/login',
      null,
      { email: `${id}@example.com`, password: pass },
      { 'X-Forwarded-For': `198.51.100.${(logins += 1)}` },
    );
    assert.equal(r.status, 200, `login ${id}`);
    return r.data.token;
  };
  const act = (path, token, body) => call(path, token, { institutionId: 'northbridge', ...body });
  const gps = (token, extra = {}) =>
    act('/trips/location', token, {
      tripId: 'bus',
      lat: 41.16,
      lng: -73.25,
      accuracy: 8,
      capturedAt: Date.now(),
      ...extra,
    });
  return { app, dir, logs, call, login, act, gps };
}

test('versioned migrations upgrade a pre-versioning database without losing rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-migrate-'));
  try {
    const path = join(dir, 'legacy.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL);
      CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
      INSERT INTO institutions VALUES ('org','Legacy College','college');
      INSERT INTO users VALUES ('u1','Existing','existing@example.com','salt:key');`);
    assert.equal(legacy.prepare('PRAGMA user_version').get().user_version, 0);
    legacy.close();
    const db = openDatabase(path);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get('u1');
    assert.equal(user.email, 'existing@example.com');
    assert.equal(user.email_verified, 0, 'migration never marks old emails verified');
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='sessions_user'").get());
    // Re-running is a no-op.
    assert.equal(migrate(db), SCHEMA_VERSION);
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION + 1}`);
    assert.throws(() => migrate(db), /newer than this server/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('online backup is verified and restore brings back exact data while keeping the prior file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-backup-'));
  try {
    const path = join(dir, 'live.db');
    let db = openDatabase(path);
    db.prepare("INSERT INTO institutions VALUES ('org','Backup College','college')").run();
    db.prepare(
      "INSERT INTO users(id,name,email,password) VALUES ('u1','Rider','r@example.com','x:y')",
    ).run();
    // Backup while the database is open and in WAL mode, as in production.
    const file = await createBackup(path, join(dir, 'backups'));
    assert.deepEqual(verifyBackup(file).counts.users, 1);
    db.prepare(
      "INSERT INTO users(id,name,email,password) VALUES ('u2','Later','l@example.com','x:y')",
    ).run();
    db.close();
    const summary = restoreBackup(file, path);
    assert.ok(existsSync(summary.previous), 'prior database preserved, not deleted');
    db = openDatabase(path);
    assert.deepEqual(
      db
        .prepare('SELECT id FROM users ORDER BY id')
        .all()
        .map((r) => r.id),
      ['u1'],
    );
    db.close();
    const prior = new DatabaseSync(summary.previous, { readOnly: true });
    assert.equal(prior.prepare('SELECT count(*) AS n FROM users').get().n, 2);
    prior.close();
    await assert.rejects(
      uploadBackup(file, 'http://example.com/c', async () => 't'),
      /https/,
    );
    await assert.rejects(
      uploadBackup(file, 'https://acct.blob.core.windows.net/c?sig=secret', async () => 't'),
      /without a SAS/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forwarded client address is used only when a trusted proxy is configured', () => {
  const req = {
    headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.equal(clientIp(req, false), '127.0.0.1');
  assert.equal(clientIp(req, true), '198.51.100.7');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }, true), '::1');
});

test('production operations: rate limits, logs, health, revocation, reassignment, deletion', async (t) => {
  const env = await start(t, {
    trustProxy: true,
    authOptions: { mailer: async () => {}, authRateLimit: 3 },
    sessionRateLimit: 1000,
  });
  const { app, logs, call, login, act, gps } = env;

  await t.test(
    'auth limit is per real client, not shared by everyone behind the proxy',
    async () => {
      const attempt = (ip) =>
        call(
          '/auth/login',
          null,
          { email: 'nobody@example.com', password: 'x' },
          { 'X-Forwarded-For': ip },
        );
      for (let i = 0; i < 3; i++) assert.equal((await attempt('203.0.113.1')).status, 401);
      assert.equal((await attempt('203.0.113.1')).status, 429);
      assert.equal((await attempt('203.0.113.2')).status, 401, 'another user is not blocked');
    },
  );

  const admin = await login('northbridge-admin'),
    driver = await login('northbridge-driver'),
    driver2 = await login('northbridge-driver2'),
    student = await login('northbridge-student'),
    parent = await login('northbridge-parent'),
    outsiderAdmin = await login('lakeside-admin');

  await t.test(
    'health reports schema and logs never contain tokens, emails or coordinates',
    async () => {
      const health = await call('/health');
      assert.equal(health.status, 200);
      assert.equal(health.data.schema, SCHEMA_VERSION);
      assert.equal((await gps(driver)).status, 200);
      const text = JSON.stringify(logs);
      for (const secret of [
        driver,
        admin,
        'northbridge-driver@example.com',
        '41.16',
        '-73.25',
        'northbridge',
      ])
        assert.ok(!text.includes(secret), `log leaked ${secret}`);
      assert.ok(logs.some((r) => r.path === '/trips/location' && r.status === 200));
    },
  );

  await t.test('reassignment needs an approved driver in the same institution', async () => {
    assert.equal(
      (await act('/trips/assign', driver, { tripId: 'bus', driverId: 'northbridge-driver2' }))
        .status,
      403,
    );
    assert.equal(
      (await act('/trips/assign', admin, { tripId: 'bus', driverId: 'lakeside-driver' })).status,
      400,
    );
    assert.equal(
      (await act('/trips/assign', admin, { tripId: 'bus', driverId: 'northbridge-student' }))
        .status,
      400,
    );
    assert.equal(
      (
        await call('/trips/assign', outsiderAdmin, {
          institutionId: 'lakeside',
          tripId: 'bus',
          driverId: 'lakeside-driver',
        })
      ).status,
      404,
      'cannot reach another tenant trip',
    );
    assert.equal(
      (await act('/trips/assign', admin, { tripId: 'bus', driverId: 'northbridge-driver2' }))
        .status,
      200,
    );
    assert.equal(
      (await gps(driver, { capturedAt: Date.now() + 1 })).status,
      403,
      'old driver loses access',
    );
    assert.equal((await gps(driver2, { capturedAt: Date.now() + 2 })).status, 200);
    assert.equal(
      (await act('/trips/assign', admin, { tripId: 'bus', driverId: 'northbridge-driver' })).status,
      200,
    );
  });

  await t.test('ending service discards the stored shuttle location', async () => {
    assert.equal((await gps(driver, { capturedAt: Date.now() + 3 })).status, 200);
    assert.equal(
      (await act('/trips/service', driver, { tripId: 'bus', active: false })).status,
      200,
    );
    const trip = app.db.prepare("SELECT * FROM trips WHERE id='bus'").get();
    assert.equal(trip.lat, null);
    assert.equal(trip.updated_at, null);
    assert.equal(
      (await act('/trips/service', driver, { tripId: 'bus', active: true })).status,
      200,
    );
  });

  await t.test('revoking a driver unassigns the vehicle and rejects their GPS', async () => {
    assert.equal(
      (await act('/members/revoke', student, { userId: 'northbridge-driver' })).status,
      403,
    );
    assert.equal(
      (await act('/members/revoke', admin, { userId: 'northbridge-admin' })).status,
      409,
    );
    assert.equal((await act('/members/revoke', admin, { userId: 'lakeside-driver' })).status, 404);
    assert.equal(
      (await act('/members/revoke', admin, { userId: 'northbridge-driver' })).status,
      200,
    );
    assert.equal(
      app.db.prepare("SELECT driver_id FROM trips WHERE id='bus'").get().driver_id,
      null,
    );
    assert.equal((await gps(driver, { capturedAt: Date.now() + 4 })).status, 403);
    assert.equal((await call('/snapshot?institutionId=northbridge', driver)).status, 403);
    // Re-joining requires approval again; it never restores the old privilege.
    assert.equal(
      (await call('/memberships', driver, { institutionId: 'northbridge', role: 'driver' })).status,
      201,
    );
    assert.equal((await gps(driver, { capturedAt: Date.now() + 5 })).status, 403);
    assert.equal(
      (await act('/members/approve', admin, { userId: 'northbridge-driver' })).status,
      200,
    );
    assert.equal(
      (await act('/trips/assign', admin, { tripId: 'bus', driverId: 'northbridge-driver' })).status,
      200,
    );
  });

  await t.test('revoking a student cancels their pending pickup and removes sharing', async () => {
    assert.equal(
      (await act('/shares', student, { email: 'northbridge-parent@example.com' })).status,
      200,
    );
    const request = await act('/requests', student, {
      tripId: 'bus',
      stopId: 'northbridge-0',
      destinationId: 'northbridge-2',
    });
    assert.equal(request.status, 201);
    assert.equal(
      (await act('/members/revoke', admin, { userId: 'northbridge-student' })).status,
      200,
    );
    assert.equal(
      app.db.prepare('SELECT status FROM requests WHERE id=?').get(request.data.id).status,
      'cancelled',
    );
    assert.equal(
      (await call('/snapshot?institutionId=northbridge', parent)).data.requests.length,
      0,
    );
    app.db
      .prepare("INSERT INTO memberships VALUES ('northbridge-student','northbridge','student',1)")
      .run();
  });

  await t.test(
    'account deletion requires the password and guards active responsibilities',
    async () => {
      assert.equal(
        (await call('/account/delete', student, { password: 'wrong-password-value' })).status,
        403,
      );
      const request = await act('/requests', student, {
        tripId: 'bus',
        stopId: 'northbridge-0',
        destinationId: 'northbridge-2',
      });
      await act('/requests/status', driver, { requestId: request.data.id, status: 'accepted' });
      await act('/requests/status', driver, { requestId: request.data.id, status: 'boarded' });
      assert.equal(
        (await call('/account/delete', student, { password: pass })).status,
        409,
        'not while on board',
      );
      await act('/requests/status', driver, { requestId: request.data.id, status: 'arrived' });
      await act('/shares', student, { email: 'northbridge-parent@example.com' });
      assert.equal(
        (await call('/account/delete', driver, { password: pass })).status,
        409,
        'not during service',
      );
      assert.equal(
        (await call('/account/delete', admin, { password: pass })).status,
        409,
        'not the last admin',
      );

      const deleted = await call('/account/delete', student, { password: pass });
      assert.equal(deleted.status, 200);
      assert.equal(
        app.db.prepare("SELECT id FROM users WHERE id='northbridge-student'").get(),
        undefined,
      );
      assert.equal(
        app.db
          .prepare("SELECT count(*) AS n FROM requests WHERE student_id='northbridge-student'")
          .get().n,
        0,
      );
      assert.equal(
        app.db
          .prepare("SELECT count(*) AS n FROM shares WHERE student_id='northbridge-student'")
          .get().n,
        0,
      );
      assert.equal((await call('/me', student)).status, 401, 'session is gone');
      assert.equal(
        (
          await call('/auth/login', null, {
            email: 'northbridge-student@example.com',
            password: pass,
          })
        ).status,
        401,
      );
    },
  );

  await t.test('service cannot start on an unassigned vehicle', async () => {
    app.db
      .prepare(
        "INSERT INTO trips(id,institution_id,driver_id,name,capacity,active) VALUES ('spare','northbridge',NULL,'Spare',4,0)",
      )
      .run();
    assert.equal(
      (await act('/trips/service', admin, { tripId: 'spare', active: true })).status,
      409,
    );
  });

  await t.test('health fails honestly when the database is unavailable', async () => {
    app.db.close();
    assert.equal((await call('/health')).status, 503);
  });
});

test('per-session request limit applies to authenticated calls', async (t) => {
  const { login, call } = await start(t, { sessionRateLimit: 3 });
  const token = await login('northbridge-student');
  for (let i = 0; i < 3; i++) assert.equal((await call('/me', token)).status, 200);
  assert.equal((await call('/me', token)).status, 429);
});
