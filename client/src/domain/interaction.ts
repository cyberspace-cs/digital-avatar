/**
 * domain/interaction.ts — 互动领域模型（V2.0 Task 3）
 *
 * 领域层不依赖渲染器与传输层：这里只定义"发一次互动"需要什么、
 * 以及如何把命令变成契约 §7 的线上载荷（wire payload）。
 * 传输编排（socket → REST 兜底）在 application/sendInteraction.ts。
 */
import { EVENT_SCHEMA_VERSION } from '@digital-avatar/shared'

/** 发送一次互动的命令（用例层输入） */
export interface SendInteractionCommand {
  senderId: string
  receiverId: string
  /** 双人编排事件必填；单人互动为 null */
  choreographyId?: string | null
  actionId: string
  /** 随动作附带的短句（气泡文案） */
  message?: string | null
  /** 可选：调用方已有 eventId（重试/补发场景必须复用，保证幂等） */
  eventId?: string
  clientOccurredAt?: string
  payload?: Record<string, unknown>
  privacy?: Record<string, unknown>
}

/** 客户端生成事件 id（幂等键；无 crypto.randomUUID 的旧内核回退时间+随机） */
export function newEventId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * 命令 → 线上载荷（Socket 与 REST 双链路同一形状）。
 * 服务端 normalize 兼容旧字段：action 为 actionId 的镜像，message 直传。
 */
export function toWirePayload(cmd: SendInteractionCommand): Record<string, unknown> {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: cmd.eventId ?? newEventId(),
    senderId: cmd.senderId,
    receiverId: cmd.receiverId,
    actionId: cmd.actionId,
    action: cmd.actionId,
    choreographyId: cmd.choreographyId ?? null,
    message: cmd.message ?? null,
    clientOccurredAt: cmd.clientOccurredAt ?? new Date().toISOString(),
    payload: cmd.payload ?? {},
    privacy: cmd.privacy ?? {},
  }
}
