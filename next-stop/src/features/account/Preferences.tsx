import React from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Card, Icon, s } from '../../components/UI';
import { defaultPrefs } from '../../domain';
import type { Prefs, Role, Snapshot } from '../../domain';
import type { Mutate } from '../workspace/types';

/** Approach alerts use GPS stop-passage detection at confirmed stop pins (server/eta.mjs). */
export const APPROACH_ALERTS = true;

/** Saved places, followed routes and per-institution notification choices. */
export default function Preferences({
  data,
  role,
  busy,
  mutate,
  onOpenStop,
}: {
  data: Snapshot;
  role: Role;
  busy: boolean;
  mutate: Mutate;
  onOpenStop: (stopId: string) => void;
}) {
  const prefs: Prefs = data.prefs || defaultPrefs;
  const favorites = data.favorites || [];
  const save = (change: Partial<Prefs>) => {
    const next = { ...prefs, ...change };
    void mutate(
      '/prefs',
      {
        tripUpdates: !!next.trip_updates,
        delayAlerts: !!next.delay_alerts,
        serviceAlerts: !!next.service_alerts,
        approachStops: next.approach_stops,
      },
      'Notification preferences saved.',
    );
  };
  const toggle = (label: string, detail: string, value: number, key: keyof Prefs) => (
    <View style={[s.row, { alignItems: 'flex-start' }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.heading}>{label}</Text>
        <Text style={s.caption}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={!!value}
        disabled={busy}
        onValueChange={(on) => save({ [key]: on ? 1 : 0 })}
        trackColor={{ true: C.coral, false: C.line }}
      />
    </View>
  );
  const stops = favorites.filter((f) => f.kind === 'stop');
  const routes = favorites.filter((f) => f.kind === 'route');
  return (
    <>
      {role === 'student' && (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Icon name="bus-outline" size={28} color={C.coral} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{data.rideCount ?? 0}</Text>
            <Text style={s.caption}>Completed rides here (drop-off confirmed by the driver)</Text>
          </View>
        </Card>
      )}
      {role !== 'driver' && (
        <Card>
          <Text style={s.title}>Saved places</Text>
          {!stops.length && (
            <Text style={s.body}>
              Open any stop and tap the star to save it. Saved stops appear first when you request a
              pickup. NEXT STOP saves the stop, never your address.
            </Text>
          )}
          {stops.map((f) => {
            const stop = data.stops.find((x) => x.id === f.target_id);
            if (!stop) return null;
            return (
              <View key={f.target_id} style={s.row}>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => onOpenStop(stop.id)}
                  style={[s.row, { flex: 1, justifyContent: 'flex-start', gap: 12 }]}
                >
                  <Icon name="star" color={C.coral} size={18} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.heading}>{f.label || stop.name}</Text>
                    {!!f.label && <Text style={s.caption}>{stop.name}</Text>}
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${stop.name}`}
                  disabled={busy}
                  onPress={() =>
                    mutate('/favorites/remove', { kind: 'stop', targetId: stop.id }, 'Removed.')
                  }
                  style={{ padding: 8 }}
                >
                  <Icon name="close" color={C.muted} />
                </Pressable>
              </View>
            );
          })}
          {routes.length > 0 && (
            <>
              <Text style={s.label}>FOLLOWED ROUTES</Text>
              {routes.map((f) => {
                const route = data.routes?.find((r) => r.id === f.target_id);
                if (!route) return null;
                return (
                  <View key={f.target_id} style={s.row}>
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: route.color,
                      }}
                    />
                    <Text style={[s.heading, { flex: 1 }]}>{route.name}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Stop following ${route.name}`}
                      disabled={busy}
                      onPress={() =>
                        mutate(
                          '/favorites/remove',
                          { kind: 'route', targetId: route.id },
                          'Route unfollowed.',
                        )
                      }
                      style={{ padding: 8 }}
                    >
                      <Icon name="close" color={C.muted} />
                    </Pressable>
                  </View>
                );
              })}
            </>
          )}
        </Card>
      )}
      {role !== 'driver' && role !== 'admin' && (
        <Card>
          <Text style={s.title}>What to notify me about</Text>
          <Text style={s.caption}>
            Applies to this institution on every device where notifications are on.
          </Text>
          {toggle(
            role === 'parent' ? 'Shared journey updates' : 'My pickup updates',
            'Accepted, approaching, boarded, arrived, cancelled or expired.',
            prefs.trip_updates,
            'trip_updates',
          )}
          {toggle(
            'Driver-reported delays',
            'When the driver of a shuttle you’re riding reports a delay.',
            prefs.delay_alerts,
            'delay_alerts',
          )}
          {toggle(
            'Service alerts',
            'Delays and interruptions from dispatch for routes you follow, or for all routes.',
            prefs.service_alerts,
            'service_alerts',
          )}
          {role === 'student' && APPROACH_ALERTS && (
            <View style={{ gap: 8 }}>
              <Text style={s.heading}>Shuttle approaching my stop</Text>
              <Text style={s.caption}>
                Sent when the shuttle passes the stop before yours (by GPS at confirmed stop
                locations). The driver’s own “approaching” update is always sent with pickup
                updates.
              </Text>
              <View style={s.pills}>
                {[
                  [0, 'Off'],
                  [1, '1 stop before'],
                  [2, '2 stops before'],
                  [3, '3 stops before'],
                ].map(([value, label]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: prefs.approach_stops === value }}
                    aria-checked={prefs.approach_stops === value}
                    disabled={busy}
                    onPress={() => save({ approach_stops: value as number })}
                    style={[s.pill, prefs.approach_stops === value && s.pillActive]}
                  >
                    <Text
                      style={[s.pillText, prefs.approach_stops === value && { color: 'white' }]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </Card>
      )}
    </>
  );
}
