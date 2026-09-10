/**
 * events/service.js — 统一互动事件结算（V2.0 Task 2）
 *
 * 契约要点（docs/superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md §7/§10）：
 * - eventId 幂等：Socket 与 REST 双链路共用，重复事件不重复写入
 * - 服务端是最终权威：serverOccurredAt/status 由服务端定
 * - 动画失败不影响事件保存：先落库，后副作用（推送/里程碑），副作用异常只记日志
 * - 未知动作不拒绝：格式合法即落库，语义降级由客户端动作注册表负责（禁止下标取模）
 * - 红线：本服务不写 growth/level/quest（旧字段只读兼容，读取见 modules/bond/legacy.js）
 *
 * 兼容：旧客户端载荷 {senderId, receiverId, action, message, eventId} 自动映射为统一事件格式。
 */
import { parseInteractionEvent, EVENT_SCHEMA_VERSION } from '@digital-avatar/shared'

export function createEventsService({ q, uuid, logger = console }) {
  /** 旧载荷 → 统一事件格式（契约 §7） */
  function normalize(input = {}) {
    if (input.schemaVersion) {
      // 新契约载荷（客户端 toWirePayload）：type/status/relationshipId 是服务端权威字段，
      // 客户端不传 → 这里补齐缺省值再校验（此前直接原样返回，schema 校验必拒 → socket 链路静默丢弃）
      return {
        ...input,
        type: input.type ?? 'interaction.requested',
        status: input.status ?? 'accepted',
        choreographyId: input.choreographyId ?? null,
        clientOccurredAt: input.clientOccurredAt ?? new Date().toISOString(),
        payload: {
          ...(input.payload ?? {}),
          // 顶层 message（新载荷）合并进 payload，统一走 payload.message 存取
          ...(input.message != null ? { message: input.message } : {}),
        },
        privacy: input.privacy ?? {},
      }
    }
    return {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: input.eventId || uuid(),
      type: 'interaction.requested',
      // relationshipId 尽量取 bond id；无 bond 时给稳定合成键（schema 要求非空）
      relationshipId: null, // 在 settle 里查 bond 后回填
      senderId: input.senderId,
      receiverId: input.receiverId,
      actionId: input.action ?? input.actionId,
      choreographyId: input.choreographyId ?? null,
      clientOccurredAt: input.clientOccurredAt ?? new Date().toISOString(),
      serverOccurredAt: null, // 服务端权威，落库前生成
      payload: { message: input.message ?? null, ...(input.payload ?? {}) },
      privacy: input.privacy ?? {},
      status: input.status ?? 'accepted',
    }
  }

  function rowToEvent(row) {
    let payload = {}
    try { payload = row.state_snapshot ? JSON.parse(row.state_snapshot) : {} } catch (_e) { /* 旧行非 JSON */ }
    return {
      id: row.id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      action: row.action,
      message: row.message,
      stateSnapshot: payload,
      status: row.status,
      createdAt: row.created_at,
    }
  }

  /**
   * 结算一次互动。
   * @returns {event, growth: null, duplicate, error?} growth 恒为 null（红线：停止成长写入，保留字段兼容旧客户端读取）
   */
  function settleInteraction(input = {}) {
    if (!input.senderId && !input.receiverId && !input.action && !input.actionId) {
      return { event: null, growth: null, duplicate: false, error: 'senderId/receiverId/actionId required' }
    }
    const merged = normalize(input)
    // relationshipId 回填（bond 双向匹配 x,y,y,x）
    const bond = q.getBond.get(merged.senderId, merged.receiverId, merged.receiverId, merged.senderId)
    if (!merged.relationshipId) merged.relationshipId = bond ? bond.id : `unbonded:${merged.senderId}:${merged.receiverId}`
    merged.serverOccurredAt = new Date().toISOString()

    // 幂等：同 eventId 只结算一次（服务端最终权威）
    const existed = q.getEvent.get(merged.eventId)
    if (existed) {
      return { event: rowToEvent(existed), growth: null, duplicate: true }
    }

    // 统一 schema 校验（无效载荷拒绝结算，但按项目规约返回 200 JSON）
    let event
    try {
      event = parseInteractionEvent(merged)
    } catch (e) {
      return { event: null, growth: null, duplicate: false, error: 'invalid_event', issues: e.issues ?? [e.message] }
    }

    // ---- 先落库（契约：动画失败不影响事件保存）----
    // state_snapshot 兼容两层：顶层保留旧格式 {mood, visibility}（v1.6 时间线读取），
    // 统一事件全文放在 unified 字段（V2.0 回放读取）
    const receiverState = q.getState.get(event.receiverId)
    const snapshot = {
      mood: receiverState?.mood ?? 'neutral',
      visibility: receiverState?.visibility ?? 'public',
      payload: event.payload,
      privacy: event.privacy,
      unified: event,
    }
    q.insertEvent.run(
      event.eventId,
      event.senderId,
      event.receiverId,
      event.actionId,
      event.payload?.message ?? null,
      JSON.stringify(snapshot),
    )

    // ---- 后副作用：单个失败不影响已保存的事件 ----
    try {
      hooks.onSettled?.({ event, bond })
    } catch (err) {
      logger.error('[events] post-settle hook failed (event persisted):', err?.message ?? err)
    }

    const out = {
      event: {
        ...event,
        // 兼容旧客户端字段
        id: event.eventId,
        action: event.actionId,
        message: event.payload?.message ?? null,
        createdAt: new Date().toLocaleString('sv-SE').replace('T', ' '),
      },
      growth: null,
      duplicate: false,
    }
    return out
  }

  /** 结算后钩子（index.js 注入：socket 推送 / 里程碑落库）。任何异常都不得冒泡。 */
  let hooks = {}
  function setHooks(next) {
    hooks = next ?? {}
  }

  function listEvents(userId) {
    return q.eventsFor.all(userId, userId)
  }

  return { settleInteraction, setHooks, listEvents, rowToEvent, q }
}
