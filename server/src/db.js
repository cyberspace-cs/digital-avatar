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

// ---------- V1.3 换装迁移（幂等）：users 加 style 列（穿搭风格） ----------
try { db.exec('ALTER TABLE users ADD COLUMN style TEXT DEFAULT \'default\';') } catch (_e) { /* 列已存在 */ }

// ---------- V1.5.0 衣橱 2.0 迁移（幂等）：users 加 outfit 列（款式，'base' = 原生） ----------
// 必须在 q 预编译语句之前执行，否则 updateUserOutfit 在无列的库上启动即炸
try { db.exec('ALTER TABLE users ADD COLUMN outfit TEXT DEFAULT \'base\';') } catch (_e) { /* 列已存在 */ }

// ---------- V1.5.0 形象迁移（幂等）：Mark（卡通小孩+禁美男条款）→ Chitose（官方男模） ----------
// 新用户初始分配不会再抽到 mark，老用户首次登录时这里把 avatar 一并纠正。
try { db.prepare(`UPDATE users SET avatar = 'chitose' WHERE avatar = 'mark'`).run() } catch (_e) { /* 表未就绪 */ }

export const q = {
  insertUser: db.prepare('INSERT INTO users (id, name, avatar) VALUES (?, ?, ?)'),
  getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertBond: db.prepare('INSERT INTO bonds (id, user_a, user_b) VALUES (?, ?, ?)'),
  getBond: db.prepare(
    // V1.4.3：双向匹配（四个占位符按 x,y,y,x 传参）。原 SQL 两个 OR 分支参数相同，
    // 只认 user_a=sender 的顺序——B 发起互动时查不到 bond，火花永不结算
    // （"喂食/送花没反应、火花不涨"的服务端根因）。
    `SELECT * FROM bonds WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)`,
  ),
  // V1.3.2：只取"最新"一条 bond —— 之前重复接受邀请会产生多条记录，
  // 旧测试 bond 会遮住新邀请（表现为"邀请链接没用"），这里按创建时间倒序兜底
  bondsOf: db.prepare(
    `SELECT * FROM bonds WHERE user_a = ? OR user_b = ?
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ),
  setState: db.prepare(
    `INSERT INTO states (user_id, mood, visibility) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET mood = excluded.mood, visibility = excluded.visibility, updated_at = datetime('now','localtime')`,
  ),
  getState: db.prepare('SELECT * FROM states WHERE user_id = ?'),
  insertEvent: db.prepare(
    'INSERT INTO events (id, sender_id, receiver_id, action, message, state_snapshot) VALUES (?, ?, ?, ?, ?, ?)',
  ),
  // V1.4.3 互动双链路幂等：socket 与 REST 兜底共用客户端生成的 eventId 去重
  getEvent: db.prepare('SELECT * FROM events WHERE id = ?'),
  eventsFor: db.prepare(
    `SELECT * FROM events WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200`,
  ),
  // ---------- V1.2 火花成长 ----------
  updateBondGrowth: db.prepare(
    'UPDATE bonds SET growth = ?, streak = ?, last_active_day = ? WHERE id = ?',
  ),
  // ---------- V1.3 换装 ----------
  updateUserAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
  updateUserStyle: db.prepare('UPDATE users SET style = ? WHERE id = ?'),
  // V1.5.0 衣橱 2.0：款式（整纹理替换，'base' = 原生）
  updateUserOutfit: db.prepare('UPDATE users SET outfit = ? WHERE id = ?'),
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
