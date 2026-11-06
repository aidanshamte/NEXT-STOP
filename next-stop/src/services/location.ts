import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { API_URL, api } from './api';
import { expoGoLimits, isExpoGo } from './runtime';

import {
  GPS_TASK,
  readTrackingContext,
  writeTrackingContext,
  clearTrackingContext,
} from './backgroundLocation';
const KEEP_AWAKE = 'next-stop-driver-gps';
let foreground: Location.LocationSubscription | null = null;
let foregroundContext: { institutionId: string; tripId: string; serverUrl: string } | null = null;
export async function stopDriverGps() {
  foreground?.remove();
  foreground = null;
  foregroundContext = null;
  if (isExpoGo) deactivateKeepAwake(KEEP_AWAKE);
  // Remove credentials/context first, so a pending headless callback cannot start another upload.
  await clearTrackingContext();
  if (
    Platform.OS !== 'web' &&
    (await TaskManager.isAvailableAsync()) &&
    (await Location.hasStartedLocationUpdatesAsync(GPS_TASK))
  )
    await Location.stopLocationUpdatesAsync(GPS_TASK);
}
export async function currentTracking() {
  if (Platform.OS === 'web' || isExpoGo) return foregroundContext;
  const context = await readTrackingContext();
  if (!context) return null;
  if (
    !(await TaskManager.isAvailableAsync()) ||
    !(await Location.hasStartedLocationUpdatesAsync(GPS_TASK))
  )
    return null;
  return context;
}
export async function startDriverGps(
  institutionId: string,
  tripId: string,
  onStatus: (value: string) => void,
) {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted')
    throw Error('Grant precise location access to share the shuttle GPS.');
  // Web and Expo Go: foreground tracking only (no background task is available).
  if (Platform.OS === 'web' || isExpoGo) {
    foreground?.remove();
    if (isExpoGo) await activateKeepAwakeAsync(KEEP_AWAKE);
    foreground = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 3000 },
      (location) => {
        if (location.coords.accuracy == null || location.coords.accuracy > 100)
          return onStatus('Waiting for an accurate GPS fix.');
        api('/trips/location', {
          institutionId,
          tripId,
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          accuracy: location.coords.accuracy,
          capturedAt: location.timestamp,
        })
          .then(() =>
            onStatus(
              isExpoGo
                ? `GPS shared at ${new Date(location.timestamp).toLocaleTimeString()}. Keep NEXT STOP open.`
                : 'Browser GPS shared. Keep this page open.',
            ),
          )
          .catch((e) => onStatus(e.message));
      },
      onStatus,
    );
    foregroundContext = { institutionId, tripId, serverUrl: API_URL };
    onStatus(
      isExpoGo
        ? expoGoLimits.gps
        : 'Browser tracking is foreground only. Use the installed app for background GPS.',
    );
    return;
  }
  if (!(await TaskManager.isAvailableAsync()))
    throw Error(
      'Background GPS requires an installed NEXT STOP native build, not Expo Go. See the phone installation guide.',
    );
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted')
    throw Error(
      'Background tracking needs “Always” (iOS) or “Allow all the time” (Android) location permission. Enable it in Settings, then retry.',
    );
  await stopDriverGps();
  await writeTrackingContext({ serverUrl: API_URL, institutionId, tripId });
  try {
    await Location.startLocationUpdatesAsync(GPS_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 0,
      timeInterval: 3000,
      deferredUpdatesInterval: 0,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'NEXT STOP · sharing shuttle GPS',
        notificationBody:
          'Location is shared during this trip. Stop sharing in the app when your duty ends.',
        notificationColor: '#EF543F',
        killServiceOnDestroy: true,
      },
    });
  } catch (error) {
    await clearTrackingContext();
    throw error;
  }
  onStatus('Driver tracking started. The operating system controls update timing.');
  // Obtain the first fix promptly rather than waiting for a background callback.
  try {
    const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    if (point.coords.accuracy != null && point.coords.accuracy <= 100)
      await api('/trips/location', {
        institutionId,
        tripId,
        lat: point.coords.latitude,
        lng: point.coords.longitude,
        accuracy: point.coords.accuracy,
        capturedAt: point.timestamp,
      });
  } catch {
    onStatus('Tracking started; waiting for GPS or server connectivity.');
  }
}
