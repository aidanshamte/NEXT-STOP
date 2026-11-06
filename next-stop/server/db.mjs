import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Versioned migrations. PRAGMA user_version records the last applied step.
// Every step must preserve existing rows. Step 1 is idempotent because
// databases created before versioning already contain its tables (user_version 0).
const migrations = [
  // 1: v0.3 schema (accounts, memberships, transport, email codes, Google).
  (db) => {
    db.exec(`
  CREATE TABLE IF NOT EXISTS institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memberships(user_id TEXT REFERENCES users(id),institution_id TEXT REFERENCES institutions(id),role TEXT NOT NULL CHECK(role IN ('student','driver','parent','admin')),approved INTEGER DEFAULT 0,PRIMARY KEY(user_id,institution_id));
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS stops(id TEXT PRIMARY KEY,institution_id TEXT REFERENCES institutions(id),name TEXT,lat REAL,lng REAL,position INTEGER);
  CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY,institution_id TEXT REFERENCES institutions(id),driver_id TEXT REFERENCES users(id),name TEXT,capacity INTEGER DEFAULT 24,active INTEGER DEFAULT 0,lat REAL,lng REAL,accuracy REAL,updated_at INTEGER,delay_minutes INTEGER DEFAULT 0,issue TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,institution_id TEXT REFERENCES institutions(id),student_id TEXT REFERENCES users(id),trip_id TEXT REFERENCES trips(id),stop_id TEXT REFERENCES stops(id),destination_id TEXT REFERENCES stops(id),status TEXT NOT NULL CHECK(status IN ('requested','accepted','boarded','arrived','cancelled')),created_at INTEGER NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS one_open_request ON requests(student_id,institution_id) WHERE status IN ('requested','accepted','boarded');
  CREATE TABLE IF NOT EXISTS shares(student_id TEXT REFERENCES users(id),parent_id TEXT REFERENCES users(id),institution_id TEXT REFERENCES institutions(id),PRIMARY KEY(student_id,parent_id,institution_id));`);
    const columns = db
      .prepare('PRAGMA table_info(users)')
      .all()
      .map((c) => c.name);
    if (!columns.includes('email_verified'))
      db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
    if (!columns.includes('google_sub')) db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
    if (!columns.includes('password_enabled'))
      db.exec('ALTER TABLE users ADD COLUMN password_enabled INTEGER NOT NULL DEFAULT 1');
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
    CREATE TABLE IF NOT EXISTS email_codes(email TEXT NOT NULL,purpose TEXT NOT NULL,hash TEXT NOT NULL,salt TEXT NOT NULL,expires_at INTEGER NOT NULL,sent_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(email,purpose));
    CREATE TABLE IF NOT EXISTS mail_limits(email TEXT NOT NULL,hour INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(email,hour));
    CREATE TABLE IF NOT EXISTS google_challenges(hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);`);
  },
  // 2: lookup indexes used by authorization, session revocation and expiry pruning.
  (db) => {
    db.exec(`CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS memberships_institution ON memberships(institution_id);
    CREATE INDEX IF NOT EXISTS requests_trip_status ON requests(trip_id,status);
    CREATE INDEX IF NOT EXISTS trips_institution ON trips(institution_id);`);
  },
  // 3: driver-set 'approaching' status (SQLite cannot alter a CHECK, so the table is
  // rebuilt with every row copied), status timestamps, and push notification tokens.
  (db) => {
    db.exec(`CREATE TABLE requests_v3(id TEXT PRIMARY KEY,institution_id TEXT REFERENCES institutions(id),student_id TEXT REFERENCES users(id),trip_id TEXT REFERENCES trips(id),stop_id TEXT REFERENCES stops(id),destination_id TEXT REFERENCES stops(id),status TEXT NOT NULL CHECK(status IN ('requested','accepted','approaching','boarded','arrived','cancelled')),created_at INTEGER NOT NULL,updated_at INTEGER);
    INSERT INTO requests_v3(id,institution_id,student_id,trip_id,stop_id,destination_id,status,created_at,updated_at)
      SELECT id,institution_id,student_id,trip_id,stop_id,destination_id,status,created_at,created_at FROM requests;
    DROP TABLE requests;
    ALTER TABLE requests_v3 RENAME TO requests;
    CREATE UNIQUE INDEX one_open_request ON requests(student_id,institution_id) WHERE status IN ('requested','accepted','approaching','boarded');
    CREATE INDEX requests_trip_status ON requests(trip_id,status);
    CREATE TABLE IF NOT EXISTS push_tokens(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_hash TEXT NOT NULL,platform TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens(user_id);
    CREATE TABLE IF NOT EXISTS push_tickets(id TEXT PRIMARY KEY,token TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  },
];
// Statuses in which a request holds a place and blocks a new request by the same student.
export const OPEN_STATUSES = ['requested', 'accepted', 'approaching', 'boarded'];
export const SCHEMA_VERSION = migrations.length;

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > SCHEMA_VERSION)
    throw Error(
      `Database schema ${current} is newer than this server (${SCHEMA_VERSION}). Deploy the matching or newer release.`,
    );
  for (let version = current; version < SCHEMA_VERSION; version++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      migrations[version](db);
      db.exec(`PRAGMA user_version=${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return SCHEMA_VERSION;
}

export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrate(db);
  return db;
}

// Removes expired credentials. Safe to run at any time.
export function pruneExpired(db, now = Date.now()) {
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
  db.prepare(
    'DELETE FROM push_tokens WHERE session_hash NOT IN (SELECT token_hash FROM sessions)',
  ).run();
  db.prepare('DELETE FROM email_codes WHERE expires_at<=?').run(now);
  db.prepare('DELETE FROM google_challenges WHERE expires_at<=?').run(now);
  db.prepare('DELETE FROM mail_limits WHERE hour<?').run(Math.floor(now / 3600000) - 24);
  // Expo keeps receipts for 24 hours; older tickets can no longer be checked.
  db.prepare('DELETE FROM push_tickets WHERE created_at<=?').run(now - 86400000);
}
