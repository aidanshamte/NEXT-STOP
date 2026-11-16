// Reference records from an institution's official campus map, shipped as reviewed files in
// server/imports/*-campus-map.json (today: Fairfield University's Concept3D map).
//
// They are evidence, never data the app acts on by itself:
// - Read-only: nothing here writes to the database or changes a stop's position or status,
//   so loading the file any number of times has the same effect (none).
// - Scoped by institution name, so another institution never sees them.
// - Each record is a building, lot, entrance or view point from the map. None is a shuttle
//   boarding point, and none is ever used as one.
// - Only official names, location IDs, kinds, pin positions and links are kept. The map's
//   descriptions and photos are not copied; riders get a link to the official photos instead.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAMPUS_RECORD_KINDS = ['building', 'parking', 'entrance', 'viewpoint', 'campus'];
const KINDS = new Set(CAMPUS_RECORD_KINDS);

const meters = (a, b) => {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.round(Math.sqrt(x * x + y * y) * 6371000);
};

const validRecord = (r) =>
  r &&
  Number.isInteger(r.locationId) &&
  r.locationId > 0 &&
  typeof r.name === 'string' &&
  r.name.trim() &&
  KINDS.has(r.kind) &&
  Number.isFinite(r.lat) &&
  Number.isFinite(r.lng) &&
  Math.abs(r.lat) <= 90 &&
  Math.abs(r.lng) <= 180;

/** Loads every campus-map file in `dir`, keyed by institution name. Invalid records are
 * skipped, so one bad entry cannot disable the rest. */
export function loadCampusMaps(dir = fileURLToPath(new URL('./imports/', import.meta.url))) {
  const byInstitution = new Map();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('-campus-map.json'));
  } catch {
    return byInstitution;
  }
  for (const file of files) {
    const plan = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const template = plan?.source?.locationUrl;
    if (
      typeof plan.institutionName !== 'string' ||
      typeof plan?.source?.name !== 'string' ||
      typeof template !== 'string' ||
      !template.startsWith('https://') ||
      !template.includes('{id}')
    )
      continue;
    const link = (id) => template.replace('{id}', String(id));
    const stops = new Map();
    for (const [key, entry] of Object.entries(plan.stops || {})) {
      const records = (entry.records || []).filter(validRecord).map((r) => ({
        locationId: r.locationId,
        name: r.name.slice(0, 120),
        kind: r.kind,
        lat: r.lat,
        lng: r.lng,
        url: link(r.locationId),
      }));
      if (!records.length) continue;
      const photo = records.find((r) => r.locationId === entry.photos);
      stops.set(key, {
        records,
        note: String(entry.note || '').slice(0, 400),
        photos: photo ? { name: photo.name, url: photo.url } : null,
      });
    }
    const unmatched = new Map(
      Object.entries(plan.unmatched || {}).map(([k, v]) => [k, String(v).slice(0, 300)]),
    );
    byInstitution.set(plan.institutionName, {
      source: { name: plan.source.name.slice(0, 120), checkedAt: plan.checkedAt || null },
      stops,
      unmatched,
    });
  }
  return byInstitution;
}

export function createCampusMap({ db, data = loadCampusMaps() }) {
  const forOrg = (org) => {
    const row = db.prepare('SELECT name FROM institutions WHERE id=?').get(org);
    return row ? data.get(row.name) : undefined;
  };
  /**
   * Everyone: `campus_photos` (a link to the official photos of the stop's landmark).
   * Administrators also get `campus_map`: the matching records with their distance from the
   * stop's pin (or, for a draft, from its researched suggestion), or why there is no match.
   */
  function decorate(org, stops, { admin = false } = {}) {
    const set = forOrg(org);
    if (!set) return stops;
    return stops.map((stop) => {
      if (!stop.import_key) return stop;
      const entry = set.stops.get(stop.import_key);
      let next = stop;
      if (entry?.photos)
        next = { ...next, campus_photos: { ...entry.photos, source: set.source.name } };
      if (!admin) return next;
      if (entry) {
        const from =
          stop.lat != null && stop.lng != null
            ? { lat: stop.lat, lng: stop.lng }
            : stop.suggestion
              ? { lat: stop.suggestion.lat, lng: stop.suggestion.lng }
              : null;
        next = {
          ...next,
          campus_map: {
            source: set.source.name,
            checkedAt: set.source.checkedAt,
            note: entry.note,
            boardingPoint: false,
            records: entry.records.map(({ lat, lng, ...r }) => ({
              ...r,
              distance: from ? meters(from, { lat, lng }) : null,
            })),
          },
        };
      } else if (set.unmatched.has(stop.import_key)) {
        next = {
          ...next,
          campus_map: {
            source: set.source.name,
            checkedAt: set.source.checkedAt,
            note: set.unmatched.get(stop.import_key),
            boardingPoint: false,
            records: [],
          },
        };
      }
      return next;
    });
  }
  return { decorate };
}
