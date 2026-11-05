import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase } from '../server/db.mjs';
test('operator bootstrap creates only real institution/admin records and preserves an existing admin account', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-setup-')),
    path = join(dir, 'live.db');
  try {
    const first = execFileSync(
      process.execPath,
      ['server/setup.mjs', '--name', 'Operator institution', '--email', 'admin@operator.test'],
      { env: { ...process.env, DATABASE_PATH: path }, encoding: 'utf8' },
    );
    assert.match(first, /Generated administrator password/);
    const second = execFileSync(
      process.execPath,
      ['server/setup.mjs', '--name', 'Second institution', '--email', 'admin@operator.test'],
      { env: { ...process.env, DATABASE_PATH: path }, encoding: 'utf8' },
    );
    assert.match(second, /existing account password/);
    const db = openDatabase(path);
    try {
      assert.equal(db.prepare('SELECT count(*) AS n FROM institutions').get().n, 2);
      assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM memberships').get().n, 2);
      assert.equal(db.prepare('SELECT count(*) AS n FROM trips').get().n, 0);
      assert.equal(db.prepare('SELECT count(*) AS n FROM stops').get().n, 0);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
