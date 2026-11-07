import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Icon, s } from '../../components/UI';
import { clock, isBoardable } from '../../domain';
import type { Snapshot } from '../../domain';
import type { Mutate } from '../workspace/types';

const WINDOWS: [string, number, number][] = [
  ['Within 1 hour', 0, 1],
  ['In 1–2 hours', 1, 2],
  ['In 2–3 hours', 2, 3],
];

/** Optional, opt-in coordination between riders making the same trip. NEXT STOP does not book,
 * price or pay for any ride and shares no contact details or locations. */
export default function SharedRides({
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
  const view = data.rides;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [windowIndex, setWindowIndex] = useState(0);
  const [consent, setConsent] = useState(false);
  if (!data.safety?.shared_rides_enabled || !view) return null;
  const stops = data.stops.filter(isBoardable);
  const name = (id: string) => stops.find((x) => x.id === id)?.name || 'a stop';
  const tz = data.settings?.timezone || undefined;
  const pills = (value: string, set: (v: string) => void, exclude = '', label = '') => (
    <View style={s.pills} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {stops
        .filter((x) => x.id !== exclude)
        .map((x) => (
          <Pressable
            key={x.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === x.id }}
            aria-checked={value === x.id}
            onPress={() => set(x.id)}
            style={[s.pill, value === x.id && s.pillActive]}
          >
            <Text style={[s.pillText, value === x.id && { color: 'white' }]}>{x.name}</Text>
          </Pressable>
        ))}
    </View>
  );
  return (
    <Card>
      <View style={[s.row, { justifyContent: 'flex-start' }]}>
        <Icon name="people-circle-outline" color={C.navy} size={24} />
        <Text style={[s.heading, { flex: 1 }]}>Share a ride (optional)</Text>
      </View>
      {!view.intent ? (
        <>
          <Text style={s.body}>
            Find other riders making the same trip, for example to share a taxi when the shuttle
            isn’t running. NEXT STOP doesn’t book, price or pay for rides.
          </Text>
          <Text style={s.label}>FROM</Text>
          {pills(from, setFrom, '', 'From')}
          <Text style={s.label}>TO</Text>
          {pills(to, setTo, from, 'To')}
          <Text style={s.label}>LEAVING</Text>
          <View style={s.pills}>
            {WINDOWS.map(([label], i) => (
              <Pressable
                key={label}
                accessibilityRole="radio"
                accessibilityState={{ selected: windowIndex === i }}
                aria-checked={windowIndex === i}
                onPress={() => setWindowIndex(i)}
                style={[s.pill, windowIndex === i && s.pillActive]}
              >
                <Text style={[s.pillText, windowIndex === i && { color: 'white' }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
            aria-checked={consent}
            onPress={() => setConsent(!consent)}
            style={[s.row, { alignItems: 'flex-start', justifyContent: 'flex-start', gap: 10 }]}
          >
            <Icon
              name={consent ? 'checkbox' : 'square-outline'}
              color={consent ? C.navy : C.muted}
            />
            <Text style={[s.caption, { flex: 1 }]}>
              I understand: riders making the same trip see that someone is. Only if we both choose
              to coordinate do we see each other’s first names, and we meet at the pickup stop. No
              phone numbers, emails or locations are shared.
            </Text>
          </Pressable>
          <Button
            label="Look for riders"
            disabled={busy || !from || !to || !consent}
            onPress={() => {
              const [, start, end] = WINDOWS[windowIndex];
              void mutate(
                '/rides/intent',
                {
                  fromStop: from,
                  toStop: to,
                  leaveAfter: now + start * 3600000,
                  leaveBefore: now + end * 3600000,
                  consent: true,
                },
                'Looking for riders making the same trip.',
              );
            }}
          />
        </>
      ) : (
        <>
          <Text style={[s.body, { color: C.navy }]}>
            {name(view.intent.from_stop)} → {name(view.intent.to_stop)} ·{' '}
            {clock(view.intent.leave_after, tz)}–{clock(view.intent.leave_before, tz)}
          </Text>
          <Text style={s.heading}>
            {view.matches === 0
              ? 'No other riders yet'
              : `${view.matches} other rider${view.matches === 1 ? '' : 's'} making this trip`}
          </Text>
          {view.intent.coordinating ? (
            <>
              {view.group.length ? (
                <Text style={s.body}>
                  Meeting at {name(view.intent.from_stop)} with{' '}
                  {view.group.map((m) => m.firstName).join(', ')}.
                </Text>
              ) : (
                <Text style={s.body}>
                  You’ll see first names when someone else also chooses to coordinate.
                </Text>
              )}
              {view.group.map((m) => (
                <View key={m.userId} style={[s.row, { flexWrap: 'wrap' }]}>
                  <Text style={[s.heading, { flex: 1 }]}>{m.firstName}</Text>
                  {!!data.safety?.incidents_enabled && (
                    <Button
                      secondary
                      label="Report"
                      disabled={busy}
                      onPress={() =>
                        void mutate(
                          '/incidents',
                          {
                            category: 'shared_ride',
                            description: 'Reported from a shared-ride group.',
                            subjectId: m.userId,
                          },
                          'Report sent to your institution’s staff.',
                        )
                      }
                    />
                  )}
                  <Button
                    secondary
                    label="Block"
                    disabled={busy}
                    onPress={() =>
                      void mutate(
                        '/rides/block',
                        { userId: m.userId },
                        `${m.firstName} is blocked. You won’t be matched again.`,
                      )
                    }
                  />
                </View>
              ))}
              <Button
                secondary
                label="Stop coordinating"
                disabled={busy}
                onPress={() =>
                  void mutate('/rides/coordinate', { join: false }, 'You left the group.')
                }
              />
            </>
          ) : (
            <Button
              label="Coordinate with them"
              disabled={busy || view.matches === 0}
              onPress={() =>
                void mutate(
                  '/rides/coordinate',
                  { join: true },
                  'You’ll see first names of riders who also chose to coordinate.',
                )
              }
            />
          )}
          <Button
            secondary
            label="Remove my trip"
            disabled={busy}
            onPress={() => void mutate('/rides/intent', { clear: true }, 'Your trip was removed.')}
          />
        </>
      )}
    </Card>
  );
}
