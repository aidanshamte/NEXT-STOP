import React from 'react';
import { Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Icon, Tag, s } from '../../components/UI';
import { cancelReasonLabels } from '../../catalog';
import { ago, isOpen, nextStatus } from '../../domain';
import type { Assistance, RideRequest, Role, Trip } from '../../domain';
import OperatorAssistance from '../assistance/OperatorAssistance';
import { Progress } from '../student/RiderHome';
import { actionKey, statusLabels } from '../workspace/types';
import type { Mutate } from '../workspace/types';

const stages = ['requested', 'accepted', 'approaching', 'boarded', 'arrived'];
const actionLabel: Record<string, string> = {
  requested: 'Accept pickup',
  accepted: 'Approaching stop',
  approaching: 'Confirm boarding',
  boarded: 'Confirm drop-off',
};

export default function RequestList({
  role,
  requests,
  trips,
  stopName,
  busy,
  pending = '',
  mutate,
  now,
  assistance = [],
}: {
  /** Boarding assistance on open pickups (only for people allowed to see it). */
  assistance?: Assistance[];
  role: Role;
  requests: RideRequest[];
  trips: Trip[];
  stopName: (id: string) => string;
  busy: boolean;
  pending?: string;
  mutate: Mutate;
  now: number;
}) {
  const operator = role === 'driver' || role === 'admin';
  const open = requests.filter((r) => isOpen(r.status)).length;
  const helpFor = (r: RideRequest) => assistance.find((a) => a.request_id === r.id);
  const needsStaff = (r: RideRequest) => {
    const a = helpFor(r);
    return !!a && (!!a.attention || a.status === 'unable');
  };
  const staffCount = role === 'admin' ? requests.filter(needsStaff).length : 0;
  // Open journeys first (staff see those needing attention first), then recent closed ones.
  const ordered = requests
    .slice()
    .reverse()
    .sort(
      (a, b) =>
        Number(isOpen(b.status)) - Number(isOpen(a.status)) ||
        Number(staffCount > 0 && needsStaff(b)) - Number(staffCount > 0 && needsStaff(a)),
    );
  const change = (r: RideRequest, status: string, success: string, reason?: string) =>
    mutate('/requests/status', { requestId: r.id, status, ...(reason ? { reason } : {}) }, success);
  return (
    <Card>
      <View style={s.row}>
        <Text style={s.title}>
          {operator ? 'Pickup queue' : role === 'parent' ? 'Shared journeys' : 'Your journeys'}
        </Text>
        <Tag
          text={open ? `${open} open` : `${requests.length} total`}
          tone={open ? 'coral' : 'gray'}
        />
      </View>
      {staffCount > 0 && (
        <View style={[s.notice, { backgroundColor: '#FFF1EE' }]} accessibilityRole="alert">
          <Icon name="alert-circle-outline" color={C.coral} />
          <Text style={[s.body, { flex: 1, color: C.navy }]}>
            {staffCount} pickup{staffCount === 1 ? '' : 's'} with boarding assistance need
            {staffCount === 1 ? 's' : ''} staff attention.
          </Text>
        </View>
      )}
      {!requests.length ? (
        <View style={s.empty}>
          <Icon
            name={role === 'parent' ? 'shield-checkmark-outline' : 'ticket-outline'}
            color={C.muted}
            size={36}
          />
          <Text style={s.heading}>
            {role === 'parent' ? 'Sharing starts with permission.' : 'No journeys yet.'}
          </Text>
          <Text style={s.body}>
            {role === 'parent'
              ? 'A student must grant access to your approved parent account.'
              : 'Requests will appear here when a rider submits one.'}
          </Text>
        </View>
      ) : (
        ordered.map((r) => {
          const next = nextStatus(r.status);
          const inFlight = pending === actionKey('/requests/status', { requestId: r.id });
          return (
            <View style={s.request} key={r.id}>
              <View style={[s.row, { flexWrap: 'wrap' }]}>
                <Text style={s.heading}>{r.student_name}</Text>
                <Tag
                  text={statusLabels[r.status]}
                  tone={!isOpen(r.status) ? 'gray' : r.status === 'requested' ? 'coral' : 'green'}
                />
              </View>
              <Text style={s.body}>
                {stopName(r.stop_id)} → {stopName(r.destination_id)}
              </Text>
              {operator && isOpen(r.status) && helpFor(r) && (
                <OperatorAssistance
                  role={role}
                  request={r}
                  assistance={helpFor(r) as Assistance}
                  trip={trips.find((t) => t.id === r.trip_id)}
                  busy={busy}
                  pending={pending}
                  mutate={mutate}
                />
              )}
              <Text style={s.caption}>
                {trips.find((t) => t.id === r.trip_id)?.name || 'Assigned shuttle'} · updated{' '}
                {ago(r.updated_at || r.created_at, now)}
                {r.status === 'cancelled' && r.cancel_reason
                  ? ` · ${cancelReasonLabels[r.cancel_reason] || ''}`
                  : ''}
              </Text>
              {!operator && isOpen(r.status) && (
                <Progress status={r.status} observer={role === 'parent'} />
              )}
              {operator && isOpen(r.status) && (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {stages.map((stage, i) => (
                    <View
                      key={stage}
                      style={{
                        height: 4,
                        flex: 1,
                        borderRadius: 3,
                        backgroundColor: i <= stages.indexOf(r.status) ? C.coral : C.line,
                      }}
                    />
                  ))}
                </View>
              )}
              {operator && next && (
                <Button
                  large
                  disabled={busy}
                  loading={inFlight}
                  loadingLabel="Updating…"
                  label={actionLabel[r.status]}
                  onPress={() => change(r, next, 'Journey updated.')}
                />
              )}
              {operator && r.status === 'accepted' && (
                <Button
                  secondary
                  disabled={busy}
                  label="Rider boarded"
                  onPress={() => change(r, 'boarded', 'Boarding confirmed.')}
                />
              )}
              {operator && ['accepted', 'approaching'].includes(r.status) && (
                <Button
                  secondary
                  disabled={busy}
                  label="Rider not at the stop"
                  onPress={() => change(r, 'cancelled', 'Marked as not at the stop.', 'no_show')}
                />
              )}
              {['student', 'driver', 'admin'].includes(role) &&
                ['requested', 'accepted', 'approaching'].includes(r.status) && (
                  <Button
                    secondary
                    disabled={busy}
                    label="Cancel request"
                    onPress={() => change(r, 'cancelled', 'Request cancelled.')}
                  />
                )}
            </View>
          );
        })
      )}
    </Card>
  );
}
