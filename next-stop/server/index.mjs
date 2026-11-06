import { networkInterfaces } from 'node:os';
import { createApp } from './app.mjs';
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 4000);
// In production the API listens on loopback only; Caddy terminates HTTPS/WSS in front of it.
const host = process.env.HOST || (production ? '127.0.0.1' : '0.0.0.0');
const origins = (
  process.env.ALLOWED_ORIGINS || (production ? '' : 'http://localhost:8081,http://localhost:19006')
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
// One JSON line per event, collected by journald on the server. Records never
// contain tokens, IP addresses, request bodies, query strings or coordinates.
const log = (record) => {
  const line = JSON.stringify({ time: new Date().toISOString(), ...record });
  if (record.level === 'error') console.error(line);
  else if (production || process.env.LOG_REQUESTS === '1') console.log(line);
};
let app;
try {
  app = createApp({
    dbPath: process.env.DATABASE_PATH || './data/next-stop.db',
    origins,
    trustProxy: process.env.TRUST_PROXY === '1',
    log,
  });
} catch (error) {
  console.error(`NEXT STOP API failed to start: ${error.message}`);
  process.exit(1);
}
const { server, db, realtime } = app;
server.listen(port, host, () => {
  if (
    !(process.env.ACS_EMAIL_ENDPOINT && process.env.ACS_EMAIL_SENDER) &&
    !(process.env.SMTP_HOST && process.env.SMTP_FROM)
  )
    console.warn(
      'Email verification needs ACS_EMAIL_ENDPOINT + ACS_EMAIL_SENDER or SMTP settings. No codes are faked or printed.',
    );
  if (!process.env.GOOGLE_WEB_CLIENT_ID && !process.env.GOOGLE_CLIENT_IDS)
    console.warn('Google sign-in needs Google OAuth client configuration.');
  if (production && process.env.TRUST_PROXY !== '1')
    console.warn('TRUST_PROXY is not 1: rate limits will treat all proxied users as one address.');
  console.log(`NEXT STOP API + WebSocket server listening on ${host}:${port}.`);
  if (!production)
    for (const interfaces of Object.values(networkInterfaces()))
      for (const item of interfaces || [])
        if (item.family === 'IPv4' && !item.internal)
          console.log(`Local network development address: http://${item.address}:${port}`);
  if (!db.prepare('SELECT id FROM institutions LIMIT 1').get())
    console.log(
      'No institutions yet. Run npm run setup -- --name "Your institution" --email "you@school.edu".',
    );
});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  realtime.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Do not hang a deploy if a client keeps a connection open.
  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 8000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
