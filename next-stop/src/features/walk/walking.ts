// Walking directions to a confirmed boarding point: pure logic, shared by the app and tests.
//
// External handoff sends only the stop's boarding point to the maps app; the maps app finds
// the rider's position itself. NEXT STOP never adds the rider's location to that link.

export interface WalkTarget {
  id: string;
  name: string;
  lat: number;
  lng: number;
}
export interface Fix {
  lat: number;
  lng: number;
  /** Metres, as reported by the device. */
  accuracy: number;
  /** When the device took the fix (ms since epoch). */
  at: number;
}
export interface WalkRoute {
  stopId: string;
  coords: [number, number][];
  distance: number;
  duration: number;
  startGap: number;
  endGap: number;
  attribution: string;
  fixUrl: string;
}

/** A fix older than this is not used to start a route. */
export const FIX_STALE_MS = 2 * 60000;
/** Above this accuracy (m) the route may start in the wrong place: shown with a warning. */
export const FIX_ROUGH_M = 50;
/** Above this accuracy (m) no route is requested. */
export const FIX_POOR_M = 200;
/** Re-route when the rider has moved this far from where the route started. */
export const REROUTE_M = 60;

export function fixQuality(fix: Fix, now: number): 'good' | 'rough' | 'poor' | 'stale' {
  if (now - fix.at > FIX_STALE_MS) return 'stale';
  if (!Number.isFinite(fix.accuracy) || fix.accuracy > FIX_POOR_M) return 'poor';
  return fix.accuracy > FIX_ROUGH_M ? 'rough' : 'good';
}

export type MapsPlatform = 'ios' | 'android' | 'web';
/**
 * Links that open walking directions to the boarding point. Only the destination is sent.
 * iPhone (app or Safari) opens Apple Maps; Android opens Google Maps (app if installed, else the
 * browser); other web browsers open Google Maps in a new tab. `alternate` is offered as a second
 * choice.
 */
export function directionsLinks(
  target: Pick<WalkTarget, 'lat' | 'lng'>,
  platform: MapsPlatform,
  userAgent = '',
): { primary: { app: string; url: string }; alternate: { app: string; url: string } } {
  const dest = `${target.lat.toFixed(6)},${target.lng.toFixed(6)}`;
  const google = {
    app: 'Google Maps',
    url: `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking`,
  };
  const apple = { app: 'Apple Maps', url: `https://maps.apple.com/?daddr=${dest}&dirflg=w` };
  const apple_device =
    platform === 'ios' ||
    (platform === 'web' && /iPhone|iPad|iPod|Macintosh.*Mobile/.test(userAgent));
  return apple_device
    ? { primary: apple, alternate: google }
    : { primary: google, alternate: apple };
}

export function walkDistance(m: number) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
export function walkDuration(s: number) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
/** The rider-facing summary of a returned route: always labelled as a walking estimate. */
export function routeSummary(route: WalkRoute) {
  return `About ${walkDuration(route.duration)} walk · ${walkDistance(route.distance)} (walking estimate)`;
}

/** Approximate ground distance in metres. */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
}
