import { describe, it, expect } from 'vitest'
import { parseInteractionEvent, parseSharedMoment, parseMemory, SchemaError, EVENT_SCHEMA_VERSION } from './schema.js'
import type { InteractionEvent } from './events.js'

/** 契约 §7 统一事件格式的合法样例 */
export const validEventInput = {
  schemaVersion: '1.0.0',
  eventId: 'e-0001',
  type: 'interaction.requested',
  relationshipId: 'r-0001',
  senderId: 'u-alice',
  receiverId: 'u-bob',
  actionId: 'wave',
  choreographyId: null,
  clientOccurredAt: '2026-09-09T10:00:00.000Z',
  serverOccurredAt: '2026-09-09T10:00:00.100Z',
  payload: { note: 'hi' },
  privacy: { visibility: 'each-time' },
  status: 'accepted',
}

describe('parseInteractionEvent', () => {
  it('接受契约 §7 完整合法事件', () => {
    const ev = parseInteractionEvent(validEventInput)
    expect(ev.eventId).toBe('e-0001')
    expect(ev.actionId).toBe('wave')
  })

  it('拒绝缺少 eventId 的事件', () => {
    const { eventId: _omit, ...rest } = validEventInput
    expect(() => parseInteractionEvent(rest)).toThrow(SchemaError)
  })

  it('拒绝空 eventId', () => {
    expect(() => parseInteractionEvent({ ...validEventInput, eventId: '' })).toThrow(SchemaError)
  })

  it('拒绝未知 major schema（如 2.0.0）', () => {
    expect(() => parseInteractionEvent({ ...validEventInput, schemaVersion: '2.0.0' })).toThrow(SchemaError)
    expect(() => parseInteractionEvent({ ...validEventInput, schemaVersion: '2.1.0' })).toThrow(SchemaError)
  })

  it('接受同 major 的更高 minor/patch（前向兼容）', () => {
    const ev = parseInteractionEvent({ ...validEventInput, schemaVersion: '1.2.3' })
    expect(ev.schemaVersion).toBe('1.2.3')
  })

  it('拒绝畸形 schemaVersion', () => {
    expect(() => parseInteractionEvent({ ...validEventInput, schemaVersion: 'one.zero' })).toThrow(SchemaError)
  })

  it('拒绝无效 actionId：空串/大写/中文/下标取模产物', () => {
    for (const bad of ['', 'WAVE', '挥 手', 'wave 2', '挥手', '3']) {
      expect(() => parseInteractionEvent({ ...validEventInput, actionId: bad })).toThrow(SchemaError)
    }
  })

  it('拒绝未知事件类型', () => {
    expect(() => parseInteractionEvent({ ...validEventInput, type: 'interaction.hacked' })).toThrow(SchemaError)
  })

  it('拒绝非法状态', () => {
    expect(() => parseInteractionEvent({ ...validEventInput, status: 'liked' })).toThrow(SchemaError)
  })

  it('拒绝非法 ISO 时间戳', () => {
    expect(() => parseInteractionEvent({ ...validEventInput, clientOccurredAt: '昨天' })).toThrow(SchemaError)
  })

  it('payload/privacy 必须是对象；未知字段被忽略不报错', () => {
    expect(() => parseInteractionEvent({ ...validEventInput, payload: 'oops' })).toThrow(SchemaError)
    const ev = parseInteractionEvent({ ...validEventInput, extraUnknown: { a: 1 } })
    expect(ev.eventId).toBe('e-0001')
  })

  it('choreographyId 可为 null 或字符串', () => {
    expect(parseInteractionEvent({ ...validEventInput, choreographyId: 'ch-hug-01' }).choreographyId).toBe('ch-hug-01')
  })
})

describe('parseSharedMoment', () => {
  const validMoment = {
    momentId: 'm-0001',
    choreographyId: 'ch-hug-01',
    relationshipId: 'r-0001',
    participants: ['u-alice', 'u-bob'],
    actionId: 'hug',
    state: 'completed',
    phaseMarkers: [
      { phase: 'approach', at: '2026-09-09T10:00:00.000Z' },
      { phase: 'contact', at: '2026-09-09T10:00:01.000Z' },
      { phase: 'hold', at: '2026-09-09T10:00:02.000Z' },
      { phase: 'release', at: '2026-09-09T10:00:03.000Z' },
      { phase: 'return', at: '2026-09-09T10:00:04.000Z' },
    ],
    createdAt: '2026-09-09T10:00:00.000Z',
    completedAt: '2026-09-09T10:00:04.000Z',
  }

  it('接受合法 SharedMoment', () => {
    expect(parseSharedMoment(validMoment).momentId).toBe('m-0001')
  })

  it('participants 必须恰好 2 人', () => {
    expect(() => parseSharedMoment({ ...validMoment, participants: ['u-alice'] })).toThrow(SchemaError)
    expect(() => parseSharedMoment({ ...validMoment, participants: ['a', 'b', 'c'] })).toThrow(SchemaError)
  })

  it('state 必须在编排状态机内', () => {
    expect(() => parseSharedMoment({ ...validMoment, state: 'finished' })).toThrow(SchemaError)
  })

  it('phaseMarkers 的 phase 必须合法', () => {
    expect(() =>
      parseSharedMoment({ ...validMoment, phaseMarkers: [{ phase: 'kiss', at: validMoment.createdAt }] }),
    ).toThrow(SchemaError)
  })
})

describe('parseMemory', () => {
  const validMemory = {
    memoryId: 'mem-0001',
    relationshipId: 'r-0001',
    kind: 'milestone',
    title: '第一次拥抱',
    description: '2026-09-09 首次 hug',
    occurredAt: '2026-09-09T10:00:04.000Z',
    createdAt: '2026-09-09T10:00:05.000Z',
    deletedAt: null,
    payload: {},
  }

  it('接受合法 Memory', () => {
    expect(parseMemory(validMemory).kind).toBe('milestone')
  })

  it('kind 必须在白名单内', () => {
    expect(() => parseMemory({ ...validMemory, kind: 'score' })).toThrow(SchemaError)
  })

  it('title 不可为空且限长 200', () => {
    expect(() => parseMemory({ ...validMemory, title: '' })).toThrow(SchemaError)
    expect(() => parseMemory({ ...validMemory, title: '长'.repeat(201) })).toThrow(SchemaError)
  })

  it('roundtrip：合法事件解析后保留契约字段', () => {
    const ev: InteractionEvent = parseInteractionEvent(validEventInput)
    expect(Object.keys(ev)).toContain('schemaVersion')
    expect(Object.keys(ev)).toContain('clientOccurredAt')
  })

  it('EVENT_SCHEMA_VERSION 常量为 1.x', () => {
    expect(EVENT_SCHEMA_VERSION.startsWith('1.')).toBe(true)
  })
})
