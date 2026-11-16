// Stop photos: institution-scoped, managed by administrators, and shown to riders only after
// an administrator verifies that the photo shows this stop and records where it came from.
//
// Every stored image has its metadata removed here (EXIF including GPS, XMP, IPTC, comments,
// text chunks), whatever the client did. Two sizes are kept: a small preview for lists and the
// pickup card, and the detail photo. Neither is ever part of the map or the realtime snapshot;
// clients fetch them only when a photo is on screen.
//
// Researched photos for an institution's stops ship as reviewed files in
// server/imports/*-stop-photos.json (+ the images in server/imports/photos/). An administrator
// applies one with a tap; it is stored unverified like any upload, so it still has to be checked
// and verified before riders see it.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHOTO_LIMIT = 900 * 1024;
export const THUMB_LIMIT = 120 * 1024;
export const PHOTO_SOURCES = ['own', 'institution', 'licensed'];
export const PHOTO_SHOWS = ['boarding', 'landmark'];
const MIN_SIDE = 160;
const MAX_SIDE = 4096;

const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};
export const isPhotoType = (type) => Object.hasOwn(SIGNATURES, type);
export const matchesType = (bytes, type) =>
  isPhotoType(type) && bytes.length >= 16 && SIGNATURES[type](bytes);

// --- Metadata removal -------------------------------------------------------------------------

/** JPEG: keeps the image data, quantisation/Huffman tables, JFIF, Adobe and ICC colour
 * segments; drops Exif/XMP (APP1), every other APPn and comments. */
function stripJpeg(b) {
  const out = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw Error('bad marker');
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Start of scan: the rest is entropy-coded image data and the end marker.
    if (marker === 0xda) {
      out.push(b.subarray(i));
      return Buffer.concat(out);
    }
    const length = b.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > b.length) throw Error('bad segment');
    const segment = b.subarray(i, i + 2 + length);
    const app = marker >= 0xe0 && marker <= 0xef;
    const keep = app
      ? marker === 0xe0 ||
        marker === 0xee ||
        (marker === 0xe2 && segment.subarray(4, 15).toString('latin1') === 'ICC_PROFILE')
      : marker !== 0xfe;
    if (keep) out.push(segment);
    i += 2 + length;
  }
  throw Error('no image data');
}

const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'pHYs',
  'bKGD',
]);
/** PNG: keeps image and colour chunks; drops eXIf, text, time and any other ancillary chunk. */
function stripPng(b) {
  const out = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const length = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + length;
    if (end > b.length) throw Error('bad chunk');
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  throw Error('no end chunk');
}

/** WebP: drops the EXIF and XMP chunks and clears their flags in the extended header. */
function stripWebp(b) {
  const chunks = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = b.subarray(i, i + 4).toString('latin1');
    const size = b.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > b.length) throw Error('bad chunk');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(b.subarray(i, Math.min(end, b.length)));
      if (type === 'VP8X') chunk[8] &= ~(0x08 | 0x04);
      chunks.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([head, body]);
}

/** The image without embedded metadata, or null when the file is malformed. */
export function stripMetadata(bytes, type) {
  try {
    if (type === 'image/jpeg') return stripJpeg(bytes);
    if (type === 'image/png') return stripPng(bytes);
    if (type === 'image/webp') return stripWebp(bytes);
  } catch {
    return null;
  }
  return null;
}

/** Pixel dimensions from the image header, or null. */
export function imageSize(b, type) {
  try {
    if (type === 'image/png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        if (marker === 0xff) {
          i += 1;
          continue;
        }
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        if (marker === 0xda) return null;
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (type === 'image/webp') {
      const kind = b.subarray(12, 16).toString('latin1');
      if (kind === 'VP8X')
        return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (kind === 'VP8 ')
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Validates and cleans one uploaded image; `fail` is called with a rider-readable reason. */
export function prepareImage(fail, data, type, limit, label) {
  if (!isPhotoType(type)) fail(400, 'Use a JPEG, PNG or WebP photo.');
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(data))
    fail(400, `Invalid ${label} data.`);
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > limit)
    fail(
      413,
      `${label === 'photo' ? 'Photo' : 'Preview'} is too large. Use one under ${Math.round(limit / 1024)} KB.`,
    );
  if (!matchesType(bytes, type)) fail(400, 'The file is not a valid photo.');
  const clean = stripMetadata(bytes, type);
  const size = clean && imageSize(clean, type);
  if (!clean || !size) fail(400, 'The file is not a valid photo.');
  if (Math.min(size.width, size.height) < MIN_SIDE || Math.max(size.width, size.height) > MAX_SIDE)
    fail(400, `Use a photo between ${MIN_SIDE} and ${MAX_SIDE} pixels on each side.`);
  return { bytes: clean, ...size };
}

// --- Researched photos shipped with the release -----------------------------------------------

const httpsUrl = (u) => typeof u === 'string' && /^https:\/\/[^\s"<>]{3,300}$/.test(u);
export function validPhotoSuggestion(p, dir) {
  if (
    !p ||
    typeof p.file !== 'string' ||
    !/^[a-z0-9-]+\.(jpg|png|webp)$/.test(p.file) ||
    (p.thumb != null &&
      (typeof p.thumb !== 'string' || !/^[a-z0-9-]+\.(jpg|png|webp)$/.test(p.thumb))) ||
    typeof p.alt !== 'string' ||
    p.alt.trim().length < 10 ||
    !PHOTO_SHOWS.includes(p.shows) ||
    !PHOTO_SOURCES.includes(p.source) ||
    typeof p.credit !== 'string' ||
    !p.credit.trim() ||
    typeof p.license !== 'string' ||
    !p.license.trim() ||
    !httpsUrl(p.sourceUrl) ||
    (p.licenseUrl != null && !httpsUrl(p.licenseUrl)) ||
    typeof p.match !== 'string' ||
    !p.match.trim()
  )
    return false;
  try {
    readFileSync(join(dir, 'photos', p.file));
    if (p.thumb) readFileSync(join(dir, 'photos', p.thumb));
  } catch {
    return false;
  }
  return true;
}

export function loadPhotoSuggestions(dir = fileURLToPath(new URL('./imports/', import.meta.url))) {
  const byInstitution = new Map();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('-stop-photos.json'));
  } catch {
    return byInstitution;
  }
  for (const file of files) {
    const plan = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (typeof plan.institutionName !== 'string' || !plan.photos) continue;
    const photos = new Map();
    for (const [key, p] of Object.entries(plan.photos))
      if (validPhotoSuggestion(p, dir))
        photos.set(key, { ...p, researchedAt: plan.researchedAt || null, dir });
    byInstitution.set(plan.institutionName, photos);
  }
  return byInstitution;
}
const typeOf = (file) =>
  file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

// --- Routes -------------------------------------------------------------------------------------

export function createPhotos({ db, clock, fail, data = loadPhotoSuggestions() }) {
  const requireAdmin = (member) => member.role !== 'admin' && fail(403, 'Admin access required.');
  const stopIn = (id, org) =>
    typeof id === 'string' &&
    db.prepare('SELECT * FROM stops WHERE id=? AND institution_id=?').get(id, org);
  const nameOf = (uid) => db.prepare('SELECT name FROM users WHERE id=?').get(uid)?.name || '';
  const suggestionsFor = (org) => {
    const row = db.prepare('SELECT name FROM institutions WHERE id=?').get(org);
    return row ? data.get(row.name) : undefined;
  };
  const optional = (body, key, max) => {
    const v = body[key];
    if (v == null) return undefined;
    if (typeof v !== 'string' || v.trim().length > max) fail(400, `Invalid ${key}.`);
    return v.trim();
  };
  /** Source, credit and description fields; undefined keeps the stored value. */
  function details(body) {
    const d = {
      alt: optional(body, 'alt', 200),
      credit: optional(body, 'credit', 120),
      license: optional(body, 'license', 60),
      source_url: optional(body, 'sourceUrl', 300),
      license_url: optional(body, 'licenseUrl', 300),
      source: optional(body, 'source', 20),
      shows: optional(body, 'shows', 20),
    };
    if (d.source !== undefined && d.source && !PHOTO_SOURCES.includes(d.source))
      fail(400, 'Choose who took or owns the photo.');
    if (d.shows !== undefined && d.shows && !PHOTO_SHOWS.includes(d.shows))
      fail(400, 'Choose what the photo shows.');
    for (const k of ['source_url', 'license_url'])
      if (d[k] && !httpsUrl(d[k])) fail(400, 'Links must start with https://.');
    return d;
  }
  /** What is still missing before a photo can be verified, as administrator-readable text. */
  function missing(p) {
    const out = [];
    if (!p.alt || p.alt.length < 10) out.push('a description of what the photo shows (alt text)');
    if (!p.source) out.push('who took or owns it');
    if (p.source && p.source !== 'own' && !p.credit) out.push('the credit or attribution');
    if (p.source === 'licensed' && !p.license) out.push('the licence');
    if (p.source === 'licensed' && !p.source_url) out.push('a link to the original');
    if (!p.shows) out.push('whether it shows the boarding area or a landmark');
    return out;
  }
  const META =
    'stop_id,content_type,updated_at,thumb IS NOT NULL AS has_thumb,width,height,alt,source,credit,license,license_url,source_url,shows,verified_at,verified_by,uploaded_by';

  /** Photo details for snapshot stops. Riders see verified photos only; admins see all. */
  function meta(stops, member) {
    if (!stops.length) return new Map();
    const rows = db
      .prepare(
        `SELECT ${META} FROM stop_photos WHERE stop_id IN (${stops.map(() => '?').join(',')})`,
      )
      .all(...stops.map((s) => s.id));
    const admin = member?.role === 'admin';
    const out = new Map();
    for (const p of rows) {
      if (!admin && !p.verified_at) continue;
      out.set(p.stop_id, {
        version: p.updated_at,
        alt: p.alt,
        shows: p.shows,
        source: p.source,
        credit: p.credit,
        license: p.license,
        licenseUrl: p.license_url,
        sourceUrl: p.source_url,
        verified: !!p.verified_at,
        verifiedAt: p.verified_at,
        ...(admin
          ? {
              verifiedBy: p.verified_by,
              uploadedBy: p.uploaded_by,
              width: p.width,
              height: p.height,
              missing: missing(p),
            }
          : {}),
      });
    }
    return out;
  }
  /** Administrators: a researched photo available for a stop that has none. */
  function suggestion(org, stop, hasPhoto) {
    if (hasPhoto || !stop.import_key) return undefined;
    const p = suggestionsFor(org)?.get(stop.import_key);
    return p
      ? {
          alt: p.alt,
          shows: p.shows,
          credit: p.credit,
          license: p.license,
          sourceUrl: p.sourceUrl,
          match: p.match,
          researchedAt: p.researchedAt,
        }
      : undefined;
  }

  function store(stop, org, uid, image, thumb, d) {
    const now = clock();
    db.prepare(
      `INSERT INTO stop_photos(stop_id,institution_id,data,content_type,updated_at,thumb,thumb_type,width,height,alt,source,credit,license,license_url,source_url,shows,verified_at,verified_by,uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)
       ON CONFLICT(stop_id) DO UPDATE SET data=excluded.data,content_type=excluded.content_type,updated_at=excluded.updated_at,
         thumb=excluded.thumb,thumb_type=excluded.thumb_type,width=excluded.width,height=excluded.height,alt=excluded.alt,
         source=excluded.source,credit=excluded.credit,license=excluded.license,license_url=excluded.license_url,
         source_url=excluded.source_url,shows=excluded.shows,verified_at=NULL,verified_by=NULL,uploaded_by=excluded.uploaded_by`,
    ).run(
      stop.id,
      org,
      image.bytes,
      image.type,
      // Version: always increases, so clients never show a cached older image.
      Math.max(
        now,
        (db.prepare('SELECT updated_at FROM stop_photos WHERE stop_id=?').get(stop.id)
          ?.updated_at ?? 0) + 1,
      ),
      thumb?.bytes ?? null,
      thumb?.type ?? null,
      image.width,
      image.height,
      d.alt ?? '',
      d.source ?? '',
      d.credit ?? '',
      d.license ?? '',
      d.license_url ?? '',
      d.source_url ?? '',
      d.shows ?? '',
      nameOf(uid),
    );
  }

  async function handle({ path, method, body, url, uid, member, org, send, text }) {
    if (method === 'GET') {
      if (path !== '/stops/photo') return false;
      const stop = stopIn(url.searchParams.get('stopId'), org);
      const admin = member.role === 'admin';
      if (!stop || (stop.status !== 'confirmed' && !admin)) fail(404, 'Stop not found.');
      const photo = db
        .prepare(
          'SELECT data,content_type,thumb,thumb_type,updated_at,verified_at FROM stop_photos WHERE stop_id=?',
        )
        .get(stop.id);
      if (!photo || (!photo.verified_at && !admin)) fail(404, 'No photo for this stop.');
      const small = url.searchParams.get('size') === 'thumb' && photo.thumb;
      send(200, {
        contentType: small ? photo.thumb_type : photo.content_type,
        data: Buffer.from(small ? photo.thumb : photo.data).toString('base64'),
        updatedAt: photo.updated_at,
        size: small ? 'thumb' : 'full',
      });
      return true;
    }
    switch (path) {
      case '/stops/photo': {
        requireAdmin(member);
        const stop = stopIn(text('stopId'), org);
        if (!stop) fail(404, 'Stop not found.');
        const type = text('contentType');
        const image = { ...prepareImage(fail, body.data, type, PHOTO_LIMIT, 'photo'), type };
        let thumb = null;
        if (body.thumbData != null) {
          const thumbType = typeof body.thumbType === 'string' ? body.thumbType : type;
          thumb = {
            ...prepareImage(fail, body.thumbData, thumbType, THUMB_LIMIT, 'preview'),
            type: thumbType,
          };
          if (Math.max(thumb.width, thumb.height) > 800)
            fail(400, 'The preview must be 800 pixels or smaller.');
        }
        store(stop, org, uid, image, thumb, details(body));
        send(200, { ok: true });
        return true;
      }
      case '/stops/photo/details': {
        requireAdmin(member);
        const stop = stopIn(text('stopId'), org);
        if (!stop) fail(404, 'Stop not found.');
        const row = db.prepare('SELECT * FROM stop_photos WHERE stop_id=?').get(stop.id);
        if (!row) fail(404, 'No photo for this stop.');
        const d = details(body);
        const next = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? row[k]]));
        // Changing what the photo is said to show or where it came from needs a fresh check.
        db.prepare(
          'UPDATE stop_photos SET alt=?,source=?,credit=?,license=?,license_url=?,source_url=?,shows=?,verified_at=NULL,verified_by=NULL WHERE stop_id=?',
        ).run(
          next.alt,
          next.source,
          next.credit,
          next.license,
          next.license_url,
          next.source_url,
          next.shows,
          stop.id,
        );
        send(200, { ok: true });
        return true;
      }
      case '/stops/photo/verify': {
        requireAdmin(member);
        const stop = stopIn(text('stopId'), org);
        if (!stop) fail(404, 'Stop not found.');
        if (stop.status !== 'confirmed')
          fail(409, 'Confirm the stop’s boarding point before verifying its photo.');
        const row = db.prepare('SELECT * FROM stop_photos WHERE stop_id=?').get(stop.id);
        if (!row) fail(404, 'No photo for this stop.');
        // The client sends the version it showed, so a replaced photo is never verified unseen.
        if (body.version !== row.updated_at)
          fail(409, 'The photo changed. Review the current photo before verifying it.');
        const gaps = missing(row);
        if (gaps.length) fail(400, `Before verifying, add ${gaps.join(', ')}.`);
        db.prepare('UPDATE stop_photos SET verified_at=?,verified_by=? WHERE stop_id=?').run(
          clock(),
          nameOf(uid),
          stop.id,
        );
        send(200, { ok: true });
        return true;
      }
      case '/stops/photo/delete': {
        requireAdmin(member);
        const stop = stopIn(text('stopId'), org);
        if (!stop) fail(404, 'Stop not found.');
        db.prepare('DELETE FROM stop_photos WHERE stop_id=?').run(stop.id);
        send(200, { ok: true });
        return true;
      }
      case '/stops/photo/suggested': {
        requireAdmin(member);
        const stop = stopIn(text('stopId'), org);
        if (!stop) fail(404, 'Stop not found.');
        if (db.prepare('SELECT 1 FROM stop_photos WHERE stop_id=?').get(stop.id))
          fail(409, 'This stop already has a photo. Remove it first to use the researched one.');
        // The image and its record come from the shipped file, never from the client.
        const p = stop.import_key && suggestionsFor(org)?.get(stop.import_key);
        if (!p) fail(404, 'No researched photo for this stop.');
        const load = (file) => {
          const type = typeOf(file);
          const raw = readFileSync(join(p.dir, 'photos', file));
          const bytes = stripMetadata(raw, type);
          const size = bytes && imageSize(bytes, type);
          if (!size) fail(500, 'The researched photo file is damaged.');
          return { bytes, type, ...size };
        };
        store(stop, org, uid, load(p.file), p.thumb ? load(p.thumb) : null, {
          alt: p.alt.trim().slice(0, 200),
          source: p.source,
          credit: p.credit.trim().slice(0, 120),
          license: p.license.trim().slice(0, 60),
          license_url: p.licenseUrl || '',
          source_url: p.sourceUrl,
          shows: p.shows,
        });
        send(200, { ok: true });
        return true;
      }
    }
    return false;
  }
  return { meta, suggestion, handle, missing };
}
