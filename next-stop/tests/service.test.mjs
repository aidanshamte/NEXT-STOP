// Stage 1 rider services: waiting demand and expiry, onboard counts and capacity, favorites,
// notification preferences, stop details and photos, service alerts and timetables.
// A recording transport stands in for the Expo Push Service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedEpoch, localDate } from '../server/time.mjs';
import { harness } from './harness.mjs';

const pass = 'service-test-password';
const tick = () => new Promise((r) => setTimeout(r, 30));

test('waiting counts, request expiry, cancel reasons and preferences', async (t) => {
  let now = Date.now();
  const h = await harness(t, { clock: () => now });
  const student = h.as('northbridge-student'),
    student2 = h.as('northbridge-student2'),
    driver = h.as('northbridge-driver'),
    admin = h.as('northbridge-admin');
  const request = (who, stopId = 'northbridge-0') =>
    who.post('/requests', { tripId: 'bus', stopId, destinationId: 'northbridge-2' });

  await t.test('waiting counts are aggregate and visible without identities', async () => {
    assert.equal((await request(student)).status, 201);
    assert.equal((await request(student2)).status, 201);
    const seen = await student.snapshot();
    assert.deepEqual(seen.demand, [{ stop_id: 'northbridge-0', waiting: 2 }]);
    assert.equal(seen.requests.length, 1, 'a rider sees only their own request');
    assert.ok(!JSON.stringify(seen.demand).includes('student'));
    const outside = await h.as('lakeside-student').snapshot();
    assert.deepEqual(outside.demand, [], 'no cross-institution demand');
  });

  await t.test('unaccepted requests expire with a reason and a notification', async () => {
    assert.equal((await admin.post('/settings', { requestExpiryMinutes: 10 })).status, 200);
    const accepted = (await driver.snapshot()).requests.find(
      (r) => r.student_id === 'northbridge-student2',
    );
    assert.equal(
      (await driver.post('/requests/status', { requestId: accepted.id, status: 'accepted' }))
        .status,
      200,
    );
    // Student 2 turns off trip updates; student 1 keeps them.
    assert.equal(
      (
        await student2.post('/prefs', {
          tripUpdates: false,
          delayAlerts: true,
          serviceAlerts: true,
          approachStops: 2,
        })
      ).status,
      200,
    );
    now += 11 * 60000;
    const before = h.sent.length;
    assert.deepEqual(h.app.service.expireRequests(), ['northbridge']);
    await tick();
    const mine = (await student.snapshot()).requests[0];
    assert.equal(mine.status, 'cancelled');
    assert.equal(mine.cancel_reason, 'expired');
    assert.equal(h.pushedTo('northbridge-student').at(-1).title, 'Pickup request expired');
    assert.equal(h.sent.length, before + 1);
    // The accepted request is the driver's to resolve: not expired.
    assert.equal((await student2.snapshot()).requests[0].status, 'accepted');
    assert.deepEqual((await student.snapshot()).demand, [{ stop_id: 'northbridge-0', waiting: 1 }]);
  });

  await t.test(
    'driver no-show cancellation records the reason; muted rider gets no push',
    async () => {
      const r = (await driver.snapshot()).requests.find(
        (x) => x.student_id === 'northbridge-student2',
      );
      const before = h.pushedTo('northbridge-student2').length;
      await driver.post('/requests/status', {
        requestId: r.id,
        status: 'cancelled',
        reason: 'no_show',
      });
      await tick();
      const mine = (await student2.snapshot()).requests[0];
      assert.equal(mine.cancel_reason, 'no_show');
      assert.equal(
        h.pushedTo('northbridge-student2').length,
        before,
        'trip updates were turned off',
      );
      assert.deepEqual((await student2.snapshot()).prefs, {
        trip_updates: 0,
        delay_alerts: 1,
        service_alerts: 1,
        approach_stops: 2,
      });
    },
  );

  await t.test('preferences and settings are validated and role-limited', async () => {
    assert.equal((await student.post('/prefs', { tripUpdates: 'no' })).status, 400);
    assert.equal((await student.post('/settings', { requestExpiryMinutes: 20 })).status, 403);
    assert.equal((await admin.post('/settings', { requestExpiryMinutes: 2 })).status, 400);
    assert.equal((await admin.post('/settings', { timezone: 'Mars/Olympus' })).status, 400);
    assert.equal(
      (
        await h
          .as('lakeside-admin')
          .post('/settings', { institutionId: 'northbridge', timezone: 'UTC' })
      ).status,
      403,
    );
  });
});

test('driver-confirmed onboard count drives capacity and can be corrected', async (t) => {
  const h = await harness(t);
  const student = h.as('northbridge-student'),
    student2 = h.as('northbridge-student2'),
    driver = h.as('northbridge-driver'),
    admin = h.as('northbridge-admin');
  const trip = async (who = driver) => (await who.snapshot()).trips.find((x) => x.id === 'bus');
  const move = async (status, studentId) => {
    const r = (await driver.snapshot()).requests.find(
      (x) => x.student_id === studentId && !['arrived', 'cancelled'].includes(x.status),
    );
    return driver.post('/requests/status', { requestId: r.id, status });
  };
  await student.post('/requests', {
    tripId: 'bus',
    stopId: 'northbridge-0',
    destinationId: 'northbridge-1',
  });
  await move('accepted', 'northbridge-student');
  await move('boarded', 'northbridge-student');
  assert.equal((await trip()).onboard, 1);
  // Two walk-on riders without the app: the driver corrects the count to the real number.
  assert.equal((await driver.post('/trips/onboard', { tripId: 'bus', count: 2 })).status, 200);
  const corrected = await trip(student);
  assert.equal(corrected.onboard, 2);
  assert.equal(corrected.onboard_source, 'driver');
  // Full by count: another rider can request, but the driver cannot accept them.
  await student2.post('/requests', {
    tripId: 'bus',
    stopId: 'northbridge-0',
    destinationId: 'northbridge-1',
  });
  assert.equal((await move('accepted', 'northbridge-student2')).status, 409);
  await move('arrived', 'northbridge-student');
  assert.equal((await trip()).onboard, 1, 'drop-off lowers the count');
  assert.equal((await move('accepted', 'northbridge-student2')).status, 200);
  assert.equal((await student.post('/trips/onboard', { tripId: 'bus', count: 0 })).status, 403);
  assert.equal((await driver.post('/trips/onboard', { tripId: 'bus', count: -1 })).status, 400);
  // Capacity and vehicle features are administrator-set.
  assert.equal(
    (
      await admin.post('/trips/vehicle', {
        tripId: 'bus',
        capacity: 12,
        features: ['ramp', 'bike_rack'],
      })
    ).status,
    200,
  );
  assert.equal(
    (await driver.post('/trips/vehicle', { tripId: 'bus', capacity: 99, features: [] })).status,
    403,
  );
  assert.equal(
    (await admin.post('/trips/vehicle', { tripId: 'bus', capacity: 12, features: ['jetpack'] }))
      .status,
    400,
  );
  const updated = await trip(student);
  assert.equal(updated.capacity, 12);
  assert.deepEqual(updated.features, ['ramp', 'bike_rack']);
  assert.equal(
    (
      await h
        .as('lakeside-admin')
        .post('/trips/vehicle', { institutionId: 'northbridge', tripId: 'bus', capacity: 1 })
    ).status,
    403,
  );
});

test('favorites, stop details and verification', async (t) => {
  const h = await harness(t);
  const student = h.as('northbridge-student'),
    admin = h.as('northbridge-admin'),
    other = h.as('lakeside-admin');
  h.app.db.prepare("UPDATE stops SET status='draft' WHERE id='northbridge-3'").run();

  await t.test('favorites accept own-institution confirmed stops and routes only', async () => {
    assert.equal(
      (await student.post('/favorites', { kind: 'stop', targetId: 'northbridge-1', label: 'Home' }))
        .status,
      200,
    );
    assert.equal(
      (await student.post('/favorites', { kind: 'stop', targetId: 'lakeside-1' })).status,
      404,
    );
    assert.equal(
      (await student.post('/favorites', { kind: 'stop', targetId: 'northbridge-3' })).status,
      404,
    );
    assert.equal((await student.post('/favorites', { kind: 'planet', targetId: 'x' })).status, 400);
    const favs = (await student.snapshot()).favorites;
    assert.deepEqual(
      favs.map((f) => [f.kind, f.target_id, f.label]),
      [['stop', 'northbridge-1', 'Home']],
    );
    assert.deepEqual(
      (await h.as('northbridge-student2').snapshot()).favorites,
      [],
      'favorites are private',
    );
    await student.post('/favorites/remove', { kind: 'stop', targetId: 'northbridge-1' });
    assert.deepEqual((await student.snapshot()).favorites, []);
  });

  await t.test('details are admin-edited, verified, and re-verified after any edit', async () => {
    const details = {
      stopId: 'northbridge-1',
      description: 'North side of Library Square, by the bike racks.',
      accessibility: 'Level boarding from the sidewalk.',
      amenities: [{ key: 'shelter' }, { key: 'lighting', detail: 'Two lamps' }],
    };
    assert.equal((await student.post('/stops/details', details)).status, 403);
    assert.equal(
      (await other.post('/stops/details', { ...details, institutionId: 'northbridge' })).status,
      403,
    );
    assert.equal(
      (await admin.post('/stops/details', { ...details, amenities: [{ key: 'helipad' }] })).status,
      400,
    );
    assert.equal((await admin.post('/stops/details', details)).status, 200);
    let stop = (await student.snapshot()).stops.find((s) => s.id === 'northbridge-1');
    assert.equal(stop.details_verified_at, null, 'not verified until an admin verifies');
    assert.deepEqual(stop.amenities, [
      { key: 'shelter', detail: '' },
      { key: 'lighting', detail: 'Two lamps' },
    ]);
    assert.equal((await admin.post('/stops/verify', { stopId: 'northbridge-1' })).status, 200);
    stop = (await student.snapshot()).stops.find((s) => s.id === 'northbridge-1');
    assert.ok(stop.details_verified_at);
    assert.equal(stop.details_verified_by, 'Sam admin');
    assert.equal(
      (await admin.post('/stops/verify', { stopId: 'northbridge-3' })).status,
      409,
      'draft stop',
    );
    await admin.post('/stops/details', { ...details, description: 'Moved to the east side.' });
    stop = (await student.snapshot()).stops.find((s) => s.id === 'northbridge-1');
    assert.equal(stop.details_verified_at, null);
  });

  // Photos: tests/photos.test.mjs.

  await t.test('account deletion removes favorites and preferences', async () => {
    await student.post('/favorites', { kind: 'stop', targetId: 'northbridge-2' });
    await student.post('/prefs', {
      tripUpdates: true,
      delayAlerts: false,
      serviceAlerts: true,
      approachStops: 1,
    });
    await student.post('/account/delete', { password: pass });
    for (const table of ['favorites', 'notification_prefs'])
      assert.equal(
        h.app.db
          .prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id='northbridge-student'`)
          .get().n,
        0,
      );
  });
});

test('service alerts reach the right riders and respect preferences', async (t) => {
  const h = await harness(t);
  const db = h.app.db;
  db.prepare(
    "INSERT INTO routes(id,institution_id,name) VALUES ('red','northbridge','Red'),('blue','northbridge','Blue')",
  ).run();
  const student = h.as('northbridge-student'),
    student2 = h.as('northbridge-student2'),
    admin = h.as('northbridge-admin');
  await student.post('/favorites', { kind: 'route', targetId: 'red' });
  const count = (id) => h.pushedTo(id).length;
  const base = {
    s1: count('northbridge-student'),
    s2: count('northbridge-student2'),
    p: count('northbridge-parent'),
  };
  const created = await admin.post('/alerts', {
    routeId: 'red',
    severity: 'delay',
    title: 'Detour on Main St',
    body: 'Use the north entrance.',
  });
  assert.equal(created.status, 201);
  await tick();
  assert.equal(count('northbridge-student'), base.s1 + 1, 'route follower notified');
  assert.equal(count('northbridge-student2'), base.s2, 'not following the route');
  assert.equal(h.pushedTo('northbridge-student').at(-1).title, 'Red: Detour on Main St');
  // Institution-wide interruption: all students and parents, minus those who opted out.
  await student2.post('/prefs', {
    tripUpdates: true,
    delayAlerts: true,
    serviceAlerts: false,
    approachStops: 1,
  });
  await admin.post('/alerts', { severity: 'interruption', title: 'No service today' });
  await tick();
  assert.equal(count('northbridge-student'), base.s1 + 2);
  assert.equal(count('northbridge-student2'), base.s2, 'opted out of service alerts');
  assert.equal(count('northbridge-parent'), base.p + 1);
  assert.equal(h.pushedTo('lakeside-student').length, 0, 'no other institution');
  // Notices are in-app only.
  await admin.post('/alerts', { severity: 'info', title: 'New stop sign installed' });
  await tick();
  assert.equal(count('northbridge-student'), base.s1 + 2);
  const alerts = (await student.snapshot()).alerts;
  assert.equal(alerts.length, 3);
  assert.equal((await student.post('/alerts', { severity: 'info', title: 'x' })).status, 403);
  assert.equal(
    (await admin.post('/alerts', { severity: 'info', title: 'x', routeId: 'nope' })).status,
    400,
  );
  assert.equal((await admin.post('/alerts/resolve', { alertId: created.data.id })).status, 200);
  assert.equal((await student.snapshot()).alerts.length, 2);
  assert.equal((await h.as('lakeside-student').snapshot()).alerts.length, 0);
});

test('timetables: periods, frequencies, offsets, closures and time zones', async (t) => {
  const h = await harness(t);
  const db = h.app.db;
  db.prepare("INSERT INTO routes(id,institution_id,name) VALUES ('red','northbridge','Red')").run();
  const rs = db.prepare('INSERT INTO route_stops(route_id,position,stop_id) VALUES (?,?,?)');
  ['northbridge-0', 'northbridge-1', 'northbridge-2', 'northbridge-0'].forEach((s, i) =>
    rs.run('red', i, s),
  );
  const admin = h.as('northbridge-admin'),
    student = h.as('northbridge-student');
  assert.deepEqual((await student.get('/schedule')).data, { configured: false });
  const period = {
    name: 'Fall term',
    startDate: '2026-09-01',
    endDate: '2026-12-18',
    days: '1111100',
  };
  assert.equal((await admin.post('/schedule/period', period)).status, 409, 'time zone first');
  await admin.post('/settings', { timezone: 'America/New_York' });
  assert.equal((await student.post('/schedule/period', period)).status, 403);
  assert.equal((await admin.post('/schedule/period', { ...period, days: '0000000' })).status, 400);
  assert.equal(
    (await admin.post('/schedule/period', { ...period, endDate: '2026-02-30' })).status,
    400,
  );
  const { id: periodId } = (await admin.post('/schedule/period', period)).data;
  assert.equal(
    (
      await admin.post('/schedule/departures', {
        routeId: 'red',
        periodId,
        from: '07:00',
        to: '08:00',
        every: 15,
      })
    ).data.count,
    5,
  );
  assert.equal(
    (await admin.post('/schedule/departures', { routeId: 'red', periodId, times: ['25:00'] }))
      .status,
    400,
  );
  assert.equal(
    (
      await admin.post('/schedule/offsets', {
        routeId: 'red',
        offsets: [
          { position: 1, minutes: 9 },
          { position: 2, minutes: 4 },
        ],
      })
    ).status,
    400,
    'times may not decrease along the route',
  );
  assert.equal(
    (
      await admin.post('/schedule/offsets', {
        routeId: 'red',
        offsets: [
          { position: 0, minutes: 0 },
          { position: 1, minutes: 4 },
          { position: 2, minutes: 9 },
          { position: 3, minutes: 20 },
        ],
      })
    ).status,
    200,
  );
  assert.equal(
    (await student.snapshot()).routeStops.find((r) => r.position === 2).offset_minutes,
    9,
  );
  // Monday 2 November 2026 (EST, after the DST change on 1 November).
  const monday = (await student.get('/schedule', '&date=2026-11-02')).data;
  assert.equal(monday.timezone, 'America/New_York');
  const red = monday.routes.find((r) => r.route_id === 'red');
  assert.equal(red.departures.length, 5);
  assert.equal(new Date(red.departures[0]).toISOString(), '2026-11-02T12:00:00.000Z');
  // Friday 30 October 2026 is still EDT: 07:00 local is 11:00 UTC.
  const friday = (await student.get('/schedule', '&date=2026-10-30')).data;
  assert.equal(new Date(friday.routes[0].departures[0]).toISOString(), '2026-10-30T11:00:00.000Z');
  // Weekends have no service in this period; a closure removes a weekday.
  assert.equal(
    (await student.get('/schedule', '&date=2026-11-07')).data.routes[0].departures.length,
    0,
  );
  await admin.post('/schedule/exception', {
    date: '2026-11-26',
    kind: 'closed',
    note: 'Thanksgiving',
  });
  await admin.post('/schedule/exception', {
    date: '2026-11-25',
    kind: 'note',
    note: 'Reduced evening service',
  });
  const holiday = (await student.get('/schedule', '&date=2026-11-26')).data;
  assert.equal(holiday.closed, true);
  assert.equal(holiday.routes[0].departures.length, 0);
  assert.ok(holiday.exceptions.some((e) => e.note === 'Reduced evening service'));
  assert.equal(
    (await admin.post('/schedule/exception', { date: 'tomorrow', kind: 'closed' })).status,
    400,
  );
  // Another institution cannot read or change this timetable.
  const other = h.as('lakeside-admin');
  assert.equal(
    (await other.post('/schedule/departures', { routeId: 'red', periodId, times: ['09:00'] }))
      .status,
    404,
  );
  assert.deepEqual((await h.as('lakeside-student').get('/schedule')).data, { configured: false });
  assert.equal((await other.post('/schedule/period/delete', { periodId })).status, 404);
  assert.equal((await admin.post('/schedule/period/delete', { periodId })).status, 200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM departures').get().n, 0);
});

test('time zone conversion handles daylight saving boundaries', () => {
  assert.equal(
    new Date(zonedEpoch('2026-03-08', 180, 'America/New_York')).toISOString(),
    '2026-03-08T07:00:00.000Z',
  );
  assert.equal(
    new Date(zonedEpoch('2026-07-01', 0, 'Europe/London')).toISOString(),
    '2026-06-30T23:00:00.000Z',
  );
  assert.equal(localDate(Date.parse('2026-11-02T03:00:00Z'), 'America/New_York'), '2026-11-01');
});
