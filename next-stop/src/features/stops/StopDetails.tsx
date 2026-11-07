import React from 'react';
import { Linking, Pressable, Share, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Icon, SectionLabel, StatusChip, Tag, s } from '../../components/UI';
import { amenityIcons, amenityLabels } from '../../catalog';
import { clock, directionsUrl, isBoardable, scheduledAt, waitingAt } from '../../domain';
import type { Role, Schedule, Snapshot } from '../../domain';
import { gpsStatus } from '../journeys/MapCard';
import SeatsLine from '../journeys/SeatsLine';
import ArrivalLine from '../journeys/ArrivalLine';
import type { Mutate } from '../workspace/types';
import StopEditor from './StopEditor';
import StopPhoto from './StopPhoto';

const LABELS = ['Home', 'Classes', 'Work', 'Groceries'];

export default function StopDetails({
  org,
  stopId,
  data,
  role,
  schedule,
  busy,
  pending,
  mutate,
  onBack,
  onRequestHere,
  now,
}: {
  org: string;
  stopId: string;
  data: Snapshot;
  role: Role;
  schedule: Schedule | null;
  busy: boolean;
  pending: string;
  mutate: Mutate;
  onBack: () => void;
  onRequestHere?: (stopId: string) => void;
  now: number;
}) {
  const stop = data.stops.find((x) => x.id === stopId);
  if (!stop)
    return (
      <Card>
        <Back onBack={onBack} />
        <Text style={s.title}>Stop not available</Text>
        <Text style={s.body}>This stop is not open in your institution.</Text>
      </Card>
    );
  const favorite = data.favorites?.find((f) => f.kind === 'stop' && f.target_id === stop.id);
  const routes = (data.routes || []).filter((r) =>
    (data.routeStops || []).some((e) => e.route_id === r.id && e.stop_id === stop.id),
  );
  const trips = data.trips.filter(
    (t) => t.active && (!t.route_id || routes.some((r) => r.id === t.route_id)),
  );
  const waiting = waitingAt(data, stop.id);
  const tz = schedule?.timezone;
  const upcoming = routes.map((route) => {
    const day = schedule?.routes?.find((r) => r.route_id === route.id);
    const positions = (data.routeStops || []).filter(
      (e) => e.route_id === route.id && e.stop_id === stop.id,
    );
    const times = positions
      .flatMap((e) => scheduledAt(day?.departures || [], e.offset_minutes) || [])
      .filter((t) => t >= now - 60000)
      .sort((a, b) => a - b);
    const published = positions.some((e) => e.offset_minutes != null) && !!day?.departures.length;
    return { route, times: times.slice(0, 4), published, closed: !!day?.closed };
  });
  const hasDetails =
    !!stop.description || !!stop.accessibility || !!stop.amenities?.length || !!stop.has_photo;
  const boardable = isBoardable(stop);
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 14 }}>
        <View style={s.row}>
          <Back onBack={onBack} />
          {boardable && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={favorite ? `Remove ${stop.name} from saved` : `Save ${stop.name}`}
              disabled={busy}
              onPress={() =>
                favorite
                  ? mutate(
                      '/favorites/remove',
                      { kind: 'stop', targetId: stop.id },
                      'Removed from saved stops.',
                    )
                  : mutate('/favorites', { kind: 'stop', targetId: stop.id }, 'Stop saved.')
              }
              style={{ padding: 8 }}
            >
              <Icon
                name={favorite ? 'star' : 'star-outline'}
                color={favorite ? C.coral : C.navy}
                size={24}
              />
            </Pressable>
          )}
        </View>
        <View style={{ gap: 6 }}>
          <SectionLabel>Stop</SectionLabel>
          <Text style={[s.title, { fontSize: 24 }]}>{stop.name}</Text>
          {!boardable ? (
            <StatusChip text="Location not confirmed yet · no pickups here" tone="gray" />
          ) : stop.details_verified_at ? (
            <StatusChip
              text={`Details verified by your institution · ${new Date(stop.details_verified_at).toLocaleDateString()}`}
              tone="green"
            />
          ) : hasDetails ? (
            <StatusChip text="Details not yet verified by your institution" tone="amber" />
          ) : null}
        </View>
        {favorite && (
          <View style={s.pills}>
            {LABELS.map((label) => (
              <Pressable
                key={label}
                accessibilityRole="radio"
                accessibilityState={{ selected: favorite.label === label }}
                aria-checked={favorite.label === label}
                disabled={busy}
                onPress={() =>
                  mutate(
                    '/favorites',
                    {
                      kind: 'stop',
                      targetId: stop.id,
                      label: favorite.label === label ? '' : label,
                    },
                    'Saved place updated.',
                  )
                }
                style={[s.pill, favorite.label === label && s.pillActive]}
              >
                <Text style={[s.pillText, favorite.label === label && { color: 'white' }]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <StopPhoto org={org} stop={stop} />
        {!!stop.description && <Text style={[s.body, { color: C.navy }]}>{stop.description}</Text>}
        {boardable && (
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Button
                icon="navigate-outline"
                label="Directions"
                onPress={() => void Linking.openURL(directionsUrl(stop))}
              />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Button
                secondary
                icon="share-outline"
                label="Share location"
                onPress={() =>
                  void Share.share({ message: `${stop.name} shuttle stop: ${directionsUrl(stop)}` })
                }
              />
            </View>
          </View>
        )}
        {boardable && (
          <Text style={s.caption}>
            Directions open your maps app; NEXT STOP does not read your location.
          </Text>
        )}
      </Card>

      {boardable && (
        <Card>
          <View style={s.row}>
            <Text style={s.heading}>Live now</Text>
            <Tag
              text={waiting === 1 ? '1 rider waiting' : `${waiting} riders waiting`}
              tone={waiting ? 'coral' : 'gray'}
            />
          </View>
          {trips.length ? (
            trips.map((trip) => {
              const gps = gpsStatus(trip, now);
              return (
                <View key={trip.id} style={{ gap: 6 }}>
                  <StatusChip text={gps.text} tone={gps.tone} />
                  <ArrivalLine trip={trip} stopId={stop.id} stops={data.stops} now={now} />
                  <SeatsLine trip={trip} now={now} />
                </View>
              );
            })
          ) : (
            <Text style={s.body}>No shuttle serving this stop is in service right now.</Text>
          )}
          {role === 'student' && onRequestHere && trips.length > 0 && (
            <Button
              large
              icon="hand-left-outline"
              label={`I’m waiting at ${stop.name}`}
              disabled={busy}
              onPress={() => onRequestHere(stop.id)}
            />
          )}
        </Card>
      )}

      {routes.length > 0 && (
        <Card>
          <View style={s.row}>
            <Text style={s.heading}>Scheduled today</Text>
            <Tag text="Timetable" tone="gray" />
          </View>
          {!schedule?.configured ? (
            <Text style={s.body}>Your institution has not published a timetable.</Text>
          ) : (
            upcoming.map(({ route, times, published, closed }) => (
              <View key={route.id} style={{ gap: 6 }}>
                <View style={[s.row, { justifyContent: 'flex-start' }]}>
                  <View
                    style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: route.color }}
                  />
                  <Text style={[s.heading, { flex: 1 }]}>{route.name}</Text>
                </View>
                <Text style={s.body}>
                  {closed
                    ? 'No service today.'
                    : !published
                      ? 'No scheduled times published for this stop.'
                      : times.length
                        ? times.map((t) => clock(t, tz)).join('  ·  ')
                        : 'No more scheduled departures today.'}
                </Text>
              </View>
            ))
          )}
          <Text style={s.caption}>
            Scheduled times come from your institution’s timetable. They are not live arrival
            estimates.
          </Text>
        </Card>
      )}

      {(stop.amenities?.length || stop.accessibility) && (
        <Card>
          <Text style={s.heading}>Amenities and accessibility</Text>
          {stop.amenities?.map((a) => (
            <View key={a.key} style={[s.row, { justifyContent: 'flex-start', gap: 12 }]}>
              <Icon name={amenityIcons[a.key] || 'checkmark-circle-outline'} color={C.navy} />
              <View style={{ flex: 1 }}>
                <Text style={s.heading}>{amenityLabels[a.key] || a.key}</Text>
                {!!a.detail && <Text style={s.caption}>{a.detail}</Text>}
              </View>
            </View>
          ))}
          {!!stop.accessibility && (
            <View
              style={[s.row, { justifyContent: 'flex-start', alignItems: 'flex-start', gap: 12 }]}
            >
              <Icon name="accessibility-outline" color={C.navy} />
              <Text style={[s.body, { flex: 1, color: C.navy }]}>{stop.accessibility}</Text>
            </View>
          )}
          <Text style={s.caption}>
            {stop.details_verified_at
              ? `Verified by ${stop.details_verified_by || 'an administrator'} on ${new Date(stop.details_verified_at).toLocaleDateString()}.`
              : 'Entered by your institution and not yet verified.'}
          </Text>
        </Card>
      )}

      {routes.length > 0 && (
        <Card>
          <Text style={s.heading}>Routes serving this stop</Text>
          {routes.map((route) => (
            <View key={route.id} style={[s.row, { justifyContent: 'flex-start' }]}>
              <View
                style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: route.color }}
              />
              <Text style={[s.body, { flex: 1, color: C.navy }]}>{route.name}</Text>
            </View>
          ))}
        </Card>
      )}

      {role === 'admin' && (
        <StopEditor
          key={stop.id}
          org={org}
          stop={stop}
          busy={busy}
          pending={pending}
          mutate={mutate}
        />
      )}
    </View>
  );
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onBack}
      style={[s.row, { paddingVertical: 8, paddingRight: 12, justifyContent: 'flex-start' }]}
    >
      <Icon name="chevron-back" size={22} />
      <Text style={s.heading}>Back</Text>
    </Pressable>
  );
}
