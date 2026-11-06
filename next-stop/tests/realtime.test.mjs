import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.mjs';
import { hashPassword } from '../server/security.mjs';

test('real WebSocket clients receive tenant-scoped events and reread current GPS and pickup state', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-live-'));
  let app = createApp({ dbPath: join(dir, 'live.db') });
  const password = 'test-only-long-password';
  for (const org of ['one', 'two']) {
    app.db
      .prepare('INSERT INTO institutions VALUES (?,?,?)')
      .run(org, 'Institution ' + org, 'college');
    for (const role of ['student', 'driver', 'admin']) {
      const id = org + '-' + role;
      app.db
        .prepare('INSERT INTO users(id,name,email,password) VALUES (?,?,?,?)')
        .run(id, role, id + '@example.test', hashPassword(password));
      app.db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(id);
      app.db.prepare('INSERT INTO memberships VALUES (?,?,?,1)').run(id, org, role);
    }
  }
  assert.equal(
    app.db.prepare('SELECT count(*) AS n FROM stops').get().n,
    0,
    'no fake stops inserted by startup',
  );
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const base = 'http://127.0.0.1:' + port;
  const clients = [];
  let closed = false;
  t.after(async () => {
    if (!closed) {
      app.realtime.close();
      await new Promise((resolve) => app.server.close(resolve));
      app.db.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });
  async function call(path, token, body) {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  }
  async function login(org, role) {
    const result = await call('/auth/login', null, {
      email: org + '-' + role + '@example.test',
      password,
    });
    assert.equal(result.status, 200);
    return result.data.token;
  }
  const admin = await login('one', 'admin'),
    driver = await login('one', 'driver'),
    student = await login('one', 'student'),
    other = await login('two', 'student');
  async function subscribe(token, institutionId) {
    const socket = new WebSocket('ws://127.0.0.1:' + port + '/realtime', {
      origin: 'http://127.0.0.1:' + port,
    });
    clients.push(socket);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('No realtime authentication response')), 4000);
      socket.once('open', () =>
        socket.send(JSON.stringify({ type: 'subscribe', token, institutionId })),
      );
      socket.once('message', (raw) => {
        clearTimeout(timeout);
        assert.equal(JSON.parse(raw).type, 'ready');
        resolve();
      });
      socket.once('error', reject);
    });
    return socket;
  }
  const riderSocket = await subscribe(student, 'one'),
    otherSocket = await subscribe(other, 'two');
  let otherEvents = 0;
  otherSocket.on('message', () => otherEvents++);
  function nextEvent(socket) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('No live event received')), 4000);
      socket.once('message', (raw) => {
        clearTimeout(timeout);
        const event = JSON.parse(raw);
        assert.deepEqual(
          event,
          { type: 'invalidate' },
          'event contains no rider identifiers or GPS',
        );
        resolve(event);
      });
    });
  }
  const first = nextEvent(riderSocket);
  const stop = await call('/stops', admin, {
    institutionId: 'one',
    name: 'Actual stop',
    lat: 41.16,
    lng: -73.25,
  });
  assert.equal(stop.status, 201);
  await first;
  const secondStop = await call('/stops', admin, {
    institutionId: 'one',
    name: 'Actual destination',
    lat: 41.17,
    lng: -73.24,
  });
  assert.equal(secondStop.status, 201);
  assert.equal(
    (
      await call('/stops', student, {
        institutionId: 'one',
        name: 'Not authorized',
        lat: 41,
        lng: -73,
      })
    ).status,
    403,
  );
  const assigned = await call('/trips', admin, {
    institutionId: 'one',
    name: 'Vehicle 17',
    driverId: 'one-driver',
    capacity: 12,
  });
  assert.equal(assigned.status, 201);
  const tripId = assigned.data.id;
  await call('/trips/service', driver, { institutionId: 'one', tripId, active: true });
  // Drain previous invalidations, then observe a fresh GPS publication on two live sockets.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const gpsEvent = nextEvent(riderSocket);
  assert.equal(
    (
      await call('/trips/location', driver, {
        institutionId: 'one',
        tripId,
        lat: 41.165,
        lng: -73.245,
        accuracy: 6,
        capturedAt: Date.now(),
      })
    ).status,
    200,
  );
  await gpsEvent;
  const state = await call('/snapshot?institutionId=one', student);
  assert.equal(state.data.trips[0].lat, 41.165);
  const driverSocket = await subscribe(driver, 'one');
  const pickupEvent = nextEvent(driverSocket);
  const pickup = await call('/requests', student, {
    institutionId: 'one',
    tripId,
    stopId: stop.data.id,
    destinationId: secondStop.data.id,
  });
  assert.equal(pickup.status, 201);
  await pickupEvent;
  assert.equal(
    (await call('/snapshot?institutionId=one', driver)).data.requests[0].id,
    pickup.data.id,
  );
  assert.equal(otherEvents, 0, 'other institution received no events');
  const bad = new WebSocket('ws://127.0.0.1:' + port + '/realtime');
  await new Promise((resolve) => {
    bad.once('open', () =>
      bad.send(JSON.stringify({ type: 'subscribe', token: student, institutionId: 'two' })),
    );
    bad.once('close', (code) => {
      assert.equal(code, 4001);
      resolve();
    });
  });
  // Persistence survives stopping and recreating the actual server app.
  app.realtime.close();
  await new Promise((resolve) => app.server.close(resolve));
  app.db.close();
  closed = true;
  const reopened = createApp({ dbPath: join(dir, 'live.db') });
  assert.equal(reopened.db.prepare('SELECT lat FROM trips WHERE id=?').get(tripId).lat, 41.165);
  assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM requests').get().n, 1);
  reopened.realtime.close();
  reopened.db.close();
});
test('a new server starts completely empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-empty-'));
  const app = createApp({ dbPath: join(dir, 'empty.db') });
  try {
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM institutions').get().n, 0);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM trips').get().n, 0);
  } finally {
    app.realtime.close();
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
