import Constants from 'expo-constants';
export async function googleCredential(configuredClientId?: string) {
  if (Constants.executionEnvironment === 'storeClient')
    throw Error(
      'Google sign-in is available in the installed NEXT STOP app. You can use email in Expo Go.',
    );
  const webClientId = configuredClientId || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!webClientId) throw Error('Google sign-in is not available yet. Please continue with email.');
  const { GoogleSignin, isSuccessResponse } =
    await import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({ webClientId, iosClientId, offlineAccess: false });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await GoogleSignin.signIn();
  if (!isSuccessResponse(result)) return null;
  if (!result.data.idToken)
    throw Error('Google did not return a sign-in credential. Please try again.');
  return result.data.idToken;
}
