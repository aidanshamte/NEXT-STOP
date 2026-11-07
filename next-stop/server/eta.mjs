// Arrival estimates from verified route geometry (administrator-confirmed stop pins in the
// route's printed order) and the vehicle's own history on that route.
//
// Each GPS fix is checked against the next few stops on the route. When the vehicle passes a
// stop (its path between two fixes comes within PASS_RADIUS of the pin), the route position and
// time are kept on the trip, and the time since the previous stop is stored as one travel-time
// sample. No GPS track is stored: samples hold route positions and durations only, and are
// deleted after SAMPLE_RETENTION_DAYS.
//
// An estimate for a stop ahead adds the typical (median) travel time of each segment to it,
// with a range from the 20th to 80th percentiles. It is unavailable when the route has no
// progress yet, when any segment has fewer than MIN_SAMPLES samples, or when the vehicle has
// gone well past its usual time. Clients also hide it while GPS is not current.

export const PASS_RADIUS = 40;
export const MIN_SAMPLES = 3;
export const LOOKAHEAD = 4;
export const SAMPLE_RETENTION_DAYS = 60;
const MAX_SAMPLES = 50;
const PROGRESS_TTL = 30 * 60000;

const toRad = (d) => (d * Math.PI) / 180;
/** Metres between two points (equirectangular; accurate at stop-to-stop scale). */
export function metres(a, b) {
  const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2));
  const y = toRad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * 6371000;
}
/** Shortest distance in metres from point p to the segment a→b. */
export function toSegment(p, a, b) {
  const kx = Math.cos(toRad(p.lat)) * 111320,
    ky = 110540;
  const ax = (a.lng - p.lng) * kx,
    ay = (a.lat - p.lat) * ky,
    bx = (b.lng - p.lng) * kx,
    by = (b.lat - p.lat) * ky;
  const dx = bx - ax,
    dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
const quantile = (sorted, q) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];

export function createEta({ db, clock }) {
  /** The route's stops in order, with coordinates for confirmed pins only. */
  function sequence(routeId) {
    const rows = db
      .prepare(
        `SELECT rs.position,rs.stop_id,rs.on_demand,s.name,s.lat,s.lng,s.status FROM route_stops rs JOIN stops s ON s.id=rs.stop_id
         WHERE rs.route_id=? ORDER BY rs.position`,
      )
      .all(routeId);
    const loop = rows.length > 2 && rows[0].stop_id === rows.at(-1).stop_id;
    return { rows, loop, n: rows.length };
  }
  /** Positions ahead of `p` in travel order (one lap). On a loop the last position is the
   * first stop again, so it is folded into position 0. */
  function ahead(seq, p, count) {
    const out = [];
    const lap = seq.loop ? seq.n - 1 : seq.n;
    for (let k = 1; k <= Math.min(count, lap - 1); k++) out.push((p + k) % lap);
    return out;
  }
  const pinned = (row) => row && row.status === 'confirmed' && row.lat != null && row.lng != null;

  /** Called after a fix is stored. `before` is the trip row before the update. Returns the
   * position passed, if any, so the caller can send approach notifications. */
  function onFix(before, fix) {
    if (!before.route_id) return null;
    const seq = sequence(before.route_id);
    if (seq.n < 2) return null;
    const lap = seq.loop ? seq.n - 1 : seq.n;
    const stale =
      before.progress_at == null ||
      fix.capturedAt - before.progress_at > PROGRESS_TTL ||
      before.progress_route_id !== before.route_id;
    const from = stale ? null : before.progress_position;
    const candidates = from == null ? [...Array(lap).keys()] : ahead(seq, from, LOOKAHEAD);
    const prev =
      before.lat != null && before.updated_at != null && fix.capturedAt - before.updated_at < 60000
        ? { lat: before.lat, lng: before.lng }
        : null;
    const radius = Math.min(60, Math.max(PASS_RADIUS, fix.accuracy || 0));
    let passed = null;
    let best = Infinity;
    for (const position of candidates) {
      const row = seq.rows[position];
      if (!pinned(row)) continue;
      const d = prev ? toSegment(row, prev, fix) : metres(row, fix);
      if (d > radius) continue;
      // With no progress yet, the nearest pin wins; otherwise the first one ahead.
      if (from == null) {
        if (d < best) [best, passed] = [d, position];
      } else {
        passed = position;
        break;
      }
    }
    if (passed == null) return null;
    if (from != null && before.progress_at != null) {
      const seconds = Math.round((fix.capturedAt - before.progress_at) / 1000);
      if (seconds >= 15 && seconds <= 3600)
        db.prepare(
          'INSERT INTO segment_times(institution_id,route_id,from_position,to_position,seconds,recorded_at) VALUES (?,?,?,?,?,?)',
        ).run(before.institution_id, before.route_id, from, passed, seconds, fix.capturedAt);
    }
    db.prepare(
      'UPDATE trips SET progress_position=?,progress_at=?,progress_route_id=? WHERE id=?',
    ).run(passed, fix.capturedAt, before.route_id, before.id);
    return { position: passed, stopId: seq.rows[passed].stop_id, seq, lap };
  }

  /** Stops between position `from` and the next occurrence of `stopId` (0 = at it). */
  function stopsUntil(seq, from, stopId) {
    const lap = seq.loop ? seq.n - 1 : seq.n;
    for (let k = 0; k <= lap; k++) if (seq.rows[(from + k) % lap]?.stop_id === stopId) return k;
    return null;
  }

  function samples(routeId, a, b, since) {
    return db
      .prepare(
        'SELECT seconds FROM segment_times WHERE route_id=? AND from_position=? AND to_position=? AND recorded_at>=? ORDER BY recorded_at DESC LIMIT ?',
      )
      .all(routeId, a, b, since, MAX_SAMPLES)
      .map((r) => r.seconds)
      .sort((x, y) => x - y);
  }

  /** Progress and per-stop estimates for one trip, measured from `basis` (the time the last
   * stop was passed). Clients subtract elapsed time; they must not show estimates while GPS is
   * stale. */
  function estimates(trip) {
    const now = clock();
    if (
      !trip.active ||
      !trip.route_id ||
      trip.progress_position == null ||
      trip.progress_at == null
    )
      return { progress: null, estimates: [], reason: trip.route_id ? 'no_progress' : 'no_route' };
    if (trip.progress_route_id !== trip.route_id || now - trip.progress_at > PROGRESS_TTL)
      return { progress: null, estimates: [], reason: 'no_progress' };
    const seq = sequence(trip.route_id);
    const since = now - SAMPLE_RETENTION_DAYS * 86400000;
    const progress = {
      position: trip.progress_position,
      stop_id: seq.rows[trip.progress_position]?.stop_id,
      at: trip.progress_at,
    };
    const out = [];
    let low = 0,
      mid = 0,
      high = 0,
      minCount = Infinity;
    let at = trip.progress_position;
    const lap = seq.loop ? seq.n - 1 : seq.n;
    for (let step = 0; step < lap; step++) {
      const next = (at + 1) % lap;
      let target = next;
      let list = samples(trip.route_id, at, next, since);
      // An on-demand stop is often skipped: use the hop over it when that has history.
      if (list.length < MIN_SAMPLES && seq.rows[next]?.on_demand) {
        const hop = (at + 2) % lap;
        const hopList = samples(trip.route_id, at, hop, since);
        if (hopList.length >= MIN_SAMPLES) [target, list] = [hop, hopList];
      }
      if (list.length < MIN_SAMPLES) break;
      low += quantile(list, 0.2);
      mid += quantile(list, 0.5);
      high += quantile(list, 0.8);
      minCount = Math.min(minCount, list.length);
      out.push({
        position: target,
        stop_id: seq.rows[target].stop_id,
        low,
        mid,
        high,
        samples: minCount,
      });
      step += target === next ? 0 : 1;
      at = target;
    }
    // Far past the usual time to the next stop: something unusual is happening.
    const overdue = out[0] && now - trip.progress_at > (out[0].high * 2 + 300) * 1000;
    return {
      progress,
      estimates: overdue ? [] : out,
      reason: overdue ? 'overdue' : out.length ? null : 'insufficient_history',
    };
  }

  function reset(tripId) {
    db.prepare(
      'UPDATE trips SET progress_position=NULL,progress_at=NULL,progress_route_id=NULL WHERE id=?',
    ).run(tripId);
  }
  function prune(now = clock()) {
    db.prepare('DELETE FROM segment_times WHERE recorded_at<?').run(
      now - SAMPLE_RETENTION_DAYS * 86400000,
    );
  }
  return { onFix, estimates, stopsUntil, reset, prune, sequence };
}
