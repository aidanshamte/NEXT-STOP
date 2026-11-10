import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Icon, SectionLabel, Tag, s } from '../../components/UI';
import { cancelReasonLabels } from '../../catalog';
import { ago, isBoardable, lifecycle, routeSequence } from '../../domain';
import type { Assistance, Favorite, RideRequest, Route, RouteStop, Stop, Trip } from '../../domain';
import AssistancePicker, {
  assistanceBody,
  emptyAssistance,
  focusRing,
} from '../assistance/AssistancePicker';
import RiderAssistance from '../assistance/RiderAssistance';
import SeatsLine from '../journeys/SeatsLine';
import ArrivalLine from '../journeys/ArrivalLine';
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
  demand = [],
  favorites = [],
  expiryMinutes = 30,
  lastClosed,
  onOpenStop,
  assistance = [],
}: {
  /** Boarding assistance on the rider's open pickup. */
  assistance?: Assistance[];
  demand?: { stop_id: string; waiting: number }[];
  favorites?: Favorite[];
  expiryMinutes?: number;
  /** The rider's most recent closed request, to explain a cancellation they didn't make. */
  lastClosed?: RideRequest;
  onOpenStop: (stopId: string) => void;
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
  // Optional boarding assistance, reviewed before the request is sent.
  const [help, setHelp] = useState(emptyAssistance);
  const [helpOpen, setHelpOpen] = useState(false);
  // A shuttle on a route offers that route's confirmed stops in printed order (each stop once);
  // otherwise every confirmed stop of the institution.
  const options = (
    route
      ? routeSequence(route.id, routeStops, stops)
      : stops.map((stop) => ({ stop, onDemand: false, position: stop.position }))
  )
    .filter(
      (entry, index, list) =>
        isBoardable(entry.stop) && list.findIndex((e) => e.stop.id === entry.stop.id) === index,
    )
    // Saved stops first, in route order otherwise.
    .sort((a, b) => Number(!!saved(b.stop.id)) - Number(!!saved(a.stop.id)));
  function saved(stopId: string) {
    return favorites.find((f) => f.kind === 'stop' && f.target_id === stopId);
  }
  const waiting = (stopId: string) => demand.find((d) => d.stop_id === stopId)?.waiting ?? 0;
  const explained =
    lastClosed &&
    lastClosed.status === 'cancelled' &&
    lastClosed.cancel_reason &&
    lastClosed.cancel_reason !== 'rider' &&
    now - (lastClosed.updated_at || lastClosed.created_at) < 30 * 60000
      ? lastClosed
      : undefined;
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
        onOpenStop={onOpenStop}
        stops={stops}
        trip={trip}
        trips={trips}
        routes={routes}
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
              onPress={() => onOpenStop(request.stop_id)}
            />
            <StopLine
              icon="flag"
              color={C.navy}
              label="Drop-off"
              name={stopName(request.destination_id)}
              onPress={() => onOpenStop(request.destination_id)}
            />
          </View>
          <RiderAssistance
            request={request}
            assistance={assistance.find((a) => a.request_id === request.id)}
            busy={busy}
            mutate={mutate}
            now={now}
          />
          {['requested', 'accepted', 'approaching'].includes(request.status) && (
            <Tag
              text={
                waiting(request.stop_id) > 1
                  ? `You and ${waiting(request.stop_id) - 1} other rider${waiting(request.stop_id) === 2 ? '' : 's'} waiting here`
                  : 'You’re the only rider waiting here'
              }
              tone="gray"
            />
          )}
          {trip &&
            trip.id === request.trip_id &&
            ['requested', 'accepted', 'approaching'].includes(request.status) && (
              <ArrivalLine trip={trip} stopId={request.stop_id} stops={stops} now={now} />
            )}
          <Progress status={request.status} />
          {trip && trip.id === request.trip_id && <SeatsLine trip={trip} now={now} />}
          <Text style={s.caption}>
            Updated {ago(request.updated_at || request.created_at, now)}. Each step is confirmed by
            your driver.
            {request.status === 'requested'
              ? ` If no driver accepts within ${expiryMinutes} minutes, the request clears and you’ll be told.`
              : ''}
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
          {explained && (
            <View style={[s.notice, { backgroundColor: '#FFF4D6' }]} accessibilityRole="alert">
              <Icon name="information-circle-outline" color="#8A5A00" />
              <Text style={[s.body, { flex: 1, color: C.navy }]}>
                Your last request at {stopName(explained.stop_id)} was cancelled:{' '}
                {cancelReasonLabels[explained.cancel_reason as string]?.toLowerCase()}.
              </Text>
            </View>
          )}
          <View style={{ gap: 4 }}>
            <SectionLabel>Request a pickup</SectionLabel>
            <Text style={s.title}>Where should we pick you up?</Text>
          </View>
          {trip?.active ? <SeatsLine trip={trip} now={now} /> : null}
          {trip?.active && pickup ? (
            <ArrivalLine trip={trip} stopId={pickup} stops={stops} now={now} />
          ) : null}
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
                      aria-checked={selected}
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
                          {saved(stop.id)?.label ? `${saved(stop.id)?.label} · ` : ''}
                          {stop.name}
                        </Text>
                        {(onDemand || waiting(stop.id) > 0) && (
                          <Text style={s.caption}>
                            {[
                              onDemand ? 'On-demand stop' : '',
                              waiting(stop.id) > 0 ? `${waiting(stop.id)} waiting` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        )}
                      </View>
                      {!!saved(stop.id) && <Icon name="star" size={16} color={C.coral} />}
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
                      aria-checked={destination === stop.id}
                      accessibilityLabel={`Drop-off at ${stop.name}`}
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
          <View style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: helpOpen }}
              aria-expanded={helpOpen}
              accessibilityLabel={`Boarding assistance, optional${help.needs.length ? `, ${help.needs.length} selected` : ''}`}
              onPress={() => setHelpOpen(!helpOpen)}
              style={(state) => [s.stopOption, focusRing(state)]}
            >
              <Icon name="accessibility-outline" color={C.navy} size={22} />
              <View style={{ flex: 1 }}>
                <Text style={s.heading}>Boarding assistance (optional)</Text>
                <Text style={s.caption}>
                  {help.needs.length
                    ? `${help.needs.length} selected · sent with your request`
                    : 'Ramp or lift, extra boarding time, or other help'}
                </Text>
              </View>
              <Icon name={helpOpen ? 'chevron-up' : 'chevron-down'} color={C.muted} size={18} />
            </Pressable>
            {helpOpen && (
              <>
                <AssistancePicker value={help} onChange={setHelp} />
                <Text style={s.caption}>
                  Your driver must acknowledge it. Acknowledging means they’ve seen it; it isn’t a
                  guarantee that assistance is available. You can change it until you board.
                </Text>
              </>
            )}
          </View>
          <Button
            large
            label={pickup && !blocker ? `I’m waiting at ${stopName(pickup)}` : 'I’m waiting here'}
            loadingLabel="Sending request…"
            icon="hand-left-outline"
            loading={requesting}
            disabled={busy || !!blocker}
            onPress={async () => {
              const ok = await mutate(
                '/requests',
                {
                  tripId: trip?.id,
                  stopId: pickup,
                  destinationId: destination,
                  ...(help.needs.length ? { assistance: assistanceBody(help) } : {}),
                },
                help.needs.length
                  ? 'Pickup requested with boarding assistance. Wait for the driver to accept and acknowledge.'
                  : 'Pickup requested. Wait for the driver to accept.',
              );
              if (ok) {
                setHelp(emptyAssistance);
                setHelpOpen(false);
              }
            }}
          />
          <View style={[s.row, { alignItems: 'flex-start', justifyContent: 'flex-start' }]}>
            <Icon name="information-circle-outline" size={18} color={C.muted} />
            <Text style={[s.caption, { flex: 1 }]}>
              {blocker ||
                `Your driver sees your request and how many riders are waiting. It’s confirmed only when the driver accepts; unaccepted requests clear after ${expiryMinutes} minutes.`}
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
  onPress,
}: {
  icon: 'radio-button-on' | 'flag';
  color: string;
  label: string;
  name: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${name}. Opens stop details`}
      onPress={onPress}
      style={[s.row, { justifyContent: 'flex-start', gap: 12 }]}
    >
      <Icon name={icon} size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={s.caption}>{label}</Text>
        <Text style={s.heading}>{name}</Text>
      </View>
      <Icon name="chevron-forward" size={16} color={C.muted} />
    </Pressable>
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
