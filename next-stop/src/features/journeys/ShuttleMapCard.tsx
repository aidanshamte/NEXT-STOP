import React from 'react';
import { Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Card, Icon, Tag, s } from '../../components/UI';
import LiveMap from '../../components/LiveMap';
import { locationState } from '../../domain';
import type { Stop, Trip } from '../../domain';

export default function ShuttleMapCard({ stops, trip }: { stops: Stop[]; trip?: Trip }) {
  const state = trip ? locationState(trip) : null;
  return (
    <Card style={{ padding: 16 }}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.heading}>{trip?.name || 'Shuttle location'}</Text>
          <Text style={s.caption}>
            {trip?.active ? 'Vehicle in service' : 'No active vehicle location'}
          </Text>
        </View>
        <Icon name="bus-outline" size={25} color={C.coral} />
      </View>
      <LiveMap stops={stops} trip={trip} />
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        <Tag
          text={state ? `GPS ${state.toUpperCase()}` : 'NO SHARED VEHICLE'}
          tone={state === 'live' ? 'green' : 'gray'}
        />
        <Text style={s.caption}>
          {trip?.updated_at
            ? `Last GPS ${new Date(trip.updated_at).toLocaleTimeString()}`
            : 'Waiting for a real driver GPS fix'}
        </Text>
      </View>
      <Text style={s.caption}>
        ETA calculation is not available yet. A GPS marker alone does not confirm a student is
        onboard.
      </Text>
    </Card>
  );
}
