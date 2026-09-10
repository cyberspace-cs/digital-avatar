/**
 * actions/choreographies.test.ts — 双人编排定义注册表（V2.0 Task 3）
 *
 * 覆盖：五阶段顺序与时间轴、hug/handhold/shoulder-lean 定义、未知动作回退、
 * participants 数量校验（契约：双人编排恰好两个角色）。
 */
import { describe, it, expect } from 'vitest'
import { CHOREOGRAPHY_PHASES } from '@digital-avatar/shared'
import { createChoreography, CHOREOGRAPHY_ACTIONS } from './choreographies'

describe('createChoreography', () => {
  it('hug：生成五阶段时间轴，顺序固定、时长连续累加', () => {
    const plan = createChoreography('hug', ['u1', 'u2'])
    expect(plan).not.toBeNull()
    expect(plan!.choreographyId).toBe('hug.v1')
    expect(plan!.actionId).toBe('hug')
    expect(plan!.participants).toEqual(['u1', 'u2'])
    expect(plan!.timeline.map((t) => t.phase)).toEqual([...CHOREOGRAPHY_PHASES])
    // 阶段时间轴连续：下一段起点 = 上一段终点
    for (let i = 1; i < plan!.timeline.length; i++) {
      expect(plan!.timeline[i].startMs).toBe(plan!.timeline[i - 1].endMs)
    }
    // 总时长 = 各阶段之和
    const total = plan!.timeline[plan!.timeline.length - 1].endMs
    expect(total).toBe(1200 + 400 + 2200 + 400 + 1200)
  })

  it('handhold 与 shoulder-lean 已注册', () => {
    expect(CHOREOGRAPHY_ACTIONS).toContain('handhold')
    expect(CHOREOGRAPHY_ACTIONS).toContain('shoulder-lean')
    expect(createChoreography('handhold', ['a', 'b'])!.actionId).toBe('handhold')
    expect(createChoreography('shoulder-lean', ['a', 'b'])!.actionId).toBe('shoulder-lean')
  })

  it('未知动作返回 null（调用方回退单侧互动）', () => {
    expect(createChoreography('dance', ['a', 'b'])).toBeNull()
  })

  it('participants 不是恰好两人时抛错', () => {
    expect(() => createChoreography('hug', ['solo'])).toThrow()
    expect(() => createChoreography('hug', ['a', 'b', 'c'])).toThrow()
    expect(() => createChoreography('hug', ['a', ''])).toThrow()
  })

  it('能力要求覆盖双方角色（prepare 协商用）', () => {
    const plan = createChoreography('hug', ['a', 'b'])!
    expect(plan.requires.initiator).toEqual(['hug'])
    expect(plan.requires.receiver).toEqual(['hug'])
  })
})
