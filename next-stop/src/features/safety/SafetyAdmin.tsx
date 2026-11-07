import React, { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Field, Tag, s } from '../../components/UI';
import { ago } from '../../domain';
import type { Snapshot } from '../../domain';
import type { Mutate } from '../workspace/types';
import { categoryLabels } from './SafetyScreen';

/** Institution choices for stage 3 features and safety contacts. Each feature stays off until
 * the institution has people and procedures behind it. */
export function SafetySetup({
  data,
  busy,
  mutate,
}: {
  data: Snapshot;
  busy: boolean;
  mutate: Mutate;
}) {
  const safety = data.safety;
  const [emergency, setEmergency] = useState(safety?.emergency_number || '');
  const [escortNote, setEscortNote] = useState(safety?.escort_note || '');
  const [contact, setContact] = useState({
    label: '',
    phone: '',
    hours: '',
    kind: 'safety',
    sms: false,
  });
  if (!safety) return null;
  const toggle = (label: string, detail: string, key: string, value: number) => (
    <View style={[s.row, { alignItems: 'flex-start' }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.heading}>{label}</Text>
        <Text style={s.caption}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={!!value}
        disabled={busy}
        onValueChange={(on) =>
          void mutate('/safety/settings', { [key]: on }, `${label} ${on ? 'on' : 'off'}.`)
        }
        trackColor={{ true: C.coral, false: C.line }}
      />
    </View>
  );
  return (
    <Card>
      <Text style={s.title}>Passes and safety</Text>
      {toggle(
        'Rider passes',
        'Students show a rotating QR code; drivers check it.',
        'passesEnabled',
        safety.passes_enabled,
      )}
      {toggle(
        'In-app reports',
        'Riders can send reports that administrators review here.',
        'incidentsEnabled',
        safety.incidents_enabled,
      )}
      {toggle(
        'Escort requests',
        'Only if staff will answer them in NEXT STOP during stated hours.',
        'escortsEnabled',
        safety.escorts_enabled,
      )}
      {toggle(
        'Shared-ride coordination',
        'Opt-in matching of riders making the same trip.',
        'sharedRidesEnabled',
        safety.shared_rides_enabled,
      )}
      <Field
        label="Emergency number shown to riders (e.g. 911)"
        value={emergency}
        onChange={setEmergency}
      />
      <Field
        label="Escort hours and rules shown to riders"
        value={escortNote}
        onChange={setEscortNote}
      />
      <Button
        secondary
        label="Save numbers and notes"
        disabled={busy}
        onPress={() =>
          void mutate('/safety/settings', { emergencyNumber: emergency, escortNote }, 'Saved.')
        }
      />
      <View style={s.divider} />
      <Text style={s.heading}>Contacts riders can call</Text>
      {safety.contacts.map((c) => (
        <View key={c.id} style={s.row}>
          <Text style={[s.body, { flex: 1, color: C.navy }]}>
            {c.label} · {c.phone}
            {c.hours ? ` · ${c.hours}` : ''}
          </Text>
          <Button
            secondary
            label="Remove"
            disabled={busy}
            onPress={() =>
              void mutate('/safety/contacts', { remove: true, contactId: c.id }, 'Contact removed.')
            }
          />
        </View>
      ))}
      <Field
        label="Name (e.g. Campus safety)"
        value={contact.label}
        onChange={(label) => setContact({ ...contact, label })}
      />
      <Field
        label="Phone number"
        value={contact.phone}
        onChange={(phone) => setContact({ ...contact, phone })}
      />
      <Field
        label="Hours (optional)"
        value={contact.hours}
        onChange={(hours) => setContact({ ...contact, hours })}
      />
      <View style={s.pills}>
        {(['safety', 'transport', 'escort', 'other'] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ selected: contact.kind === k }}
            aria-checked={contact.kind === k}
            onPress={() => setContact({ ...contact, kind: k })}
            style={[s.pill, contact.kind === k && s.pillActive]}
          >
            <Text style={[s.pillText, contact.kind === k && { color: 'white' }]}>
              {k[0].toUpperCase() + k.slice(1)}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: contact.sms }}
          aria-checked={contact.sms}
          onPress={() => setContact({ ...contact, sms: !contact.sms })}
          style={[s.pill, contact.sms && s.pillActive]}
        >
          <Text style={[s.pillText, contact.sms && { color: 'white' }]}>Accepts texts</Text>
        </Pressable>
      </View>
      <Button
        label="Add contact"
        disabled={busy || !contact.label.trim() || !contact.phone.trim()}
        onPress={async () => {
          if (await mutate('/safety/contacts', contact, 'Contact added.'))
            setContact({ label: '', phone: '', hours: '', kind: 'safety', sms: false });
        }}
      />
      <Text style={s.caption}>Enter only numbers your institution has confirmed are staffed.</Text>
    </Card>
  );
}

/** Reports and escort requests waiting for staff. */
export function SafetyQueue({
  data,
  busy,
  mutate,
  now,
}: {
  data: Snapshot;
  busy: boolean;
  mutate: Mutate;
  now: number;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const incidents = data.incidents || [];
  const escorts = data.escorts || [];
  if (!data.safety?.incidents_enabled && !data.safety?.escorts_enabled && !incidents.length)
    return null;
  const stopName = (id: string | null) => data.stops.find((x) => x.id === id)?.name;
  return (
    <Card>
      <Text style={s.title}>Reports and escorts</Text>
      {!incidents.length && !escorts.length && <Text style={s.body}>Nothing waiting.</Text>}
      {escorts.map((e) => (
        <View key={e.id} style={s.request}>
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            <Text style={s.heading}>Escort · {e.rider_name}</Text>
            <Tag text={e.status} tone={e.status === 'requested' ? 'coral' : 'gray'} />
          </View>
          <Text style={s.body}>
            {stopName(e.stop_id)} → {e.destination} · {ago(e.created_at, now)}
          </Text>
          {!!e.note && <Text style={s.body}>“{e.note}”</Text>}
          <Field
            label="Note to rider"
            value={notes[e.id] || ''}
            onChange={(v) => setNotes({ ...notes, [e.id]: v })}
          />
          {e.status === 'requested' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Accept"
                  disabled={busy}
                  onPress={() =>
                    void mutate(
                      '/escorts/update',
                      { escortId: e.id, status: 'accepted', note: notes[e.id] || '' },
                      'Escort accepted.',
                    )
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  secondary
                  label="Decline"
                  disabled={busy}
                  onPress={() =>
                    void mutate(
                      '/escorts/update',
                      { escortId: e.id, status: 'declined', note: notes[e.id] || '' },
                      'Escort declined.',
                    )
                  }
                />
              </View>
            </View>
          )}
          {e.status === 'accepted' && (
            <Button
              secondary
              label="Mark complete"
              disabled={busy}
              onPress={() =>
                void mutate(
                  '/escorts/update',
                  { escortId: e.id, status: 'completed', note: notes[e.id] || '' },
                  'Escort completed.',
                )
              }
            />
          )}
        </View>
      ))}
      {incidents.map((i) => (
        <View key={i.id} style={s.request}>
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            <Text style={s.heading}>{categoryLabels[i.category] || i.category}</Text>
            <Tag text={i.status} tone={i.status === 'open' ? 'coral' : 'gray'} />
          </View>
          <Text style={s.body}>{i.description}</Text>
          <Text style={s.caption}>
            {i.reporter_name || 'Deleted account'}
            {i.stop_id ? ` · ${stopName(i.stop_id)}` : ''} · {ago(i.created_at, now)}
          </Text>
          {i.status !== 'resolved' && (
            <>
              <Field
                label="Reply to the reporter"
                value={notes[i.id] ?? i.staff_note}
                onChange={(v) => setNotes({ ...notes, [i.id]: v })}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {i.status === 'open' && (
                  <View style={{ flex: 1 }}>
                    <Button
                      secondary
                      label="Acknowledge"
                      disabled={busy}
                      onPress={() =>
                        void mutate(
                          '/incidents/update',
                          {
                            incidentId: i.id,
                            status: 'acknowledged',
                            note: notes[i.id] ?? i.staff_note,
                          },
                          'Report acknowledged.',
                        )
                      }
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Button
                    label="Resolve"
                    disabled={busy}
                    onPress={() =>
                      void mutate(
                        '/incidents/update',
                        { incidentId: i.id, status: 'resolved', note: notes[i.id] ?? i.staff_note },
                        'Report resolved.',
                      )
                    }
                  />
                </View>
              </View>
            </>
          )}
        </View>
      ))}
    </Card>
  );
}
