import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Field, Icon, s } from '../../components/UI';
import { ASSISTANCE_OPTIONS, capabilityLabel, assistanceState } from '../../domain';
import type { Assistance, RideRequest, Role, Trip } from '../../domain';
import { actionKey } from '../workspace/types';
import type { Mutate } from '../workspace/types';
import { toneColor } from './RiderAssistance';

const needIcon = {
  ramp: 'accessibility-outline',
  extra_time: 'hourglass-outline',
  other: 'hand-left-outline',
} as const;

/** Boarding assistance in the pickup details, for the assigned driver and staff. The driver
 * acknowledges the current version or reports being unable to accommodate (which alerts staff
 * and tells the rider); staff resolve with a message to the rider. Separate from pickup
 * acceptance and journey status. */
export default function OperatorAssistance({
  role,
  request,
  assistance,
  trip,
  busy,
  pending,
  mutate,
}: {
  role: Role;
  request: RideRequest;
  assistance: Assistance;
  trip?: Trip;
  busy: boolean;
  pending: string;
  mutate: Mutate;
}) {
  const [confirmUnable, setConfirmUnable] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState('');
  const editable = ['requested', 'accepted', 'approaching'].includes(request.status);
  const state = assistanceState(assistance);
  const body = { requestId: request.id, version: assistance.version };
  const run = async (path: string, extra: object, success: string, label: string) => {
    setFailed('');
    const ok = await mutate(path, { ...body, ...extra }, success);
    if (!ok) setFailed(label);
    else {
      setConfirmUnable(false);
      setMessage('');
    }
  };
  const inFlight = (path: string) => pending === actionKey(path, body);
  const staffNeeded = !!assistance.attention || assistance.status === 'unable';
  return (
    <View
      style={{
        borderWidth: 2,
        borderColor: staffNeeded ? C.coral : C.navy,
        borderRadius: 12,
        padding: 12,
        gap: 8,
        backgroundColor: '#F6F8FA',
      }}
      accessibilityLabel="Boarding assistance requested"
    >
      <View style={[s.row, { justifyContent: 'flex-start' }]}>
        <Icon name="accessibility" color={C.navy} size={24} />
        <Text style={[s.heading, { flex: 1 }]}>Boarding assistance requested</Text>
      </View>
      {assistance.needs.map((need) => (
        <View key={need} style={[s.row, { justifyContent: 'flex-start' }]}>
          <Icon name={needIcon[need]} color={C.navy} size={18} />
          <Text style={[s.body, { flex: 1, color: C.navy, fontWeight: '600' }]}>
            {ASSISTANCE_OPTIONS.find((o) => o.value === need)?.label}
          </Text>
        </View>
      ))}
      {!!assistance.note && <Text style={s.body}>Rider’s note: {assistance.note}</Text>}
      {assistance.needs.includes('ramp') && (
        <Text style={s.caption}>
          This vehicle’s record · Ramp or lift: {capabilityLabel[trip?.access_ramp || 'unknown']} ·
          Wheelchair space: {capabilityLabel[trip?.access_space || 'unknown']}
        </Text>
      )}
      <View
        style={[s.row, { justifyContent: 'flex-start', alignItems: 'flex-start' }]}
        accessibilityLiveRegion="polite"
        aria-live="polite"
      >
        <Icon name={state.icon} color={toneColor[state.tone]} size={20} />
        <View style={{ flex: 1 }}>
          <Text style={[s.heading, { color: toneColor[state.tone] }]}>
            {assistance.status === 'pending'
              ? 'Needs your acknowledgement'
              : assistance.status === 'acknowledged'
                ? 'Acknowledged by the assigned driver'
                : 'Driver reported unable to accommodate'}
          </Text>
          {staffNeeded && (
            <Text style={s.caption}>
              Staff attention needed
              {assistance.attention === 'vehicle_unavailable'
                ? ': the vehicle record shows no ramp, lift or wheelchair space.'
                : assistance.attention === 'vehicle_unknown'
                  ? ': the vehicle’s ramp, lift or wheelchair space is not confirmed.'
                  : '.'}
            </Text>
          )}
        </View>
      </View>
      {!!assistance.staff_note && (
        <Text style={s.caption}>Staff message to the rider: {assistance.staff_note}</Text>
      )}
      {!!failed && (
        <Text style={[s.caption, { color: C.navy }]} accessibilityRole="alert">
          Not sent: {failed}. Check the connection and try again.
        </Text>
      )}
      {role === 'driver' && editable && (
        <View style={{ gap: 8 }}>
          {assistance.status !== 'acknowledged' && !confirmUnable && (
            <Button
              icon="checkmark-circle-outline"
              label="Acknowledge assistance"
              loading={inFlight('/requests/assistance/ack')}
              loadingLabel="Sending…"
              disabled={busy}
              onPress={() =>
                void run(
                  '/requests/assistance/ack',
                  {},
                  'Assistance acknowledged. The rider has been told.',
                  'acknowledgement',
                )
              }
            />
          )}
          {assistance.status !== 'unable' &&
            (confirmUnable ? (
              <>
                <Text style={s.body} accessibilityRole="alert">
                  This alerts transport staff and tells the rider you can’t provide this assistance.
                </Text>
                <Button
                  icon="alert-circle-outline"
                  label="Yes, alert staff"
                  loading={inFlight('/requests/assistance/unable')}
                  loadingLabel="Sending…"
                  disabled={busy}
                  onPress={() =>
                    void run(
                      '/requests/assistance/unable',
                      {},
                      'Staff alerted and the rider told.',
                      'report to staff',
                    )
                  }
                />
                <Button secondary label="Back" onPress={() => setConfirmUnable(false)} />
              </>
            ) : (
              <Button
                secondary
                icon="close-circle-outline"
                label="Unable to accommodate"
                disabled={busy}
                onPress={() => setConfirmUnable(true)}
              />
            ))}
        </View>
      )}
      {role === 'admin' && editable && staffNeeded && (
        <View style={{ gap: 8 }}>
          <Field
            label="Message to the rider"
            value={message}
            maxLength={200}
            placeholder="For example: a lift-equipped van is on its way"
            onChange={setMessage}
          />
          <Button
            icon="checkmark-done-outline"
            label="Mark resolved and send"
            loading={inFlight('/requests/assistance/resolve')}
            loadingLabel="Sending…"
            disabled={busy || !message.trim()}
            onPress={() =>
              void run(
                '/requests/assistance/resolve',
                { outcome: 'resolved', message },
                'Resolved. The rider has your message.',
                'resolution',
              )
            }
          />
          <Button
            secondary
            icon="refresh-outline"
            label="Send and ask the driver to review again"
            disabled={busy || !message.trim()}
            onPress={() =>
              void run(
                '/requests/assistance/resolve',
                { outcome: 'driver_review', message },
                'Sent. The driver must acknowledge again.',
                'resolution',
              )
            }
          />
          <Text style={s.caption}>
            Reassigning the shuttle’s driver also requires the new driver to acknowledge. Update the
            vehicle’s ramp, lift and wheelchair-space record under Setup → Vehicles.
          </Text>
        </View>
      )}
    </View>
  );
}
