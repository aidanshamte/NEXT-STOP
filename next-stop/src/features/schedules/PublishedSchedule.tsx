import React from 'react';
import { Linking, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Card, Icon, StatusChip, Tag, s } from '../../components/UI';
import type { PublishedDay, PublishedRouteDay } from '../../domain';
import { publishedLines, publishedStatus } from './published';

function SourceLink({ published }: { published: PublishedDay }) {
  return (
    <Text
      accessibilityRole="link"
      accessibilityHint="Opens the institution’s page"
      onPress={() => void Linking.openURL(published.source.url)}
      style={[s.caption, { color: C.navy, fontWeight: '600', textDecorationLine: 'underline' }]}
    >
      Source: {published.source.name} (checked {published.checkedAt})
    </Text>
  );
}

/** What the institution publishes without dates: where it comes from and what it can't say. */
export function PublishedSource({
  published,
  isToday,
}: {
  published: PublishedDay;
  isToday: boolean;
}) {
  return (
    <Card style={{ gap: 10 }}>
      <View style={s.row}>
        <Text style={[s.heading, { flex: 1 }]}>Published schedule</Text>
        <Tag text="Not live" tone="gray" />
      </View>
      <StatusChip text={publishedStatus(published, isToday)} tone="gray" />
      {!!published.calendar.note && <Text style={s.body}>{published.calendar.note}</Text>}
      {published.calendar.closures.length > 0 && (
        <Text style={s.caption}>
          No service (dates not published): {published.calendar.closures.join(', ')}.
        </Text>
      )}
      <SourceLink published={published} />
    </Card>
  );
}

/** One route's published hours, rules and departures for the selected day. */
export function PublishedRoute({
  day,
  published,
  tz,
}: {
  day: PublishedRouteDay;
  published: PublishedDay;
  tz: string;
}) {
  const lines = publishedLines(day, tz);
  return (
    <View style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: '#F2F5F8' }}>
      <Text style={s.label}>PUBLISHED SCHEDULE · NOT LIVE</Text>
      {!!lines.noService && <Text style={s.body}>{lines.noService}</Text>}
      {lines.hours.map((h) => (
        <Text key={h} style={[s.body, { color: C.navy, fontWeight: '600' }]}>
          Hours: {h}
        </Text>
      ))}
      {lines.conflict && (
        <View style={{ gap: 4 }} accessibilityRole="alert">
          <View style={[s.row, { justifyContent: 'flex-start', gap: 6 }]}>
            <Icon name="alert-circle-outline" size={16} color="#8A5A00" />
            <Text style={[s.body, { flex: 1, color: '#8A5A00', fontWeight: '700' }]}>
              {lines.conflict.text}
            </Text>
          </View>
          <Text style={s.caption}>{lines.conflict.detail}</Text>
          <SourceLink published={published} />
        </View>
      )}
      {lines.rules.map((r) => (
        <Text key={r.text} style={s.caption}>
          {r.text}
          {r.times ? ` Times: ${r.times}.` : ''}
        </Text>
      ))}
    </View>
  );
}
