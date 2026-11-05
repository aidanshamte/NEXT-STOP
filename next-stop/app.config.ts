import type { ExpoConfig, ConfigContext } from 'expo/config';
export default ({ config }: ConfigContext): ExpoConfig => {
  const allowLocalHttp = process.env.ALLOW_LOCAL_HTTP === '1';
  return {
    ...config,
    name: allowLocalHttp ? 'NEXT STOP Local' : 'NEXT STOP',
    slug: 'next-stop',
    scheme: 'nextstop',
    version: '0.2.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    icon: './assets/icon.png',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.nextstop.app',
      infoPlist: {
        NSLocalNetworkUsageDescription:
          'Connect to your institution’s NEXT STOP server on the local Wi-Fi network.',
        ...(allowLocalHttp ? { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } } : {}),
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
