import nodemailer from 'nodemailer';
export function createMailer(env = process.env) {
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
    const reset = purpose === 'reset';
    const subject = reset ? 'Reset your NEXT STOP password' : 'Your NEXT STOP verification code';
    const text = `${reset ? 'Reset your password' : 'Verify your email'} with this code: ${code}\n\nThis code expires in 10 minutes and can only be used once.\nIf you did not request this, ignore this message.\n\nNEXT STOP · Your ride. In sight.`;
    const info = await transporter.sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject,
      text,
      html: `<div style="font-family:Arial,sans-serif;background:#f5f7f8;padding:32px"><div style="max-width:480px;margin:auto;background:white;border-radius:20px;padding:36px"><p style="font-size:14px;letter-spacing:3px;color:#11243a;font-weight:bold">NEXT STOP<span style="color:#ef543f"> •</span></p><h1 style="color:#11243a">${reset ? 'A fresh start.' : 'You’re almost on board.'}</h1><p style="color:#5c6875">${reset ? 'Use this code to reset your password.' : 'Enter this code to verify your email address.'}</p><p style="font-size:36px;letter-spacing:10px;font-weight:bold;color:#ef543f">${code}</p><p style="color:#5c6875">Expires in 10 minutes. Use it only in NEXT STOP.</p><p style="font-size:12px;color:#72808d">If you did not request this, you can ignore this email.</p></div></div>`,
    });
    if (!info.accepted?.length) throw Error('Recipient not accepted by mail provider.');
  };
}
