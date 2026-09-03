import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = new DatabaseSync(path.join(__dirname, '..', 'digital_avatar.db'))
db.exec('PRAGMA journal_mode = WAL;')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT DEFAULT 'hiyori',
  personality TEXT DEFAULT 'lively',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS bonds (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(user_a, user_b)
);
CREATE TABLE IF NOT EXISTS states (
  user_id TEXT PRIMARY KEY,
  mood TEXT DEFAULT 'neutral',
  visibility TEXT DEFAULT 'public',
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  action TEXT NOT NULL,
  message TEXT,
  state_snapshot TEXT,
  status TEXT DEFAULT 'delivered',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
`)

// ---------- V1.2 小火人化迁移（幂等）：bonds 加列 + growth_events 流水表 ----------
try { db.exec('ALTER TABLE bonds ADD COLUMN growth INTEGER DEFAULT 0;') } catch (_e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE bonds ADD COLUMN streak INTEGER DEFAULT 0;') } catch (_e) { /* 列已存在 */ }
try { db.exec('ALTER TABLE bonds ADD COLUMN last_active_day TEXT;') } catch (_e) { /* 列已存在 */ }
db.exec(`
CREATE TABLE IF NOT EXISTS growth_events (
  id TEXT PRIMARY KEY,
  bond_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_growth_events_bond_day ON growth_events(bond_id, day);
`)

export const q = {
  insertUser: db.prepare('INSERT INTO users (id, name) VALUES (?, ?)'),
  getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertBond: db.prepare('INSERT INTO bonds (id, user_a, user_b) VALUES (?, ?, ?)'),
  getBond: db.prepare(
    `SELECT * FROM bonds WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)`,
  ),
  bondsOf: db.prepare('SELECT * FROM bonds WHERE user_a = ? OR user_b = ?'),
  setState: db.prepare(
    `INSERT INTO states (user_id, mood, visibility) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET mood = excluded.mood, visibility = excluded.visibility, updated_at = datetime('now','localtime')`,
  ),
  getState: db.prepare('SELECT * FROM states WHERE user_id = ?'),
  insertEvent: db.prepare(
    'INSERT INTO events (id, sender_id, receiver_id, action, message, state_snapshot) VALUES (?, ?, ?, ?, ?, ?)',
  ),
  eventsFor: db.prepare(
    `SELECT * FROM events WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200`,
  ),
  // ---------- V1.2 火花成长 ----------
  updateBondGrowth: db.prepare(
    'UPDATE bonds SET growth = ?, streak = ?, last_active_day = ? WHERE id = ?',
  ),
  insertGrowthEvent: db.prepare(
    'INSERT INTO growth_events (id, bond_id, delta, reason, day) VALUES (?, ?, ?, ?, ?)',
  ),
  growthCountsOfDay: db.prepare(
    'SELECT reason, COUNT(*) AS n FROM growth_events WHERE bond_id = ? AND day = ? GROUP BY reason',
  ),
  growthEventExists: db.prepare(
    'SELECT 1 AS ok FROM growth_events WHERE bond_id = ? AND reason = ?',
  ),
  eventsOfDayForBond: db.prepare(
    `SELECT action, message, sender_id, receiver_id FROM events
     WHERE created_at >= ?
       AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`,
  ),
}

export function uuid() {
  return randomUUID()
}

export default db
