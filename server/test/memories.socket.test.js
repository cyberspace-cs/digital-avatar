/**
 * memories/socket.test.js — 双人编排 socket 同步时序测试（V2.0 Task 6，契约 §8）
 *
 * 覆盖（不引 socket.io-client，用假 io/socket 直接驱动注册的连接级 handler）：
 * - prepare：校验 bond → 向两端广播（serverStartAt = now+提前量、contactGapPx 锚点）
 * - ready 集齐两端 → 提前广播 start（readyCount=2）；start 后的重复 ready 被忽略
 * - offline replay：只有发起端 ready → 宽限超时也广播 start（readyCount=1）→ 发起端走 partial
 * - 未绑定发起 → 只回 prepare_rejected，不广播
 * - 冒充 sender（senderId ≠ 当前连接用户）→ 忽略
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStore } from '../src/db.js'
import { createMemoriesService } from '../src/modules/memories/service.js'
import { registerMomentSockets } from '../src/modules/memories/socket.js'

/** 假 io：记录 connection handler 与所有 to(sockId).emit 调用 */
function setup() {
  const { q, uuid } = createStore(':memory:')
  const memories = createMemoriesService({ q, uuid, logger: { log: vi.fn(), error: vi.fn() } })
  const sent = [] // { sockId, event, payload }
  const handlers = {} // 'connection' → cb
  const io = {
    on: (evt, cb) => { handlers[evt] = cb },
    to: (sockId) => ({
      emit: (event, payload) => sent.push({ sockId, event, payload }),
    }),
  }
  const online = new Map() // userId → sockId
  registerMomentSockets(io, online, memories)

  const userHandlers = new Map() // userId → { event: cb }
  /** 建立一条连接（等价 socket.io 握手完成） */
  const connect = (userId) => {
    const reg = {}
    const sock = {
      handshake: { query: { userId } },
      on: (event, cb) => { reg[event] = cb },
      emit: (event, payload) => sent.push({ sockId: `sock:${userId}`, event, payload }),
    }
    online.set(userId, `sock:${userId}`)
    userHandlers.set(userId, reg)
    handlers.connection(sock)
    return reg
  }
  return { memories, q, sent, connect, online }
}

describe('moment.prepare', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('校验 bond 后向两端广播（含 serverStartAt 与接触锚点），发起端有回声', () => {
    const { memories, q, sent, connect } = setup()
    q.insertBond.run('bond1', 'u1', 'u2')
    const u1 = connect('u1')
    connect('u2')

    u1['moment.prepare']({
      momentId: 'm1',
      choreographyId: 'hug.v1',
      actionId: 'hug',
      senderId: 'u1',
      receiverId: 'u2',
    })

    const preps = sent.filter((s) => s.event === 'moment.prepare')
    // 接收端推送 1 条 + 发起端回声 1 条
    expect(preps.length).toBe(2)
    const t0 = Date.now()
    for (const p of preps) {
      expect(p.payload.momentId).toBe('m1')
      expect(p.payload.serverStartAt).toBeGreaterThanOrEqual(t0 + 2500 - 5)
      expect(p.payload.anchors.contactGapPx).toBe(120)
    }
    expect(preps.map((p) => p.sockId).sort()).toEqual(['sock:u1', 'sock:u2'])
  })

  it('未绑定双方：只给发起端回 prepare_rejected，不广播、不建会话', () => {
    const { sent, connect } = setup()
    const u3 = connect('u3')
    connect('u4')
    u3['moment.prepare']({ momentId: 'm9', senderId: 'u3', receiverId: 'u4' })
    expect(sent.filter((s) => s.event === 'moment.prepare')).toHaveLength(0)
    const rejected = sent.filter((s) => s.event === 'moment.prepare_rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].payload.reason).toBe('not bonded')
    expect(rejected[0].sockId).toBe('sock:u3')
  })

  it('senderId 冒充（≠ 连接用户）被忽略', () => {
    const { sent, connect, q } = setup()
    q.insertBond.run('bond1', 'u1', 'u2')
    const u2 = connect('u2')
    connect('u1')
    // u2 的连接冒充 u1 发起（senderId=u1 ≠ 连接用户 u2）→ 忽略
    u2['moment.prepare']({ momentId: 'm2', senderId: 'u1', receiverId: 'u2' })
    expect(sent.filter((s) => s.event === 'moment.prepare')).toHaveLength(0)
  })
})

describe('moment.ready → moment.start 时序', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('两端 ready 集齐 → 提前广播 start（readyCount=2），会话清理', () => {
    const { sent, connect, q } = setup()
    q.insertBond.run('bond1', 'u1', 'u2')
    const u1 = connect('u1')
    const u2 = connect('u2')
    u1['moment.prepare']({ momentId: 'm1', senderId: 'u1', receiverId: 'u2' })
    u1['moment.ready']({ momentId: 'm1' })
    u2['moment.ready']({ momentId: 'm1' })

    const starts = sent.filter((s) => s.event === 'moment.start')
    expect(starts).toHaveLength(2)
    expect(starts.every((s) => s.payload.readyCount === 2)).toBe(true)
    expect(starts.map((s) => s.sockId).sort()).toEqual(['sock:u1', 'sock:u2'])
    // start 后重复 ready 被忽略（不产生第二次 start）
    u1['moment.ready']({ momentId: 'm1' })
    expect(sent.filter((s) => s.event === 'moment.start')).toHaveLength(2)
  })

  it('offline replay：接收端离线只有发起端 ready → 宽限超时仍广播 start（readyCount=1）', () => {
    const { sent, connect, q, online } = setup()
    q.insertBond.run('bond1', 'u1', 'u2')
    const u1 = connect('u1')
    u1['moment.prepare']({ momentId: 'm1', senderId: 'u1', receiverId: 'u2' })
    u1['moment.ready']({ momentId: 'm1' })
    online.delete('u2') // 接收端掉线

    // PREPARE_LEAD_MS(2500) + READY_GRACE_MS(1500) = 4000ms 后兜底开跑
    vi.advanceTimersByTime(4000)
    const starts = sent.filter((s) => s.event === 'moment.start')
    expect(starts).toHaveLength(1) // 只推给在线的发起端
    expect(starts[0].payload.readyCount).toBe(1)
    expect(starts[0].payload.startAt).toBe(1_004_000)
  })

  it('两端提前 ready → 提前开跑，宽限定时器不再触发第二次 start', () => {
    const { sent, connect, q } = setup()
    q.insertBond.run('bond1', 'u1', 'u2')
    const u1 = connect('u1')
    const u2 = connect('u2')
    u1['moment.prepare']({ momentId: 'm1', senderId: 'u1', receiverId: 'u2' })
    u1['moment.ready']({ momentId: 'm1' })
    u2['moment.ready']({ momentId: 'm1' })
    vi.advanceTimersByTime(10_000)
    expect(sent.filter((s) => s.event === 'moment.start')).toHaveLength(2)
  })

  it('同一 momentId 重复 prepare：会话重置（幂等），最终只 start 一次', () => {
    const { sent, connect, q } = setup()
    q.insertBond.run('bond1', 'u1', 'u2')
    const u1 = connect('u1')
    const u2 = connect('u2')
    u1['moment.prepare']({ momentId: 'm1', senderId: 'u1', receiverId: 'u2' })
    u1['moment.prepare']({ momentId: 'm1', senderId: 'u1', receiverId: 'u2' })
    u1['moment.ready']({ momentId: 'm1' })
    u2['moment.ready']({ momentId: 'm1' })
    const starts = sent.filter((s) => s.event === 'moment.start')
    expect(starts).toHaveLength(2) // 广播到两端各一条
    vi.advanceTimersByTime(10_000)
    expect(sent.filter((s) => s.event === 'moment.start')).toHaveLength(2)
  })

  it('非参与者（第三人）的 ready 不计入', () => {
    const { sent, connect, q } = setup()
    q.insertBond.run('bond1', 'u1', 'u2')
    const u1 = connect('u1')
    connect('u2')
    const u5 = connect('u5')
    u1['moment.prepare']({ momentId: 'm1', senderId: 'u1', receiverId: 'u2' })
    u5['moment.ready']({ momentId: 'm1' })
    expect(sent.filter((s) => s.event === 'moment.start')).toHaveLength(0)
  })
})
