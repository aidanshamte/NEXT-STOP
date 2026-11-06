import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * True inside the Expo Go app. Expo Go cannot include NEXT STOP's own native
 * configuration, so background GPS, native Google sign-in and push notifications
 * are unavailable there; accounts, pickups, realtime updates, the map and
 * foreground GPS still work against the live backend.
 */
export const isExpoGo = Constants.executionEnvironment === 'storeClient';

export const expoGoLimits = {
  gps: 'Expo Go shares GPS only while NEXT STOP is open on screen. Keep the app in front and the phone unlocked; the installed app supports background tracking.',
  google: 'Google sign-in needs the installed NEXT STOP app. Use your email and password here.',
  push: 'Notifications need the installed NEXT STOP app. In Expo Go, keep the app open to see live updates.',
};

export const nativeAppOnly = isExpoGo || Platform.OS === 'web';
