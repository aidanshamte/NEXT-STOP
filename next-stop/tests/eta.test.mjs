// Stage 2: stop passage from GPS at confirmed pins, travel-time history, arrival estimates with
// ranges, "unavailable" states, retention, and approach notifications. Synthetic test routes
// and simulated fixes only; no real GPS data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metres, toSegment, MIN_SAMPLES } from '../server/eta.mjs';
import { pruneExpired } from '../server/db.mjs';
import { harness } from './harness.mjs';

const tick = () => new Promise((r) => setTimeout(r, 30));
// Four stops about 450 m apart on a square loop: A → B → C → D → A.
const STOPS = {
  'northbridge-0': [41.16, -73.25],
  'northbridge-1': [41.164, -73.25],
  'northbridge-2': [41.164, -73.2446],
  'northbridge-3': [41.16, -73.2446],
};
function setupRoute(db, { onDemand = [], draft = [] } = {}) {
  for (const [id, [lat, lng]] of Object.entries(STOPS))
    db.prepare("UPDATE stops SET lat=?,lng=?,status='confirmed' WHERE id=?").run(lat, lng, id);
  for (const id of draft) db.prepare("UPDATE stops SET status='draft' WHERE id=?").run(id);
  db.prepare(
    "INSERT INTO routes(id,institution_id,name) VALUES ('loop','northbridge','Loop')",
  ).run();
  ['northbridge-0', 'northbridge-1', 'northbridge-2', 'northbridge-3', 'northbridge-0'].forEach(
    (s, i) =>
      db
        .prepare('INSERT INTO route_stops(route_id,position,stop_id,on_demand) VALUES (?,?,?,?)')
        .run('loop', i, s, onDemand.includes(i) ? 1 : 0),
  );
  db.prepare("UPDATE trips SET route_id='loop',active=1 WHERE id='bus'").run();
}
/** Feeds fixes the way /trips/location does: store the fix, then run passage detection. */
function driver(app) {
  return (lat, lng, at) => {
    const before = app.db.prepare("SELECT * FROM trips WHERE id='bus'").get();
    app.db
      .prepare("UPDATE trips SET lat=?,lng=?,accuracy=8,updated_at=? WHERE id='bus'")
      .run(lat, lng, at);
    return app.eta.onFix(before, { lat, lng, accuracy: 8, capturedAt: at });
  };
}
/** Drives one lap, 40 m apart fixes, `legs[i]` seconds per segment, starting at time t. */
function lap(fix, t, legs) {
  const order = [
    'northbridge-0',
    'northbridge-1',
    'northbridge-2',
    'northbridge-3',
    'northbridge-0',
  ];
  for (let i = 0; i < 4; i++) {
    const [aLat, aLng] = STOPS[order[i]],
      [bLat, bLng] = STOPS[order[i + 1]];
    const steps = 12;
    for (let k = 0; k < steps; k++) {
      // Fixes start 60 m past the stop so passing is detected from the path, not a direct hit.
      const f = (k + 0.13) / steps;
      fix(
        aLat + (bLat - aLat) * f,
        aLng + (bLng - aLng) * f,
        t + (legs[i] * 1000 * (k + 0.13)) / steps,
      );
    }
    t += legs[i] * 1000;
  }
  return t;
}

test('geometry helpers measure metres and path distance', () => {
  assert.ok(Math.abs(metres({ lat: 41.16, lng: -73.25 }, { lat: 41.164, lng: -73.25 }) - 445) < 5);
  // A stop 10 m beside a straight path between two fixes 200 m apart is passed.
  const stop = { lat: 41.16, lng: -73.25 };
  assert.ok(
    toSegment(stop, { lat: 41.1591, lng: -73.25012 }, { lat: 41.1609, lng: -73.25012 }) < 12,
  );
});

test('passage, history, estimates with ranges, and unavailable states', async (t) => {
  let now = Date.UTC(2026, 10, 2, 13);
  const h = await harness(t, { clock: () => now });
  const { app } = h;
  setupRoute(app.db, { draft: [] });
  const fix = driver(app);
  const student = h.as('northbridge-student');
  const busOf = async () => (await student.snapshot()).trips.find((x) => x.id === 'bus');

  // Before any fix: no progress.
  assert.equal((await busOf()).reason, 'no_progress');
  // First lap: the nearest pin sets progress; laps of 120/150/90/200 s build history.
  let time = now;
  const passed = fix(41.1601, -73.25, time);
  assert.equal(passed.position, 0, 'starts at the nearest confirmed stop');
  time = lap(fix, time, [120, 150, 90, 200]);
  const samples = app.db.prepare('SELECT * FROM segment_times ORDER BY id').all();
  assert.deepEqual(
    samples.map((s) => [s.from_position, s.to_position]),
    [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    'the loop closes on the first stop',
  );
  assert.ok(Math.abs(samples[0].seconds - 120) <= 12, `A→B ≈ 120 s, got ${samples[0].seconds}`);
  assert.deepEqual(
    Object.keys(samples[0]).sort(),
    ['from_position', 'id', 'institution_id', 'recorded_at', 'route_id', 'seconds', 'to_position'],
    'no coordinates or driver identity in history',
  );

  now = time + 5000;
  let bus = await busOf();
  assert.equal(bus.progress.stop_id, 'northbridge-0');
  assert.deepEqual(bus.estimates, []);
  assert.equal(bus.reason, 'insufficient_history', `needs ${MIN_SAMPLES} samples per segment`);

  // Two more laps with slightly different times give a range.
  time = lap(fix, time, [110, 160, 95, 190]);
  time = lap(fix, time, [130, 140, 85, 210]);
  now = time + 10000;
  bus = await busOf();
  assert.equal(bus.reason, null);
  assert.equal(bus.estimates.length, 4);
  const toC = bus.estimates.find((e) => e.stop_id === 'northbridge-2');
  assert.ok(toC.low <= toC.mid && toC.mid <= toC.high, 'range is ordered');
  assert.ok(Math.abs(toC.mid - 270) <= 25, `A→C median ≈ 270 s, got ${toC.mid}`);
  assert.equal(toC.samples, 3);
  assert.equal(bus.progress.at, bus.progress.at);

  // Far beyond the usual time to the next stop: estimates are withdrawn.
  now = time + 15 * 60000;
  bus = await busOf();
  assert.equal(bus.reason, 'overdue');
  assert.deepEqual(bus.estimates, []);
  // Ending service clears progress; history stays (route-level, no identity).
  await h.as('northbridge-driver').post('/trips/service', { tripId: 'bus', active: false });
  assert.equal(
    app.db.prepare("SELECT progress_position FROM trips WHERE id='bus'").get().progress_position,
    null,
  );
  // History older than 60 days is deleted.
  pruneExpired(app.db, time + 61 * 86400000);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM segment_times').get().n, 0);
});

test('unconfirmed pins are never matched; skipped on-demand stops use the hop', async (t) => {
  let now = Date.UTC(2026, 10, 2, 13);
  const h = await harness(t, { clock: () => now });
  setupRoute(h.app.db, { draft: ['northbridge-2'], onDemand: [] });
  const fix = driver(h.app);
  let time = now;
  fix(41.1601, -73.25, time);
  for (let i = 0; i < 3; i++) time = lap(fix, time, [120, 150, 90, 200]);
  const pairs = h.app.db
    .prepare("SELECT DISTINCT from_position||'>'||to_position AS p FROM segment_times")
    .all()
    .map((r) => r.p)
    .sort();
  assert.deepEqual(pairs, ['0>1', '1>3', '3>0'], 'the draft stop is skipped; B→D is one hop');
  now = time + 5000;
  const bus = (await h.as('northbridge-student').snapshot()).trips.find((x) => x.id === 'bus');
  // Estimates stop at the unconfirmed stop: B→C has no history and C is not on demand.
  assert.deepEqual(
    bus.estimates.map((e) => e.stop_id),
    ['northbridge-1'],
  );
});

test('approach notifications through the GPS endpoint, once, as chosen', async (t) => {
  const h = await harness(t);
  setupRoute(h.app.db);
  const student = h.as('northbridge-student'),
    student2 = h.as('northbridge-student2'),
    driverApi = h.as('northbridge-driver');
  // Student 1 waits at D (3 stops after A) and wants 2 stops' notice; student 2 waits at C, off.
  await student.post('/prefs', {
    tripUpdates: true,
    delayAlerts: true,
    serviceAlerts: true,
    approachStops: 2,
  });
  await student2.post('/prefs', {
    tripUpdates: true,
    delayAlerts: true,
    serviceAlerts: true,
    approachStops: 0,
  });
  await student.post('/requests', {
    tripId: 'bus',
    stopId: 'northbridge-3',
    destinationId: 'northbridge-0',
  });
  await student2.post('/requests', {
    tripId: 'bus',
    stopId: 'northbridge-2',
    destinationId: 'northbridge-0',
  });
  const gps = async (lat, lng) => {
    const r = await driverApi.post('/trips/location', {
      tripId: 'bus',
      lat,
      lng,
      accuracy: 6,
      capturedAt: Date.now(),
    });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 20));
  };
  await gps(41.16, -73.25); // at A
  await tick();
  const approach = (id) => h.pushedTo(id).filter((m) => m.title === 'Shuttle getting close');
  assert.equal(approach('northbridge-student').length, 0, 'D is 3 stops after A');
  await gps(41.162, -73.25);
  await gps(41.164, -73.25); // at B: D is 2 stops ahead
  await tick();
  assert.equal(approach('northbridge-student').length, 1);
  assert.match(
    approach('northbridge-student')[0].body,
    /just passed Library Square\. Transit Hub is 2 stops ahead\./,
  );
  await gps(41.164, -73.2473);
  await gps(41.164, -73.2446); // at C: D is next, but already notified
  await tick();
  assert.equal(approach('northbridge-student').length, 1, 'sent once per request');
  assert.equal(approach('northbridge-student2').length, 0, 'turned off');
  assert.equal(approach('lakeside-student').length, 0);
});

test('accuracy is measured against real passages, per institution, admins only', async (t) => {
  let now = Date.UTC(2026, 10, 2, 13);
  const h = await harness(t, { clock: () => now });
  setupRoute(h.app.db);
  const fix = driver(h.app);
  const admin = h.as('northbridge-admin');
  let time = now;
  fix(41.1601, -73.25, time);
  // Two laps build history; with fewer than three samples nothing is shown or checked.
  for (let i = 0; i < 2; i++) time = lap(fix, time, [120, 150, 90, 200]);
  now = time;
  let acc = (await admin.get('/estimates/accuracy')).data;
  assert.equal(acc.checks, 0, 'no estimate was shown during the history laps');
  // Laps on the usual times: the estimates shown at each passage are resolved by later ones.
  for (let i = 0; i < 3; i++) time = lap(fix, time, [122, 148, 92, 198]);
  now = time;
  acc = (await admin.get('/estimates/accuracy')).data;
  assert.ok(acc.checks >= 8, `measured arrivals: ${acc.checks}`);
  assert.equal(acc.within, acc.checks, 'usual times fall inside the shown range');
  assert.equal(acc.routes[0].name, 'Loop');
  // A much slower lap lands outside the range and is counted as such.
  const before = acc.checks;
  time = lap(fix, time, [400, 400, 400, 400]);
  now = time;
  acc = (await admin.get('/estimates/accuracy')).data;
  assert.ok(acc.checks > before && acc.within < acc.checks, 'slow arrivals are misses');
  assert.ok(acc.medianError > 0);
  // Checks hold route positions and times only.
  assert.deepEqual(
    Object.keys(h.app.db.prepare('SELECT * FROM estimate_checks LIMIT 1').get()).sort(),
    [
      'actual',
      'from_position',
      'high',
      'id',
      'institution_id',
      'low',
      'made_at',
      'mid',
      'resolved_at',
      'route_id',
      'samples',
      'target_position',
      'trip_id',
    ],
  );
  // Admins only; another institution sees none of it.
  assert.equal((await h.as('northbridge-student').get('/estimates/accuracy')).status, 403);
  assert.equal((await h.as('northbridge-driver').get('/estimates/accuracy')).status, 403);
  assert.equal((await h.as('lakeside-admin').get('/estimates/accuracy')).data.checks, 0);
  // Ending service drops unresolved checks; retention removes the rest after 60 days.
  await h.as('northbridge-driver').post('/trips/service', { tripId: 'bus', active: false });
  const open = h.app.db
    .prepare('SELECT count(*) AS n FROM estimate_checks WHERE resolved_at IS NULL')
    .get().n;
  assert.equal(open, 0);
  pruneExpired(h.app.db, time + 61 * 86400000);
  assert.equal(h.app.db.prepare('SELECT count(*) AS n FROM estimate_checks').get().n, 0);
});
