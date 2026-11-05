import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memberships(user_id TEXT REFERENCES users(id),institution_id TEXT REFERENCES institutions(id),role TEXT NOT NULL CHECK(role IN ('student','driver','parent','admin')),approved INTEGER DEFAULT 0,PRIMARY KEY(user_id,institution_id));
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS stops(id TEXT PRIMARY KEY,institution_id TEXT REFERENCES institutions(id),name TEXT,lat REAL,lng REAL,position INTEGER);
  CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY,institution_id TEXT REFERENCES institutions(id),driver_id TEXT REFERENCES users(id),name TEXT,capacity INTEGER DEFAULT 24,active INTEGER DEFAULT 0,lat REAL,lng REAL,accuracy REAL,updated_at INTEGER,delay_minutes INTEGER DEFAULT 0,issue TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,institution_id TEXT REFERENCES institutions(id),student_id TEXT REFERENCES users(id),trip_id TEXT REFERENCES trips(id),stop_id TEXT REFERENCES stops(id),destination_id TEXT REFERENCES stops(id),status TEXT NOT NULL CHECK(status IN ('requested','accepted','boarded','arrived','cancelled')),created_at INTEGER NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS one_open_request ON requests(student_id,institution_id) WHERE status IN ('requested','accepted','boarded');
  CREATE TABLE IF NOT EXISTS shares(student_id TEXT REFERENCES users(id),parent_id TEXT REFERENCES users(id),institution_id TEXT REFERENCES institutions(id),PRIMARY KEY(student_id,parent_id,institution_id));`);
  return db;
}
