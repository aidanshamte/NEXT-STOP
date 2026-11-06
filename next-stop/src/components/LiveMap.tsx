import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewProps } from 'react-native-webview';

import { buildMapPayload, mapLabel } from '../domain';
import { MAP_HTML } from './mapHtml';
import { MapPlaceholder } from './MapPlaceholder';
import type { LiveMapProps } from './MapPlaceholder';

// The library's class typings resolve to `never` under React 19.3 types; this restates them.
interface MapHandle {
  injectJavaScript: (script: string) => void;
}
const MapWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<MapHandle> }
>;

export default function LiveMap({ stops, trip, highlight, height = 300, now }: LiveMapProps) {
  const view = useRef<MapHandle>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const data = buildMapPayload(stops, trip, highlight, now);
  const payload = JSON.stringify(data);
  useEffect(() => {
    if (ready) view.current?.injectJavaScript(`window.update(${payload});true;`);
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
    <View
      style={{ height, backgroundColor: '#E9EEF1' }}
      accessible
      accessibilityLabel={mapLabel(data, trip?.name)}
    >
      <MapWebView
        ref={view}
        source={{ html: MAP_HTML, baseUrl: 'https://nextstop.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        onMessage={(event: WebViewMessageEvent) => {
          if (event.nativeEvent.data === 'ready') setReady(true);
          else if (event.nativeEvent.data === 'error') setFailed(true);
        }}
        onError={() => setFailed(true)}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
