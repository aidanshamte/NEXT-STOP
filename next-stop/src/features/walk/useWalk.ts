import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { ApiError, api } from '../../services/api';
import { REROUTE_M, fixQuality, metersBetween } from './walking';
import type { Fix, WalkRoute, WalkTarget } from './walking';

export type WalkPhase =
  | 'idle'
  | 'locating'
  | 'denied'
  | 'unavailable'
  | 'routing'
  | 'route'
  | 'no-route'
  | 'route-failed'
  | 'offline';

export interface Walk {
  target: WalkTarget | null;
  phase: WalkPhase;
  fix: Fix | null;
  quality: ReturnType<typeof fixQuality> | null;
  route: WalkRoute | null;
  message: string;
  /** Whether the system will show the permission prompt again (false: only Settings can). */
  canAskAgain: boolean;
  start: (target: WalkTarget) => void;
  stop: () => void;
  retry: () => void;
}

const NO_FIX_AFTER_MS = 20000;
const MIN_ROUTE_GAP_MS = 15000;

/**
 * Walking directions to one boarding point. Location permission is asked only when the rider
 * starts this (never on launch). The device position stays in memory on this device while the
 * panel is open: it is sent, rounded to about 10 m, only to request the route preview, and
 * everything is cleared when the rider closes the panel. It never touches a pickup request.
 */
export function useWalk(org: string): Walk {
  const [target, setTarget] = useState<WalkTarget | null>(null);
  const [phase, setPhase] = useState<WalkPhase>('idle');
  const [fix, setFix] = useState<Fix | null>(null);
  const [route, setRoute] = useState<WalkRoute | null>(null);
  const [message, setMessage] = useState('');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const watch = useRef<Location.LocationSubscription | null>(null);
  const generation = useRef(0);
  const routedFrom = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const inFlight = useRef(false);

  const clear = useCallback(() => {
    generation.current += 1;
    watch.current?.remove();
    watch.current = null;
    routedFrom.current = null;
    inFlight.current = false;
  }, []);
  const stop = useCallback(() => {
    clear();
    setTarget(null);
    setPhase('idle');
    setFix(null);
    setRoute(null);
    setMessage('');
  }, [clear]);
  useEffect(() => clear, [clear]);

  const begin = useCallback(
    async (next: WalkTarget) => {
      clear();
      const run = generation.current;
      setTarget(next);
      setRoute(null);
      setFix(null);
      setMessage('');
      setPhase('locating');
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (run !== generation.current) return;
        if (permission.status !== 'granted') {
          setCanAskAgain(permission.canAskAgain !== false);
          setPhase('denied');
          return;
        }
        const subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 10 },
          (point) => {
            if (run !== generation.current) return;
            setFix({
              lat: point.coords.latitude,
              lng: point.coords.longitude,
              accuracy: point.coords.accuracy ?? Infinity,
              at: point.timestamp || Date.now(),
            });
          },
        );
        if (run !== generation.current) subscription.remove();
        else watch.current = subscription;
      } catch {
        if (run === generation.current) {
          setPhase('unavailable');
          setMessage('Your location isn’t available. Check that location services are on.');
        }
      }
    },
    [clear],
  );
  const start = useCallback((next: WalkTarget) => void begin(next), [begin]);

  // Ages the fix on screen, so a position that stops updating is flagged as out of date.
  useEffect(() => {
    if (!target) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [target]);

  const quality = fix ? fixQuality(fix, now) : null;

  // No position at all after a while.
  useEffect(() => {
    if (phase !== 'locating' || fix) return;
    const timer = setTimeout(() => {
      setPhase((p) => (p === 'locating' ? 'unavailable' : p));
      setMessage(
        'We couldn’t get your location yet. Move outdoors or near a window, or use your maps app.',
      );
    }, NO_FIX_AFTER_MS);
    return () => clearTimeout(timer);
  }, [phase, fix]);

  const requestRoute = useCallback(
    async (from: Fix, to: WalkTarget) => {
      const run = generation.current;
      inFlight.current = true;
      routedFrom.current = { lat: from.lat, lng: from.lng, at: Date.now() };
      setPhase((p) => (p === 'route' ? p : 'routing'));
      try {
        const result = await api<WalkRoute>(
          `/stops/walk?institutionId=${encodeURIComponent(org)}&stopId=${encodeURIComponent(to.id)}&lat=${from.lat.toFixed(5)}&lng=${from.lng.toFixed(5)}`,
        );
        if (run !== generation.current) return;
        setRoute(result);
        setPhase('route');
        setMessage('');
      } catch (e) {
        if (run !== generation.current) return;
        if (e instanceof ApiError) {
          setPhase(e.status === 422 ? 'no-route' : 'route-failed');
          setMessage(e.message);
        } else {
          setPhase('offline');
          setMessage('You seem to be offline. The route preview needs a connection.');
        }
      } finally {
        if (run === generation.current) inFlight.current = false;
      }
    },
    [org],
  );

  // Route once a usable fix arrives, and again when the rider has moved well away from where
  // the current route starts. Stale or very inaccurate fixes never start a route.
  useEffect(() => {
    if (!target || !fix || inFlight.current) return;
    if (quality !== 'good' && quality !== 'rough') return;
    if (phase !== 'locating' && phase !== 'unavailable' && phase !== 'route') return;
    const last = routedFrom.current;
    if (last && (metersBetween(last, fix) < REROUTE_M || Date.now() - last.at < MIN_ROUTE_GAP_MS))
      return;
    void requestRoute(fix, target);
  }, [target, fix, quality, phase, requestRoute]);

  const retry = useCallback(() => {
    if (!target) return;
    if (phase === 'denied' || !watch.current) return start(target);
    routedFrom.current = null;
    if (fix && (quality === 'good' || quality === 'rough')) void requestRoute(fix, target);
    else {
      setPhase('locating');
      setMessage('');
    }
  }, [target, phase, fix, quality, start, requestRoute]);

  return { target, phase, fix, quality, route, message, canAskAgain, start, stop, retry };
}
