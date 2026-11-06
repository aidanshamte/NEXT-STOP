import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { buildMapPayload, mapLabel } from '../domain';
import { MapPlaceholder } from './MapPlaceholder';
import type { LiveMapProps } from './MapPlaceholder';

// The same MapLibre document as the native app, served as /map.html. The frame is sandboxed
// without allow-same-origin, so map code can never read this site's session; Caddy gives that
// one path its own CSP for the pinned MapLibre build and OpenFreeMap tiles.
export default function LiveMap({ stops, trip, highlight, height = 300, now }: LiveMapProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const data = buildMapPayload(stops, trip, highlight, now);
  const payload = JSON.stringify(data);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data === 'ready') setReady(true);
      else if (event.data === 'error') setFailed(true);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    if (ready)
      frame.current?.contentWindow?.postMessage({ type: 'update', data: JSON.parse(payload) }, '*');
  }, [ready, payload]);
  if (!data.stops.length && !data.bus)
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
        title={mapLabel(data, trip?.name)}
        sandbox="allow-scripts"
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
      />
    </View>
  );
}
