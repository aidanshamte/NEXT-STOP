import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import * as Location from 'expo-location';
import type { MapPayload } from '../domain';

/**
 * The viewer's own location for the map's blue dot. It starts only when the viewer taps the
 * map's location button, shows only after permission and a real fix, and stays on this device:
 * it is passed to the local map and never sent to the server or to anyone else.
 */
export function useOwnLocation() {
  const [locate, setLocate] = useState<MapPayload['locate']>('off');
  const [me, setMe] = useState<MapPayload['me']>(null);
  const watch = useRef<Location.LocationSubscription | null>(null);
  // Incremented on every toggle, so a slow permission prompt cannot start a stale watcher.
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current += 1;
    watch.current?.remove();
    watch.current = null;
    setMe(null);
    setLocate('off');
  }, []);
  useEffect(() => stop, [stop]);
  const toggle = useCallback(async () => {
    if (locate === 'on' || locate === 'waiting') return stop();
    const run = ++generation.current;
    setLocate('waiting');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (run !== generation.current) return;
      if (permission.status !== 'granted') return setLocate('denied');
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: 5000 },
        (point) => {
          if (run !== generation.current || point.coords.accuracy == null) return;
          setMe({
            lat: point.coords.latitude,
            lng: point.coords.longitude,
            accuracy: point.coords.accuracy,
          });
          setLocate('on');
        },
      );
      if (run !== generation.current) subscription.remove();
      else watch.current = subscription;
    } catch {
      if (run === generation.current) setLocate('unavailable');
    }
  }, [locate, stop]);
  return { me, locate, toggle };
}

/** The operating system's reduce-motion setting; the map snaps instead of gliding when on. */
export function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduce(value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Messages from the map document: a stop tap or the location button. */
export function onMapMessage(
  data: unknown,
  payload: MapPayload,
  handlers: { onOpenStop?: (id: string) => void; toggleLocate: () => void },
) {
  if (data === 'locate') handlers.toggleLocate();
  else if (typeof data === 'string' && data.startsWith('stop:')) {
    const id = data.slice(5);
    if (payload.stops.some((s) => s.ids.includes(id))) handlers.onOpenStop?.(id);
  }
}
