import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BASE_SCHEMA = `
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
`

/** 旧版本列兼容迁移（幂等）：growth/streak/last_active_day/style/outfit —— V2.0 起只读，不再写入 */
function runLegacyAlters(db) {
  try { db.exec('ALTER TABLE bonds ADD COLUMN growth INTEGER DEFAULT 0;') } catch (_e) { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bonds ADD COLUMN streak INTEGER DEFAULT 0;') } catch (_e) { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bonds ADD COLUMN last_active_day TEXT;') } catch (_e) { /* 列已存在 */ }
  try { db.exec(`ALTER TABLE users ADD COLUMN style TEXT DEFAULT 'default';`) } catch (_e) { /* 列已存在 */ }
  try { db.exec(`ALTER TABLE users ADD COLUMN outfit TEXT DEFAULT 'base';`) } catch (_e) { /* 列已存在 */ }
  try { db.exec(`UPDATE users SET avatar = 'chitose' WHERE avatar = 'mark'`) } catch (_e) { /* 表未就绪 */ }
}

/** 迁移器：按文件名顺序执行 src/db/migrations/*.sql，schema_migrations 记录（幂等，事务包裹） */
function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now', 'localtime'))
  );`)
  const dir = path.join(__dirname, 'db', 'migrations')
  if (!fs.existsSync(dir)) return
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name))
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    db.exec('BEGIN;')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file)
      db.exec('COMMIT;')
    } catch (err) {
      db.exec('ROLLBACK;')
      throw err
    }
  }
}

function createQueries(db) {
  return {
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
    // ---------- V1.3 换装 ----------
    updateUserAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
    updateUserStyle: db.prepare('UPDATE users SET style = ? WHERE id = ?'),
    // V1.5.0 衣橱 2.0：款式（整纹理替换，'base' = 原生）
    updateUserOutfit: db.prepare('UPDATE users SET outfit = ? WHERE id = ?'),
    // V2.0 Task 7 解绑流程：删 bond 行（回忆时间线按 relationshipId 保留，不级联删）
    unbindBond: db.prepare('DELETE FROM bonds WHERE id = ?'),
  }
}

/**
 * 组装一份完整的存储。
 * - 生产：createStore() 默认文件库
 * - 测试：createStore(':memory:')
 * 步骤：基础表 → 旧列兼容 → 迁移文件 → 预编译语句
 * （预编译必须在列迁移之后，否则启动即 "no such column"）
 */
export function createStore(dbPath = path.join(__dirname, '..', 'digital_avatar.db')) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(BASE_SCHEMA)
  // growth_events 表（V1.2 火花）不再创建：V2.0 无任何读写消费方；
  // 旧库升级时该表原地保留（无人访问，无副作用）
  runLegacyAlters(db)
  runMigrations(db)
  const queries = createQueries(db)
  queries.db = db // 模块化服务（memories 等）自建语句时复用同一连接
  return { db, q: queries, uuid: () => randomUUID() }
}

// 生产单例（index.js 直接 import { q, uuid } 使用，保持历史行为不变）。
// vitest 环境不预开文件库：测试各自 createStore(':memory:')，
// 并行 worker 若都打开同一个 WAL 文件库会互相锁死（database is locked）
const store = process.env.VITEST ? null : createStore()
export const db = store?.db ?? null
export const q = store?.q ?? null
export function uuid() {
  return randomUUID()
}
export default db
