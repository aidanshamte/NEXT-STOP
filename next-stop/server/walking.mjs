// Walking route preview from the rider's position to a confirmed boarding point.
//
// Provider: the OSRM "foot" profile run by FOSSGIS e.V. at routing.openstreetmap.de, built from
// OpenStreetMap data. It is free and needs no key or billing account. Its usage policy asks for
// at most one request per second, no heavy use, a valid User-Agent, and attribution with a
// "fix the map" link; the routes here are proxied through this server so the limit is enforced
// in one place and the provider never sees a rider's address or session.
//
// Privacy: the app rounds the rider's position to 4 decimal places (about 10 m) on the device
// before sending it in the query of one GET request; this server rounds again (for any other
// client) before passing it and the stop's boarding point to the provider. Neither is stored,
// logged or broadcast: the request log records the path only, Caddy has no access log, and
// nothing is cached. GET is used so no realtime refresh is triggered.
//
// Provider limit: one request per 1.1 s for the whole backend (see reserve()), at most 2.5 s of
// queueing, an 8 s timeout, and a 60 s pause if the provider answers 429. Every failure is a
// 503 with a message; the app then keeps offering the external maps link.
//
// The destination is always the stop's confirmed boarding point from the database, never a
// point from the client. Only a route the provider returned is sent back: if there is none, the
// client draws nothing (never a straight line). Distance and duration are the provider's
// walking estimates. The provider's foot profile has no step-free information, so no route is
// described as accessible.
export const WALK_MAX_METERS = 20000;
const ROUND = 1e4;
export const PROVIDER_GAP_MS = 1100;
export const PROVIDER_MAX_QUEUE_MS = 2500;
export const PROVIDER_TIMEOUT_MS = 8000;
export const PROVIDER_BACKOFF_MS = 60000;
const USER_GAP_MS = 3000;
const USER_PER_HOUR = 60;

const meters = (a, b) => {
  const k = Math.PI / 180;
  const x = (b.lng - a.lng) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
};

export function createWalking({
  db,
  fail,
  clock = Date.now,
  fetchImpl = globalThis.fetch,
  baseUrl = process.env.WALK_ROUTING_URL || 'https://routing.openstreetmap.de/routed-foot',
  enabled = process.env.WALK_ROUTING !== 'off',
  userAgent = 'NEXT-STOP-shuttle-app/1.0 (walking route preview; +https://nextstop.software)',
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs = PROVIDER_TIMEOUT_MS,
}) {
  let nextProviderSlot = 0;
  const perUser = new Map();

  function admit(uid, now) {
    const recent = (perUser.get(uid) || []).filter((t) => now - t < 3600000);
    if (recent.length && now - recent[recent.length - 1] < USER_GAP_MS)
      fail(429, 'Please wait a moment before updating the walking route.');
    if (recent.length >= USER_PER_HOUR)
      fail(429, 'Walking route limit reached for now. Use your maps app for directions.');
    recent.push(now);
    perUser.set(uid, recent);
    if (perUser.size > 5000) perUser.clear();
  }

  // Reserves the next provider slot. The reservation is made synchronously (before any await),
  // so concurrent route lookups from different riders queue at least PROVIDER_GAP_MS apart; the API is
  // a single Node process (see AGENTS.md), so this holds across the whole backend. A rider who
  // would wait longer than PROVIDER_MAX_QUEUE_MS is turned away at once instead of queued.
  function reserve() {
    const now = clock();
    const slot = Math.max(now, nextProviderSlot);
    if (slot - now > PROVIDER_MAX_QUEUE_MS)
      fail(503, 'The walking route service is busy. Try again in a moment.');
    nextProviderSlot = slot + PROVIDER_GAP_MS;
    return slot;
  }

  async function route(from, to) {
    const slot = reserve();
    // Timers can fire a little early; never start before the reserved slot.
    for (let left = slot - clock(); left > 0; left = slot - clock()) await sleep(left);
    const url = `${baseUrl}/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      fail(503, 'The walking route service could not be reached.');
    }
    if (response.status === 429) {
      // The provider asked us to slow down: stop calling it for a while, for everyone.
      nextProviderSlot = Math.max(nextProviderSlot, clock() + PROVIDER_BACKOFF_MS);
      fail(503, 'The walking route service is busy. Try again in a minute.');
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      /* handled below */
    }
    if (body?.code === 'NoRoute' || body?.code === 'NoSegment')
      fail(422, 'No walking route was found from your location to this stop.');
    if (!response.ok || body?.code !== 'Ok') fail(503, 'The walking route service is unavailable.');
    const r = body.routes?.[0];
    const coords = r?.geometry?.coordinates;
    if (
      !r ||
      !Number.isFinite(r.distance) ||
      !Number.isFinite(r.duration) ||
      !Array.isArray(coords) ||
      coords.length < 2 ||
      coords.length > 20000 ||
      !coords.every(
        (c) =>
          Array.isArray(c) &&
          c.length >= 2 &&
          Number.isFinite(c[0]) &&
          Number.isFinite(c[1]) &&
          Math.abs(c[0]) <= 180 &&
          Math.abs(c[1]) <= 90,
      )
    )
      fail(503, 'The walking route service returned an unusable route.');
    // How far the route's ends are from the requested points (the provider snaps both ends to
    // the nearest walkable way). A large gap at the stop is shown to the rider.
    const end = coords[coords.length - 1];
    const start = coords[0];
    return {
      coords: coords.map((c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]),
      distance: Math.round(r.distance),
      duration: Math.round(r.duration),
      startGap: Math.round(meters(from, { lng: start[0], lat: start[1] })),
      endGap: Math.round(meters(to, { lng: end[0], lat: end[1] })),
    };
  }

  async function handle({ path, method, url, uid, org, send }) {
    if (path !== '/stops/walk' || method !== 'GET') return false;
    if (!enabled) fail(503, 'Walking route previews are turned off. Use your maps app.');
    const stop = db
      .prepare(
        "SELECT id,lat,lng FROM stops WHERE id=? AND institution_id=? AND status='confirmed'",
      )
      .get(url.searchParams.get('stopId') || '', org);
    if (!stop || stop.lat == null || stop.lng == null) fail(404, 'Stop not found.');
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180 ||
      (lat === 0 && lng === 0)
    )
      fail(400, 'Invalid location.');
    const from = { lat: Math.round(lat * ROUND) / ROUND, lng: Math.round(lng * ROUND) / ROUND };
    const to = { lat: stop.lat, lng: stop.lng };
    const straight = meters(from, to);
    if (straight > WALK_MAX_METERS)
      fail(422, 'You’re too far from this stop for a walking route preview.');
    admit(uid, clock());
    const result = await route(from, to);
    send(200, {
      stopId: stop.id,
      to,
      ...result,
      provider: 'OSRM foot profile, FOSSGIS e.V. (routing.openstreetmap.de)',
      attribution: '© OpenStreetMap contributors',
      fixUrl: 'https://www.openstreetmap.org/fixthemap',
    });
    return true;
  }
  return { handle };
}
