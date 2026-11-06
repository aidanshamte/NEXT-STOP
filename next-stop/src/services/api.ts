import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { normalizeServerUrl, resolveApiOrigin, permitHttp } from '../network';
export let API_URL = '';
let sessionToken: string | null = null;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function restoreServer() {
  API_URL = resolveApiOrigin({
    configured: process.env.EXPO_PUBLIC_API_URL,
    development: __DEV__,
    hostUri: Constants.expoConfig?.hostUri,
    webOrigin:
      Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null,
  });
  if (API_URL) {
    const next = normalizeServerUrl(API_URL);
    if (
      next.startsWith('http:') &&
      !permitHttp({
        development: __DEV__,
        expoGo: Constants.executionEnvironment === 'storeClient',
        web: Platform.OS === 'web',
        localBuild: Constants.expoConfig?.extra?.allowLocalHttp === true,
      })
    )
      throw Error('Unable to connect securely. Please contact NEXT STOP support.');
  }
  return API_URL;
}
// Web keeps the session in sessionStorage: it survives page refreshes, ends when the tab
// closes, and is tied to the API origin. The site's Content-Security-Policy limits script
// sources. Native builds use the device keychain/keystore (SecureStore).
const WEB_SESSION = 'nextstop-session';
function webStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
export async function restoreToken() {
  if (Platform.OS === 'web') {
    try {
      const saved = JSON.parse(webStorage()?.getItem(WEB_SESSION) || 'null');
      sessionToken = saved && saved.origin === API_URL ? saved.token : null;
    } catch {
      sessionToken = null;
    }
    return sessionToken;
  }
  {
    const origin = await SecureStore.getItemAsync('nextstop-session-origin');
    if (origin !== API_URL) {
      await setToken(null);
      return null;
    }
    sessionToken = await SecureStore.getItemAsync('nextstop-session');
  }
  return sessionToken;
}
export function getToken() {
  return sessionToken;
}
export async function setToken(token: string | null) {
  sessionToken = token;
  if (Platform.OS === 'web') {
    try {
      if (token) webStorage()?.setItem(WEB_SESSION, JSON.stringify({ token, origin: API_URL }));
      else webStorage()?.removeItem(WEB_SESSION);
    } catch {
      /* Storage unavailable (private mode): the session lasts until the page reloads. */
    }
  }
  if (Platform.OS !== 'web') {
    if (token) {
      const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
      await SecureStore.setItemAsync('nextstop-session', token, options);
      await SecureStore.setItemAsync('nextstop-session-origin', API_URL, options);
    } else {
      await SecureStore.deleteItemAsync('nextstop-session');
      await SecureStore.deleteItemAsync('nextstop-session-origin');
    }
  }
}
export async function api<T = unknown>(path: string, body?: object): Promise<T> {
  if (!API_URL) throw Error('NEXT STOP is not available right now. Please try again shortly.');
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw Error('We couldn’t connect. Check your internet connection and try again.');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    console.warn('NEXT STOP received a non-JSON API response; check EXPO_PUBLIC_API_URL.');
    throw Error('NEXT STOP is temporarily unavailable. Please try again shortly.');
  }
  if (!response.ok)
    throw new ApiError(result.error || 'Something went wrong. Please try again.', response.status);
  return result as T;
}
