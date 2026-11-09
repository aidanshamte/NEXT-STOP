import type { ExpoConfig, ConfigContext } from 'expo/config';
import { existsSync } from 'node:fs';
// Permanent store identifiers, under the owner's GitHub Pages namespace (aidanshamte.github.io).
export const APP_ID = 'io.github.aidanshamte.nextstop';
// Installed builds that leave a developer's machine must reach the hosted HTTPS API.
// Fail the build instead of shipping an app that cannot connect.
export function requireHostedApi(profile: string | undefined, apiUrl: string | undefined) {
  if (profile !== 'preview' && profile !== 'production') return;
  const value = (apiUrl || '').trim();
  let ok = false;
  try {
    const url = new URL(value);
    ok = url.protocol === 'https:' && (url.pathname === '/' || url.pathname === '') && !url.search;
  } catch {
    ok = false;
  }
  if (!ok)
    throw new Error(
      `The "${profile}" build needs EXPO_PUBLIC_API_URL set to the hosted HTTPS API origin ` +
        '(for example https://nextstop-api.eastus.cloudapp.azure.com). See docs/DEPLOY-AZURE.md.',
    );
}
export default ({ config }: ConfigContext): ExpoConfig => {
  requireHostedApi(process.env.EAS_BUILD_PROFILE, process.env.EXPO_PUBLIC_API_URL);
  const allowLocalHttp = process.env.ALLOW_LOCAL_HTTP === '1';
  const iosGoogleId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const googleScheme =
    process.env.GOOGLE_IOS_URL_SCHEME ||
    (iosGoogleId?.endsWith('.apps.googleusercontent.com')
      ? 'com.googleusercontent.apps.' + iosGoogleId.replace('.apps.googleusercontent.com', '')
      : '');
  // Firebase app config for Android push (FCM). Not a secret per Expo/Firebase guidance;
  // EAS can also supply it as a file environment variable.
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ||
    (existsSync('./google-services.json') ? './google-services.json' : undefined);
  const googlePlugins: NonNullable<ExpoConfig['plugins']> = googleScheme
    ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleScheme }]]
    : [];
  return {
    ...config,
    name: allowLocalHttp ? 'NEXT STOP Local' : 'NEXT STOP',
    slug: 'next-stop',
    owner: 'aidanshamte',
    scheme: 'nextstop',
    version: '0.5.2',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    icon: './assets/icon.png',
    ios: {
      supportsTablet: true,
      bundleIdentifier: APP_ID,
      // HTTPS/TLS only: exempt from export-compliance encryption documentation.
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        // Local-network access is requested only by internal local-HTTP test builds.
        ...(allowLocalHttp
          ? {
              NSLocalNetworkUsageDescription:
                'Connect to your team’s NEXT STOP test server on the local Wi-Fi network.',
              NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
            }
          : {}),
      },
    },
    android: {
      package: APP_ID,
      versionCode: 4,
      // Inherited from libraries but unused; blocking them keeps privacy disclosures accurate.
      blockedPermissions: [
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
      ],
      // Approved artwork: coral N/location-pin on the logo's warm white.
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#FEFAF4' },
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    web: { favicon: './assets/favicon.png', name: 'NEXT STOP', shortName: 'NEXT STOP' },
    extra: {
      ...config.extra,
      allowLocalHttp,
      // Expo project (owner aidanshamte). Used by EAS Build and for push notification tokens.
      eas: { projectId: process.env.EAS_PROJECT_ID || 'dabf6a44-450a-41a8-9af4-4a4999c478d2' },
    },
    plugins: [
      ['./plugins/withLocalTransport.cjs', { allowLocalHttp }],
      ...googlePlugins,
      'expo-router',
      'expo-font',
      [
        'expo-splash-screen',
        { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#FEFAF4' },
      ],
      'expo-dev-client',
      'expo-secure-store',
      ['expo-build-properties', { android: { usesCleartextTraffic: allowLocalHttp } }],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'NEXT STOP uses driver location to share the shuttle position during an active trip.',
          locationAlwaysAndWhenInUsePermission:
            'Allow background location so authorized riders can see the shuttle while your screen is locked during service.',
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
          androidForegroundServiceIcon: './assets/location-notification.png',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/location-notification.png',
          color: '#EF543F',
          defaultChannel: 'trip-updates',
        },
      ],
      [
        // Administrators photograph stops. No microphone access is requested.
        'expo-image-picker',
        {
          photosPermission: 'Choose a photo of a shuttle stop to help riders recognise it.',
          cameraPermission: 'Take a photo of a shuttle stop to help riders recognise it.',
          microphonePermission: false,
        },
      ],
      [
        // Drivers scan rider pass QR codes. Audio is never recorded.
        'expo-camera',
        {
          cameraPermission: 'Scan a rider’s NEXT STOP pass when they board.',
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
    ],
  };
};
