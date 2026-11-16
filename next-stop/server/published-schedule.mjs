// Schedules an institution publishes without dates (hours, frequency wording, explicit
// departures from the first stop, notes), shipped as reviewed files in
// server/imports/*-published-schedule.json. Today: Fairfield University's transportation page.
//
// - Read-only and keyed by institution name and route import key: nothing is written to the
//   database, so other institutions and administrator-entered timetables are never touched,
//   and re-shipping the file has no side effects.
// - Times are local to the file's time zone and converted for the requested day (daylight
//   saving included). Only stated times are returned; no intermediate stop times.
// - Without term or closure dates (`calendar.confirmed: false`) nothing here says service
//   is running on a given day. A day with no published hours is reported as such.
// - Conflicting statements are returned as conflicts with the source, never resolved here.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClock, validTimeZone, weekday, zonedEpoch } from './time.mjs';

const DAYS = /^[01]{7}$/;
const clockOk = (v) => typeof v === 'string' && parseClock(v) != null;
const text = (v, max = 400) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

function validRoute(r) {
  const hours = r.hours || [];
  const rules = r.rules || [];
  return (
    Array.isArray(hours) &&
    Array.isArray(rules) &&
    hours.every(
      (h) =>
        DAYS.test(h.days) &&
        clockOk(h.start) &&
        (h.end === null
          ? !!h.endConflict &&
            text(h.endConflict.text) &&
            Array.isArray(h.endConflict.options) &&
            h.endConflict.options.every(clockOk)
          : clockOk(h.end) && parseClock(h.end) > parseClock(h.start)),
    ) &&
    rules.every(
      (x) =>
        DAYS.test(x.days) &&
        text(x.text) &&
        (x.departures == null || (Array.isArray(x.departures) && x.departures.every(clockOk))),
    )
  );
}

export function loadPublishedSchedules(
  dir = fileURLToPath(new URL('./imports/', import.meta.url)),
) {
  const byInstitution = new Map();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('-published-schedule.json'));
  } catch {
    return byInstitution;
  }
  for (const file of files) {
    const plan = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (
      typeof plan.institutionName !== 'string' ||
      !validTimeZone(plan.timezone) ||
      !text(plan?.source?.url).startsWith('https://') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(plan.checkedAt || '')
    )
      continue;
    const routes = new Map();
    for (const [key, r] of Object.entries(plan.routes || {})) if (validRoute(r)) routes.set(key, r);
    byInstitution.set(plan.institutionName, {
      timezone: plan.timezone,
      checkedAt: plan.checkedAt,
      source: { name: text(plan.source.name, 120), url: plan.source.url },
      calendar: {
        confirmed: plan.calendar?.confirmed === true,
        note: text(plan.calendar?.note),
        closures: (plan.calendar?.closures || []).map((c) => text(c, 80)).filter(Boolean),
      },
      routes,
    });
  }
  return byInstitution;
}

export function createPublishedSchedule({ db, data = loadPublishedSchedules() }) {
  const forOrg = (org) => {
    const row = db.prepare('SELECT name FROM institutions WHERE id=?').get(org);
    return row ? data.get(row.name) : undefined;
  };
  /** The published schedule's time zone for this institution, if it has one. */
  const timezone = (org) => forOrg(org)?.timezone;

  /** What the published schedule says for `day` (YYYY-MM-DD, local to the file's zone). */
  function forDay(org, day) {
    const set = forOrg(org);
    if (!set) return null;
    const tz = set.timezone;
    const at = (hhmm) => zonedEpoch(day, parseClock(hhmm), tz);
    const wd = weekday(day);
    const on = (days) => days[wd] === '1';
    const routes = db
      .prepare('SELECT id,import_key FROM routes WHERE institution_id=? AND import_key IS NOT NULL')
      .all(org)
      .filter((r) => set.routes.has(r.import_key))
      .map((r) => {
        const plan = set.routes.get(r.import_key);
        const hours = (plan.hours || []).filter((h) => on(h.days));
        const rules = (plan.rules || []).filter((x) => on(x.days));
        const published = hours.length > 0 || rules.some((x) => x.departures?.length);
        return {
          route_id: r.id,
          // No published hours or departures for this weekday.
          noService: !published,
          noServiceText: published ? '' : text(plan.noServiceText),
          hours: hours.map((h) => ({
            start: at(h.start),
            end: h.end ? at(h.end) : null,
            ...(h.endConflict
              ? {
                  endConflict: {
                    text: text(h.endConflict.text),
                    detail: text(h.endConflict.detail),
                    options: h.endConflict.options.map(at),
                  },
                }
              : {}),
          })),
          rules: rules.map((x) => ({
            text: text(x.text),
            departures: (x.departures || []).map(at),
          })),
        };
      });
    return {
      source: set.source,
      checkedAt: set.checkedAt,
      timezone: tz,
      calendar: set.calendar,
      routes,
    };
  }
  return { forDay, timezone };
}
