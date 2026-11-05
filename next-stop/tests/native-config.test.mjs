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
