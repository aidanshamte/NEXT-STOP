import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './Brand';
export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Icon({
  name,
  size = 20,
  color = C.navy,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  icon,
  loading = false,
  loadingLabel,
  large = false,
  tone,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** Shows a spinner and blocks repeat presses while the action is in flight. */
  loading?: boolean;
  loadingLabel?: string;
  large?: boolean;
  tone?: 'navy';
}) {
  const fg = secondary ? C.navy : 'white';
  const text = loading ? loadingLabel || label : label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        large && s.buttonLarge,
        tone === 'navy' && { backgroundColor: C.navy },
        secondary && s.secondary,
        disabled && !loading && { opacity: 0.45 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        icon && <Icon name={icon} color={fg} size={large ? 22 : 20} />
      )}
      <Text style={[s.buttonText, large && { fontSize: 16 }, secondary && { color: C.navy }]}>
        {text}
      </Text>
    </Pressable>
  );
}
export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}
export type Tone = 'green' | 'coral' | 'gray' | 'amber' | 'navy';
const tones: Record<Tone, [string, string]> = {
  green: [C.mint, C.green],
  coral: ['#FFF0E9', '#C2381F'],
  gray: ['#EDF1F5', '#56636F'],
  amber: ['#FFF4D6', '#8A5A00'],
  navy: [C.navy, 'white'],
};
export function Tag({ text, tone = 'green' }: { text: string; tone?: Tone }) {
  const [bg, fg] = tones[tone];
  return (
    <View style={[s.tag, { backgroundColor: bg }]}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: fg }}>{text}</Text>
    </View>
  );
}
/** A pill with a coloured dot, for connection and GPS states. Colour is never the only cue. */
export function StatusChip({
  text,
  tone,
  solid = false,
}: {
  text: string;
  tone: Tone;
  solid?: boolean;
}) {
  const [bg, fg] = tones[tone];
  return (
    <View
      style={[s.chip, { backgroundColor: solid ? 'rgba(255,255,255,0.95)' : bg }]}
      accessible
      accessibilityLabel={text}
    >
      <View
        style={[s.dot, { marginTop: 1 }, { backgroundColor: tone === 'gray' ? '#8A949D' : fg }]}
      />
      <Text style={{ fontSize: 12, fontWeight: '700', color: solid ? C.navy : fg, flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}
export function SectionLabel({ children }: { children: string }) {
  return <Text style={s.eyebrow}>{children.toUpperCase()}</Text>;
}
export function Field({
  label,
  value,
  onChange,
  secure = false,
  placeholder = '',
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address';
}) {
  return (
    <View style={{ gap: 7, marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        placeholder={placeholder}
        autoCapitalize={secure || keyboardType === 'email-address' ? 'none' : 'sentences'}
        keyboardType={keyboardType}
        style={s.input}
        placeholderTextColor="#97A2AC"
      />
    </View>
  );
}
export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  welcome: { maxWidth: 1400, width: '100%', alignSelf: 'center', gap: 45 },
  welcomeGrid: { gap: 50, paddingVertical: 35 },
  hero: { fontWeight: '800', letterSpacing: -2.5, lineHeight: undefined, color: C.navy },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  sidebar: {
    width: 250,
    backgroundColor: 'white',
    padding: 26,
    borderRightWidth: 1,
    borderColor: C.line,
  },
  sideLink: { flexDirection: 'row', gap: 12, padding: 15, borderRadius: 13, alignItems: 'center' },
  card: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 20,
    gap: 14,
    boxShadow: '0 2px 14px rgba(17, 36, 58, 0.07)',
  },
  darkCard: { backgroundColor: C.navy, borderRadius: 22, padding: 24, gap: 18 },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.6, color: C.navy },
  heading: { fontSize: 15, fontWeight: '700', color: C.navy, lineHeight: 22 },
  pageTitle: { fontWeight: '700', letterSpacing: -1.2, color: C.navy, marginTop: 9 },
  body: { fontSize: 14, color: C.muted, lineHeight: 23 },
  caption: { fontSize: 11, color: C.muted, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: '700', color: C.navy, letterSpacing: 0.5 },
  eyebrow: { fontSize: 11, color: C.muted, fontWeight: '700', letterSpacing: 1.2 },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: C.navy,
    backgroundColor: C.paper,
    minHeight: 48,
  },
  button: {
    minHeight: 50,
    borderRadius: 999,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  buttonLarge: { minHeight: 58 },
  secondary: { backgroundColor: '#EEF2F5' },
  buttonText: { fontSize: 14, fontWeight: '700', color: 'white', textAlign: 'center' },
  pills: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#EEF2F5',
  },
  pillActive: { backgroundColor: C.navy, borderColor: C.navy },
  pillText: { fontSize: 13, fontWeight: '600', color: '#4A5763' },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, alignSelf: 'flex-start' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  notice: {
    padding: 14,
    backgroundColor: C.mint,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E5EBEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentGrid: { gap: 22 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 3 },
  stopOptions: { gap: 8 },
  stopOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    minHeight: 52,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
  },
  request: { borderTopWidth: 1, borderColor: C.line, paddingTop: 18, gap: 12, marginTop: 6 },
  empty: { paddingVertical: 24, alignItems: 'center', gap: 12 },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    boxShadow: '0 -2px 12px rgba(17, 36, 58, 0.06)',
    flexDirection: 'row',
    paddingBottom: 6,
  },
});
