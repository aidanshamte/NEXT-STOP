import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';
import { C } from '../../components/Brand';
import { Button, Card, Icon, SectionLabel, StatusChip, s } from '../../components/UI';
import type { Snapshot } from '../../domain';
import { api } from '../../services/api';
import type { Mutate } from '../workspace/types';

interface PassCode {
  qr: string;
  code: string;
  firstName: string;
  expiresAt: number;
}

function QR({ value, size = 220 }: { value: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const dark: [number, number][] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark.push([r, c]);
    return { n, dark };
  }, [value]);
  const quiet = 4;
  const unit = size / (cells.n + quiet * 2);
  return (
    <Svg width={size} height={size} accessibilityLabel="Rider pass QR code">
      <Rect x={0} y={0} width={size} height={size} fill="white" />
      {cells.dark.map(([r, c]) => (
        <Rect
          key={`${r}-${c}`}
          x={(c + quiet) * unit}
          y={(r + quiet) * unit}
          width={unit + 0.3}
          height={unit + 0.3}
          fill={C.navy}
        />
      ))}
    </Svg>
  );
}

/** The rider's pass: a code that changes every 30 seconds, so a screenshot stops working. It
 * needs a connection to refresh. NFC and phone wallet passes are not available. */
export default function PassCard({
  org,
  data,
  institutionName,
  busy,
  mutate,
  now,
}: {
  org: string;
  data: Snapshot;
  institutionName?: string;
  busy: boolean;
  mutate: Mutate;
  now: number;
}) {
  const [code, setCode] = useState<{ key: string; value: PassCode } | null>(null);
  const [error, setError] = useState('');
  const short = data.pass?.short || '';
  const key = `${org}|${short}`;
  useEffect(() => {
    if (!short) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await api<PassCode>(`/pass/code?institutionId=${encodeURIComponent(org)}`);
        if (!active) return;
        setCode({ key: `${org}|${short}`, value });
        setError('');
        timer = setTimeout(load, Math.max(2000, value.expiresAt - Date.now() + 300));
      } catch (e) {
        if (!active) return;
        setError((e as Error).message);
        timer = setTimeout(load, 10000);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [org, short]);
  const current = code?.key === key && code.value.expiresAt > now - 60000 ? code.value : null;
  if (!data.safety?.passes_enabled)
    return (
      <Card>
        <Text style={s.title}>Rider pass</Text>
        <Text style={s.body}>Your institution does not use NEXT STOP passes.</Text>
      </Card>
    );
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ alignItems: 'center', gap: 12 }}>
        <SectionLabel>Rider pass</SectionLabel>
        <Text style={s.title}>{institutionName || 'Your institution'}</Text>
        {!short ? (
          <>
            <Text style={[s.body, { textAlign: 'center' }]}>
              Show this pass to your driver when you board. The code changes every 30 seconds and
              shows the driver your first name only.
            </Text>
            <Button
              large
              icon="qr-code-outline"
              label="Create my pass"
              disabled={busy}
              onPress={() => void mutate('/pass/issue', {}, 'Your pass is ready.')}
            />
          </>
        ) : current ? (
          <>
            <QR value={current.qr} />
            <Text
              style={[s.title, { letterSpacing: 2 }]}
              accessibilityLabel={`Code ${current.code.split('').join(' ')}`}
            >
              {current.code}
            </Text>
            <Text style={s.heading}>{current.firstName}</Text>
            <StatusChip
              text={`Live code · changes in ${Math.max(0, Math.ceil((current.expiresAt - now) / 1000))}s`}
              tone="green"
            />
          </>
        ) : (
          <StatusChip
            text={error ? `Can’t load your pass: ${error}` : 'Loading your pass…'}
            tone={error ? 'coral' : 'gray'}
          />
        )}
      </Card>
      {!!short && (
        <Card>
          <View style={[s.row, { justifyContent: 'flex-start', alignItems: 'flex-start' }]}>
            <Icon name="information-circle-outline" color={C.muted} />
            <Text style={[s.caption, { flex: 1 }]}>
              The pass needs a connection to refresh. Your driver checks it by scanning or typing
              the code. NFC tap and Apple or Google Wallet passes are not available yet.
            </Text>
          </View>
          <Button
            secondary
            icon="refresh"
            label="Replace my pass (lost or shared phone)"
            disabled={busy}
            onPress={async () => {
              if (await mutate('/pass/revoke', {}, 'Old pass cancelled.'))
                await mutate('/pass/issue', {}, 'New pass ready. The old one no longer works.');
            }}
          />
        </Card>
      )}
    </View>
  );
}
