import React, { useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Field, Icon, SectionLabel, StatusChip, Tag, s } from '../../components/UI';
import { ago, isBoardable } from '../../domain';
import type { Role, Snapshot } from '../../domain';
import type { Mutate } from '../workspace/types';

export const categoryLabels: Record<string, string> = {
  safety_concern: 'Safety concern',
  vehicle: 'Vehicle problem',
  stop_condition: 'Stop condition',
  driver_conduct: 'Driver conduct',
  rider_conduct: 'Rider conduct',
  shared_ride: 'Shared ride',
  lost_item: 'Lost item',
  other: 'Something else',
};
const reportStatus = {
  open: ['Sent · not yet reviewed', 'gray'],
  acknowledged: ['Received by staff', 'green'],
  resolved: ['Resolved by staff', 'green'],
} as const;
const escortStatus = {
  requested: ['Waiting for staff to respond', 'amber'],
  accepted: ['Accepted by staff', 'green'],
  declined: ['Declined by staff', 'coral'],
  completed: ['Completed', 'gray'],
  cancelled: ['Cancelled', 'gray'],
} as const;

function Pills({
  options,
  value,
  onChange,
  label,
}: {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <View style={s.pills} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(([id, name]) => (
        <Pressable
          key={id}
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

/** Safety help that an institution has actually set up. NEXT STOP itself never contacts
 * emergency services, campus safety or anyone else for the rider. */
export default function SafetyScreen({
  data,
  role,
  busy,
  mutate,
  now,
}: {
  data: Snapshot;
  role: Role;
  busy: boolean;
  mutate: Mutate;
  now: number;
}) {
  const safety = data.safety;
  const [category, setCategory] = useState('safety_concern');
  const [description, setDescription] = useState('');
  const [stopId, setStopId] = useState('');
  const [meet, setMeet] = useState('');
  const [destination, setDestination] = useState('');
  const [escortNote, setEscortNote] = useState('');
  const stops = data.stops.filter(isBoardable);
  const openEscort = data.escorts?.find((e) => ['requested', 'accepted'].includes(e.status));
  const call = (number: string) => void Linking.openURL(`tel:${number.replace(/[^0-9+]/g, '')}`);
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <SectionLabel>Safety</SectionLabel>
        <Text style={s.title}>Help and reporting</Text>
      </View>
      <Card style={{ backgroundColor: '#FFF0E9', gap: 10 }}>
        <View style={[s.row, { justifyContent: 'flex-start' }]}>
          <Icon name="warning-outline" color="#C2381F" size={24} />
          <Text style={[s.heading, { flex: 1 }]}>In an emergency, call for help directly.</Text>
        </View>
        {safety?.emergency_number ? (
          <Button
            large
            icon="call"
            label={`Call ${safety.emergency_number}`}
            onPress={() => call(safety.emergency_number)}
          />
        ) : (
          <Text style={[s.body, { color: C.navy }]}>Call your local emergency number.</Text>
        )}
        <Text style={s.caption}>
          NEXT STOP is not an emergency service. It does not alert police, campus safety or your
          contacts, and it does not share your location with them.
        </Text>
      </Card>

      {!!safety?.contacts.length && (
        <Card>
          <Text style={s.heading}>Your institution’s contacts</Text>
          {safety.contacts.map((c) => (
            <View key={c.id} style={[s.request, { marginTop: 0 }]}>
              <Text style={s.heading}>{c.label}</Text>
              <Text style={s.caption}>
                {c.phone}
                {c.hours ? ` · ${c.hours}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 120 }}>
                  <Button
                    secondary
                    icon="call-outline"
                    label="Call"
                    onPress={() => call(c.phone)}
                  />
                </View>
                {!!c.sms && (
                  <View style={{ flex: 1, minWidth: 120 }}>
                    <Button
                      secondary
                      icon="chatbubble-outline"
                      label="Text"
                      onPress={() => void Linking.openURL(`sms:${c.phone.replace(/[^0-9+]/g, '')}`)}
                    />
                  </View>
                )}
              </View>
            </View>
          ))}
          <Text style={s.caption}>
            Calls and texts open your phone; they are not sent through NEXT STOP.
          </Text>
        </Card>
      )}

      {role === 'student' && !!safety?.escorts_enabled && (
        <Card>
          <Text style={s.heading}>Request an escort</Text>
          {!!safety.escort_note && <Text style={s.body}>{safety.escort_note}</Text>}
          {openEscort ? (
            <>
              <StatusChip
                text={escortStatus[openEscort.status][0]}
                tone={escortStatus[openEscort.status][1]}
              />
              <Text style={s.body}>
                From {data.stops.find((x) => x.id === openEscort.stop_id)?.name || 'your stop'} to{' '}
                {openEscort.destination} · sent {ago(openEscort.created_at, now)}
              </Text>
              {!!openEscort.staff_note && (
                <Text style={[s.body, { color: C.navy }]}>Staff: {openEscort.staff_note}</Text>
              )}
              <Button
                secondary
                label="Cancel escort request"
                disabled={busy}
                onPress={() =>
                  void mutate(
                    '/escorts/update',
                    { escortId: openEscort.id, status: 'cancelled' },
                    'Escort request cancelled.',
                  )
                }
              />
            </>
          ) : (
            <>
              <Text style={s.label}>MEET AT</Text>
              <Pills
                label="Meet at"
                options={stops.map((x) => [x.id, x.name])}
                value={meet}
                onChange={setMeet}
              />
              <Field label="Going to" value={destination} onChange={setDestination} />
              <Field
                label="Anything staff should know (optional)"
                value={escortNote}
                onChange={setEscortNote}
              />
              <Button
                label="Send escort request"
                disabled={busy || !meet || !destination.trim()}
                onPress={async () => {
                  if (
                    await mutate(
                      '/escorts',
                      { stopId: meet, destination, note: escortNote },
                      'Escort request sent to staff.',
                    )
                  ) {
                    setDestination('');
                    setEscortNote('');
                  }
                }}
              />
              <Text style={s.caption}>
                Goes to your institution’s staff in NEXT STOP. It is confirmed only when a staff
                member accepts it here.
              </Text>
            </>
          )}
        </Card>
      )}

      {role !== 'admin' && !!safety?.incidents_enabled && (
        <Card>
          <Text style={s.heading}>Report a problem</Text>
          <Pills
            label="Report type"
            options={Object.entries(categoryLabels).filter(([k]) => k !== 'shared_ride')}
            value={category}
            onChange={setCategory}
          />
          <Text style={s.label}>WHAT HAPPENED</Text>
          <TextInput
            accessibilityLabel="What happened"
            multiline
            maxLength={1000}
            value={description}
            onChangeText={setDescription}
            style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]}
          />
          <Text style={s.label}>STOP (OPTIONAL)</Text>
          <Pills
            label="Stop"
            options={[['', 'None'], ...stops.map((x): [string, string] => [x.id, x.name])]}
            value={stopId}
            onChange={setStopId}
          />
          <Button
            label="Send report"
            disabled={busy || !description.trim()}
            onPress={async () => {
              if (
                await mutate(
                  '/incidents',
                  { category, description, stopId: stopId || undefined },
                  'Report sent to your institution’s staff.',
                )
              ) {
                setDescription('');
                setStopId('');
              }
            }}
          />
          <Text style={s.caption}>
            Reports go to your institution’s NEXT STOP administrators. They are not watched around
            the clock and are not emergency calls.
          </Text>
          {(data.incidents || []).map((i) => (
            <View key={i.id} style={s.request}>
              <View style={[s.row, { flexWrap: 'wrap' }]}>
                <Text style={s.heading}>{categoryLabels[i.category] || i.category}</Text>
                <Tag text={reportStatus[i.status][0]} tone={reportStatus[i.status][1]} />
              </View>
              <Text style={s.body}>{i.description}</Text>
              {!!i.staff_note && (
                <Text style={[s.body, { color: C.navy }]}>Staff: {i.staff_note}</Text>
              )}
              <Text style={s.caption}>Sent {ago(i.created_at, now)}</Text>
            </View>
          ))}
        </Card>
      )}
      {!safety?.contacts.length && !safety?.incidents_enabled && !safety?.escorts_enabled && (
        <Text style={s.caption}>
          Your institution has not set up safety contacts or reporting in NEXT STOP.
        </Text>
      )}
    </View>
  );
}
