import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerUrl } from '../src/network.ts';
test('accepts local network origins and requires TLS for public addresses', () => {
  assert.equal(normalizeServerUrl(' http://192.168.1.20:4000/ '), 'http://192.168.1.20:4000');
  assert.equal(normalizeServerUrl('http://10.0.0.2:4000'), 'http://10.0.0.2:4000');
  assert.equal(
    normalizeServerUrl('https://transport.example.edu'),
    'https://transport.example.edu',
  );
  for (const value of [
    'http://public.example.edu',
    'http://172.50.1.1',
    'http://192.168.1.2:4000/path',
    'https://user:pass@example.com',
    'javascript:alert(1)',
    'https://example.com?token=secret',
  ])
    assert.throws(() => normalizeServerUrl(value));
});

import { resolveApiOrigin, permitHttp } from '../src/network.ts';
test('normal users need no server field: configured API or development host resolves automatically', () => {
  assert.equal(
    resolveApiOrigin({ development: true, hostUri: '10.100.88.36:8081' }),
    'http://10.100.88.36:4000',
  );
  assert.equal(
    resolveApiOrigin({ development: true, webOrigin: 'http://localhost:8081' }),
    'http://localhost:4000',
  );
  assert.equal(
    resolveApiOrigin({ development: false, configured: 'https://transport.example.test' }),
    'https://transport.example.test',
  );
  assert.equal(resolveApiOrigin({ development: false, hostUri: '10.0.0.1:8081' }), '');
  assert.equal(
    permitHttp({ development: true, expoGo: true, web: false, localBuild: false }),
    true,
  );
  assert.equal(
    permitHttp({ development: false, expoGo: true, web: false, localBuild: false }),
    false,
  );
  assert.equal(
    permitHttp({ development: false, expoGo: false, web: false, localBuild: true }),
    true,
  );
});
