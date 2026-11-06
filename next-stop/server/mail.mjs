import nodemailer from 'nodemailer';
import { managedIdentityToken } from './azure.mjs';

export function codeMessage({ code, purpose }) {
  const reset = purpose === 'reset';
  return {
    subject: reset ? 'Reset your NEXT STOP password' : 'Your NEXT STOP verification code',
    text: `${reset ? 'Reset your password' : 'Verify your email'} with this code: ${code}\n\nThis code expires in 10 minutes and can only be used once.\nIf you did not request this, ignore this message.\n\nNEXT STOP · Your ride. In sight.`,
    html: `<div style="font-family:Arial,sans-serif;background:#f5f7f8;padding:32px"><div style="max-width:480px;margin:auto;background:white;border-radius:20px;padding:36px"><p style="font-size:14px;letter-spacing:3px;color:#11243a;font-weight:bold">NEXT STOP<span style="color:#ef543f"> •</span></p><h1 style="color:#11243a">${reset ? 'A fresh start.' : 'You’re almost on board.'}</h1><p style="color:#5c6875">${reset ? 'Use this code to reset your password.' : 'Enter this code to verify your email address.'}</p><p style="font-size:36px;letter-spacing:10px;font-weight:bold;color:#ef543f">${code}</p><p style="color:#5c6875">Expires in 10 minutes. Use it only in NEXT STOP.</p><p style="font-size:12px;color:#72808d">If you did not request this, you can ignore this email.</p></div></div>`,
  };
}

// Azure Communication Services Email over its REST API, authenticated with the VM's
// managed identity. Success means ACS accepted the message and did not report a failure
// within a short wait; it is not proof the recipient opened it.
export function createAcsMailer({
  endpoint,
  sender,
  getToken = () => managedIdentityToken('https://communication.azure.com'),
  fetchImpl = fetch,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const base = endpoint.replace(/\/$/, '');
  return async ({ email, code, purpose }) => {
    const message = codeMessage({ code, purpose });
    const headers = {
      Authorization: `Bearer ${await getToken()}`,
      'Content-Type': 'application/json',
    };
    const response = await fetchImpl(`${base}/emails:send?api-version=2023-03-31`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        senderAddress: sender,
        recipients: { to: [{ address: email }] },
        content: { subject: message.subject, plainText: message.text, html: message.html },
        userEngagementTrackingDisabled: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 202)
      throw Error(`Email service rejected the message (${response.status}).`);
    const { id } = await response.json();
    // Poll briefly so an immediate provider failure is reported as a failure.
    for (let i = 0; i < 5 && id; i++) {
      await wait(1500);
      const status = await fetchImpl(
        `${base}/emails/operations/${encodeURIComponent(id)}?api-version=2023-03-31`,
        { headers, signal: AbortSignal.timeout(10000) },
      );
      if (!status.ok) break;
      const { status: state } = await status.json();
      if (state === 'Succeeded') return;
      if (state === 'Failed' || state === 'Canceled') throw Error('Email delivery failed.');
    }
  };
}

export function createMailer(env = process.env) {
  if (env.ACS_EMAIL_ENDPOINT && env.ACS_EMAIL_SENDER)
    return createAcsMailer({ endpoint: env.ACS_EMAIL_ENDPOINT, sender: env.ACS_EMAIL_SENDER });
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  const port = Number(env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: { rejectUnauthorized: true },
  });
  return async ({ email, code, purpose }) => {
    const message = codeMessage({ code, purpose });
    const info = await transporter.sendMail({ from: env.SMTP_FROM, to: email, ...message });
    if (!info.accepted?.length) throw Error('Recipient not accepted by mail provider.');
  };
}
