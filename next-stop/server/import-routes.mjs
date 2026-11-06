// Imports one institution's shuttle routes and stops from a JSON file.
//   node server/import-routes.mjs --institution <id> --file server/imports/<file>.json [--dry-run]
// Safe to re-run: records are matched by stable import keys within the institution.
// - New stops are created as drafts without coordinates (no pickup until an admin pins them).
// - Existing stops keep their status and coordinates; only a still-draft stop's name/note
//   is refreshed from the file.
// - Each imported route's ordered stop list is replaced as a whole (it is import-owned).
// - Records not mentioned in the file, other institutions and trips are never modified.
import { readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { openDatabase } from './db.mjs';

const KEY = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || !plan.stops || !Array.isArray(plan.routes))
    throw Error('Import file needs "stops" and "routes".');
  for (const [key, stop] of Object.entries(plan.stops)) {
    if (!KEY.test(key)) throw Error(`Invalid stop key: ${key}`);
    if (typeof stop.name !== 'string' || !stop.name.trim() || stop.name.length > 100)
      throw Error(`Stop ${key} needs a name (max 100 characters).`);
  }
  for (const route of plan.routes) {
    if (!KEY.test(route.key || '')) throw Error(`Invalid route key: ${route.key}`);
    if (typeof route.name !== 'string' || !route.name.trim())
      throw Error(`Route ${route.key} needs a name.`);
    if (route.color && !/^#[0-9A-Fa-f]{6}$/.test(route.color))
      throw Error(`Route ${route.key} color must be #RRGGBB.`);
    if (!Array.isArray(route.stops) || !route.stops.length)
      throw Error(`Route ${route.key} has no stops.`);
    for (const entry of route.stops)
      if (!plan.stops[entry.stop])
        throw Error(`Route ${route.key} references unknown stop ${entry.stop}.`);
  }
}

export function importRoutes(db, institutionId, plan, { dryRun = false } = {}) {
  validatePlan(plan);
  const institution = db.prepare('SELECT name FROM institutions WHERE id=?').get(institutionId);
  if (!institution) throw Error('Institution not found.');
  // Institution data belongs to that institution only: refuse a mismatched target.
  if (plan.institutionName && plan.institutionName !== institution.name)
    throw Error(`This file is for "${plan.institutionName}", not "${institution.name}".`);
  const summary = {
    stopsCreated: 0,
    stopsRenamed: 0,
    stopsKept: 0,
    routesCreated: 0,
    routesUpdated: 0,
    routeStops: 0,
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    const stopIds = {};
    let position = db
      .prepare('SELECT coalesce(max(position),-1)+1 AS n FROM stops WHERE institution_id=?')
      .get(institutionId).n;
    for (const [key, stop] of Object.entries(plan.stops)) {
      const existing = db
        .prepare('SELECT id,name,note,status FROM stops WHERE institution_id=? AND import_key=?')
        .get(institutionId, key);
      const note = (stop.note || '').slice(0, 300);
      if (!existing) {
        const id = randomUUID();
        db.prepare(
          "INSERT INTO stops(id,institution_id,name,lat,lng,position,status,import_key,note) VALUES (?,?,?,NULL,NULL,?,'draft',?,?)",
        ).run(id, institutionId, stop.name.trim(), position++, key, note);
        stopIds[key] = id;
        summary.stopsCreated++;
      } else {
        stopIds[key] = existing.id;
        if (
          existing.status === 'draft' &&
          (existing.name !== stop.name.trim() || existing.note !== note)
        ) {
          db.prepare('UPDATE stops SET name=?,note=? WHERE id=?').run(
            stop.name.trim(),
            note,
            existing.id,
          );
          summary.stopsRenamed++;
        } else summary.stopsKept++;
      }
    }
    plan.routes.forEach((route, index) => {
      let row = db
        .prepare('SELECT id FROM routes WHERE institution_id=? AND import_key=?')
        .get(institutionId, route.key);
      if (!row) {
        row = { id: randomUUID() };
        db.prepare(
          'INSERT INTO routes(id,institution_id,name,color,position,import_key,source) VALUES (?,?,?,?,?,?,?)',
        ).run(
          row.id,
          institutionId,
          route.name.trim(),
          route.color || '#11243A',
          index,
          route.key,
          String(plan.source || '').slice(0, 500),
        );
        summary.routesCreated++;
      } else {
        db.prepare('UPDATE routes SET name=?,color=?,position=?,source=? WHERE id=?').run(
          route.name.trim(),
          route.color || '#11243A',
          index,
          String(plan.source || '').slice(0, 500),
          row.id,
        );
        summary.routesUpdated++;
      }
      db.prepare('DELETE FROM route_stops WHERE route_id=?').run(row.id);
      route.stops.forEach((entry, i) => {
        db.prepare(
          'INSERT INTO route_stops(route_id,position,stop_id,on_demand) VALUES (?,?,?,?)',
        ).run(row.id, i, stopIds[entry.stop], entry.onDemand ? 1 : 0);
        summary.routeStops++;
      });
    });
    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return summary;
}

function invokedDirectly() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
if (invokedDirectly()) {
  const { values } = parseArgs({
    options: {
      institution: { type: 'string' },
      file: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!values.institution || !values.file) {
    console.error(
      'Usage: node server/import-routes.mjs --institution <id> --file <plan.json> [--dry-run]',
    );
    process.exit(2);
  }
  const db = openDatabase(process.env.DATABASE_PATH || './data/next-stop.db');
  try {
    const plan = JSON.parse(readFileSync(values.file, 'utf8'));
    const summary = importRoutes(db, values.institution, plan, { dryRun: values['dry-run'] });
    console.log(
      `${values['dry-run'] ? 'Dry run (nothing saved)' : 'Imported'}: ${JSON.stringify(summary)}`,
    );
  } catch (error) {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
