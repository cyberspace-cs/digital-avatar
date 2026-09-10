/**
 * application/outbox.test.ts — 离线发件箱单测（V2.0 Task 8）
 *
 * 覆盖：入队幂等/上限淘汰/坏存储降级、顺序回放、duplicate 视为送达、
 * 失败保留重试、死信丢弃、flush 并发复用、订阅通知。
 */
import { describe, it, expect, vi } from 'vitest'
import { createOutbox, type OutboxEntry, type OutboxStorage } from './outbox'

function memStorage(initial: OutboxEntry[] = []) {
  let rows = initial
  return {
    read: () => rows,
    write: (next: OutboxEntry[]) => {
      rows = next
    },
    get rows() {
      return rows
    },
  }
}

const entry = (eventId: string, n = 0): OutboxEntry => ({
  eventId,
  payload: { eventId, n },
  createdAt: 1000 + n,
  tries: 0,
})

describe('outbox 入队', () => {
  it('同 eventId 幂等，不重复排队', () => {
    const storage = memStorage()
    const ob = createOutbox({ storage, flushOne: vi.fn(), now: () => 1000 })
    expect(ob.enqueue('e1', { eventId: 'e1' })).toBe(1)
    expect(ob.enqueue('e1', { eventId: 'e1' })).toBe(1)
    expect(ob.pendingCount()).toBe(1)
  })

  it('空 eventId 不入队', () => {
    const ob = createOutbox({ storage: memStorage(), flushOne: vi.fn() })
    expect(ob.enqueue('', {})).toBe(0)
  })

  it('超过 maxEntries 淘汰最旧', () => {
    const storage = memStorage()
    const ob = createOutbox({ storage, flushOne: vi.fn(), maxEntries: 3 })
    ob.enqueue('a', {}); ob.enqueue('b', {}); ob.enqueue('c', {}); ob.enqueue('d', {})
    expect(storage.read().map((e) => e.eventId)).toEqual(['b', 'c', 'd'])
  })

  it('存储坏数据（非数组/坏行/JSON 异常）安全降级为空队列', () => {
    const bad: OutboxStorage = { read: () => 'garbage' as unknown as OutboxEntry[], write: () => { } }
    const ob = createOutbox({ storage: bad, flushOne: vi.fn() })
    expect(ob.pendingCount()).toBe(0)
    const throwing: OutboxStorage = { read: () => { throw new Error('x') }, write: () => { } }
    expect(createOutbox({ storage: throwing, flushOne: vi.fn() }).pendingCount()).toBe(0)
  })

  it('订阅者收到数量变更通知', () => {
    const ob = createOutbox({ storage: memStorage(), flushOne: vi.fn().mockResolvedValue(true) })
    const fn = vi.fn()
    ob.subscribe(fn)
    ob.enqueue('e1', {})
    expect(fn).toHaveBeenLastCalledWith(1)
  })
})

describe('outbox 回放', () => {
  it('按入队顺序逐条投递，成功后持久化移除', async () => {
    const storage = memStorage([entry('a'), entry('b')])
    const order: string[] = []
    const flushOne = vi.fn(async (e: OutboxEntry) => {
      order.push(e.eventId)
      return true
    })
    const ob = createOutbox({ storage, flushOne })
    const r = await ob.flush()
    expect(order).toEqual(['a', 'b'])
    expect(r).toMatchObject({ delivered: 2, duplicate: 0, failed: 0, dropped: 0 })
    expect(storage.read()).toHaveLength(0)
  })

  it('服务端 duplicate（eventId 幂等吞掉）视为送达', async () => {
    const storage = memStorage([entry('dup')])
    const ob = createOutbox({ storage, flushOne: vi.fn().mockResolvedValue({ duplicate: true }) })
    const r = await ob.flush()
    expect(r.duplicate).toBe(1)
    expect(storage.read()).toHaveLength(0)
  })

  it('投递失败保留并 tries+1，下次 flush 可继续', async () => {
    const storage = memStorage([entry('a'), entry('b')])
    let failA = true
    const flushOne = vi.fn(async (e: OutboxEntry) => {
      if (e.eventId === 'a' && failA) return false
      return true
    })
    const ob = createOutbox({ storage, flushOne })
    const r1 = await ob.flush()
    expect(r1.delivered).toBe(1)
    expect(r1.failed).toBe(1)
    expect(storage.read().map((e) => e.eventId)).toEqual(['a'])
    expect(storage.read()[0].tries).toBe(1)

    failA = false
    const r2 = await ob.flush()
    expect(r2.delivered).toBe(1)
    expect(storage.read()).toHaveLength(0)
  })

  it('flushOne 抛异常等同失败保留', async () => {
    const storage = memStorage([entry('a')])
    const ob = createOutbox({ storage, flushOne: vi.fn().mockRejectedValue(new Error('network')) })
    const r = await ob.flush()
    expect(r.failed).toBe(1)
    expect(storage.read()).toHaveLength(1)
  })

  it('达到 maxTries 作死信丢弃并计数，不阻塞后续条目', async () => {
    const storage = memStorage([entry('dead', 0), entry('ok', 1)])
    storage.read()[0].tries = 1
    const flushOne = vi.fn(async (e: OutboxEntry) => e.eventId !== 'dead')
    const ob = createOutbox({ storage, flushOne, maxTries: 2 })
    const r = await ob.flush()
    expect(r.dropped).toBe(1)
    expect(r.delivered).toBe(1)
    expect(storage.read()).toHaveLength(0)
  })

  it('flush 进行中再次调用复用同一 promise（并发安全）', async () => {
    let gate: () => void = () => { }
    const started = new Promise<void>((r) => { gate = r })
    const flushOne = vi.fn(async () => {
      gate()
      return true
    })
    const ob = createOutbox({ storage: memStorage([entry('a')]), flushOne })
    const p1 = ob.flush()
    await started
    const p2 = ob.flush()
    expect(p2).toBe(p1)
    const r = await p1
    expect(r.delivered).toBe(1)
  })

  it('空队列 flush 返回零报告且不调用 flushOne', async () => {
    const flushOne = vi.fn()
    const ob = createOutbox({ storage: memStorage(), flushOne })
    const r = await ob.flush()
    expect(r).toEqual({ delivered: 0, duplicate: 0, failed: 0, dropped: 0 })
    expect(flushOne).not.toHaveBeenCalled()
  })
})
