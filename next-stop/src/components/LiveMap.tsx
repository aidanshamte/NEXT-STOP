import React from 'react';
import { View, Text } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import type { Stop, Trip } from '../domain';
export default function LiveMap({ stops, trip }: { stops: Stop[]; trip?: Trip }) {
  const center =
    trip?.lat != null && trip.lng != null
      ? { latitude: trip.lat, longitude: trip.lng }
      : stops[0]
        ? { latitude: stops[0].lat, longitude: stops[0].lng }
        : null;
  if (!center)
    return (
      <View style={{ height: 220, justifyContent: 'center', alignItems: 'center' }}>
        <Text>No shared trip location yet.</Text>
      </View>
    );
  return (
    <MapView
      style={{ height: 280, borderRadius: 24 }}
      region={{ ...center, latitudeDelta: 0.035, longitudeDelta: 0.035 }}
    >
      {stops.map((s) => (
        <Marker
          key={s.id}
          coordinate={{ latitude: s.lat, longitude: s.lng }}
          title={s.name}
          pinColor="#72808D"
        />
      ))}
      {trip?.lat != null && trip.lng != null && (
        <Marker
          coordinate={{ latitude: trip.lat, longitude: trip.lng }}
          title={trip.name}
          description="Check the timestamp for GPS freshness"
          pinColor="#EF543F"
        />
      )}
    </MapView>
  );
}
