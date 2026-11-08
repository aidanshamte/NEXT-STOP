// Researched boarding-point suggestions for draft stops, shipped as reviewed files in
// server/imports/*-stop-suggestions.json. They are shown to administrators only and never make
// a stop boardable: an administrator approves each one, which pins the stop with these exact
// coordinates (read from the file, never from the client). Confirmed stops are never changed.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIDENCE = new Set(['high', 'medium', 'low']);

export function validSuggestion(s) {
  return (
    s &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng) &&
    Math.abs(s.lat) <= 90 &&
    Math.abs(s.lng) <= 180 &&
    !(s.lat === 0 && s.lng === 0) &&
    CONFIDENCE.has(s.confidence) &&
    typeof s.basis === 'string' &&
    s.basis.trim() &&
    typeof s.source === 'string' &&
    s.source.trim()
  );
}

/** Loads every suggestion file in `dir`, keyed by institution name. Invalid entries are
 * skipped (and reported by the tests), so one bad entry cannot disable the rest. */
export function loadSuggestions(dir = fileURLToPath(new URL('./imports/', import.meta.url))) {
  const byInstitution = new Map();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('-stop-suggestions.json'));
  } catch {
    return byInstitution;
  }
  for (const file of files) {
    const plan = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (typeof plan.institutionName !== 'string' || !plan.stops) continue;
    const stops = new Map();
    for (const [key, s] of Object.entries(plan.stops))
      if (validSuggestion(s))
        stops.set(key, {
          lat: s.lat,
          lng: s.lng,
          confidence: s.confidence,
          basis: s.basis.slice(0, 400),
          source: s.source.slice(0, 200),
          researchedAt: plan.researchedAt || null,
        });
    const unresolved = new Map(
      Object.entries(plan.unresolved || {}).map(([k, v]) => [k, String(v).slice(0, 200)]),
    );
    byInstitution.set(plan.institutionName, { stops, unresolved });
  }
  return byInstitution;
}

export function createSuggestions({ db, data = loadSuggestions() }) {
  const forOrg = (org) => {
    const row = db.prepare('SELECT name FROM institutions WHERE id=?').get(org);
    return row ? data.get(row.name) : undefined;
  };
  /** Adds `suggestion` (or `unresolved`) to an administrator's draft stops. */
  function decorate(org, stops) {
    const set = forOrg(org);
    if (!set) return stops;
    return stops.map((stop) => {
      if (stop.status !== 'draft' || !stop.import_key) return stop;
      const suggestion = set.stops.get(stop.import_key);
      if (suggestion) return { ...stop, suggestion };
      const unresolved = set.unresolved.get(stop.import_key);
      return unresolved ? { ...stop, unresolved } : stop;
    });
  }
  function lookup(org, importKey) {
    return importKey ? forOrg(org)?.stops.get(importKey) : undefined;
  }
  return { decorate, lookup };
}
