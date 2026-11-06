import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
for (const local of [true, false])
  test(`native configuration: ${local ? 'local HTTP build' : 'HTTPS production build'}`, () => {
    const raw = execFileSync(
      process.execPath,
      ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'],
      {
        env: { ...process.env, ALLOW_LOCAL_HTTP: local ? '1' : '0' },
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const config = JSON.parse(raw),
      mods = config._internal.modResults;
    const plist = mods.ios.infoPlist,
      manifest = mods.android.manifest.manifest;
    assert.equal(plist.NSAppTransportSecurity.NSAllowsArbitraryLoads, local);
    assert.equal(manifest.application[0].$['android:usesCleartextTraffic'], String(local));
    assert.ok(plist.UIBackgroundModes.includes('location'));
    const permissions = manifest['uses-permission'].map((item) => item.$['android:name']);
    assert.ok(permissions.includes('android.permission.ACCESS_BACKGROUND_LOCATION'));
    assert.ok(permissions.includes('android.permission.FOREGROUND_SERVICE_LOCATION'));
    assert.equal(config.extra.allowLocalHttp, local);
  });

test('configured Google iOS client adds its actual reversed-client URL scheme', () => {
  const client = '123456789-fixture.apps.googleusercontent.com';
  const raw = execFileSync(
    process.execPath,
    ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'],
    {
      env: {
        ...process.env,
        EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: client,
        GOOGLE_IOS_URL_SCHEME: '',
        ALLOW_LOCAL_HTTP: '0',
      },
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const config = JSON.parse(raw),
    urls = config._internal.modResults.ios.infoPlist.CFBundleURLTypes;
  assert.ok(
    urls.some((entry) =>
      entry.CFBundleURLSchemes.includes('com.googleusercontent.apps.123456789-fixture'),
    ),
  );
});

const introspect = (env) =>
  execFileSync(
    process.execPath,
    ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'],
    {
      env: { ...process.env, ALLOW_LOCAL_HTTP: '0', ...env },
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

test('preview and production builds refuse to build without the hosted HTTPS API', () => {
  for (const profile of ['preview', 'production']) {
    assert.throws(
      () => introspect({ EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: '' }),
      /EXPO_PUBLIC_API_URL/,
      `${profile} without URL`,
    );
    assert.throws(
      () =>
        introspect({ EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: 'http://192.168.1.5:4000' }),
      /EXPO_PUBLIC_API_URL/,
      `${profile} with local HTTP`,
    );
  }
  const config = JSON.parse(
    introspect({
      EAS_BUILD_PROFILE: 'production',
      EXPO_PUBLIC_API_URL: 'https://nextstop-api.eastus.cloudapp.azure.com',
    }),
  );
  const plist = config._internal.modResults.ios.infoPlist;
  assert.ok(
    !String(plist.NSLocalNetworkUsageDescription || '').includes('NEXT STOP test server'),
    'no NEXT STOP LAN prompt in hosted builds',
  );
  assert.equal(plist.NSAppTransportSecurity?.NSAllowsArbitraryLoads ?? false, false);
  assert.equal(plist.ITSAppUsesNonExemptEncryption, false);
  // Development and local-network internal builds are unaffected.
  assert.doesNotThrow(() =>
    introspect({ EAS_BUILD_PROFILE: 'development', EXPO_PUBLIC_API_URL: '' }),
  );
});
