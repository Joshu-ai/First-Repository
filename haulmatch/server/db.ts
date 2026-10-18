import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/** SQLite bind values. node:sqlite rejects booleans and undefined, so convert before binding. */
export type SqlValue = string | number | bigint | null | Uint8Array;

export const bool = (value: boolean): number => (value ? 1 : 0);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('driver', 'shipper')),
  company TEXT,
  phone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS driver_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  driver_class TEXT NOT NULL CHECK (driver_class IN ('hotshot', 'semi')),
  equipment_types TEXT NOT NULL DEFAULT '[]',
  trailer_length_ft REAL NOT NULL,
  max_payload_lbs INTEGER NOT NULL,
  truck_description TEXT NOT NULL DEFAULT '',
  mc_number TEXT,
  dot_number TEXT,
  has_cdl INTEGER NOT NULL DEFAULT 0,
  cdl_class TEXT CHECK (cdl_class IN ('A', 'B')),
  endorsements TEXT NOT NULL DEFAULT '[]',
  team_driver INTEGER NOT NULL DEFAULT 0,
  current_city_id TEXT,
  home_city_id TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  available_from TEXT,
  max_deadhead_miles INTEGER NOT NULL,
  min_rate_per_mile REAL NOT NULL,
  preferred_states TEXT NOT NULL DEFAULT '[]',
  avoid_states TEXT NOT NULL DEFAULT '[]',
  mpg REAL NOT NULL,
  fuel_price REAL NOT NULL,
  rating REAL NOT NULL DEFAULT 0,
  completed_loads INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loads (
  id TEXT PRIMARY KEY,
  shipper_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'booked', 'in_transit', 'delivered', 'cancelled')),
  origin_city_id TEXT NOT NULL,
  dest_city_id TEXT NOT NULL,
  pickup_start TEXT NOT NULL,
  pickup_end TEXT NOT NULL,
  delivery_by TEXT,
  equipment_types TEXT NOT NULL,
  weight_lbs INTEGER NOT NULL,
  length_ft REAL NOT NULL,
  commodity TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  load_size TEXT NOT NULL DEFAULT 'full' CHECK (load_size IN ('full', 'partial')),
  hazmat INTEGER NOT NULL DEFAULT 0,
  tarp_required INTEGER NOT NULL DEFAULT 0,
  team_required INTEGER NOT NULL DEFAULT 0,
  rate_usd INTEGER NOT NULL,
  miles INTEGER NOT NULL,
  booking_mode TEXT NOT NULL DEFAULT 'request' CHECK (booking_mode IN ('instant', 'request')),
  reference_number TEXT,
  booked_driver_id TEXT REFERENCES users(id),
  booked_rate_usd INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  picked_up_at TEXT,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS loads_status ON loads(status, pickup_end);
CREATE INDEX IF NOT EXISTS loads_shipper ON loads(shipper_id, created_at);
CREATE INDEX IF NOT EXISTS loads_driver ON loads(booked_driver_id);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  load_id TEXT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'cancelled')),
  offer_rate_usd INTEGER,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_load ON bookings(load_id, status);
CREATE INDEX IF NOT EXISTS bookings_driver ON bookings(driver_id, status);
-- A driver can hold at most one live request per load.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_live ON bookings(load_id, driver_id) WHERE status IN ('pending', 'accepted');

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  load_id TEXT NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(load_id, driver_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  alerts_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_searches_user ON saved_searches(user_id);
`;

/** Open (creating if needed) and migrate a database. Pass ":memory:" for tests. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; rolls back if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function parseJsonArray<T = string>(text: unknown): T[] {
  if (typeof text !== 'string' || !text) return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}
