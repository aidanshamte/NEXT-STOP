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
}
export interface Share {
  student_id: string;
  parent_id: string;
  name: string;
  email: string;
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
