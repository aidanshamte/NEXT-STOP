import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewProps } from 'react-native-webview';

import { buildMapPayload, mapLabel } from '../domain';
import { MAP_HTML } from './mapHtml';
import { MapNotice, MapPlaceholder } from './MapPlaceholder';
import type { LiveMapProps } from './MapPlaceholder';
import { onMapMessage, useOwnLocation, useReduceMotion } from './useMapDevice';

// The library's class typings resolve to `never` under React 19.3 types; this restates them.
interface MapHandle {
  injectJavaScript: (script: string) => void;
  reload: () => void;
}
const MapWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<MapHandle> }
>;

export default function LiveMap({ height = 300, onOpenStop, ...input }: LiveMapProps) {
  const view = useRef<MapHandle>(null);
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
  // Once drawn, the map stays mounted through reconnects and data gaps, keeping its view.
  const [shown, setShown] = useState(false);
  if (!empty && !shown) setShown(true);
  useEffect(() => {
    if (ready) view.current?.injectJavaScript(`window.update(${payload});true;`);
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
  // If the system ends the map's web process (common in the background), reload it in place.
  const restart = () => {
    setReady(false);
    view.current?.reload();
  };
  return (
    <View style={{ height, backgroundColor: '#E9EEF1' }} accessibilityLabel={label}>
      <MapWebView
        ref={view}
        source={{ html: MAP_HTML, baseUrl: 'https://nextstop.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        onMessage={(event: WebViewMessageEvent) => {
          const message = event.nativeEvent.data;
          if (message === 'ready') setReady(true);
          else if (message === 'error') setFailed(true);
          else onMapMessage(message, data, { onOpenStop, toggleLocate: () => void toggle() });
        }}
        onError={() => setFailed(true)}
        onContentProcessDidTerminate={restart}
        onRenderProcessGone={restart}
        style={{ backgroundColor: 'transparent' }}
      />
      {empty && <MapNotice text="No confirmed stops or shared shuttle location right now." />}
    </View>
  );
}
