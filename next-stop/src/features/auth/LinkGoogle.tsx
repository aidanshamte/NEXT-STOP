import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import GoogleButton from './GoogleButton';
import { api } from '../../services/api';
import { C } from '../../components/Brand';
import type { AuthOptions } from './types';
export default function LinkGoogle({
  linked,
  onLinked,
}: {
  linked: boolean;
  onLinked: () => Promise<void>;
}) {
  const [options, setOptions] = useState<AuthOptions | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api<AuthOptions>('/auth/options')
      .then((value) => {
        if (!active) return;
        setOptions(value);
        setFailed(false);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [attempt]);
  if (linked) return <Text style={{ color: C.green, fontSize: 12 }}>Google account connected</Text>;
  return (
    <View style={{ gap: 9 }}>
      <GoogleButton
        label="Connect your Google account"
        clientId={options?.googleWebClientId || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || ''}
        disabled={!options?.googleEnabled || busy}
        onCredential={async (idToken, challenge) => {
          setBusy(true);
          try {
            await api('/auth/google/link', {
              idToken,
              challenge,
              platform: Platform.OS === 'web' ? 'web' : 'native',
            });
            await onLinked();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        onError={setError}
      />
      {failed && (
        <Text accessibilityRole="alert" style={{ color: C.coral, fontSize: 12 }}>
          Couldn’t load Google settings.{' '}
          <Text
            accessibilityRole="button"
            onPress={() => setAttempt(attempt + 1)}
            style={{ fontWeight: '700', textDecorationLine: 'underline' }}
          >
            Try again
          </Text>
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: C.coral, fontSize: 12 }}>
          {error}
        </Text>
      )}
    </View>
  );
}
