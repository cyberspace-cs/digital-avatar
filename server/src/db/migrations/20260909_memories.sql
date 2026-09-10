-- 20260909_memories.sql — V2.0 Jing/Tao 重构：共同回忆（Memory）与双人共同时刻（SharedMoment）
-- 幂等：全部 CREATE IF NOT EXISTS；由 db.js 迁移器按文件名记录到 schema_migrations，重复执行跳过。
-- 红线：本迁移只新增表/索引，不改动 growth/level/quest 相关结构（旧字段只读兼容，禁止写入）。

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  kind TEXT NOT NULL,                -- interaction | shared_moment | milestone | anniversary
  key TEXT,                          -- 幂等里程碑键：first_interaction / first_hug / anniv:<date>
  title TEXT NOT NULL,
  description TEXT,
  moment_id TEXT,                    -- 关联 shared_moments.id（可空）
  occurred_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  deleted_at TEXT                    -- 软删除（契约：可删除）
);

CREATE INDEX IF NOT EXISTS idx_memories_rel_time ON memories(relationship_id, occurred_at DESC);
-- 里程碑幂等：同一关系同一 key 只允许一条（只约束非空 key）
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_rel_key ON memories(relationship_id, key) WHERE key IS NOT NULL;

CREATE TABLE IF NOT EXISTS shared_moments (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  choreography_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'requested',  -- requested→accepted→preparing→ready→playing→completed|partial|failed
  phase_markers TEXT,                        -- JSON: [{phase, at}]
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_moments_rel_time ON shared_moments(relationship_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moments_state ON shared_moments(state);
