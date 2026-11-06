// Azure Communication Services mail adapter against a recorded HTTP boundary.
// Proves request shape and honest failure handling; live delivery is verified separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAcsMailer, createMailer } from '../server/mail.mjs';

function fakeAcs(statuses, sendStatus = 202) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('emails:send'))
      return new Response(JSON.stringify({ id: 'op-1' }), { status: sendStatus });
    return new Response(JSON.stringify({ status: statuses.shift() }), { status: 200 });
  };
  return { calls, fetchImpl };
}
const mailerWith = (fake) =>
  createAcsMailer({
    endpoint: 'https://nextstop.unitedstates.communication.azure.com/',
    sender: 'DoNotReply@example.azurecomm.net',
    getToken: async () => 'mi-token',
    fetchImpl: fake.fetchImpl,
    wait: async () => {},
  });

test('ACS mailer sends the code with managed-identity auth and waits for success', async () => {
  const fake = fakeAcs(['Running', 'Succeeded']);
  await mailerWith(fake)({ email: 'rider@example.edu', code: '123456', purpose: 'verify' });
  const send = fake.calls[0];
  assert.equal(
    send.url,
    'https://nextstop.unitedstates.communication.azure.com/emails:send?api-version=2023-03-31',
  );
  assert.equal(send.init.headers.Authorization, 'Bearer mi-token');
  const body = JSON.parse(send.init.body);
  assert.equal(body.recipients.to[0].address, 'rider@example.edu');
  assert.equal(body.senderAddress, 'DoNotReply@example.azurecomm.net');
  assert.match(body.content.plainText, /123456/);
  assert.equal(body.userEngagementTrackingDisabled, true);
  assert.equal(fake.calls.length, 3);
});

test('ACS mailer reports rejection and delivery failure instead of success', async () => {
  await assert.rejects(
    mailerWith(fakeAcs([], 401))({ email: 'a@b.co', code: '000000', purpose: 'reset' }),
    /rejected/,
  );
  await assert.rejects(
    mailerWith(fakeAcs(['Failed']))({ email: 'a@b.co', code: '000000', purpose: 'reset' }),
    /failed/,
  );
});

test('mailer selection prefers ACS, falls back to SMTP, and is absent when unconfigured', () => {
  assert.equal(createMailer({}), null);
  assert.equal(
    typeof createMailer({ ACS_EMAIL_ENDPOINT: 'https://x', ACS_EMAIL_SENDER: 's@x' }),
    'function',
  );
  assert.equal(
    typeof createMailer({ SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'a@b.co' }),
    'function',
  );
});
