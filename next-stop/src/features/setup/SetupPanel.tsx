import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Field, Icon, StatusChip, s } from '../../components/UI';
import { vehicleFeatureLabels } from '../../catalog';
import { VEHICLE_TYPES } from '../../domain';
import type { Snapshot, Trip, VehicleType } from '../../domain';
import type { Mutate } from '../workspace/types';

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
};

/** Institution configuration that riders depend on: time zone, request expiry, vehicles and
 * stop details. Nothing here is preset for any one institution. */
export default function SetupPanel({
  data,
  busy,
  mutate,
  onOpenStop,
}: {
  data: Snapshot;
  busy: boolean;
  mutate: Mutate;
  onOpenStop: (stopId: string) => void;
}) {
  const settings = data.settings || { timezone: '', request_expiry_minutes: 30 };
  const [timezone, setTimezone] = useState(settings.timezone || deviceZone());
  const [expiry, setExpiry] = useState(String(settings.request_expiry_minutes));
  const unverified = data.stops.filter((x) => x.status !== 'draft' && !x.details_verified_at);
  return (
    <View style={{ gap: 16 }}>
      <Card>
        <Text style={s.title}>Institution settings</Text>
        {!settings.timezone && (
          <StatusChip text="Time zone not set: timetables can’t be published yet" tone="amber" />
        )}
        <Field
          label="Time zone (IANA name, e.g. America/New_York)"
          value={timezone}
          onChange={setTimezone}
        />
        <Field
          label="Cancel unaccepted pickup requests after (minutes, 5–240)"
          value={expiry}
          onChange={setExpiry}
        />
        <Text style={s.caption}>
          Riders are told when an unaccepted request is cleared. Accepted pickups are never cleared
          automatically; the driver resolves them.
        </Text>
        <Button
          label="Save settings"
          disabled={busy}
          onPress={() =>
            void mutate(
              '/settings',
              { timezone: timezone.trim(), requestExpiryMinutes: Number(expiry) },
              'Settings saved.',
            )
          }
        />
      </Card>
      <Card>
        <Text style={s.title}>Vehicles</Text>
        <Text style={s.caption}>
          Capacity is the real number of rider seats. Riders see seat use as an estimate from
          driver-confirmed boardings and drop-offs.
        </Text>
        {data.trips.map((trip) => (
          <VehicleEditor key={trip.id} trip={trip} busy={busy} mutate={mutate} />
        ))}
        {!data.trips.length && <Text style={s.body}>Add a vehicle in Dispatch first.</Text>}
      </Card>
      <Card>
        <Text style={s.title}>Stop details</Text>
        <Text style={s.caption}>
          Add a description, accessibility notes, amenities and a photo, then verify each stop.
          {unverified.length ? ` ${unverified.length} open stop(s) not yet verified.` : ''}
        </Text>
        {data.stops.map((stop) => (
          <Pressable
            key={stop.id}
            accessibilityRole="link"
            onPress={() => onOpenStop(stop.id)}
            style={[s.row, { paddingVertical: 6 }]}
          >
            <Icon
              name={
                stop.status === 'draft'
                  ? 'ellipse-outline'
                  : stop.details_verified_at
                    ? 'checkmark-circle'
                    : 'alert-circle-outline'
              }
              color={
                stop.details_verified_at ? C.green : stop.status === 'draft' ? C.muted : '#8A5A00'
              }
              size={18}
            />
            <Text style={[s.body, { flex: 1, color: C.navy }]}>{stop.name}</Text>
            <Text style={s.caption}>
              {stop.status === 'draft'
                ? 'Location not confirmed'
                : stop.details_verified_at
                  ? 'Verified'
                  : 'Not verified'}
            </Text>
            <Icon name="chevron-forward" size={16} color={C.muted} />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

function VehicleEditor({ trip, busy, mutate }: { trip: Trip; busy: boolean; mutate: Mutate }) {
  const [capacity, setCapacity] = useState(String(trip.capacity));
  const [features, setFeatures] = useState<string[]>(trip.features || []);
  const [vehicleType, setVehicleType] = useState<VehicleType>(trip.vehicle_type || '');
  return (
    <View style={s.request}>
      <Text style={s.heading}>{trip.name}</Text>
      <Field label="Rider seats" value={capacity} onChange={setCapacity} />
      <Text style={s.label}>VEHICLE TYPE (MAP ICON)</Text>
      <View style={s.pills} accessibilityRole="radiogroup">
        {VEHICLE_TYPES.map((t) => {
          const on = vehicleType === t.value;
          return (
            <Pressable
              key={t.value || 'none'}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              onPress={() => setVehicleType(t.value)}
              style={[s.pill, on && s.pillActive]}
            >
              <Text style={[s.pillText, on && { color: 'white' }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={s.pills}>
        {Object.entries(vehicleFeatureLabels).map(([key, label]) => {
          const on = features.includes(key);
          return (
            <Pressable
              key={key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              onPress={() =>
                setFeatures(on ? features.filter((f) => f !== key) : [...features, key])
              }
              style={[s.pill, on && s.pillActive]}
            >
              <Text style={[s.pillText, on && { color: 'white' }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Button
        secondary
        label="Save vehicle"
        disabled={busy}
        onPress={() =>
          void mutate(
            '/trips/vehicle',
            { tripId: trip.id, capacity: Number(capacity), features, vehicleType },
            `${trip.name} updated.`,
          )
        }
      />
    </View>
  );
}
