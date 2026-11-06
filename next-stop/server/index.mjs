import { networkInterfaces } from 'node:os';
import { createApp } from './app.mjs';
const port = Number(process.env.PORT || 4000);
const { server, db, realtime } = createApp({
  dbPath: process.env.DATABASE_PATH || './data/next-stop.db',
  origins: (process.env.ALLOWED_ORIGINS || 'http://localhost:8081,http://localhost:19006').split(
    ',',
  ),
});
server.listen(port, '0.0.0.0', () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
    console.warn(
      'Email verification needs SMTP_HOST and SMTP_FROM in .env. No verification codes will be faked or printed.',
    );
  if (!process.env.GOOGLE_WEB_CLIENT_ID && !process.env.GOOGLE_CLIENT_IDS)
    console.warn('Google sign-in needs Google OAuth client configuration in .env.');
  console.log(`NEXT STOP API + WebSocket server listening on ${port}. Keep this computer awake.`);
  for (const interfaces of Object.values(networkInterfaces()))
    for (const item of interfaces || [])
      if (item.family === 'IPv4' && !item.internal)
        console.log(`On the same trusted Wi-Fi, enter http://${item.address}:${port} in the app.`);
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
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
