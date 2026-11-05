import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { hashPassword } from '../server/security.mjs';
import { seedInstitutions } from './fixtures.mjs';

test('authenticated multi-institution pickup lifecycle and permission boundaries', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-'));
  const { server, db, realtime } = createApp({ dbPath: join(dir, 'test.db') });
  seedInstitutions(db);
  const pass = 'a-long-pilot-password';
  for (const org of ['northbridge', 'lakeside'])
    for (const role of ['student', 'driver', 'parent', 'admin']) {
      const id = `${org}-${role}`;
      db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(
        id,
        role,
        `${id}@example.com`,
        hashPassword(pass),
      );
      db.prepare('INSERT INTO memberships VALUES (?,?,?,1)').run(id, org, role);
    }
  db.prepare(
    "INSERT INTO trips(id,institution_id,driver_id,name,capacity,active) VALUES ('bus','northbridge','northbridge-driver','Loop',1,1)",
  ).run();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    realtime.close();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function call(path, token, body) {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  }
  async function login(org, role) {
    const r = await call('/auth/login', null, {
      email: `${org}-${role}@example.com`,
      password: pass,
    });
    assert.equal(r.status, 200);
    return r.data.token;
  }
  const student = await login('northbridge', 'student'),
    driver = await login('northbridge', 'driver'),
    parent = await login('northbridge', 'parent'),
    admin = await login('northbridge', 'admin'),
    outsider = await login('lakeside', 'driver');
  const snapshot = (token) => call('/snapshot?institutionId=northbridge', token);
  const action = (path, token, body) =>
    call(path, token, { institutionId: 'northbridge', ...body });
  await t.test('requires a session and rejects tenant hopping', async () => {
    assert.equal((await snapshot(null)).status, 401);
    assert.equal((await snapshot(outsider)).status, 403);
    assert.equal(
      (
        await call('/auth/register', null, {
          email: 'evil@example.com',
          password: pass,
          name: 'Evil',
          role: 'admin',
          institutionId: 'northbridge',
        })
      ).status,
      400,
    );
  });
  let requestId;
  await t.test('creates a request once and hides riders from unlinked parents', async () => {
    assert.equal(
      (
        await action('/requests', student, {
          tripId: 'bus',
          stopId: 'lakeside-0',
          destinationId: 'northbridge-3',
        })
      ).status,
      400,
    );
    const r = await action('/requests', student, {
      tripId: 'bus',
      stopId: 'northbridge-0',
      destinationId: 'northbridge-3',
    });
    assert.equal(r.status, 201);
    requestId = r.data.id;
    assert.equal(
      (
        await action('/requests', student, {
          tripId: 'bus',
          stopId: 'northbridge-0',
          destinationId: 'northbridge-3',
        })
      ).status,
      409,
    );
    assert.equal((await snapshot(parent)).data.requests.length, 0);
  });
  await t.test('requires assignment and validates GPS and lifecycle transitions', async () => {
    assert.equal(
      (
        await action('/trips/location', student, {
          tripId: 'bus',
          capturedAt: Date.now(),
          lat: 41,
          lng: -73,
          accuracy: 10,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await action('/trips/location', outsider, {
          tripId: 'bus',
          capturedAt: Date.now(),
          lat: 41,
          lng: -73,
          accuracy: 10,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await action('/trips/location', driver, {
          tripId: 'bus',
          capturedAt: Date.now(),
          lat: 41,
          lng: -73,
          accuracy: 150,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action('/trips/location', driver, {
          tripId: 'bus',
          capturedAt: Date.now(),
          lat: 41,
          lng: -73,
          accuracy: 10,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action('/trips/location', driver, {
          tripId: 'bus',
          capturedAt: Date.now() - 60000,
          lat: 41,
          lng: -73,
          accuracy: 10,
        })
      ).status,
      400,
    );
    assert.equal(
      (await action('/requests/status', student, { requestId, status: 'boarded' })).status,
      403,
    );
    assert.equal(
      (await action('/requests/status', driver, { requestId, status: 'arrived' })).status,
      409,
    );
  });
  await t.test('student consent grants and revokes parent access', async () => {
    assert.equal(
      (await action('/shares', student, { email: 'northbridge-parent@example.com' })).status,
      200,
    );
    assert.equal((await snapshot(parent)).data.requests.length, 1);
    assert.equal(
      (await snapshot(parent)).data.trips.length,
      0,
      'unaccepted request does not expose vehicle location',
    );
    assert.equal(
      (await action('/requests/status', driver, { requestId, status: 'accepted' })).status,
      200,
    );
    assert.equal((await snapshot(parent)).data.trips.length, 1);
    assert.equal(
      (await action('/shares', student, { email: 'northbridge-parent@example.com', revoke: true }))
        .status,
      200,
    );
    const result = (await snapshot(parent)).data;
    assert.equal(result.requests.length, 0);
    assert.equal(result.trips.length, 0);
  });
  await t.test(
    'capacity, onboard protection, incident reporting, and trip completion',
    async () => {
      db.prepare("INSERT INTO users VALUES ('second','Second Student','second@example.com',?)").run(
        hashPassword(pass),
      );
      db.prepare("INSERT INTO memberships VALUES ('second','northbridge','student',1)").run();
      const second = (
        await call('/auth/login', null, { email: 'second@example.com', password: pass })
      ).data.token;
      const other = await action('/requests', second, {
        tripId: 'bus',
        stopId: 'northbridge-1',
        destinationId: 'northbridge-3',
      });
      assert.equal(other.status, 201);
      assert.equal(
        (await action('/requests/status', driver, { requestId: other.data.id, status: 'accepted' }))
          .status,
        409,
      );
      assert.equal(
        (
          await action('/requests/status', driver, {
            requestId: other.data.id,
            status: 'cancelled',
          })
        ).status,
        200,
      );
      assert.equal(
        (await action('/requests/status', driver, { requestId, status: 'boarded' })).status,
        200,
      );
      assert.equal(
        (await action('/requests/status', student, { requestId, status: 'cancelled' })).status,
        403,
      );
      assert.equal(
        (await action('/trips/service', driver, { tripId: 'bus', active: false })).status,
        409,
      );
      assert.equal(
        (
          await action('/trips/issue', driver, {
            tripId: 'bus',
            delayMinutes: 7,
            issue: 'Road closure. Please wait at your stop.',
          })
        ).status,
        200,
      );
      assert.equal((await snapshot(student)).data.trips[0].delay_minutes, 7);
      assert.equal(
        (await action('/requests/status', driver, { requestId, status: 'arrived' })).status,
        200,
      );
      assert.equal(
        (await action('/trips/service', driver, { tripId: 'bus', active: false })).status,
        200,
      );
    },
  );
  await t.test('new memberships cannot self-approve or access trips', async () => {
    const r = await call('/auth/register', null, {
      email: 'pending@example.com',
      password: pass,
      name: 'Pending Driver',
      role: 'driver',
      institutionId: 'northbridge',
    });
    assert.equal(r.status, 200);
    const pending = r.data.token;
    const snap = (await snapshot(pending)).data;
    assert.equal(snap.approved, false);
    assert.equal(snap.trips.length, 0);
    assert.equal(
      (await action('/trips/service', pending, { tripId: 'bus', active: true })).status,
      403,
    );
    assert.equal((await action('/members/approve', student, { userId: snap.user.id })).status, 403);
    assert.equal((await action('/members/approve', admin, { userId: snap.user.id })).status, 200);
    assert.equal((await snapshot(pending)).data.approved, true);
    assert.equal(
      (await action('/trips/service', pending, { tripId: 'bus', active: true })).status,
      403,
      'approved driver still needs an assigned vehicle',
    );
  });
  await t.test('logout invalidates the stored session', async () => {
    assert.equal((await call('/auth/logout', student, {})).status, 200);
    assert.equal((await snapshot(student)).status, 401);
  });
});
