import React from 'react';
import { Text, View } from 'react-native';
import { C } from '../../components/Brand';
import { Button, Card, Icon, Tag, s } from '../../components/UI';
import { nextStatus } from '../../domain';
import type { RideRequest, Role, Trip } from '../../domain';
import { statusLabels } from '../workspace/types';
import type { Mutate } from '../workspace/types';

const stages = ['requested', 'accepted', 'boarded', 'arrived'];

export default function RequestList({
  role,
  requests,
  trips,
  stopName,
  busy,
  mutate,
}: {
  role: Role;
  requests: RideRequest[];
  trips: Trip[];
  stopName: (id: string) => string;
  busy: boolean;
  mutate: Mutate;
}) {
  const operator = role === 'driver' || role === 'admin';
  return (
    <Card>
      <View style={s.row}>
        <Text style={s.title}>
          {operator ? 'Pickup queue' : role === 'parent' ? 'Shared journeys' : 'Your journeys'}
        </Text>
        <Tag text={`${requests.length} journeys`} tone="gray" />
      </View>
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
        requests
          .slice()
          .reverse()
          .map((r) => {
            const next = nextStatus(r.status);
            return (
              <View style={s.request} key={r.id}>
                <View style={[s.row, { flexWrap: 'wrap' }]}>
                  <Text style={s.heading}>{r.student_name}</Text>
                  <Tag
                    text={statusLabels[r.status]}
                    tone={r.status === 'cancelled' ? 'gray' : 'green'}
                  />
                </View>
                <Text style={s.body}>
                  {stopName(r.stop_id)} → {stopName(r.destination_id)}
                </Text>
                <Text style={s.caption}>
                  {trips.find((t) => t.id === r.trip_id)?.name || 'Assigned shuttle'}
                </Text>
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
                {operator && next && (
                  <Button
                    disabled={busy}
                    label={
                      r.status === 'requested'
                        ? 'Accept pickup'
                        : r.status === 'accepted'
                          ? 'Confirm boarding'
                          : 'Confirm drop-off'
                    }
                    onPress={() =>
                      mutate(
                        '/requests/status',
                        { requestId: r.id, status: next },
                        'Journey updated.',
                      )
                    }
                  />
                )}
                {['student', 'driver', 'admin'].includes(role) &&
                  ['requested', 'accepted'].includes(r.status) && (
                    <Button
                      secondary
                      disabled={busy}
                      label="Cancel request"
                      onPress={() =>
                        mutate(
                          '/requests/status',
                          { requestId: r.id, status: 'cancelled' },
                          'Request cancelled.',
                        )
                      }
                    />
                  )}
              </View>
            );
          })
      )}
    </Card>
  );
}
