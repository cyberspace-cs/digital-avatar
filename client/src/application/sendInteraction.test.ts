/**
 * application/sendInteraction.test.ts — 互动发送用例（V2.0 Task 3）
 *
 * 覆盖契约 §10：Socket → ack 超时 → REST 兜底（同 eventId 幂等）、离线直走 REST、
 * REST 失败不 reject（动画/网络失败都不阻断事件语义，outbox 在 Task 8 接入）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSendInteraction, type SendInteractionPorts } from './sendInteraction'

afterEach(() => {
  vi.useRealTimers()
})

function makePorts(over: Partial<SendInteractionPorts> = {}) {
  const emit = vi.fn()
  const restInteract = vi.fn().mockResolvedValue({ event: { id: 'evt-x' }, growth: null, duplicate: false })
  const ports: SendInteractionPorts = { emit, isSocketConnected: () => true, restInteract, ...over }
  return { ports, emit, restInteract }
}

const CMD = { senderId: 'u1', receiverId: 'u2', actionId: 'wave', message: null }

describe('sendInteraction — socket 在线路径', () => {
  it('emit 载荷带 eventId/actionId/action 镜像，ack 到达即结算（不再走 REST）', async () => {
    vi.useFakeTimers()
    const { ports, emit, restInteract } = makePorts()
    const h = createSendInteraction(ports)

    const p = h.sendInteraction({ ...CMD, eventId: 'evt-1' })
    expect(emit).toHaveBeenCalledTimes(1)
    const wire = emit.mock.calls[0][1] as Record<string, unknown>
    expect(wire.eventId).toBe('evt-1')
    expect(wire.actionId).toBe('wave')
    expect(wire.action).toBe('wave')
    expect(wire.schemaVersion).toBe('1.0.0')

    h.handleAck({ eventId: 'evt-1', event: { id: 'evt-1', action: 'wave' } })
    const r = await p
    expect(r.settledBy).toBe('ack')
    expect(r.event).toEqual({ id: 'evt-1', action: 'wave' })
    expect(restInteract).not.toHaveBeenCalled()
  })

  it('1.6s 未收到 ack → 自动 REST 兜底（同一 eventId，服务端幂等去重）', async () => {
    vi.useFakeTimers()
    const { ports, restInteract } = makePorts()
    const h = createSendInteraction(ports)

    const p = h.sendInteraction({ ...CMD, eventId: 'evt-2' })
    await vi.advanceTimersByTimeAsync(1600)
    const r = await p

    expect(restInteract).toHaveBeenCalledTimes(1)
    expect((restInteract.mock.calls[0][0] as Record<string, unknown>).eventId).toBe('evt-2')
    expect(r.settledBy).toBe('rest-after-timeout')
  })

  it('ack 晚到但已在超时后结算 → 不重复 resolve（幂等）', async () => {
    vi.useFakeTimers()
    const { ports } = makePorts()
    const h = createSendInteraction(ports)

    const p = h.sendInteraction({ ...CMD, eventId: 'evt-3' })
    await vi.advanceTimersByTimeAsync(1600)
    const r = await p
    expect(r.settledBy).toBe('rest-after-timeout')

    // 晚到的 ack 不应炸进程，也不应改变已结算结果
    expect(() => h.handleAck({ eventId: 'evt-3' })).not.toThrow()
    await Promise.resolve()
    expect(r.settledBy).toBe('rest-after-timeout')
  })
})

describe('sendInteraction — 离线/失败路径', () => {
  it('socket 离线 → 直接 REST（不 emit）', async () => {
    const { ports, emit, restInteract } = makePorts({ isSocketConnected: () => false })
    const h = createSendInteraction(ports)

    const r = await h.sendInteraction({ ...CMD, eventId: 'evt-4' })
    expect(emit).not.toHaveBeenCalled()
    expect(restInteract).toHaveBeenCalledTimes(1)
    expect(r.settledBy).toBe('rest')
    expect(r.event).toEqual({ id: 'evt-x' })
  })

  it('REST 失败（断网）→ resolve event:null，不 reject', async () => {
    const { ports } = makePorts({
      isSocketConnected: () => false,
      restInteract: vi.fn().mockRejectedValue(new TypeError('failed to fetch')),
    })
    const h = createSendInteraction(ports)
    const r = await h.sendInteraction({ ...CMD, eventId: 'evt-5' })
    expect(r.event).toBeNull()
    expect(r.duplicate).toBe(false)
  })

  it('REST duplicate 标记透传（重连重发场景）', async () => {
    const { ports } = makePorts({
      isSocketConnected: () => false,
      restInteract: vi.fn().mockResolvedValue({ event: { id: 'evt-6' }, growth: null, duplicate: true }),
    })
    const h = createSendInteraction(ports)
    const r = await h.sendInteraction({ ...CMD, eventId: 'evt-6' })
    expect(r.duplicate).toBe(true)
  })

  it('无 eventId 时自动生成（每次互动唯一）', async () => {
    const { ports, emit } = makePorts()
    const h = createSendInteraction(ports)
    void h.sendInteraction({ ...CMD })
    void h.sendInteraction({ ...CMD })
    const a = (emit.mock.calls[0][1] as Record<string, unknown>).eventId
    const b = (emit.mock.calls[1][1] as Record<string, unknown>).eventId
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })
})
