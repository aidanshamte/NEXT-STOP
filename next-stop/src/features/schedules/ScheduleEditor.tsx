import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, Card, Field, s } from '../../components/UI';
import { routeSequence } from '../../domain';
import type { Schedule, Snapshot } from '../../domain';
import type { Mutate } from '../workspace/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function Choice<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <View style={s.pills} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(([id, name]) => (
        <Pressable
          key={id || 'none'}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === id }}
          aria-checked={value === id}
          onPress={() => onChange(id)}
          style={[s.pill, value === id && s.pillActive]}
        >
          <Text style={[s.pillText, value === id && { color: 'white' }]}>{name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Administrator timetable entry: service periods, departures, stop times and closures. Only
 * the institution's own published schedule belongs here. */
export default function ScheduleEditor({
  data,
  schedule,
  busy,
  mutate,
  reload,
}: {
  data: Snapshot;
  schedule: Schedule | null;
  busy: boolean;
  pending: string;
  mutate: Mutate;
  reload: () => void;
}) {
  const routes = data.routes || [];
  const periods = schedule?.periods || [];
  const [period, setPeriod] = useState({ name: '', startDate: '', endDate: '', days: '1111100' });
  const [routeId, setRouteId] = useState(routes[0]?.id || '');
  const [periodId, setPeriodId] = useState('');
  const [mode, setMode] = useState<'every' | 'list'>('every');
  const [freq, setFreq] = useState({ from: '07:00', to: '22:00', every: '15' });
  const [list, setList] = useState('');
  const [offsets, setOffsets] = useState<Record<string, string>>({});
  const [exception, setException] = useState({
    date: '',
    kind: 'closed' as 'closed' | 'note',
    note: '',
    routeId: '',
  });
  const save = async (path: string, body: object, success: string) => {
    const ok = await mutate(path, body, success);
    if (ok) reload();
    return ok;
  };
  if (!data.settings?.timezone)
    return (
      <Card>
        <Text style={s.title}>Publish a timetable</Text>
        <Text style={s.body}>
          Set your institution’s time zone in Setup first. Times are entered as local times.
        </Text>
      </Card>
    );
  const chosenPeriod = periodId || periods[0]?.id || '';
  const sequence = routeId ? routeSequence(routeId, data.routeStops || [], data.stops) : [];
  const existing = (schedule?.departures || []).filter(
    (d) => d.route_id === routeId && d.period_id === chosenPeriod,
  );
  return (
    <Card style={{ gap: 14 }}>
      <Text style={s.title}>Publish a timetable</Text>
      <Text style={s.caption}>
        Enter only your institution’s real schedule. Riders see these as “Scheduled” times, separate
        from live positions. Time zone: {data.settings.timezone}.
      </Text>

      <Text style={s.heading}>1. Service periods</Text>
      {periods.map((p) => (
        <View key={p.id} style={[s.row, { flexWrap: 'wrap' }]}>
          <Text style={[s.body, { flex: 1, minWidth: 180 }]}>
            {p.name}: {p.start_date} to {p.end_date} ·{' '}
            {DAYS.filter((_, i) => p.days[i] === '1').join(' ')}
          </Text>
          <Button
            secondary
            label="Delete"
            disabled={busy}
            onPress={() =>
              void save('/schedule/period/delete', { periodId: p.id }, 'Service period deleted.')
            }
          />
        </View>
      ))}
      <Field
        label="Period name (e.g. Fall term weekdays)"
        value={period.name}
        onChange={(name) => setPeriod({ ...period, name })}
      />
      <Field
        label="First day (YYYY-MM-DD)"
        value={period.startDate}
        onChange={(startDate) => setPeriod({ ...period, startDate })}
      />
      <Field
        label="Last day (YYYY-MM-DD)"
        value={period.endDate}
        onChange={(endDate) => setPeriod({ ...period, endDate })}
      />
      <View style={s.pills}>
        {DAYS.map((d, i) => {
          const on = period.days[i] === '1';
          return (
            <Pressable
              key={d}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              onPress={() =>
                setPeriod({
                  ...period,
                  days: period.days.slice(0, i) + (on ? '0' : '1') + period.days.slice(i + 1),
                })
              }
              style={[s.pill, on && s.pillActive]}
            >
              <Text style={[s.pillText, on && { color: 'white' }]}>{d}</Text>
            </Pressable>
          );
        })}
      </View>
      <Button
        label="Add service period"
        disabled={busy || !period.name.trim()}
        onPress={() =>
          void save(
            '/schedule/period',
            { ...period, name: period.name.trim() },
            'Service period added.',
          ).then((ok) => ok && setPeriod({ name: '', startDate: '', endDate: '', days: '1111100' }))
        }
      />

      <View style={s.divider} />
      <Text style={s.heading}>2. Departures from the first stop</Text>
      {!routes.length || !periods.length ? (
        <Text style={s.body}>Add a route (Setup) and a service period first.</Text>
      ) : (
        <>
          <Choice
            label="Route"
            options={routes.map((r) => [r.id, r.name])}
            value={routeId}
            onChange={setRouteId}
          />
          <Choice
            label="Service period"
            options={periods.map((p) => [p.id, p.name])}
            value={chosenPeriod}
            onChange={setPeriodId}
          />
          <Text style={s.caption}>
            Currently {existing.length} departures
            {existing.length
              ? `: ${existing
                  .slice(0, 6)
                  .map((d) => hhmm(d.minute))
                  .join(', ')}${existing.length > 6 ? '…' : ''}`
              : ''}
            . Saving replaces them.
          </Text>
          <Choice
            label="Entry type"
            options={[
              ['every', 'Regular frequency'],
              ['list', 'List of times'],
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'every' ? (
            <>
              <Field
                label="First departure (HH:MM, 24-hour)"
                value={freq.from}
                onChange={(from) => setFreq({ ...freq, from })}
              />
              <Field
                label="Last departure (HH:MM)"
                value={freq.to}
                onChange={(to) => setFreq({ ...freq, to })}
              />
              <Field
                label="Every (minutes)"
                value={freq.every}
                onChange={(every) => setFreq({ ...freq, every })}
              />
            </>
          ) : (
            <Field
              label="Times, separated by commas (HH:MM)"
              value={list}
              onChange={setList}
              placeholder="07:00, 07:20, 08:05"
            />
          )}
          <Button
            label="Save departures"
            disabled={busy}
            onPress={() =>
              void save(
                '/schedule/departures',
                mode === 'every'
                  ? {
                      routeId,
                      periodId: chosenPeriod,
                      from: freq.from,
                      to: freq.to,
                      every: Number(freq.every),
                    }
                  : {
                      routeId,
                      periodId: chosenPeriod,
                      times: list
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    },
                'Departures saved.',
              )
            }
          />

          <View style={s.divider} />
          <Text style={s.heading}>3. Minutes from the first stop</Text>
          <Text style={s.caption}>
            Leave blank where your institution publishes no time (for example on-demand stops).
          </Text>
          {sequence.map(({ stop, position }) => {
            const entry = data.routeStops?.find(
              (e) => e.route_id === routeId && e.position === position,
            );
            const key = `${routeId}|${position}`;
            const value =
              offsets[key] ?? (entry?.offset_minutes != null ? String(entry.offset_minutes) : '');
            return (
              <View key={key} style={[s.row, { gap: 10 }]}>
                <Text style={[s.body, { flex: 1 }]}>
                  {position + 1}. {stop.name}
                </Text>
                <TextInput
                  accessibilityLabel={`Minutes from first stop to ${stop.name}`}
                  value={value}
                  onChangeText={(v) => setOffsets((o) => ({ ...o, [key]: v }))}
                  keyboardType="number-pad"
                  style={[s.input, { width: 80, minHeight: 40, padding: 8 }]}
                />
              </View>
            );
          })}
          <Button
            label="Save stop times"
            disabled={busy || !sequence.length}
            onPress={() =>
              void save(
                '/schedule/offsets',
                {
                  routeId,
                  offsets: sequence.map(({ position }) => {
                    const entry = data.routeStops?.find(
                      (e) => e.route_id === routeId && e.position === position,
                    );
                    const raw =
                      offsets[`${routeId}|${position}`] ??
                      (entry?.offset_minutes != null ? String(entry.offset_minutes) : '');
                    return { position, minutes: raw.trim() === '' ? null : Number(raw) };
                  }),
                },
                'Stop times saved.',
              ).then((ok) => ok && setOffsets({}))
            }
          />
        </>
      )}

      <View style={s.divider} />
      <Text style={s.heading}>4. Closures and notes</Text>
      {(schedule?.exceptions || []).map((e) => (
        <View key={e.id} style={[s.row, { flexWrap: 'wrap' }]}>
          <Text style={[s.body, { flex: 1, minWidth: 180 }]}>
            {e.date} · {e.kind === 'closed' ? 'No service' : 'Note'}
            {e.route_id ? ` (${routes.find((r) => r.id === e.route_id)?.name})` : ''}
            {e.note ? `: ${e.note}` : ''}
          </Text>
          <Button
            secondary
            label="Remove"
            disabled={busy}
            onPress={() =>
              void save('/schedule/exception/delete', { exceptionId: e.id }, 'Removed.')
            }
          />
        </View>
      ))}
      <Field
        label="Date (YYYY-MM-DD)"
        value={exception.date}
        onChange={(date) => setException({ ...exception, date })}
      />
      <Choice
        label="Kind"
        options={[
          ['closed', 'No service'],
          ['note', 'Note only'],
        ]}
        value={exception.kind}
        onChange={(kind) => setException({ ...exception, kind })}
      />
      <Choice
        label="Applies to"
        options={[['', 'All routes'], ...routes.map((r): [string, string] => [r.id, r.name])]}
        value={exception.routeId}
        onChange={(id) => setException({ ...exception, routeId: id })}
      />
      <Field
        label="Note for riders"
        value={exception.note}
        onChange={(note) => setException({ ...exception, note })}
      />
      <Button
        label="Add to calendar"
        disabled={busy}
        onPress={() =>
          void save(
            '/schedule/exception',
            {
              date: exception.date,
              kind: exception.kind,
              note: exception.note,
              routeId: exception.routeId || null,
            },
            'Calendar updated.',
          ).then((ok) => ok && setException({ date: '', kind: 'closed', note: '', routeId: '' }))
        }
      />
    </Card>
  );
}
