import { expoGoLimits, isExpoGo } from '../../services/runtime';
import React from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Field, Tag, s } from '../../components/UI';
import type { Trip } from '../../domain';
import type { Mutate } from '../workspace/types';

/** GPS start/stop and the end-of-service GPS shutdown remain in the workspace lifecycle. */
export default function DriverControls({
  trip,
  shuttleSelector,
  gps,
  gpsText,
  onToggleGps,
  delay,
  setDelay,
  issue,
  setIssue,
  busy,
  mutate,
}: {
  trip?: Trip;
  shuttleSelector: React.ReactNode;
  gps: boolean;
  gpsText: string;
  onToggleGps: () => void;
  delay: string;
  setDelay: (value: string) => void;
  issue: string;
  setIssue: (value: string) => void;
  busy: boolean;
  mutate: Mutate;
}) {
  return (
    <Card>
      <View style={s.row}>
        <Text style={s.title}>Driver workspace</Text>
        <Tag
          text={trip?.active ? 'IN SERVICE' : 'OFF DUTY'}
          tone={trip?.active ? 'green' : 'gray'}
        />
      </View>
      <Text style={s.body}>
        Use trip controls while parked. Start service, then enable driver tracking.
      </Text>
      {shuttleSelector}
      {trip ? (
        <>
          <Button
            secondary
            label={trip.active ? 'End service' : 'Start service'}
            disabled={busy}
            onPress={() =>
              mutate(
                '/trips/service',
                { tripId: trip.id, active: !trip.active },
                trip.active ? 'Service ended.' : 'Service started.',
              )
            }
          />
          <Button
            label={gps ? 'Stop sharing driver GPS' : 'Start driver GPS tracking'}
            icon="locate-outline"
            disabled={busy || !trip.active}
            onPress={onToggleGps}
          />
          <Text style={s.caption}>
            {gpsText ||
              (isExpoGo
                ? expoGoLimits.gps
                : 'The installed app requests background permission and shows a tracking indicator while sharing.')}
          </Text>
          <View style={s.divider} />
          <Text style={s.heading}>Keep riders informed</Text>
          <Field label="Delay in minutes (0–240)" value={delay} onChange={setDelay} />
          <Field label="Service update and rider instructions" value={issue} onChange={setIssue} />
          <Button
            secondary
            label="Publish service update"
            disabled={busy}
            onPress={() =>
              mutate(
                '/trips/issue',
                { tripId: trip.id, delayMinutes: Number(delay), issue },
                'Service update published.',
              )
            }
          />
        </>
      ) : (
        <Text style={s.body}>
          No vehicle assigned. Ask your institution administrator to assign your shuttle.
        </Text>
      )}
    </Card>
  );
}
