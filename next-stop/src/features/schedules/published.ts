import type { PublishedDay, PublishedRouteDay } from '../../domain';

// Same output as domain.ts clock(); kept here so this file has no runtime imports (tests run it
// directly in Node).
function clock(ts: number, timeZone: string) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
  } catch {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

/** One route's published schedule for a day, as plain text lines (no live data). */
export interface PublishedLines {
  noService: string;
  hours: string[];
  conflict: { text: string; detail: string } | null;
  rules: { text: string; times: string }[];
}

export function publishedLines(route: PublishedRouteDay, tz: string): PublishedLines {
  const conflict = route.hours.find((h) => h.endConflict)?.endConflict;
  return {
    noService: route.noService
      ? `No published service on this day.${route.noServiceText ? ` ${route.noServiceText}` : ''}`
      : '',
    hours: route.hours.map((h) =>
      h.end != null
        ? `${clock(h.start, tz)} – ${clock(h.end, tz)}`
        : `From ${clock(h.start, tz)}; closing ${h.endConflict ? h.endConflict.options.map((o) => clock(o, tz)).join(' or ') : 'not published'}`,
    ),
    conflict: conflict ? { text: conflict.text, detail: conflict.detail } : null,
    rules: route.rules.map((r) => ({
      text: r.text,
      times: r.departures.map((d) => clock(d, tz)).join(' · '),
    })),
  };
}

/**
 * The status line for a day of a published schedule. Without confirmed calendar dates it never
 * says the service is running: only what the published hours are for that weekday.
 */
export function publishedStatus(published: PublishedDay, isToday: boolean) {
  if (published.calendar.confirmed)
    return isToday ? 'Published hours for today' : 'Published hours';
  return isToday
    ? 'Published weekly hours. Not confirmed for today: no term or closure dates are published.'
    : 'Published weekly hours. Not confirmed for this date: no term or closure dates are published.';
}
