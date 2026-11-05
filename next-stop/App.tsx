import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Brand, C, Mark } from './src/components/Brand';
import { Button, Card, Field, Icon, Tag, s } from './src/components/UI';
import type { IconName } from './src/components/UI';
import LiveMap from './src/components/LiveMap';
import {
  API_URL,
  api,
  configureServer,
  restoreServer,
  restoreToken,
  setToken,
} from './src/services/api';
import { currentTracking, startDriverGps, stopDriverGps } from './src/services/location';
import { trackingStatus } from './src/services/backgroundLocation';
import { useLiveSnapshot } from './src/hooks/useLiveSnapshot';
import { isOpen, locationState, nextStatus } from './src/domain';
import type { Institution, Role, RequestStatus } from './src/domain';
const roleLabels: Record<Role, string> = {
  student: 'Student',
  driver: 'Driver',
  parent: 'Parent',
  admin: 'Dispatch',
};
const statusLabels: Record<RequestStatus, string> = {
  requested: 'Pickup requested',
  accepted: 'Driver accepted',
  boarded: 'Onboard shuttle',
  arrived: 'Arrived',
  cancelled: 'Cancelled',
};
interface Me {
  user: { id: string; name: string; email: string };
  memberships: Institution[];
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Workspace />
    </SafeAreaProvider>
  );
}
function Workspace() {
  const desktop = useWindowDimensions().width > 1000;
  const router = useRouter();
  const { tab: param } = useLocalSearchParams<{ tab?: string }>();
  const tab = ['overview', 'journeys', 'updates', 'account'].includes(param || '')
    ? param
    : 'overview';
  const setTab = (value: string) => router.setParams({ tab: value });
  const [serverAddress, setServerAddress] = useState(''),
    [serverReady, setServerReady] = useState(false),
    [restoring, setRestoring] = useState(true);
  const [institutions, setInstitutions] = useState<Institution[]>([]),
    [org, setOrg] = useState(''),
    [me, setMe] = useState<Me | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [register, setRegister] = useState(false),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [joinRole, setJoinRole] = useState<Role>('student');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [tripId, setTripId] = useState(''),
    [pickup, setPickup] = useState(''),
    [destination, setDestination] = useState(''),
    [shareEmail, setShareEmail] = useState('');
  const [gps, setGps] = useState(false),
    [gpsText, setGpsText] = useState(''),
    [delay, setDelay] = useState('0'),
    [issue, setIssue] = useState('');
  const [stopLabel, setStopLabel] = useState(''),
    [latitude, setLatitude] = useState(''),
    [longitude, setLongitude] = useState('');
  const [vehicleName, setVehicleName] = useState(''),
    [capacity, setCapacity] = useState('24'),
    [driverId, setDriverId] = useState('');
  const unauthorized = useCallback(() => {
    void stopDriverGps();
    void setToken(null);
    setMe(null);
    setGps(false);
    setError('Your session or membership is no longer valid. Sign in again.');
  }, []);
  const {
    snapshot: data,
    error: syncError,
    live,
    lastSync,
    refresh,
  } = useLiveSnapshot(org, !!me, unauthorized, sessionVersion);
  const role = data?.role || 'student';
  const institutionsVisible = me?.memberships || institutions;
  const institution = institutionsVisible.find((i) => i.id === org);
  const request = data?.requests.find((r) => isOpen(r.status));
  const displayedTripId = role === 'student' && request ? request.trip_id : tripId;
  const trip = data?.trips.find((t) => t.id === displayedTripId) || data?.trips[0];
  const stopName = (id: string) => data?.stops.find((stop) => stop.id === id)?.name || 'Stop';
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const server = await restoreServer();
        if (!active) return;
        setServerAddress(server);
        if (!server) return;
        const health = await api<{ service: string }>('/health');
        if (health.service !== 'next-stop') throw Error('This address is not a NEXT STOP server.');
        const directory = await api<Institution[]>('/institutions');
        if (!active) return;
        setInstitutions(directory);
        setOrg(directory[0]?.id || '');
        setServerReady(true);
        if (await restoreToken()) {
          const user = await api<Me>('/me');
          if (active) {
            setSessionVersion((v) => v + 1);
            setMe(user);
            setOrg(user.memberships[0]?.id || '');
          }
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setRestoring(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!me) return;
    let active = true;
    const update = async () => {
      try {
        const context = await currentTracking();
        const status = await trackingStatus();
        if (active) {
          setGps(context?.institutionId === org && context?.tripId === trip?.id);
          if (status) setGpsText(status.message);
        }
      } catch {
        /* Native service availability is checked again when starting. */
      }
    };
    void update();
    const timer = setInterval(update, 5000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void update();
    });
    return () => {
      active = false;
      clearInterval(timer);
      listener.remove();
    };
  }, [me, org, trip?.id]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    await run(async () => {
      await stopDriverGps();
      await configureServer(serverAddress);
      setServerReady(false);
      setMe(null);
      const health = await api<{ service: string; protocol: number }>('/health');
      if (health.service !== 'next-stop' || health.protocol !== 2)
        throw Error('This address is not a compatible NEXT STOP server.');
      const directory = await api<Institution[]>('/institutions');
      setInstitutions(directory);
      setOrg(directory[0]?.id || '');
      setServerReady(true);
      setMessage('Server connected. Sign in or register with your institution.');
    });
  }
  async function authenticate() {
    await run(async () => {
      if (register && !org)
        throw Error('Create your institution on the server before registering.');
      const session = await api<{ token: string }>(register ? '/auth/register' : '/auth/login', {
        name,
        email,
        password,
        role: joinRole,
        institutionId: org,
      });
      await stopDriverGps();
      await setToken(session.token);
      const user = await api<Me>('/me');
      if (!user.memberships.length)
        throw Error('No institution membership found. Contact your operator.');
      setSessionVersion((v) => v + 1);
      setMe(user);
      setOrg(user.memberships.some((i) => i.id === org) ? org : user.memberships[0].id);
      setPassword('');
      setTab('overview');
    });
  }
  async function signOut() {
    await run(async () => {
      await stopDriverGps();
      try {
        await api('/auth/logout', {});
      } finally {
        await setToken(null);
        setMe(null);
        setGps(false);
        setPassword('');
        setMessage('Signed out. GPS sharing stopped.');
      }
    });
  }
  async function changeOrg(id: string) {
    if (id === org) return;
    await run(async () => {
      await stopDriverGps();
      setGps(false);
      setOrg(id);
      setPickup('');
      setDestination('');
      setTripId('');
    });
  }
  async function mutate(path: string, body: object, success: string) {
    await run(async () => {
      await api(path, { institutionId: org, ...body });
      if (path === '/trips/service' && (body as { active?: boolean }).active === false) {
        await stopDriverGps();
        setGps(false);
      }
      refresh();
      setMessage(success);
    });
  }
  async function toggleGps() {
    await run(async () => {
      if (gps) {
        await stopDriverGps();
        setGps(false);
        setGpsText('GPS sharing stopped.');
        return;
      }
      if (!trip?.active) throw Error('Start service before sharing GPS.');
      await startDriverGps(org, trip.id, setGpsText);
      setGps(true);
    });
  }
  const notices = (
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
          <Pressable accessibilityLabel="Dismiss message" onPress={() => setMessage('')}>
            <Icon name="close" size={16} />
          </Pressable>
        </View>
      )}
    </>
  );
  const chooser = (
    <View style={s.pills}>
      {institutionsVisible.map((i) => (
        <Pressable
          accessibilityRole="button"
          key={i.id}
          disabled={busy}
          onPress={() => void changeOrg(i.id)}
          style={[s.pill, org === i.id && s.pillActive]}
        >
          <Text style={[s.pillText, org === i.id && { color: 'white' }]}>{i.name}</Text>
        </Pressable>
      ))}
    </View>
  );
  if (!me)
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar style="dark" />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.welcome, { padding: desktop ? 50 : 22 }]}
        >
          <View style={s.row}>
            <Brand />
            <Tag text="REAL CONNECTIONS" />
          </View>
          <View style={[s.welcomeGrid, desktop && { flexDirection: 'row' }]}>
            <View style={{ flex: 1, gap: 22 }}>
              <Tag text="YOUR INSTITUTION. YOUR JOURNEY." />
              <Text style={[s.hero, { fontSize: desktop ? 64 : 45 }]}>
                Your next stop.{'\n'}
                <Text style={{ color: C.coral }}>In sight.</Text>
              </Text>
              <Text style={[s.body, { fontSize: 18, lineHeight: 29 }]}>
                Real shuttle locations. Actual pickup requests. One connected journey for your
                school or college.
              </Text>
              <Card>
                <Icon name="wifi-outline" size={30} color={C.green} />
                <Text style={s.heading}>Local works, too.</Text>
                <Text style={s.body}>
                  Connect your phones and the server computer to the same trusted Wi-Fi. Keep the
                  computer awake while the service is running.
                </Text>
                <Text style={s.caption}>
                  GPS sharing and pickup messages use your own server. Map tiles may still require
                  internet. A server is required to connect different phones.
                </Text>
              </Card>
              <Text style={s.caption}>No simulated buses, invented ETAs, or sample accounts.</Text>
            </View>
            <View style={{ flex: 1, maxWidth: 520, gap: 18 }}>
              {restoring ? (
                <ActivityIndicator color={C.coral} />
              ) : (
                <>
                  <Card>
                    <View style={s.row}>
                      <Text style={s.title}>Connect your server</Text>
                      <Icon name="server-outline" color={C.coral} />
                    </View>
                    <Field
                      label="NEXT STOP server address"
                      value={serverAddress}
                      onChange={setServerAddress}
                      placeholder="http://192.168.1.20:4000"
                      keyboardType="email-address"
                    />
                    <Text style={s.caption}>
                      Use the address printed by npm run api. On your phone, localhost refers to
                      your phone, not your computer.
                    </Text>
                    {serverAddress.startsWith('http:') && (
                      <Text style={[s.caption, { color: C.coral }]}>
                        Local HTTP is unencrypted. Use it only on a trusted test network; use HTTPS
                        beyond local testing.
                      </Text>
                    )}
                    <Button
                      label={
                        busy ? 'Connecting…' : serverReady ? 'Reconnect server' : 'Connect server'
                      }
                      icon="wifi-outline"
                      onPress={connect}
                      disabled={busy}
                    />
                  </Card>
                  {notices}
                  {serverReady && (
                    <Card>
                      <View style={s.row}>
                        <Text style={s.title}>
                          {register ? 'Join your institution' : 'Welcome back'}
                        </Text>
                        <Tag text="SERVER CONNECTED" />
                      </View>
                      {register && (
                        <>
                          <Text style={s.label}>INSTITUTION</Text>
                          {chooser}
                          {!institutions.length && (
                            <Text style={s.body}>
                              No institutions configured. Run npm run setup on the server, then
                              reconnect.
                            </Text>
                          )}
                          <Field label="Your name" value={name} onChange={setName} />
                          <View style={s.pills}>
                            {(['student', 'driver', 'parent'] as Role[]).map((r) => (
                              <Pressable
                                key={r}
                                onPress={() => setJoinRole(r)}
                                style={[s.pill, joinRole === r && s.pillActive]}
                              >
                                <Text style={[s.pillText, joinRole === r && { color: 'white' }]}>
                                  {roleLabels[r]}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                          <Text style={s.caption}>
                            Your institution must approve your membership before you can access
                            transport data. Parents also require student-authorized trip sharing.
                          </Text>
                        </>
                      )}
                      <Field
                        label="Email address"
                        value={email}
                        onChange={setEmail}
                        keyboardType="email-address"
                      />
                      <Field
                        label="Password"
                        value={password}
                        onChange={setPassword}
                        secure
                        placeholder={register ? 'At least 12 characters' : 'Your account password'}
                      />
                      <Button
                        label={busy ? 'Please wait…' : register ? 'Register account' : 'Sign in'}
                        disabled={busy || !serverReady}
                        onPress={authenticate}
                      />
                      <Button
                        secondary
                        label={register ? 'Already registered? Sign in' : 'Create an account'}
                        onPress={() => setRegister(!register)}
                      />
                    </Card>
                  )}
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  const tabs: [string, IconName, string][] = [
    ['overview', 'navigate-outline', role === 'driver' ? 'Drive' : 'Overview'],
    ['journeys', 'git-branch-outline', 'Journeys'],
    ['updates', 'notifications-outline', 'Updates'],
    ['account', 'person-circle-outline', 'Account'],
  ];
  const requestList = (
    <Card>
      <View style={s.row}>
        <Text style={s.title}>
          {role === 'driver' || role === 'admin'
            ? 'Pickup queue'
            : role === 'parent'
              ? 'Shared journeys'
              : 'Your journeys'}
        </Text>
        <Tag text={`${data?.requests.length || 0} journeys`} tone="gray" />
      </View>
      {!data?.requests.length ? (
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
        data.requests
          .slice()
          .reverse()
          .map((r) => (
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
                {data.trips.find((t) => t.id === r.trip_id)?.name || 'Assigned shuttle'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {['requested', 'accepted', 'boarded', 'arrived'].map((stage, i) => (
                  <View
                    key={stage}
                    style={{
                      height: 4,
                      flex: 1,
                      borderRadius: 3,
                      backgroundColor:
                        i <= ['requested', 'accepted', 'boarded', 'arrived'].indexOf(r.status)
                          ? C.coral
                          : C.line,
                    }}
                  />
                ))}
              </View>
              {(role === 'driver' || role === 'admin') && nextStatus(r.status) && (
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
                      { requestId: r.id, status: nextStatus(r.status) },
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
          ))
      )}
    </Card>
  );
  const map = (
    <Card style={{ padding: 16 }}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.heading}>{trip?.name || 'Shuttle location'}</Text>
          <Text style={s.caption}>
            {trip?.active ? 'Vehicle in service' : 'No active vehicle location'}
          </Text>
        </View>
        <Icon name="bus-outline" size={25} color={C.coral} />
      </View>
      <LiveMap stops={data?.stops || []} trip={trip} />
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        <Tag
          text={trip ? `GPS ${locationState(trip).toUpperCase()}` : 'NO SHARED VEHICLE'}
          tone={trip && locationState(trip) === 'live' ? 'green' : 'gray'}
        />
        <Text style={s.caption}>
          {trip?.updated_at
            ? `Last GPS ${new Date(trip.updated_at).toLocaleTimeString()}`
            : 'Waiting for a real driver GPS fix'}
        </Text>
      </View>
      <Text style={s.caption}>
        ETA calculation is not available yet. A GPS marker alone does not confirm a student is
        onboard.
      </Text>
    </Card>
  );
  const shuttleSelector = (
    <View style={s.pills}>
      {data?.trips.map((t) => (
        <Pressable
          key={t.id}
          disabled={busy}
          onPress={() =>
            t.id === trip?.id
              ? undefined
              : void run(async () => {
                  if (gps) await stopDriverGps();
                  setGps(false);
                  setTripId(t.id);
                })
          }
          style={[s.pill, trip?.id === t.id && s.pillActive]}
        >
          <Text style={[s.pillText, trip?.id === t.id && { color: 'white' }]}>
            {t.name}
            {t.active ? ' · In service' : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
  const studentControls = (
    <Card>
      <Text style={s.title}>Where are we headed?</Text>
      <Text style={s.label}>SHUTTLE</Text>
      {shuttleSelector}
      {!data?.trips.length && (
        <Text style={s.body}>Your institution has not assigned any shuttles yet.</Text>
      )}
      {!request ? (
        <>
          <Text style={s.label}>PICKUP STOP</Text>
          <View style={s.stopOptions}>
            {data?.stops.map((stop) => (
              <Pressable
                key={stop.id}
                onPress={() => {
                  setPickup(stop.id);
                  if (destination === stop.id) setDestination('');
                }}
                style={[
                  s.stopOption,
                  pickup === stop.id && { borderColor: C.coral, backgroundColor: '#FFF6F3' },
                ]}
              >
                <Icon
                  name={pickup === stop.id ? 'radio-button-on' : 'radio-button-off'}
                  color={pickup === stop.id ? C.coral : C.muted}
                  size={18}
                />
                <Text style={s.body}>{stop.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.label}>DESTINATION</Text>
          <View style={s.pills}>
            {data?.stops
              .filter((t) => t.id !== pickup)
              .map((stop) => (
                <Pressable
                  key={stop.id}
                  onPress={() => setDestination(stop.id)}
                  style={[s.pill, destination === stop.id && s.pillActive]}
                >
                  <Text style={[s.pillText, destination === stop.id && { color: 'white' }]}>
                    {stop.name}
                  </Text>
                </Pressable>
              ))}
          </View>
          <Button
            label="Request pickup"
            icon="hand-left-outline"
            disabled={busy || !trip?.active || !pickup || !destination}
            onPress={() =>
              mutate(
                '/requests',
                { tripId: trip?.id, stopId: pickup, destinationId: destination },
                'Pickup requested. Wait for the driver to accept.',
              )
            }
          />
          <Text style={s.caption}>
            Requests are confirmed only when the assigned driver accepts. Wait at the approved stop.
          </Text>
        </>
      ) : (
        <>
          <Tag text={statusLabels[request.status]} />
          <Text style={s.body}>
            {stopName(request.stop_id)} → {stopName(request.destination_id)}
          </Text>
          <Button secondary label="View your journey" onPress={() => setTab('journeys')} />
        </>
      )}
    </Card>
  );
  const driverControls = (
    <Card>
      <View style={s.row}>
        <Text style={s.title}>Driver workspace</Text>
        <Tag
          text={trip?.active ? 'IN SERVICE' : 'OFF DUTY'}
          tone={trip?.active ? 'green' : 'gray'}
        />
      </View>
      <Text style={s.body}>
        Use trip controls while parked. Start service, then enable driver tracking.
      </Text>
      {shuttleSelector}
      {trip ? (
        <>
          <Button
            secondary
            label={trip.active ? 'End service' : 'Start service'}
            disabled={busy}
            onPress={() =>
              mutate(
                '/trips/service',
                { tripId: trip.id, active: !trip.active },
                trip.active ? 'Service ended.' : 'Service started.',
              )
            }
          />
          <Button
            label={gps ? 'Stop sharing driver GPS' : 'Start driver GPS tracking'}
            icon="locate-outline"
            disabled={busy || !trip.active}
            onPress={toggleGps}
          />
          <Text style={s.caption}>
            {gpsText ||
              'The installed app requests background permission and shows a tracking indicator while sharing.'}
          </Text>
          <View style={s.divider} />
          <Text style={s.heading}>Keep riders informed</Text>
          <Field label="Delay in minutes (0–240)" value={delay} onChange={setDelay} />
          <Field label="Service update and rider instructions" value={issue} onChange={setIssue} />
          <Button
            secondary
            label="Publish service update"
            disabled={busy}
            onPress={() =>
              mutate(
                '/trips/issue',
                { tripId: trip.id, delayMinutes: Number(delay), issue },
                'Service update published.',
              )
            }
          />
        </>
      ) : (
        <Text style={s.body}>
          No vehicle assigned. Ask your institution administrator to assign your shuttle.
        </Text>
      )}
    </Card>
  );
  const dispatch = (
    <Card>
      <Text style={s.title}>Institution dispatch</Text>
      <Text style={s.body}>
        Verify identity, affiliation, and driver authorization before approval.
      </Text>
      {data?.members
        .filter((m) => !m.approved)
        .map((m) => (
          <View key={m.user_id} style={s.request}>
            <Text style={s.heading}>{m.name}</Text>
            <Text style={s.body}>
              {m.email} · {m.role}
            </Text>
            <Button
              secondary
              disabled={busy}
              label="Approve verified membership"
              onPress={() =>
                mutate('/members/approve', { userId: m.user_id }, 'Membership approved.')
              }
            />
          </View>
        ))}
      {!data?.members.some((m) => !m.approved) && <Tag text="No pending memberships" />}
      <View style={s.divider} />
      <Text style={s.heading}>Add an actual pickup stop</Text>
      <Field label="Stop name" value={stopLabel} onChange={setStopLabel} />
      <Field label="Latitude" value={latitude} onChange={setLatitude} />
      <Field label="Longitude" value={longitude} onChange={setLongitude} />
      <Button
        secondary
        label="Use my current GPS for this stop"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            const permission = await Location.requestForegroundPermissionsAsync();
            if (permission.status !== 'granted')
              throw Error('Grant location permission to capture this stop.');
            const point = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.High,
            });
            if (point.coords.accuracy == null || point.coords.accuracy > 100)
              throw Error(
                'GPS is not accurate enough. Move outdoors or enter verified coordinates.',
              );
            setLatitude(String(point.coords.latitude));
            setLongitude(String(point.coords.longitude));
          })
        }
      />
      <Button
        label="Add stop"
        disabled={busy || !stopLabel || !latitude || !longitude}
        onPress={() =>
          mutate(
            '/stops',
            { name: stopLabel, lat: Number(latitude), lng: Number(longitude) },
            'Stop added to your institution.',
          )
        }
      />
      <View style={s.divider} />
      <Text style={s.heading}>Assign a shuttle</Text>
      <Field label="Shuttle name or vehicle ID" value={vehicleName} onChange={setVehicleName} />
      <Field label="Passenger capacity" value={capacity} onChange={setCapacity} />
      <Text style={s.label}>APPROVED DRIVER</Text>
      <View style={s.pills}>
        {data?.members
          .filter((m) => m.role === 'driver' && m.approved)
          .map((m) => (
            <Pressable
              key={m.user_id}
              onPress={() => setDriverId(m.user_id)}
              style={[s.pill, driverId === m.user_id && s.pillActive]}
            >
              <Text style={[s.pillText, driverId === m.user_id && { color: 'white' }]}>
                {m.name}
              </Text>
            </Pressable>
          ))}
      </View>
      <Button
        label="Create assigned shuttle"
        disabled={busy || !driverId || !vehicleName}
        onPress={() =>
          mutate(
            '/trips',
            { name: vehicleName, driverId, capacity: Number(capacity) },
            'Shuttle assigned. The driver can now start service.',
          )
        }
      />
      <Text style={s.caption}>
        {data?.stops.length || 0} stops · {data?.trips.length || 0} shuttles
      </Text>
    </Card>
  );
  const account = (
    <Card>
      <Text style={s.title}>Your account</Text>
      <Text style={s.heading}>{me.user.name}</Text>
      <Text style={s.body}>{me.user.email}</Text>
      <Tag text={`${roleLabels[role]} · ${institution?.name || 'Institution'}`} tone="gray" />
      <Text style={s.caption}>Server: {API_URL}</Text>
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
          {data?.shares.map((share) => (
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
      <Button label="Stop GPS and sign out" secondary disabled={busy} onPress={signOut} />
    </Card>
  );
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {desktop && (
          <View style={s.sidebar}>
            <Brand />
            <View style={{ marginTop: 45, gap: 10 }}>
              {tabs.map(([id, icon, label]) => (
                <Pressable
                  key={id}
                  onPress={() => setTab(id)}
                  style={[s.sideLink, tab === id && { backgroundColor: C.navy }]}
                >
                  <Icon name={icon} color={tab === id ? 'white' : C.muted} />
                  <Text style={{ fontWeight: '600', color: tab === id ? 'white' : C.muted }}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flex: 1 }} />
            <View style={s.darkCard}>
              <Mark size={34} />
              <Text style={{ color: 'white', fontSize: 17, fontWeight: '700' }}>
                Every stop has a purpose.
              </Text>
            </View>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: desktop ? 32 : 20,
              paddingBottom: 110,
              maxWidth: 1350,
              width: '100%',
              alignSelf: 'center',
              gap: 20,
            }}
          >
            <View style={[s.row, { flexWrap: 'wrap', gap: 15 }]}>
              {desktop ? (
                <View>
                  <Text style={s.eyebrow}>YOUR CAMPUS. CONNECTED.</Text>
                  <Text style={s.heading}>{institution?.name}</Text>
                </View>
              ) : (
                <Brand />
              )}
              <Tag
                text={live ? 'LIVE CONNECTION' : 'RECONNECTING · RECOVERY REFRESH'}
                tone={live ? 'green' : 'coral'}
              />
            </View>
            {chooser}
            {notices}
            {syncError && (
              <View style={[s.notice, { backgroundColor: '#FFF0E9' }]}>
                <Icon name="cloud-offline-outline" color={C.coral} />
                <Text style={[s.body, { flex: 1 }]}>
                  {syncError} Showing last received data; locations may be stale.
                </Text>
              </View>
            )}
            <Text style={s.caption}>
              {lastSync
                ? `Last synchronized ${new Date(lastSync).toLocaleTimeString()}`
                : 'Connecting to your institution…'}{' '}
              ·{' '}
              {live
                ? 'Changes arrive over an authenticated live connection.'
                : 'Recovery refresh every 10 seconds while open.'}
            </Text>
            {!data ? (
              <ActivityIndicator color={C.coral} />
            ) : !data.approved ? (
              <Card>
                <Icon name="shield-outline" size={40} color={C.coral} />
                <Text style={s.title}>Your institution is reviewing your account.</Text>
                <Text style={s.body}>
                  An administrator must verify your membership. This screen updates when approval
                  arrives.
                </Text>
                <Button label="Sign out" secondary onPress={signOut} disabled={busy} />
              </Card>
            ) : tab === 'account' ? (
              account
            ) : tab === 'journeys' ? (
              requestList
            ) : tab === 'updates' ? (
              <Card>
                <Text style={s.title}>Service updates</Text>
                {data.trips
                  .filter((t) => t.issue || t.delay_minutes)
                  .map((t) => (
                    <View style={s.request} key={t.id}>
                      <Tag text={`DELAY · ${t.delay_minutes} MIN`} tone="coral" />
                      <Text style={s.heading}>{t.name}</Text>
                      <Text style={s.body}>
                        {t.issue || 'Wait at your approved stop and follow dispatch guidance.'}
                      </Text>
                    </View>
                  ))}
                {!data.trips.some((t) => t.issue || t.delay_minutes) && (
                  <Text style={s.body}>No reported disruptions.</Text>
                )}
              </Card>
            ) : (
              <>
                <View>
                  <Text style={s.eyebrow}>{roleLabels[role].toUpperCase()} WORKSPACE</Text>
                  <Text style={[s.pageTitle, { fontSize: desktop ? 36 : 28 }]}>
                    {role === 'student'
                      ? 'Where are we headed?'
                      : role === 'driver'
                        ? 'Make every stop count.'
                        : role === 'parent'
                          ? 'Close, even from afar.'
                          : 'Keep your campus moving.'}
                  </Text>
                </View>
                <View style={[s.contentGrid, desktop && { flexDirection: 'row' }]}>
                  <View style={{ flex: 1.4, gap: 20 }}>
                    {shuttleSelector}
                    {map}
                    {requestList}
                  </View>
                  <View style={{ flex: 1, gap: 20 }}>
                    {role === 'student' ? (
                      studentControls
                    ) : role === 'driver' ? (
                      driverControls
                    ) : role === 'admin' ? (
                      dispatch
                    ) : (
                      <Card>
                        <Icon name="heart-outline" size={30} color={C.coral} />
                        <Text style={s.title}>A journey you can follow.</Text>
                        <Text style={s.body}>
                          Driver-confirmed boarding and drop-off events appear here when the student
                          shares their journey. An arrival event does not verify a handover to a
                          guardian.
                        </Text>
                      </Card>
                    )}
                    <View style={s.darkCard}>
                      <Icon name="shield-checkmark-outline" size={25} color={C.mint} />
                      <Text
                        style={{ color: 'white', fontSize: 21, lineHeight: 29, fontWeight: '700' }}
                      >
                        Connected journeys.{'\n'}Thoughtful boundaries.
                      </Text>
                      <Text style={{ color: '#AEBBC7', fontSize: 12, lineHeight: 20 }}>
                        Institution-scoped access. Approved drivers. Student-controlled trip
                        sharing.
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            )}
            <Text style={[s.caption, { textAlign: 'center' }]}>
              No emergency dispatch or push notification delivery is connected.
            </Text>
          </ScrollView>
          {!desktop && (
            <View style={s.bottomNav}>
              {tabs.map(([id, icon, label]) => (
                <Pressable
                  key={id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === id }}
                  onPress={() => setTab(id)}
                  style={{ flex: 1, alignItems: 'center', gap: 5, padding: 9 }}
                >
                  <Icon name={icon} color={tab === id ? C.coral : C.muted} />
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '600',
                      color: tab === id ? C.coral : C.muted,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
