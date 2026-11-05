import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {icon && <Icon name={icon} color={secondary ? C.navy : 'white'} />}
      <Text style={[s.buttonText, secondary && { color: C.navy }]}>{label}</Text>
    </Pressable>
  );
}
export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Tag({ text, tone = 'green' }: { text: string; tone?: 'green' | 'coral' | 'gray' }) {
  return (
    <View
      style={[
        s.tag,
        { backgroundColor: tone === 'green' ? C.mint : tone === 'coral' ? '#FFF0E9' : '#EDF1F5' },
      ]}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: '700',
          color: tone === 'green' ? C.green : tone === 'coral' ? C.coral : C.muted,
        }}
      >
        {text}
      </Text>
    </View>
  );
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
    padding: 24,
    borderWidth: 1,
    borderColor: C.line,
    gap: 14,
  },
  darkCard: { backgroundColor: C.navy, borderRadius: 22, padding: 24, gap: 18 },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.6, color: C.navy },
  heading: { fontSize: 15, fontWeight: '700', color: C.navy, lineHeight: 22 },
  pageTitle: { fontWeight: '700', letterSpacing: -1.2, color: C.navy, marginTop: 9 },
  body: { fontSize: 14, color: C.muted, lineHeight: 23 },
  caption: { fontSize: 11, color: C.muted, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: '700', color: C.navy, letterSpacing: 0.5 },
  eyebrow: { fontSize: 10, color: C.muted, fontWeight: '700', letterSpacing: 1.5 },
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
    borderRadius: 14,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondary: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  buttonText: { fontSize: 13, fontWeight: '700', color: 'white', textAlign: 'center' },
  pills: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.paper,
  },
  pillActive: { backgroundColor: C.navy, borderColor: C.navy },
  pillText: { fontSize: 11, fontWeight: '600', color: C.muted },
  tag: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7, alignSelf: 'flex-start' },
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
    padding: 12,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
  },
  request: { borderTopWidth: 1, borderColor: C.line, paddingTop: 18, gap: 12, marginTop: 6 },
  empty: { paddingVertical: 24, alignItems: 'center', gap: 12 },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderColor: C.line,
    flexDirection: 'row',
    paddingBottom: 6,
  },
});
