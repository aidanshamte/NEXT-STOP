// Map marker data from the server: the vehicle type is only what an administrator saved, and a
// GPS heading is kept only when the driver's device reported a valid one while moving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { hashPassword } from '../server/security.mjs';
import { seedInstitutions } from './fixtures.mjs';

test('vehicle type and GPS heading', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-markers-'));
  const { server, db, realtime } = createApp({ dbPath: join(dir, 'test.db') });
  seedInstitutions(db);
  const pass = 'a-long-marker-password';
  for (const org of ['northbridge', 'lakeside'])
    for (const role of ['student', 'driver', 'admin']) {
      const id = `${org}-${role}`;
      db.prepare('INSERT INTO users(id,name,email,password) VALUES (?,?,?,?)').run(
        id,
        role,
        `${id}@example.com`,
        hashPassword(pass),
      );
      db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(id);
      db.prepare('INSERT INTO memberships VALUES (?,?,?,1)').run(id, org, role);
    }
  db.prepare(
    "INSERT INTO trips(id,institution_id,driver_id,name,capacity,active) VALUES ('bus','northbridge','northbridge-driver','Loop',10,1)",
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
  const login = async (org, role) =>
    (await call('/auth/login', null, { email: `${org}-${role}@example.com`, password: pass })).data
      .token;
  const student = await login('northbridge', 'student'),
    driver = await login('northbridge', 'driver'),
    admin = await login('northbridge', 'admin'),
    outsider = await login('lakeside', 'admin');
  const action = (path, token, body) =>
    call(path, token, { institutionId: 'northbridge', ...body });
  const bus = async (token = student) =>
    (await call('/snapshot?institutionId=northbridge', token)).data.trips.find(
      (trip) => trip.id === 'bus',
    );

  await t.test('a new vehicle has no type until an administrator sets one', async () => {
    assert.equal((await bus()).vehicle_type, '');
    for (const token of [student, driver])
      assert.equal(
        (await action('/trips/vehicle', token, { tripId: 'bus', capacity: 10, vehicleType: 'bus' }))
          .status,
        403,
      );
    assert.equal(
      (
        await call('/trips/vehicle', outsider, {
          institutionId: 'lakeside',
          tripId: 'bus',
          capacity: 10,
          vehicleType: 'bus',
        })
      ).status,
      404,
    );
    assert.equal(
      (await action('/trips/vehicle', admin, { tripId: 'bus', capacity: 10, vehicleType: 'coach' }))
        .status,
      400,
    );
    assert.equal(
      (
        await action('/trips/vehicle', admin, {
          tripId: 'bus',
          capacity: 10,
          vehicleType: 'shuttle',
        })
      ).status,
      200,
    );
    assert.equal((await bus()).vehicle_type, 'shuttle');
    // Saving seats without a type (older app versions) keeps the saved type.
    assert.equal(
      (await action('/trips/vehicle', admin, { tripId: 'bus', capacity: 12 })).status,
      200,
    );
    assert.equal((await bus()).vehicle_type, 'shuttle');
    assert.equal(
      (await action('/trips/vehicle', admin, { tripId: 'bus', capacity: 10, vehicleType: '' }))
        .status,
      200,
    );
    assert.equal((await bus()).vehicle_type, '');
  });

  await t.test('the type can be saved when a vehicle is created', async () => {
    const make = (vehicleType) =>
      action('/trips', admin, {
        name: `New ${vehicleType}`,
        driverId: 'northbridge-driver',
        capacity: 20,
        vehicleType,
      });
    assert.equal((await make('van')).status, 400);
    const r = await make('bus');
    assert.equal(r.status, 201);
    const created = (await call('/snapshot?institutionId=northbridge', admin)).data.trips.find(
      (trip) => trip.id === r.data.id,
    );
    assert.equal(created.vehicle_type, 'bus');
  });

  await t.test('heading is kept only when valid and moving, and ends with service', async () => {
    let at = Date.now() - 20000;
    const fix = (extra) =>
      action('/trips/location', driver, {
        tripId: 'bus',
        capturedAt: (at += 1000),
        lat: 41,
        lng: -73,
        accuracy: 10,
        ...extra,
      });
    assert.equal((await fix({ heading: 87.5, speed: 6 })).status, 200);
    assert.equal((await bus()).heading, 87.5);
    for (const extra of [
      {},
      { heading: 87.5 },
      { heading: 87.5, speed: 0.4 },
      { heading: -1, speed: 6 },
      { heading: 360, speed: 6 },
      { heading: 'north', speed: 6 },
      { heading: null, speed: null },
    ]) {
      await fix({ heading: 10, speed: 6 });
      assert.equal((await fix(extra)).status, 200);
      assert.equal((await bus()).heading, null, JSON.stringify(extra));
    }
    await fix({ heading: 10, speed: 6 });
    assert.equal(
      (await action('/trips/service', driver, { tripId: 'bus', active: false })).status,
      200,
    );
    const ended = await bus();
    assert.deepEqual([ended.heading, ended.lat, ended.updated_at], [null, null, null]);
  });
});
