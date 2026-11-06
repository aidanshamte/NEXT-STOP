// Post-deployment check of the web testing version and the mobile API hostname.
//   node scripts/verify-web.mjs [https://nextstop.software] [https://<azure-host>]
// Read-only: creates no accounts and changes no data.
import dns from 'node:dns/promises';
import tls from 'node:tls';
import { WebSocket } from 'ws';

const web = new URL(process.argv[2] || 'https://nextstop.software');
const mobile = new URL(process.argv[3] || 'https://nextstop-api.northcentralus.cloudapp.azure.com');
const EXPECTED_IP = process.env.EXPECTED_IP || '52.159.95.124';
const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push(['PASS', name, detail || '']);
  } catch (error) {
    results.push(['FAIL', name, error.message]);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw Error(msg);
};

const certificate = (host) =>
  new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host }, () => {
      const cert = socket.getPeerCertificate();
      const authorized = socket.authorized;
      socket.end();
      resolve({ cert, authorized, error: socket.authorizationError });
    });
    socket.on('error', reject);
    socket.setTimeout(10000, () => reject(Error('TLS timeout')));
  });

const wsClose = (url, origin) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: origin ? { Origin: origin } : {} });
    ws.on('open', () =>
      ws.send(JSON.stringify({ type: 'subscribe', token: 'invalid', institutionId: 'x' })),
    );
    ws.on('close', (code) => resolve(code));
    ws.on('error', (e) => reject(e));
    setTimeout(() => reject(Error('WebSocket timeout')), 10000);
  });

await check('DNS: apex resolves to the Azure static IP', async () => {
  const a = await dns.resolve4(web.hostname);
  expect(a.length === 1 && a[0] === EXPECTED_IP, `resolves to ${a.join(', ')}`);
  return a[0];
});
await check('DNS: www resolves to the same server', async () => {
  const a = await dns.resolve4('www.' + web.hostname);
  expect(a.includes(EXPECTED_IP), `resolves to ${a.join(', ')}`);
  return a.join(', ');
});
for (const host of [web.hostname, 'www.' + web.hostname, mobile.hostname])
  await check(`TLS certificate valid for ${host}`, async () => {
    const { cert, authorized, error } = await certificate(host);
    expect(authorized, `not trusted: ${error}`);
    const days = Math.round((new Date(cert.valid_to) - Date.now()) / 86400000);
    expect(days > 7, `expires in ${days} days`);
    return `${cert.issuer?.O || ''} ${cert.issuer?.CN || ''}, valid to ${cert.valid_to} (${days} days)`;
  });
await check('Website: apex serves the app with security headers', async () => {
  const r = await fetch(web);
  const html = await r.text();
  expect(r.status === 200 && html.includes('<div id="root">'), `status ${r.status}`);
  expect(/default-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'no CSP');
  expect((r.headers.get('strict-transport-security') || '').includes('max-age'), 'no HSTS');
  return `CSP + HSTS, cache-control: ${r.headers.get('cache-control')}`;
});
await check('Website: deep link refresh returns the app', async () => {
  const r = await fetch(new URL('/some/deep/link?tab=journeys', web));
  expect(r.status === 200 && (await r.text()).includes('<div id="root">'), `status ${r.status}`);
});
await check('Website: hashed bundle is cached long-term', async () => {
  const html = await (await fetch(web)).text();
  const script = html.match(/src="(\/_expo\/static\/js\/web\/entry-[^"]+)"/)[1];
  const r = await fetch(new URL(script, web));
  expect(r.status === 200, `status ${r.status}`);
  expect(
    (r.headers.get('cache-control') || '').includes('immutable'),
    r.headers.get('cache-control'),
  );
  return script;
});
await check('www redirects permanently to the apex', async () => {
  const r = await fetch(`https://www.${web.hostname}/path?x=1`, { redirect: 'manual' });
  expect([301, 308].includes(r.status), `status ${r.status}`);
  expect(
    r.headers.get('location') === `${web.origin}/path?x=1`,
    `location ${r.headers.get('location')}`,
  );
  return `${r.status} → ${r.headers.get('location')}`;
});
await check('http:// redirects to https://', async () => {
  const r = await fetch(`http://${web.hostname}/`, { redirect: 'manual' });
  expect(
    [301, 308].includes(r.status) && r.headers.get('location')?.startsWith('https://'),
    `status ${r.status}`,
  );
});
await check('API on the web origin returns JSON, not HTML', async () => {
  const health = await fetch(new URL('/health', web));
  expect(health.headers.get('content-type')?.includes('application/json'), 'health not JSON');
  const body = await health.json();
  expect(body.ok === true, 'health not ok');
  const options = await (await fetch(new URL('/auth/options', web))).json();
  expect(typeof options.emailEnabled === 'boolean', 'auth options not JSON');
  const unknown = await fetch(new URL('/auth/not-a-route', web), { method: 'POST', body: '{}' });
  expect(
    unknown.headers.get('content-type')?.includes('application/json'),
    'unknown API path served HTML',
  );
  return `release ${body.release}, schema ${body.schema}, email ${options.emailEnabled}`;
});
await check('Sign-in endpoint answers browser requests from the site origin', async () => {
  const r = await fetch(new URL('/auth/login', web), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: web.origin },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'not-a-real-password' }),
  });
  expect(r.status === 401, `status ${r.status}`);
  expect(r.headers.get('access-control-allow-origin') === web.origin, 'origin not allowed');
  return '401 for wrong credentials, origin allowed';
});
await check('Other web origins are refused', async () => {
  const r = await fetch(new URL('/auth/login', web), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{}',
  });
  expect(r.status === 403, `status ${r.status}`);
});
await check('Public institution list (used by onboarding)', async () => {
  const list = await (await fetch(new URL('/institutions', web))).json();
  expect(Array.isArray(list) && list.length > 0, 'empty');
  return list.map((i) => i.name).join(', ');
});
await check('Secure WebSocket on the web origin authenticates', async () => {
  const code = await wsClose(`wss://${web.hostname}/realtime`, web.origin);
  expect(code === 4001, `closed with ${code}`);
  return 'invalid token closed with 4001';
});
await check('WebSocket from a foreign origin is refused', async () => {
  try {
    await wsClose(`wss://${web.hostname}/realtime`, 'https://evil.example');
    throw Error('connected');
  } catch (error) {
    expect(
      /Unexpected server response|socket hang up|ECONNRESET/.test(error.message),
      error.message,
    );
  }
});
await check('Mobile API hostname still works (Android / Expo Go)', async () => {
  const body = await (await fetch(new URL('/health', mobile))).json();
  expect(body.ok === true, 'not ok');
  const code = await wsClose(`wss://${mobile.hostname}/realtime`);
  expect(code === 4001, `ws closed with ${code}`);
  return `release ${body.release}; wss ok`;
});

for (const [status, name, detail] of results)
  console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0;
