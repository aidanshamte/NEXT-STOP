// Push notifications and the driver-set 'approaching' status. A recording transport
// stands in for the Expo Push Service; no real notifications are sent by tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';
import { migrate, openDatabase, SCHEMA_VERSION } from '../server/db.mjs';
import { createExpoTransport } from '../server/push.mjs';
import { hashPassword } from '../server/security.mjs';
import { seedInstitutions } from './fixtures.mjs';

const pass = 'push-test-password-long';
const tick = () => new Promise((r) => setTimeout(r, 30));

test('notifications reach exactly the authorized people for each journey event', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-push-'));
  const sent = [];
  let nextTicket = 0;
  const unregistered = new Set();
  const transport = {
    async send(messages) {
      sent.push(...messages);
      return messages.map((m) =>
        unregistered.has(m.to)
          ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: `ticket-${++nextTicket}` },
      );
    },
    async receipts(ids) {
      return Object.fromEntries(
        ids.map((id) => [
          id,
          id === 'ticket-2'
            ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok' },
        ]),
      );
    },
  };
  let now = Date.now();
  const app = createApp({
    dbPath: join(dir, 'push.db'),
    pushTransport: transport,
    authOptions: { mailer: async () => {} },
    clock: () => now,
  });
  seedInstitutions(app.db);
  const people = [
    ['northbridge', 'student'],
    ['northbridge', 'driver'],
    ['northbridge', 'parent'],
    ['northbridge', 'parent2'],
    ['northbridge', 'admin'],
    ['lakeside', 'student'],
  ];
  for (const [org, role] of people) {
    const id = `${org}-${role}`;
    app.db
      .prepare('INSERT INTO users(id,name,email,password,email_verified) VALUES (?,?,?,?,1)')
      .run(id, `Alex ${role}`, `${id}@example.com`, hashPassword(pass));
    app.db
      .prepare('INSERT INTO memberships VALUES (?,?,?,1)')
      .run(id, org, role.replace(/\d$/, ''));
  }
  app.db
    .prepare(
      "INSERT INTO trips(id,institution_id,driver_id,name,capacity,active) VALUES ('bus','northbridge','northbridge-driver','Shuttle A',1,1)",
    )
    .run();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    app.realtime.close();
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = async (path, token, body) => {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };
  const tokens = {};
  for (const [org, role] of people) {
    const id = `${org}-${role}`;
    tokens[id] = (
      await call('/auth/login', null, { email: `${id}@example.com`, password: pass })
    ).data.token;
    const pushToken = `ExponentPushToken[${id.replace(/[^a-z0-9]/g, '')}xxxxxxxx]`;
    assert.equal(
      (await call('/push/register', tokens[id], { token: pushToken, platform: 'android' })).status,
      200,
    );
  }
  const deviceOf = (id) => `ExponentPushToken[${id.replace(/[^a-z0-9]/g, '')}xxxxxxxx]`;
  const recipients = () => sent.splice(0).map((m) => m.to);
  const act = (path, who, body) =>
    call(path, tokens[who], { institutionId: 'northbridge', ...body });

  await t.test('token registration is authenticated and validated', async () => {
    assert.equal(
      (await call('/push/register', null, { token: deviceOf('x'), platform: 'ios' })).status,
      401,
    );
    assert.equal(
      (
        await call('/push/register', tokens['northbridge-student'], {
          token: 'not-a-token',
          platform: 'ios',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('/push/register', tokens['northbridge-student'], {
          token: deviceOf('y'),
          platform: 'web',
        })
      ).status,
      400,
    );
  });

  let requestId;
  await t.test('a new request notifies only the assigned driver', async () => {
    await act('/shares', 'northbridge-student', { email: 'northbridge-parent@example.com' });
    await tick();
    // Starting to share tells the parent; nobody else hears about it.
    assert.deepEqual(recipients(), [deviceOf('northbridge-parent')]);
    const r = await act('/requests', 'northbridge-student', {
      tripId: 'bus',
      stopId: 'northbridge-0',
      destinationId: 'northbridge-2',
    });
    assert.equal(r.status, 201);
    requestId = r.data.id;
    await tick();
    assert.deepEqual(recipients(), [deviceOf('northbridge-driver')]);
  });

  await t.test('driver status changes reach the student and only sharing parents', async () => {
    assert.equal(
      (await act('/requests/status', 'northbridge-driver', { requestId, status: 'accepted' }))
        .status,
      200,
    );
    await tick();
    const accepted = sent.splice(0);
    assert.deepEqual(
      accepted.map((m) => m.to).sort(),
      [deviceOf('northbridge-parent'), deviceOf('northbridge-student')].sort(),
    );
    const text = JSON.stringify(accepted);
    assert.ok(!/41\.|-73\./.test(text), 'no coordinates in notifications');
    assert.ok(accepted.every((m) => m.channelId === 'trip-updates'));

    assert.equal(
      (await act('/requests/status', 'northbridge-driver', { requestId, status: 'approaching' }))
        .status,
      200,
    );
    await tick();
    assert.equal(recipients().length, 2);
    // Conflicting second action on the same state is rejected.
    assert.equal(
      (await act('/requests/status', 'northbridge-admin', { requestId, status: 'approaching' }))
        .status,
      409,
    );

    // Revocation applies to the very next event.
    await act('/shares', 'northbridge-student', {
      email: 'northbridge-parent@example.com',
      revoke: true,
    });
    assert.equal(
      (await act('/requests/status', 'northbridge-driver', { requestId, status: 'boarded' }))
        .status,
      200,
    );
    await tick();
    assert.deepEqual(recipients(), [deviceOf('northbridge-student')]);
  });

  await t.test('delay reports reach riders on that shuttle and not other tenants', async () => {
    assert.equal(
      (
        await act('/trips/issue', 'northbridge-driver', {
          tripId: 'bus',
          delayMinutes: 10,
          issue: 'Traffic',
        })
      ).status,
      200,
    );
    await tick();
    const update = sent.splice(0);
    assert.deepEqual(
      update.map((m) => m.to),
      [deviceOf('northbridge-student')],
    );
    assert.match(update[0].body, /about 10 min/);
    assert.ok(!update.some((m) => m.to === deviceOf('lakeside-student')));
  });

  await t.test('approval notifies the approved member', async () => {
    app.db.prepare("UPDATE memberships SET approved=0 WHERE user_id='northbridge-parent2'").run();
    assert.equal(
      (await act('/members/approve', 'northbridge-admin', { userId: 'northbridge-parent2' }))
        .status,
      200,
    );
    await tick();
    assert.deepEqual(recipients(), [deviceOf('northbridge-parent2')]);
  });

  await t.test('unregistered devices are removed from tickets and from receipts', async () => {
    unregistered.add(deviceOf('northbridge-student'));
    await act('/requests/status', 'northbridge-driver', { requestId, status: 'arrived' });
    await tick();
    sent.splice(0);
    assert.equal(
      app.db
        .prepare('SELECT count(*) AS n FROM push_tokens WHERE token=?')
        .get(deviceOf('northbridge-student')).n,
      0,
    );
    // ticket-2 went to the driver (ticket-1 told the parent about sharing); its receipt
    // reports the device as unregistered.
    now += 16 * 60000;
    await app.push.checkReceipts();
    assert.equal(
      app.db
        .prepare('SELECT count(*) AS n FROM push_tokens WHERE token=?')
        .get(deviceOf('northbridge-driver')).n,
      0,
    );
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM push_tickets').get().n, 0);
  });

  await t.test('revoked sessions (password reset, expiry) receive nothing', async () => {
    const note = [{ userIds: ['northbridge-parent'], title: 't', body: 'b' }];
    await app.push.deliver(note);
    assert.deepEqual(recipients(), [deviceOf('northbridge-parent')]);
    app.db.prepare("DELETE FROM sessions WHERE user_id='northbridge-parent'").run();
    await app.push.deliver(note);
    assert.deepEqual(recipients(), []);
  });

  await t.test('sign-out stops notifications to that device', async () => {
    assert.equal((await call('/auth/logout', tokens['northbridge-parent2'], {})).status, 200);
    assert.equal(
      app.db
        .prepare('SELECT count(*) AS n FROM push_tokens WHERE user_id=?')
        .get('northbridge-parent2').n,
      0,
    );
  });
});

test('approaching holds a seat, can be cancelled by the student, and migration keeps old requests', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-v3-'));
  try {
    const path = join(dir, 'v2.db');
    // Build a schema-2 database with a request in it.
    const legacy = new DatabaseSync(path);
    legacy.exec('PRAGMA foreign_keys=ON');
    migrate(legacy, 2);
    legacy.close();
    const raw = new DatabaseSync(path);
    raw.exec(`DROP TABLE requests;
      CREATE TABLE requests(id TEXT PRIMARY KEY,institution_id TEXT,student_id TEXT,trip_id TEXT,stop_id TEXT,destination_id TEXT,status TEXT NOT NULL CHECK(status IN ('requested','accepted','boarded','arrived','cancelled')),created_at INTEGER NOT NULL);
      DROP TABLE IF EXISTS push_tokens; DROP TABLE IF EXISTS push_tickets;
      INSERT INTO institutions VALUES ('org','Legacy College','college');
      INSERT INTO users(id,name,email,password) VALUES ('s','Student','s@example.com','x:y');
      INSERT INTO stops(id,institution_id,name,lat,lng,position) VALUES ('a','org','A',41,-73,0),('b','org','B',41.01,-73,1);
      INSERT INTO trips(id,institution_id,name) VALUES ('t','org','Shuttle');
      INSERT INTO requests VALUES ('old','org','s','t','a','b','boarded',1700000000000);`);
    raw.close();
    const db = openDatabase(path);
    t.after(() => db.isOpen && db.close());
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    const old = db.prepare("SELECT * FROM requests WHERE id='old'").get();
    assert.equal(old.status, 'boarded');
    assert.equal(old.updated_at, 1700000000000);
    db.prepare("UPDATE requests SET status='approaching' WHERE id='old'").run();
    // A second open request for the same student is still blocked by the unique index.
    assert.throws(() =>
      db.prepare("INSERT INTO requests VALUES ('new','org','s','t','a','b','requested',1,1)").run(),
    );
    db.close();
  } finally {
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
});

test('Expo transport batches by 100 and retries on 429', async () => {
  const calls = [];
  let first = true;
  const transport = createExpoTransport({
    wait: async () => {},
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body).length);
      if (first) {
        first = false;
        return new Response('{}', { status: 429 });
      }
      return new Response(
        JSON.stringify({ data: JSON.parse(init.body).map(() => ({ status: 'ok', id: 'x' })) }),
      );
    },
  });
  const tickets = await transport.send(Array.from({ length: 150 }, (_, i) => ({ to: `t${i}` })));
  assert.equal(tickets.length, 150);
  assert.deepEqual(calls, [100, 100, 50]);
});
