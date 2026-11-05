import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
export function hashPassword(value) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(value, salt, 64).toString('hex');
}
export function verifyPassword(value, stored) {
  const [salt, key] = stored.split(':');
  const test = scryptSync(value, salt, 64);
  return timingSafeEqual(Buffer.from(key, 'hex'), test);
}
export const tokenHash = (value) => createHash('sha256').update(value).digest('hex');
