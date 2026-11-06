import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.mjs';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../server/security.mjs';
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-auth-')),
    messages = [];
  let now = Date.now();
  const claims = new Map();
  const app = createApp({
    dbPath: join(dir, 'auth.db'),
    authOptions: {
      mailer: async (message) => {
        messages.push(message);
      },
      clock: () => now,
      googleVerifier: async (token) => {
        if (!claims.has(token)) throw Error('Invalid credential');
        return claims.get(token);
      },
      ...options,
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => {
    app.realtime.close();
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function call(path, body, token) {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }
  async function signup(email = 'student@example.test') {
    const result = await call('/auth/register', {
      name: 'Alex Student',
      email,
      password: 'a-long-account-password',
    });
    assert.equal(result.status, 200);
    return result;
  }
  async function verified(email = 'student@example.test') {
    await signup(email);
    const result = await call('/auth/verify', { email, code: messages.at(-1).code });
    assert.equal(result.status, 200);
    return result.data.token;
  }
  return {
    ...app,
    messages,
    claims,
    call,
    signup,
    verified,
    advance: (ms) => {
      now += ms;
    },
  };
}
test('real account creation is separate from membership and requires delivered, one-time email verification', async (t) => {
  const f = await fixture(t);
  const registered = await f.signup();
  assert.equal(registered.data.requiresVerification, true);
  assert.equal(registered.data.token, undefined);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].code, /^\d{6}$/);
  const user = f.db.prepare('SELECT * FROM users').get();
  assert.notEqual(user.password, 'a-long-account-password');
  assert.equal(user.email_verified, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memberships').get().n, 0);
  const code = f.messages[0].code,
    stored = f.db.prepare('SELECT * FROM email_codes').get();
  assert.notEqual(stored.hash, code);
  assert.equal(JSON.stringify(registered.data).includes(code), false);
  assert.equal((await f.call('/auth/verify', { email: user.email, code: 'not-code' })).status, 400);
  const result = await f.call('/auth/verify', { email: user.email, code });
  assert.equal(result.status, 200);
  assert.ok(result.data.token);
  assert.equal(f.db.prepare('SELECT email_verified FROM users').get().email_verified, 1);
  assert.equal(
    (await f.call('/auth/verify', { email: user.email, code })).status,
    400,
    'a code cannot be replayed',
  );
  const profile = await f.call('/me', null, result.data.token);
  assert.equal(profile.status, 200);
  assert.equal(profile.data.memberships.length, 0);
  f.db.prepare("INSERT INTO institutions VALUES ('real','Real institution','college')").run();
  assert.equal(
    (await f.call('/memberships', { institutionId: 'real', role: 'admin' }, result.data.token))
      .status,
    400,
  );
  assert.equal(
    (await f.call('/memberships', { institutionId: 'real', role: 'student' }, result.data.token))
      .status,
    201,
  );
  assert.equal(f.db.prepare('SELECT approved FROM memberships').get().approved, 0);
});
test('delivery failure cannot produce a verified account or a successful email-sent response', async (t) => {
  const f = await fixture(t, {
    mailer: async () => {
      throw Error('SMTP rejected');
    },
  });
  const result = await f.call('/auth/register', {
    name: 'Alex',
    email: 'failure@example.test',
    password: 'a-long-account-password',
  });
  assert.equal(result.status, 503);
  assert.equal(result.data.token, undefined);
  assert.equal(result.data.requiresVerification, undefined);
  assert.equal(f.db.prepare('SELECT email_verified FROM users').get().email_verified, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM email_codes').get().n, 0);
});
test('email codes expire, have attempt limits, and resend invalidates the prior code', async (t) => {
  const f = await fixture(t);
  await f.signup();
  const email = 'student@example.test',
    old = f.messages[0].code;
  assert.equal((await f.call('/auth/resend', { email })).status, 429);
  const wrong = old === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++)
    assert.equal((await f.call('/auth/verify', { email, code: wrong })).status, 400);
  assert.equal((await f.call('/auth/verify', { email, code: old })).status, 400);
  f.advance(61000);
  assert.equal((await f.call('/auth/resend', { email })).status, 200);
  const next = f.messages.at(-1).code;
  assert.notEqual(f.db.prepare('SELECT attempts FROM email_codes').get().attempts, 5);
  f.advance(600001);
  assert.equal((await f.call('/auth/verify', { email, code: next })).status, 400);
});
test('password recovery changes the stored password and invalidates existing sessions', async (t) => {
  const f = await fixture(t),
    email = 'student@example.test',
    token = await f.verified(email);
  assert.equal((await f.call('/auth/forgot', { email })).status, 200);
  const code = f.messages.at(-1).code;
  assert.equal(
    (await f.call('/auth/reset', { email, code, password: 'a-new-account-password' })).status,
    200,
  );
  assert.equal((await f.call('/me', null, token)).status, 401);
  assert.equal(
    (await f.call('/auth/login', { email, password: 'a-long-account-password' })).status,
    401,
  );
  assert.ok(
    (await f.call('/auth/login', { email, password: 'a-new-account-password' })).data.token,
  );
  assert.equal(
    (await f.call('/auth/reset', { email, code, password: 'another-long-password' })).status,
    400,
  );
  assert.equal((await f.call('/auth/forgot', { email: 'unknown@example.test' })).status, 200);
});
test('Google identity creates persistent accounts only after provider verification and never silently merges email accounts', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call('/auth/google', { idToken: 'invalid', platform: 'native' })).status,
    401,
  );
  f.claims.set('valid-google', {
    sub: 'google-123',
    email: 'rider@gmail.com',
    email_verified: true,
    name: 'Google Rider',
  });
  const first = await f.call('/auth/google', { idToken: 'valid-google', platform: 'native' });
  assert.equal(first.status, 200);
  assert.ok(first.data.token);
  const googleUser = f.db.prepare("SELECT * FROM users WHERE google_sub='google-123'").get();
  assert.equal(googleUser.password_enabled, 0);
  assert.equal(googleUser.email_verified, 1);
  const second = await f.call('/auth/google', { idToken: 'valid-google', platform: 'native' });
  assert.equal(second.status, 200);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  const token = await f.verified('existing@gmail.com');
  f.claims.set('existing-google', {
    sub: 'google-456',
    email: 'existing@gmail.com',
    email_verified: true,
  });
  assert.equal(
    (await f.call('/auth/google', { idToken: 'existing-google', platform: 'native' })).status,
    409,
  );
  assert.equal(
    (
      await f.call(
        '/auth/google/link',
        { idToken: 'existing-google', platform: 'native' },
        first.data.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.call('/auth/google/link', { idToken: 'existing-google', platform: 'native' }, token))
      .status,
    200,
  );
  const linked = await f.call('/auth/google', { idToken: 'existing-google', platform: 'native' });
  assert.equal(linked.status, 200);
  assert.equal(
    (await f.call('/me', null, linked.data.token)).data.user.email,
    'existing@gmail.com',
  );
});
test('Google web challenges are single-use and external Google email addresses still verify mailbox ownership', async (t) => {
  const f = await fixture(t);
  const { challenge } = (await f.call('/auth/google/challenge', {})).data;
  f.claims.set('web-token', {
    sub: 'web-user',
    email: 'web@gmail.com',
    email_verified: true,
    nonce: challenge,
  });
  assert.equal(
    (await f.call('/auth/google', { idToken: 'web-token', platform: 'web', challenge: 'wrong' }))
      .status,
    401,
  );
  assert.equal(
    (await f.call('/auth/google', { idToken: 'web-token', platform: 'web', challenge })).status,
    200,
  );
  assert.equal(
    (await f.call('/auth/google', { idToken: 'web-token', platform: 'web', challenge })).status,
    401,
  );
  f.claims.set('external', {
    sub: 'external-google',
    email: 'external@example.test',
    email_verified: true,
  });
  const result = await f.call('/auth/google', { idToken: 'external', platform: 'native' });
  assert.equal(result.status, 200);
  assert.equal(result.data.requiresVerification, true);
  assert.equal(result.data.token, undefined);
  assert.equal(
    (await f.call('/auth/verify', { email: 'external@example.test', code: f.messages.at(-1).code }))
      .status,
    200,
  );
});
test('existing users and memberships survive a real legacy-schema upgrade without false email verification', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-migration-')),
    path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  const password = hashPassword('existing-long-password');
  old.exec(
    `CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT UNIQUE,password TEXT NOT NULL);CREATE TABLE institutions(id TEXT PRIMARY KEY,name TEXT,kind TEXT);CREATE TABLE memberships(user_id TEXT,institution_id TEXT,role TEXT,approved INTEGER,PRIMARY KEY(user_id,institution_id));`,
  );
  old
    .prepare('INSERT INTO users VALUES (?,?,?,?)')
    .run('existing', 'Existing Person', 'person@example.test', password);
  old.exec(
    "INSERT INTO institutions VALUES ('school','Existing institution','college');INSERT INTO memberships VALUES ('existing','school','driver',1)",
  );
  old.close();
  const upgraded = createApp({ dbPath: path, authOptions: { mailer: null } });
  try {
    const user = upgraded.db.prepare("SELECT * FROM users WHERE id='existing'").get();
    assert.equal(user.password, password);
    assert.equal(user.email_verified, 0);
    assert.equal(user.password_enabled, 1);
    assert.equal(
      upgraded.db.prepare("SELECT role FROM memberships WHERE user_id='existing'").get().role,
      'driver',
    );
  } finally {
    upgraded.realtime.close();
    upgraded.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('missing email provider never creates a pretend verified account', async (t) => {
  const f = await fixture(t, { mailer: null });
  assert.equal((await f.call('/auth/options')).data.emailEnabled, false);
  assert.equal(
    (
      await f.call('/auth/register', {
        name: 'Real Person',
        email: 'person@example.test',
        password: 'a-long-account-password',
      })
    ).status,
    503,
  );
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
});
