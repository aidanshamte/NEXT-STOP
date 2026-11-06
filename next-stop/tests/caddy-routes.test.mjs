// The website and API share https://nextstop.software. Caddy sends listed paths to the API
// and everything else to the web app, so every server route must be in that list,
// or the browser would receive the app's HTML instead of an API response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const caddy = readFileSync('deploy/Caddyfile', 'utf8');
const patterns = caddy
  .match(/@api path ([^\n]+)/)[1]
  .trim()
  .split(/\s+/);
const matches = (path) =>
  patterns.some((p) => (p.endsWith('/*') ? path.startsWith(p.slice(0, -1)) : path === p));

test('every API route is proxied on the shared web origin', () => {
  const source = ['server/app.mjs', 'server/auth.mjs', 'server/realtime.mjs']
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const routes = new Set([
    ...[...source.matchAll(/path === '(\/[a-z/]+)'/g)].map((m) => m[1]),
    ...[...source.matchAll(/'(\/auth\/[a-z/]+)'/g)].map((m) => m[1]),
    ...[...source.matchAll(/pathname !== '(\/[a-z]+)'/g)].map((m) => m[1]),
  ]);
  assert.ok(routes.size > 25, 'route discovery found the server routes');
  for (const route of routes) assert.ok(matches(route), `${route} must be proxied to the API`);
});

test('web app paths are not captured by the API matcher', () => {
  for (const path of [
    '/',
    '/index.html',
    '/favicon.ico',
    '/_expo/static/js/web/entry.js',
    '/assets/x.png',
  ])
    assert.ok(!matches(path), `${path} must be served by the web app`);
});

test('existing API hostname block and www redirect are present', () => {
  assert.match(caddy, /\{\$NEXT_STOP_DOMAIN\} \{[\s\S]*?reverse_proxy 127\.0\.0\.1:4000/);
  assert.match(
    caddy,
    /www\.\{\$NEXT_STOP_WEB_DOMAIN\} \{\s*redir https:\/\/\{\$NEXT_STOP_WEB_DOMAIN\}\{uri\} permanent/,
  );
  assert.match(caddy, /try_files \{path\} \/index\.html/);
});
