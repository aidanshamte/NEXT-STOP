import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api, ApiError } from '../services/api';
import { subscribeToInstitution } from '../services/realtime';
import type { Snapshot } from '../domain';
interface State {
  scopeKey: string;
  snapshot: Snapshot | null;
  error: string;
  live: boolean;
  lastSync: number | null;
}
const empty: State = { scopeKey: '', snapshot: null, error: '', live: false, lastSync: null };
export function useLiveSnapshot(
  institutionId: string,
  enabled: boolean,
  onUnauthorized: () => void,
  sessionVersion: number,
) {
  const scopeKey = institutionId + ':' + sessionVersion;
  const [state, setState] = useState<State>(empty),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || !institutionId) return;
    let alive = true,
      running = false,
      dirty = false;
    const patch = (values: Partial<State>) => {
      if (alive)
        setState((previous) => ({
          ...(previous.scopeKey === scopeKey ? previous : { ...empty, scopeKey }),
          ...values,
        }));
    };
    const refresh = async () => {
      if (!alive) return;
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      try {
        const snapshot = await api<Snapshot>(
          '/snapshot?institutionId=' + encodeURIComponent(institutionId),
        );
        patch({ snapshot, lastSync: Date.now(), error: '' });
      } catch (e) {
        if (alive) {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) onUnauthorized();
          else patch({ error: (e as Error).message });
        }
      } finally {
        running = false;
        if (dirty && alive) {
          dirty = false;
          void refresh();
        }
      }
    };
    void refresh();
    const unsubscribe = subscribeToInstitution(
      institutionId,
      () => void refresh(),
      (live) => patch({ live }),
      onUnauthorized,
    );
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' || AppState.currentState == null) void refresh();
    }, 10000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      listener.remove();
      unsubscribe();
    };
  }, [institutionId, scopeKey, enabled, revision, onUnauthorized]);
  // A tenant switch never renders the prior tenant's snapshot, even for one frame.
  const visible = enabled && state.scopeKey === scopeKey ? state : empty;
  return { ...visible, refresh: () => setRevision((v) => v + 1) };
}
