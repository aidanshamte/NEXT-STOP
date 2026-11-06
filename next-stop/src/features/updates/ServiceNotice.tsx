import React from 'react';
import { Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Icon, s } from '../../components/UI';
import type { Trip } from '../../domain';

/** The driver- or dispatch-published update for one shuttle, shown only when there is one. */
export default function ServiceNotice({ trip }: { trip: Trip }) {
  if (!trip.issue && !trip.delay_minutes) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        gap: 12,
        padding: 16,
        borderRadius: 20,
        backgroundColor: '#FFF0E9',
        alignItems: 'flex-start',
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: C.coral,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="warning-outline" size={18} color="white" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.eyebrow, { color: '#C2381F' }]}>
          SERVICE UPDATE · {trip.name.toUpperCase()}
        </Text>
        {!!trip.delay_minutes && (
          <Text style={s.heading}>Reported delay: {trip.delay_minutes} min</Text>
        )}
        {!!trip.issue && <Text style={[s.body, { color: C.navy }]}>{trip.issue}</Text>}
      </View>
    </View>
  );
}
