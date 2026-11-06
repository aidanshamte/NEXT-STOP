import { randomBytes, randomInt, randomUUID, timingSafeEqual, scryptSync } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { hashPassword, verifyPassword, tokenHash } from './security.mjs';
import { createMailer } from './mail.mjs';
export function createAuth(
  db,
  {
    mailer = createMailer(),
    googleVerifier,
    googleClientIds = (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_WEB_CLIENT_ID || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    googleWebClientId = process.env.GOOGLE_WEB_CLIENT_ID || '',
    clock = Date.now,
    authRateLimit = Number(process.env.AUTH_RATE_LIMIT || 30),
  } = {},
) {
  const google = new OAuth2Client();
  const rates = new Map();
  const fail = (status, message) => {
    throw Object.assign(Error(message), { status });
  };
  const session = (uid) => {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
      tokenHash(token),
      uid,
      clock() + 86400000 * 7,
    );
    return { token };
  };
  const cleanEmail = (body) => {
    if (
      typeof body.email !== 'string' ||
      body.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
    )
      fail(400, 'Enter a valid email address.');
    return body.email.trim().toLowerCase();
  };
  const password = (body) => {
    if (
      typeof body.password !== 'string' ||
      body.password.length < 12 ||
      body.password.length > 256
    )
      fail(400, 'Use a password between 12 and 256 characters.');
    return body.password;
  };
  const gate = (ip, action) => {
    const now = clock();
    const key = ip + ':' + action;
    let value = rates.get(key);
    if (!value || now - value.start >= 60000) {
      value = { start: now, count: 0 };
      rates.set(key, value);
    }
    if (++value.count > authRateLimit) fail(429, 'Too many attempts. Please wait a minute.');
    for (const [key, value] of rates) if (now - value.start > 60000) rates.delete(key);
  };
  async function issue(email, purpose) {
    if (!mailer) fail(503, 'We cannot send verification emails right now. Please try again later.');
    const now = clock();
    const prior = db
      .prepare('SELECT * FROM email_codes WHERE email=? AND purpose=?')
      .get(email, purpose);
    if (prior && now - prior.sent_at < 60000)
      fail(429, 'Please wait 60 seconds before requesting another code.');
    const hour = Math.floor(now / 3600000);
    db.prepare('DELETE FROM mail_limits WHERE hour<?').run(hour - 24);
    const rate = db
      .prepare('SELECT count FROM mail_limits WHERE email=? AND hour=?')
      .get(email, hour);
    if (rate?.count >= 6) fail(429, 'Too many email requests. Please try again later.');
    const code = String(randomInt(0, 1000000)).padStart(6, '0'),
      salt = randomBytes(32).toString('hex'),
      hash = scryptSync(code, salt, 32).toString('hex');
    db.prepare(
      'INSERT INTO mail_limits(email,hour,count) VALUES (?,?,1) ON CONFLICT(email,hour) DO UPDATE SET count=count+1',
    ).run(email, hour);
    db.prepare(
      'INSERT INTO email_codes VALUES (?,?,?,?,?,?,0) ON CONFLICT(email,purpose) DO UPDATE SET hash=excluded.hash,salt=excluded.salt,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0',
    ).run(email, purpose, hash, salt, now + 600000, now);
    try {
      await mailer({ email, code, purpose });
    } catch {
      db.prepare('DELETE FROM email_codes WHERE email=? AND purpose=? AND hash=?').run(
        email,
        purpose,
        hash,
      );
      fail(503, 'We could not send your code. Please try again shortly.');
    }
  }
  function consume(email, purpose, code) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) fail(400, 'Enter the six-digit code.');
    const row = db
      .prepare('SELECT * FROM email_codes WHERE email=? AND purpose=?')
      .get(email, purpose);
    if (!row || row.expires_at < clock() || row.attempts >= 5)
      fail(400, 'This code is invalid or expired. Request a new one.');
    db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE email=? AND purpose=?').run(
      email,
      purpose,
    );
    if (!timingSafeEqual(scryptSync(code, row.salt, 32), Buffer.from(row.hash, 'hex')))
      fail(400, 'That code is not correct. Please try again.');
    db.prepare('DELETE FROM email_codes WHERE email=? AND purpose=?').run(email, purpose);
  }
  async function verifyGoogle(token) {
    if (typeof token !== 'string' || token.length > 12000)
      fail(400, 'Google did not return a valid sign-in credential.');
    let payload;
    try {
      payload = googleVerifier
        ? await googleVerifier(token)
        : (await google.verifyIdToken({ idToken: token, audience: googleClientIds })).getPayload();
    } catch {
      fail(401, 'Google sign-in could not be verified. Please try again.');
    }
    if (
      typeof payload?.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      !payload.email.includes('@') ||
      payload.email_verified !== true
    )
      fail(401, 'A verified Google email is required.');
    // Google is authoritative for Gmail and managed Workspace domains. Other
    // addresses still complete our email-code verification before a session.
    return payload;
  }
  return {
    session,
    async handle({ path, method, body, send, uid, ip }) {
      if (path === '/auth/options' && method === 'GET') {
        send(200, {
          emailEnabled: !!mailer,
          googleEnabled: !!googleVerifier || googleClientIds.length > 0,
          googleWebClientId,
        });
        return true;
      }
      if (
        ![
          '/auth/register',
          '/auth/login',
          '/auth/verify',
          '/auth/resend',
          '/auth/forgot',
          '/auth/reset',
          '/auth/google',
          '/auth/google/challenge',
          '/auth/google/link',
        ].includes(path)
      )
        return false;
      if (method !== 'POST') fail(405, 'Method not allowed.');
      gate(ip, path);
      if (path === '/auth/google/challenge') {
        const challenge = randomBytes(32).toString('hex');
        db.prepare('DELETE FROM google_challenges WHERE expires_at<?').run(clock());
        db.prepare('INSERT INTO google_challenges VALUES (?,?)').run(
          tokenHash(challenge),
          clock() + 300000,
        );
        send(200, { challenge });
        return true;
      }
      if (path === '/auth/register') {
        // Membership and privilege selection happen separately after verification.
        if (body.role !== undefined || body.institutionId !== undefined)
          fail(400, 'Create your account first, then join your institution.');
        const email = cleanEmail(body),
          pass = password(body);
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80)
          fail(400, 'Enter your full name.');
        if (!mailer)
          fail(503, 'We cannot send verification emails right now. Please try again later.');
        let user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (user) {
          if (user.email_verified || !user.password_enabled || !verifyPassword(pass, user.password))
            fail(409, 'An account already exists. Sign in or reset your password.');
        } else {
          const id = randomUUID();
          db.prepare(
            'INSERT INTO users(id,name,email,password,email_verified,password_enabled) VALUES (?,?,?,?,0,1)',
          ).run(id, body.name.trim(), email, hashPassword(pass));
          user = { id };
        }
        await issue(email, 'verify');
        send(200, { requiresVerification: true, email });
        return true;
      }
      if (path === '/auth/login') {
        const email = cleanEmail(body);
        if (typeof body.password !== 'string' || body.password.length > 256)
          fail(401, 'Incorrect email or password.');
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (!user || !user.password_enabled || !verifyPassword(body.password, user.password))
          fail(401, 'Incorrect email or password.');
        if (!user.email_verified) {
          await issue(email, 'verify');
          send(200, { requiresVerification: true, email });
        } else send(200, session(user.id));
        return true;
      }
      if (path === '/auth/resend') {
        const email = cleanEmail(body),
          user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (user && !user.email_verified) await issue(email, 'verify');
        send(200, { message: 'If verification is needed, a code has been sent.' });
        return true;
      }
      if (path === '/auth/verify') {
        const email = cleanEmail(body);
        consume(email, 'verify', body.code);
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (!user) fail(400, 'Account not found.');
        db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(user.id);
        send(200, session(user.id));
        return true;
      }
      if (path === '/auth/forgot') {
        const email = cleanEmail(body),
          user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (user?.password_enabled) await issue(email, 'reset');
        send(200, { message: 'If an email/password account exists, we have sent a reset code.' });
        return true;
      }
      if (path === '/auth/reset') {
        const email = cleanEmail(body),
          pass = password(body);
        consume(email, 'reset', body.code);
        const user = db
          .prepare('SELECT * FROM users WHERE email=? AND password_enabled=1')
          .get(email);
        if (!user) fail(400, 'This password reset is not available.');
        db.prepare('UPDATE users SET password=?,email_verified=1 WHERE id=?').run(
          hashPassword(pass),
          user.id,
        );
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
        send(200, { message: 'Password updated. Sign in with your new password.' });
        return true;
      }
      if (path === '/auth/google' || path === '/auth/google/link') {
        if (!['web', 'native'].includes(body.platform)) fail(400, 'Unsupported sign-in source.');
        if (!googleVerifier && !googleClientIds.length)
          fail(503, 'Google sign-in is not available yet. Please use email.');
        const claim = await verifyGoogle(body.idToken);
        if (body.platform === 'web') {
          const challenge = typeof body.challenge === 'string' ? body.challenge : '';
          const row = db
            .prepare('SELECT * FROM google_challenges WHERE hash=? AND expires_at>?')
            .get(tokenHash(challenge), clock());
          if (!row || claim.nonce !== challenge)
            fail(401, 'Google sign-in session expired. Please try again.');
          db.prepare('DELETE FROM google_challenges WHERE hash=?').run(tokenHash(challenge));
        }
        const email = claim.email.toLowerCase();
        let user = db.prepare('SELECT * FROM users WHERE google_sub=?').get(claim.sub);
        if (path === '/auth/google/link') {
          const account =
            uid && db.prepare('SELECT * FROM users WHERE id=? AND email_verified=1').get(uid);
          if (!account || account.email !== email || (user && user.id !== uid))
            fail(403, 'Sign in to the matching verified account before linking Google.');
          db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(claim.sub, uid);
          send(200, { linked: true });
          return true;
        }
        if (!user) {
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
            fail(
              409,
              'You already have an email account. Sign in with your password, then link Google in Account.',
            );
          const id = randomUUID(),
            authoritative = email.endsWith('@gmail.com') || !!claim.hd;
          db.prepare(
            'INSERT INTO users(id,name,email,password,email_verified,google_sub,password_enabled) VALUES (?,?,?,?,?,?,0)',
          ).run(
            id,
            String(claim.name || 'NEXT STOP rider').slice(0, 80),
            email,
            hashPassword(randomBytes(32).toString('hex')),
            authoritative ? 1 : 0,
            claim.sub,
          );
          user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
        }
        if (!user.email_verified) {
          await issue(email, 'verify');
          send(200, { requiresVerification: true, email });
        } else send(200, session(user.id));
        return true;
      }
      return false;
    },
  };
}
