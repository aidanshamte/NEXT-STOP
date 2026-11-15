// Outage 2026-11-14: unattended upgrades rebooted the VM at the configured time, and the API
// stayed down because deploys restarted the service without ever enabling it for boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(f, 'utf8');

test('the API service starts at boot whenever the VM can reboot itself', () => {
  const cloudInit = read('deploy/azure/cloud-init.yaml');
  const unit = read('deploy/systemd/next-stop.service');
  assert.match(unit, /\[Install\][\s\S]*WantedBy=multi-user\.target/);
  if (/Automatic-Reboot "true"/.test(cloudInit))
    for (const script of ['deploy/release.sh', 'deploy/rollback.sh']) {
      const s = read(script);
      // Every place that (re)starts the API also enables it, first.
      const starts = [...s.matchAll(/systemctl (?:restart|start) next-stop\b/g)];
      assert.ok(starts.length, script);
      for (const m of starts) {
        const before = s.slice(0, m.index);
        assert.ok(
          before.lastIndexOf('systemctl enable next-stop') >
            Math.max(before.lastIndexOf('systemctl daemon-reload'), -1) - 1 &&
            before.includes('systemctl enable next-stop'),
          `${script}: "${m[0]}" without enabling the service for boot`,
        );
      }
    }
});
