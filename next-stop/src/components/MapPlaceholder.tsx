import React from 'react';
import { Text, View } from 'react-native';
import type { MapHighlight, Route, RouteStop, Stop, Trip } from '../domain';
import { C } from './Brand';

export interface LiveMapProps {
  stops: Stop[];
  /** Every vehicle the viewer may see; only those in service with a reported fix are drawn. */
  trips?: Trip[];
  /** The vehicle this screen is about: highlighted, followed, and its route numbers the stops. */
  focusId?: string;
  routes?: Route[];
  routeStops?: RouteStop[];
  highlight?: MapHighlight;
  height?: number;
  /** Render clock from the workspace, so GPS staleness ages on screen. */
  now?: number;
  /** Opens a stop's details (and its pickup action) when its marker is tapped. */
  onOpenStop?: (stopId: string) => void;
}

export function MapPlaceholder({ height, text }: { height: number; text: string }) {
  return (
    <View
      style={{
        height,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        backgroundColor: '#E9EEF1',
      }}
    >
      <Text style={{ color: C.muted, textAlign: 'center', lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

/** Shown over a map that is already loaded, so a brief data gap never resets its view. */
export function MapNotice({ text }: { text: string }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 12, right: 12, bottom: 48, alignItems: 'center' }}
    >
      <Text
        style={{
          color: 'white',
          backgroundColor: 'rgba(17,36,58,0.85)',
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 8,
          fontSize: 12,
          textAlign: 'center',
        }}
      >
        {text}
      </Text>
    </View>
  );
}
