// Official campus-map reference records (Fairfield's Concept3D map): evidence only. They never
// move or confirm a stop, stay with their institution, keep the import key from riders, and
// carry links rather than copied descriptions or photos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness } from './harness.mjs';
import { CAMPUS_RECORD_KINDS, loadCampusMaps } from '../server/campus-map.mjs';

const imports = new URL('../server/imports/', import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, imports), 'utf8'));

test('the shipped Fairfield campus-map file accounts for every stop and copies no content', () => {
  const plan = read('fairfield-university-campus-map.json');
  const shuttles = read('fairfield-university-shuttles.json');
  const keys = Object.keys(shuttles.stops);
  assert.equal(plan.institutionName, shuttles.institutionName ?? 'Fairfield University');
  const matched = Object.keys(plan.stops);
  const unmatched = Object.keys(plan.unmatched);
  assert.deepEqual([...matched, ...unmatched].sort(), [...keys].sort(), 'all 23 stops, once each');
  assert.equal(matched.filter((k) => unmatched.includes(k)).length, 0);
  assert.match(plan.source.locationUrl, /^https:\/\/map\.concept3d\.com\/\?id=1895#!m\/\{id\}$/);
  for (const [key, entry] of Object.entries(plan.stops)) {
    assert.deepEqual(Object.keys(entry).sort(), ['note', 'photos', 'records'], key);
    assert.ok(entry.records.length, key);
    assert.ok(
      entry.records.some((r) => r.locationId === entry.photos),
      `${key}: the photo link points at one of its own records`,
    );
    for (const r of entry.records) {
      assert.deepEqual(Object.keys(r).sort(), ['kind', 'lat', 'lng', 'locationId', 'name'], key);
      assert.ok(CAMPUS_RECORD_KINDS.includes(r.kind), `${key}: ${r.kind}`);
      assert.ok(Number.isInteger(r.locationId));
      // Every Fairfield record is within the Fairfield / Bridgeport area.
      assert.ok(r.lat > 41.13 && r.lat < 41.2 && r.lng > -73.27 && r.lng < -73.16, key);
    }
    assert.ok(entry.note.length > 20 && entry.note.length <= 400, key);
  }
  // The confirmed examples from the user's brief.
  const barone = plan.stops['barone-traffic-circle'].records.find((r) => r.locationId === 938035);
  assert.equal(barone.name, 'Barone (John A.) Campus Center');
  assert.equal(plan.stops['1720-post-road'].records[0].locationId, 1070586);
  // Blocks 13 and 17 are not matched to the Townhouse Complex by assumption.
  for (const k of ['block-13-walkway', 'block-17-walkway'])
    assert.match(plan.unmatched[k], /no block numbers/);
  // No shuttle stops on the map: nothing is described as a boarding point.
  assert.doesNotMatch(JSON.stringify(plan.stops), /"kind":"(boarding|shuttle)/);
});

test('campus-map evidence never changes the researched suggestions’ coordinates', () => {
  const suggestions = read('fairfield-university-stop-suggestions.json');
  // Coordinates as researched on 2026-11-08 for two stops whose notes were updated.
  assert.deepEqual(
    [suggestions.stops['walsh-lot-crosswalk'].lat, suggestions.stops['walsh-lot-crosswalk'].lng],
    [41.162236, -73.257477],
  );
  assert.deepEqual(
    [suggestions.stops['jogues-health-center'].lat, suggestions.stops['jogues-health-center'].lng],
    [41.161489, -73.260737],
  );
  assert.match(suggestions.stops['walsh-lot-crosswalk'].basis, /G3/);
  assert.match(suggestions.stops['jogues-health-center'].basis, /Health & Wellness Center/);
});

test('campus-map records in the snapshot', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-campus-'));
  writeFileSync(
    join(dir, 'northbridge-campus-map.json'),
    JSON.stringify({
      institutionName: 'Northbridge University',
      checkedAt: '2026-11-16',
      source: {
        name: 'Northbridge campus map',
        url: 'https://maps.example.edu/',
        locationUrl: 'https://maps.example.edu/#loc/{id}',
      },
      stops: {
        'campus-center': {
          records: [
            {
              locationId: 11,
              name: 'Campus Center',
              kind: 'building',
              lat: 41.1601,
              lng: -73.2471,
            },
            { locationId: 12, name: 'Bad', kind: 'shuttle-stop', lat: 41.16, lng: -73.24 },
          ],
          photos: 11,
          note: 'Building point beside the stop; no shuttle stop is marked on this map.',
        },
      },
      unmatched: { 'block-9': 'Block numbers are not on the map.' },
    }),
  );
  const data = loadCampusMaps(dir);
  const set = data.get('Northbridge University');
  assert.deepEqual(
    set.stops.get('campus-center').records.map((r) => r.locationId),
    [11],
    'invalid kinds are skipped',
  );
  const h = await harness(t, { campusMapData: data });
  const db = h.app.db;
  db.prepare("UPDATE stops SET import_key='campus-center' WHERE id='northbridge-1'").run();
  db.prepare(
    "UPDATE stops SET import_key='block-9', status='draft' WHERE id='northbridge-2'",
  ).run();
  db.prepare("UPDATE stops SET import_key='campus-center' WHERE id='lakeside-1'").run();
  const before = JSON.stringify(db.prepare('SELECT * FROM stops ORDER BY id').all());

  const admin = await h.as('northbridge-admin').snapshot();
  const stop = admin.stops.find((s) => s.id === 'northbridge-1');
  assert.equal(stop.campus_map.boardingPoint, false);
  assert.equal(stop.campus_map.records.length, 1);
  assert.equal(stop.campus_map.records[0].url, 'https://maps.example.edu/#loc/11');
  assert.ok(Number.isInteger(stop.campus_map.records[0].distance), 'distance from the pin');
  assert.equal(stop.campus_photos.url, 'https://maps.example.edu/#loc/11');
  const draft = admin.stops.find((s) => s.id === 'northbridge-2');
  assert.equal(draft.campus_map.records.length, 0);
  assert.match(draft.campus_map.note, /Block numbers/);
  assert.equal(draft.campus_photos, undefined, 'no photo link without a match');

  const rider = await h.as('northbridge-student').snapshot();
  const seen = rider.stops.find((s) => s.id === 'northbridge-1');
  assert.deepEqual(seen.campus_photos, {
    name: 'Campus Center',
    url: 'https://maps.example.edu/#loc/11',
    source: 'Northbridge campus map',
  });
  assert.equal(seen.campus_map, undefined, 'evidence is for administrators');
  assert.ok(
    rider.stops.every((s) => !('import_key' in s)),
    'riders never get import keys',
  );
  assert.ok(!rider.stops.some((s) => s.id === 'northbridge-2'), 'drafts stay hidden');

  const other = await h.as('lakeside-admin').snapshot();
  assert.ok(
    other.stops.every((s) => !s.campus_map && !s.campus_photos),
    'another institution never gets these records',
  );

  // Read-only and repeatable: snapshots change nothing in the database.
  await h.as('northbridge-admin').snapshot();
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM stops ORDER BY id').all()), before);
  const source = readFileSync(new URL('../server/campus-map.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /INSERT|UPDATE|DELETE/);
});
