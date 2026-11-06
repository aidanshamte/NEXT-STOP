import React from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Field, Tag, s } from '../../components/UI';
import LinkGoogle from '../auth/LinkGoogle';
import type { Role, Share } from '../../domain';
import { roleLabels } from '../workspace/types';
import type { Me, Mutate } from '../workspace/types';

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
}: {
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
}) {
  return (
    <Card>
      <Text style={s.title}>Your account</Text>
      <Text style={s.heading}>{me.user.name}</Text>
      <Text style={s.body}>{me.user.email}</Text>
      <Tag text={`${roleLabels[role]} · ${institutionName || 'Institution'}`} tone="gray" />
      <LinkGoogle linked={!!me.user.google_linked} onLinked={onGoogleLinked} />
      {role === 'student' && (
        <>
          <View style={s.divider} />
          <Text style={s.heading}>Your journey. Your choice.</Text>
          <Text style={s.body}>
            Allow an approved parent account in your institution to see your trip progress and the
            assigned shuttle after acceptance. Your phone location is not shared.
          </Text>
          <Field
            label="Approved parent account email"
            value={shareEmail}
            onChange={setShareEmail}
            keyboardType="email-address"
          />
          <Button
            label="Allow trip sharing"
            disabled={busy || !shareEmail}
            onPress={() => mutate('/shares', { email: shareEmail }, 'Trip sharing enabled.')}
          />
          {shares.map((share) => (
            <View key={share.parent_id} style={s.request}>
              <Text style={s.body}>{share.email}</Text>
              <Button
                secondary
                label="Revoke access"
                disabled={busy}
                onPress={() =>
                  mutate('/shares', { email: share.email, revoke: true }, 'Trip sharing revoked.')
                }
              />
            </View>
          ))}
        </>
      )}
      <Button label="Stop GPS and sign out" secondary disabled={busy} onPress={onSignOut} />
    </Card>
  );
}
