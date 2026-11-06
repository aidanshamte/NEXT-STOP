import React from 'react';
import { Text, View } from 'react-native';
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
