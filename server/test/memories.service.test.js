/**
 * memories/service.test.js — 共同回忆与双人共同时刻（V2.0 Task 2 验收测试）
 *
 * 覆盖契约 §8：
 * - 状态机主链与失败/重试分支（partial、playing→preparing 重试）
 * - 里程碑幂等：两个 hug moment 都 completed，first_hug 只落一条
 * - 软删除后时间线不可见
 */
import { describe, it, expect, vi } from 'vitest'
import { createStore } from '../src/db.js'
import { createMemoriesService } from '../src/modules/memories/service.js'

function setup() {
  const { q, uuid } = createStore(':memory:')
  const memories = createMemoriesService({ q, uuid, logger: { log: vi.fn(), error: vi.fn() } })
  return { q, memories }
}

function makeMoment(memories, over = {}) {
  const out = memories.prepareSharedMoment({
    relationshipId: 'bond1',
    choreographyId: 'choreo-1',
    actionId: 'hug',
    senderId: 'u1',
    receiverId: 'u2',
    ...over,
  })
  expect(out.error).toBeNull()
  return out.moment
}

const walk = (memories, id, states) => {
  for (const s of states) {
    const step = memories.transitionMoment(id, s)
    expect(step.error).toBeNull()
  }
}

describe('SharedMoment 状态机', () => {
  it('主链 requested→accepted→preparing→ready→playing→completed 全通过', () => {
    const { memories } = setup()
    const m = makeMoment(memories)
    walk(memories, m.momentId, ['accepted', 'preparing', 'ready', 'playing', 'completed'])
    const final = memories.transitionMoment(m.momentId, 'completed')
    expect(final.error).toContain('illegal transition')
  })

  it('失败态：ready → failed 终态不可再转移', () => {
    const { memories } = setup()
    const m = makeMoment(memories)
    walk(memories, m.momentId, ['accepted', 'preparing', 'ready', 'failed'])
    const stuck = memories.transitionMoment(m.momentId, 'playing')
    expect(stuck.error).toContain('illegal transition failed -> playing')
  })

  it('partial 分支：playing → partial 终态', () => {
    const { memories } = setup()
    const m = makeMoment(memories)
    walk(memories, m.momentId, ['accepted', 'preparing', 'ready', 'playing', 'partial'])
    expect(memories.transitionMoment(m.momentId, 'completed').error).toContain('illegal transition')
  })

  it('重试分支：playing → preparing 允许（阶段重走）', () => {
    const { memories } = setup()
    const m = makeMoment(memories)
    walk(memories, m.momentId, ['accepted', 'preparing', 'ready', 'playing'])
    const retry = memories.transitionMoment(m.momentId, 'preparing')
    expect(retry.error).toBeNull()
    expect(retry.moment.state).toBe('preparing')
  })

  it('不存在的 moment 返回错误', () => {
    const { memories } = setup()
    expect(memories.transitionMoment('nope', 'accepted').error).toBe('moment not found')
  })

  it('非法 state 值被拒绝', () => {
    const { memories } = setup()
    const m = makeMoment(memories)
    expect(memories.transitionMoment(m.momentId, 'hacked').error).toBe('invalid state')
  })
})

describe('里程碑幂等', () => {
  it('两个 hug moment 都 completed，first_hug 只落一条', () => {
    const { memories } = setup()
    const a = makeMoment(memories, { choreographyId: 'c1' })
    const b = makeMoment(memories, { choreographyId: 'c2' })
    walk(memories, a.momentId, ['accepted', 'preparing', 'ready', 'playing', 'completed'])
    walk(memories, b.momentId, ['accepted', 'preparing', 'ready', 'playing', 'completed'])

    const list = memories.listMemories('bond1')
    const hugs = list.filter((m) => m.key === 'first_hug')
    expect(hugs.length).toBe(1)
    expect(hugs[0].kind).toBe('milestone')
  })

  it('ensureMilestone 直接调用同样幂等', () => {
    const { memories } = setup()
    expect(memories.ensureMilestone('bond1', 'first_interaction', '第一次互动')).toBe(true)
    expect(memories.ensureMilestone('bond1', 'first_interaction', '第一次互动')).toBe(false)
    expect(memories.listMemories('bond1').length).toBe(1)
  })
})

describe('shared_moment 回忆落库（V2.0 Task 6）', () => {
  it('completed 落「一起拥抱」回忆，key=moment:<id> 幂等且带 momentId 关联', () => {
    const { memories } = setup()
    const m = makeMoment(memories)
    walk(memories, m.momentId, ['accepted', 'preparing', 'ready', 'playing', 'completed'])

    const list = memories.listMemories('bond1')
    const sm = list.filter((x) => x.kind === 'shared_moment')
    expect(sm.length).toBe(1)
    expect(sm[0].key).toBe(`moment:${m.momentId}`)
    expect(sm[0].title).toBe('一起拥抱')
    expect(sm[0].momentId).toBe(m.momentId)
    // milestone + shared_moment 共两条
    expect(list.length).toBe(2)
  })

  it('partial 也落回忆（「差一点点」），failed 不落', () => {
    const { memories } = setup()
    const a = makeMoment(memories)
    walk(memories, a.momentId, ['accepted', 'preparing', 'ready', 'playing', 'partial'])
    const b = makeMoment(memories)
    walk(memories, b.momentId, ['accepted', 'preparing', 'ready', 'failed'])

    const list = memories.listMemories('bond1')
    const sm = list.filter((x) => x.kind === 'shared_moment')
    expect(sm.length).toBe(1)
    expect(sm[0].title).toBe('拥抱（差一点点）')
    expect(sm[0].description).toContain('下次再来')
    expect(sm[0].momentId).toBe(a.momentId)
  })

  it('shared_moment 回忆不与 first_hug 里程碑重复冲突（key 不同各落一条）', () => {
    const { memories } = setup()
    const a = makeMoment(memories)
    walk(memories, a.momentId, ['accepted', 'preparing', 'ready', 'playing', 'completed'])
    const b = makeMoment(memories)
    walk(memories, b.momentId, ['accepted', 'preparing', 'ready', 'playing', 'completed'])

    const list = memories.listMemories('bond1')
    // 第二个 hug completed：first_hug 幂等不重复；shared_moment key 按 momentId 各一条
    expect(list.filter((x) => x.kind === 'milestone')).toHaveLength(1)
    expect(list.filter((x) => x.kind === 'shared_moment')).toHaveLength(2)
  })
})

describe('Memory 软删除', () => {
  it('删除后 listMemories 不再返回，重复删除返回 not found', () => {
    const { memories } = setup()
    const { memory, error } = memories.createMemory({
      relationshipId: 'bond1',
      kind: 'interaction',
      title: '第一句晚安',
    })
    expect(error).toBeNull()
    expect(memories.softDeleteMemory(memory.memoryId).ok).toBe(true)
    expect(memories.softDeleteMemory(memory.memoryId).error).toBe('memory not found')
    expect(memories.listMemories('bond1').length).toBe(0)
  })

  it('缺必需字段时拒绝创建', () => {
    const { memories } = setup()
    expect(memories.createMemory({ relationshipId: 'bond1' }).error).toBeTruthy()
  })
})
