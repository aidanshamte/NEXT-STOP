import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { normalizeServerUrl } from '../network';
export let API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
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
  const saved =
    Platform.OS === 'web'
      ? globalThis.localStorage?.getItem('nextstop-server')
      : await SecureStore.getItemAsync('nextstop-server');
  if (saved) API_URL = normalizeServerUrl(saved);
  return API_URL;
}
export async function configureServer(value: string) {
  const next = normalizeServerUrl(value);
  if (
    Platform.OS !== 'web' &&
    next.startsWith('http:') &&
    !Constants.expoConfig?.extra?.allowLocalHttp
  )
    throw Error(
      'This build requires HTTPS. Install the local-network build to connect over local HTTP.',
    );
  if (API_URL !== next) await setToken(null);
  API_URL = next;
  if (Platform.OS === 'web') globalThis.localStorage?.setItem('nextstop-server', next);
  else await SecureStore.setItemAsync('nextstop-server', next);
}
export async function restoreToken() {
  if (Platform.OS !== 'web') sessionToken = await SecureStore.getItemAsync('nextstop-session');
  return sessionToken;
}
export function getToken() {
  return sessionToken;
}
export async function setToken(token: string | null) {
  sessionToken = token;
  if (Platform.OS !== 'web') {
    if (token)
      await SecureStore.setItemAsync('nextstop-session', token, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    else await SecureStore.deleteItemAsync('nextstop-session');
  }
}
export async function api<T = unknown>(path: string, body?: object): Promise<T> {
  if (!API_URL) throw Error('Connect to your local or hosted NEXT STOP server first.');
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw Error(
      'Cannot reach the server. Check Wi-Fi, the server address, firewall, and whether the computer is awake.',
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error('The server did not return NEXT STOP JSON. Check the address.');
  }
  if (!response.ok) throw new ApiError(result.error || 'Request failed.', response.status);
  return result as T;
}
