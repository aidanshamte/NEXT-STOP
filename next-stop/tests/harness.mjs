// Shared API test harness: two institutions, people in every role, signed in.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { hashPassword } from '../server/security.mjs';
import { seedInstitutions } from './fixtures.mjs';

const pass = 'service-test-password';

export async function harness(t, { clock, suggestionData, photoData, walkingOptions, log } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nextstop-service-'));
  const sent = [];
  const transport = {
    async send(messages) {
      sent.push(...messages);
      return messages.map((_, i) => ({ status: 'ok', id: `t-${sent.length}-${i}` }));
    },
    async receipts() {
      return {};
    },
  };
  const app = createApp({
    dbPath: join(dir, 'service.db'),
    pushTransport: transport,
    authOptions: { mailer: async () => {} },
    clock,
    suggestionData,
    photoData,
    walkingOptions,
    log,
  });
  seedInstitutions(app.db);
  const people = [
    'northbridge-student',
    'northbridge-student2',
    'northbridge-driver',
    'northbridge-parent',
    'northbridge-admin',
    'lakeside-admin',
    'lakeside-student',
  ];
  for (const id of people) {
    const [org, role] = id.split('-');
    app.db
      .prepare('INSERT INTO users(id,name,email,password,email_verified) VALUES (?,?,?,?,1)')
      .run(id, `Sam ${role}`, `${id}@example.com`, hashPassword(pass));
    app.db
      .prepare('INSERT INTO memberships VALUES (?,?,?,1)')
      .run(id, org, role.replace(/\d$/, ''));
  }
  app.db
    .prepare(
      "INSERT INTO trips(id,institution_id,driver_id,name,capacity,active) VALUES ('bus','northbridge','northbridge-driver','Shuttle A',2,1)",
    )
    .run();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    app.realtime.close();
    await new Promise((r) => app.server.close(r));
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = async (path, token, body) => {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };
  const tokens = {};
  for (const id of people) {
    const r = await call('/auth/login', '', { email: `${id}@example.com`, password: pass });
    tokens[id] = r.data.token;
    await call('/push/register', r.data.token, {
      token: `ExponentPushToken[${id.replace(/-/g, '')}xx]`,
      platform: 'ios',
    });
  }
  const as = (id) => {
    const org = id.split('-')[0];
    return {
      post: (path, body = {}) => call(path, tokens[id], { institutionId: org, ...body }),
      get: (path, query = '') => call(`${path}?institutionId=${org}${query}`, tokens[id]),
      snapshot: async () => (await call(`/snapshot?institutionId=${org}`, tokens[id])).data,
    };
  };
  const pushedTo = (id) =>
    sent.filter((m) => m.to === `ExponentPushToken[${id.replace(/-/g, '')}xx]`);
  return { app, as, sent, pushedTo, call, tokens };
}
