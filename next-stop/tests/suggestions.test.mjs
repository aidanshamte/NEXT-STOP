// Researched boarding-point suggestions: shown to administrators only, never boardable until
// approved, approved with the file's coordinates (not the client's), scoped by institution,
// and never applied to confirmed stops. Also checks the shipped Fairfield research file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSuggestions, validSuggestion } from '../server/suggestions.mjs';
import { harness } from './harness.mjs';

const data = new Map([
  [
    'Northbridge University',
    {
      stops: new Map([
        [
          'north-gate',
          {
            lat: 41.17,
            lng: -73.26,
            confidence: 'medium',
            basis: 'Crosswalk beside the north gate.',
            source: 'Test map',
            researchedAt: '2026-11-08',
          },
        ],
        [
          'old-stop',
          {
            lat: 1,
            lng: 1,
            confidence: 'high',
            basis: 'Should never move a confirmed stop.',
            source: 'Test map',
            researchedAt: null,
          },
        ],
      ]),
      unresolved: new Map([['block-9', 'Not on any map.']]),
    },
  ],
]);

test('suggestions: admin-only, one-tap approval, institution-scoped', async (t) => {
  const h = await harness(t, { suggestionData: data });
  const db = h.app.db;
  const draft = (id, org, key) =>
    db
      .prepare(
        "INSERT INTO stops(id,institution_id,name,lat,lng,position,status,import_key) VALUES (?,?,?,NULL,NULL,9,'draft',?)",
      )
      .run(id, org, `Stop ${key}`, key);
  draft('nb-gate', 'northbridge', 'north-gate');
  draft('nb-block', 'northbridge', 'block-9');
  draft('lk-gate', 'lakeside', 'north-gate');
  db.prepare("UPDATE stops SET import_key='old-stop' WHERE id='northbridge-0'").run();
  const admin = h.as('northbridge-admin'),
    student = h.as('northbridge-student'),
    lakeside = h.as('lakeside-admin');

  const adminStops = (await admin.snapshot()).stops;
  const gate = adminStops.find((s) => s.id === 'nb-gate');
  assert.equal(gate.suggestion.confidence, 'medium');
  assert.equal(gate.lat, null, 'a suggestion is not a pin');
  assert.equal(adminStops.find((s) => s.id === 'nb-block').unresolved, 'Not on any map.');
  assert.equal(
    adminStops.find((s) => s.id === 'northbridge-0').suggestion,
    undefined,
    'confirmed stops get no suggestion',
  );
  // Riders never see draft stops or suggestions, and cannot request pickup there.
  const riderStops = (await student.snapshot()).stops;
  assert.ok(!riderStops.some((s) => s.id === 'nb-gate'));
  assert.ok(!riderStops.some((s) => 'suggestion' in s || 'pin_source' in s));
  const pickup = await student.post('/requests', {
    tripId: 'bus',
    stopId: 'nb-gate',
    destinationId: 'northbridge-2',
  });
  assert.equal(pickup.status, 400);
  // Another institution with the same import key gets nothing (suggestions are per name).
  const other = (await lakeside.snapshot()).stops;
  assert.equal(other.find((s) => s.id === 'lk-gate').suggestion, undefined);
  assert.equal(
    (await lakeside.post('/stops/approve-suggestion', { stopId: 'lk-gate' })).status,
    400,
  );
  assert.equal(
    (await lakeside.post('/stops/approve-suggestion', { stopId: 'nb-gate' })).status,
    404,
    'cannot approve another institution’s stop',
  );
  // Only administrators approve.
  assert.equal(
    (await student.post('/stops/approve-suggestion', { stopId: 'nb-gate' })).status,
    403,
  );
  const driver = h.as('northbridge-driver');
  assert.equal((await driver.post('/stops/approve-suggestion', { stopId: 'nb-gate' })).status, 403);
  // Client-supplied coordinates are ignored: the file's point is used.
  const ok = await admin.post('/stops/approve-suggestion', { stopId: 'nb-gate', lat: 0, lng: 0 });
  assert.equal(ok.status, 200);
  const row = db.prepare("SELECT * FROM stops WHERE id='nb-gate'").get();
  assert.deepEqual([row.lat, row.lng, row.status], [41.17, -73.26, 'confirmed']);
  assert.match(row.pin_source, /^Approved suggestion \(medium confidence\)/);
  assert.equal(row.pinned_by, 'northbridge-admin');
  assert.equal(
    (await admin.post('/stops/approve-suggestion', { stopId: 'nb-gate' })).status,
    409,
    'approved once',
  );
  // A stop without a suggestion cannot be approved; a confirmed stop is never moved by one.
  assert.equal((await admin.post('/stops/approve-suggestion', { stopId: 'nb-block' })).status, 400);
  assert.equal(
    (await admin.post('/stops/approve-suggestion', { stopId: 'northbridge-0' })).status,
    409,
  );
  assert.equal(db.prepare("SELECT lat FROM stops WHERE id='northbridge-0'").get().lat, 41.16);
  // The approved stop is now boardable and visible to riders.
  assert.ok((await student.snapshot()).stops.some((s) => s.id === 'nb-gate'));
  // Manual pins record their source.
  await admin.post('/stops/pin', { stopId: 'nb-block', lat: 41.171, lng: -73.261, source: 'gps' });
  assert.match(
    db.prepare("SELECT pin_source FROM stops WHERE id='nb-block'").get().pin_source,
    /^Device GPS/,
  );
});

test('the shipped Fairfield research file is complete and well-formed', () => {
  const read = (name) =>
    JSON.parse(readFileSync(new URL(`../server/imports/${name}`, import.meta.url), 'utf8'));
  const file = read('fairfield-university-stop-suggestions.json');
  const routes = read('fairfield-university-shuttles.json');
  assert.equal(file.institutionName, routes.institutionName);
  const keys = Object.keys(routes.stops);
  assert.equal(keys.length, 23);
  for (const key of keys)
    assert.ok(
      file.stops[key] || file.unresolved[key],
      `${key} needs a suggestion or a reason it has none`,
    );
  for (const [key, s] of Object.entries(file.stops)) {
    assert.ok(keys.includes(key), `${key} is a stop on the sign`);
    assert.ok(validSuggestion(s), `${key} is valid`);
    // Fairfield and Bridgeport, Connecticut.
    assert.ok(s.lat > 41.1 && s.lat < 41.25 && s.lng > -73.3 && s.lng < -73.1, `${key} is local`);
  }
  const loaded = loadSuggestions().get('Fairfield University');
  assert.equal(loaded.stops.size, Object.keys(file.stops).length, 'every entry loads');
});
