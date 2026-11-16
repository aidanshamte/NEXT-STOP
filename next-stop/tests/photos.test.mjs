// Stop photos: metadata removal, sizes, records of source and licence, verification before
// riders see them, institution scoping, and researched photos an administrator applies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { imageSize, loadPhotoSuggestions, stripMetadata } from '../server/photos.mjs';
import { migrate } from '../server/db.mjs';
import { harness } from './harness.mjs';
import { SECRET, jpeg, png, webp } from './images.mjs';

const b64 = (b) => b.toString('base64');
const has = (b, text) => b.toString('latin1').includes(text);

test('metadata, including GPS, is removed from JPEG, PNG and WebP; image data is kept', () => {
  for (const [type, image] of [
    ['image/jpeg', jpeg()],
    ['image/png', png()],
    ['image/webp', webp()],
  ]) {
    assert.ok(has(image, SECRET), `${type} fixture carries metadata`);
    const clean = stripMetadata(image, type);
    assert.ok(clean, type);
    assert.ok(!has(clean, SECRET), `${type}: metadata removed`);
    assert.ok(!has(clean, 'Exif') && !has(clean, 'xmpmeta'), type);
    assert.deepEqual(imageSize(clean, type), { width: 640, height: 480 }, type);
    assert.ok(clean.length > 100, `${type}: image data kept`);
  }
  // Colour information is kept: the ICC profile and the PNG sRGB chunk.
  assert.ok(has(stripMetadata(jpeg(), 'image/jpeg'), 'ICC_PROFILE'));
  assert.ok(has(stripMetadata(png(), 'image/png'), 'sRGB'));
  // WebP: the extended header no longer claims EXIF or XMP, and the RIFF size is consistent.
  const w = stripMetadata(webp(), 'image/webp');
  assert.equal(w[20] & 0x0c, 0);
  assert.equal(w.readUInt32LE(4), w.length - 8);
  assert.equal(stripMetadata(Buffer.from('not an image'), 'image/jpeg'), null);
});

test('uploading, describing and verifying a stop photo', async (t) => {
  const h = await harness(t);
  const admin = h.as('northbridge-admin'),
    student = h.as('northbridge-student'),
    otherAdmin = h.as('lakeside-admin');
  const stopId = 'northbridge-1';
  const photo = { stopId, contentType: 'image/jpeg', data: b64(jpeg(1600, 900)) };
  const riderStop = async () => (await student.snapshot()).stops.find((s) => s.id === stopId);
  const adminStop = async () => (await admin.snapshot()).stops.find((s) => s.id === stopId);

  await t.test('only administrators of the institution upload valid images', async () => {
    assert.equal((await student.post('/stops/photo', photo)).status, 403);
    assert.equal(
      (await otherAdmin.post('/stops/photo', { ...photo, institutionId: 'northbridge' })).status,
      403,
    );
    assert.equal((await otherAdmin.post('/stops/photo', photo)).status, 404, 'other institution');
    assert.equal(
      (await admin.post('/stops/photo', { ...photo, contentType: 'image/png' })).status,
      400,
      'declared type must match the bytes',
    );
    assert.equal(
      (await admin.post('/stops/photo', { ...photo, data: b64(Buffer.from('<svg/>')) })).status,
      400,
    );
    assert.equal(
      (await admin.post('/stops/photo', { ...photo, data: b64(jpeg(100, 80)) })).status,
      400,
      'too small to be useful',
    );
    const big = Buffer.concat([jpeg(), Buffer.alloc(950 * 1024)]);
    assert.equal((await admin.post('/stops/photo', { ...photo, data: b64(big) })).status, 413);
    assert.equal(
      (await admin.post('/stops/photo', { ...photo, thumbData: b64(jpeg(1200, 900)) })).status,
      400,
      'preview must be small',
    );
    assert.equal(
      (await admin.post('/stops/photo', { ...photo, sourceUrl: 'http://example.com/x' })).status,
      400,
      'links must be https',
    );
  });

  await t.test('an unverified photo is stored clean and hidden from riders', async () => {
    // Older app versions send only the image: accepted, but it cannot be verified yet.
    assert.equal(
      (await admin.post('/stops/photo', { ...photo, thumbData: b64(jpeg(480, 270)) })).status,
      200,
    );
    const stored = h.app.db
      .prepare('SELECT data,thumb FROM stop_photos WHERE stop_id=?')
      .get(stopId);
    assert.ok(!has(Buffer.from(stored.data), SECRET), 'GPS/EXIF removed before storage');
    assert.ok(!has(Buffer.from(stored.thumb), SECRET));
    const mine = await adminStop();
    assert.equal(mine.photo.verified, false);
    assert.equal(mine.photo.width, 1600);
    assert.ok(mine.photo.missing.length >= 3);
    const rider = await riderStop();
    assert.equal(rider.has_photo, 0);
    assert.equal(rider.photo, undefined);
    assert.equal((await student.get('/stops/photo', `&stopId=${stopId}`)).status, 404);
    assert.equal((await admin.get('/stops/photo', `&stopId=${stopId}`)).status, 200);
  });

  await t.test(
    'verification needs a description, source and credit, and the shown version',
    async () => {
      const version = (await adminStop()).photo.version;
      let r = await admin.post('/stops/photo/verify', { stopId, version });
      assert.equal(r.status, 400);
      assert.match(r.data.error, /alt text/);
      r = await admin.post('/stops/photo/details', {
        stopId,
        alt: 'Covered bench beside Library Square crosswalk',
        shows: 'boarding',
        source: 'licensed',
        credit: 'A. Photographer',
      });
      assert.equal(r.status, 200);
      r = await admin.post('/stops/photo/verify', { stopId, version });
      assert.equal(r.status, 400, 'licensed photos need the licence and a link');
      assert.match(r.data.error, /licence/);
      await admin.post('/stops/photo/details', {
        stopId,
        license: 'CC BY-SA 4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
      });
      assert.equal(
        (await admin.post('/stops/photo/verify', { stopId, version: version - 1 })).status,
        409,
        'a photo the administrator has not seen is never verified',
      );
      h.app.db.prepare("UPDATE stops SET status='draft' WHERE id=?").run(stopId);
      assert.equal((await admin.post('/stops/photo/verify', { stopId, version })).status, 409);
      h.app.db.prepare("UPDATE stops SET status='confirmed' WHERE id=?").run(stopId);
      assert.equal((await admin.post('/stops/photo/verify', { stopId, version })).status, 200);
    },
  );

  await t.test('riders then see the photo, its credit, and the small preview', async () => {
    const rider = await riderStop();
    assert.equal(rider.has_photo, 1);
    assert.equal(rider.photo.alt, 'Covered bench beside Library Square crosswalk');
    assert.equal(rider.photo.license, 'CC BY-SA 4.0');
    assert.equal(rider.photo.verifiedBy, undefined, 'administrator names stay with admins');
    const full = await student.get('/stops/photo', `&stopId=${stopId}`);
    const thumb = await student.get('/stops/photo', `&stopId=${stopId}&size=thumb`);
    assert.equal(full.data.size, 'full');
    assert.equal(thumb.data.size, 'thumb');
    assert.deepEqual(imageSize(Buffer.from(thumb.data.data, 'base64'), 'image/jpeg'), {
      width: 480,
      height: 270,
    });
    assert.ok(!has(Buffer.from(full.data.data, 'base64'), SECRET));
    assert.equal(
      (
        await h.call(
          `/stops/photo?institutionId=lakeside&stopId=${stopId}`,
          h.tokens['lakeside-student'],
        )
      ).status,
      404,
      'institution-scoped',
    );
    // Draft stops never expose a photo to riders.
    h.app.db.prepare("UPDATE stops SET status='draft' WHERE id=?").run(stopId);
    assert.equal((await student.get('/stops/photo', `&stopId=${stopId}`)).status, 404);
    h.app.db.prepare("UPDATE stops SET status='confirmed' WHERE id=?").run(stopId);
  });

  await t.test('replacing or re-describing a photo needs a fresh verification', async () => {
    const before = (await adminStop()).photo.version;
    assert.equal(
      (
        await admin.post('/stops/photo', {
          ...photo,
          data: b64(png(800, 600)),
          contentType: 'image/png',
          alt: 'New photo of the shelter',
          source: 'own',
          shows: 'boarding',
        })
      ).status,
      200,
    );
    const after = (await adminStop()).photo;
    assert.ok(after.version > before);
    assert.equal(after.verified, false);
    assert.equal((await riderStop()).has_photo, 0);
    assert.equal(
      (await admin.post('/stops/photo/verify', { stopId, version: after.version })).status,
      200,
    );
    await admin.post('/stops/photo/details', {
      stopId,
      alt: 'Shelter on the north side of the road',
    });
    assert.equal((await adminStop()).photo.verified, false);
    assert.equal((await admin.post('/stops/photo/delete', { stopId })).status, 200);
    assert.equal((await admin.get('/stops/photo', `&stopId=${stopId}`)).status, 404);
  });
});

test('researched photos are applied by an administrator and still need verification', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-photos-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'photos'));
  writeFileSync(join(dir, 'photos', 'campus-center.jpg'), jpeg(1280, 853));
  writeFileSync(join(dir, 'photos', 'campus-center-thumb.jpg'), jpeg(480, 320));
  const entry = {
    file: 'campus-center.jpg',
    thumb: 'campus-center-thumb.jpg',
    alt: 'Campus Center entrance seen from the drive',
    shows: 'landmark',
    source: 'licensed',
    credit: 'Example Author',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    match: 'Camera position 30 m from the stop; building named in the file description.',
  };
  writeFileSync(
    join(dir, 'northbridge-stop-photos.json'),
    JSON.stringify({
      institutionName: 'Northbridge University',
      researchedAt: '2026-11-15',
      photos: {
        'campus-center': entry,
        broken: { ...entry, file: 'missing.jpg' },
        bad: { ...entry, alt: 'x' },
      },
    }),
  );
  const data = loadPhotoSuggestions(dir);
  assert.deepEqual(
    [...data.get('Northbridge University').keys()],
    ['campus-center'],
    'invalid entries skipped',
  );
  const h = await harness(t, { photoData: data });
  h.app.db.prepare("UPDATE stops SET import_key='campus-center' WHERE id='northbridge-0'").run();
  const admin = h.as('northbridge-admin'),
    student = h.as('northbridge-student');
  let stop = (await admin.snapshot()).stops.find((s) => s.id === 'northbridge-0');
  assert.equal(stop.photo_suggestion.credit, 'Example Author');
  for (const k of ['alt', 'shows', 'credit', 'license', 'licenseUrl', 'sourceUrl', 'match'])
    assert.equal(stop.photo_suggestion[k], entry[k], `the admin sees the exact ${k}`);
  assert.equal(
    (await student.snapshot()).stops.find((s) => s.id === 'northbridge-0').photo_suggestion,
    undefined,
    'suggestions are for administrators only',
  );
  assert.equal(
    (await h.as('lakeside-admin').snapshot()).stops.some((s) => s.photo_suggestion),
    false,
    'other institutions never see them',
  );
  assert.equal(
    (await student.post('/stops/photo/suggested', { stopId: 'northbridge-0' })).status,
    403,
  );
  assert.equal(
    (await admin.post('/stops/photo/suggested', { stopId: 'northbridge-1' })).status,
    404,
  );
  assert.equal(
    (await admin.post('/stops/photo/suggested', { stopId: 'northbridge-0' })).status,
    200,
  );
  assert.equal(
    (await admin.post('/stops/photo/suggested', { stopId: 'northbridge-0' })).status,
    409,
  );
  stop = (await admin.snapshot()).stops.find((s) => s.id === 'northbridge-0');
  assert.equal(stop.photo_suggestion, undefined);
  assert.equal(stop.photo.verified, false);
  assert.equal(stop.photo.source, 'licensed');
  assert.equal(stop.photo.license, 'CC BY 4.0');
  assert.equal(stop.photo.shows, entry.shows, 'applied with the researched label, not upgraded');
  assert.equal(stop.photo.licenseUrl, entry.licenseUrl);
  assert.equal(stop.photo.sourceUrl, entry.sourceUrl);
  assert.deepEqual(stop.photo.missing, []);
  assert.equal((await student.snapshot()).stops.find((s) => s.id === 'northbridge-0').has_photo, 0);
  assert.equal(
    (
      await admin.post('/stops/photo/verify', {
        stopId: 'northbridge-0',
        version: stop.photo.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (await student.snapshot()).stops.find((s) => s.id === 'northbridge-0').photo.shows,
    'landmark',
  );
});

test('migration 11 strips stored photos and keeps only photos verified after upload visible', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  migrate(db, 10);
  db.exec(`INSERT INTO institutions VALUES ('i','I','college');
    INSERT INTO stops(id,institution_id,name,lat,lng,position,status,details_verified_at,details_verified_by)
      VALUES ('a','i','A',1,1,0,'confirmed',2000,'Ann'),('b','i','B',1,2,1,'confirmed',500,'Ann'),('c','i','C',1,3,2,'confirmed',NULL,NULL);`);
  const insert = db.prepare(
    'INSERT INTO stop_photos(stop_id,institution_id,data,content_type,updated_at) VALUES (?,?,?,?,1000)',
  );
  insert.run('a', 'i', jpeg(), 'image/jpeg');
  insert.run('b', 'i', png(), 'image/png');
  insert.run('c', 'i', Buffer.from('garbage-bytes-here'), 'image/jpeg');
  migrate(db);
  const rows = Object.fromEntries(
    db
      .prepare('SELECT stop_id,data,verified_at,verified_by,width FROM stop_photos')
      .all()
      .map((r) => [r.stop_id, r]),
  );
  assert.equal(rows.a.verified_at, 2000, 'stop verified after the photo was added');
  assert.equal(rows.a.verified_by, 'Ann');
  assert.equal(rows.b.verified_at, null, 'verified before this photo was added');
  assert.equal(rows.c.verified_at, null);
  assert.ok(!has(Buffer.from(rows.a.data), SECRET));
  assert.ok(!has(Buffer.from(rows.b.data), SECRET));
  assert.equal(rows.a.width, 640);
});

test('the shipped Fairfield photos are complete, clean, small and match real stop keys', async () => {
  const { readFileSync } = await import('node:fs');
  const data = loadPhotoSuggestions();
  const photos = data.get('Fairfield University');
  const plan = JSON.parse(
    readFileSync(
      new URL('../server/imports/fairfield-university-stop-photos.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(photos.size, Object.keys(plan.photos).length, 'every entry is valid');
  const shuttles = JSON.parse(
    readFileSync(
      new URL('../server/imports/fairfield-university-shuttles.json', import.meta.url),
      'utf8',
    ),
  );
  const keys = new Set(Object.keys(shuttles.stops));
  for (const [key, p] of photos) {
    assert.ok(keys.has(key), `${key} is a Fairfield stop`);
    assert.equal(
      p.shows,
      'landmark',
      `${key}: no researched photo is claimed to show a boarding spot`,
    );
    assert.match(p.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    for (const [file, limit] of [
      [p.file, 900 * 1024],
      [p.thumb, 120 * 1024],
    ]) {
      const bytes = readFileSync(new URL(`../server/imports/photos/${file}`, import.meta.url));
      assert.ok(bytes.length <= limit, `${file} size`);
      assert.equal(
        stripMetadata(bytes, 'image/jpeg').length,
        bytes.length,
        `${file} has no metadata`,
      );
    }
  }
});
