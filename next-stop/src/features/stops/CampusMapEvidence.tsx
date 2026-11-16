import React from 'react';
import { Linking, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { s } from '../../components/UI';
import type { Stop } from '../../domain';

const KIND: Record<NonNullable<Stop['campus_map']>['records'][number]['kind'], string> = {
  building: 'building',
  parking: 'parking lot',
  entrance: 'entrance view',
  viewpoint: '360° view point',
  campus: 'campus',
};

/**
 * Administrators: what the institution's official campus map shows near this stop. Evidence
 * for checking a boarding point, never a boarding point itself: the map marks buildings, lots
 * and view points, not where the shuttle stops.
 */
export default function CampusMapEvidence({ stop }: { stop: Stop }) {
  const map = stop.campus_map;
  if (!map) return null;
  return (
    <View
      style={{ gap: 4, padding: 10, borderRadius: 12, backgroundColor: '#F2F5F8' }}
      accessibilityLabel={`${map.source}: ${map.note}`}
    >
      <Text style={s.label}>OFFICIAL CAMPUS MAP</Text>
      {map.records.map((r) => (
        <Text key={r.locationId} style={s.caption}>
          <Text
            accessibilityRole="link"
            onPress={() => void Linking.openURL(r.url)}
            style={{ color: C.navy, fontWeight: '600', textDecorationLine: 'underline' }}
          >
            {r.name}
          </Text>
          {` · ${KIND[r.kind]}`}
          {r.distance != null ? ` · ${r.distance} m away` : ''}
        </Text>
      ))}
      {!!map.note && <Text style={s.caption}>{map.note}</Text>}
      <Text style={[s.caption, { fontSize: 11 }]}>
        The campus map marks buildings and lots, not shuttle stops, so it can’t confirm a boarding
        point. {map.source}
        {map.checkedAt ? `, checked ${map.checkedAt}` : ''}.
      </Text>
    </View>
  );
}
