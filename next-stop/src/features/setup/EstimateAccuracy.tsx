import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Card, s } from '../../components/UI';
import { api } from '../../services/api';

interface Accuracy {
  days: number;
  checks: number;
  within: number;
  medianError: number | null;
  pending: number;
  routes: {
    routeId: string;
    name: string;
    checks: number;
    within: number;
    medianError: number | null;
  }[];
}

/** Below this many measured arrivals a percentage says little; it is shown as a count only. */
export const MIN_CHECKS = 30;
const minutes = (sec: number | null) => (sec == null ? '–' : `${Math.round(sec / 6) / 10} min`);

/** How the arrival estimates riders saw compared with when shuttles really arrived. */
export default function EstimateAccuracy({ org }: { org: string }) {
  const [data, setData] = useState<{ org: string; value: Accuracy } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () =>
      api<Accuracy>(`/estimates/accuracy?institutionId=${encodeURIComponent(org)}`)
        .then((value) => {
          if (!active) return;
          setData({ org, value });
          setError('');
        })
        .catch((e: Error) => active && setError(e.message));
    void load();
    const timer = setInterval(load, 300000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [org]);
  const value = data?.org === org ? data.value : null;
  return (
    <Card>
      <Text style={s.title}>Arrival estimate accuracy</Text>
      <Text style={s.body}>
        Measured on real service: each estimate shown when a shuttle passes a confirmed stop is
        compared with when it actually reached the next stops.
      </Text>
      {!!error && <Text style={s.caption}>Could not load: {error}</Text>}
      {value && value.checks === 0 && (
        <Text style={s.body}>
          No measured arrivals yet
          {value.pending ? ` (${value.pending} waiting for the shuttle)` : ''}. Estimates must not
          be described as accurate until real trips have been measured.
        </Text>
      )}
      {value && value.checks > 0 && (
        <>
          <Text style={s.heading}>
            {value.checks} measured {value.checks === 1 ? 'arrival' : 'arrivals'} in the last{' '}
            {value.days} days
          </Text>
          <Text style={s.body}>
            {value.checks >= MIN_CHECKS
              ? `${Math.round((100 * value.within) / value.checks)}% arrived within the range shown. Typical error ${minutes(value.medianError)}.`
              : `${value.within} of ${value.checks} arrived within the range shown. Too few to judge accuracy yet (${MIN_CHECKS} needed).`}
          </Text>
          {value.routes.map((r) => (
            <View key={r.routeId} style={s.request}>
              <Text style={s.heading}>{r.name}</Text>
              <Text style={s.caption}>
                {r.within} of {r.checks} within range · typical error {minutes(r.medianError)}
              </Text>
            </View>
          ))}
        </>
      )}
    </Card>
  );
}
