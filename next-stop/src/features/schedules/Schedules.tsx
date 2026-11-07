import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Card, Icon, SectionLabel, StatusChip, Tag, s } from '../../components/UI';
import { clock, headway, routeSequence, scheduledAt, weekDates } from '../../domain';
import type { Role, Schedule, Snapshot } from '../../domain';
import type { Mutate } from '../workspace/types';
import ScheduleEditor from './ScheduleEditor';

const dayLabel = (date: string, index: number) => {
  if (index === 0) return 'Today';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString([], {
    weekday: 'short',
    timeZone: 'UTC',
  });
};

/** Published timetables. Scheduled times are always labelled as such; live service is shown
 * separately and never mixed into a scheduled time. */
export default function Schedules({
  data,
  role,
  schedule,
  date,
  setDate,
  error,
  reload,
  busy,
  pending,
  mutate,
  onOpenStop,
  now,
}: {
  data: Snapshot;
  role: Role;
  schedule: Schedule | null;
  date: string;
  setDate: (date: string) => void;
  error: string;
  reload: () => void;
  busy: boolean;
  pending: string;
  mutate: Mutate;
  onOpenStop: (stopId: string) => void;
  now: number;
}) {
  const [routeFilter, setRouteFilter] = useState('');
  const tz = schedule?.timezone || data.settings?.timezone || undefined;
  const dates = weekDates(now, tz);
  const selected = date || dates[0];
  const isToday = selected === dates[0];
  const routes = (data.routes || []).filter((r) => !routeFilter || r.id === routeFilter);
  const notes = (schedule?.exceptions || []).filter((e) => e.date >= dates[0]);
  const dayNotes = notes.filter((e) => e.date === selected);
  const active = (schedule?.periods || []).filter((p) => schedule?.activePeriodIds?.includes(p.id));
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <SectionLabel>Timetables</SectionLabel>
        <Text style={s.title}>Schedules</Text>
      </View>
      <View style={s.pills} accessibilityRole="radiogroup" accessibilityLabel="Day">
        {dates.map((d, i) => (
          <Pressable
            key={d}
            accessibilityRole="radio"
            accessibilityState={{ selected: d === selected }}
            aria-checked={d === selected}
            onPress={() => setDate(i === 0 ? '' : d)}
            style={[s.pill, d === selected && s.pillActive]}
          >
            <Text style={[s.pillText, d === selected && { color: 'white' }]}>{dayLabel(d, i)}</Text>
          </Pressable>
        ))}
      </View>
      {(data.routes || []).length > 1 && (
        <View style={s.pills} accessibilityRole="radiogroup" accessibilityLabel="Route">
          {[{ id: '', name: 'All routes' }, ...(data.routes || [])].map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: routeFilter === r.id }}
              aria-checked={routeFilter === r.id}
              onPress={() => setRouteFilter(r.id)}
              style={[s.pill, routeFilter === r.id && s.pillActive]}
            >
              <Text style={[s.pillText, routeFilter === r.id && { color: 'white' }]}>{r.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!!error && !schedule && <StatusChip text={`Timetable unavailable: ${error}`} tone="coral" />}
      {schedule && !schedule.configured ? (
        <Card>
          <Icon name="calendar-outline" size={30} color={C.muted} />
          <Text style={s.heading}>No timetable published yet</Text>
          <Text style={s.body}>
            Your institution has not published scheduled times. Live shuttle positions are on the{' '}
            {role === 'driver' ? 'Drive' : 'Live'} screen.
          </Text>
        </Card>
      ) : schedule ? (
        <>
          <Card style={{ gap: 10 }}>
            {schedule.closed ? (
              <StatusChip text="No service on this day" tone="coral" />
            ) : active.length ? (
              <StatusChip
                text={`Timetable: ${active.map((p) => p.name).join(', ')}`}
                tone="green"
              />
            ) : (
              <StatusChip text="No scheduled service on this day" tone="gray" />
            )}
            {dayNotes.map((n) => (
              <Text key={n.id} style={[s.body, { color: C.navy }]}>
                {n.kind === 'closed' ? 'Closed' : 'Note'}
                {n.route_id
                  ? ` (${data.routes?.find((r) => r.id === n.route_id)?.name || 'route'})`
                  : ''}
                {n.note ? `: ${n.note}` : ''}
              </Text>
            ))}
            <Text style={s.caption}>
              Times are your institution’s published schedule ({schedule.timezone}). Live positions
              and estimates appear on the {role === 'driver' ? 'Drive' : 'Live'} screen and are
              labelled “Live”.
            </Text>
          </Card>
          {routes.map((route) => {
            const day = schedule.routes?.find((r) => r.route_id === route.id);
            const departures = day?.departures || [];
            const sequence = routeSequence(route.id, data.routeStops || [], data.stops);
            const every = headway(departures);
            const inService = data.trips.filter((t) => t.active && t.route_id === route.id).length;
            const favorite = data.favorites?.some(
              (f) => f.kind === 'route' && f.target_id === route.id,
            );
            const last = sequence.at(-1);
            const loop = last && last.stop.id === sequence[0]?.stop.id && last.onDemand === false;
            return (
              <Card key={route.id} style={{ gap: 12 }}>
                <View style={[s.row, { alignItems: 'flex-start' }]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={[s.row, { justifyContent: 'flex-start' }]}>
                      <View
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 6,
                          backgroundColor: route.color,
                        }}
                      />
                      <Text style={s.title}>{route.name}</Text>
                    </View>
                    <Text style={s.body}>
                      {day?.closed
                        ? 'No service on this day.'
                        : departures.length
                          ? `${clock(departures[0], tz)} – ${clock(departures.at(-1) as number, tz)} · ${departures.length} departures${every ? ` · about every ${every} min` : ''}`
                          : 'No scheduled departures on this day.'}
                    </Text>
                    {isToday && inService > 0 && (
                      <StatusChip
                        text={`Live: ${inService} shuttle${inService === 1 ? '' : 's'} in service`}
                        tone="green"
                      />
                    )}
                  </View>
                  {role !== 'admin' && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        favorite
                          ? `Stop following ${route.name}`
                          : `Follow ${route.name} for alerts`
                      }
                      disabled={busy}
                      onPress={() =>
                        favorite
                          ? mutate(
                              '/favorites/remove',
                              { kind: 'route', targetId: route.id },
                              'Route unfollowed.',
                            )
                          : mutate(
                              '/favorites',
                              { kind: 'route', targetId: route.id },
                              'Following this route: you’ll get its delay and interruption alerts.',
                            )
                      }
                      style={{ padding: 6 }}
                    >
                      <Icon
                        name={favorite ? 'star' : 'star-outline'}
                        color={favorite ? C.coral : C.navy}
                        size={22}
                      />
                    </Pressable>
                  )}
                </View>
                {sequence.map(({ stop, onDemand, position }) => {
                  const entry = data.routeStops?.find(
                    (e) => e.route_id === route.id && e.position === position,
                  );
                  const times = scheduledAt(departures, entry?.offset_minutes) || [];
                  const upcoming = isToday ? times.filter((t) => t >= now - 60000) : times;
                  return (
                    <Pressable
                      key={`${stop.id}-${position}`}
                      accessibilityRole="link"
                      accessibilityHint="Opens stop details"
                      onPress={() => onOpenStop(stop.id)}
                      style={[s.row, { alignItems: 'flex-start', paddingVertical: 4 }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[s.heading, stop.status === 'draft' && { color: C.muted }]}>
                          {stop.name}
                        </Text>
                        <Text style={s.caption}>
                          {stop.status === 'draft'
                            ? 'Not yet open'
                            : onDemand
                              ? 'On demand'
                              : entry?.offset_minutes != null
                                ? `${entry.offset_minutes} min from first stop`
                                : 'No scheduled time published'}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        {upcoming.length > 0 ? (
                          <>
                            <Text style={s.heading}>{clock(upcoming[0], tz)}</Text>
                            <Text style={s.caption}>
                              Scheduled{upcoming[1] ? ` · then ${clock(upcoming[1], tz)}` : ''}
                            </Text>
                          </>
                        ) : times.length ? (
                          <Text style={s.caption}>Done for today</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
                {!sequence.length && <Text style={s.body}>This route has no stops yet.</Text>}
                {loop && entryDuration(data, route.id) != null && (
                  <Tag text={`Loop about ${entryDuration(data, route.id)} min`} tone="gray" />
                )}
              </Card>
            );
          })}
          {notes.filter((n) => n.date !== selected).length > 0 && (
            <Card>
              <Text style={s.heading}>Upcoming schedule notes</Text>
              {notes
                .filter((n) => n.date !== selected)
                .slice(0, 8)
                .map((n) => (
                  <Text key={n.id} style={s.body}>
                    {n.date} · {n.kind === 'closed' ? 'No service' : 'Note'}
                    {n.route_id
                      ? ` (${data.routes?.find((r) => r.id === n.route_id)?.name || 'route'})`
                      : ''}
                    {n.note ? `: ${n.note}` : ''}
                  </Text>
                ))}
            </Card>
          )}
        </>
      ) : (
        !error && <Text style={s.caption}>Loading timetable…</Text>
      )}
      {role === 'admin' && (
        <ScheduleEditor
          data={data}
          schedule={schedule}
          busy={busy}
          pending={pending}
          mutate={mutate}
          reload={reload}
        />
      )}
    </View>
  );
}

function entryDuration(data: Snapshot, routeId: string) {
  const offsets = (data.routeStops || [])
    .filter((e) => e.route_id === routeId && e.offset_minutes != null)
    .map((e) => e.offset_minutes as number);
  return offsets.length > 1 ? Math.max(...offsets) : null;
}
