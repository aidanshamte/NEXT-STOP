// Walking directions to a pickup: the route proxy (destination, rounding, limits, failures,
// privacy) and the client's external-maps links and GPS checks. A fake provider stands in for
// the OpenStreetMap routing service; no network is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { harness } from './harness.mjs';
import {
  directionsLinks,
  fixQuality,
  routeSummary,
  walkDistance,
  walkDuration,
} from '../src/features/walk/walking.ts';

function provider() {
  const calls = [];
  let reply = null;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (reply === 'down') throw Error('ECONNREFUSED');
    const m = /foot\/(-?[\d.]+),(-?[\d.]+);(-?[\d.]+),(-?[\d.]+)/.exec(url);
    const [, lng1, lat1, lng2, lat2] = m.map(Number);
    const body = reply || {
      code: 'Ok',
      routes: [
        {
          distance: 412.4,
          duration: 297.1,
          geometry: {
            type: 'LineString',
            coordinates: [
              [lng1 + 0.00001, lat1],
              [lng1, (lat1 + lat2) / 2],
              [lng2, lat2 - 0.0001],
            ],
          },
        },
      ],
    };
    return { ok: body.status !== 500, status: body.status || 200, json: async () => body };
  };
  return {
    calls,
    fetchImpl,
    set: (r) => {
      reply = r;
    },
  };
}

test('walking route preview', async (t) => {
  const p = provider();
  const logs = [];
  let now = Date.now();
  const h = await harness(t, {
    clock: () => now,
    walkingOptions: { fetchImpl: p.fetchImpl, baseUrl: 'https://router.test/foot-base' },
    log: (entry) => logs.push(entry),
  });
  const invalidations = [];
  const original = h.app.realtime.invalidate;
  h.app.realtime.invalidate = (org) => {
    invalidations.push(org);
    return original(org);
  };
  const student = h.as('northbridge-student');
  const route = (q) => student.get('/stops/walk', q);
  const stop = h.app.db.prepare("SELECT lat,lng FROM stops WHERE id='northbridge-1'").get();
  const next = () => {
    now += 4000;
  };

  await t.test(
    'routes to the stop’s confirmed boarding point from a rounded position',
    async () => {
      const r = await route('&stopId=northbridge-1&lat=41.1612345678&lng=-73.2467891234');
      assert.equal(r.status, 200);
      assert.deepEqual(r.data.to, { lat: stop.lat, lng: stop.lng });
      assert.equal(r.data.distance, 412);
      assert.equal(r.data.duration, 297);
      assert.equal(r.data.coords.length, 3);
      assert.equal(r.data.attribution, '© OpenStreetMap contributors');
      assert.ok(r.data.endGap >= 10 && r.data.endGap < 15, 'gap between route end and pin');
      const url = p.calls.at(-1).url;
      assert.ok(url.startsWith('https://router.test/foot-base/route/v1/foot/'));
      assert.ok(url.includes('-73.2468,41.1612;'), 'origin rounded to 4 decimals (about 10 m)');
      assert.ok(
        url.includes(`;${stop.lng},${stop.lat}?`),
        'destination is the stored boarding point',
      );
      assert.match(p.calls.at(-1).init.headers['User-Agent'], /NEXT-STOP/);
    },
  );

  await t.test('no position or route is logged, stored or broadcast', async () => {
    const text = JSON.stringify(logs);
    assert.ok(!text.includes('41.161') && !text.includes('73.246'), 'no coordinates in the log');
    assert.ok(logs.some((l) => l.path === '/stops/walk'));
    assert.deepEqual(invalidations, [], 'a route lookup triggers no realtime refresh');
    const tables = h.app.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    for (const table of tables) {
      const rows = JSON.stringify(h.app.db.prepare(`SELECT * FROM "${table}"`).all(), (k, v) =>
        typeof v === 'bigint' ? Number(v) : v,
      );
      assert.ok(!rows.includes('41.1612') && !rows.includes('-73.2468'), `nothing in ${table}`);
    }
    assert.equal(
      h.app.db.prepare('SELECT count(*) AS n FROM requests').get().n,
      0,
      'directions never create a request',
    );
  });

  await t.test('only confirmed stops in the rider’s own institution', async () => {
    next();
    assert.equal((await route('&stopId=lakeside-1&lat=41.16&lng=-73.25')).status, 404);
    h.app.db.prepare("UPDATE stops SET status='draft' WHERE id='northbridge-2'").run();
    next();
    assert.equal((await route('&stopId=northbridge-2&lat=41.16&lng=-73.25')).status, 404);
    next();
    assert.equal((await route('&stopId=northbridge-1&lat=abc&lng=-73.25')).status, 400);
    next();
    assert.equal((await route('&stopId=northbridge-1&lat=0&lng=0')).status, 400);
    next();
    const far = await route('&stopId=northbridge-1&lat=40.7128&lng=-74.006');
    assert.equal(far.status, 422);
    assert.match(far.data.error, /too far/);
  });

  await t.test('provider failures are reported, never replaced by a straight line', async () => {
    p.set({ code: 'NoRoute', message: 'Impossible route' });
    next();
    let r = await route('&stopId=northbridge-1&lat=41.161&lng=-73.247');
    assert.equal(r.status, 422);
    assert.equal(r.data.coords, undefined);
    p.set({ status: 500, code: 'Error' });
    next();
    r = await route('&stopId=northbridge-1&lat=41.161&lng=-73.247');
    assert.equal(r.status, 503);
    p.set('down');
    next();
    r = await route('&stopId=northbridge-1&lat=41.161&lng=-73.247');
    assert.equal(r.status, 503);
    p.set({
      code: 'Ok',
      routes: [{ distance: 5, duration: 4, geometry: { coordinates: [[1, 2]] } }],
    });
    next();
    r = await route('&stopId=northbridge-1&lat=41.161&lng=-73.247');
    assert.equal(r.status, 503, 'a one-point "route" is rejected');
    p.set(null);
  });

  await t.test('each rider is rate limited', async () => {
    next();
    assert.equal((await route('&stopId=northbridge-1&lat=41.161&lng=-73.247')).status, 200);
    assert.equal((await route('&stopId=northbridge-1&lat=41.161&lng=-73.247')).status, 429);
  });

  h.app.realtime.invalidate = original;
});

test('external walking directions send only the boarding point', () => {
  const stop = { lat: 41.1599301, lng: -73.2579 };
  const ios = directionsLinks(stop, 'ios');
  assert.equal(ios.primary.app, 'Apple Maps');
  assert.equal(ios.primary.url, 'https://maps.apple.com/?daddr=41.159930,-73.257900&dirflg=w');
  assert.equal(ios.alternate.app, 'Google Maps');
  const android = directionsLinks(stop, 'android');
  assert.equal(android.primary.app, 'Google Maps');
  assert.equal(
    android.primary.url,
    'https://www.google.com/maps/dir/?api=1&destination=41.159930,-73.257900&travelmode=walking',
  );
  assert.equal(
    directionsLinks(stop, 'web', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)').primary.app,
    'Apple Maps',
  );
  assert.equal(
    directionsLinks(stop, 'web', 'Mozilla/5.0 (Windows NT 10.0)').primary.app,
    'Google Maps',
  );
  for (const set of [ios, android])
    for (const link of [set.primary, set.alternate])
      assert.ok(!/origin|saddr|myloc/i.test(link.url), 'never includes the rider’s position');
});

test('GPS fixes are checked for age and accuracy before routing', () => {
  const now = 1_000_000;
  assert.equal(fixQuality({ lat: 1, lng: 1, accuracy: 12, at: now - 1000 }, now), 'good');
  assert.equal(fixQuality({ lat: 1, lng: 1, accuracy: 80, at: now }, now), 'rough');
  assert.equal(fixQuality({ lat: 1, lng: 1, accuracy: 500, at: now }, now), 'poor');
  assert.equal(fixQuality({ lat: 1, lng: 1, accuracy: Infinity, at: now }, now), 'poor');
  assert.equal(fixQuality({ lat: 1, lng: 1, accuracy: 5, at: now - 3 * 60000 }, now), 'stale');
  assert.equal(walkDistance(412), '410 m');
  assert.equal(walkDistance(1530), '1.5 km');
  assert.equal(walkDuration(297), '5 min');
  assert.equal(walkDuration(4000), '1 h 7 min');
  const summary = routeSummary({ distance: 412, duration: 297 });
  assert.match(summary, /walking estimate/);
  assert.doesNotMatch(summary, /arriv|shuttle|accessible|step-free/i);
});

test('walking directions code never touches pickup requests', () => {
  const dir = new URL('../src/features/walk/', import.meta.url);
  for (const file of readdirSync(dir)) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(source, /['"`]\/requests|mutate\(/, file);
  }
  const server = readFileSync(new URL('../server/walking.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /INSERT|UPDATE|DELETE|requests/);
});
