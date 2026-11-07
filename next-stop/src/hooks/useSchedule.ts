import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Schedule } from '../domain';

/** One day's published timetable. Timetables change rarely, so this loads on open, on a date
 * or institution change, every five minutes, and after an administrator edits it. */
export function useSchedule(org: string, date = '') {
  const [loaded, setLoaded] = useState<{ key: string; value: Schedule } | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const key = `${org}|${date}`;
  useEffect(() => {
    if (!org) return;
    let active = true;
    const load = () =>
      api<Schedule>(
        `/schedule?institutionId=${encodeURIComponent(org)}${date ? `&date=${date}` : ''}`,
      )
        .then((value) => {
          if (!active) return;
          setLoaded({ key: `${org}|${date}`, value });
          setError('');
        })
        .catch((e: Error) => active && setError(e.message));
    void load();
    const timer = setInterval(load, 300000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [org, date, version]);
  // Never show another institution's or another day's timetable while loading.
  return { schedule: loaded?.key === key ? loaded.value : null, error, reload };
}
