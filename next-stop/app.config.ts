import type { ExpoConfig, ConfigContext } from 'expo/config';
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
  const googlePlugins: NonNullable<ExpoConfig['plugins']> = googleScheme
    ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleScheme }]]
    : [];
  return {
    ...config,
    name: allowLocalHttp ? 'NEXT STOP Local' : 'NEXT STOP',
    slug: 'next-stop',
    scheme: 'nextstop',
    version: '0.3.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    icon: './assets/icon.png',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.nextstop.app',
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
      package: 'com.nextstop.app',
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#11243A' },
    },
    web: { favicon: './assets/favicon.png', name: 'NEXT STOP', shortName: 'NEXT STOP' },
    extra: {
      ...config.extra,
      allowLocalHttp,
      ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
    },
    plugins: [
      ['./plugins/withLocalTransport.cjs', { allowLocalHttp }],
      ...googlePlugins,
      'expo-router',
      'expo-font',
      'expo-splash-screen',
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
        'react-native-maps',
        { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY || '' },
      ],
    ],
  };
};
