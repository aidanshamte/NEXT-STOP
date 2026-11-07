import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { C } from '../../components/Brand';
import type { Stop } from '../../domain';
import { api } from '../../services/api';

const photoCache = new Map<string, string>();
export const forgetPhoto = (org: string, stopId: string) => photoCache.delete(`${org}|${stopId}`);

/** A stop's published photo, fetched with the session (photos are institution-private). */
export default function StopPhoto({ org, stop }: { org: string; stop: Stop }) {
  const key = `${org}|${stop.id}`;
  const [loaded, setLoaded] = useState<{ key: string; uri: string } | null>(null);
  const cached = photoCache.get(key);
  useEffect(() => {
    if (!stop.has_photo || photoCache.has(key)) return;
    let active = true;
    api<{ contentType: string; data: string }>(
      `/stops/photo?institutionId=${encodeURIComponent(org)}&stopId=${encodeURIComponent(stop.id)}`,
    )
      .then((p) => {
        const uri = `data:${p.contentType};base64,${p.data}`;
        photoCache.set(key, uri);
        if (active) setLoaded({ key, uri });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [org, stop.id, stop.has_photo, key]);
  const uri = cached || (loaded?.key === key ? loaded.uri : '');
  if (!stop.has_photo || !uri) return null;
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={`Photo of ${stop.name}`}
      style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 18, backgroundColor: C.paper }}
      resizeMode="cover"
    />
  );
}
