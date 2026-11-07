import React from 'react';
import { Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Icon, s } from '../../components/UI';
import { vehicleFeatureLabels } from '../../catalog';
import { ago, seats } from '../../domain';
import type { Trip } from '../../domain';

const loadText = {
  light: 'Plenty of seats',
  moderate: 'Filling up',
  near: 'Nearly full',
  full: 'Full',
  unknown: '',
};
const loadColor = {
  light: C.green,
  moderate: '#8A5A00',
  near: '#C2381F',
  full: '#C2381F',
  unknown: C.muted,
};

/** Seat use for one in-service vehicle, always labelled as an estimate with its basis. */
export default function SeatsLine({ trip, now }: { trip: Trip; now: number }) {
  const info = seats(trip);
  const features = (trip.features || []).map((f) => vehicleFeatureLabels[f]).filter(Boolean);
  if (info.load === 'unknown')
    return features.length ? <Text style={s.caption}>{features.join(' · ')}</Text> : null;
  const used = info.onboard + info.reserved;
  const share = Math.min(1, used / Math.max(1, info.capacity));
  return (
    <View
      style={{ gap: 6 }}
      accessible
      accessibilityLabel={`${loadText[info.load]}. About ${used} of ${info.capacity} seats in use, estimated.`}
    >
      <View style={[s.row, { justifyContent: 'flex-start' }]}>
        <Icon name="people-outline" size={18} color={loadColor[info.load]} />
        <Text style={[s.heading, { color: loadColor[info.load] }]}>{loadText[info.load]}</Text>
        <Text style={[s.body, { flex: 1 }]}>
          · about {used} of {info.capacity} seats in use
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' }}>
        <View
          style={{ width: `${share * 100}%`, height: 6, backgroundColor: loadColor[info.load] }}
        />
      </View>
      <Text style={s.caption}>
        Estimate from boardings and drop-offs the driver confirmed
        {info.reserved
          ? `, plus ${info.reserved} accepted pickup${info.reserved === 1 ? '' : 's'}`
          : ''}
        {trip.onboard_source === 'driver' ? ', corrected by the driver’s own count' : ''}
        {trip.onboard_updated_at ? `; updated ${ago(trip.onboard_updated_at, now)}` : ''}.
        {features.length ? ` ${features.join(' · ')}.` : ''}
      </Text>
    </View>
  );
}
