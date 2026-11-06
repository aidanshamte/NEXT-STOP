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
  const p = buildMapPayload(stops, trip, { pickupId: 'a', destinationId: 'b' }, now);
  assert.deepEqual(
    p.stops.map((s) => [s.name, s.kind]),
    [
      ['Stop A', 'pickup'],
      ['Stop B', 'dest'],
    ],
  );
  assert.deepEqual(p.bus, { lat: 41.15, lng: -73.25, stale: false });
  assert.match(mapLabel(p, 'Shuttle 1'), /latest GPS position/);
});

test('an old fix is drawn as stale; ended service or no fix shows no vehicle', () => {
  assert.equal(
    buildMapPayload(stops, { ...trip, updated_at: now - 60000 }, {}, now).bus.stale,
    true,
  );
  assert.equal(buildMapPayload(stops, { ...trip, active: 0 }, {}, now).bus, null);
  assert.equal(buildMapPayload(stops, { ...trip, lat: null, lng: null }, {}, now).bus, null);
  assert.match(mapLabel(buildMapPayload(stops, undefined, {}, now)), /not available/);
});

test('the website map frame is the same document as the native map', () => {
  assert.equal(readFileSync('public/map.html', 'utf8'), MAP_HTML);
  assert.match(MAP_HTML, /integrity="sha384-[A-Za-z0-9+/=]+" crossorigin="anonymous"><\/script>/);
  assert.match(MAP_HTML, /setText\(s\.name\)/, 'stop names are set as text, not HTML');
  assert.doesNotMatch(MAP_HTML, /innerHTML/);
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
  assert.match(map, /script-src 'unsafe-inline' https:\/\/unpkg\.com\/maplibre-gl@4\.7\.1\/ blob:;/);
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
