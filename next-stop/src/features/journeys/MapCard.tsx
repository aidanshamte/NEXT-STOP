import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import LiveMap from '../../components/LiveMap';
import { Icon, StatusChip, s } from '../../components/UI';
import type { Tone } from '../../components/UI';
import { GPS_LOST_AFTER, ago, locationState, routeSequence } from '../../domain';
import type { MapHighlight, Route, RouteStop, Stop, Trip } from '../../domain';

/** GPS freshness for a vehicle, from its last reported fix only. */
export function gpsStatus(trip: Trip | undefined, now: number): { text: string; tone: Tone } {
  if (!trip) return { text: 'No shuttle selected', tone: 'gray' };
  if (!trip.active) return { text: `${trip.name} · not in service`, tone: 'gray' };
  const state = locationState(trip, now);
  if (state === 'live' && trip.updated_at)
    return { text: `${trip.name} · GPS ${ago(trip.updated_at, now)}`, tone: 'green' };
  if (state === 'stale' && trip.updated_at)
    return now - trip.updated_at > GPS_LOST_AFTER
      ? { text: `${trip.name} · GPS lost · last fix ${ago(trip.updated_at, now)}`, tone: 'gray' }
      : {
          text: `${trip.name} · Location out of date · ${ago(trip.updated_at, now)}`,
          tone: 'amber',
        };
  return { text: `${trip.name} · in service, GPS not shared yet`, tone: 'gray' };
}

export default function MapCard({
  stops,
  trip,
  trips = [],
  routes = [],
  route,
  routeStops = [],
  highlight = {},
  now,
  onOpenStop,
}: {
  /** Opens a stop's details from the stop strip. */
  onOpenStop?: (stopId: string) => void;
  stops: Stop[];
  trip?: Trip;
  /** Every vehicle the viewer may see; the map draws each one in service with GPS. */
  trips?: Trip[];
  routes?: Route[];
  route?: Route;
  routeStops?: RouteStop[];
  highlight?: MapHighlight;
  now: number;
}) {
  const gps = gpsStatus(trip, now);
  const sequence = route ? routeSequence(route.id, routeStops, stops) : [];
  return (
    <View style={[s.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>
      <View>
        <LiveMap
          stops={stops}
          trips={trip && !trips.some((t) => t.id === trip.id) ? [...trips, trip] : trips}
          focusId={trip?.id}
          routes={routes.length ? routes : route ? [route] : []}
          routeStops={routeStops}
          highlight={highlight}
          now={now}
          onOpenStop={onOpenStop}
        />
        <View pointerEvents="none" style={{ position: 'absolute', top: 12, left: 12, right: 62 }}>
          <StatusChip text={gps.text} tone={gps.tone} solid />
        </View>
      </View>
      {sequence.length > 0 && (
        <View style={{ paddingVertical: 14, gap: 8 }}>
          <View style={[s.row, { paddingHorizontal: 16, justifyContent: 'flex-start' }]}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: route?.color || C.coral,
              }}
            />
            <Text style={[s.label, { flex: 1 }]} numberOfLines={1}>
              {route?.name} · stops in route order
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'flex-start' }}
          >
            {sequence.map(({ stop, onDemand, position }, i) => {
              const pickup = stop.id === highlight.pickupId;
              const dest = stop.id === highlight.destinationId;
              const draft = stop.status === 'draft';
              return (
                <View
                  key={`${stop.id}-${position}`}
                  style={{ flexDirection: 'row', alignItems: 'flex-start' }}
                >
                  {i > 0 && (
                    <View style={{ width: 18, height: 2, backgroundColor: C.line, marginTop: 7 }} />
                  )}
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`${stop.name}${pickup ? ', your pickup' : dest ? ', your drop-off' : ''}. Opens stop details`}
                    disabled={!onOpenStop}
                    onPress={() => onOpenStop?.(stop.id)}
                    style={{ alignItems: 'center', width: 84, gap: 5 }}
                  >
                    <View
                      style={{
                        width: pickup ? 16 : 12,
                        height: pickup ? 16 : 12,
                        borderRadius: 8,
                        marginTop: pickup ? 0 : 2,
                        borderWidth: pickup ? 4 : 3,
                        borderColor: pickup ? C.coral : draft ? '#B7C0C8' : C.navy,
                        backgroundColor: dest ? C.navy : 'white',
                      }}
                    />
                    <Text
                      numberOfLines={2}
                      style={{
                        fontSize: 11,
                        lineHeight: 14,
                        textAlign: 'center',
                        fontWeight: pickup || dest ? '700' : '500',
                        color: pickup ? C.coral : draft ? '#98A3AD' : C.navy,
                      }}
                    >
                      {stop.name}
                    </Text>
                    {(pickup || dest || onDemand || draft) && (
                      <Text style={{ fontSize: 10, color: C.muted }}>
                        {pickup
                          ? 'Pickup'
                          : dest
                            ? 'Drop-off'
                            : draft
                              ? 'Not yet open'
                              : 'On demand'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}
      {!!trip?.active && trip.updated_at == null && (
        <View style={[s.row, { padding: 14, justifyContent: 'flex-start' }]}>
          <Icon name="information-circle-outline" size={18} color={C.muted} />
          <Text style={[s.caption, { flex: 1 }]}>
            The shuttle appears on the map once its driver shares GPS.
          </Text>
        </View>
      )}
    </View>
  );
}
