import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { api } from './api';
import { expoGoLimits, isExpoGo } from './runtime';

// Trip notifications through Expo Push Service (APNs on iOS, FCM on Android).
// Delivery is best effort: the in-app live view remains the source of truth.
export type PushState =
  | { status: 'enabled' }
  | { status: 'ask' } // permission not decided yet; the user can turn it on
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

let registeredToken: string | null = null;
let tokenListener: Notifications.EventSubscription | null = null;

if (Platform.OS !== 'web')
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

function unavailableReason(): string | null {
  if (Platform.OS === 'web') return 'Notifications are available in the installed app.';
  if (isExpoGo) return expoGoLimits.push;
  if (!(Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId))
    return 'Notifications are not configured in this build.';
  return null;
}

async function ensureChannel() {
  if (Platform.OS === 'android')
    // Android 13+ shows the permission prompt only after a channel exists.
    await Notifications.setNotificationChannelAsync('trip-updates', {
      name: 'Trip updates',
      description: 'Pickup accepted, shuttle approaching, boarding, arrival and delays',
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#EF543F',
    });
}

const granted = (p: Notifications.NotificationPermissionsStatus) =>
  p.granted ||
  p.ios?.status === IosAuthorizationStatus.PROVISIONAL ||
  p.ios?.status === IosAuthorizationStatus.AUTHORIZED;

async function sendToken(token: string) {
  await api('/push/register', { token, platform: Platform.OS });
  registeredToken = token;
}

/** Registers this device. With `prompt` false it never shows the system permission dialog. */
export async function enablePush({ prompt }: { prompt: boolean }): Promise<PushState> {
  const reason = unavailableReason();
  if (reason) return { status: 'unavailable', reason };
  await ensureChannel();
  let permission = await Notifications.getPermissionsAsync();
  if (!granted(permission)) {
    if (!prompt) return permission.canAskAgain ? { status: 'ask' } : { status: 'denied' };
    permission = await Notifications.requestPermissionsAsync();
    if (!granted(permission)) return { status: 'denied' };
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await sendToken(data);
  } catch {
    return {
      status: 'unavailable',
      reason: 'Could not reach the notification service. We will retry next time you open the app.',
    };
  }
  tokenListener?.remove();
  // Tokens can rotate; the old token stops working, so re-register immediately.
  tokenListener = Notifications.addPushTokenListener(() => {
    Notifications.getExpoPushTokenAsync({ projectId })
      .then(({ data }) => sendToken(data))
      .catch(() => {});
  });
  return { status: 'enabled' };
}

/** Called before sign-out while the session is still valid. Never blocks sign-out. */
export async function disablePush() {
  tokenListener?.remove();
  tokenListener = null;
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  try {
    await api('/push/unregister', { token });
  } catch {
    /* The server also drops this device's token when the session is signed out. */
  }
}

/** Runs `onOpen` when the user taps a notification (refresh the journey). */
export function onNotificationOpened(onOpen: () => void) {
  if (Platform.OS === 'web') return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener(() => onOpen());
  return () => sub.remove();
}
