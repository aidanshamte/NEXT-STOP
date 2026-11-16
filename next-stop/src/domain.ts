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
  /** The stop's photo record. Riders receive verified photos only. */
  photo?: StopPhotoInfo;
  /** Administrators only: a researched photo they can apply to a stop without one. */
  photo_suggestion?: {
    alt: string;
    shows: PhotoShows;
    credit: string;
    license: string;
    licenseUrl?: string | null;
    sourceUrl: string;
    match: string;
    researchedAt: string | null;
  };
  /** A link to the institution's official photos of this stop's landmark (not copied here). */
  campus_photos?: { name: string; url: string; source: string };
  /** Administrators only: matching records from the official campus map, as evidence. None is
   * a shuttle boarding point (`boardingPoint` is always false). */
  campus_map?: {
    source: string;
    checkedAt: string | null;
    note: string;
    boardingPoint: false;
    records: {
      locationId: number;
      name: string;
      kind: 'building' | 'parking' | 'entrance' | 'viewpoint' | 'campus';
      url: string;
      /** Metres from the stop's pin, or from its suggestion while it is a draft. */
      distance: number | null;
    }[];
  };
  /** Administrators only: how the pin was set, and a researched suggestion for a draft stop. */
  import_key?: string | null;
  pin_source?: string;
  pinned_at?: number | null;
  suggestion?: {
    lat: number;
    lng: number;
    confidence: 'high' | 'medium' | 'low';
    basis: string;
    source: string;
    researchedAt: string | null;
  };
  unresolved?: string;
}
export type PhotoShows = '' | 'boarding' | 'landmark';
export type PhotoSource = '' | 'own' | 'institution' | 'licensed';
/** What riders are told a stop photo shows. */
export const PHOTO_SHOWS_LABEL: Record<Exclude<PhotoShows, ''>, string> = {
  landmark: 'Nearby landmark—not the boarding spot',
  boarding: 'Boarding area',
};

export interface StopPhotoInfo {
  /** Changes whenever the image is replaced; clients cache images by it. */
  version: number;
  alt: string;
  shows: PhotoShows;
  source: PhotoSource;
  credit: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  verified: boolean;
  verifiedAt: number | null;
  /** Administrators only. */
  verifiedBy?: string | null;
  uploadedBy?: string;
  width?: number;
  height?: number;
  /** What must be added before the photo can be verified. */
  missing?: string[];
}
/** One line crediting a photo, e.g. "Photo: Jane Doe · CC BY-SA 4.0". */
export function photoCredit(p: StopPhotoInfo) {
  if (p.source === 'own')
    return p.credit ? `Photo: ${p.credit}` : 'Photo by your institution’s transport team';
  return [p.credit ? `Photo: ${p.credit}` : '', p.license].filter(Boolean).join(' · ');
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
  /** Saved by an administrator; blank until set. The map never infers it. */
  vehicle_type?: VehicleType;
  /** Accessibility as an administrator recorded it; never inferred from the type or icon. */
  access_ramp?: Capability;
  access_space?: Capability;
  active: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  /** Degrees from north of the latest fix; null unless the device reported it while moving. */
  heading?: number | null;
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
  /** An undated schedule the institution publishes (hours, rules, notes) for this day. Never
   * live data, and never proof that service runs today unless `calendar.confirmed`. */
  published?: PublishedDay | null;
}
export interface PublishedRouteDay {
  route_id: string;
  /** No published hours or departures on this weekday. */
  noService: boolean;
  noServiceText: string;
  hours: {
    start: number;
    end: number | null;
    endConflict?: { text: string; detail: string; options: number[] };
  }[];
  rules: { text: string; departures: number[] }[];
}
export interface PublishedDay {
  source: { name: string; url: string };
  checkedAt: string;
  timezone: string;
  calendar: { confirmed: boolean; note: string; closures: string[] };
  routes: PublishedRouteDay[];
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
  /** Boarding assistance on open pickups: the rider's own, the assigned driver's, or staff. */
  assistance?: Assistance[];
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

export type VehicleType = '' | 'bus' | 'shuttle';
export const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
  { value: 'bus', label: 'Bus' },
  { value: 'shuttle', label: 'Shuttle van' },
  { value: '', label: 'Not set' },
];
export const vehicleTypeLabel = (type: VehicleType | undefined) =>
  type === 'bus' ? 'Bus' : type === 'shuttle' ? 'Shuttle van' : 'Vehicle type not set';
/** GPS older than this is "lost" rather than merely out of date (the 30 s stale threshold). */
export const GPS_LOST_AFTER = 5 * 60000;

export interface MapStop {
  /** Every stop record at this physical point (shared or duplicate pins draw once). */
  ids: string[];
  /** Each record's name, in the order of `ids`. */
  names: string[];
  name: string;
  lat: number;
  lng: number;
  kind?: 'pickup' | 'dest';
  /** Positions on the shown route, 1-based; empty when no route is shown. */
  numbers: number[];
  onDemand: boolean;
  label: string;
}
export interface MapVehicle {
  id: string;
  name: string;
  type: VehicleType;
  color: string;
  /** live: fix within 30 s; stale: older ("Location out of date"); lost: older than 5 min. */
  state: 'live' | 'stale' | 'lost';
  lat: number;
  lng: number;
  /** Degrees from north, only from a valid, current device heading; otherwise upright. */
  heading: number | null;
  fixAt: number;
  focus: boolean;
  label: string;
  details: string[];
}
export interface MapPayload {
  stops: MapStop[];
  vehicles: MapVehicle[];
  /** Vehicles not drawn, and why (not in service, or no GPS shared yet). */
  offMap: string[];
  /** This device's own location; drawn locally only, never sent anywhere. */
  me: { lat: number; lng: number; accuracy: number } | null;
  locate: 'off' | 'waiting' | 'on' | 'denied' | 'unavailable';
  route: { name: string; color: string } | null;
  interactive: boolean;
  reduceMotion: boolean;
  /** A walking route returned by the routing service (never a drawn straight line). `key`
   * changes with each new route, so the map fits it once and then leaves the view alone. */
  walk: { key: string; coords: [number, number][]; to: string } | null;
}
export interface MapHighlight {
  pickupId?: string;
  destinationId?: string;
}
export interface MapInput {
  stops: Stop[];
  trips?: Trip[];
  /** The vehicle the screen is about; its route numbers the stops. */
  focusId?: string;
  routes?: Route[];
  routeStops?: RouteStop[];
  highlight?: MapHighlight;
  now?: number;
  me?: MapPayload['me'];
  locate?: MapPayload['locate'];
  interactive?: boolean;
  reduceMotion?: boolean;
  walk?: MapPayload['walk'];
}

const NAVY = '#11243A';
const safeColor = (color: string | undefined) =>
  color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : NAVY;
/** Approximate ground distance in meters; enough to merge pins a few meters apart. */
export function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
}
/** Exact age of a GPS fix for vehicle details. */
export function fixAge(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s ago`;
  return `at ${new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
const COMPASS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
];
const MERGE_METERS = 10;

/** Only confirmed, pinned stops are drawn. Vehicles are drawn only from a driver's reported
 * GPS fix while in service: grey after 30 s, "lost" after 5 min, never once service ends.
 * Nothing is extrapolated or snapped to a stop. */
export function buildMapPayload({
  stops: allStops,
  trips = [],
  focusId,
  routes = [],
  routeStops = [],
  highlight = {},
  now = Date.now(),
  me = null,
  locate = 'off',
  interactive = false,
  reduceMotion = false,
  walk = null,
}: MapInput): MapPayload {
  const focusTrip = trips.find((t) => t.id === focusId);
  const focusRoute = routes.find((r) => r.id === focusTrip?.route_id);
  const sequence = focusRoute ? routeSequence(focusRoute.id, routeStops, allStops) : [];
  const stops: MapStop[] = [];
  for (const s of allStops.filter(isBoardable)) {
    const point = { lat: s.lat as number, lng: s.lng as number };
    const kind =
      s.id === highlight.pickupId
        ? ('pickup' as const)
        : s.id === highlight.destinationId
          ? ('dest' as const)
          : undefined;
    const numbers: number[] = [];
    sequence.forEach((e, i) => {
      if (e.stop.id === s.id) numbers.push(i + 1);
    });
    const onDemand = numbers.length > 0 && numbers.every((n) => sequence[n - 1].onDemand);
    const group = stops.find((g) => meters(g, point) <= MERGE_METERS);
    if (group) {
      group.ids.push(s.id);
      group.names.push(s.name);
      group.name = `${group.name} / ${s.name}`;
      group.numbers = [...group.numbers, ...numbers].sort((a, b) => a - b);
      group.onDemand = group.onDemand && onDemand;
      if (kind === 'pickup' || (kind && !group.kind)) group.kind = kind;
    } else
      stops.push({
        ids: [s.id],
        names: [s.name],
        name: s.name,
        ...point,
        kind,
        numbers,
        onDemand,
        label: '',
      });
  }
  for (const g of stops)
    g.label = [
      `${g.kind === 'pickup' ? 'Your pickup' : g.kind === 'dest' ? 'Your drop-off' : 'Bus stop'}: ${g.name}.`,
      g.numbers.length && focusRoute
        ? `Stop ${g.numbers.join(' and ')} on ${focusRoute.name}.`
        : '',
      g.onDemand ? 'On-demand stop: request a pickup for the shuttle to stop.' : '',
    ]
      .filter(Boolean)
      .join(' ');

  const vehicles: MapVehicle[] = [];
  const offMap: string[] = [];
  for (const t of trips) {
    const type: VehicleType =
      t.vehicle_type === 'bus' || t.vehicle_type === 'shuttle' ? t.vehicle_type : '';
    if (!t.active) {
      offMap.push(`${t.name}: not in service`);
      continue;
    }
    if (locationState(t, now) === 'offline') {
      offMap.push(`${t.name}: in service, GPS not shared yet`);
      continue;
    }
    const fixAt = t.updated_at as number;
    const age = now - fixAt;
    const state = age > GPS_LOST_AFTER ? 'lost' : age > 30000 ? 'stale' : 'live';
    const route = routes.find((r) => r.id === t.route_id);
    const heading =
      state === 'live' && t.heading != null && Number.isFinite(t.heading) ? t.heading : null;
    const status =
      state === 'live'
        ? `In service · GPS fix ${fixAge(fixAt, now)}`
        : state === 'stale'
          ? `Location out of date · last GPS fix ${fixAge(fixAt, now)}`
          : `GPS signal lost · last fix ${fixAge(fixAt, now)}`;
    const details = [
      `${vehicleTypeLabel(type)} · ${route ? route.name : 'No route assigned'}`,
      status,
      t.accuracy != null ? `Position accurate to about ${Math.round(t.accuracy)} m` : '',
      heading != null ? `Heading ${COMPASS[Math.round(heading / 45) % 8]}` : '',
      t.delay_minutes > 0 ? `Delayed ${t.delay_minutes} min${t.issue ? `: ${t.issue}` : ''}` : '',
      t.onboard != null ? `${t.onboard} of ${t.capacity} riders on board` : '',
    ].filter(Boolean);
    vehicles.push({
      id: t.id,
      name: t.name,
      type,
      color: safeColor(route?.color),
      state,
      lat: t.lat as number,
      lng: t.lng as number,
      heading,
      fixAt,
      focus: t.id === focusId,
      label: `${type === 'bus' ? 'Bus' : type === 'shuttle' ? 'Shuttle van' : 'Vehicle'} ${t.name}. ${status}.`,
      details,
    });
  }
  return {
    stops,
    vehicles,
    offMap,
    me,
    locate,
    route: focusRoute ? { name: focusRoute.name, color: safeColor(focusRoute.color) } : null,
    interactive,
    reduceMotion,
    walk: walk && walk.coords.length >= 2 ? walk : null,
  };
}

export function mapLabel(payload: MapPayload) {
  const n = payload.stops.length;
  const live = payload.vehicles.filter((v) => v.state === 'live').length;
  const old = payload.vehicles.length - live;
  const parts = [`Map of ${n} stop${n === 1 ? '' : 's'}.`];
  if (!payload.vehicles.length) parts.push('No shuttle location is available.');
  else {
    parts.push(`${live} vehicle${live === 1 ? '' : 's'} with current GPS.`);
    if (old) parts.push(`${old} with an out-of-date location.`);
  }
  if (payload.me) parts.push('Your location is shown.');
  if (payload.walk) parts.push(`Walking route to ${payload.walk.to} shown.`);
  return parts.join(' ');
}

// Boarding assistance, carried on the pickup request. No diagnosis is ever asked for.
export type AssistanceNeed = 'ramp' | 'extra_time' | 'other';
export type Capability = 'available' | 'unavailable' | 'unknown';
export const ASSISTANCE_OPTIONS: { value: AssistanceNeed; label: string; hint: string }[] = [
  { value: 'ramp', label: 'Ramp or lift needed', hint: 'For a wheelchair or mobility aid' },
  { value: 'extra_time', label: 'Extra boarding time', hint: 'The driver waits while you board' },
  { value: 'other', label: 'Other boarding assistance', hint: 'Add a brief note if you like' },
];
export const ASSISTANCE_NOTE_MAX = 140;
export const capabilityLabel: Record<Capability, string> = {
  available: 'Available',
  unavailable: 'Not available',
  unknown: 'Not confirmed',
};
export interface Assistance {
  request_id: string;
  needs: AssistanceNeed[];
  note: string;
  version: number;
  status: 'pending' | 'acknowledged' | 'unable';
  /** Why staff need to look: the driver can't accommodate, or the vehicle's recorded
   * ramp/lift or wheelchair space is unavailable or not confirmed. */
  attention: '' | 'driver_unable' | 'vehicle_unavailable' | 'vehicle_unknown';
  ack_at: number | null;
  unable_at: number | null;
  staff_note: string;
  staff_at: number | null;
  updated_at: number;
}
export const needsText = (needs: AssistanceNeed[]) =>
  needs.map((n) => ASSISTANCE_OPTIONS.find((o) => o.value === n)?.label || n).join(', ');

/** What a rider, driver or staff member is told about an assistance request. Acknowledgement
 * is described as "seen by the driver", never as a guarantee. Each state has a distinct icon
 * and wording, so nothing depends on colour. */
export function assistanceState(a: Assistance): {
  title: string;
  detail: string;
  tone: 'amber' | 'green' | 'coral';
  icon: 'time-outline' | 'checkmark-circle-outline' | 'alert-circle-outline';
} {
  const staff =
    a.attention === 'driver_unable'
      ? 'Staff have been alerted.'
      : a.attention === 'vehicle_unavailable'
        ? 'This vehicle’s record shows no ramp, lift or wheelchair space. Staff have been alerted.'
        : a.attention === 'vehicle_unknown'
          ? 'This vehicle’s ramp, lift or wheelchair space hasn’t been confirmed. Staff have been alerted.'
          : '';
  if (a.status === 'unable')
    return {
      title: 'Driver unable to accommodate',
      detail: `The driver says they can’t provide this assistance. ${staff}`.trim(),
      tone: 'coral',
      icon: 'alert-circle-outline',
    };
  if (a.attention)
    return {
      title: 'Staff attention needed',
      detail: `${a.status === 'acknowledged' ? 'The driver has seen your request. ' : ''}${staff}`,
      tone: 'coral',
      icon: 'alert-circle-outline',
    };
  if (a.status === 'acknowledged')
    return {
      title: 'Driver acknowledged',
      detail:
        'The driver has seen your request. This is not a guarantee that assistance is available.',
      tone: 'green',
      icon: 'checkmark-circle-outline',
    };
  return {
    title: 'Assistance requested',
    detail: 'Waiting for your driver to acknowledge.',
    tone: 'amber',
    icon: 'time-outline',
  };
}
