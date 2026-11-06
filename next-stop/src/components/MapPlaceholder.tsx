import React from 'react';
import { Text, View } from 'react-native';
import type { MapHighlight, Stop, Trip } from '../domain';
import { C } from './Brand';

export interface LiveMapProps {
  stops: Stop[];
  trip?: Trip;
  highlight?: MapHighlight;
  height?: number;
  /** Render clock from the workspace, so GPS staleness ages on screen. */
  now?: number;
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
