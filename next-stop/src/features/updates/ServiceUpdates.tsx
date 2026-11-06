import React from 'react';
import { Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Card, Icon, s } from '../../components/UI';
import type { Trip } from '../../domain';
import ServiceNotice from './ServiceNotice';

export default function ServiceUpdates({ trips }: { trips: Trip[] }) {
  const disrupted = trips.filter((t) => t.issue || t.delay_minutes);
  return (
    <View style={{ gap: 14 }}>
      <Text style={s.title}>Service updates</Text>
      {disrupted.map((t) => (
        <ServiceNotice key={t.id} trip={t} />
      ))}
      {!disrupted.length && (
        <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
          <Icon name="checkmark-circle-outline" size={30} color={C.green} />
          <Text style={s.heading}>No reported disruptions</Text>
          <Text style={[s.caption, { textAlign: 'center' }]}>
            Drivers and dispatch publish delays here. This list updates on its own.
          </Text>
        </Card>
      )}
    </View>
  );
}
