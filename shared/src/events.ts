/**
 * 领域事件与回忆类型（契约 §7：docs/superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md）
 *
 * 规则：
 * - eventId 幂等；服务端是最终权威；客户端忽略未知字段
 * - major schema 变化必须有迁移器（当前只接受 major 1）
 * - 动画失败不影响事件保存；未知动作按语义降级，禁止按 TapBody 下标取模
 */

/** 当前契约版本（major 必须为 1；minor/patch 前向兼容） */
export const EVENT_SCHEMA_VERSION = '1.0.0'

/** 互动事件类型：请求 → 接受 → 落定 */
export const INTERACTION_EVENT_TYPES = ['interaction.requested', 'interaction.accepted', 'interaction.settled'] as const
export type InteractionEventType = (typeof INTERACTION_EVENT_TYPES)[number]

/** 事件状态 */
export const INTERACTION_STATUSES = ['pending', 'accepted', 'settled', 'rejected'] as const
export type InteractionStatus = (typeof INTERACTION_STATUSES)[number]

/** 契约 §7 统一事件格式 */
export interface InteractionEvent {
  schemaVersion: string
  eventId: string
  type: InteractionEventType
  relationshipId: string
  senderId: string
  receiverId: string
  /** 动作标识（如 "wave"/"heart"），语义路由与降级由动作注册表负责 */
  actionId: string
  /** 双人编排事件才有值；单人互动为 null */
  choreographyId: string | null
  clientOccurredAt: string
  serverOccurredAt: string
  payload: Record<string, unknown>
  privacy: Record<string, unknown>
  status: InteractionStatus
}

/** 双人编排状态（契约 §8 状态机） */
export type SharedMomentState =
  | 'requested'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'playing'
  | 'completed'
  | 'partial'
  | 'failed'

/** SharedMoment：一次双人共同经历（编排执行产物） */
export interface SharedMoment {
  momentId: string
  choreographyId: string
  relationshipId: string
  /** 恰好 [senderId, receiverId] */
  participants: [string, string]
  actionId: string
  state: SharedMomentState
  /** 阶段标记（approach/contact/hold/release/return 各自完成时间） */
  phaseMarkers: Array<{ phase: string; at: string }>
  createdAt: string
  completedAt: string | null
  /** 关联生成的回忆（milestone） */
  memoryId?: string
}

/** 回忆种类 */
export const MEMORY_KINDS = ['interaction', 'shared_moment', 'milestone', 'anniversary'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

/** Memory：时间线上的共同回忆条目（支持软删除） */
export interface Memory {
  memoryId: string
  relationshipId: string
  kind: MemoryKind
  title: string
  description?: string
  occurredAt: string
  createdAt: string
  /** 软删除时间（契约要求可删除；保留可追溯） */
  deletedAt: string | null
  payload?: Record<string, unknown>
}
