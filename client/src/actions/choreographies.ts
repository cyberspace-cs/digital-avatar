/**
 * actions/choreographies.ts — 双人编排定义注册表（V2.0 Task 3）
 *
 * 契约 §8：双人动作 = 固定五阶段（approach → contact → hold → release → return），
 * 每个编排声明各角色的能力要求；状态机与同步在服务端 + Task 6 的 runner。
 * 这里只负责"actionId → ChoreographyPlan（阶段时间轴）"的纯映射。
 */
import {
  CHOREOGRAPHY_PHASES,
  parseChoreographyDefinition,
  toPlan,
  type ChoreographyDefinition,
  type ChoreographyPlan,
} from '@digital-avatar/shared'

/** 内置双人编排定义（Task 6 交付顺序：hug 先行，handhold / shoulder-lean 跟进） */
const DEFINITIONS: Record<string, ChoreographyDefinition> = {
  hug: parseChoreographyDefinition({
    choreographyId: 'hug.v1',
    actionId: 'hug',
    roles: ['initiator', 'receiver'],
    phases: CHOREOGRAPHY_PHASES,
    perPhaseMs: { approach: 1200, contact: 400, hold: 2200, release: 400, return: 1200 },
    requires: { initiator: ['hug'], receiver: ['hug'] },
  }),
  handhold: parseChoreographyDefinition({
    choreographyId: 'handhold.v1',
    actionId: 'handhold',
    roles: ['initiator', 'receiver'],
    phases: CHOREOGRAPHY_PHASES,
    perPhaseMs: { approach: 1000, contact: 300, hold: 2400, release: 300, return: 1000 },
    requires: { initiator: ['handhold'], receiver: ['handhold'] },
  }),
  'shoulder-lean': parseChoreographyDefinition({
    choreographyId: 'shoulder-lean.v1',
    actionId: 'shoulder-lean',
    roles: ['initiator', 'receiver'],
    phases: CHOREOGRAPHY_PHASES,
    perPhaseMs: { approach: 1400, contact: 500, hold: 3000, release: 500, return: 1200 },
    requires: { initiator: ['shoulder-lean'], receiver: ['shoulder-lean'] },
  }),
}

/** 已注册的双人编排 actionId 列表 */
export const CHOREOGRAPHY_ACTIONS = Object.keys(DEFINITIONS)

/**
 * 由动作 + 参与者生成编排执行计划。
 * @returns 未知动作返回 null（调用方回退为单侧互动，不做双人编排）；
 *          participants 不是恰好两人时抛 SchemaError（契约：双人编排只有两个角色）
 */
export function createChoreography(actionId: string, participants: string[]): ChoreographyPlan | null {
  const def = DEFINITIONS[actionId]
  if (!def) return null
  if (participants.length !== 2 || participants.some((p) => !p)) {
    throw new Error(`participants 必须恰好是两个非空 userId，收到: ${JSON.stringify(participants)}`)
  }
  return toPlan(def, def.choreographyId, [participants[0], participants[1]])
}
