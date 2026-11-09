import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
export const GPS_TASK = 'next-stop-driver-location-v1';
const CONTEXT = 'nextstop-gps-context',
  STATUS = 'nextstop-gps-status';
export interface TrackingContext {
  serverUrl: string;
  institutionId: string;
  tripId: string;
}
export async function readTrackingContext(): Promise<TrackingContext | null> {
  if (Platform.OS === 'web') return null;
  const raw = await SecureStore.getItemAsync(CONTEXT);
  return raw ? JSON.parse(raw) : null;
}
export async function writeTrackingContext(value: TrackingContext) {
  await SecureStore.setItemAsync(CONTEXT, JSON.stringify(value), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}
async function saveStatus(message: string) {
  await SecureStore.setItemAsync(STATUS, JSON.stringify({ message, at: Date.now() }), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}
export async function trackingStatus(): Promise<{ message: string; at: number } | null> {
  if (Platform.OS === 'web') return null;
  const value = await SecureStore.getItemAsync(STATUS);
  return value ? JSON.parse(value) : null;
}
export async function clearTrackingContext() {
  if (Platform.OS !== 'web') {
    await SecureStore.deleteItemAsync(CONTEXT);
    await SecureStore.deleteItemAsync(STATUS);
  }
}
// Defined at module scope so the native runtime can execute it without mounting a screen.
if (Platform.OS !== 'web')
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    GPS_TASK,
    async ({ data, error }) => {
      if (error) {
        await saveStatus(error.message);
        return;
      }
      const context = await readTrackingContext();
      const token = await SecureStore.getItemAsync('nextstop-session');
      if (!context || !token) {
        if (await Location.hasStartedLocationUpdatesAsync(GPS_TASK))
          await Location.stopLocationUpdatesAsync(GPS_TASK);
        return;
      }
      const newest = data?.locations?.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
      if (
        !newest ||
        newest.coords.accuracy == null ||
        newest.coords.accuracy > 100 ||
        Date.now() - newest.timestamp > 30000
      ) {
        await saveStatus('Waiting for a fresh, accurate GPS fix.');
        return;
      }
      try {
        const response = await fetch(context.serverUrl + '/trips/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            institutionId: context.institutionId,
            tripId: context.tripId,
            lat: newest.coords.latitude,
            lng: newest.coords.longitude,
            accuracy: newest.coords.accuracy,
            // The server keeps the heading only when it is valid and the vehicle is moving.
            heading: newest.coords.heading,
            speed: newest.coords.speed,
            capturedAt: newest.timestamp,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (response.status === 401 || response.status === 403) {
          await clearTrackingContext();
          await Location.stopLocationUpdatesAsync(GPS_TASK);
          await saveStatus('GPS stopped: sign in and verify your driver access.');
          return;
        }
        if (!response.ok) {
          const body = await response.json();
          if (response.status === 409 && body.error === 'Start service first.') {
            await clearTrackingContext();
            await Location.stopLocationUpdatesAsync(GPS_TASK);
            await saveStatus('Tracking stopped because the shuttle is no longer in service.');
            return;
          }
          await saveStatus(body.error || 'GPS update rejected.');
          return;
        }
        await saveStatus('GPS sent to the server.');
      } catch {
        await saveStatus(
          'Server unreachable. New GPS fixes will retry; riders see a stale-location warning.',
        );
      }
    },
  );
