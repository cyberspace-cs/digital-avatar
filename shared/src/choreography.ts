/**
 * 双人编排类型与状态机（契约 §8）
 *
 * 状态机：requested → accepted → preparing → ready → playing → completed
 *                                                  ↘ partial / failed（ready/playing 可失败；playing 可回退 preparing 重试）
 * 阶段固定：approach → contact → hold → release → return（顺序不可变）
 * 同步机制：只同步开始时间与阶段标记，禁止逐帧同步 Cubism 参数。
 */
import type { ActionCapability } from './assets.js'

/** 编排五阶段（固定顺序，契约 §8） */
export const CHOREOGRAPHY_PHASES = ['approach', 'contact', 'hold', 'release', 'return'] as const
export type ChoreographyPhase = (typeof CHOREOGRAPHY_PHASES)[number]

/** 编排状态（契约 §8 主链 + 失败态） */
export const CHOREOGRAPHY_STATES = [
  'requested',
  'accepted',
  'preparing',
  'ready',
  'playing',
  'completed',
  'partial',
  'failed',
] as const
export type ChoreographyState = (typeof CHOREOGRAPHY_STATES)[number]

/** 状态机合法转移表 */
const TRANSITIONS: Record<ChoreographyState, readonly ChoreographyState[]> = {
  requested: ['accepted', 'failed'],
  accepted: ['preparing', 'failed'],
  preparing: ['ready', 'failed'],
  ready: ['playing', 'partial', 'failed'],
  playing: ['completed', 'partial', 'failed', 'preparing'],
  completed: [],
  partial: [],
  failed: [],
}

/** 是否允许从 current 转移到 next */
export function canTransitionChoreographyState(current: ChoreographyState, next: ChoreographyState): boolean {
  return TRANSITIONS[current]?.includes(next) ?? false
}

/** 编排定义：一次双人动作的静态描述（阶段时长 + 各角色能力要求） */
export interface ChoreographyDefinition {
  choreographyId: string
  actionId: string
  /** 恰好两个角色，如 ['initiator', 'receiver'] */
  roles: [string, string]
  /** 必须是固定的五阶段且顺序不可变 */
  phases: readonly ChoreographyPhase[]
  /** 每阶段时长（ms，30fps 动作按帧换算），必须覆盖五阶段且为正数 */
  perPhaseMs: Record<ChoreographyPhase, number>
  /** 每个角色必须具备的 actionId 能力（用于 prepare 阶段能力协商） */
  requires: Record<string, string[]>
}

/** 编排执行计划：由 createChoreography(actionId, participants) 生成（Task 3/6 消费） */
export interface ChoreographyPlan {
  choreographyId: string
  actionId: string
  participants: [string, string]
  /** 计划阶段时间轴（ms 起点），由 perPhaseMs 累加得到 */
  timeline: Array<{ phase: ChoreographyPhase; startMs: number; endMs: number }>
  requires: Record<string, string[]>
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const ACTION_ID_RE = /^[a-z][a-z0-9_-]*$/

import { SchemaError } from './errors.js'

export { SchemaError }

/** 校验编排定义：phases 顺序不可变、perPhaseMs 全覆盖、requires 覆盖全部 roles */
export function parseChoreographyDefinition(input: unknown): ChoreographyDefinition {
  if (!isRecord(input)) throw new SchemaError(['ChoreographyDefinition 必须是对象'])
  const issues: string[] = []

  if (typeof input.choreographyId !== 'string' || input.choreographyId.length === 0) {
    issues.push('choreographyId 必须是非空字符串')
  }
  if (typeof input.actionId !== 'string' || !ACTION_ID_RE.test(input.actionId)) {
    issues.push(`actionId 非法: ${JSON.stringify(input.actionId ?? null)}`)
  }
  const roles = Array.isArray(input.roles) ? (input.roles as unknown[]) : null
  if (
    !roles ||
    roles.length !== 2 ||
    !roles.every((r) => typeof r === 'string' && r.length > 0)
  ) {
    issues.push('roles 必须恰好是两个非空角色名')
  }
  const phases = Array.isArray(input.phases) ? (input.phases as unknown[]) : null
  if (
    !phases ||
    phases.length !== CHOREOGRAPHY_PHASES.length ||
    !CHOREOGRAPHY_PHASES.every((p, i) => phases[i] === p)
  ) {
    issues.push(`phases 必须是固定五阶段且顺序不可变: ${CHOREOGRAPHY_PHASES.join('→')}`)
  }
  if (!isRecord(input.perPhaseMs)) {
    issues.push('perPhaseMs 必须是对象')
  } else {
    for (const p of CHOREOGRAPHY_PHASES) {
      const v = input.perPhaseMs[p]
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) issues.push(`perPhaseMs.${p} 必须是正数`)
    }
  }
  if (!isRecord(input.requires)) {
    issues.push('requires 必须是对象')
  } else if (Array.isArray(input.roles)) {
    for (const role of input.roles as string[]) {
      const reqs = input.requires[role]
      if (!Array.isArray(reqs) || !reqs.every((a) => typeof a === 'string' && ACTION_ID_RE.test(a))) {
        issues.push(`requires.${role} 必须是合法 actionId 数组`)
      }
    }
    for (const role of Object.keys(input.requires)) {
      if (!(input.roles as string[]).includes(role)) issues.push(`requires 含未知角色: ${role}`)
    }
  }

  if (issues.length > 0) throw new SchemaError(issues)
  return {
    choreographyId: input.choreographyId as string,
    actionId: input.actionId as string,
    roles: input.roles as [string, string],
    phases: input.phases as ChoreographyDefinition['phases'],
    perPhaseMs: input.perPhaseMs as ChoreographyDefinition['perPhaseMs'],
    requires: input.requires as Record<string, string[]>,
  }
}

/** 由定义生成阶段时间轴计划 */
export function toPlan(
  def: ChoreographyDefinition,
  choreographyId: string,
  participants: [string, string],
): ChoreographyPlan {
  let cursor = 0
  const timeline = def.phases.map((phase) => {
    const startMs = cursor
    cursor += def.perPhaseMs[phase]
    return { phase, startMs, endMs: cursor }
  })
  return { choreographyId, actionId: def.actionId, participants, timeline, requires: def.requires }
}

/** 能力协商：检查角色能力是否满足编排要求（不足则无法 prepare，走降级） */
export function meetsRequirements(
  def: ChoreographyDefinition,
  role: string,
  capabilities: ActionCapability[],
): boolean {
  const required = def.requires[role] ?? []
  const owned = new Set(capabilities.map((c) => c.actionId))
  return required.every((actionId) => owned.has(actionId))
}
