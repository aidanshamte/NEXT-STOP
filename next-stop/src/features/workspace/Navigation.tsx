import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Brand, C, Mark } from '../../components/Brand';
import { Icon, s } from '../../components/UI';
import type { IconName } from '../../components/UI';
import type { Role } from '../../domain';

export type Tab =
  | 'overview'
  | 'journeys'
  | 'schedules'
  | 'updates'
  | 'account'
  | 'setup'
  | 'stop'
  | 'pass'
  | 'safety';
/** Every routable screen; `stop` is opened from a stop name and has no nav entry. */
export const tabIds: Tab[] = [
  'overview',
  'journeys',
  'schedules',
  'updates',
  'account',
  'setup',
  'stop',
  'pass',
  'safety',
];

export function workspaceTabs(role: Role, { pass = false } = {}): [Tab, IconName, string][] {
  const overview: [Tab, IconName, string] = [
    'overview',
    'navigate-outline',
    role === 'driver' ? 'Drive' : role === 'student' ? 'Live' : 'Overview',
  ];
  const schedules: [Tab, IconName, string] = ['schedules', 'calendar-outline', 'Schedules'];
  const updates: [Tab, IconName, string] = ['updates', 'notifications-outline', 'Alerts'];
  const account: [Tab, IconName, string] = ['account', 'person-circle-outline', 'Account'];
  if (role === 'driver')
    return [overview, ['journeys', 'git-branch-outline', 'Journeys'], updates, account];
  if (role === 'admin')
    return [overview, schedules, updates, ['setup', 'construct-outline', 'Setup'], account];
  if (role === 'student' && pass)
    return [overview, schedules, ['pass', 'qr-code-outline', 'Pass'], updates, account];
  return [overview, schedules, updates, account];
}

interface NavProps {
  tabs: [Tab, IconName, string][];
  tab: Tab;
  onSelect: (tab: Tab) => void;
}

export function Sidebar({ tabs, tab, onSelect }: NavProps) {
  return (
    <View style={s.sidebar}>
      <Brand />
      <View style={{ marginTop: 45, gap: 10 }}>
        {tabs.map(([id, icon, label]) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            aria-selected={tab === id}
            onPress={() => onSelect(id)}
            style={[s.sideLink, tab === id && { backgroundColor: C.navy }]}
          >
            <Icon name={icon} color={tab === id ? 'white' : C.muted} />
            <Text style={{ fontWeight: '600', color: tab === id ? 'white' : C.muted }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <View style={s.darkCard}>
        <Mark size={34} />
        <Text style={{ color: 'white', fontSize: 17, fontWeight: '700' }}>
          Every stop has a purpose.
        </Text>
      </View>
    </View>
  );
}

export function BottomNav({ tabs, tab, onSelect }: NavProps) {
  return (
    <View style={s.bottomNav}>
      {tabs.map(([id, icon, label]) => (
        <Pressable
          key={id}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === id }}
          aria-selected={tab === id}
          onPress={() => onSelect(id)}
          style={{ flex: 1, alignItems: 'center', gap: 5, padding: 9 }}
        >
          <Icon name={icon} color={tab === id ? C.coral : C.muted} />
          <Text
            style={{
              fontSize: 10,
              fontWeight: '600',
              color: tab === id ? C.coral : C.muted,
            }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
