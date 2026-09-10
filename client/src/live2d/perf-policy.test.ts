import { describe, it, expect } from 'vitest'
import {
  TIER_FPS,
  DOWNGRADE_RATIO,
  downgradeTier,
  resolveStartTier,
} from './perf-policy'

describe('帧率档位常量（V2.0 Task 8：60/30/15）', () => {
  it('三档目标帧率为 60/30/15', () => {
    expect(TIER_FPS).toEqual({ high: 60, balanced: 30, saver: 15 })
  })
})

describe('downgradeTier 自动降档判定', () => {
  it('high 档达标不降（>= 60×0.75=45）', () => {
    expect(downgradeTier(45, 'high')).toBeNull()
    expect(downgradeTier(59, 'high')).toBeNull()
  })

  it('high 档持续低于 45fps → 降 balanced', () => {
    expect(downgradeTier(44.9, 'high')).toBe('balanced')
    expect(downgradeTier(30, 'high')).toBe('balanced')
  })

  it('balanced 档持续低于 22.5fps → 降 saver(15)', () => {
    expect(downgradeTier(22.5, 'balanced')).toBeNull()
    expect(downgradeTier(22, 'balanced')).toBe('saver')
  })

  it('saver 已是最低档，永不返回继续降档', () => {
    expect(downgradeTier(14, 'saver')).toBeNull()
    expect(downgradeTier(1, 'saver')).toBeNull()
  })

  it('阈值边界严格小于（恰好 75% 不触发）', () => {
    expect(downgradeTier(60 * DOWNGRADE_RATIO, 'high')).toBeNull()
    expect(downgradeTier(30 * DOWNGRADE_RATIO, 'balanced')).toBeNull()
  })
})

describe('resolveStartTier 初始档位', () => {
  it('URL ?perf= 强制优先级最高', () => {
    expect(resolveStartTier({ forced: 'saver', saved: 'high', isMobile: false })).toBe('saver')
    expect(resolveStartTier({ forced: 'high', saved: 'saver', isMobile: true })).toBe('high')
  })

  it('非法 forced 忽略，回落到 saved', () => {
    expect(resolveStartTier({ forced: 'ultra', saved: 'balanced', isMobile: false })).toBe('balanced')
  })

  it('无强制无记忆：移动 balanced / 桌面 high', () => {
    expect(resolveStartTier({ forced: null, saved: null, isMobile: true })).toBe('balanced')
    expect(resolveStartTier({ forced: null, saved: null, isMobile: false })).toBe('high')
  })

  it('非法 saved 忽略', () => {
    expect(resolveStartTier({ forced: null, saved: 'weird', isMobile: true })).toBe('balanced')
  })
})
