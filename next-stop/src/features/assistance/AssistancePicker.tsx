import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { C } from '../../components/Brand';
import { Field, Icon, s } from '../../components/UI';
import { ASSISTANCE_NOTE_MAX, ASSISTANCE_OPTIONS } from '../../domain';
import type { AssistanceNeed } from '../../domain';

export interface AssistanceDraft {
  needs: AssistanceNeed[];
  note: string;
}
export const emptyAssistance: AssistanceDraft = { needs: [], note: '' };
export const sameAssistance = (a: AssistanceDraft, b: AssistanceDraft) =>
  a.needs.join() === b.needs.join() &&
  (a.needs.includes('other') ? a.note.trim() : '') ===
    (b.needs.includes('other') ? b.note.trim() : '');
/** Body sent to the server: the note only with "other". */
export const assistanceBody = (d: AssistanceDraft) => ({
  needs: d.needs,
  note: d.needs.includes('other') ? d.note.trim() : '',
});

/** Visible keyboard focus on web (React Native Web passes `focused`). */
export const focusRing = (state: PressableStateCallbackType) =>
  (state as PressableStateCallbackType & { focused?: boolean }).focused
    ? { borderColor: C.navy, borderWidth: 2 }
    : null;

/** Space toggles checkboxes and radio buttons for keyboard users on the web (React Native
 * Web only maps Space for button roles; Enter already works). */
export const spaceKey = (action: () => void) =>
  ({
    onKeyDown: (e: { key?: string; preventDefault?: () => void }) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault?.();
        action();
      }
    },
  }) as object;

/** Optional boarding assistance choices. Only what helps boarding is asked; no diagnosis. */
export default function AssistancePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: AssistanceDraft;
  onChange: (next: AssistanceDraft) => void;
  disabled?: boolean;
}) {
  const toggle = (need: AssistanceNeed) =>
    onChange({
      ...value,
      needs: value.needs.includes(need)
        ? value.needs.filter((n) => n !== need)
        : ASSISTANCE_OPTIONS.map((o) => o.value).filter(
            (n) => n === need || value.needs.includes(n),
          ),
    });
  return (
    <View style={{ gap: 8 }} accessibilityRole="none" aria-label="Boarding assistance options">
      {ASSISTANCE_OPTIONS.map((option) => {
        const on = value.needs.includes(option.value);
        return (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled }}
            aria-checked={on}
            accessibilityLabel={option.label}
            accessibilityHint={option.hint}
            disabled={disabled}
            onPress={() => toggle(option.value)}
            {...(disabled ? {} : spaceKey(() => toggle(option.value)))}
            style={(state) => [
              s.stopOption,
              on && { borderColor: C.navy, backgroundColor: '#EEF2F6' },
              focusRing(state),
            ]}
          >
            <Icon
              name={on ? 'checkbox' : 'square-outline'}
              color={on ? C.navy : C.muted}
              size={22}
            />
            <View style={{ flex: 1 }}>
              <Text style={[s.heading, { fontWeight: on ? '700' : '500' }]}>{option.label}</Text>
              <Text style={s.caption}>{option.hint}</Text>
            </View>
          </Pressable>
        );
      })}
      {value.needs.includes('other') && (
        <View>
          <Field
            label="Note for the driver (optional)"
            value={value.note}
            maxLength={ASSISTANCE_NOTE_MAX}
            placeholder="For example: please park close to the curb"
            onChange={(note) => onChange({ ...value, note })}
          />
          <Text style={[s.caption, { marginTop: -8 }]}>
            Only your driver and transport staff see this. Please don’t include medical details.{' '}
            {value.note.length}/{ASSISTANCE_NOTE_MAX}
          </Text>
        </View>
      )}
    </View>
  );
}
