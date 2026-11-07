import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Field, Icon, SectionLabel, Tag, s } from '../../components/UI';
import { ago } from '../../domain';
import type { Role, Route, ServiceAlert, Trip } from '../../domain';
import type { Mutate } from '../workspace/types';
import ServiceNotice from './ServiceNotice';

const severityText = { info: 'Notice', delay: 'Delay', interruption: 'Service interruption' };
const severityTone = { info: 'gray', delay: 'amber', interruption: 'coral' } as const;

export function AlertBanner({ alert, routes }: { alert: ServiceAlert; routes: Route[] }) {
  const route = routes.find((r) => r.id === alert.route_id);
  return (
    <View
      accessibilityRole="alert"
      style={{
        gap: 4,
        padding: 16,
        borderRadius: 20,
        backgroundColor:
          alert.severity === 'info'
            ? '#EEF2F5'
            : alert.severity === 'delay'
              ? '#FFF4D6'
              : '#FFF0E9',
      }}
    >
      <Text style={[s.eyebrow, { color: alert.severity === 'interruption' ? '#C2381F' : C.navy }]}>
        {severityText[alert.severity].toUpperCase()} ·{' '}
        {route ? route.name.toUpperCase() : 'ALL ROUTES'}
      </Text>
      <Text style={s.heading}>{alert.title}</Text>
      {!!alert.body && <Text style={[s.body, { color: C.navy }]}>{alert.body}</Text>}
    </View>
  );
}

/** Alerts from dispatch (per route or institution-wide) and per-vehicle driver updates. */
export default function ServiceUpdates({
  trips,
  alerts = [],
  routes = [],
  role,
  busy,
  mutate,
  now,
}: {
  trips: Trip[];
  alerts?: ServiceAlert[];
  routes?: Route[];
  role: Role;
  busy: boolean;
  pending: string;
  mutate: Mutate;
  now: number;
}) {
  const disrupted = trips.filter((t) => t.issue || t.delay_minutes);
  const current = alerts.filter((a) => a.starts_at <= now);
  const upcoming = alerts.filter((a) => a.starts_at > now);
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        <SectionLabel>Alerts</SectionLabel>
        <Text style={s.title}>Service updates</Text>
      </View>
      {current.map((a) => (
        <View key={a.id} style={{ gap: 6 }}>
          <AlertBanner alert={a} routes={routes} />
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            <Text style={s.caption}>
              From dispatch · {ago(a.created_at, now)}
              {a.ends_at ? ` · until ${new Date(a.ends_at).toLocaleString()}` : ''}
            </Text>
            {role === 'admin' && (
              <Button
                secondary
                label="Resolve"
                disabled={busy}
                onPress={() => mutate('/alerts/resolve', { alertId: a.id }, 'Alert resolved.')}
              />
            )}
          </View>
        </View>
      ))}
      {disrupted.map((t) => (
        <ServiceNotice key={t.id} trip={t} />
      ))}
      {!current.length && !disrupted.length && (
        <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
          <Icon name="checkmark-circle-outline" size={30} color={C.green} />
          <Text style={s.heading}>No reported disruptions</Text>
          <Text style={[s.caption, { textAlign: 'center' }]}>
            Dispatch and drivers publish delays and interruptions here. This list updates on its
            own.
          </Text>
        </Card>
      )}
      {upcoming.length > 0 && (
        <Card>
          <Text style={s.heading}>Coming up</Text>
          {upcoming.map((a) => (
            <View key={a.id} style={{ gap: 2 }}>
              <Tag
                text={`${severityText[a.severity]} · from ${new Date(a.starts_at).toLocaleString()}`}
                tone={severityTone[a.severity]}
              />
              <Text style={s.heading}>{a.title}</Text>
              {!!a.body && <Text style={s.body}>{a.body}</Text>}
            </View>
          ))}
        </Card>
      )}
      {role === 'admin' && <AlertComposer routes={routes} busy={busy} mutate={mutate} />}
    </View>
  );
}

function AlertComposer({
  routes,
  busy,
  mutate,
}: {
  routes: Route[];
  busy: boolean;
  mutate: Mutate;
}) {
  const [severity, setSeverity] = useState<'info' | 'delay' | 'interruption'>('delay');
  const [routeId, setRouteId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [hours, setHours] = useState('');
  return (
    <Card>
      <Text style={s.title}>Publish an alert</Text>
      <Text style={s.caption}>
        Delays and interruptions are pushed to riders following the route (or everyone, for all
        routes) who have these alerts on. Notices appear here only.
      </Text>
      <View style={s.pills}>
        {(['delay', 'interruption', 'info'] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ selected: severity === k }}
            aria-checked={severity === k}
            onPress={() => setSeverity(k)}
            style={[s.pill, severity === k && s.pillActive]}
          >
            <Text style={[s.pillText, severity === k && { color: 'white' }]}>
              {severityText[k]}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={s.pills}>
        {[{ id: '', name: 'All routes' }, ...routes].map((r) => (
          <Pressable
            key={r.id || 'all'}
            accessibilityRole="radio"
            accessibilityState={{ selected: routeId === r.id }}
            aria-checked={routeId === r.id}
            onPress={() => setRouteId(r.id)}
            style={[s.pill, routeId === r.id && s.pillActive]}
          >
            <Text style={[s.pillText, routeId === r.id && { color: 'white' }]}>{r.name}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="Headline" value={title} onChange={setTitle} />
      <Text style={s.label}>DETAILS</Text>
      <TextInput
        accessibilityLabel="Details"
        multiline
        maxLength={500}
        value={body}
        onChangeText={setBody}
        style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]}
      />
      <Field label="Ends after (hours, optional)" value={hours} onChange={setHours} />
      <Button
        label="Publish alert"
        icon="megaphone-outline"
        disabled={busy || !title.trim()}
        onPress={() => {
          const h = Number(hours);
          void mutate(
            '/alerts',
            {
              severity,
              routeId: routeId || null,
              title: title.trim(),
              body,
              ...(hours.trim() && h > 0 ? { endsAt: Date.now() + h * 3600000 } : {}),
            },
            'Alert published.',
          ).then((ok) => {
            if (ok) {
              setTitle('');
              setBody('');
              setHours('');
            }
          });
        }}
      />
    </Card>
  );
}
