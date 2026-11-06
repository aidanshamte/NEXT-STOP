import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Brand, C } from './src/components/Brand';
import { Button, Card, Icon, Tag, s } from './src/components/UI';
import { api, restoreServer, restoreToken, setToken } from './src/services/api';
import { currentTracking, startDriverGps, stopDriverGps } from './src/services/location';
import { trackingStatus } from './src/services/backgroundLocation';
import { useLiveSnapshot } from './src/hooks/useLiveSnapshot';
import AuthScreen from './src/features/auth/AuthScreen';
import JoinInstitution from './src/features/auth/JoinInstitution';
import AccountPanel from './src/features/account/AccountPanel';
import DispatchPanel from './src/features/dispatch/DispatchPanel';
import type { DispatchDraft } from './src/features/dispatch/DispatchPanel';
import DriverControls from './src/features/driver/DriverControls';
import RequestList from './src/features/journeys/RequestList';
import ShuttleMapCard from './src/features/journeys/ShuttleMapCard';
import StudentControls from './src/features/student/StudentControls';
import ServiceUpdates from './src/features/updates/ServiceUpdates';
import { BottomNav, Sidebar, tabIds, workspaceTabs } from './src/features/workspace/Navigation';
import type { Tab } from './src/features/workspace/Navigation';
import Notices from './src/features/workspace/Notices';
import { InstitutionChooser, ShuttleSelector } from './src/features/workspace/Pills';
import { roleLabels } from './src/features/workspace/types';
import type { Me } from './src/features/workspace/types';
import { isOpen } from './src/domain';

const emptyDispatchDraft: DispatchDraft = {
  stopLabel: '',
  latitude: '',
  longitude: '',
  vehicleName: '',
  capacity: '24',
  driverId: '',
};

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
  const tab: Tab = tabIds.includes(param as Tab) ? (param as Tab) : 'overview';
  const setTab = (value: Tab) => router.setParams({ tab: value });
  const [restoring, setRestoring] = useState(true);
  const [startupError, setStartupError] = useState('');
  const [org, setOrg] = useState('');
  const [me, setMe] = useState<Me | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
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
  const [dispatchDraft, setDispatchDraft] = useState(emptyDispatchDraft);
  const updateDispatchDraft = (change: Partial<DispatchDraft>) =>
    setDispatchDraft((draft) => ({ ...draft, ...change }));
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
  const institutionsVisible = me?.memberships || [];
  const institution = institutionsVisible.find((i) => i.id === org);
  const request = data?.requests.find((r) => isOpen(r.status));
  const displayedTripId = role === 'student' && request ? request.trip_id : tripId;
  const trip = data?.trips.find((t) => t.id === displayedTripId) || data?.trips[0];
  const stopName = (id: string) => data?.stops.find((stop) => stop.id === id)?.name || 'Stop';
  async function prepareConnection() {
    const server = await restoreServer();
    if (!server) {
      console.warn('NEXT STOP: set EXPO_PUBLIC_API_URL for installed/production builds.');
      throw Error('NEXT STOP is not available right now. Please try again shortly.');
    }
    const context = await currentTracking();
    if (context && context.serverUrl !== server) await stopDriverGps();
    const health = await api<{ service: string; protocol: number }>('/health');
    if (health.service !== 'next-stop' || health.protocol !== 3)
      throw Error('NEXT STOP is temporarily unavailable. Please try again shortly.');
    setStartupError('');
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await prepareConnection();
        if (await restoreToken()) {
          const user = await api<Me>('/me');
          if (active) {
            setSessionVersion((v) => v + 1);
            setMe(user);
            setOrg(user.memberships[0]?.id || '');
          }
        }
      } catch (e) {
        await setToken(null);
        if (active) setStartupError((e as Error).message);
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
  async function authenticated(token: string) {
    setError('');
    setMessage('');
    setStartupError('');
    setTripId('');
    setPickup('');
    setDestination('');
    setShareEmail('');
    setGpsText('');
    setIssue('');
    setDelay('0');
    await stopDriverGps();
    await setToken(token);
    const user = await api<Me>('/me');
    setSessionVersion((v) => v + 1);
    setMe(user);
    setOrg(user.memberships[0]?.id || '');
    setTab('overview');
  }
  async function joined() {
    const user = await api<Me>('/me');
    setSessionVersion((v) => v + 1);
    setMe(user);
    setOrg(user.memberships[0]?.id || '');
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
        setMessage('Signed out. GPS sharing stopped.');
      }
    });
  }
  async function deleteAccount(confirmation: { password?: string; confirmEmail?: string }) {
    await run(async () => {
      // Stop GPS before the session disappears so no upload outlives the account.
      await stopDriverGps();
      await api('/account/delete', confirmation);
      await setToken(null);
      setMe(null);
      setGps(false);
      setMessage('Your account and its NEXT STOP data were deleted.');
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
  async function changeTrip(id: string) {
    await run(async () => {
      if (gps) await stopDriverGps();
      setGps(false);
      setTripId(id);
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
  if (restoring)
    return (
      <SafeAreaView style={[s.safe, { alignItems: 'center', justifyContent: 'center', gap: 25 }]}>
        <Brand />
        <ActivityIndicator color={C.coral} />
      </SafeAreaView>
    );
  if (!me)
    return (
      <AuthScreen
        onAuthenticated={authenticated}
        initialError={startupError || error}
        onRetry={prepareConnection}
      />
    );
  if (!me.memberships.length)
    return <JoinInstitution name={me.user.name} onJoined={joined} onSignOut={signOut} />;
  const tabs = workspaceTabs(role);
  const trips = data?.trips || [];
  const stops = data?.stops || [];
  const shuttleSelector = (
    <ShuttleSelector
      trips={trips}
      selectedId={trip?.id}
      busy={busy}
      onSelect={(id) => void changeTrip(id)}
    />
  );
  const requestList = (
    <RequestList
      role={role}
      requests={data?.requests || []}
      trips={trips}
      stopName={stopName}
      busy={busy}
      mutate={mutate}
    />
  );
  const roleControls =
    role === 'student' ? (
      <StudentControls
        stops={stops}
        trips={trips}
        trip={trip}
        request={request}
        shuttleSelector={shuttleSelector}
        pickup={pickup}
        setPickup={setPickup}
        destination={destination}
        setDestination={setDestination}
        stopName={stopName}
        busy={busy}
        mutate={mutate}
        onViewJourney={() => setTab('journeys')}
      />
    ) : role === 'driver' ? (
      <DriverControls
        trip={trip}
        shuttleSelector={shuttleSelector}
        gps={gps}
        gpsText={gpsText}
        onToggleGps={toggleGps}
        delay={delay}
        setDelay={setDelay}
        issue={issue}
        setIssue={setIssue}
        busy={busy}
        mutate={mutate}
      />
    ) : role === 'admin' ? (
      <DispatchPanel
        members={data?.members || []}
        trips={trips}
        selfId={me.user.id}
        stopCount={stops.length}
        tripCount={trips.length}
        draft={dispatchDraft}
        setDraft={updateDispatchDraft}
        busy={busy}
        run={run}
        mutate={mutate}
      />
    ) : (
      <Card>
        <Icon name="heart-outline" size={30} color={C.coral} />
        <Text style={s.title}>A journey you can follow.</Text>
        <Text style={s.body}>
          Driver-confirmed boarding and drop-off events appear here when the student shares their
          journey. An arrival event does not verify a handover to a guardian.
        </Text>
      </Card>
    );
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {desktop && <Sidebar tabs={tabs} tab={tab} onSelect={setTab} />}
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
            <InstitutionChooser
              institutions={institutionsVisible}
              selectedId={org}
              busy={busy}
              onSelect={(id) => void changeOrg(id)}
            />
            <Notices
              error={error}
              message={message}
              syncError={syncError}
              onDismissMessage={() => setMessage('')}
            />
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
              <AccountPanel
                me={me}
                role={role}
                institutionName={institution?.name}
                shares={data.shares}
                shareEmail={shareEmail}
                setShareEmail={setShareEmail}
                busy={busy}
                mutate={mutate}
                onGoogleLinked={async () => {
                  setMe(await api<Me>('/me'));
                  setMessage('Google account connected.');
                }}
                onSignOut={signOut}
                onDeleteAccount={deleteAccount}
              />
            ) : tab === 'journeys' ? (
              requestList
            ) : tab === 'updates' ? (
              <ServiceUpdates trips={data.trips} />
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
                  {/* Flex weights size the side-by-side desktop columns; stacked on phones they would stretch height. */}
                  <View style={[{ gap: 20 }, desktop && { flex: 1.4 }]}>
                    {shuttleSelector}
                    <ShuttleMapCard stops={stops} trip={trip} />
                    {requestList}
                  </View>
                  <View style={[{ gap: 20 }, desktop && { flex: 1 }]}>
                    {roleControls}
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
            <Text style={[s.caption, { textAlign: 'center' }]}>Your ride. In sight.</Text>
          </ScrollView>
          {!desktop && <BottomNav tabs={tabs} tab={tab} onSelect={setTab} />}
        </View>
      </View>
    </SafeAreaView>
  );
}
