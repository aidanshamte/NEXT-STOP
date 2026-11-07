// Institution-local calendar helpers. Timetables are entered as local wall-clock times in the
// institution's IANA time zone and converted to exact instants here (DST-aware).
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function parts(ts, tz) {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ts)))
    out[p.type] = p.value;
  return out;
}

/** Milliseconds the zone is ahead of UTC at instant `ts`. */
function offsetAt(ts, tz) {
  const p = parts(ts, tz);
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return local - Math.floor(ts / 1000) * 1000;
}

/** The instant of local time `minute` (0–1439) on `date` in `tz`. */
export function zonedEpoch(date, minute, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60);
  let ts = wall - offsetAt(wall, tz);
  ts = wall - offsetAt(ts, tz);
  return ts;
}

/** The local calendar date (YYYY-MM-DD) of instant `ts` in `tz`. */
export function localDate(ts, tz) {
  const p = parts(ts, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 0 = Monday … 6 = Sunday, matching service-period day masks. */
export function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "07:05" → 425; null when invalid. */
export function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) return null;
  const h = +match[1],
    m = +match[2];
  return h < 24 && m < 60 ? h * 60 + m : null;
}
