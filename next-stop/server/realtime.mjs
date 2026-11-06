import { WebSocketServer, WebSocket } from 'ws';
import { tokenHash } from './security.mjs';
export function attachRealtime(server, db, origins) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const authorize = (token, org) => {
    if (typeof token !== 'string' || typeof org !== 'string') return null;
    return db
      .prepare(
        `SELECT m.user_id FROM sessions s JOIN memberships m ON m.user_id=s.user_id JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND m.institution_id=? AND u.email_verified=1`,
      )
      .get(tokenHash(token), Date.now(), org);
  };
  const valid = (socket) => authorize(socket.authToken, socket.institutionId);
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.authenticated) continue;
      if (!valid(socket)) {
        socket.close(4001, 'Session expired or membership removed');
        continue;
      }
      if (socket.alive === false) {
        socket.terminate();
        continue;
      }
      socket.alive = false;
      socket.ping();
    }
  }, 20000);
  heartbeat.unref();
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (
      pathname !== '/realtime' ||
      (req.headers.origin &&
        !origins.includes(req.headers.origin) &&
        ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin))
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (socket) => {
    socket.alive = true;
    socket.on('pong', () => {
      socket.alive = true;
    });
    const deadline = setTimeout(() => {
      if (!socket.authenticated) socket.close(4001, 'Authentication required');
    }, 5000);
    deadline.unref();
    socket.on('error', () => {});
    socket.on('message', (raw) => {
      try {
        if (socket.authenticated) {
          socket.close(4000, 'Already subscribed');
          return;
        }
        const input = JSON.parse(raw.toString());
        if (input.type !== 'subscribe' || !authorize(input.token, input.institutionId)) {
          socket.close(4001, 'Not authorized');
          return;
        }
        socket.authToken = input.token;
        socket.institutionId = input.institutionId;
        socket.authenticated = true;
        clearTimeout(deadline);
        socket.send(JSON.stringify({ type: 'ready' }));
      } catch {
        socket.close(4000, 'Invalid message');
      }
    });
    socket.on('close', () => clearTimeout(deadline));
  });
  return {
    invalidate(org) {
      for (const socket of wss.clients) {
        if (socket.institutionId !== org || socket.readyState !== WebSocket.OPEN) continue;
        if (!valid(socket)) {
          socket.close(4001, 'Session no longer valid');
          continue;
        }
        // No coordinates, student names, request IDs, or tokens travel in this event.
        socket.send(JSON.stringify({ type: 'invalidate' }));
      }
    },
    close() {
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      wss.close();
    },
  };
}
