export type Role = 'student' | 'driver' | 'parent' | 'admin';
export type RequestStatus = 'requested' | 'accepted' | 'boarded' | 'arrived' | 'cancelled';
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
  lat: number;
  lng: number;
  position: number;
}
export interface Trip {
  id: string;
  institution_id: string;
  driver_id: string | null;
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
}
export const isOpen = (status: RequestStatus) =>
  ['requested', 'accepted', 'boarded'].includes(status);
export function locationState(trip: Trip, now = Date.now()): 'offline' | 'stale' | 'live' {
  if (!trip.active || trip.lat == null || trip.lng == null || trip.updated_at == null)
    return 'offline';
  return now - trip.updated_at > 30000 ? 'stale' : 'live';
}
export function nextStatus(status: RequestStatus): RequestStatus | null {
  return (
    (
      { requested: 'accepted', accepted: 'boarded', boarded: 'arrived' } as Partial<
        Record<RequestStatus, RequestStatus>
      >
    )[status] || null
  );
}
export function canEndService(requests: RideRequest[], tripId: string) {
  return !requests.some((r) => r.trip_id === tripId && isOpen(r.status));
}
export function occupancy(requests: RideRequest[], tripId: string) {
  return requests.filter((r) => r.trip_id === tripId && ['accepted', 'boarded'].includes(r.status))
    .length;
}
