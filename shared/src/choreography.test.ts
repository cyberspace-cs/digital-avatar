import { describe, it, expect } from 'vitest'
import {
  parseChoreographyDefinition,
  CHOREOGRAPHY_PHASES,
  CHOREOGRAPHY_STATES,
  canTransitionChoreographyState,
  SchemaError,
} from './choreography.js'

const validDef = {
  choreographyId: 'ch-hug-01',
  actionId: 'hug',
  roles: ['initiator', 'receiver'],
  phases: ['approach', 'contact', 'hold', 'release', 'return'],
  perPhaseMs: { approach: 900, contact: 300, hold: 1200, release: 400, return: 800 },
  requires: { initiator: ['hug_open'], receiver: ['receive'] },
}

describe('CHOREOGRAPHY_PHASES / STATES', () => {
  it('阶段固定为 approach→contact→hold→release→return（契约 §8）', () => {
    expect(CHOREOGRAPHY_PHASES).toEqual(['approach', 'contact', 'hold', 'release', 'return'])
  })

  it('状态机包含主链与 partial/failed（契约 §8）', () => {
    for (const s of ['requested', 'accepted', 'preparing', 'ready', 'playing', 'completed', 'partial', 'failed']) {
      expect(CHOREOGRAPHY_STATES).toContain(s)
    }
  })
})

describe('canTransitionChoreographyState', () => {
  it('主链 requested→accepted→preparing→ready→playing→completed 全部合法', () => {
    expect(canTransitionChoreographyState('requested', 'accepted')).toBe(true)
    expect(canTransitionChoreographyState('accepted', 'preparing')).toBe(true)
    expect(canTransitionChoreographyState('preparing', 'ready')).toBe(true)
    expect(canTransitionChoreographyState('ready', 'playing')).toBe(true)
    expect(canTransitionChoreographyState('playing', 'completed')).toBe(true)
  })

  it('ready/playing 可失败为 partial/failed；playing 可回退到 preparing（重试）', () => {
    expect(canTransitionChoreographyState('ready', 'failed')).toBe(true)
    expect(canTransitionChoreographyState('playing', 'partial')).toBe(true)
    expect(canTransitionChoreographyState('playing', 'preparing')).toBe(true)
  })

  it('非法跳转被拒绝（requested 直达 completed）', () => {
    expect(canTransitionChoreographyState('requested', 'completed')).toBe(false)
    expect(canTransitionChoreographyState('completed', 'playing')).toBe(false)
    expect(canTransitionChoreographyState('failed', 'ready')).toBe(false)
  })
})

describe('parseChoreographyDefinition', () => {
  it('接受合法定义', () => {
    const d = parseChoreographyDefinition(validDef)
    expect(d.choreographyId).toBe('ch-hug-01')
  })

  it('phases 必须是固定的五阶段且顺序不可变', () => {
    expect(() =>
      parseChoreographyDefinition({ ...validDef, phases: ['contact', 'approach', 'hold', 'release', 'return'] }),
    ).toThrow(SchemaError)
    expect(() =>
      parseChoreographyDefinition({ ...validDef, phases: ['approach', 'contact', 'hold', 'release'] }),
    ).toThrow(SchemaError)
  })

  it('roles 必须恰好 2 个', () => {
    expect(() => parseChoreographyDefinition({ ...validDef, roles: ['initiator'] })).toThrow(SchemaError)
  })

  it('perPhaseMs 必须覆盖五阶段且为正数', () => {
    const { return: _drop, ...incomplete } = validDef.perPhaseMs
    expect(() => parseChoreographyDefinition({ ...validDef, perPhaseMs: incomplete })).toThrow(SchemaError)
    expect(() => parseChoreographyDefinition({ ...validDef, perPhaseMs: { ...validDef.perPhaseMs, hold: 0 } })).toThrow(
      SchemaError,
    )
  })

  it('requires 必须覆盖全部 roles', () => {
    expect(() =>
      parseChoreographyDefinition({ ...validDef, requires: { initiator: ['hug_open'] } }),
    ).toThrow(SchemaError)
  })
})
