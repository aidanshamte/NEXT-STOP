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
  // 4: routes (services) with ordered stops, draft stops awaiting a confirmed boarding
  // point, and stable import keys so institution data imports can be re-run safely.
  // Existing stops were entered by administrators with real coordinates: confirmed.
  (db) => {
    db.exec(`ALTER TABLE stops ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('draft','confirmed'));
    ALTER TABLE stops ADD COLUMN import_key TEXT;
    ALTER TABLE stops ADD COLUMN note TEXT NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX stops_import_key ON stops(institution_id,import_key) WHERE import_key IS NOT NULL;
    CREATE TABLE routes(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),name TEXT NOT NULL,color TEXT NOT NULL DEFAULT '#11243A',position INTEGER NOT NULL DEFAULT 0,import_key TEXT,source TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX routes_import_key ON routes(institution_id,import_key) WHERE import_key IS NOT NULL;
    CREATE TABLE route_stops(route_id TEXT NOT NULL REFERENCES routes(id),position INTEGER NOT NULL,stop_id TEXT NOT NULL REFERENCES stops(id),on_demand INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(route_id,position));
    ALTER TABLE trips ADD COLUMN route_id TEXT REFERENCES routes(id);`);
  },
  // 5: rider services. Institution settings (time zone, request expiry); request cancel
  // reasons; a driver-confirmed onboard count per vehicle (seeded from riders currently on
  // board) and vehicle features; admin-verified stop details and photos; favorites and
  // notification preferences; service alerts; and timetables (service periods, closures and
  // notes, departures per route, scheduled minutes from the first stop).
  (db) => {
    db.exec(`CREATE TABLE institution_settings(institution_id TEXT PRIMARY KEY REFERENCES institutions(id),timezone TEXT NOT NULL DEFAULT '',request_expiry_minutes INTEGER NOT NULL DEFAULT 30,updated_at INTEGER);
    ALTER TABLE requests ADD COLUMN cancel_reason TEXT;
    ALTER TABLE requests ADD COLUMN approach_notified INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE trips ADD COLUMN onboard INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE trips ADD COLUMN onboard_updated_at INTEGER;
    ALTER TABLE trips ADD COLUMN onboard_source TEXT NOT NULL DEFAULT 'events';
    ALTER TABLE trips ADD COLUMN features TEXT NOT NULL DEFAULT '[]';
    UPDATE trips SET onboard=(SELECT count(*) FROM requests r WHERE r.trip_id=trips.id AND r.status='boarded');
    ALTER TABLE stops ADD COLUMN description TEXT NOT NULL DEFAULT '';
    ALTER TABLE stops ADD COLUMN accessibility TEXT NOT NULL DEFAULT '';
    ALTER TABLE stops ADD COLUMN amenities TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE stops ADD COLUMN details_verified_at INTEGER;
    ALTER TABLE stops ADD COLUMN details_verified_by TEXT;
    CREATE TABLE stop_photos(stop_id TEXT PRIMARY KEY REFERENCES stops(id),institution_id TEXT NOT NULL REFERENCES institutions(id),data BLOB NOT NULL,content_type TEXT NOT NULL,updated_at INTEGER NOT NULL);
    ALTER TABLE route_stops ADD COLUMN offset_minutes INTEGER;
    CREATE TABLE favorites(user_id TEXT NOT NULL REFERENCES users(id),institution_id TEXT NOT NULL REFERENCES institutions(id),kind TEXT NOT NULL CHECK(kind IN ('stop','route')),target_id TEXT NOT NULL,label TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,PRIMARY KEY(user_id,institution_id,kind,target_id));
    CREATE TABLE notification_prefs(user_id TEXT NOT NULL REFERENCES users(id),institution_id TEXT NOT NULL REFERENCES institutions(id),trip_updates INTEGER NOT NULL DEFAULT 1,delay_alerts INTEGER NOT NULL DEFAULT 1,service_alerts INTEGER NOT NULL DEFAULT 1,approach_stops INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(user_id,institution_id));
    CREATE TABLE service_alerts(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),route_id TEXT REFERENCES routes(id),severity TEXT NOT NULL CHECK(severity IN ('info','delay','interruption')),title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',starts_at INTEGER NOT NULL,ends_at INTEGER,created_by TEXT,created_at INTEGER NOT NULL,resolved_at INTEGER);
    CREATE INDEX service_alerts_org ON service_alerts(institution_id,resolved_at);
    CREATE TABLE service_periods(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),name TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,days TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE service_exceptions(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),date TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('closed','note')),route_id TEXT REFERENCES routes(id),note TEXT NOT NULL DEFAULT '');
    CREATE INDEX service_exceptions_date ON service_exceptions(institution_id,date);
    CREATE TABLE departures(route_id TEXT NOT NULL REFERENCES routes(id),period_id TEXT NOT NULL REFERENCES service_periods(id),minute INTEGER NOT NULL CHECK(minute BETWEEN 0 AND 1439),PRIMARY KEY(route_id,period_id,minute));`);
  },
  // 6: arrival estimates. The last route position a vehicle passed (by GPS at a confirmed stop
  // pin) and stop-to-stop travel times. No coordinates or driver identity are stored with them.
  (db) => {
    db.exec(`ALTER TABLE trips ADD COLUMN progress_position INTEGER;
    ALTER TABLE trips ADD COLUMN progress_at INTEGER;
    ALTER TABLE trips ADD COLUMN progress_route_id TEXT;
    CREATE TABLE segment_times(id INTEGER PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),route_id TEXT NOT NULL REFERENCES routes(id),from_position INTEGER NOT NULL,to_position INTEGER NOT NULL,seconds INTEGER NOT NULL,recorded_at INTEGER NOT NULL);
    CREATE INDEX segment_times_lookup ON segment_times(route_id,from_position,to_position,recorded_at);`);
  },
  // 7: rider passes, safety and coordination. Every feature here is off until an institution
  // administrator turns it on. Passes hold a per-pass secret for rotating codes; scans are
  // audited. Shares gain a start time and an optional end (one ride, or a time limit).
  (db) => {
    db.exec(`ALTER TABLE institution_settings ADD COLUMN passes_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE institution_settings ADD COLUMN incidents_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE institution_settings ADD COLUMN escorts_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE institution_settings ADD COLUMN shared_rides_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE institution_settings ADD COLUMN emergency_number TEXT NOT NULL DEFAULT '';
    ALTER TABLE institution_settings ADD COLUMN escort_note TEXT NOT NULL DEFAULT '';
    CREATE TABLE institution_contacts(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),label TEXT NOT NULL,phone TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('safety','transport','escort','other')),hours TEXT NOT NULL DEFAULT '',sms INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE passes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),institution_id TEXT NOT NULL REFERENCES institutions(id),short TEXT NOT NULL,secret TEXT NOT NULL,created_at INTEGER NOT NULL,revoked_at INTEGER,failures INTEGER NOT NULL DEFAULT 0,failure_window INTEGER);
    CREATE UNIQUE INDEX passes_short ON passes(institution_id,short);
    CREATE UNIQUE INDEX passes_active ON passes(user_id,institution_id) WHERE revoked_at IS NULL;
    CREATE TABLE pass_scans(id INTEGER PRIMARY KEY,institution_id TEXT NOT NULL,pass_id TEXT,trip_id TEXT,scanned_by TEXT,result TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE INDEX pass_scans_org ON pass_scans(institution_id,at);
    ALTER TABLE shares ADD COLUMN created_at INTEGER;
    ALTER TABLE shares ADD COLUMN expires_at INTEGER;
    ALTER TABLE shares ADD COLUMN request_id TEXT;
    CREATE TABLE incidents(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),reporter_id TEXT REFERENCES users(id),category TEXT NOT NULL,description TEXT NOT NULL,trip_id TEXT,stop_id TEXT,subject_id TEXT,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),staff_note TEXT NOT NULL DEFAULT '',handled_by TEXT,updated_at INTEGER NOT NULL);
    CREATE INDEX incidents_org ON incidents(institution_id,status);
    CREATE TABLE escorts(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),rider_id TEXT NOT NULL REFERENCES users(id),stop_id TEXT,destination TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('requested','accepted','declined','completed','cancelled')),staff_note TEXT NOT NULL DEFAULT '',handled_by TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX escorts_open ON escorts(rider_id,institution_id) WHERE status IN ('requested','accepted');
    CREATE TABLE ride_intents(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),user_id TEXT NOT NULL REFERENCES users(id),from_stop TEXT NOT NULL,to_stop TEXT NOT NULL,leave_after INTEGER NOT NULL,leave_before INTEGER NOT NULL,group_id TEXT,created_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX ride_intents_one ON ride_intents(user_id,institution_id);
    CREATE TABLE ride_blocks(blocker_id TEXT NOT NULL REFERENCES users(id),blocked_id TEXT NOT NULL REFERENCES users(id),institution_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(blocker_id,blocked_id,institution_id));`);
  },
  // 8: how each boarding point was set (device location, map, or an approved researched
  // suggestion) and by whom, and checks of shown arrival estimates against real passages.
  (db) => {
    db.exec(`ALTER TABLE stops ADD COLUMN pin_source TEXT NOT NULL DEFAULT '';
    ALTER TABLE stops ADD COLUMN pinned_by TEXT;
    ALTER TABLE stops ADD COLUMN pinned_at INTEGER;
    CREATE TABLE estimate_checks(id INTEGER PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),route_id TEXT NOT NULL,trip_id TEXT NOT NULL,from_position INTEGER NOT NULL,target_position INTEGER NOT NULL,made_at INTEGER NOT NULL,low INTEGER NOT NULL,mid INTEGER NOT NULL,high INTEGER NOT NULL,samples INTEGER NOT NULL,actual INTEGER,resolved_at INTEGER);
    CREATE INDEX estimate_checks_open ON estimate_checks(trip_id,target_position) WHERE resolved_at IS NULL;
    CREATE INDEX estimate_checks_org ON estimate_checks(institution_id,route_id,made_at);`);
  },
  // 9: map markers. The vehicle type an administrator saved (blank until set; the map never
  // guesses it) and the GPS heading of the latest fix, kept only when the device reported a
  // valid heading while moving.
  (db) => {
    db.exec(`ALTER TABLE trips ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT '' CHECK(vehicle_type IN ('','bus','shuttle'));
    ALTER TABLE trips ADD COLUMN heading REAL;`);
  },
  // 10: boarding assistance on the existing pickup request, and administrator-confirmed
  // vehicle accessibility (available / unavailable / unknown; never inferred). A vehicle whose
  // administrator had ticked "Wheelchair ramp" or "Wheelchair lift" starts as available.
  // Assistance rows close with their request: cancelling the pickup cancels the assistance,
  // and the rider's note and any staff message are erased when the request ends.
  (db) => {
    db.exec(`ALTER TABLE trips ADD COLUMN access_ramp TEXT NOT NULL DEFAULT 'unknown' CHECK(access_ramp IN ('available','unavailable','unknown'));
    ALTER TABLE trips ADD COLUMN access_space TEXT NOT NULL DEFAULT 'unknown' CHECK(access_space IN ('available','unavailable','unknown'));
    UPDATE trips SET access_ramp='available' WHERE features LIKE '%"ramp"%' OR features LIKE '%"lift"%';
    CREATE TABLE request_assistance(
      request_id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
      institution_id TEXT NOT NULL REFERENCES institutions(id),
      needs TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','acknowledged','unable','withdrawn','cancelled','closed')),
      attention TEXT NOT NULL DEFAULT '' CHECK(attention IN ('','driver_unable','vehicle_unavailable','vehicle_unknown')),
      ack_by TEXT,
      ack_version INTEGER,
      ack_at INTEGER,
      unable_by TEXT,
      unable_at INTEGER,
      staff_note TEXT NOT NULL DEFAULT '',
      staff_by TEXT,
      staff_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL);
    CREATE INDEX request_assistance_org ON request_assistance(institution_id,status);
    CREATE TRIGGER request_assistance_close AFTER UPDATE OF status ON requests
      WHEN NEW.status IN ('cancelled','arrived') BEGIN
        UPDATE request_assistance
          SET status=CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'closed' END,
              note='',staff_note='',attention='',updated_at=COALESCE(NEW.updated_at,OLD.updated_at)
          WHERE request_id=NEW.id AND status IN ('pending','acknowledged','unable');
        UPDATE request_assistance SET note='',staff_note=''
          WHERE request_id=NEW.id AND (note<>'' OR staff_note<>'');
      END;`);
  },
];
// Statuses in which a request holds a place and blocks a new request by the same student.
export const OPEN_STATUSES = ['requested', 'accepted', 'approaching', 'boarded'];
export const SCHEMA_VERSION = migrations.length;

// `target` lets tests build a genuine older schema; production always migrates fully.
export function migrate(db, target = SCHEMA_VERSION) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > SCHEMA_VERSION)
    throw Error(
      `Database schema ${current} is newer than this server (${SCHEMA_VERSION}). Deploy the matching or newer release.`,
    );
  for (let version = current; version < target; version++) {
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
  // Travel-time history for arrival estimates is kept for 60 days.
  db.prepare('DELETE FROM segment_times WHERE recorded_at<?').run(now - 60 * 86400000);
  db.prepare('DELETE FROM estimate_checks WHERE made_at<?').run(now - 60 * 86400000);
}
