import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, Field, Tag, s } from '../../components/UI';
import LinkGoogle from '../auth/LinkGoogle';

import type { Role, Share, Snapshot } from '../../domain';
import { roleLabels } from '../workspace/types';
import type { Me, Mutate } from '../workspace/types';
import type { PushState } from '../../services/push';

export default function AccountPanel({
  me,
  role,
  institutionName,
  shares,
  shareEmail,
  setShareEmail,
  busy,
  mutate,
  onGoogleLinked,
  onSignOut,
  onDeleteAccount,
  pushState,
  onEnablePush,
  sharedWithMe = [],
  hasOpenRequest = false,
}: {
  sharedWithMe?: NonNullable<Snapshot['sharedWithMe']>;
  hasOpenRequest?: boolean;
  me: Me;
  role: Role;
  institutionName?: string;
  shares: Share[];
  shareEmail: string;
  setShareEmail: (value: string) => void;
  busy: boolean;
  mutate: Mutate;
  onGoogleLinked: () => Promise<void>;
  onSignOut: () => void;
  onDeleteAccount: (confirmation: { password?: string; confirmEmail?: string }) => Promise<void>;
  pushState: PushState | null;
  onEnablePush: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [mode, setMode] = useState<'ongoing' | 'ride' | 'hours'>('ongoing');
  const [hours, setHours] = useState(8);
  const terms = (share: { expires_at?: number | null; request_id?: string | null }) =>
    share.request_id
      ? 'This ride only'
      : share.expires_at
        ? `Until ${new Date(share.expires_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
        : 'Until you stop sharing';
  const option = (id: string, label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={id}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      aria-checked={selected}
      onPress={onPress}
      style={[s.pill, selected && s.pillActive]}
    >
      <Text style={[s.pillText, selected && { color: 'white' }]}>{label}</Text>
    </Pressable>
  );
  const [confirmation, setConfirmation] = useState('');
  const passwordAccount = me.user.password_enabled !== 0;
  return (
    <Card>
      <Text style={s.title}>Your account</Text>
      <Text style={s.heading}>{me.user.name}</Text>
      <Text style={s.body}>{me.user.email}</Text>
      <Tag text={`${roleLabels[role]} · ${institutionName || 'Institution'}`} tone="gray" />
      <LinkGoogle linked={!!me.user.google_linked} onLinked={onGoogleLinked} />
      <View style={s.divider} />
      <Text style={s.heading}>Notifications on this device</Text>
      {pushState?.status === 'enabled' ? (
        <Tag text="On · trip updates" />
      ) : pushState?.status === 'denied' ? (
        <Text style={s.body}>
          Off. To receive trip updates, allow notifications for NEXT STOP in your phone Settings.
        </Text>
      ) : pushState?.status === 'unavailable' ? (
        <Text style={s.body}>{pushState.reason}</Text>
      ) : (
        <Button
          secondary
          icon="notifications-outline"
          label="Turn on notifications"
          disabled={busy}
          onPress={onEnablePush}
        />
      )}
      {role === 'student' && (
        <>
          <View style={s.divider} />
          <Text style={s.heading}>Your journey. Your choice.</Text>
          <Text style={s.body}>
            An approved parent account in your institution can see your pickup steps (requested,
            accepted, approaching, boarded, arrived) and your assigned shuttle on the map once a
            driver accepts. Your phone’s location is never shared. Stopping takes effect
            immediately.
          </Text>
          <Field
            label="Approved parent account email"
            value={shareEmail}
            onChange={setShareEmail}
            keyboardType="email-address"
          />
          <Text style={s.label}>FOR HOW LONG</Text>
          <View style={s.pills}>
            {option('ongoing', 'Until I stop', mode === 'ongoing', () => setMode('ongoing'))}
            {option('ride', 'This ride only', mode === 'ride', () => setMode('ride'))}
            {option('hours', 'For some hours', mode === 'hours', () => setMode('hours'))}
          </View>
          {mode === 'hours' && (
            <View style={s.pills}>
              {[2, 8, 24, 72].map((h) =>
                option(String(h), `${h} hours`, hours === h, () => setHours(h)),
              )}
            </View>
          )}
          {mode === 'ride' && !hasOpenRequest && (
            <Text style={s.caption}>Request a pickup first; sharing ends when that ride ends.</Text>
          )}
          <Button
            label="Share my journeys"
            disabled={busy || !shareEmail || (mode === 'ride' && !hasOpenRequest)}
            onPress={() =>
              mutate(
                '/shares',
                { email: shareEmail, mode, ...(mode === 'hours' ? { hours } : {}) },
                'Journey sharing on.',
              )
            }
          />
          {shares.map((share) => (
            <View key={share.parent_id} style={s.request}>
              <Text style={s.heading}>{share.email}</Text>
              <Text style={s.caption}>
                {terms(share)}
                {share.created_at
                  ? ` · since ${new Date(share.created_at).toLocaleDateString()}`
                  : ''}
              </Text>
              <Button
                secondary
                label="Stop sharing now"
                disabled={busy}
                onPress={() =>
                  mutate('/shares', { email: share.email, revoke: true }, 'Sharing stopped.')
                }
              />
            </View>
          ))}
          {shares.length > 1 && (
            <Button
              secondary
              label="Stop all sharing"
              disabled={busy}
              onPress={() => mutate('/shares/stop-all', {}, 'All sharing stopped.')}
            />
          )}
        </>
      )}
      {role === 'parent' && (
        <>
          <View style={s.divider} />
          <Text style={s.heading}>Students sharing with you</Text>
          {!sharedWithMe.length && (
            <Text style={s.body}>
              No one is sharing right now. A student shares from their own account using your email.
            </Text>
          )}
          {sharedWithMe.map((share) => (
            <View key={share.student_id} style={s.request}>
              <Text style={s.heading}>{share.name}</Text>
              <Text style={s.caption}>{terms(share)}</Text>
              <Button
                secondary
                label="Stop following"
                disabled={busy}
                onPress={() =>
                  mutate('/shares/leave', { studentId: share.student_id }, 'You stopped following.')
                }
              />
            </View>
          ))}
        </>
      )}
      <Button label="Stop GPS and sign out" secondary disabled={busy} onPress={onSignOut} />
      <View style={s.divider} />
      {!deleting ? (
        <Button
          secondary
          icon="trash-outline"
          label="Delete my account"
          disabled={busy}
          onPress={() => setDeleting(true)}
        />
      ) : (
        <>
          <Text style={s.heading}>Delete your account?</Text>
          <Text style={s.body}>
            This permanently removes your account, institution memberships, trip sharing and ride
            history from NEXT STOP. It cannot be undone. Drivers must end service first.
          </Text>
          <Field
            label={passwordAccount ? 'Current password' : 'Type your account email to confirm'}
            value={confirmation}
            onChange={setConfirmation}
            secure={passwordAccount}
            keyboardType={passwordAccount ? 'default' : 'email-address'}
          />
          <Button
            icon="trash-outline"
            label="Permanently delete account"
            disabled={busy || !confirmation}
            onPress={() =>
              void onDeleteAccount(
                passwordAccount ? { password: confirmation } : { confirmEmail: confirmation },
              )
            }
          />
          <Button
            secondary
            label="Keep my account"
            disabled={busy}
            onPress={() => {
              setDeleting(false);
              setConfirmation('');
            }}
          />
        </>
      )}
    </Card>
  );
}
