import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { C } from '../../components/Brand';
import LiveMap from '../../components/LiveMap';
import { Button, Icon, s } from '../../components/UI';
import type { Stop } from '../../domain';
import type { Walk } from './useWalk';
import { directionsLinks, routeSummary } from './walking';

const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';

/**
 * Walking directions to a confirmed boarding point. Separate from requesting a pickup: nothing
 * here creates, changes or cancels a request. The external maps link always works, whatever
 * happens to location permission or the route preview.
 */
export default function WalkPanel({
  walk,
  stop,
  showMap = false,
}: {
  walk: Walk;
  /** The stop being walked to (for the map preview). */
  stop?: Stop;
  /** Draw the route on a map inside the panel (when the screen has no map of its own). */
  showMap?: boolean;
}) {
  const { target, phase, route, fix, quality, message } = walk;
  const [openError, setOpenError] = useState('');
  const announced = useRef('');
  const summary = route && route.stopId === target?.id ? routeSummary(route) : '';
  useEffect(() => {
    if (summary && announced.current !== summary) {
      announced.current = summary;
      AccessibilityInfo.announceForAccessibility?.(`Walking route ready. ${summary}`);
    }
  }, [summary]);
  if (!target) return null;
  const links = directionsLinks(target, platform, userAgent);
  const open = async (url: string) => {
    setOpenError('');
    try {
      await Linking.openURL(url);
    } catch {
      setOpenError(
        `Couldn’t open a maps app. The boarding point is at ${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}.`,
      );
    }
  };
  const accuracy = fix ? Math.round(fix.accuracy) : null;
  const status: { icon: React.ComponentProps<typeof Icon>['name']; text: string; tone: string } =
    phase === 'locating'
      ? { icon: 'locate-outline', text: 'Finding your location…', tone: C.muted }
      : phase === 'denied'
        ? {
            icon: 'alert-circle-outline',
            text: 'Location permission is off, so the route preview can’t start from where you are. You can still open walking directions in your maps app.',
            tone: '#8A5A00',
          }
        : phase === 'routing'
          ? { icon: 'walk-outline', text: 'Getting the walking route…', tone: C.muted }
          : phase === 'route' && summary
            ? { icon: 'walk-outline', text: summary, tone: C.navy }
            : phase === 'no-route' ||
                phase === 'route-failed' ||
                phase === 'offline' ||
                phase === 'unavailable'
              ? {
                  icon: phase === 'offline' ? 'cloud-offline-outline' : 'alert-circle-outline',
                  text: `${message || 'The route preview isn’t available.'} Your maps app can still give directions.`,
                  tone: '#8A5A00',
                }
              : { icon: 'walk-outline', text: '', tone: C.muted };
  // GPS quality notes, separate from the route itself.
  const fixNote =
    quality === 'stale'
      ? 'Your location hasn’t updated for over 2 minutes, so the route may not start where you are.'
      : quality === 'poor'
        ? `Your location is only accurate to about ${accuracy} m, too rough to plan a route. Move outdoors or use your maps app.`
        : quality === 'rough' && phase === 'route'
          ? `Your location is accurate to about ${accuracy} m, so the start of the route may be off.`
          : '';
  const endNote =
    phase === 'route' && route && route.endGap > 25
      ? `The mapped path ends about ${route.endGap} m from the boarding point. Walk the last part to the pickup pin.`
      : '';
  const canRetry = ['denied', 'unavailable', 'no-route', 'route-failed', 'offline'].includes(phase);
  return (
    <View
      style={{
        gap: 12,
        borderWidth: 1,
        borderColor: C.line,
        borderRadius: 18,
        padding: 14,
        backgroundColor: 'white',
      }}
      accessibilityLabel={`Walking directions to ${target.name}`}
    >
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.label}>WALKING DIRECTIONS</Text>
          <Text style={s.heading} accessibilityRole="header">
            Walk to {target.name}
          </Text>
          <Text style={s.caption}>To the boarding point. This doesn’t request a pickup.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close walking directions"
          onPress={walk.stop}
          hitSlop={8}
          style={{ padding: 6 }}
        >
          <Icon name="close" size={22} color={C.muted} />
        </Pressable>
      </View>

      {!!status.text && (
        <View
          accessibilityLiveRegion="polite"
          style={[s.row, { justifyContent: 'flex-start', alignItems: 'flex-start', gap: 10 }]}
        >
          {phase === 'locating' || phase === 'routing' ? (
            <ActivityIndicator size="small" color={C.navy} />
          ) : (
            <Icon name={status.icon} size={20} color={status.tone} />
          )}
          <Text
            style={[
              s.body,
              { flex: 1, color: status.tone, fontWeight: phase === 'route' ? '700' : '400' },
            ]}
          >
            {status.text}
          </Text>
        </View>
      )}
      {!!fixNote && <Text style={[s.caption, { color: '#8A5A00' }]}>{fixNote}</Text>}
      {!!endNote && <Text style={s.caption}>{endNote}</Text>}
      {phase === 'route' && (
        <Text style={s.caption}>
          Walking estimate from map data, not a shuttle arrival time. The route may include stairs
          or uneven paths: step-free information isn’t available.
        </Text>
      )}
      {canRetry && (
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {phase === 'denied' && !walk.canAskAgain && Platform.OS !== 'web' ? (
            <Button
              secondary
              icon="settings-outline"
              label="Open Settings"
              onPress={() => void Linking.openSettings()}
            />
          ) : (
            <Button
              secondary
              icon="refresh"
              label={phase === 'denied' ? 'Allow location' : 'Try again'}
              onPress={walk.retry}
            />
          )}
        </View>
      )}

      {showMap && stop && (
        <View style={{ borderRadius: 14, overflow: 'hidden' }}>
          <LiveMap
            height={260}
            stops={[stop]}
            highlight={{ pickupId: stop.id }}
            walk={
              route && route.stopId === target.id
                ? {
                    key: `${route.stopId}|${route.coords.length}|${route.distance}`,
                    coords: route.coords,
                    to: target.name,
                    from: fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null,
                  }
                : fix
                  ? {
                      key: 'fix',
                      coords: [],
                      to: target.name,
                      from: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy },
                    }
                  : null
            }
          />
        </View>
      )}

      <Button
        icon="navigate-outline"
        label={`Open walking directions in ${links.primary.app}`}
        onPress={() => void open(links.primary.url)}
      />
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open walking directions in ${links.alternate.app} instead`}
        onPress={() => void open(links.alternate.url)}
        style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
      >
        <Text
          style={[s.caption, { color: C.navy, textDecorationLine: 'underline', fontWeight: '600' }]}
        >
          Use {links.alternate.app} instead
        </Text>
      </Pressable>
      {!!openError && (
        <Text accessibilityRole="alert" style={[s.caption, { color: '#C2381F' }]}>
          {openError}
        </Text>
      )}
      <Text style={[s.caption, { fontSize: 11 }]}>
        The maps app receives only the boarding point; it finds your position itself if you allow
        it. For the preview here, your position, rounded to about 10 m, is sent through NEXT STOP to
        the OpenStreetMap routing service (FOSSGIS). It isn’t saved or shared with drivers.
        {route ? ' Route © OpenStreetMap contributors. ' : ' '}
        {route && (
          <Text
            accessibilityRole="link"
            onPress={() => void Linking.openURL(route.fixUrl)}
            style={{ textDecorationLine: 'underline' }}
          >
            Report a map problem
          </Text>
        )}
      </Text>
    </View>
  );
}
