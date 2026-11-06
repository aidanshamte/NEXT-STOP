import { useEffect, useState } from 'react';
/** Re-renders on an interval so "updated 20s ago" labels and stale states age on screen. */
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
