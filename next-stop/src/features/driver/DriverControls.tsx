import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Field, Icon, SectionLabel, StatusChip, s } from '../../components/UI';
import type { Trip } from '../../domain';
import { expoGoLimits, isExpoGo } from '../../services/runtime';
import { gpsStatus } from '../journeys/MapCard';
import { actionKey } from '../workspace/types';
import type { Mutate } from '../workspace/types';

/** GPS start/stop and the end-of-service GPS shutdown remain in the workspace lifecycle.
 * One primary action at a time; no animation. Meant to be used while parked. */
export default function DriverControls({
  trip,
  trips,
  shuttleSelector,
  gps,
  gpsText,
  onToggleGps,
  busy,
  pending,
  mutate,
  now,
}: {
  trip?: Trip;
  trips: Trip[];
  shuttleSelector: React.ReactNode;
  gps: boolean;
  gpsText: string;
  onToggleGps: () => void;
  busy: boolean;
  pending: string;
  mutate: Mutate;
  now: number;
}) {
  if (!trip)
    return (
      <Card>
        <Icon name="bus-outline" size={30} color={C.muted} />
        <Text style={s.title}>No vehicle assigned</Text>
        <Text style={s.body}>Ask your institution administrator to assign your shuttle.</Text>
      </Card>
    );
  const service = actionKey('/trips/service', { tripId: trip.id });
  const status = gpsStatus(trip, now);
  return (
    <Card style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <SectionLabel>{trip.active ? 'In service' : 'Off duty'}</SectionLabel>
        <Text style={s.title}>{trip.name}</Text>
      </View>
      {trips.length > 1 && shuttleSelector}
      {!trip.active ? (
        <Button
          large
          icon="play"
          label="Start service"
          loadingLabel="Starting…"
          loading={pending === service}
          disabled={busy}
          onPress={() =>
            mutate('/trips/service', { tripId: trip.id, active: true }, 'Service started.')
          }
        />
      ) : (
        <>
          <Button
            large
            tone={gps ? 'navy' : undefined}
            icon={gps ? 'stop-circle-outline' : 'locate-outline'}
            label={gps ? 'Stop sharing GPS' : 'Share GPS with riders'}
            loadingLabel={gps ? 'Stopping…' : 'Starting GPS…'}
            loading={pending === 'gps'}
            disabled={busy}
            onPress={onToggleGps}
          />
          <StatusChip
            text={gps ? status.text : 'Riders can’t see this shuttle until you share GPS'}
            tone={gps ? status.tone : 'gray'}
          />
        </>
      )}
      <Text style={s.caption}>
        {gpsText ||
          (isExpoGo
            ? expoGoLimits.gps
            : 'The installed app asks for background location and shows a tracking indicator while sharing.')}
      </Text>
      {!!trip.active && (
        <OnboardCounter trip={trip} busy={busy} pending={pending} mutate={mutate} />
      )}
      {!!trip.active && (
        <Button
          secondary
          label="End service"
          loadingLabel="Ending…"
          loading={pending === service}
          disabled={busy}
          onPress={() =>
            mutate('/trips/service', { tripId: trip.id, active: false }, 'Service ended.')
          }
        />
      )}
    </Card>
  );
}

/** The driver's own head count. Boardings and drop-offs confirmed in the queue adjust it
 * automatically; these buttons correct it for riders without the app. */
function OnboardCounter({
  trip,
  busy,
  pending,
  mutate,
}: {
  trip: Trip;
  busy: boolean;
  pending: string;
  mutate: Mutate;
}) {
  const count = trip.onboard ?? 0;
  const saving = pending === actionKey('/trips/onboard', { tripId: trip.id });
  const set = (value: number) =>
    mutate('/trips/onboard', { tripId: trip.id, count: value }, `Onboard count set to ${value}.`);
  const step = (label: string, icon: 'remove' | 'add', value: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || value < 0 || value > 200}
      onPress={() => void set(value)}
      style={({ pressed }) => ({
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#EEF2F5',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: busy ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Icon name={icon} size={30} />
    </Pressable>
  );
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>RIDERS ON BOARD</Text>
      <View style={[s.row, { gap: 16 }]}>
        {step('One fewer rider on board', 'remove', count - 1)}
        <View
          style={{ flex: 1, alignItems: 'center' }}
          accessible
          accessibilityLabel={`${count} of ${trip.capacity} seats in use`}
        >
          <Text style={[s.title, { fontSize: 32 }]}>{saving ? '…' : count}</Text>
          <Text style={s.caption}>of {trip.capacity} seats</Text>
        </View>
        {step('One more rider on board', 'add', count + 1)}
      </View>
      <Text style={s.caption}>
        Boarding and drop-off confirmations update this. Correct it for riders without the app;
        riders see it as an estimate.
      </Text>
    </View>
  );
}

/** Delay and rider-instruction publishing, below the pickup queue. */
export function DriverUpdateForm({
  trip,
  delay,
  setDelay,
  issue,
  setIssue,
  busy,
  pending,
  mutate,
}: {
  trip: Trip;
  delay: string;
  setDelay: (value: string) => void;
  issue: string;
  setIssue: (value: string) => void;
  busy: boolean;
  pending: string;
  mutate: Mutate;
}) {
  return (
    <Card>
      <Text style={s.heading}>Keep riders informed</Text>
      <Field label="Delay in minutes (0–240)" value={delay} onChange={setDelay} />
      <Field label="Service update for riders" value={issue} onChange={setIssue} />
      <Button
        secondary
        label="Publish service update"
        loadingLabel="Publishing…"
        loading={pending === actionKey('/trips/issue', { tripId: trip.id })}
        disabled={busy}
        onPress={() =>
          mutate(
            '/trips/issue',
            { tripId: trip.id, delayMinutes: Number(delay), issue },
            'Service update published.',
          )
        }
      />
    </Card>
  );
}
