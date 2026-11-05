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
