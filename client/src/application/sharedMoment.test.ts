/**
 * application/sharedMoment.test.ts — 双人共同时刻用例（V2.0 Task 3）
 *
 * 覆盖：命令透传（客户端不做状态机裁决，非法转移由服务端拒绝）、
 * markPhase 自动打 ISO 时间戳、错误透传不吞。
 */
import { describe, it, expect, vi } from 'vitest'
import { prepareSharedMoment, advanceMoment, markPhase, type SharedMomentPorts } from './sharedMoment'
import type { SharedMoment } from '@digital-avatar/shared'

const MOMENT: SharedMoment = {
  momentId: 'mom-1',
  choreographyId: 'hug.v1',
  relationshipId: 'rel-1',
  participants: ['u1', 'u2'],
  actionId: 'hug',
  state: 'requested',
  phaseMarkers: [],
  createdAt: '2026-09-10T00:00:00.000Z',
  completedAt: null,
}

function makePorts() {
  const createMoment = vi.fn().mockResolvedValue({ moment: MOMENT, error: null })
  const transitionMoment = vi.fn().mockResolvedValue({ moment: { ...MOMENT, state: 'playing' }, error: null })
  const ports: SharedMomentPorts = { createMoment, transitionMoment }
  return { ports, createMoment, transitionMoment }
}

const CMD = {
  relationshipId: 'rel-1',
  choreographyId: 'hug.v1',
  actionId: 'hug',
  senderId: 'u1',
  receiverId: 'u2',
}

describe('prepareSharedMoment', () => {
  it('命令原样透传 createMoment，返回 moment', async () => {
    const { ports, createMoment } = makePorts()
    const r = await prepareSharedMoment(ports, CMD)
    expect(createMoment).toHaveBeenCalledWith(CMD)
    expect(r.moment?.momentId).toBe('mom-1')
    expect(r.error).toBeNull()
  })

  it('服务端错误原样透传（客户端不吞、不重试裁决）', async () => {
    const { ports } = makePorts()
    ports.createMoment = vi.fn().mockResolvedValue({ moment: null, error: 'choreography unknown' })
    const r = await prepareSharedMoment(ports, CMD)
    expect(r.moment).toBeNull()
    expect(r.error).toBe('choreography unknown')
  })
})

describe('advanceMoment', () => {
  it('状态与阶段标记透传 transitionMoment', async () => {
    const { ports, transitionMoment } = makePorts()
    const markers = [{ phase: 'contact' as const, at: '2026-09-10T00:00:01.000Z' }]
    const r = await advanceMoment(ports, 'mom-1', 'playing', markers)
    expect(transitionMoment).toHaveBeenCalledWith('mom-1', { state: 'playing', phaseMarkers: markers })
    expect(r.moment?.state).toBe('playing')
  })

  it('不带标记时 phaseMarkers 为 undefined（服务端按无标记处理）', async () => {
    const { ports, transitionMoment } = makePorts()
    await advanceMoment(ports, 'mom-1', 'accepted')
    expect(transitionMoment).toHaveBeenCalledWith('mom-1', { state: 'accepted', phaseMarkers: undefined })
  })
})

describe('markPhase', () => {
  it('自动生成 ISO at 标记，携带当前状态', async () => {
    const { ports, transitionMoment } = makePorts()
    const before = Date.now()
    await markPhase(ports, 'mom-1', 'hold', 'playing')
    const call = transitionMoment.mock.calls[0]
    expect(call[0]).toBe('mom-1')
    expect(call[1].state).toBe('playing')
    const marker = call[1].phaseMarkers?.[0]
    expect(marker?.phase).toBe('hold')
    const at = new Date(marker!.at).getTime()
    expect(Number.isNaN(at)).toBe(false)
    expect(Math.abs(at - before)).toBeLessThan(1000)
  })

  it('transitionMoment 失败时错误透传', async () => {
    const { ports } = makePorts()
    ports.transitionMoment = vi.fn().mockResolvedValue({ moment: null, error: 'illegal transition' })
    const r = await markPhase(ports, 'mom-1', 'release', 'completed')
    expect(r.error).toBe('illegal transition')
  })
})
