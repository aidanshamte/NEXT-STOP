import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { s } from '../../components/UI';
import type { Institution, Trip } from '../../domain';

export function InstitutionChooser({
  institutions,
  selectedId,
  busy,
  onSelect,
}: {
  institutions: Institution[];
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={s.pills}>
      {institutions.map((i) => (
        <Pressable
          accessibilityRole="button"
          key={i.id}
          disabled={busy}
          onPress={() => onSelect(i.id)}
          style={[s.pill, selectedId === i.id && s.pillActive]}
        >
          <Text style={[s.pillText, selectedId === i.id && { color: 'white' }]}>{i.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Selecting a different shuttle is handled by the caller, which must stop driver GPS first. */
export function ShuttleSelector({
  trips,
  selectedId,
  busy,
  onSelect,
}: {
  trips: Trip[];
  selectedId?: string;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={s.pills}>
      {trips.map((t) => (
        <Pressable
          key={t.id}
          disabled={busy}
          onPress={() => (t.id === selectedId ? undefined : onSelect(t.id))}
          style={[s.pill, selectedId === t.id && s.pillActive]}
        >
          <Text style={[s.pillText, selectedId === t.id && { color: 'white' }]}>
            {t.name}
            {t.active ? ' · In service' : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
