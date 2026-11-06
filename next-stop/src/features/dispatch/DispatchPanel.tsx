import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Button, Card, Field, Tag, s } from '../../components/UI';
import type { Member } from '../../domain';
import type { Mutate, Run } from '../workspace/types';

export interface DispatchDraft {
  stopLabel: string;
  latitude: string;
  longitude: string;
  vehicleName: string;
  capacity: string;
  driverId: string;
}

export default function DispatchPanel({
  members,
  stopCount,
  tripCount,
  draft,
  setDraft,
  busy,
  run,
  mutate,
}: {
  members: Member[];
  stopCount: number;
  tripCount: number;
  draft: DispatchDraft;
  setDraft: (change: Partial<DispatchDraft>) => void;
  busy: boolean;
  run: Run;
  mutate: Mutate;
}) {
  const pending = members.filter((m) => !m.approved);
  const drivers = members.filter((m) => m.role === 'driver' && m.approved);
  const { stopLabel, latitude, longitude, vehicleName, capacity, driverId } = draft;
  return (
    <Card>
      <Text style={s.title}>Institution dispatch</Text>
      <Text style={s.body}>
        Verify identity, affiliation, and driver authorization before approval.
      </Text>
      {pending.map((m) => (
        <View key={m.user_id} style={s.request}>
          <Text style={s.heading}>{m.name}</Text>
          <Text style={s.body}>
            {m.email} · {m.role}
          </Text>
          <Button
            secondary
            disabled={busy}
            label="Approve verified membership"
            onPress={() => mutate('/members/approve', { userId: m.user_id }, 'Membership approved.')}
          />
        </View>
      ))}
      {!pending.length && <Tag text="No pending memberships" />}
      <View style={s.divider} />
      <Text style={s.heading}>Add an actual pickup stop</Text>
      <Field label="Stop name" value={stopLabel} onChange={(v) => setDraft({ stopLabel: v })} />
      <Field label="Latitude" value={latitude} onChange={(v) => setDraft({ latitude: v })} />
      <Field label="Longitude" value={longitude} onChange={(v) => setDraft({ longitude: v })} />
      <Button
        secondary
        label="Use my current GPS for this stop"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            const permission = await Location.requestForegroundPermissionsAsync();
            if (permission.status !== 'granted')
              throw Error('Grant location permission to capture this stop.');
            const point = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.High,
            });
            if (point.coords.accuracy == null || point.coords.accuracy > 100)
              throw Error(
                'GPS is not accurate enough. Move outdoors or enter verified coordinates.',
              );
            setDraft({
              latitude: String(point.coords.latitude),
              longitude: String(point.coords.longitude),
            });
          })
        }
      />
      <Button
        label="Add stop"
        disabled={busy || !stopLabel || !latitude || !longitude}
        onPress={() =>
          mutate(
            '/stops',
            { name: stopLabel, lat: Number(latitude), lng: Number(longitude) },
            'Stop added to your institution.',
          )
        }
      />
      <View style={s.divider} />
      <Text style={s.heading}>Assign a shuttle</Text>
      <Field
        label="Shuttle name or vehicle ID"
        value={vehicleName}
        onChange={(v) => setDraft({ vehicleName: v })}
      />
      <Field
        label="Passenger capacity"
        value={capacity}
        onChange={(v) => setDraft({ capacity: v })}
      />
      <Text style={s.label}>APPROVED DRIVER</Text>
      <View style={s.pills}>
        {drivers.map((m) => (
          <Pressable
            key={m.user_id}
            onPress={() => setDraft({ driverId: m.user_id })}
            style={[s.pill, driverId === m.user_id && s.pillActive]}
          >
            <Text style={[s.pillText, driverId === m.user_id && { color: 'white' }]}>
              {m.name}
            </Text>
          </Pressable>
        ))}
      </View>
      <Button
        label="Create assigned shuttle"
        disabled={busy || !driverId || !vehicleName}
        onPress={() =>
          mutate(
            '/trips',
            { name: vehicleName, driverId, capacity: Number(capacity) },
            'Shuttle assigned. The driver can now start service.',
          )
        }
      />
      <Text style={s.caption}>
        {stopCount} stops · {tripCount} shuttles
      </Text>
    </Card>
  );
}
