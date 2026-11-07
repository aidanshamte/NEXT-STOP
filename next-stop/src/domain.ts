export type Role = 'student' | 'driver' | 'parent' | 'admin';
export type RequestStatus =
  'requested' | 'accepted' | 'approaching' | 'boarded' | 'arrived' | 'cancelled';
export interface Institution {
  id: string;
  name: string;
  kind?: string;
  role?: Role;
  approved?: number;
}
export interface Stop {
  id: string;
  name: string;
  /** Null until an administrator confirms the boarding point. */
  lat: number | null;
  lng: number | null;
  position: number;
  /** Draft stops are imported names awaiting a confirmed pin; no pickup there yet. */
  status?: 'draft' | 'confirmed';
  note?: string;
  description?: string;
  accessibility?: string;
  amenities?: { key: string; detail: string }[];
  /** Set when an administrator verified the details; any later edit clears it. */
  details_verified_at?: number | null;
  details_verified_by?: string | null;
  has_photo?: number;
}
export interface Route {
  id: string;
  name: string;
  color: string;
  position: number;
}
export interface RouteStop {
  route_id: string;
  position: number;
  stop_id: string;
  on_demand: number;
  /** Scheduled minutes after the route's first stop; null when not published. */
  offset_minutes?: number | null;
}
export interface Trip {
  id: string;
  institution_id: string;
  driver_id: string | null;
  route_id?: string | null;
  name: string;
  capacity: number;
  active: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  updated_at: number | null;
  delay_minutes: number;
  issue: string;
  /** Riders on board: driver-confirmed boardings minus drop-offs, correctable by the driver. */
  onboard?: number;
  onboard_updated_at?: number | null;
  onboard_source?: 'events' | 'driver';
  /** Accepted pickups not yet boarded. */
  reserved?: number;
  features?: string[];
  /** The last confirmed stop the vehicle passed (GPS at the stop's pin). */
  progress?: { position: number; stop_id: string; at: number } | null;
  /** Seconds from `progress.at` to each stop ahead, from this route's travel-time history. */
  estimates?: Estimate[];
  reason?: 'no_route' | 'no_progress' | 'insufficient_history' | 'overdue' | null;
}
export interface Estimate {
  position: number;
  stop_id: string;
  low: number;
  mid: number;
  high: number;
  /** Fewest samples behind any segment of the path. */
  samples: number;
}
export type Arrival =
  | { state: 'live'; low: number; high: number; samples: number }
  | { state: 'here' }
  | { state: 'unavailable'; why: string };
/** A live arrival estimate for `stopId`, in whole minutes, or why there is none. Never shown
 * while GPS is not current. */
export function arrival(trip: Trip | undefined, stopId: string, now = Date.now()): Arrival {
  if (!trip?.active) return { state: 'unavailable', why: 'The shuttle is not in service.' };
  if (locationState(trip, now) !== 'live')
    return { state: 'unavailable', why: 'The shuttle’s GPS is not current.' };
  if (!trip.progress)
    return {
      state: 'unavailable',
      why:
        trip.reason === 'no_route'
          ? 'This shuttle has no route assigned.'
          : 'Waiting for the shuttle to pass a confirmed stop.',
    };
  if (trip.progress.stop_id === stopId && now - trip.progress.at < 90000) return { state: 'here' };
  const est = trip.estimates?.find((e) => e.stop_id === stopId);
  if (!est)
    return {
      state: 'unavailable',
      why:
        trip.reason === 'overdue'
          ? 'The shuttle is taking much longer than usual.'
          : 'Not enough trip history on this route yet.',
    };
  const elapsed = (now - trip.progress.at) / 1000;
  const high = est.high - elapsed;
  if (high < -60) return { state: 'unavailable', why: 'The shuttle is later than usual.' };
  return {
    state: 'live',
    low: Math.max(0, Math.floor((est.low - elapsed) / 60)),
    high: Math.max(1, Math.ceil(high / 60)),
    samples: est.samples,
  };
}
export interface RideRequest {
  id: string;
  institution_id: string;
  student_id: string;
  student_name: string;
  trip_id: string;
  stop_id: string;
  destination_id: string;
  status: RequestStatus;
  created_at: number;
  /** Time of the latest status change, set by the server. */
  updated_at?: number | null;
  cancel_reason?: 'rider' | 'driver' | 'no_show' | 'expired' | 'access_removed' | null;
}
export interface ServiceAlert {
  id: string;
  route_id: string | null;
  severity: 'info' | 'delay' | 'interruption';
  title: string;
  body: string;
  starts_at: number;
  ends_at: number | null;
  created_at: number;
}
export interface Favorite {
  kind: 'stop' | 'route';
  target_id: string;
  label: string;
  created_at: number;
}
export interface Prefs {
  trip_updates: number;
  delay_alerts: number;
  service_alerts: number;
  /** 0 = off, otherwise how many stops before the rider's pickup to notify. */
  approach_stops: number;
}
export interface InstitutionSettings {
  timezone: string;
  request_expiry_minutes: number;
}
export interface Schedule {
  configured: boolean;
  timezone?: string;
  date?: string;
  closed?: boolean;
  periods?: { id: string; name: string; start_date: string; end_date: string; days: string }[];
  activePeriodIds?: string[];
  exceptions?: {
    id: string;
    date: string;
    kind: 'closed' | 'note';
    route_id: string | null;
    note: string;
  }[];
  departures?: { route_id: string; period_id: string; minute: number }[];
  routes?: { route_id: string; closed: boolean; departures: number[] }[];
}
export interface Share {
  student_id: string;
  parent_id: string;
  name: string;
  email: string;
  created_at?: number | null;
  /** Null: until the student stops sharing. */
  expires_at?: number | null;
  /** Set when shared for one ride only. */
  request_id?: string | null;
}
export interface Member {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  approved: number;
}
export interface Snapshot {
  user: { id: string; name: string; email: string };
  memberships: Institution[];
  role: Role;
  approved: boolean;
  stops: Stop[];
  trips: Trip[];
  requests: RideRequest[];
  shares: Share[];
  members: Member[];
  routes?: Route[];
  routeStops?: RouteStop[];
  settings?: InstitutionSettings;
  /** Riders waiting per stop (aggregate counts only). */
  demand?: { stop_id: string; waiting: number }[];
  alerts?: ServiceAlert[];
  favorites?: Favorite[];
  prefs?: Prefs;
  rideCount?: number;
  safety?: SafetySettings;
  pass?: { short: string; created_at: number } | null;
  incidents?: Incident[];
  escorts?: Escort[];
  rides?: RideView | null;
  sharedWithMe?: {
    student_id: string;
    name: string;
    created_at: number | null;
    expires_at: number | null;
    request_id: string | null;
  }[];
}
export interface SafetySettings {
  passes_enabled: number;
  incidents_enabled: number;
  escorts_enabled: number;
  shared_rides_enabled: number;
  /** Entered by the institution; empty means none is assumed. */
  emergency_number: string;
  escort_note: string;
  contacts: {
    id: string;
    label: string;
    phone: string;
    kind: 'safety' | 'transport' | 'escort' | 'other';
    hours: string;
    sms: number;
  }[];
}
export interface Incident {
  id: string;
  category: string;
  description: string;
  stop_id: string | null;
  trip_id: string | null;
  created_at: number;
  status: 'open' | 'acknowledged' | 'resolved';
  staff_note: string;
  updated_at: number;
  reporter_name?: string | null;
}
export interface Escort {
  id: string;
  stop_id: string | null;
  destination: string;
  note: string;
  status: 'requested' | 'accepted' | 'declined' | 'completed' | 'cancelled';
  staff_note: string;
  created_at: number;
  updated_at: number;
  rider_name?: string;
}
export interface RideView {
  intent: {
    from_stop: string;
    to_stop: string;
    leave_after: number;
    leave_before: number;
    coordinating: boolean;
  } | null;
  matches: number;
  group: { userId: string; firstName: string }[];
}
export const defaultPrefs: Prefs = {
  trip_updates: 1,
  delay_alerts: 1,
  service_alerts: 1,
  approach_stops: 1,
};
export const waitingAt = (snapshot: Pick<Snapshot, 'demand'> | null | undefined, stopId: string) =>
  snapshot?.demand?.find((d) => d.stop_id === stopId)?.waiting ?? 0;

export type Load = 'unknown' | 'light' | 'moderate' | 'near' | 'full';
/** Seat use from driver-confirmed boardings and drop-offs (corrected by the driver), plus
 * accepted pickups. Walk-on riders are counted only when the driver corrects the count, so
 * this is always presented as an estimate. */
export function seats(trip: Trip | undefined) {
  if (!trip?.active || trip.onboard == null)
    return {
      load: 'unknown' as Load,
      onboard: 0,
      reserved: 0,
      free: 0,
      capacity: trip?.capacity ?? 0,
    };
  const reserved = trip.reserved ?? 0;
  const used = trip.onboard + reserved;
  const free = Math.max(0, trip.capacity - used);
  const ratio = used / Math.max(1, trip.capacity);
  const load: Load =
    free === 0 ? 'full' : ratio >= 0.8 ? 'near' : ratio >= 0.5 ? 'moderate' : 'light';
  return { load, onboard: trip.onboard, reserved, free, capacity: trip.capacity };
}

/** Scheduled times at one route position for a day's departures; null when the institution
 * has not published that stop's offset. */
export function scheduledAt(departures: number[], offsetMinutes: number | null | undefined) {
  if (offsetMinutes == null) return null;
  return departures.map((d) => d + offsetMinutes * 60000);
}
/** "4:30 PM" in the institution's time zone when the device supports it. */
export function clock(ts: number, timeZone?: string) {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
/** Typical gap between departures, for "every N min" summaries; null if irregular or few. */
export function headway(departures: number[]) {
  if (departures.length < 3) return null;
  const gaps = departures.slice(1).map((d, i) => Math.round((d - departures[i]) / 60000));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return gaps.every((g) => Math.abs(g - median) <= 2) ? median : null;
}
/** Today and the next six days as YYYY-MM-DD in `timeZone`. */
export function weekDates(now: number, timeZone?: string) {
  const fmt = (ts: number) => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ts));
    } catch {
      return new Date(ts).toISOString().slice(0, 10);
    }
  };
  return Array.from({ length: 7 }, (_, i) => fmt(now + i * 86400000));
}
export function directionsUrl(stop: Pick<Stop, 'lat' | 'lng'>) {
  return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=walking`;
}
/** A stop riders can use: confirmed and pinned. */
export const isBoardable = (stop: Stop) =>
  stop.status !== 'draft' && stop.lat != null && stop.lng != null;
/** A route's stops in printed order (a stop may appear twice, e.g. a loop's start and middle). */
export function routeSequence(routeId: string, routeStops: RouteStop[], stops: Stop[]) {
  return routeStops
    .filter((entry) => entry.route_id === routeId)
    .sort((a, b) => a.position - b.position)
    .flatMap((entry) => {
      const stop = stops.find((s) => s.id === entry.stop_id);
      return stop ? [{ stop, onDemand: !!entry.on_demand, position: entry.position }] : [];
    });
}
export const isOpen = (status: RequestStatus) =>
  ['requested', 'accepted', 'approaching', 'boarded'].includes(status);
export function locationState(trip: Trip, now = Date.now()): 'offline' | 'stale' | 'live' {
  if (!trip.active || trip.lat == null || trip.lng == null || trip.updated_at == null)
    return 'offline';
  return now - trip.updated_at > 30000 ? 'stale' : 'live';
}
export function nextStatus(status: RequestStatus): RequestStatus | null {
  return (
    (
      {
        requested: 'accepted',
        accepted: 'approaching',
        approaching: 'boarded',
        boarded: 'arrived',
      } as Partial<Record<RequestStatus, RequestStatus>>
    )[status] || null
  );
}
export function canEndService(requests: RideRequest[], tripId: string) {
  return !requests.some((r) => r.trip_id === tripId && isOpen(r.status));
}
export function occupancy(requests: RideRequest[], tripId: string) {
  return requests.filter(
    (r) => r.trip_id === tripId && ['accepted', 'approaching', 'boarded'].includes(r.status),
  ).length;
}

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'stale';
/** How current the on-screen data is. The recovery refresh runs every 10 s, so data older
 * than 30 s means neither the live connection nor polling is delivering. */
export function connectionState(
  { live, lastSync, syncError }: { live: boolean; lastSync: number | null; syncError: string },
  now = Date.now(),
): ConnectionState {
  if (syncError) return 'offline';
  if (lastSync == null) return 'connecting';
  if (now - lastSync > 30000) return 'stale';
  return live ? 'live' : 'reconnecting';
}
/** Short relative time for freshness labels; never in the future. */
export function ago(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export const lifecycle: RequestStatus[] = [
  'requested',
  'accepted',
  'approaching',
  'boarded',
  'arrived',
];

export interface MapStop {
  name: string;
  lat: number;
  lng: number;
  kind?: 'pickup' | 'dest';
}
export interface MapPayload {
  stops: MapStop[];
  bus: { lat: number; lng: number; stale: boolean } | null;
}
export interface MapHighlight {
  pickupId?: string;
  destinationId?: string;
}

/** Only confirmed, pinned stops are drawn; the vehicle only while its GPS fix is current or
 * recent (a stale fix is drawn grey), never once service has ended. */
export function buildMapPayload(
  allStops: Stop[],
  trip: Trip | undefined,
  highlight: MapHighlight = {},
  now = Date.now(),
): MapPayload {
  const state = trip ? locationState(trip, now) : 'offline';
  return {
    stops: allStops.filter(isBoardable).map((s) => ({
      name: s.name,
      lat: s.lat as number,
      lng: s.lng as number,
      ...(s.id === highlight.pickupId
        ? { kind: 'pickup' as const }
        : s.id === highlight.destinationId
          ? { kind: 'dest' as const }
          : {}),
    })),
    bus:
      trip && trip.lat != null && trip.lng != null && state !== 'offline'
        ? { lat: trip.lat, lng: trip.lng, stale: state === 'stale' }
        : null,
  };
}

export function mapLabel(payload: MapPayload, tripName = 'the shuttle') {
  const n = payload.stops.length;
  if (!payload.bus) return `Map of ${n} stops. Shuttle location is not available.`;
  return payload.bus.stale
    ? `Map of ${n} stops. ${tripName}'s last GPS position is out of date.`
    : `Map of ${n} stops with ${tripName} at its latest GPS position.`;
}
