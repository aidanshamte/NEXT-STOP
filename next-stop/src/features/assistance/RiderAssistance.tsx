import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Icon, s } from '../../components/UI';
import { ago, assistanceState, needsText } from '../../domain';
import type { Assistance, RideRequest } from '../../domain';
import type { Mutate } from '../workspace/types';
import AssistancePicker, {
  assistanceBody,
  emptyAssistance,
  sameAssistance,
} from './AssistancePicker';
import type { AssistanceDraft } from './AssistancePicker';

export const toneColor = { amber: '#8A5A00', green: C.green, coral: C.coral } as const;

/** The rider's boarding assistance on their open pickup: its state, and changes until boarding.
 * The state shown always comes from the server; a failed save says so and can be retried. */
export default function RiderAssistance({
  request,
  assistance,
  busy,
  mutate,
  now,
}: {
  request: RideRequest;
  assistance?: Assistance;
  busy: boolean;
  mutate: Mutate;
  now: number;
}) {
  const editable = ['requested', 'accepted', 'approaching'].includes(request.status);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AssistanceDraft>(emptyAssistance);
  const [save, setSave] = useState<'idle' | 'saving' | 'failed'>('idle');
  const state = assistance ? assistanceState(assistance) : null;
  // Screen readers hear each state change (requested, acknowledged, staff attention).
  const announced = useRef(state?.title);
  useEffect(() => {
    if (state && announced.current && announced.current !== state.title)
      AccessibilityInfo.announceForAccessibility(`Boarding assistance: ${state.title}`);
    announced.current = state?.title;
  }, [state?.title, state]);
  const current: AssistanceDraft = assistance
    ? { needs: assistance.needs, note: assistance.note }
    : emptyAssistance;
  const submit = async (next: AssistanceDraft) => {
    setSave('saving');
    const ok = await mutate(
      '/requests/assistance',
      {
        requestId: request.id,
        baseVersion: assistance?.version ?? 0,
        assistance: assistanceBody(next),
      },
      next.needs.length ? 'Boarding assistance updated.' : 'Boarding assistance removed.',
    );
    setSave(ok ? 'idle' : 'failed');
    if (ok) setEditing(false);
  };
  if (!assistance && !editable) return null;
  return (
    <View
      style={[s.notice, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}
      accessibilityLabel="Boarding assistance"
    >
      <View style={[s.row, { justifyContent: 'flex-start' }]}>
        <Icon name="accessibility-outline" color={C.navy} size={22} />
        <Text style={[s.heading, { flex: 1 }]}>Boarding assistance</Text>
      </View>
      {!editing && assistance && state && (
        <>
          <Text style={s.body}>{needsText(assistance.needs)}</Text>
          {!!assistance.note && <Text style={s.caption}>Your note: {assistance.note}</Text>}
          <View
            style={[s.row, { justifyContent: 'flex-start', alignItems: 'flex-start' }]}
            accessibilityLiveRegion="polite"
            aria-live="polite"
          >
            <Icon name={state.icon} color={toneColor[state.tone]} size={20} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.heading, { color: toneColor[state.tone] }]}>{state.title}</Text>
              <Text style={s.caption}>
                {state.detail}
                {assistance.status === 'acknowledged' && assistance.ack_at
                  ? ` Acknowledged ${ago(assistance.ack_at, now)}.`
                  : ''}
              </Text>
            </View>
          </View>
          {!!assistance.staff_note && (
            <View style={[s.row, { justifyContent: 'flex-start', alignItems: 'flex-start' }]}>
              <Icon name="chatbubble-ellipses-outline" color={C.navy} size={18} />
              <Text style={[s.body, { flex: 1 }]}>Message from staff: {assistance.staff_note}</Text>
            </View>
          )}
        </>
      )}
      {!editing && !assistance && (
        <Text style={s.caption}>
          None requested. You can add a ramp or lift, extra boarding time, or other help until you
          board.
        </Text>
      )}
      {editing && (
        <>
          <AssistancePicker value={draft} onChange={setDraft} disabled={save === 'saving'} />
          <Text style={s.caption}>Changing your needs asks the driver to acknowledge again.</Text>
        </>
      )}
      {save === 'failed' && (
        <View style={[s.row, { justifyContent: 'flex-start' }]} accessibilityRole="alert">
          <Icon name="cloud-offline-outline" color={C.coral} size={18} />
          <Text style={[s.caption, { flex: 1, color: C.navy }]}>
            Not saved: your driver hasn’t received this change. Check your connection and try again.
          </Text>
        </View>
      )}
      {editable &&
        (editing ? (
          <View style={{ gap: 8 }}>
            <Button
              label={
                save === 'failed'
                  ? 'Try again'
                  : draft.needs.length
                    ? 'Save assistance'
                    : 'Remove assistance'
              }
              icon="checkmark-outline"
              loading={save === 'saving'}
              loadingLabel="Saving…"
              disabled={busy || sameAssistance(draft, current)}
              onPress={() => void submit(draft)}
            />
            <Button
              secondary
              label="Keep current details"
              disabled={save === 'saving'}
              onPress={() => {
                setEditing(false);
                setSave('idle');
              }}
            />
          </View>
        ) : (
          <Button
            secondary
            icon="create-outline"
            label={assistance ? 'Review or change assistance' : 'Add boarding assistance'}
            disabled={busy}
            onPress={() => {
              setDraft(current);
              setSave('idle');
              setEditing(true);
            }}
          />
        ))}
    </View>
  );
}
