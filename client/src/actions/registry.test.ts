/**
 * actions/registry.test.ts — 动作降级链映射测试（V2.0 Task 3）
 *
 * 覆盖验收：wave / heart / hug / 未知动作 / 能力缺失，五级降级各就各位。
 */
import { describe, it, expect } from 'vitest'
import type { ActionCapability } from '@digital-avatar/shared'
import {
  resolveAction,
  legacyCapabilities,
  actionLabel,
  actionBubble,
} from './registry'

const caps = (...ids: string[]): ActionCapability[] =>
  ids.map((actionId) => ({ actionId, motion: `${actionId}.motion3.json` }))

describe('resolveAction — 降级链', () => {
  it('wave：能力命中 → exact（一级）', () => {
    const plan = resolveAction(caps('idle', 'wave', 'heart'), 'wave')
    expect(plan.level).toBe('exact')
    expect(plan.levelIndex).toBe(1)
    expect(plan.actionId).toBe('wave')
    expect(plan.motion).toBe('wave.motion3.json')
  })

  it('heart：能力精确命中 → exact（degradesTo 不参与解析期降级，仅运行时播放失败的备用元数据）', () => {
    const heartCap: ActionCapability = { actionId: 'heart', motion: 'heart.motion3.json', degradesTo: ['cheer'] }
    const plan = resolveAction([heartCap, { actionId: 'idle', motion: 'idle.motion3.json' }], 'heart')
    expect(plan.level).toBe('exact')
    expect(plan.actionId).toBe('heart')
    // degradesTo 保留在能力声明上，供渲染器在 motion 播放失败时自行消费
    expect(heartCap.degradesTo).toEqual(['cheer'])
  })

  it('heart：无精确动作时按语义表降级 positive → wave', () => {
    const withPositive = resolveAction(caps('idle', 'positive', 'wave'), 'heart')
    expect(withPositive.level).toBe('semantic')
    expect(withPositive.actionId).toBe('positive')

    const waveOnly = resolveAction(caps('idle', 'wave'), 'heart')
    expect(waveOnly.level).toBe('semantic')
    expect(waveOnly.actionId).toBe('wave')
    expect(waveOnly.degradeReason).toBeTruthy()
  })

  it('hug：只有 idle 能力 → 三级通用反应（idle + 表情）', () => {
    const plan = resolveAction(caps('idle'), 'hug')
    expect(plan.level).toBe('generic')
    expect(plan.levelIndex).toBe(3)
    expect(plan.actionId).toBe('idle')
  })

  it('未知动作：有 idle 能力 → 三级通用反应（不抛错、不取模）', () => {
    const plan = resolveAction(caps('idle', 'wave'), 'totally-unknown')
    expect(plan.level).toBe('generic')
    expect(plan.actionId).toBe('idle')
  })

  it('能力缺失（空数组）：四级中性待机 + 气泡', () => {
    const plan = resolveAction([], 'wave')
    expect(plan.level).toBe('neutral-bubble')
    expect(plan.levelIndex).toBe(4)
    expect(plan.bubble).toBeTruthy()
  })

  it('无模型（null）：五级只保留事件', () => {
    const plan = resolveAction(null, 'wave')
    expect(plan.level).toBe('event-only')
    expect(plan.levelIndex).toBe(5)
  })
})

describe('legacyCapabilities — 旧模型合成能力表', () => {
  const caps = legacyCapabilities()

  it('旧模型 7 个真实动作 + idle 全部 exact 命中', () => {
    for (const id of ['poke', 'pat', 'pinch', 'wave', 'heart', 'hug', 'flick']) {
      const plan = resolveAction(caps, id)
      expect(plan.level).toBe('exact')
    }
    expect(resolveAction(caps, 'idle').level).toBe('exact')
  })

  it('feed / flower 无独立动作 → 语义降级为 wave（与 V1.2 行为一致）', () => {
    for (const id of ['feed', 'flower']) {
      const plan = resolveAction(caps, id)
      expect(plan.level).toBe('semantic')
      expect(plan.actionId).toBe('wave')
    }
  })
})

describe('展示元数据', () => {
  it('actionLabel：已知动作返回中文，未知动作回退原 id', () => {
    expect(actionLabel('hug')).toBe('抱抱')
    expect(actionLabel('mystery-move')).toBe('mystery-move')
  })

  it('actionBubble：已知动作有气泡，未知动作也有兜底文案', () => {
    expect(actionBubble('wave')).toContain('👋')
    expect(actionBubble('mystery-move')).toBeTruthy()
  })
})
