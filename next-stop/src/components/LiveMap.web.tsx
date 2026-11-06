import React from 'react';
import { View, Text } from 'react-native';
import { isBoardable } from '../domain';
import type { Stop, Trip } from '../domain';
export default function LiveMap({ stops: allStops, trip }: { stops: Stop[]; trip?: Trip }) {
  const stops = allStops.filter(isBoardable);
  const lat = trip?.lat ?? stops[0]?.lat,
    lng = trip?.lng ?? stops[0]?.lng;
  if (lat == null || lng == null) return <Text>No shared trip location yet.</Text>;
  const bbox = [lng - 0.015, lat - 0.012, lng + 0.015, lat + 0.012].join(',');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${trip?.lat != null ? `&marker=${lat},${lng}` : ''}`;
  return (
    <View style={{ height: 280, borderRadius: 24, overflow: 'hidden' }}>
      <iframe
        title="Shuttle location · OpenStreetMap"
        src={src}
        style={{ width: '100%', height: '100%', border: 0 }}
      />
      <Text style={{ fontSize: 10 }}>
        © OpenStreetMap contributors · external map requires internet
      </Text>
    </View>
  );
}
