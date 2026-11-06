import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewProps } from 'react-native-webview';

import { locationState, type Stop, type Trip } from '../domain';
import { C } from './Brand';

// The library's class typings resolve to `never` under React 19.3 types; this restates them.
interface MapHandle {
  injectJavaScript: (script: string) => void;
}
const MapWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<MapHandle> }
>;

// MapLibre GL in a WebView with OpenFreeMap vector tiles: no API key, no billing account,
// identical on Android and iOS. Attribution (OpenFreeMap, OpenMapTiles, OpenStreetMap) is
// rendered by the map. Positions are only ever the driver's reported GPS fixes.
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="${MAPLIBRE}.css">
<style>html,body,#map{margin:0;height:100%;background:#E9EEF1;font-family:-apple-system,Roboto,sans-serif}
.stop{width:12px;height:12px;border-radius:6px;background:#fff;border:3px solid ${C.navy}}
.bus{width:22px;height:22px;border-radius:11px;background:${C.coral};border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35)}
.bus.stale{background:#8A949D}</style></head><body><div id="map"></div>
<script src="${MAPLIBRE}.js"></script><script>
var map, stops=[], bus=null, fitted=false, moved=false;
function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(m)}
try{
 map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',center:[0,0],zoom:1,attributionControl:{compact:true}});
 map.on('dragstart',function(){moved=true});
 map.on('load',function(){post('ready')});
 map.on('error',function(){post('tile-error')});
}catch(e){post('error')}
window.update=function(d){
 if(!map)return;
 stops.forEach(function(m){m.remove()});
 stops=d.stops.map(function(s){var el=document.createElement('div');el.className='stop';el.title=s.name;
  return new maplibregl.Marker({element:el}).setLngLat([s.lng,s.lat]).setPopup(new maplibregl.Popup({offset:10}).setText(s.name)).addTo(map)});
 if(bus){bus.remove();bus=null}
 if(d.bus){var b=document.createElement('div');b.className='bus'+(d.bus.stale?' stale':'');
  bus=new maplibregl.Marker({element:b}).setLngLat([d.bus.lng,d.bus.lat]).addTo(map)}
 var pts=d.stops.map(function(s){return [s.lng,s.lat]});if(d.bus)pts.push([d.bus.lng,d.bus.lat]);
 if(!pts.length)return;
 if(!fitted){var bb=pts.reduce(function(b,p){return b.extend(p)},new maplibregl.LngLatBounds(pts[0],pts[0]));
  map.fitBounds(bb,{padding:48,maxZoom:16,duration:0});fitted=true}
 else if(d.bus&&!moved){map.easeTo({center:[d.bus.lng,d.bus.lat],duration:600})}
};
</script></body></html>`;

export default function LiveMap({ stops, trip }: { stops: Stop[]; trip?: Trip }) {
  const view = useRef<MapHandle>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const state = trip ? locationState(trip) : 'offline';
  // Stop names are passed as JSON data and shown with setText, never as HTML.
  const payload = JSON.stringify({
    stops: stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng })),
    bus:
      trip?.lat != null && trip.lng != null && state !== 'offline'
        ? { lat: trip.lat, lng: trip.lng, stale: state === 'stale' }
        : null,
  });
  useEffect(() => {
    if (ready) view.current?.injectJavaScript(`window.update(${payload});true;`);
  }, [ready, payload]);
  if (!stops.length && trip?.lat == null)
    return (
      <View style={{ height: 220, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: C.muted }}>No stops or shared shuttle location yet.</Text>
      </View>
    );
  return (
    <View
      style={{ height: 280, borderRadius: 24, overflow: 'hidden', backgroundColor: '#E9EEF1' }}
      accessible
      accessibilityLabel={
        state === 'live'
          ? `Map showing ${trip?.name || 'the shuttle'} at its latest GPS position and ${stops.length} stops`
          : `Map showing ${stops.length} stops. Shuttle location ${state === 'stale' ? 'is out of date' : 'is not available'}.`
      }
    >
      {failed ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ color: C.muted, textAlign: 'center' }}>
            The map could not load. Check your connection; the GPS status and timestamp above are
            still current.
          </Text>
        </View>
      ) : (
        <MapWebView
          ref={view}
          source={{ html, baseUrl: 'https://nextstop.local/' }}
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
      )}
    </View>
  );
}
