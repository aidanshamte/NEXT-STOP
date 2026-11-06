import React from 'react';
import { Text, View } from 'react-native';
import { Card, Tag, s } from '../../components/UI';
import type { Trip } from '../../domain';

export default function ServiceUpdates({ trips }: { trips: Trip[] }) {
  const disrupted = trips.filter((t) => t.issue || t.delay_minutes);
  return (
    <Card>
      <Text style={s.title}>Service updates</Text>
      {disrupted.map((t) => (
        <View style={s.request} key={t.id}>
          <Tag text={`DELAY · ${t.delay_minutes} MIN`} tone="coral" />
          <Text style={s.heading}>{t.name}</Text>
          <Text style={s.body}>
            {t.issue || 'Wait at your approved stop and follow dispatch guidance.'}
          </Text>
        </View>
      ))}
      {!disrupted.length && <Text style={s.body}>No reported disruptions.</Text>}
    </Card>
  );
}
