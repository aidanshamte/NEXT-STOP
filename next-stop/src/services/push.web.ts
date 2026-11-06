// Web build: push notifications are not offered on the website (the installed app
// provides them), so the native notifications library is not loaded at all.
export type PushState =
  | { status: 'enabled' }
  | { status: 'ask' }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

const reason = 'Notifications are available in the installed NEXT STOP app.';

export async function enablePush(_options: { prompt: boolean }): Promise<PushState> {
  return { status: 'unavailable', reason };
}
export async function disablePush() {}
export function onNotificationOpened(_onOpen: () => void) {
  return () => {};
}
