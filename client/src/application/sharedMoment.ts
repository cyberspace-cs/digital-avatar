/**
 * application/sharedMoment.ts — 双人共同时刻用例（V2.0 Task 3）
 *
 * 服务端创建 momentId（状态机权威），客户端只推进状态与标记阶段
 * （契约 §8：只同步开始时间/阶段标记/完成状态，禁止逐帧同步 Cubism 参数）。
 * Task 6 的 choreography-runner 在 prepare/ready/complete 时调用这里。
 */
import type { ChoreographyPhase, ChoreographyState, SharedMoment } from '@digital-avatar/shared'

export interface CreateMomentCommand {
  relationshipId: string
  choreographyId: string
  actionId: string
  senderId: string
  receiverId: string
}

export interface SharedMomentPorts {
  createMoment: (cmd: CreateMomentCommand) => Promise<{ moment: SharedMoment | null; error: string | null }>
  transitionMoment: (
    momentId: string,
    body: { state: ChoreographyState; phaseMarkers?: Array<{ phase: ChoreographyPhase; at: string }> },
  ) => Promise<{ moment: SharedMoment | null; error: string | null }>
}

/** 创建共同时刻（服务端 state=requested） */
export function prepareSharedMoment(
  ports: SharedMomentPorts,
  cmd: CreateMomentCommand,
): Promise<{ moment: SharedMoment | null; error: string | null }> {
  return ports.createMoment(cmd)
}

/** 推进状态机（非法转移由服务端拒绝，客户端原样返回 error） */
export function advanceMoment(
  ports: SharedMomentPorts,
  momentId: string,
  state: ChoreographyState,
  phaseMarkers?: Array<{ phase: ChoreographyPhase; at: string }>,
): Promise<{ moment: SharedMoment | null; error: string | null }> {
  return ports.transitionMoment(momentId, { state, phaseMarkers })
}

/** 标记一个阶段完成（approach/contact/hold/release/return） */
export async function markPhase(
  ports: SharedMomentPorts,
  momentId: string,
  phase: ChoreographyPhase,
  currentState: ChoreographyState,
): Promise<{ moment: SharedMoment | null; error: string | null }> {
  const marker = { phase, at: new Date().toISOString() }
  return ports.transitionMoment(momentId, { state: currentState, phaseMarkers: [marker] })
}
