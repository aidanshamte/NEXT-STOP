import React from 'react';
import { Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Icon, s } from '../../components/UI';
import { ago, arrival } from '../../domain';
import type { Stop, Trip } from '../../domain';

/** A live arrival estimate for one stop: a range with its basis, or why there is none. */
export default function ArrivalLine({
  trip,
  stopId,
  stops,
  now,
}: {
  trip: Trip;
  stopId: string;
  stops: Stop[];
  now: number;
}) {
  const result = arrival(trip, stopId, now);
  const passed = trip.progress && stops.find((x) => x.id === trip.progress?.stop_id)?.name;
  const label =
    result.state === 'live'
      ? `Live estimate: ${result.low < 1 ? 'under' : `${result.low}–`}${result.high} min`
      : result.state === 'here'
        ? 'Live: the shuttle is at or just past this stop'
        : 'Live estimate unavailable';
  return (
    <View
      style={{ gap: 4 }}
      accessible
      accessibilityLabel={`${label}. ${result.state === 'unavailable' ? result.why : ''}`}
    >
      <View style={[s.row, { justifyContent: 'flex-start' }]}>
        <Icon
          name={result.state === 'unavailable' ? 'time-outline' : 'radio-outline'}
          size={18}
          color={result.state === 'unavailable' ? C.muted : C.green}
        />
        <Text style={[s.heading, { color: result.state === 'unavailable' ? C.muted : C.navy }]}>
          {label}
        </Text>
      </View>
      <Text style={s.caption}>
        {result.state === 'unavailable'
          ? result.why
          : result.state === 'live'
            ? `Based on the last ${result.samples} trips between these stops on this route; traffic and pickups can change it.`
            : ''}
        {passed && trip.progress ? ` Last passed ${passed} ${ago(trip.progress.at, now)}.` : ''}
      </Text>
    </View>
  );
}
