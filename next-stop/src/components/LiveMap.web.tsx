import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { buildMapPayload, mapLabel } from '../domain';
import { MapNotice, MapPlaceholder } from './MapPlaceholder';
import type { LiveMapProps } from './MapPlaceholder';
import { onMapMessage, useOwnLocation, useReduceMotion } from './useMapDevice';

// The same MapLibre document as the native app, served as /map.html. The frame is sandboxed
// without allow-same-origin, so map code can never read this site's session; Caddy gives that
// one path its own CSP for the pinned MapLibre build and OpenFreeMap tiles. The frame has no
// location access: the viewer's own position is read by this page (after they tap the map's
// location button) and handed to the frame only.
export default function LiveMap({ height = 300, onOpenStop, ...input }: LiveMapProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const { me, locate, toggle } = useOwnLocation();
  const reduceMotion = useReduceMotion();
  const data = buildMapPayload({
    ...input,
    me,
    locate,
    reduceMotion,
    interactive: !!onOpenStop,
  });
  const label = mapLabel(data);
  const payload = JSON.stringify({ ...data, label });
  const empty = !data.stops.length && !data.vehicles.length;
  const [shown, setShown] = useState(false);
  if (!empty && !shown) setShown(true);
  // The listener reads the latest payload and handlers without re-subscribing.
  const latest = useRef({ data, onOpenStop, toggle });
  useEffect(() => {
    latest.current = { data, onOpenStop, toggle };
  });
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data === 'ready') setReady(true);
      else if (event.data === 'error') setFailed(true);
      else {
        const { data: current, onOpenStop: open, toggle: flip } = latest.current;
        onMapMessage(event.data, current, { onOpenStop: open, toggleLocate: () => void flip() });
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    if (ready)
      frame.current?.contentWindow?.postMessage({ type: 'update', data: JSON.parse(payload) }, '*');
  }, [ready, payload]);
  if (empty && !shown)
    return (
      <MapPlaceholder height={height} text="No confirmed stops or shared shuttle location yet." />
    );
  if (failed)
    return (
      <MapPlaceholder
        height={height}
        text="The map could not load. Check your connection; the GPS status shown here is still current."
      />
    );
  return (
    <View style={{ height, backgroundColor: '#E9EEF1' }}>
      <iframe
        ref={frame}
        src="/map.html"
        title={label}
        sandbox="allow-scripts"
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
      />
      {empty && <MapNotice text="No confirmed stops or shared shuttle location right now." />}
    </View>
  );
}
