// Stage 3: rider passes, journey-sharing consent, safety contacts, incident reports, escort
// requests and shared-ride coordination. All features start off for every institution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passCode, PASS_STEP } from '../server/safety.mjs';
import { harness } from './harness.mjs';

const tick = () => new Promise((r) => setTimeout(r, 30));

test('every stage 3 feature is off until the institution turns it on', async (t) => {
  const h = await harness(t);
  const student = h.as('northbridge-student'),
    admin = h.as('northbridge-admin');
  assert.equal((await student.post('/pass/issue')).status, 403);
  assert.equal(
    (await student.post('/incidents', { category: 'other', description: 'x' })).status,
    403,
  );
  assert.equal(
    (await student.post('/escorts', { stopId: 'northbridge-0', destination: 'Dorm' })).status,
    403,
  );
  assert.equal((await student.post('/rides/intent', { consent: true })).status, 403);
  const snap = await student.snapshot();
  assert.deepEqual(
    [
      snap.safety.passes_enabled,
      snap.safety.incidents_enabled,
      snap.safety.escorts_enabled,
      snap.safety.shared_rides_enabled,
    ],
    [0, 0, 0, 0],
  );
  assert.equal(snap.safety.emergency_number, '', 'no emergency number is assumed');
  assert.equal((await student.post('/safety/settings', { passesEnabled: true })).status, 403);
  assert.equal(
    (
      await h
        .as('lakeside-admin')
        .post('/safety/settings', { institutionId: 'northbridge', passesEnabled: true })
    ).status,
    403,
  );
  assert.equal((await admin.post('/safety/settings', { emergencyNumber: 'call me' })).status, 400);
  assert.equal(
    (await admin.post('/safety/settings', { emergencyNumber: '911', incidentsEnabled: true }))
      .status,
    200,
  );
  assert.equal((await student.snapshot()).safety.emergency_number, '911');
  assert.equal(
    (await h.as('lakeside-student').snapshot()).safety.emergency_number,
    '',
    'per institution',
  );
  // Contacts: admin-entered, validated.
  assert.equal(
    (
      await admin.post('/safety/contacts', {
        label: 'Campus safety',
        phone: 'none',
        kind: 'safety',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await admin.post('/safety/contacts', {
        label: 'Campus safety',
        phone: '(555) 010-0000',
        kind: 'safety',
        hours: '24 hours',
        sms: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await student.post('/safety/contacts', { label: 'x', phone: '1', kind: 'other' })).status,
    403,
  );
  assert.equal((await student.snapshot()).safety.contacts[0].label, 'Campus safety');
});

test('rotating QR passes: validation, expiry, guessing limits, revocation', async (t) => {
  let now = Date.UTC(2026, 10, 2, 15);
  const h = await harness(t, { clock: () => now });
  const student = h.as('northbridge-student'),
    driver = h.as('northbridge-driver'),
    admin = h.as('northbridge-admin');
  await admin.post('/safety/settings', { passesEnabled: true });
  assert.equal((await student.get('/pass/code')).status, 404, 'create first');
  assert.equal((await h.as('northbridge-parent').post('/pass/issue')).status, 403, 'students only');
  assert.equal((await student.post('/pass/issue')).status, 200);
  const { short } = (await student.snapshot()).pass;
  assert.match(short, /^[A-Z2-9]{5}$/);
  const code = (await student.get('/pass/code')).data;
  assert.match(code.qr, /^NS1:[A-Z2-9]{5}:\d{6}$/);
  assert.equal(code.firstName, 'Sam');
  assert.equal(code.expiresAt, (Math.floor(now / PASS_STEP) + 1) * PASS_STEP);
  assert.ok(!JSON.stringify(code).includes('secret'));
  // Checked by the driver on an in-service shuttle; the rider's accepted pickup is offered.
  await student.post('/requests', {
    tripId: 'bus',
    stopId: 'northbridge-0',
    destinationId: 'northbridge-1',
  });
  const r = (await driver.snapshot()).requests[0];
  await driver.post('/requests/status', { requestId: r.id, status: 'accepted' });
  let result = (await driver.post('/pass/validate', { code: code.qr })).data;
  assert.deepEqual(result, {
    valid: true,
    firstName: 'Sam',
    repeat: false,
    request: { id: r.id, status: 'accepted', stop: 'Campus Center' },
  });
  assert.equal(
    (await driver.post('/pass/validate', { code: code.code })).data.repeat,
    true,
    'typed code works; repeat flagged',
  );
  assert.equal((await student.post('/pass/validate', { code: code.qr })).status, 403);
  // A screenshot stops working after about a minute.
  now += 2 * PASS_STEP + 1000;
  result = (await driver.post('/pass/validate', { code: code.qr })).data;
  assert.equal(result.valid, false);
  assert.match(result.reason, /expired/);
  // Another institution cannot use or see this pass.
  await h.as('lakeside-admin').post('/safety/settings', { passesEnabled: true });
  const fresh = (await student.get('/pass/code')).data;
  assert.equal(
    (await h.as('lakeside-admin').post('/pass/validate', { code: fresh.qr })).data.valid,
    false,
  );
  // Guessing: ten wrong codes lock checks of this pass for a while.
  for (let i = 0; i < 10; i++) await admin.post('/pass/validate', { code: `${short}-000000` });
  assert.match(
    (await admin.post('/pass/validate', { code: (await student.get('/pass/code')).data.qr })).data
      .reason,
    /Too many/,
  );
  now += 11 * 60000;
  assert.equal(
    (await admin.post('/pass/validate', { code: (await student.get('/pass/code')).data.qr })).data
      .valid,
    true,
  );
  // Replacing the pass (lost phone) invalidates the old one at once.
  await student.post('/pass/revoke');
  assert.match(
    (await admin.post('/pass/validate', { code: `${short}-${passCode('00', 0)}` })).data.reason,
    /replaced or revoked/,
  );
  await student.post('/pass/issue');
  assert.notEqual((await student.snapshot()).pass.short, short);
  // Every check is audited without storing the code itself.
  const scans = h.app.db.prepare('SELECT * FROM pass_scans').all();
  assert.ok(scans.length >= 14);
  assert.ok(!JSON.stringify(scans).includes(code.qr));
  assert.equal(passCode('ab'.repeat(32), 1), passCode('ab'.repeat(32), 1), 'deterministic');
});

test('journey sharing: one ride, time limits, either side can end it', async (t) => {
  let now = Date.now();
  const h = await harness(t, { clock: () => now });
  const student = h.as('northbridge-student'),
    parent = h.as('northbridge-parent'),
    driver = h.as('northbridge-driver');
  const email = 'northbridge-parent@example.com';
  assert.equal(
    (await student.post('/shares', { email, mode: 'ride' })).status,
    409,
    'needs a ride',
  );
  await student.post('/requests', {
    tripId: 'bus',
    stopId: 'northbridge-0',
    destinationId: 'northbridge-1',
  });
  assert.equal((await student.post('/shares', { email, mode: 'ride' })).status, 200);
  await tick();
  assert.equal(h.pushedTo('northbridge-parent').at(-1).title, 'Sam is sharing journeys with you');
  let seen = await parent.snapshot();
  assert.equal(seen.requests.length, 1);
  assert.deepEqual(
    seen.sharedWithMe.map((x) => x.name),
    ['Sam'],
    'first name only',
  );
  assert.ok(seen.sharedWithMe[0].request_id);
  // The ride ends: the share ends with it, and the next ride is not shared.
  const r = (await driver.snapshot()).requests[0];
  for (const status of ['accepted', 'boarded', 'arrived'])
    await driver.post('/requests/status', { requestId: r.id, status });
  await student.post('/requests', {
    tripId: 'bus',
    stopId: 'northbridge-0',
    destinationId: 'northbridge-1',
  });
  seen = await parent.snapshot();
  assert.deepEqual(
    seen.requests.map((x) => x.id),
    [r.id],
    'not the new ride',
  );
  // Time-limited sharing expires on reads.
  assert.equal((await student.post('/shares', { email, mode: 'hours', hours: 0 })).status, 400);
  await student.post('/shares', { email, mode: 'hours', hours: 2 });
  assert.equal((await parent.snapshot()).requests.length, 2);
  now += 2 * 3600000 + 1000;
  assert.equal((await parent.snapshot()).requests.length, 0);
  assert.deepEqual((await student.snapshot()).shares, []);
  // Ongoing until stopped; the parent can leave, the student can stop all.
  await student.post('/shares', { email, mode: 'ongoing' });
  assert.equal((await parent.snapshot()).requests.length, 2);
  await parent.post('/shares/leave', { studentId: 'northbridge-student' });
  assert.equal((await parent.snapshot()).requests.length, 0);
  await student.post('/shares', { email });
  await student.post('/shares/stop-all');
  assert.equal((await parent.snapshot()).requests.length, 0);
  assert.equal((await student.post('/shares/leave', { studentId: 'x' })).status, 403);
});

test('reports and escorts reach staff and show status only when staff act', async (t) => {
  const h = await harness(t);
  const student = h.as('northbridge-student'),
    student2 = h.as('northbridge-student2'),
    admin = h.as('northbridge-admin');
  await admin.post('/safety/settings', {
    incidentsEnabled: true,
    escortsEnabled: true,
    escortNote: 'Evenings only',
  });
  const created = await student.post('/incidents', {
    category: 'stop_condition',
    description: 'Light out at the stop.',
    stopId: 'northbridge-0',
  });
  assert.equal(created.status, 201);
  assert.equal(
    (await student.post('/incidents', { category: 'gossip', description: 'x' })).status,
    400,
  );
  assert.equal(
    (
      await student.post('/incidents', {
        category: 'other',
        description: 'x',
        stopId: 'lakeside-0',
      })
    ).status,
    400,
  );
  await tick();
  assert.equal(h.pushedTo('northbridge-admin').at(-1).title, 'New report in NEXT STOP');
  assert.equal((await student.snapshot()).incidents[0].status, 'open');
  assert.equal(
    (await student2.snapshot()).incidents.length,
    0,
    'reports are private to the reporter and staff',
  );
  assert.equal(
    (await student.post('/incidents/update', { incidentId: created.data.id, status: 'resolved' }))
      .status,
    403,
  );
  await admin.post('/incidents/update', {
    incidentId: created.data.id,
    status: 'acknowledged',
    note: 'Facilities notified.',
  });
  await tick();
  assert.equal((await student.snapshot()).incidents[0].staff_note, 'Facilities notified.');
  assert.equal(h.pushedTo('northbridge-student').at(-1).title, 'Your report was received');
  assert.equal((await h.as('lakeside-admin').snapshot()).incidents.length, 0);
  // Escorts: one open request; staff accept or decline.
  assert.equal(
    (await student.post('/escorts', { stopId: 'northbridge-0', destination: 'West dorms' })).status,
    201,
  );
  assert.equal(
    (await student.post('/escorts', { stopId: 'northbridge-0', destination: 'Again' })).status,
    409,
  );
  let escort = (await admin.snapshot()).escorts[0];
  assert.equal(escort.status, 'requested');
  assert.equal(
    (await student.post('/escorts/update', { escortId: escort.id, status: 'accepted' })).status,
    403,
  );
  await admin.post('/escorts/update', {
    escortId: escort.id,
    status: 'accepted',
    note: 'Officer on the way to Campus Center.',
  });
  await tick();
  assert.equal(h.pushedTo('northbridge-student').at(-1).title, 'Escort request accepted');
  assert.equal(
    (await student.post('/escorts/update', { escortId: escort.id, status: 'cancelled' })).status,
    200,
  );
  escort = (await student.snapshot()).escorts[0];
  assert.equal(escort.status, 'cancelled');
  // Account deletion: escorts removed, reports kept by the institution without the identity.
  await student.post('/account/delete', { password: 'service-test-password' });
  assert.equal(
    h.app.db.prepare("SELECT count(*) AS n FROM escorts WHERE rider_id='northbridge-student'").get()
      .n,
    0,
  );
  assert.equal(h.app.db.prepare('SELECT reporter_id FROM incidents').get().reporter_id, null);
});

test('shared rides: consent, counts, first names in a group, blocking and reports', async (t) => {
  const now = Date.now();
  const h = await harness(t, { clock: () => now });
  h.app.db
    .prepare('INSERT INTO users(id,name,email,password,email_verified) VALUES (?,?,?,?,1)')
    .run('northbridge-student3', 'Riley Third', 'n3@example.com', 'x');
  h.app.db
    .prepare("INSERT INTO memberships VALUES ('northbridge-student3','northbridge','student',1)")
    .run();
  const a = h.as('northbridge-student'),
    b = h.as('northbridge-student2'),
    admin = h.as('northbridge-admin');
  await admin.post('/safety/settings', { sharedRidesEnabled: true, incidentsEnabled: true });
  const intent = {
    fromStop: 'northbridge-0',
    toStop: 'northbridge-3',
    leaveAfter: now,
    leaveBefore: now + 3600000,
  };
  assert.equal((await a.post('/rides/intent', intent)).status, 400, 'consent required');
  assert.equal(
    (await a.post('/rides/intent', { ...intent, consent: true, leaveBefore: now + 5 * 3600000 }))
      .status,
    400,
  );
  await a.post('/rides/intent', { ...intent, consent: true });
  await b.post('/rides/intent', {
    ...intent,
    consent: true,
    leaveAfter: now + 1800000,
    leaveBefore: now + 7200000,
  });
  let view = (await a.snapshot()).rides;
  assert.equal(view.matches, 1);
  assert.deepEqual(view.group, [], 'no names before both choose to coordinate');
  await a.post('/rides/coordinate', { join: true });
  assert.deepEqual((await a.snapshot()).rides.group, [], 'still none: only A has opted in');
  await b.post('/rides/coordinate', { join: true });
  view = (await a.snapshot()).rides;
  assert.deepEqual(view.group, [{ userId: 'northbridge-student2', firstName: 'Sam' }]);
  assert.ok(!JSON.stringify(view).includes('@'), 'no emails');
  // Reports about the group, then blocking removes the pair from each other's view.
  assert.equal(
    (
      await a.post('/incidents', {
        category: 'shared_ride',
        description: 'Rude message',
        subjectId: 'northbridge-student3',
      })
    ).status,
    400,
    'only current group members',
  );
  assert.equal(
    (
      await a.post('/incidents', {
        category: 'shared_ride',
        description: 'Did not show',
        subjectId: 'northbridge-student2',
      })
    ).status,
    201,
  );
  await a.post('/rides/block', { userId: 'northbridge-student2' });
  assert.equal((await a.snapshot()).rides.matches, 0);
  assert.equal((await b.snapshot()).rides.matches, 0, 'blocking works both ways');
  assert.equal((await h.as('lakeside-student').snapshot()).rides, null);
  await a.post('/rides/intent', { clear: true });
  assert.equal((await a.snapshot()).rides.intent, null);
});
