import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import LiveMap from '../../components/LiveMap';
import { Button, Card, Tag, s } from '../../components/UI';
import type { Tone } from '../../components/UI';
import type { Stop } from '../../domain';
import type { Mutate } from '../workspace/types';

const CONFIDENCE: Record<'high' | 'medium' | 'low', { label: string; tone: Tone }> = {
  high: { label: 'High confidence', tone: 'green' },
  medium: { label: 'Medium confidence', tone: 'amber' },
  low: { label: 'Low confidence · check first', tone: 'coral' },
};

/** Researched boarding points for draft stops, one at a time, approved with one tap. A
 * suggestion is never a confirmed pin: riders cannot use the stop until it is approved. */
export default function SuggestedPins({
  stops,
  busy,
  mutate,
}: {
  stops: Stop[];
  busy: boolean;
  mutate: Mutate;
}) {
  const pending = stops.filter((stop) => stop.status === 'draft' && stop.suggestion);
  const unresolved = stops.filter(
    (stop) => stop.status === 'draft' && !stop.suggestion && stop.unresolved,
  );
  const [index, setIndex] = useState(0);
  if (!pending.length && !unresolved.length) return null;
  const at = pending.length ? index % pending.length : 0;
  const stop = pending[at];
  const suggestion = stop?.suggestion;
  return (
    <Card>
      <Text style={s.title}>Suggested boarding points</Text>
      <Text style={s.body}>
        {pending.length
          ? `${pending.length} draft ${pending.length === 1 ? 'stop has' : 'stops have'} a researched location. Nothing is confirmed until you approve it, ideally after checking the spot.`
          : 'Every researched suggestion has been reviewed.'}
      </Text>
      {stop && suggestion && (
        <View style={s.request}>
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            <Text style={[s.heading, { flex: 1 }]}>{stop.name}</Text>
            <Tag
              text={CONFIDENCE[suggestion.confidence].label}
              tone={CONFIDENCE[suggestion.confidence].tone}
            />
          </View>
          <Text style={s.caption}>
            {at + 1} of {pending.length}
          </Text>
          <LiveMap
            height={200}
            stops={[{ ...stop, lat: suggestion.lat, lng: suggestion.lng, status: 'confirmed' }]}
          />
          <Text style={s.body}>{suggestion.basis}</Text>
          <Text style={s.caption}>
            Source: {suggestion.source}
            {suggestion.researchedAt ? ` · researched ${suggestion.researchedAt}` : ''}
          </Text>
          <Button
            icon="checkmark-circle-outline"
            label="Approve suggested location"
            disabled={busy}
            onPress={() =>
              void mutate(
                '/stops/approve-suggestion',
                { stopId: stop.id },
                `${stop.name} is confirmed. Riders can now board there.`,
              )
            }
          />
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            <Button
              secondary
              icon="map-outline"
              label="View in Google Maps"
              onPress={() =>
                void Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${suggestion.lat},${suggestion.lng}`,
                )
              }
            />
            {pending.length > 1 && (
              <Button
                secondary
                label="Skip for now"
                disabled={busy}
                onPress={() => setIndex(at + 1)}
              />
            )}
          </View>
          <Text style={s.caption}>
            Wrong spot? Skip it, then use “Set boarding point” on the route below while standing
            where riders board.
          </Text>
        </View>
      )}
      {!!unresolved.length && (
        <>
          <View style={s.divider} />
          <Text style={s.heading}>No suggestion found</Text>
          {unresolved.map((u) => (
            <Text key={u.id} style={s.caption}>
              {u.name}: {u.unresolved} Pin it on site with “Set boarding point” below.
            </Text>
          ))}
        </>
      )}
    </Card>
  );
}
