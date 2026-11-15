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
  const source = [
    'server/app.mjs',
    'server/auth.mjs',
    'server/realtime.mjs',
    'server/service.mjs',
    'server/safety.mjs',
    'server/assistance.mjs',
  ]
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const routes = new Set([
    ...[...source.matchAll(/path === '(\/[a-z/]+)'/g)].map((m) => m[1]),
    ...[...source.matchAll(/'(\/auth\/[a-z/]+)'/g)].map((m) => m[1]),
    ...[...source.matchAll(/pathname !== '(\/[a-z]+)'/g)].map((m) => m[1]),
    ...[...source.matchAll(/case '(\/[a-z/-]+)':/g)].map((m) => m[1]),
    ...[...source.matchAll(/path (?:!==|===) '(\/[a-z/-]+)'/g)].map((m) => m[1]),
  ]);
  assert.ok(routes.size > 55, 'route discovery found the server routes');
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

test('the server release package includes every local module and data file the server imports', () => {
  const pkg = readFileSync('deploy/package-release.sh', 'utf8');
  assert.match(pkg, /server\/\*\.mjs/);
  assert.match(pkg, /server\/\*\.json/, 'catalog.json is imported by service.mjs and the app');
  for (const file of ['service.mjs', 'safety.mjs', 'eta.mjs', 'time.mjs', 'app.mjs'])
    for (const [, dep] of readFileSync(`server/${file}`, 'utf8').matchAll(/from '\.\/([^']+)'/g))
      assert.match(dep, /\.(mjs|json)$/, `${file} imports ${dep}, which the package must copy`);
});
