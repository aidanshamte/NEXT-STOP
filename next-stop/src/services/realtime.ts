import { API_URL, getToken } from './api';
export function subscribeToInstitution(
  institutionId: string,
  onChange: () => void,
  onConnection: (connected: boolean) => void,
  onUnauthorized: () => void,
) {
  let socket: WebSocket | null = null,
    retry: ReturnType<typeof setTimeout> | null = null,
    closed = false,
    attempt = 0;
  const connect = () => {
    if (closed || !getToken()) return;
    socket = new WebSocket(API_URL.replace(/^http/, 'ws') + '/realtime');
    socket.onopen = () => {
      socket?.send(JSON.stringify({ type: 'subscribe', token: getToken(), institutionId }));
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'ready') {
          attempt = 0;
          onConnection(true);
          onChange();
        } else if (message.type === 'invalidate') onChange();
      } catch {
        /* Ignore unrecognized protocol messages. */
      }
    };
    socket.onerror = () => onConnection(false);
    socket.onclose = (event) => {
      onConnection(false);
      if (closed) return;
      if (event.code === 4001) {
        onUnauthorized();
        return;
      }
      retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(attempt++, 4)));
    };
  };
  connect();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    socket?.close();
  };
}
