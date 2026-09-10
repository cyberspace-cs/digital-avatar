/**
 * 校验工具与领域对象运行时 schema（契约 §7 允许 "zod 或自定义"；本包采用零依赖自定义校验）
 * 校验原则：客户端忽略未知字段；错误一律抛 SchemaError 并带字段路径。
 */
import type { InteractionEvent, InteractionEventType, InteractionStatus, Memory, MemoryKind, SharedMoment, SharedMomentState } from './events.js'
import { EVENT_SCHEMA_VERSION, INTERACTION_EVENT_TYPES, INTERACTION_STATUSES, MEMORY_KINDS } from './events.js'
import { CHOREOGRAPHY_PHASES, CHOREOGRAPHY_STATES } from './choreography.js'
import type { AnchorName } from './assets.js'
import { ANCHOR_NAMES } from './assets.js'
import { SchemaError } from './errors.js'

export { SchemaError }

export { EVENT_SCHEMA_VERSION }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const issuesOf: { current: string[] | null } = { current: null }

/** 收集式断言：失败记录 issue 而不是立刻抛出，结束时统一抛 SchemaError */
function check(ok: boolean, message: string): void {
  if (!ok && issuesOf.current) issuesOf.current.push(message)
}

function finish(): void {
  const issues = issuesOf.current ?? []
  issuesOf.current = null
  if (issues.length > 0) throw new SchemaError(issues)
}

function begin(): void {
  issuesOf.current = []
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/
const ACTION_ID_RE = /^[a-z][a-z0-9_-]*$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/

export function isValidActionId(v: unknown): v is string {
  return typeof v === 'string' && ACTION_ID_RE.test(v)
}

function isIsoDateTime(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return false
  const t = Date.parse(v)
  return Number.isFinite(t)
}

/** schemaVersion 必须是 semver 且 major === 1（未知 major 拒绝；minor/patch 前向兼容） */
export function isSupportedSchemaVersion(v: unknown): v is string {
  if (typeof v !== 'string' || !SEMVER_RE.test(v)) return false
  const major = Number(v.split('.')[0])
  return major === Number(EVENT_SCHEMA_VERSION.split('.')[0])
}

/**
 * 解析并校验统一互动事件（契约 §7）。
 * 注意：未知字段被忽略（契约允许客户端忽略未知字段），payload/privacy 必须是对象。
 */
export function parseInteractionEvent(input: unknown): InteractionEvent {
  begin()
  try {
    if (!isRecord(input)) {
      throw new SchemaError(['事件必须是对象'])
    }
    check(isSupportedSchemaVersion(input.schemaVersion), 'schemaVersion 必须是受支持的 1.x.y semver')
    check(typeof input.eventId === 'string' && input.eventId.length > 0, 'eventId 必须是非空字符串')
    check(
      typeof input.type === 'string' && (INTERACTION_EVENT_TYPES as readonly string[]).includes(input.type),
      `type 必须是 ${INTERACTION_EVENT_TYPES.join('/')}`,
    )
    check(typeof input.relationshipId === 'string' && input.relationshipId.length > 0, 'relationshipId 必须是非空字符串')
    check(typeof input.senderId === 'string' && input.senderId.length > 0, 'senderId 必须是非空字符串')
    check(typeof input.receiverId === 'string' && input.receiverId.length > 0, 'receiverId 必须是非空字符串')
    check(isValidActionId(input.actionId), 'actionId 必须匹配 ^[a-z][a-z0-9_-]*$（禁止下标取模式数字/大写/空白）')
    check(
      input.choreographyId === null || (typeof input.choreographyId === 'string' && input.choreographyId.length > 0),
      'choreographyId 必须是 null 或非空字符串',
    )
    check(isIsoDateTime(input.clientOccurredAt), 'clientOccurredAt 必须是 ISO-8601 时间戳')
    check(isIsoDateTime(input.serverOccurredAt), 'serverOccurredAt 必须是 ISO-8601 时间戳')
    check(isRecord(input.payload), 'payload 必须是对象')
    check(isRecord(input.privacy), 'privacy 必须是对象')
    check(
      typeof input.status === 'string' && (INTERACTION_STATUSES as readonly string[]).includes(input.status),
      `status 必须是 ${INTERACTION_STATUSES.join('/')}`,
    )
    finish()
    return {
      schemaVersion: input.schemaVersion as string,
      eventId: input.eventId as string,
      type: input.type as InteractionEventType,
      relationshipId: input.relationshipId as string,
      senderId: input.senderId as string,
      receiverId: input.receiverId as string,
      actionId: input.actionId as string,
      choreographyId: (input.choreographyId ?? null) as string | null,
      clientOccurredAt: input.clientOccurredAt as string,
      serverOccurredAt: input.serverOccurredAt as string,
      payload: input.payload as Record<string, unknown>,
      privacy: input.privacy as Record<string, unknown>,
      status: input.status as InteractionStatus,
    }
  } catch (e) {
    issuesOf.current = null
    throw e
  }
}

/** 解析并校验 SharedMoment（双人共同经历） */
export function parseSharedMoment(input: unknown): SharedMoment {
  begin()
  try {
    if (!isRecord(input)) throw new SchemaError(['SharedMoment 必须是对象'])
    check(typeof input.momentId === 'string' && input.momentId.length > 0, 'momentId 必须是非空字符串')
    check(typeof input.choreographyId === 'string' && input.choreographyId.length > 0, 'choreographyId 必须是非空字符串')
    check(typeof input.relationshipId === 'string' && input.relationshipId.length > 0, 'relationshipId 必须是非空字符串')
    const participants = Array.isArray(input.participants) ? (input.participants as unknown[]) : null
    check(
      participants !== null &&
      participants.length === 2 &&
      participants.every((p) => typeof p === 'string' && p.length > 0),
      'participants 必须恰好是两个非空用户 id',
    )
    check(isValidActionId(input.actionId), 'actionId 必须匹配 ^[a-z][a-z0-9_-]*$')
    check(
      typeof input.state === 'string' && (CHOREOGRAPHY_STATES as readonly string[]).includes(input.state),
      `state 必须在编排状态机内: ${CHOREOGRAPHY_STATES.join('/')}`,
    )
    if (input.phaseMarkers !== undefined) {
      check(Array.isArray(input.phaseMarkers), 'phaseMarkers 必须是数组')
      const markers = Array.isArray(input.phaseMarkers) ? input.phaseMarkers : []
      for (const m of markers) {
        const rec = isRecord(m) ? m : {}
        check(CHOREOGRAPHY_PHASES.includes(rec.phase as never), `phaseMarkers 含未知 phase: ${String(rec.phase)}`)
        check(isIsoDateTime(rec.at), 'phaseMarkers[].at 必须是 ISO-8601 时间戳')
      }
    }
    check(isIsoDateTime(input.createdAt), 'createdAt 必须是 ISO-8601 时间戳')
    check(input.completedAt === null || input.completedAt === undefined || isIsoDateTime(input.completedAt), 'completedAt 必须是 ISO-8601 或 null')
    finish()
    return {
      momentId: input.momentId as string,
      choreographyId: input.choreographyId as string,
      relationshipId: input.relationshipId as string,
      participants: input.participants as [string, string],
      actionId: input.actionId as string,
      state: input.state as SharedMomentState,
      phaseMarkers: (input.phaseMarkers ?? []) as SharedMoment['phaseMarkers'],
      createdAt: input.createdAt as string,
      completedAt: (input.completedAt ?? null) as string | null,
    }
  } catch (e) {
    issuesOf.current = null
    throw e
  }
}

/** 解析并校验 Memory（回忆条目，软删除） */
export function parseMemory(input: unknown): Memory {
  begin()
  try {
    if (!isRecord(input)) throw new SchemaError(['Memory 必须是对象'])
    check(typeof input.memoryId === 'string' && input.memoryId.length > 0, 'memoryId 必须是非空字符串')
    check(typeof input.relationshipId === 'string' && input.relationshipId.length > 0, 'relationshipId 必须是非空字符串')
    check(
      typeof input.kind === 'string' && (MEMORY_KINDS as readonly string[]).includes(input.kind),
      `kind 必须是 ${MEMORY_KINDS.join('/')}`,
    )
    check(typeof input.title === 'string' && input.title.length > 0 && input.title.length <= 200, 'title 必须是 1~200 字符')
    check(input.description === undefined || typeof input.description === 'string', 'description 必须是字符串或缺省')
    check(isIsoDateTime(input.occurredAt), 'occurredAt 必须是 ISO-8601 时间戳')
    check(isIsoDateTime(input.createdAt), 'createdAt 必须是 ISO-8601 时间戳')
    check(input.deletedAt === null || input.deletedAt === undefined || isIsoDateTime(input.deletedAt), 'deletedAt 必须是 ISO-8601 或 null')
    check(input.payload === undefined || isRecord(input.payload), 'payload 必须是对象或缺省')
    finish()
    return {
      memoryId: input.memoryId as string,
      relationshipId: input.relationshipId as string,
      kind: input.kind as MemoryKind,
      title: input.title as string,
      description: input.description as string | undefined,
      occurredAt: input.occurredAt as string,
      createdAt: input.createdAt as string,
      deletedAt: (input.deletedAt ?? null) as string | null,
      payload: input.payload as Record<string, unknown> | undefined,
    }
  } catch (e) {
    issuesOf.current = null
    throw e
  }
}

/** 仅供类型/文档引用：统一锚点全集（真实校验在 assets.ts） */
export type { AnchorName }
export const KNOWN_ANCHOR_NAMES: readonly AnchorName[] = ANCHOR_NAMES
