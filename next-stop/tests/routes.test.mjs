// Institution route/stop import and the rules around draft (unconfirmed) stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { openDatabase } from '../server/db.mjs';
import { importRoutes } from '../server/import-routes.mjs';
import { hashPassword } from '../server/security.mjs';

const plan = JSON.parse(readFileSync('server/imports/fairfield-university-shuttles.json', 'utf8'));
const pass = 'routes-test-password-1';

function freshDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-routes-'));
  const db = openDatabase(join(dir, 'r.db'));
  t.after(() => {
    if (db.isOpen) db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.prepare("INSERT INTO institutions VALUES ('ffld','Fairfield University','college')").run();
  db.prepare("INSERT INTO institutions VALUES ('other','Other College','college')").run();
  return db;
}
const routeList = (db, key) =>
  db
    .prepare(
      "SELECT s.name,rs.on_demand FROM route_stops rs JOIN routes r ON r.id=rs.route_id JOIN stops s ON s.id=rs.stop_id WHERE r.import_key=? AND r.institution_id='ffld' ORDER BY rs.position",
    )
    .all(key);

test('Fairfield sign imports in printed order as drafts without coordinates', (t) => {
  const db = freshDb(t);
  const summary = importRoutes(db, 'ffld', plan);
  assert.equal(summary.stopsCreated, 23);
  assert.equal(summary.routesCreated, 4);
  const campus = routeList(db, 'campus-shuttle');
  assert.equal(campus.length, 13);
  assert.equal(campus[0].name, 'Barone Campus Center Traffic Circle');
  assert.equal(campus[5].name, 'Barone Campus Center Traffic Circle', 'repeated visit kept');
  assert.deepEqual(
    campus.map((s) => s.on_demand),
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
    'stops 10-13 on demand',
  );
  assert.deepEqual(
    routeList(db, 'town-shuttle').map((s) => s.name),
    [
      'Barone Campus Center Traffic Circle',
      'Fairfield Train Station (top of overpass)',
      '140 Mill Plain Road',
      'Fairfield Green (near Bookstore)',
      'Grasmere & Post Rd',
      'Metro Train (Alto Parking Garage Side)',
      'Whole Foods',
      'Stop & Shop',
      'Marshalls/CVS',
    ],
  );
  assert.equal(routeList(db, 'bellarmine-bus-shuttle').length, 3);
  assert.deepEqual(
    routeList(db, '1720-post-road-shuttle').map((s) => s.name),
    ['Barone Campus Center Traffic Circle', '1720 Post Road'],
  );
  const stops = db.prepare("SELECT * FROM stops WHERE institution_id='ffld'").all();
  assert.ok(stops.every((s) => s.status === 'draft' && s.lat === null && s.lng === null));
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM stops WHERE institution_id='other'").get().n,
    0,
  );
});

test('re-running is idempotent and never overwrites a confirmed boarding point', (t) => {
  const db = freshDb(t);
  db.prepare(
    "INSERT INTO stops(id,institution_id,name,lat,lng,position) VALUES ('manual','ffld','Manual stop',41.16,-73.25,0)",
  ).run();
  importRoutes(db, 'ffld', plan);
  const barone = db.prepare("SELECT id FROM stops WHERE import_key='barone-traffic-circle'").get();
  db.prepare(
    "UPDATE stops SET lat=41.1600,lng=-73.2560,status='confirmed',name='Barone (confirmed)' WHERE id=?",
  ).run(barone.id);
  const again = importRoutes(db, 'ffld', plan);
  assert.equal(again.stopsCreated, 0);
  assert.equal(again.routesCreated, 0);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM stops WHERE institution_id='ffld'").get().n,
    24,
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM routes').get().n, 4);
  assert.equal(db.prepare('SELECT count(*) AS n FROM route_stops').get().n, 27);
  const kept = db.prepare('SELECT * FROM stops WHERE id=?').get(barone.id);
  assert.deepEqual(
    [kept.lat, kept.lng, kept.status, kept.name],
    [41.16, -73.256, 'confirmed', 'Barone (confirmed)'],
  );
  const manual = db.prepare("SELECT * FROM stops WHERE id='manual'").get();
  assert.equal(manual.status, 'confirmed', 'existing records untouched');
});

test('import refuses another institution, and dry runs save nothing', (t) => {
  const db = freshDb(t);
  assert.throws(() => importRoutes(db, 'other', plan), /not "Other College"/);
  assert.throws(() => importRoutes(db, 'missing', plan), /not found/);
  const summary = importRoutes(db, 'ffld', plan, { dryRun: true });
  assert.equal(summary.stopsCreated, 23);
  assert.equal(db.prepare('SELECT count(*) AS n FROM stops').get().n, 0);
  assert.throws(
    () =>
      importRoutes(db, 'ffld', {
        ...plan,
        routes: [{ key: 'x', name: 'X', stops: [{ stop: 'nope' }] }],
      }),
    /unknown stop/,
  );
});

test('draft stops: hidden from riders, no pickup until an admin confirms the pin', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-routes-api-'));
  const app = createApp({ dbPath: join(dir, 'api.db'), authOptions: { mailer: async () => {} } });
  t.after(async () => {
    app.realtime.close();
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const db = app.db;
  db.prepare("INSERT INTO institutions VALUES ('ffld','Fairfield University','college')").run();
  db.prepare("INSERT INTO institutions VALUES ('other','Other College','college')").run();
  for (const [id, org, role] of [
    ['admin', 'ffld', 'admin'],
    ['driver', 'ffld', 'driver'],
    ['student', 'ffld', 'student'],
    ['otheradmin', 'other', 'admin'],
  ]) {
    db.prepare('INSERT INTO users(id,name,email,password,email_verified) VALUES (?,?,?,?,1)').run(
      id,
      id,
      `${id}@example.com`,
      hashPassword(pass),
    );
    db.prepare('INSERT INTO memberships VALUES (?,?,?,1)').run(id, org, role);
  }
  importRoutes(db, 'ffld', plan);
  const key = (k) => db.prepare('SELECT id FROM stops WHERE import_key=?').get(k).id;
  const town = db.prepare("SELECT id FROM routes WHERE import_key='town-shuttle'").get().id;
  const campus = db.prepare("SELECT id FROM routes WHERE import_key='campus-shuttle'").get().id;
  db.prepare(
    "INSERT INTO trips(id,institution_id,driver_id,name,capacity,active) VALUES ('bus','ffld','driver','Shuttle 1',10,1)",
  ).run();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
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
  const login = async (id) =>
    (await call('/auth/login', null, { email: `${id}@example.com`, password: pass })).data.token;
  const admin = await login('admin'),
    student = await login('student'),
    driver = await login('driver'),
    otherAdmin = await login('otheradmin');
  const act = (path, token, body) => call(path, token, { institutionId: 'ffld', ...body });

  const adminView = (await call('/snapshot?institutionId=ffld', admin)).data;
  assert.equal(adminView.stops.length, 23);
  assert.equal(adminView.routes.length, 4);
  assert.equal(adminView.routeStops.length, 27);
  const studentView = (await call('/snapshot?institutionId=ffld', student)).data;
  assert.equal(studentView.stops.length, 0, 'drafts hidden from riders');
  assert.equal(studentView.routeStops.length, 0);

  const pickup = key('barone-traffic-circle'),
    dropoff = key('whole-foods');
  assert.equal(
    (await act('/requests', student, { tripId: 'bus', stopId: pickup, destinationId: dropoff }))
      .status,
    400,
    'no pickup at draft stops',
  );
  assert.equal(
    (await act('/stops/pin', student, { stopId: pickup, lat: 41.16, lng: -73.25 })).status,
    403,
  );
  assert.equal(
    (await act('/stops/pin', driver, { stopId: pickup, lat: 41.16, lng: -73.25 })).status,
    403,
  );
  assert.equal(
    (
      await call('/stops/pin', otherAdmin, {
        institutionId: 'other',
        stopId: pickup,
        lat: 41,
        lng: -73,
      })
    ).status,
    404,
    'no cross-institution pinning',
  );
  assert.equal((await act('/stops/pin', admin, { stopId: pickup, lat: 0, lng: 0 })).status, 400);
  assert.equal(
    (await act('/stops/pin', admin, { stopId: pickup, lat: 41.1601, lng: -73.2562 })).status,
    200,
  );
  assert.equal(
    (await act('/stops/pin', admin, { stopId: dropoff, lat: 41.1405, lng: -73.2601 })).status,
    200,
  );
  assert.equal((await call('/snapshot?institutionId=ffld', student)).data.stops.length, 2);

  // A shuttle on the Campus route cannot take a Town-only stop.
  assert.equal((await act('/trips/route', driver, { tripId: 'bus', routeId: campus })).status, 403);
  assert.equal((await act('/trips/route', admin, { tripId: 'bus', routeId: 'nope' })).status, 400);
  assert.equal((await act('/trips/route', admin, { tripId: 'bus', routeId: campus })).status, 200);
  assert.equal(
    (await act('/requests', student, { tripId: 'bus', stopId: pickup, destinationId: dropoff }))
      .status,
    400,
  );
  assert.equal((await act('/trips/route', admin, { tripId: 'bus', routeId: town })).status, 200);
  assert.equal(
    (await act('/requests', student, { tripId: 'bus', stopId: pickup, destinationId: dropoff }))
      .status,
    201,
  );
});
