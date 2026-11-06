import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Icon, Tag, s } from '../../components/UI';
import { isBoardable, routeSequence } from '../../domain';
import type { RideRequest, Route, RouteStop, Stop, Trip } from '../../domain';
import { statusLabels } from '../workspace/types';
import type { Mutate } from '../workspace/types';

/** Pickup/destination selection stays owned by the workspace so it survives tab changes
 * and is cleared on sign-in and institution switches. */
export default function StudentControls({
  stops,
  routes = [],
  routeStops = [],
  trips,
  trip,
  request,
  shuttleSelector,
  pickup,
  setPickup,
  destination,
  setDestination,
  stopName,
  busy,
  mutate,
  onViewJourney,
}: {
  stops: Stop[];
  routes?: Route[];
  routeStops?: RouteStop[];
  trips: Trip[];
  trip?: Trip;
  request?: RideRequest;
  shuttleSelector: React.ReactNode;
  pickup: string;
  setPickup: (id: string) => void;
  destination: string;
  setDestination: (id: string) => void;
  stopName: (id: string) => string;
  busy: boolean;
  mutate: Mutate;
  onViewJourney: () => void;
}) {
  // A shuttle on a route offers that route's confirmed stops in printed order (each stop once);
  // otherwise every confirmed stop of the institution.
  const route = routes.find((r) => r.id === trip?.route_id);
  const options = (
    route
      ? routeSequence(route.id, routeStops, stops)
      : stops.map((stop) => ({ stop, onDemand: false, position: stop.position }))
  ).filter(
    (entry, index, list) =>
      isBoardable(entry.stop) && list.findIndex((e) => e.stop.id === entry.stop.id) === index,
  );
  return (
    <Card>
      <Text style={s.title}>Where are we headed?</Text>
      <Text style={s.label}>SHUTTLE</Text>
      {shuttleSelector}
      {route && <Text style={s.caption}>Serves the {route.name}</Text>}
      {!trips.length && (
        <Text style={s.body}>Your institution has not assigned any shuttles yet.</Text>
      )}
      {!request ? (
        <>
          <Text style={s.label}>PICKUP STOP</Text>
          {!options.length && (
            <Text style={s.body}>
              No pickup stops are confirmed for this shuttle yet. Your institution is setting them
              up.
            </Text>
          )}
          <View style={s.stopOptions}>
            {options.map(({ stop, onDemand }) => (
              <Pressable
                key={stop.id}
                onPress={() => {
                  setPickup(stop.id);
                  if (destination === stop.id) setDestination('');
                }}
                style={[
                  s.stopOption,
                  pickup === stop.id && { borderColor: C.coral, backgroundColor: '#FFF6F3' },
                ]}
              >
                <Icon
                  name={pickup === stop.id ? 'radio-button-on' : 'radio-button-off'}
                  color={pickup === stop.id ? C.coral : C.muted}
                  size={18}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.body}>{stop.name}</Text>
                  {onDemand && <Text style={s.caption}>On-demand stop</Text>}
                </View>
              </Pressable>
            ))}
          </View>
          <Text style={s.label}>DESTINATION</Text>
          <View style={s.pills}>
            {options
              .map((entry) => entry.stop)
              .filter((t) => t.id !== pickup)
              .map((stop) => (
                <Pressable
                  key={stop.id}
                  onPress={() => setDestination(stop.id)}
                  style={[s.pill, destination === stop.id && s.pillActive]}
                >
                  <Text style={[s.pillText, destination === stop.id && { color: 'white' }]}>
                    {stop.name}
                  </Text>
                </Pressable>
              ))}
          </View>
          <Button
            label="Request pickup"
            icon="hand-left-outline"
            disabled={busy || !trip?.active || !pickup || !destination}
            onPress={() =>
              mutate(
                '/requests',
                { tripId: trip?.id, stopId: pickup, destinationId: destination },
                'Pickup requested. Wait for the driver to accept.',
              )
            }
          />
          <Text style={s.caption}>
            Requests are confirmed only when the assigned driver accepts. Wait at the approved stop.
          </Text>
        </>
      ) : (
        <>
          <Tag text={statusLabels[request.status]} />
          <Text style={s.body}>
            {stopName(request.stop_id)} → {stopName(request.destination_id)}
          </Text>
          <Button secondary label="View your journey" onPress={onViewJourney} />
        </>
      )}
    </Card>
  );
}
