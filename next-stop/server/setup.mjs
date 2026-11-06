import { parseArgs } from 'node:util';
import { randomUUID, randomBytes } from 'node:crypto';
import { openDatabase } from './db.mjs';
import { hashPassword } from './security.mjs';
const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    email: { type: 'string' },
    kind: { type: 'string', default: 'college' },
  },
});
if (
  !values.name?.trim() ||
  !values.email ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) ||
  !['school', 'college'].includes(values.kind)
) {
  console.error(
    'Usage: npm run setup -- --name "Your institution" --email "you@school.edu" --kind college',
  );
  process.exit(1);
}
const db = openDatabase(process.env.DATABASE_PATH || './data/next-stop.db');
const email = values.email.toLowerCase(),
  org = randomUUID(),
  userId = randomUUID(),
  password = randomBytes(18).toString('base64url');
const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
db.exec('BEGIN');
try {
  db.prepare('INSERT INTO institutions VALUES (?,?,?)').run(org, values.name.trim(), values.kind);
  if (!existing)
    db.prepare('INSERT INTO users(id,name,email,password) VALUES (?,?,?,?)').run(
      userId,
      'Transport Administrator',
      email,
      hashPassword(password),
    );
  db.prepare('INSERT INTO memberships VALUES (?,?,?,1)').run(existing?.id || userId, org, 'admin');
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
console.log(`Institution created: ${values.name}\nInstitution ID: ${org}\nAdministrator: ${email}`);
if (!existing) console.log(`Generated administrator password (save it privately): ${password}`);
else console.log('Use your existing account password.');
console.log(
  'Sign in, approve driver registrations, add your actual stops and assign shuttles in Dispatch. No fictional routes or coordinates were added.',
);
db.close();
