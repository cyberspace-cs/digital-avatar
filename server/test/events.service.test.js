/**
 * events/service.test.js — 统一互动事件结算（V2.0 Task 2 验收测试）
 *
 * 覆盖契约红线：
 * - 重复 eventId 不重复写入（幂等）
 * - 未知动作不拒绝（语义降级由客户端动作注册表负责，禁止下标取模）
 * - 动画失败（结算后副作用抛错）不影响事件保存
 * - growth 恒为 null 且不写 bonds.growth（停止成长写入）
 * - 旧客户端载荷兼容映射
 */
import { describe, it, expect, vi } from 'vitest'
import { createStore } from '../src/db.js'
import { createEventsService } from '../src/modules/events/service.js'

function setup() {
  const { q, uuid } = createStore(':memory:')
  const service = createEventsService({ q, uuid, logger: { log: vi.fn(), error: vi.fn() } })
  q.insertUser.run('u1', 'Alice', 'hiyori')
  q.insertUser.run('u2', 'Bob', 'haru')
  q.insertBond.run('bond1', 'u1', 'u2')
  return { q, service, uuid }
}

const base = (over = {}) => ({
  senderId: 'u1',
  receiverId: 'u2',
  actionId: 'wave',
  eventId: 'evt-1',
  ...over,
})

describe('events service — settleInteraction', () => {
  it('重复 eventId 只结算一次（幂等），events 表只有一条', () => {
    const { q, service } = setup()
    const first = service.settleInteraction(base())
    expect(first.duplicate).toBe(false)
    expect(first.event).not.toBeNull()

    const second = service.settleInteraction(base())
    expect(second.duplicate).toBe(true)
    expect(second.event.id).toBe('evt-1')

    const rows = q.db.prepare('SELECT COUNT(*) AS n FROM events').get()
    expect(rows.n).toBe(1)
  })

  it('未知动作不拒绝：注册表外的 actionId 照常落库', () => {
    const { q, service } = setup()
    const out = service.settleInteraction(base({ actionId: 'kiss', eventId: 'evt-unknown' }))
    expect(out.error).toBeUndefined()
    expect(out.event).not.toBeNull()
    expect(out.event.actionId).toBe('kiss')
    const row = q.getEvent.get('evt-unknown')
    expect(row).not.toBeUndefined()
  })

  it('无效载荷拒绝结算且不落库（缺 actionId / 未知 major schema）', () => {
    const { q, service } = setup()
    const noAction = service.settleInteraction({ senderId: 'u1', receiverId: 'u2', eventId: 'evt-bad1' })
    expect(noAction.error).toBe('invalid_event')
    expect(noAction.event).toBeNull()

    const badVersion = service.settleInteraction(
      base({ eventId: 'evt-bad2', schemaVersion: '9.0.0' }),
    )
    expect(badVersion.error).toBe('invalid_event')

    const rows = q.db.prepare('SELECT COUNT(*) AS n FROM events').get()
    expect(rows.n).toBe(0)
  })

  it('动画失败不影响保存：结算后副作用抛错，事件已落库且不向上抛', () => {
    const { q, service } = setup()
    service.setHooks({
      onSettled: () => {
        throw new Error('render boom')
      },
    })
    const out = service.settleInteraction(base({ eventId: 'evt-hook' }))
    expect(out.error).toBeUndefined()
    expect(out.event).not.toBeNull()
    expect(q.getEvent.get('evt-hook')).not.toBeUndefined()
  })

  it('红线：growth 恒为 null 且不写 bonds.growth（停止成长写入）', () => {
    const { q, service } = setup()
    const out = service.settleInteraction(base({ eventId: 'evt-growth' }))
    expect(out.growth).toBeNull()
    const bond = q.getBond.get('u1', 'u2', 'u2', 'u1')
    expect(bond.growth).toBe(0)
    const growthRows = q.db.prepare('SELECT COUNT(*) AS n FROM growth_events').get()
    expect(growthRows.n).toBe(0)
  })

  it('旧客户端载荷兼容：{action, message} 自动映射为统一事件', () => {
    const { service } = setup()
    const out = service.settleInteraction({
      senderId: 'u2',
      receiverId: 'u1',
      action: 'feed',
      message: '请你吃饭',
      eventId: 'evt-legacy',
    })
    expect(out.error).toBeUndefined()
    expect(out.event.actionId).toBe('feed')
    expect(out.event.action).toBe('feed') // 兼容旧字段
    expect(out.event.message).toBe('请你吃饭')
    expect(out.event.schemaVersion).toBe('1.0.0')
  })

  it(' relationshipId 回填 bond id（双向匹配：B 发起也能命中）', () => {
    const { service } = setup()
    const out = service.settleInteraction(
      base({ senderId: 'u2', receiverId: 'u1', eventId: 'evt-b-init' }),
    )
    expect(out.event.relationshipId).toBe('bond1')
  })

  it('新契约载荷（带 schemaVersion、无 type/status）正常结算（socket 链路回归）', () => {
    const { service } = setup()
    // 客户端 toWirePayload 的真实形状：服务端权威字段（type/status）不传
    const out = service.settleInteraction({
      schemaVersion: '1.0.0',
      eventId: 'evt-wire',
      senderId: 'u1',
      receiverId: 'u2',
      actionId: 'wave',
      action: 'wave',
      choreographyId: null,
      message: null,
      clientOccurredAt: new Date().toISOString(),
      payload: {},
      privacy: {},
    })
    expect(out.error).toBeUndefined()
    expect(out.event).not.toBeNull()
    expect(out.event.type).toBe('interaction.requested')
    expect(out.event.status).toBe('accepted')
    expect(out.event.action).toBe('wave') // 兼容旧客户端字段
  })

  it('新契约载荷顶层 message 合并进 payload.message（时间线/气泡不丢文案）', () => {
    const { service } = setup()
    const out = service.settleInteraction({
      schemaVersion: '1.0.0',
      eventId: 'evt-wire-msg',
      senderId: 'u1',
      receiverId: 'u2',
      actionId: 'wave',
      message: '嗨呀',
      clientOccurredAt: new Date().toISOString(),
      payload: {},
      privacy: {},
    })
    expect(out.event.message).toBe('嗨呀')
  })

  it('listEvents 返回双方时间线（发送或接收）', () => {
    const { service } = setup()
    service.settleInteraction(base({ eventId: 'evt-l1' }))
    service.settleInteraction(base({ senderId: 'u2', receiverId: 'u1', eventId: 'evt-l2' }))
    expect(service.listEvents('u1').length).toBe(2)
    expect(service.listEvents('u2').length).toBe(2)
    expect(service.listEvents('u3').length).toBe(0)
  })
})
