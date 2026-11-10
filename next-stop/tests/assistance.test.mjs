// Boarding assistance on the pickup request: who may see and change it, acknowledgement by the
// driver assigned now, renewed acknowledgement after changes and handovers, staff routing for
// "unable" and for vehicles without confirmed accessibility, cancellation, retries, and privacy
// of notes in notifications, logs and parent views.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { hashPassword } from '../server/security.mjs';
import { vehicleAttention } from '../server/assistance.mjs';
import { seedInstitutions } from './fixtures.mjs';

const NOTE = 'Please lower the step, I use a walker';

test('vehicle attention uses only recorded accessibility', () => {
  const t = (access_ramp, access_space) => ({ access_ramp, access_space });
  assert.equal(vehicleAttention(t('available', 'available'), ['ramp']), '');
  assert.equal(vehicleAttention(t('available', 'unknown'), ['ramp']), 'vehicle_unknown');
  assert.equal(vehicleAttention(t('unavailable', 'available'), ['ramp']), 'vehicle_unavailable');
  assert.equal(vehicleAttention(t('unknown', 'unknown'), ['extra_time']), '');
  // A vehicle type or icon carries no accessibility: nothing but the two fields is read.
  assert.equal(vehicleAttention({ vehicle_type: 'bus' }, ['ramp']), 'vehicle_unknown');
});

test('boarding assistance', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-assist-'));
  const sent = [];
  const logs = [];
  const transport = {
    async send(messages) {
      sent.push(...messages);
      return messages.map((m, i) => ({ status: 'ok', id: `t${sent.length}-${i}` }));
    },
    async receipts() {
      return {};
    },
  };
  const { server, db, realtime } = createApp({
    dbPath: join(dir, 'test.db'),
    pushTransport: transport,
    log: (record) => logs.push(record),
  });
  seedInstitutions(db);
  const pass = 'a-long-assist-password';
  const people = [
    ['northbridge', 'student', 'student'],
    ['northbridge', 'student2', 'student'],
    ['northbridge', 'driver', 'driver'],
    ['northbridge', 'driver2', 'driver'],
    ['northbridge', 'parent', 'parent'],
    ['northbridge', 'admin', 'admin'],
    ['lakeside', 'admin', 'admin'],
    ['lakeside', 'driver', 'driver'],
  ];
  for (const [org, name, role] of people) {
    const id = `${org}-${name}`;
    db.prepare('INSERT INTO users(id,name,email,password) VALUES (?,?,?,?)').run(
      id,
      name,
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
  const tok = {};
  for (const [org, name] of people) {
    const id = `${org}-${name}`;
    tok[id] = (
      await call('/auth/login', null, { email: `${id}@example.com`, password: pass })
    ).data.token;
    await call('/push/register', tok[id], {
      token: `ExponentPushToken[${id.replace(/[^a-z0-9]/g, '')}xxxxxxxx]`,
      platform: 'android',
    });
  }
  const student = tok['northbridge-student'],
    student2 = tok['northbridge-student2'],
    driver = tok['northbridge-driver'],
    driver2 = tok['northbridge-driver2'],
    parent = tok['northbridge-parent'],
    admin = tok['northbridge-admin'],
    outsider = tok['lakeside-admin'],
    outsiderDriver = tok['lakeside-driver'];
  const act = (path, token, body) => call(path, token, { institutionId: 'northbridge', ...body });
  const snap = async (token) => (await call('/snapshot?institutionId=northbridge', token)).data;
  const mine = async (token, id) =>
    (await snap(token)).assistance?.find((a) => a.request_id === id);
  const row = (id) => db.prepare('SELECT * FROM request_assistance WHERE request_id=?').get(id);
  let requestId;

  await t.test('validated options only; no free-form medical fields', async () => {
    const make = (assistance) =>
      act('/requests', student, {
        tripId: 'bus',
        stopId: 'northbridge-0',
        destinationId: 'northbridge-3',
        assistance,
      });
    assert.equal((await make({ needs: ['diagnosis'] })).status, 400);
    assert.equal((await make({ needs: ['ramp', 'ramp'] })).status, 400);
    assert.equal((await make({ needs: ['other'], note: 'x'.repeat(141) })).status, 400);
    assert.equal(db.prepare('SELECT count(*) AS n FROM requests').get().n, 0, 'nothing created');
    const r = await make({ needs: ['ramp', 'other'], note: `  ${NOTE}\n` });
    assert.equal(r.status, 201);
    requestId = r.data.id;
    const a = await mine(student, requestId);
    assert.deepEqual(
      [a.needs, a.note, a.version, a.status, a.attention],
      [['ramp', 'other'], NOTE, 1, 'pending', 'vehicle_unknown'],
    );
  });

  await t.test('visible to the rider, the assigned driver and staff only', async () => {
    assert.ok(await mine(driver, requestId));
    assert.ok(await mine(admin, requestId));
    assert.equal(await mine(driver2, requestId), undefined, 'unassigned driver');
    assert.equal(await mine(student2, requestId), undefined, 'another rider');
    assert.equal(
      (await act('/shares', student, { email: 'northbridge-parent@example.com' })).status,
      200,
    );
    const p = await snap(parent);
    assert.equal(p.requests.length, 1, 'the parent follows the journey');
    assert.deepEqual(p.assistance, [], 'but not the assistance details');
    // Other institutions cannot reach it at all.
    for (const token of [outsider, outsiderDriver])
      assert.equal(
        (
          await call('/requests/assistance/ack', token, {
            institutionId: 'lakeside',
            requestId,
            version: 1,
          })
        ).status,
        404,
      );
    assert.equal(
      (await act('/requests/assistance/ack', outsider, { requestId, version: 1 })).status,
      403,
    );
  });

  await t.test('only the rider edits; only the assigned driver acknowledges', async () => {
    const edit = (token) =>
      act('/requests/assistance', token, {
        requestId,
        baseVersion: 1,
        assistance: { needs: ['extra_time'] },
      });
    assert.equal((await edit(student2)).status, 404);
    assert.equal((await edit(driver)).status, 403);
    assert.equal((await edit(admin)).status, 403);
    assert.equal(
      (await act('/requests/assistance/ack', driver2, { requestId, version: 1 })).status,
      404,
    );
    assert.equal(
      (await act('/requests/assistance/ack', admin, { requestId, version: 1 })).status,
      403,
    );
    assert.equal(
      (await act('/requests/assistance/ack', student, { requestId, version: 1 })).status,
      403,
    );
  });

  await t.test('acknowledgement is per version; stale acknowledgements are refused', async () => {
    assert.equal(
      (await act('/requests/assistance/ack', driver, { requestId, version: 0 })).status,
      409,
    );
    assert.equal((await act('/requests/assistance/ack', driver, { requestId })).status, 409);
    const ok = await act('/requests/assistance/ack', driver, { requestId, version: 1 });
    assert.deepEqual([ok.status, ok.data.changed], [200, true]);
    // A retry of the same acknowledgement (lost response) is harmless.
    const again = await act('/requests/assistance/ack', driver, { requestId, version: 1 });
    assert.deepEqual([again.status, again.data.changed], [200, false]);
    const a = await mine(student, requestId);
    assert.equal(a.status, 'acknowledged');
    assert.ok(a.ack_at);
    // Acknowledgement is separate from pickup acceptance and journey status.
    assert.equal(
      (await snap(student)).requests.find((r) => r.id === requestId).status,
      'requested',
    );
  });

  await t.test('changed needs require renewed acknowledgement; duplicates are safe', async () => {
    const save = (baseVersion, needs) =>
      act('/requests/assistance', student, { requestId, baseVersion, assistance: { needs } });
    const r = await save(1, ['extra_time']);
    assert.deepEqual([r.status, r.data.version, r.data.changed], [200, 2, true]);
    // The same submission again (double tap, retry after a lost response) changes nothing.
    const dup = await save(1, ['extra_time']);
    assert.deepEqual([dup.status, dup.data.version, dup.data.changed], [200, 2, false]);
    // A different change based on an old version is refused, not merged.
    assert.equal((await save(1, ['ramp'])).status, 409);
    const a = await mine(driver, requestId);
    assert.deepEqual([a.status, a.version, a.note, a.attention], ['pending', 2, '', '']);
    assert.equal(
      (await act('/requests/assistance/ack', driver, { requestId, version: 1 })).status,
      409,
    );
    assert.equal(
      (await act('/requests/assistance/ack', driver, { requestId, version: 2 })).status,
      200,
    );
  });

  await t.test('a new driver must acknowledge; the former driver loses access', async () => {
    assert.equal(
      (await act('/trips/assign', admin, { tripId: 'bus', driverId: 'northbridge-driver2' }))
        .status,
      200,
    );
    assert.equal((await mine(student, requestId)).status, 'pending');
    assert.equal(await mine(driver, requestId), undefined, 'former driver no longer sees it');
    assert.equal(
      (await act('/requests/assistance/ack', driver, { requestId, version: 2 })).status,
      404,
    );
    assert.equal(
      (await act('/requests/assistance/ack', driver2, { requestId, version: 2 })).status,
      200,
    );
    assert.equal((await mine(student, requestId)).status, 'acknowledged');
  });

  await t.test('vehicle accessibility routes ramp requests to staff', async () => {
    const save = (baseVersion, needs) =>
      act('/requests/assistance', student, { requestId, baseVersion, assistance: { needs } });
    assert.equal((await save(2, ['ramp'])).status, 200);
    assert.equal((await mine(admin, requestId)).attention, 'vehicle_unknown');
    const vehicle = (accessRamp, accessSpace) =>
      act('/trips/vehicle', admin, { tripId: 'bus', capacity: 10, accessRamp, accessSpace });
    assert.equal((await vehicle('yes', 'available')).status, 400);
    assert.equal((await vehicle('available', 'available')).status, 200);
    assert.equal((await mine(admin, requestId)).attention, '', 'confirmed accessible');
    const trip = (await snap(student)).trips.find((x) => x.id === 'bus');
    assert.deepEqual([trip.access_ramp, trip.access_space], ['available', 'available']);
    assert.equal((await vehicle('unavailable', 'available')).status, 200);
    assert.equal((await mine(student, requestId)).attention, 'vehicle_unavailable');
    // Not dropped: still pending for the driver and visible to staff and the rider.
    assert.equal((await mine(driver2, requestId)).status, 'pending');
  });

  await t.test('"unable to accommodate" alerts staff; staff resolve with a message', async () => {
    const version = (await mine(student, requestId)).version;
    assert.equal(
      (await act('/requests/assistance/unable', driver2, { requestId, version: version - 1 }))
        .status,
      409,
    );
    assert.equal(
      (await act('/requests/assistance/unable', driver2, { requestId, version })).status,
      200,
    );
    assert.equal(
      (await act('/requests/assistance/unable', driver2, { requestId, version })).data.changed,
      false,
    );
    let a = await mine(student, requestId);
    assert.deepEqual([a.status, a.attention], ['unable', 'driver_unable']);
    const resolve = (token, body) =>
      act('/requests/assistance/resolve', token, { requestId, version, ...body });
    assert.equal((await resolve(driver2, { outcome: 'resolved', message: 'x' })).status, 403);
    assert.equal((await resolve(admin, { outcome: 'resolved', message: '' })).status, 400);
    assert.equal((await resolve(admin, { outcome: 'guess', message: 'Hi' })).status, 400);
    const msg = 'A lift-equipped van is being sent instead.';
    assert.equal((await resolve(admin, { outcome: 'driver_review', message: msg })).status, 200);
    a = await mine(student, requestId);
    assert.deepEqual([a.status, a.attention, a.staff_note], ['pending', '', msg]);
    assert.equal(
      (await resolve(admin, { outcome: 'resolved', message: msg })).status,
      409,
      'nothing left to resolve',
    );
  });

  await t.test('withdrawing assistance, and no edits after boarding', async () => {
    const version = (await mine(student, requestId)).version;
    const w = await act('/requests/assistance', student, {
      requestId,
      baseVersion: version,
      assistance: { needs: [] },
    });
    assert.equal(w.status, 200);
    assert.equal(await mine(student, requestId), undefined);
    assert.deepEqual([row(requestId).status, row(requestId).note], ['withdrawn', '']);
    const re = await act('/requests/assistance', student, {
      requestId,
      baseVersion: version + 1,
      assistance: { needs: ['other'], note: NOTE },
    });
    assert.equal(re.status, 200);
    assert.equal((await mine(student, requestId)).status, 'pending');
  });

  await t.test('cancelling the pickup cancels its assistance and erases the note', async () => {
    assert.equal(
      (await act('/requests/status', student, { requestId, status: 'cancelled' })).status,
      200,
    );
    assert.deepEqual(
      [row(requestId).status, row(requestId).note, row(requestId).staff_note],
      ['cancelled', '', ''],
    );
    assert.equal(await mine(admin, requestId), undefined);
    assert.equal(
      (
        await act('/requests/assistance', student, {
          requestId,
          baseVersion: 4,
          assistance: { needs: ['ramp'] },
        })
      ).status,
      409,
    );
  });

  await t.test('assistance ends with the ride; edits stop at boarding', async () => {
    const r = await act('/requests', student, {
      tripId: 'bus',
      stopId: 'northbridge-0',
      destinationId: 'northbridge-2',
      assistance: { needs: ['other'], note: NOTE },
    });
    assert.equal(r.status, 201);
    const id = r.data.id;
    for (const status of ['accepted', 'boarded'])
      assert.equal((await act('/requests/status', driver2, { requestId: id, status })).status, 200);
    assert.equal(
      (
        await act('/requests/assistance', student, {
          requestId: id,
          baseVersion: 1,
          assistance: { needs: [] },
        })
      ).status,
      409,
    );
    assert.equal(
      (await act('/requests/assistance/ack', driver2, { requestId: id, version: 1 })).status,
      409,
    );
    assert.equal(
      (await act('/requests/status', driver2, { requestId: id, status: 'arrived' })).status,
      200,
    );
    assert.deepEqual([row(id).status, row(id).note], ['closed', '']);
  });

  await t.test('notes never reach notifications or request logs', async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const text = JSON.stringify(sent);
    assert.ok(sent.some((m) => m.title === 'Pickup details updated'));
    assert.ok(sent.some((m) => m.title === 'Staff attention needed'));
    assert.doesNotMatch(text, /walker|lower the step|ramp|lift|extra time|assistance/i);
    // Staff alerts go to administrators only.
    const staff = sent.filter((m) => m.title === 'Staff attention needed').map((m) => m.to);
    assert.ok(staff.length && staff.every((to) => to.includes('northbridgeadmin')));
    assert.doesNotMatch(JSON.stringify(logs), /walker|lower the step/i);
  });

  await t.test('deleting the rider account removes their assistance', async () => {
    assert.equal((await call('/account/delete', student, { password: pass })).status, 200);
    assert.equal(db.prepare('SELECT count(*) AS n FROM request_assistance').get().n, 0);
  });
});
