import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { C } from '../../components/Brand';
import { Button, Card, Field, Tag, s } from '../../components/UI';
import { isBoardable, routeSequence } from '../../domain';
import type { Route, RouteStop, Stop, Trip } from '../../domain';
import type { Mutate, Run } from '../workspace/types';

/** Administrator view of routes and their stops. Draft stops get a confirmed boarding
 * point here (ideally by standing at the stop); riders cannot use a stop until then. */
export default function RoutesPanel({
  routes,
  routeStops,
  stops,
  trips,
  busy,
  run,
  mutate,
}: {
  routes: Route[];
  routeStops: RouteStop[];
  stops: Stop[];
  trips: Trip[];
  busy: boolean;
  run: Run;
  mutate: Mutate;
}) {
  const [routeId, setRouteId] = useState('');
  const [editing, setEditing] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [fix, setFix] = useState('');
  if (!routes.length) return null;
  const route = routes.find((r) => r.id === routeId) || routes[0];
  const sequence = routeSequence(route.id, routeStops, stops);
  const confirmed = stops.filter(isBoardable).length;
  const startEditing = (stop: Stop) => {
    setEditing(stop.id);
    setLatitude(stop.lat != null ? String(stop.lat) : '');
    setLongitude(stop.lng != null ? String(stop.lng) : '');
    setFix('');
  };
  return (
    <Card>
      <Text style={s.title}>Routes and stops</Text>
      <Text style={s.body}>
        {confirmed} of {stops.length} stops have a confirmed boarding point. Draft stops are hidden
        from riders until you confirm their pin, ideally while standing where riders board.
      </Text>
      <View style={s.pills}>
        {routes.map((r) => (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={`Show ${r.name}`}
            onPress={() => {
              setRouteId(r.id);
              setEditing('');
            }}
            style={[s.pill, route.id === r.id && s.pillActive]}
          >
            <Text style={[s.pillText, route.id === r.id && { color: 'white' }]}>{r.name}</Text>
          </Pressable>
        ))}
      </View>
      {sequence.map(({ stop, onDemand, position }) => {
        const draft = !isBoardable(stop);
        return (
          <View key={`${route.id}-${position}`} style={s.request}>
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              <Text style={[s.heading, { flex: 1 }]}>
                {position + 1}. {stop.name}
              </Text>
              <Tag
                text={draft ? 'Draft · needs pin' : 'Confirmed'}
                tone={draft ? 'coral' : 'green'}
              />
            </View>
            {onDemand && <Text style={s.caption}>On-demand stop</Text>}
            {!!stop.note && <Text style={s.caption}>{stop.note}</Text>}
            {draft && !!stop.suggestion && (
              <Text style={s.caption}>Suggested location ready for review above.</Text>
            )}
            {!draft && (
              <Text style={s.caption}>
                Pin {stop.lat?.toFixed(5)}, {stop.lng?.toFixed(5)}
                {stop.pin_source ? ` · ${stop.pin_source}` : ''}
              </Text>
            )}
            {editing === stop.id ? (
              <>
                <Button
                  secondary
                  icon="locate-outline"
                  label="Use my current GPS for this stop"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      const permission = await Location.requestForegroundPermissionsAsync();
                      if (permission.status !== 'granted')
                        throw Error('Allow location access to pin this stop.');
                      const point = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Highest,
                      });
                      const accuracy = point.coords.accuracy;
                      if (accuracy == null || accuracy > 30)
                        throw Error(
                          `GPS accuracy is ${accuracy == null ? 'unknown' : `${Math.round(accuracy)} m`}. Step outside and try again (30 m or better).`,
                        );
                      setLatitude(point.coords.latitude.toFixed(6));
                      setLongitude(point.coords.longitude.toFixed(6));
                      setFix(`Captured within ${Math.round(accuracy)} m. Check it, then confirm.`);
                    })
                  }
                />
                {!!fix && <Text style={s.caption}>{fix}</Text>}
                <Field
                  label="Latitude"
                  value={latitude}
                  onChange={(v) => {
                    setLatitude(v);
                    setFix('');
                  }}
                />
                <Field
                  label="Longitude"
                  value={longitude}
                  onChange={(v) => {
                    setLongitude(v);
                    setFix('');
                  }}
                />
                <Button
                  label="Confirm boarding point"
                  disabled={busy || !latitude || !longitude}
                  onPress={() =>
                    void mutate(
                      '/stops/pin',
                      {
                        stopId: stop.id,
                        lat: Number(latitude),
                        lng: Number(longitude),
                        source: fix ? 'gps' : 'typed',
                      },
                      `${stop.name} is confirmed. Riders can now board there.`,
                    ).then(() => setEditing(''))
                  }
                />
                <Button secondary label="Cancel" disabled={busy} onPress={() => setEditing('')} />
              </>
            ) : (
              <Button
                secondary
                label={draft ? 'Set boarding point' : 'Move pin'}
                disabled={busy}
                onPress={() => startEditing(stop)}
              />
            )}
          </View>
        );
      })}
      {!!trips.length && (
        <>
          <View style={s.divider} />
          <Text style={s.heading}>Shuttle routes</Text>
          <Text style={s.body}>
            A shuttle with a route offers riders only that route’s confirmed stops.
          </Text>
          {trips.map((trip) => (
            <View key={trip.id} style={s.request}>
              <Text style={s.heading}>{trip.name}</Text>
              <View style={s.pills}>
                {routes.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Assign ${r.name} to ${trip.name}`}
                    disabled={busy || trip.route_id === r.id}
                    onPress={() =>
                      void mutate(
                        '/trips/route',
                        { tripId: trip.id, routeId: r.id },
                        `${trip.name} now serves the ${r.name}.`,
                      )
                    }
                    style={[s.pill, trip.route_id === r.id && s.pillActive]}
                  >
                    <Text style={[s.pillText, trip.route_id === r.id && { color: 'white' }]}>
                      {r.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </>
      )}
      <Text style={[s.caption, { color: C.muted }]}>
        Stops and routes come from your institution’s published shuttle information. Arrival
        estimates start only after shuttles with an assigned route pass confirmed stops.
      </Text>
    </Card>
  );
}
