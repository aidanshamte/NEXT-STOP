import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { C, Mark } from '../../components/Brand';
import { Icon, s } from '../../components/UI';
import { PHOTO_SHOWS_LABEL, photoCredit } from '../../domain';
import type { Stop } from '../../domain';
import { api } from '../../services/api';

// Images are cached per stop, size and photo version, so a replaced photo is fetched again and
// an unchanged one never is. Photos are institution-private, so they are fetched with the
// session rather than linked. Nothing here is loaded by the live map.
const cache = new Map<string, string>();
const MAX_CACHED = 60;
const keyOf = (org: string, stop: Stop, size: string) =>
  `${org}|${stop.id}|${size}|${stop.photo?.version ?? 0}`;

function usePhoto(org: string, stop: Stop, size: 'thumb' | 'full') {
  const key = keyOf(org, stop, size);
  const has = !!stop.photo;
  const [loaded, setLoaded] = useState<{ key: string; uri: string } | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    if (!has || cache.has(key)) return;
    let active = true;
    api<{ contentType: string; data: string }>(
      `/stops/photo?institutionId=${encodeURIComponent(org)}&stopId=${encodeURIComponent(stop.id)}&size=${size}`,
    )
      .then((p) => {
        const uri = `data:${p.contentType};base64,${p.data}`;
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
        cache.set(key, uri);
        if (active) setLoaded({ key, uri });
      })
      .catch(() => active && setFailed(key));
    return () => {
      active = false;
    };
  }, [org, stop.id, size, has, key]);
  const uri = cache.get(key) || (loaded?.key === key ? loaded.uri : '');
  return { uri, failed: failed === key, has };
}

const shownText = (stop: Stop) => (stop.photo?.shows ? PHOTO_SHOWS_LABEL[stop.photo.shows] : '');

/** Branded stand-in when a stop has no verified photo (or it could not load). */
function Fallback({ name, compact }: { name: string; compact?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={`No photo of ${name} yet`}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: C.navy,
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? 0 : 8,
        padding: 12,
      }}
    >
      <View
        style={{
          backgroundColor: 'white',
          borderRadius: compact ? 10 : 14,
          padding: compact ? 6 : 8,
        }}
      >
        <Mark size={compact ? 22 : 34} />
      </View>
      {!compact && (
        <Text style={{ color: 'white', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
          No photo of this stop yet
        </Text>
      )}
    </View>
  );
}

/**
 * The stop's photo on its details screen: the full-size image with what it shows and its
 * credit, or the branded stand-in. Kept below the stop name and actions.
 */
export default function StopPhoto({ org, stop }: { org: string; stop: Stop }) {
  const { uri, failed, has } = usePhoto(org, stop, 'full');
  const p = stop.photo;
  const label = p?.alt ? p.alt : `Photo of ${stop.name}`;
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          width: '100%',
          aspectRatio: 16 / 9,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: C.paper,
        }}
      >
        {has && uri ? (
          <Image
            source={{ uri }}
            accessibilityLabel={label}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : !has || failed ? (
          <Fallback name={stop.name} />
        ) : (
          <View
            accessible
            accessibilityLabel={`Loading photo of ${stop.name}`}
            style={{ flex: 1, backgroundColor: '#E9EEF1' }}
          />
        )}
      </View>
      {has && p && (
        <View style={{ gap: 2 }}>
          {!!shownText(stop) && (
            <View style={[s.row, { justifyContent: 'flex-start', gap: 6 }]}>
              <Icon
                name={p.shows === 'landmark' ? 'business-outline' : 'location-outline'}
                size={14}
                color={C.muted}
              />
              <Text style={[s.caption, { flex: 1 }]}>{shownText(stop)}</Text>
            </View>
          )}
          {!!photoCredit(p) && (
            <Text style={[s.caption, { fontSize: 11 }]}>
              {photoCredit(p)}
              {!!p.sourceUrl && (
                <Text
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(p.sourceUrl)}
                  style={{ textDecorationLine: 'underline' }}
                >
                  {' '}
                  · Source
                </Text>
              )}
            </Text>
          )}
          {!p.verified && (
            <Text style={[s.caption, { color: '#8A5A00' }]}>
              Not verified yet: riders don’t see this photo until you verify it below.
            </Text>
          )}
        </View>
      )}
      {!!stop.campus_photos && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Official campus photos of ${stop.campus_photos.name}, on the ${stop.campus_photos.source}`}
          accessibilityHint="Opens the campus map"
          onPress={() => void Linking.openURL(stop.campus_photos!.url)}
          style={[s.row, { justifyContent: 'flex-start', gap: 6, paddingVertical: 4 }]}
        >
          <Icon name="images-outline" size={16} color={C.navy} />
          <Text
            style={[
              s.caption,
              { flex: 1, color: C.navy, fontWeight: '600', textDecorationLine: 'underline' },
            ]}
          >
            Official campus photos: {stop.campus_photos.name}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Small square preview for the selected pickup stop; secondary to the name and actions. */
export function StopThumb({ org, stop, size = 64 }: { org: string; stop: Stop; size?: number }) {
  const { uri, failed, has } = usePhoto(org, stop, 'thumb');
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: C.paper,
      }}
    >
      {has && uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel={stop.photo?.alt || `Photo of ${stop.name}`}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : !has || failed ? (
        <Fallback name={stop.name} compact />
      ) : null}
    </View>
  );
}
