import { Redirect, useLocalSearchParams } from 'expo-router';

/** Unknown paths (old links, typos, refreshed deep links) open the app instead of a
 * dead end. Valid workspace tabs are kept; the app ignores anything else. */
export default function NotFound() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <Redirect href={tab ? { pathname: '/', params: { tab } } : '/'} />;
}
