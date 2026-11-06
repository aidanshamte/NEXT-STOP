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
