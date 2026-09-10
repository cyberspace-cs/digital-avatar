/**
 * memories/service.js — 共同回忆（Memory）与双人共同时刻（SharedMoment）（V2.0 Task 2）
 *
 * 契约要点（§8 / §6 回忆页）：
 * - SharedMoment 状态机：requested → accepted → preparing → ready → playing → completed（partial/failed）
 * - 完成的 SharedMoment 自动落 milestone 回忆；"第一次互动/第一次拥抱"类里程碑按 key 幂等
 * - 回忆支持软删除（deletedAt），时间线倒序
 */
import { CHOREOGRAPHY_PHASES, CHOREOGRAPHY_STATES } from '@digital-avatar/shared'

export function createMemoriesService({ q, uuid, logger = console }) {
  const statements = {
    insertMemory: q.db.prepare(
      `INSERT OR IGNORE INTO memories (id, relationship_id, kind, key, title, description, moment_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    listMemories: q.db.prepare(
      `SELECT * FROM memories WHERE relationship_id = ? AND deleted_at IS NULL ORDER BY occurred_at DESC, rowid DESC LIMIT 500`,
    ),
    getMemory: q.db.prepare('SELECT * FROM memories WHERE id = ?'),
    softDeleteMemory: q.db.prepare(`UPDATE memories SET deleted_at = datetime('now','localtime') WHERE id = ? AND deleted_at IS NULL`),
    insertMoment: q.db.prepare(
      `INSERT INTO shared_moments (id, relationship_id, choreography_id, action_id, sender_id, receiver_id, state)
       VALUES (?, ?, ?, ?, ?, ?, 'requested')`,
    ),
    getMoment: q.db.prepare('SELECT * FROM shared_moments WHERE id = ?'),
    updateMomentState: q.db.prepare('UPDATE shared_moments SET state = ?, completed_at = ? WHERE id = ?'),
    updateMomentMarkers: q.db.prepare('UPDATE shared_moments SET phase_markers = ? WHERE id = ?'),
  }

  function memoryRow(row) {
    return {
      memoryId: row.id,
      relationshipId: row.relationship_id,
      kind: row.kind,
      key: row.key ?? null,
      title: row.title,
      description: row.description ?? null,
      momentId: row.moment_id ?? null,
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      deletedAt: row.deleted_at ?? null,
    }
  }

  function momentRow(row) {
    let markers = []
    try { markers = row.phase_markers ? JSON.parse(row.phase_markers) : [] } catch (_e) { /* 忽略坏数据 */ }
    return {
      momentId: row.id,
      relationshipId: row.relationship_id,
      choreographyId: row.choreography_id,
      actionId: row.action_id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      state: row.state,
      phaseMarkers: markers,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? null,
    }
  }

  /** 里程碑幂等落库：同 (relationship, key) 只一条；发生时间取当前 */
  function ensureMilestone(relationshipId, key, title, description = null, momentId = null) {
    const occurredAt = new Date().toISOString()
    const info = statements.insertMemory.run(uuid(), relationshipId, 'milestone', key, title, description, momentId, occurredAt)
    if (info.changes > 0) logger.log(`[memories] milestone unlocked: ${key} @ ${relationshipId}`)
    return info.changes > 0
  }

  // ---------- SharedMoment ----------
  /** 创建双人共同时刻（state=requested）。校验通过 shared schema（choreography/state 白名单）。 */
  function prepareSharedMoment({ relationshipId, choreographyId, actionId, senderId, receiverId }) {
    if (!relationshipId || !choreographyId || !actionId || !senderId || !receiverId) {
      return { error: 'relationshipId/choreographyId/actionId/senderId/receiverId required', moment: null }
    }
    const id = uuid()
    statements.insertMoment.run(id, relationshipId, choreographyId, actionId, senderId, receiverId)
    return { moment: momentRow(statements.getMoment.get(id)), error: null }
  }

  /** 推进状态机（含 partial/failed）。非法转移返回 error。 */
  function transitionMoment(momentId, nextState, phaseMarkers) {
    const row = statements.getMoment.get(momentId)
    if (!row) return { error: 'moment not found', moment: null }
    const cur = row.state
    const allowed = {
      requested: ['accepted', 'failed'],
      accepted: ['preparing', 'failed'],
      preparing: ['ready', 'failed'],
      ready: ['playing', 'partial', 'failed'],
      playing: ['completed', 'partial', 'failed', 'preparing'],
      completed: [],
      partial: [],
      failed: [],
    }
    if (!(CHOREOGRAPHY_STATES).includes(nextState)) return { error: 'invalid state', moment: null }
    if (!allowed[cur]?.includes(nextState)) return { error: `illegal transition ${cur} -> ${nextState}`, moment: null }

    if (Array.isArray(phaseMarkers)) {
      const bad = phaseMarkers.find((m) => !CHOREOGRAPHY_PHASES.includes(m.phase))
      if (bad) return { error: `unknown phase: ${bad.phase}`, moment: null }
      statements.updateMomentMarkers.run(JSON.stringify(phaseMarkers), momentId)
    }
    statements.updateMomentState.run(nextState, nextState === 'completed' ? new Date().toISOString() : null, momentId)
    const moment = momentRow(statements.getMoment.get(momentId))

    // 完成即落里程碑回忆（首次拥抱等按 actionId 定 key，幂等）
    if (nextState === 'completed') {
      try {
        const keyMap = { hug: 'first_hug' }
        const key = keyMap[moment.actionId] ?? `first_${moment.actionId}`
        ensureMilestone(moment.relationshipId, key, `第一次${LABELS[moment.actionId] ?? moment.actionId}`, null, moment.momentId)
      } catch (err) {
        logger.error('[memories] milestone persistence failed (moment persisted):', err?.message ?? err)
      }
    }
    return { moment, error: null }
  }

  // ---------- Memory ----------
  /** 手动创建回忆（anniversary 等）。key 冲突时返回已存在条目（幂等）。 */
  function createMemory({ relationshipId, kind, title, description = null, key = null, momentId = null, occurredAt = null }) {
    if (!relationshipId || !kind || !title) return { error: 'relationshipId/kind/title required', memory: null }
    const id = uuid()
    statements.insertMemory.run(id, relationshipId, kind, key, title, description, momentId, occurredAt ?? new Date().toISOString())
    const row = statements.getMemory.get(id)
    // INSERT OR IGNORE 撞唯一键（同 key）时取已有条目
    if (!row && key) {
      const found = q.db
        .prepare('SELECT id FROM memories WHERE relationship_id = ? AND key = ?')
        .get(relationshipId, key)
      return { memory: memoryRow(statements.getMemory.get(found.id)), error: null }
    }
    return { memory: row ? memoryRow(row) : null, error: row ? null : 'insert failed' }
  }

  function listMemories(relationshipId) {
    return statements.listMemories.all(relationshipId).map(memoryRow)
  }

  function softDeleteMemory(memoryId) {
    const info = statements.softDeleteMemory.run(memoryId)
    return { ok: info.changes > 0, error: info.changes > 0 ? null : 'memory not found' }
  }

  return { prepareSharedMoment, transitionMoment, createMemory, listMemories, softDeleteMemory, ensureMilestone }
}

export const LABELS = {
  hug: '拥抱',
  handhold: '牵手',
  'shoulder-lean': '靠肩',
  wave: '挥手',
  heart: '比心',
}
