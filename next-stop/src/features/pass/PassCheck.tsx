import React, { useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { C } from '../../components/Brand';
import { Button, Card, Field, Icon, s } from '../../components/UI';
import { api } from '../../services/api';
import type { Mutate } from '../workspace/types';

interface Result {
  valid: boolean;
  reason?: string;
  firstName?: string;
  repeat?: boolean;
  request?: { id: string; status: string; stop: string } | null;
}

/** Drivers check a rider pass by camera (installed app and Expo Go) or by typing its code. */
export default function PassCheck({
  org,
  busy,
  mutate,
}: {
  org: string;
  busy: boolean;
  mutate: Mutate;
}) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [checking, setChecking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);
  async function check(value: string) {
    if (checking) return;
    setChecking(true);
    try {
      setResult(await api<Result>('/pass/validate', { institutionId: org, code: value }));
    } catch (e) {
      setResult({ valid: false, reason: (e as Error).message });
    } finally {
      setChecking(false);
      setScanning(false);
    }
  }
  return (
    <Card>
      <Text style={s.heading}>Check a rider pass</Text>
      {scanning ? (
        <View style={{ height: 260, borderRadius: 18, overflow: 'hidden' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (handled.current) return;
              handled.current = true;
              void check(data);
            }}
          />
        </View>
      ) : (
        Platform.OS !== 'web' && (
          <Button
            large
            icon="scan-outline"
            label="Scan pass"
            disabled={busy || checking}
            onPress={async () => {
              const granted = permission?.granted || (await requestPermission()).granted;
              if (!granted) {
                setResult({ valid: false, reason: 'Camera access is off. Type the code instead.' });
                return;
              }
              handled.current = false;
              setResult(null);
              setScanning(true);
            }}
          />
        )
      )}
      {scanning && <Button secondary label="Stop scanning" onPress={() => setScanning(false)} />}
      <Field label="Or type the code (e.g. K7Q2M-482913)" value={code} onChange={setCode} />
      <Button
        secondary
        label="Check code"
        loading={checking}
        loadingLabel="Checking…"
        disabled={busy || !code.trim()}
        onPress={() => void check(code)}
      />
      {result && (
        <View
          accessibilityRole="alert"
          style={{
            padding: 16,
            borderRadius: 18,
            gap: 6,
            backgroundColor: result.valid ? C.mint : '#FFF0E9',
          }}
        >
          <View style={[s.row, { justifyContent: 'flex-start' }]}>
            <Icon
              name={result.valid ? 'checkmark-circle' : 'close-circle'}
              size={28}
              color={result.valid ? C.green : '#C2381F'}
            />
            <Text style={s.title}>
              {result.valid ? `Valid · ${result.firstName}` : 'Not valid'}
            </Text>
          </View>
          <Text style={[s.body, { color: C.navy }]}>
            {result.valid
              ? result.repeat
                ? 'Already checked on this shuttle in the last 2 minutes.'
                : 'Approved rider at your institution.'
              : result.reason}
          </Text>
          {result.valid && result.request && (
            <Button
              large
              label={`Confirm boarding at ${result.request.stop}`}
              disabled={busy}
              onPress={async () => {
                if (
                  await mutate(
                    '/requests/status',
                    { requestId: result.request?.id, status: 'boarded' },
                    'Boarding confirmed.',
                  )
                )
                  setResult(null);
              }}
            />
          )}
        </View>
      )}
    </Card>
  );
}
