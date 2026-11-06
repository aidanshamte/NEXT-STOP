import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { googleCredential } from '../../services/google';
export interface GoogleProps {
  clientId: string;
  disabled?: boolean;
  onCredential: (token: string, challenge?: string) => Promise<void>;
  onError: (message: string) => void;
  label?: string;
}
export default function GoogleButton({
  clientId,
  disabled,
  onCredential,
  onError,
  label = 'Continue with Google',
}: GoogleProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() =>
        void (async () => {
          try {
            const token = await googleCredential(clientId);
            if (token) await onCredential(token);
          } catch (e) {
            onError((e as Error).message);
          }
        })()
      }
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: C.line,
        borderRadius: 14,
        padding: 15,
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 12,
        backgroundColor: pressed ? '#F5F7F8' : 'white',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#4285F4', fontSize: 22, fontWeight: '800' }}>G</Text>
      </View>
      <Text style={{ color: C.navy, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
