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
import { Brand, C, Mark } from './src/components/Brand';
import { Button, Card, Icon, StatusChip, s } from './src/components/UI';
import type { Tone } from './src/components/UI';
import { api, ApiError, restoreServer, restoreToken, setToken } from './src/services/api';
import { disablePush, enablePush, onNotificationOpened } from './src/services/push';
import type { PushState } from './src/services/push';
import { currentTracking, startDriverGps, stopDriverGps } from './src/services/location';
import { trackingStatus } from './src/services/backgroundLocation';
import { useLiveSnapshot } from './src/hooks/useLiveSnapshot';
import { useNow } from './src/hooks/useNow';
import AuthScreen from './src/features/auth/AuthScreen';
import JoinInstitution from './src/features/auth/JoinInstitution';
import AccountPanel from './src/features/account/AccountPanel';
import DispatchPanel from './src/features/dispatch/DispatchPanel';
import RoutesPanel from './src/features/dispatch/RoutesPanel';
import type { DispatchDraft } from './src/features/dispatch/DispatchPanel';
import DriverControls, { DriverUpdateForm } from './src/features/driver/DriverControls';
import RequestList from './src/features/journeys/RequestList';
import MapCard from './src/features/journeys/MapCard';
import RiderHome from './src/features/student/RiderHome';
import ServiceUpdates from './src/features/updates/ServiceUpdates';
import { BottomNav, Sidebar, tabIds, workspaceTabs } from './src/features/workspace/Navigation';
import type { Tab } from './src/features/workspace/Navigation';
import Notices from './src/features/workspace/Notices';
import { InstitutionChooser, ShuttleSelector } from './src/features/workspace/Pills';
import { actionKey, roleLabels } from './src/features/workspace/types';
import type { Me } from './src/features/workspace/types';
import { ago, connectionState, isOpen } from './src/domain';
import type { ConnectionState } from './src/domain';

function connectionLabel(state: ConnectionState, lastSync: number | null, now: number) {
  const since = lastSync ? ago(lastSync, now) : '';
  const map: Record<ConnectionState, [string, Tone]> = {
    connecting: ['Connecting…', 'gray'],
    live: [`Live · updated ${since}`, 'green'],
    reconnecting: [`Reconnecting · updated ${since}`, 'amber'],
    stale: [`Delayed · updated ${since}`, 'amber'],
    offline: [lastSync ? `Offline · data from ${since}` : 'Offline', 'coral'],
  };
  return map[state];
}

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
    // The one write in flight, so only the pressed control shows progress.
    [pending, setPending] = useState(''),
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
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pushDismissed, setPushDismissed] = useState(false);
  // True when a saved session exists but the server could not be reached at launch.
  const [offlineStart, setOfflineStart] = useState(false);
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
  const now = useNow(5000);
  const connection = connectionState({ live, lastSync, syncError }, now);
  const [connectionText, connectionTone] = connectionLabel(connection, lastSync, now);
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
  // Restores the saved session. Only a server rejection (401/403) discards it; a network
  // failure keeps the session so a rider opening the app without signal is not signed out.
  async function restore(isActive: () => boolean = () => true) {
    let hadToken = false;
    try {
      await prepareConnection();
      hadToken = !!(await restoreToken());
      if (hadToken) {
        const user = await api<Me>('/me');
        if (isActive()) {
          setSessionVersion((v) => v + 1);
          setMe(user);
          setOrg((current) =>
            user.memberships.some((m) => m.id === current)
              ? current
              : user.memberships[0]?.id || '',
          );
          setOfflineStart(false);
        }
      }
    } catch (e) {
      const rejected = e instanceof ApiError && (e.status === 401 || e.status === 403);
      if (rejected || !hadToken) {
        if (rejected) await setToken(null);
        if (isActive()) setStartupError((e as Error).message);
      } else if (isActive()) setOfflineStart(true);
    } finally {
      if (isActive()) setRestoring(false);
    }
  }
  useEffect(() => {
    let active = true;
    // State updates happen only after the network calls resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void restore(() => active);
    return () => {
      active = false;
    };
    // Runs once at launch; Try again calls restore() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Registers for trip notifications without prompting; the user opts in from a card.
  const approved = !!data?.approved;
  useEffect(() => {
    if (!me || !approved) return;
    let active = true;
    enablePush({ prompt: false })
      .then((state) => active && setPushState(state))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [me, approved, sessionVersion]);
  useEffect(() => onNotificationOpened(refresh), [refresh]);
  async function turnOnNotifications() {
    await run(async () => {
      const state = await enablePush({ prompt: true });
      setPushState(state);
      if (state.status === 'enabled') setMessage('Trip notifications are on for this device.');
      else if (state.status === 'denied')
        throw Error(
          'Notifications are blocked. Turn them on for NEXT STOP in your phone Settings.',
        );
      else if (state.status === 'unavailable') throw Error(state.reason);
    });
  }
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
  async function run(action: () => Promise<void>, key = '') {
    if (busy) return;
    setBusy(true);
    setPending(key);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPending('');
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
      await disablePush();
      setPushState(null);
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
      await disablePush();
      setPushState(null);
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
    await run(
      async () => {
        await api(path, { institutionId: org, ...body });
        if (path === '/trips/service' && (body as { active?: boolean }).active === false) {
          await stopDriverGps();
          setGps(false);
        }
        refresh();
        setMessage(success);
      },
      actionKey(path, body),
    );
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
    }, 'gps');
  }
  if (restoring)
    return (
      <SafeAreaView style={[s.safe, { alignItems: 'center', justifyContent: 'center', gap: 25 }]}>
        <Brand />
        <ActivityIndicator color={C.coral} />
      </SafeAreaView>
    );
  if (offlineStart && !me)
    return (
      <SafeAreaView
        style={[s.safe, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}
      >
        <Card style={{ maxWidth: 420, width: '100%', gap: 14 }}>
          <Brand />
          <Icon name="cloud-offline-outline" size={34} color={C.coral} />
          <Text style={s.title}>You’re offline</Text>
          <Text style={s.body}>
            NEXT STOP can’t reach the service right now. You’re still signed in. Check your mobile
            data or Wi-Fi, then try again.
          </Text>
          <Button
            label="Try again"
            icon="refresh"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                setRestoring(true);
                await restore();
              })
            }
          />
        </Card>
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
      pending={pending}
      mutate={mutate}
      now={now}
    />
  );
  const route = data?.routes?.find((r) => r.id === trip?.route_id);
  const mapCard = (
    <MapCard
      stops={stops}
      trip={trip}
      route={route}
      routeStops={data?.routeStops}
      highlight={
        // Only a parent follows one rider; operators see every stop equally.
        role === 'parent' && request
          ? { pickupId: request.stop_id, destinationId: request.destination_id }
          : {}
      }
      now={now}
    />
  );
  const overview =
    role === 'student' ? (
      <RiderHome
        stops={stops}
        routes={data?.routes || []}
        routeStops={data?.routeStops || []}
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
        pending={pending}
        mutate={mutate}
        now={now}
      />
    ) : role === 'driver' ? (
      <>
        <DriverControls
          trip={trip}
          trips={trips}
          shuttleSelector={shuttleSelector}
          gps={gps}
          gpsText={gpsText}
          onToggleGps={toggleGps}
          busy={busy}
          pending={pending}
          mutate={mutate}
          now={now}
        />
        {requestList}
        {trip && (
          <DriverUpdateForm
            trip={trip}
            delay={delay}
            setDelay={setDelay}
            issue={issue}
            setIssue={setIssue}
            busy={busy}
            pending={pending}
            mutate={mutate}
          />
        )}
        {mapCard}
      </>
    ) : role === 'admin' ? (
      <>
        {trips.length > 1 && shuttleSelector}
        {mapCard}
        {requestList}
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
        <RoutesPanel
          routes={data?.routes || []}
          routeStops={data?.routeStops || []}
          stops={stops}
          trips={trips}
          busy={busy}
          run={run}
          mutate={mutate}
        />
      </>
    ) : (
      <>
        {requestList}
        {trips.length > 1 && shuttleSelector}
        {mapCard}
        <Text style={s.caption}>
          You see a student’s journey only while they share it with you. Boarding and drop-off are
          confirmed by the driver; an arrival does not confirm a handover to a guardian.
        </Text>
      </>
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
              padding: desktop ? 32 : 16,
              paddingBottom: 110,
              maxWidth: desktop ? 760 : undefined,
              width: '100%',
              alignSelf: 'center',
              gap: 16,
            }}
          >
            <View style={[s.row, { gap: 12, justifyContent: 'flex-start' }]}>
              {!desktop && <Mark size={40} />}
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[s.heading, { fontSize: 17 }]} numberOfLines={2}>
                  {institution?.name || 'NEXT STOP'}
                </Text>
                <StatusChip text={connectionText} tone={connectionTone} />
              </View>
              <Text style={[s.eyebrow, { alignSelf: 'flex-start', marginTop: 4 }]}>
                {roleLabels[role].toUpperCase()}
              </Text>
            </View>
            {institutionsVisible.length > 1 && (
              <InstitutionChooser
                institutions={institutionsVisible}
                selectedId={org}
                busy={busy}
                onSelect={(id) => void changeOrg(id)}
              />
            )}
            <Notices
              error={error}
              message={message}
              syncError={syncError}
              onDismissMessage={() => setMessage('')}
            />
            {pushState?.status === 'ask' && !pushDismissed && (
              <Card style={{ gap: 12 }}>
                <View style={[s.row, { gap: 12, justifyContent: 'flex-start' }]}>
                  <Icon name="notifications-outline" size={24} color={C.coral} />
                  <Text style={[s.heading, { flex: 1 }]}>Get trip updates</Text>
                </View>
                <Text style={s.body}>
                  {role === 'driver'
                    ? 'Hear about new pickup requests and cancellations even when NEXT STOP is in the background.'
                    : role === 'admin'
                      ? 'Hear when your access changes. Operational review stays in this workspace.'
                      : 'Know when your pickup is accepted, the shuttle is approaching, and about reported delays. The live view here stays the most up-to-date source.'}
                </Text>
                <Button
                  label="Turn on notifications"
                  icon="notifications"
                  disabled={busy}
                  onPress={() => void turnOnNotifications()}
                />
                <Button
                  label="Not now"
                  secondary
                  disabled={busy}
                  onPress={() => setPushDismissed(true)}
                />
              </Card>
            )}
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
                pushState={pushState}
                onEnablePush={() => void turnOnNotifications()}
              />
            ) : tab === 'journeys' ? (
              requestList
            ) : tab === 'updates' ? (
              <ServiceUpdates trips={data.trips} />
            ) : (
              overview
            )}
            <Text style={[s.caption, { textAlign: 'center' }]}>Your ride. In sight.</Text>
          </ScrollView>
          {!desktop && <BottomNav tabs={tabs} tab={tab} onSelect={setTab} />}
        </View>
      </View>
    </SafeAreaView>
  );
}
