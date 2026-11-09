// Realtime presentation and map data: what riders are told about freshness must follow the
// actual connection and GPS timestamps, never invented values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ago, buildMapPayload, connectionState, mapLabel } from '../src/domain.ts';
import { MAP_HTML } from '../src/components/mapHtml.ts';

const now = 1_800_000_000_000;

test('connection state follows the live socket, sync errors and data age', () => {
  const at = (live, lastSync, syncError = '') =>
    connectionState({ live, lastSync, syncError }, now);
  assert.equal(at(false, null), 'connecting');
  assert.equal(at(true, now - 5000), 'live');
  assert.equal(at(false, now - 5000), 'reconnecting');
  assert.equal(at(true, now - 31000), 'stale');
  assert.equal(at(false, now - 31000), 'stale');
  assert.equal(at(true, now - 1000, 'Network request failed'), 'offline');
  assert.equal(at(false, null, 'Network request failed'), 'offline');
});

test('relative times never claim more freshness than the timestamp shows', () => {
  assert.equal(ago(now - 3000, now), 'just now');
  assert.equal(ago(now + 5000, now), 'just now');
  assert.equal(ago(now - 25000, now), '25s ago');
  assert.equal(ago(now - 4 * 60000, now), '4 min ago');
  assert.notEqual(ago(now - 3 * 3600000, now), 'just now');
});

const stops = [
  { id: 'a', name: 'Stop A', lat: 41.1, lng: -73.2, position: 0, status: 'confirmed' },
  { id: 'b', name: 'Stop B', lat: 41.2, lng: -73.3, position: 1 },
  { id: 'd', name: 'Draft', lat: null, lng: null, position: 2, status: 'draft' },
];
const trip = {
  id: 't',
  institution_id: 'i',
  driver_id: 'x',
  name: 'Shuttle 1',
  capacity: 12,
  active: 1,
  lat: 41.15,
  lng: -73.25,
  accuracy: 8,
  updated_at: now - 5000,
  delay_minutes: 0,
  issue: '',
};

test('map payload draws confirmed stops only and marks pickup and drop-off', () => {
  const p = buildMapPayload({
    stops,
    trips: [trip],
    focusId: 't',
    highlight: { pickupId: 'a', destinationId: 'b' },
    now,
  });
  assert.deepEqual(
    p.stops.map((s) => [s.name, s.kind]),
    [
      ['Stop A', 'pickup'],
      ['Stop B', 'dest'],
    ],
  );
  assert.equal(p.vehicles.length, 1);
  const v = p.vehicles[0];
  assert.deepEqual([v.lat, v.lng, v.state, v.focus], [41.15, -73.25, 'live', true]);
  assert.match(v.details.join('\n'), /GPS fix 5 s ago/);
  assert.match(mapLabel(p), /1 vehicle with current GPS/);
});

test('vehicle states: stale after 30 s, lost after 5 min, off the map when out of service', () => {
  const at = (change) => buildMapPayload({ stops, trips: [{ ...trip, ...change }], now });
  const stale = at({ updated_at: now - 60000 });
  assert.equal(stale.vehicles[0].state, 'stale');
  assert.match(stale.vehicles[0].label, /Location out of date/);
  assert.match(stale.vehicles[0].details.join(' '), /last GPS fix 1 min 0 s ago/);
  assert.equal(at({ updated_at: now - 6 * 60000 }).vehicles[0].state, 'lost');
  const ended = at({ active: 0 });
  assert.equal(ended.vehicles.length, 0);
  assert.deepEqual(ended.offMap, ['Shuttle 1: not in service']);
  const noFix = at({ lat: null, lng: null, updated_at: null });
  assert.equal(noFix.vehicles.length, 0);
  assert.deepEqual(noFix.offMap, ['Shuttle 1: in service, GPS not shared yet']);
  assert.match(mapLabel(buildMapPayload({ stops, now })), /No shuttle location/);
});

test('vehicle type comes only from the saved setting; heading only while GPS is current', () => {
  const trips = [
    { ...trip, id: 'b1', name: 'Bus 1', vehicle_type: 'bus', heading: 90 },
    { ...trip, id: 'v2', name: 'Van 2', vehicle_type: 'shuttle', heading: null },
    { ...trip, id: 'x3', name: 'Coach 3', updated_at: now - 40000, heading: 180 },
  ];
  const p = buildMapPayload({ stops, trips, focusId: 'v2', now });
  assert.deepEqual(
    p.vehicles.map((v) => [v.name, v.type, v.heading, v.focus]),
    [
      ['Bus 1', 'bus', 90, false],
      ['Van 2', 'shuttle', null, true],
      // Not set stays not set, whatever the name says; a stale fix's heading is dropped.
      ['Coach 3', '', null, false],
    ],
  );
  assert.match(p.vehicles[0].details.join(' '), /Heading east/);
  assert.match(p.vehicles[2].details[0], /Vehicle type not set/);
  // Labels distinguish vehicles by name and type, not by colour.
  assert.match(p.vehicles[0].label, /^Bus Bus 1\./);
  assert.match(p.vehicles[1].label, /^Shuttle van Van 2\./);
});

test('route colour, stop numbers, on-demand badges and shared stops drawn once', () => {
  const near = [
    ...stops,
    // A second record 3 m from Stop A (e.g. the same kerb used by two routes).
    { id: 'a2', name: 'Stop A (north side)', lat: 41.10002, lng: -73.2, position: 3 },
  ];
  const routes = [{ id: 'r', name: 'Loop', color: '#1E8E3E', position: 0 }];
  const routeStops = [
    { route_id: 'r', position: 0, stop_id: 'a', on_demand: 0 },
    { route_id: 'r', position: 1, stop_id: 'b', on_demand: 1 },
    { route_id: 'r', position: 2, stop_id: 'a', on_demand: 0 },
  ];
  const p = buildMapPayload({
    stops: near,
    trips: [{ ...trip, route_id: 'r' }],
    focusId: 't',
    routes,
    routeStops,
    now,
  });
  assert.equal(p.stops.length, 2);
  const a = p.stops.find((s) => s.ids.includes('a'));
  assert.deepEqual(a.ids, ['a', 'a2']);
  assert.deepEqual(a.names, ['Stop A', 'Stop A (north side)']);
  assert.deepEqual(a.numbers, [1, 3]);
  assert.equal(a.onDemand, false);
  const b = p.stops.find((s) => s.ids.includes('b'));
  assert.equal(b.onDemand, true);
  assert.match(b.label, /Stop 2 on Loop\. On-demand stop/);
  assert.equal(p.vehicles[0].color, '#1E8E3E');
  assert.deepEqual(p.route, { name: 'Loop', color: '#1E8E3E' });
  // An invalid stored colour never reaches the map document.
  const bad = buildMapPayload({
    stops,
    trips: [{ ...trip, route_id: 'r' }],
    routes: [{ ...routes[0], color: 'red;background:url(x)' }],
    now,
  });
  assert.equal(bad.vehicles[0].color, '#11243A');
});

test('the viewer location is included only when a real fix is supplied', () => {
  assert.equal(buildMapPayload({ stops, now }).me, null);
  assert.equal(buildMapPayload({ stops, now, locate: 'waiting' }).me, null);
  const me = { lat: 41.1, lng: -73.2, accuracy: 12 };
  const p = buildMapPayload({ stops, now, me, locate: 'on' });
  assert.deepEqual(p.me, me);
  assert.match(mapLabel(p), /Your location is shown/);
});

test('the website map frame is the same document as the native map', () => {
  assert.equal(readFileSync('public/map.html', 'utf8'), MAP_HTML);
  assert.match(MAP_HTML, /integrity="sha384-[A-Za-z0-9+/=]+" crossorigin="anonymous"><\/script>/);
  // Names and labels are set as text, never parsed as HTML.
  assert.match(MAP_HTML, /e\.textContent=text/);
  assert.doesNotMatch(MAP_HTML, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  // The map never asks for location itself (the frame has none); the page supplies it.
  assert.doesNotMatch(MAP_HTML, /navigator\.geolocation/);
  // Without these, MapLibre in the sandboxed (opaque-origin) website frame never draws tiles.
  assert.match(MAP_HTML, /Object\.defineProperty\(window, ?'caches'/);
  assert.match(MAP_HTML, /maplibregl\.setWorkerUrl\(/);
  assert.equal((MAP_HTML.match(/e\.data\.origin ?= ?location\.origin/g) || []).length, 2);
});

test('Caddy isolates the map frame and lets only the app page embed it', () => {
  const caddy = readFileSync('deploy/Caddyfile', 'utf8');
  const map = caddy.match(/header @mapframe \{\s*Content-Security-Policy "([^"]+)"/)[1];
  assert.match(map, /default-src 'none'/);
  // blob: lets the map's own worker wrapper load MapLibre's worker code (see mapHtml.ts).
  assert.match(
    map,
    /script-src 'unsafe-inline' https:\/\/unpkg\.com\/maplibre-gl@4\.7\.1\/ blob:;/,
  );
  assert.match(map, /connect-src https:\/\/tiles\.openfreemap\.org;/);
  assert.match(map, /frame-ancestors https:\/\/\{host\}/);
  const app = caddy.match(/header @appdoc \{\s*Content-Security-Policy "([^"]+)"/)[1];
  assert.match(app, /frame-src 'self' https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(app, /frame-ancestors 'none'/);
  assert.doesNotMatch(app, /unpkg|openfreemap|openstreetmap/);
  const web = readFileSync('src/components/LiveMap.web.tsx', 'utf8');
  assert.match(web, /sandbox="allow-scripts"/);
  assert.doesNotMatch(web, /sandbox="[^"]*allow-same-origin/);
});

test('a pending write is keyed by its target, so only the pressed control shows progress', async () => {
  const { actionKey } = await import('../src/features/workspace/types.ts');
  const sent = { tripId: 't-1', stopId: 'a', destinationId: 'b' };
  assert.equal(actionKey('/requests', sent), actionKey('/requests', { tripId: 't-1' }));
  assert.notEqual(actionKey('/requests', sent), actionKey('/requests', { tripId: 't-2' }));
  assert.equal(
    actionKey('/requests/status', { requestId: 'r', status: 'cancelled' }),
    actionKey('/requests/status', { requestId: 'r' }),
  );
});
