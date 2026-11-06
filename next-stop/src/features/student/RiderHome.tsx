import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Icon, SectionLabel, Tag, s } from '../../components/UI';
import { ago, isBoardable, lifecycle, routeSequence } from '../../domain';
import type { RideRequest, Route, RouteStop, Stop, Trip } from '../../domain';
import MapCard from '../journeys/MapCard';
import ServiceNotice from '../updates/ServiceNotice';
import { actionKey, statusLabels } from '../workspace/types';
import type { Mutate } from '../workspace/types';

const parentDetail: Record<string, string> = {
  requested: 'Waiting for the driver to accept.',
  accepted: 'The driver accepted the pickup.',
  approaching: 'The driver marked the shuttle as approaching the pickup stop.',
  boarded: 'The driver confirmed boarding.',
  arrived: 'The driver confirmed the drop-off.',
};
const stepText: Record<string, [string, string]> = {
  requested: ['Requested', 'Waiting for the driver to accept.'],
  accepted: ['Accepted', 'Your driver accepted. Head to your stop.'],
  approaching: ['Approaching', 'Your driver marked the shuttle as approaching your stop.'],
  boarded: ['Onboard', 'Your driver confirmed you boarded.'],
  arrived: ['Arrived', 'Your driver confirmed the drop-off.'],
};

/** The rider's live map and pickup screen. Pickup/destination state is owned by the
 * workspace so it survives tab changes and is cleared on sign-in and institution switches. */
export default function RiderHome({
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
  pending,
  mutate,
  now,
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
  pending: string;
  mutate: Mutate;
  now: number;
}) {
  const route = routes.find((r) => r.id === trip?.route_id);
  // A shuttle on a route offers that route's confirmed stops in printed order (each stop once);
  // otherwise every confirmed stop of the institution.
  const options = (
    route
      ? routeSequence(route.id, routeStops, stops)
      : stops.map((stop) => ({ stop, onDemand: false, position: stop.position }))
  ).filter(
    (entry, index, list) =>
      isBoardable(entry.stop) && list.findIndex((e) => e.stop.id === entry.stop.id) === index,
  );
  const highlight = request
    ? { pickupId: request.stop_id, destinationId: request.destination_id }
    : { pickupId: pickup, destinationId: destination };
  const requesting = pending === actionKey('/requests', { tripId: trip?.id });
  const cancelling =
    !!request && pending === actionKey('/requests/status', { requestId: request.id });
  const blocker = !trips.length
    ? 'Your institution has not assigned any shuttles yet.'
    : !trip?.active
      ? `${trip?.name || 'This shuttle'} is not in service right now. You can request once it starts.`
      : !options.length
        ? 'No pickup stops are open for this shuttle yet. Your institution is setting them up.'
        : !pickup
          ? 'Choose where you’ll be picked up.'
          : !destination
            ? 'Choose where you’re going.'
            : '';
  return (
    <View style={{ gap: 16 }}>
      {trip && <ServiceNotice trip={trip} />}
      <MapCard
        stops={stops}
        trip={trip}
        route={route}
        routeStops={routeStops}
        highlight={highlight}
        now={now}
      />
      {request ? (
        <Card style={{ gap: 16 }}>
          <View style={[s.row, { alignItems: 'flex-start' }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <SectionLabel>Your pickup</SectionLabel>
              <Text style={s.title}>{statusLabels[request.status]}</Text>
            </View>
            <Tag
              text={trips.find((t) => t.id === request.trip_id)?.name || 'Shuttle'}
              tone="gray"
            />
          </View>
          <View style={{ gap: 10 }}>
            <StopLine
              icon="radio-button-on"
              color={C.coral}
              label="Pickup"
              name={stopName(request.stop_id)}
            />
            <StopLine
              icon="flag"
              color={C.navy}
              label="Drop-off"
              name={stopName(request.destination_id)}
            />
          </View>
          <Progress status={request.status} />
          <Text style={s.caption}>
            Updated {ago(request.updated_at || request.created_at, now)}. Each step is confirmed by
            your driver; NEXT STOP does not estimate arrival times.
          </Text>
          {['requested', 'accepted', 'approaching'].includes(request.status) && (
            <Button
              secondary
              label="Cancel pickup"
              loadingLabel="Cancelling…"
              loading={cancelling}
              disabled={busy}
              onPress={() =>
                mutate(
                  '/requests/status',
                  { requestId: request.id, status: 'cancelled' },
                  'Pickup cancelled.',
                )
              }
            />
          )}
        </Card>
      ) : (
        <Card style={{ gap: 16 }}>
          <View style={{ gap: 4 }}>
            <SectionLabel>Request a pickup</SectionLabel>
            <Text style={s.title}>Where should we pick you up?</Text>
          </View>
          {trips.length > 1 && (
            <View style={{ gap: 8 }}>
              <Text style={s.label}>SHUTTLE</Text>
              {shuttleSelector}
            </View>
          )}
          {options.length > 0 && (
            <>
              <Text style={s.label}>PICKUP STOP</Text>
              <View style={s.stopOptions}>
                {options.map(({ stop, onDemand }) => {
                  const selected = pickup === stop.id;
                  return (
                    <Pressable
                      key={stop.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Pickup at ${stop.name}${onDemand ? ', on-demand stop' : ''}`}
                      onPress={() => {
                        setPickup(stop.id);
                        if (destination === stop.id) setDestination('');
                      }}
                      style={[
                        s.stopOption,
                        selected && { borderColor: C.coral, backgroundColor: '#FFF6F3' },
                      ]}
                    >
                      <Icon
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        color={selected ? C.coral : C.muted}
                        size={20}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.heading, { fontWeight: selected ? '700' : '500' }]}>
                          {stop.name}
                        </Text>
                        {onDemand && <Text style={s.caption}>On-demand stop</Text>}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={s.label}>DROP-OFF</Text>
              <View style={s.pills}>
                {options
                  .map((entry) => entry.stop)
                  .filter((t) => t.id !== pickup)
                  .map((stop) => (
                    <Pressable
                      key={stop.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: destination === stop.id }}
                      onPress={() => setDestination(stop.id)}
                      style={[s.pill, destination === stop.id && s.pillActive]}
                    >
                      <Text style={[s.pillText, destination === stop.id && { color: 'white' }]}>
                        {stop.name}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            </>
          )}
          <Button
            large
            label={pickup && !blocker ? `Request pickup at ${stopName(pickup)}` : 'Request pickup'}
            loadingLabel="Sending request…"
            icon="hand-left-outline"
            loading={requesting}
            disabled={busy || !!blocker}
            onPress={() =>
              mutate(
                '/requests',
                { tripId: trip?.id, stopId: pickup, destinationId: destination },
                'Pickup requested. Wait for the driver to accept.',
              )
            }
          />
          <View style={[s.row, { alignItems: 'flex-start', justifyContent: 'flex-start' }]}>
            <Icon name="information-circle-outline" size={18} color={C.muted} />
            <Text style={[s.caption, { flex: 1 }]}>
              {blocker ||
                'Your pickup is confirmed only when the driver accepts. Wait at the stop you chose.'}
            </Text>
          </View>
        </Card>
      )}
    </View>
  );
}

function StopLine({
  icon,
  color,
  label,
  name,
}: {
  icon: 'radio-button-on' | 'flag';
  color: string;
  label: string;
  name: string;
}) {
  return (
    <View style={[s.row, { justifyContent: 'flex-start', gap: 12 }]}>
      <Icon name={icon} size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={s.caption}>{label}</Text>
        <Text style={s.heading}>{name}</Text>
      </View>
    </View>
  );
}

/** The request lifecycle as a vertical list; a cancelled request shows no progress. */
export function Progress({
  status,
  observer = false,
}: {
  status: RideRequest['status'];
  /** Worded for someone following another rider's journey. */
  observer?: boolean;
}) {
  if (status === 'cancelled') return <Tag text="Cancelled" tone="gray" />;
  const current = lifecycle.indexOf(status);
  return (
    <View accessibilityRole="list">
      {lifecycle.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const title = stepText[step][0];
        const detail = observer ? parentDetail[step] : stepText[step][1];
        return (
          <View
            key={step}
            style={{ flexDirection: 'row', gap: 12 }}
            accessible
            accessibilityLabel={`${title}${done ? ', done' : active ? ', current step' : ''}`}
          >
            <View style={{ alignItems: 'center', width: 18 }}>
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  marginTop: 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done || active ? C.coral : 'white',
                  borderWidth: done || active ? 0 : 2,
                  borderColor: C.line,
                }}
              >
                {done && <Icon name="checkmark" size={11} color="white" />}
              </View>
              {i < lifecycle.length - 1 && (
                <View
                  style={{
                    width: 2,
                    flex: 1,
                    minHeight: 14,
                    backgroundColor: done ? C.coral : C.line,
                  }}
                />
              )}
            </View>
            <View style={{ flex: 1, paddingBottom: 12 }}>
              <Text
                style={[
                  s.heading,
                  {
                    color: active ? C.navy : done ? C.navy : C.muted,
                    fontWeight: active ? '700' : '500',
                  },
                ]}
              >
                {title}
              </Text>
              {active && <Text style={s.caption}>{detail}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}
