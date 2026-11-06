import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Icon, s } from '../../components/UI';

export default function Notices({
  error,
  message,
  syncError,
  onDismissMessage,
}: {
  error: string;
  message: string;
  syncError: string;
  onDismissMessage: () => void;
}) {
  return (
    <>
      {error && (
        <View style={[s.notice, { backgroundColor: '#FFF0E9' }]}>
          <Icon name="alert-circle-outline" color={C.coral} />
          <Text accessibilityRole="alert" style={[s.body, { flex: 1, color: C.coral }]}>
            {error}
          </Text>
        </View>
      )}
      {message && (
        <View style={s.notice}>
          <Icon name="checkmark-circle-outline" color={C.green} />
          <Text accessibilityRole="alert" style={[s.body, { flex: 1, color: C.green }]}>
            {message}
          </Text>
          <Pressable accessibilityLabel="Dismiss message" onPress={onDismissMessage}>
            <Icon name="close" size={16} />
          </Pressable>
        </View>
      )}
      {syncError && (
        <View style={[s.notice, { backgroundColor: '#FFF0E9' }]}>
          <Icon name="cloud-offline-outline" color={C.coral} />
          <Text style={[s.body, { flex: 1 }]}>
            {syncError} Showing last received data; locations may be stale.
          </Text>
        </View>
      )}
    </>
  );
}
