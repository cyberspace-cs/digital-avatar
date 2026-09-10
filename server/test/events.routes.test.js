/**
 * events/routes.test.js — REST 兜底与回忆端点（V2.0 Task 2 验收测试）
 *
 * 覆盖契约 §10 网络降级：Socket 断开 → REST 兜底（/api/interact）必达落库；
 * 以及 SharedMoment 状态机端点、Memory CRUD 端点。
 * 项目规约：一切响应 200 JSON。
 */
import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import http from 'node:http'
import { createStore } from '../src/db.js'
import { createEventsService } from '../src/modules/events/service.js'
import { createMemoriesService } from '../src/modules/memories/service.js'
import { createEventsRoutes } from '../src/modules/events/routes.js'

let server

async function withApp(fn) {
  const { q, uuid } = createStore(':memory:')
  const service = createEventsService({ q, uuid })
  const memories = createMemoriesService({ q, uuid })
  // io stub：REST 推送不应因无 socket 而失败
  const io = { to: () => ({ emit: () => {} }) }
  const app = express()
  app.use(express.json())
  app.use(createEventsRoutes({ service, memories, online: new Map(), io }))
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base, { q, service, memories })
  } finally {
    await new Promise((r) => server.close(r))
    server = null
  }
}

const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

afterEach(async () => {
  if (server) await new Promise((r) => server.close(r))
})

describe('REST 兜底 /api/interact', () => {
  it('WS 断线时互动从这里落库，重复 eventId 幂等', async () => {
    await withApp(async (base, { q }) => {
      q.insertUser.run('u1', 'Alice', 'hiyori')
      q.insertUser.run('u2', 'Bob', 'haru')
      q.insertBond.run('bond1', 'u1', 'u2')

      const body = { senderId: 'u1', receiverId: 'u2', action: 'wave', eventId: 'evt-rest-1' }
      const first = await post(`${base}/api/interact`, body)
      expect(first.error).toBeUndefined()
      expect(first.event).not.toBeNull()
      expect(first.growth).toBeNull()

      const second = await post(`${base}/api/interact`, body)
      expect(second.duplicate).toBe(true)

      const rows = q.db.prepare('SELECT COUNT(*) AS n FROM events').get()
      expect(rows.n).toBe(1)
    })
  })

  it('非法载荷返回 200 JSON（不炸进程），event 为 null', async () => {
    await withApp(async (base) => {
      const out = await post(`${base}/api/interact`, { foo: 'bar' })
      expect(out.error).toBeTruthy()
      expect(out.event).toBeNull()
    })
  })

  it('GET /api/events/:userId 返回时间线（旧格式兼容）', async () => {
    await withApp(async (base, { q }) => {
      q.insertUser.run('u1', 'Alice', 'hiyori')
      q.insertUser.run('u2', 'Bob', 'haru')
      await post(`${base}/api/interact`, { senderId: 'u1', receiverId: 'u2', action: 'heart', eventId: 'evt-tl-1' })
      const out = await fetch(`${base}/api/events/u1`).then((r) => r.json())
      expect(out.events.length).toBe(1)
      expect(out.events[0].id).toBe('evt-tl-1')
    })
  })
})

describe('SharedMoment 端点', () => {
  it('创建 → 全状态机推进到 completed，hug 落 first_hug 里程碑', async () => {
    await withApp(async (base, { q }) => {
      const created = await post(`${base}/api/moments`, {
        relationshipId: 'bond1',
        choreographyId: 'choreo-hug-1',
        actionId: 'hug',
        senderId: 'u1',
        receiverId: 'u2',
      })
      expect(created.error).toBeNull()
      expect(created.moment.state).toBe('requested')

      for (const state of ['accepted', 'preparing', 'ready', 'playing', 'completed']) {
        const step = await post(`${base}/api/moments/${created.moment.momentId}/transition`, { state })
        expect(step.error).toBeNull()
      }
      expect(created.moment.momentId).toBeTruthy()

      const milestones = await fetch(`${base}/api/memories/bond1`).then((r) => r.json())
      const hug = milestones.memories.find((m) => m.key === 'first_hug')
      expect(hug).toBeTruthy()
      expect(hug.momentId).toBe(created.moment.momentId)
    })
  })

  it('非法转移被拒绝（requested → playing）', async () => {
    await withApp(async (base) => {
      const created = await post(`${base}/api/moments`, {
        relationshipId: 'bond1',
        choreographyId: 'choreo-x',
        actionId: 'hug',
        senderId: 'u1',
        receiverId: 'u2',
      })
      const bad = await post(`${base}/api/moments/${created.moment.momentId}/transition`, { state: 'playing' })
      expect(bad.error).toContain('illegal transition')
    })
  })

  it('未知 phase 被拒绝（五阶段白名单）', async () => {
    await withApp(async (base) => {
      const created = await post(`${base}/api/moments`, {
        relationshipId: 'bond1',
        choreographyId: 'choreo-y',
        actionId: 'handhold',
        senderId: 'u1',
        receiverId: 'u2',
      })
      await post(`${base}/api/moments/${created.moment.momentId}/transition`, { state: 'accepted' })
      const bad = await post(`${base}/api/moments/${created.moment.momentId}/transition`, {
        state: 'preparing',
        phaseMarkers: [{ phase: 'jump', at: new Date().toISOString() }],
      })
      expect(bad.error).toContain('unknown phase')
    })
  })
})

describe('Memory 端点', () => {
  it('创建（纪念日）→ 列表 → 软删除后不再出现', async () => {
    await withApp(async (base) => {
      const created = await post(`${base}/api/memories`, {
        relationshipId: 'bond1',
        kind: 'anniversary',
        key: 'anniv:2026-09-10',
        title: '在一起 100 天',
      })
      expect(created.error).toBeNull()
      expect(created.memory.key).toBe('anniv:2026-09-10')

      const list1 = await fetch(`${base}/api/memories/bond1`).then((r) => r.json())
      expect(list1.memories.length).toBe(1)

      const del = await fetch(`${base}/api/memories/${created.memory.memoryId}`, { method: 'DELETE' }).then((r) => r.json())
      expect(del.ok).toBe(true)

      const list2 = await fetch(`${base}/api/memories/bond1`).then((r) => r.json())
      expect(list2.memories.length).toBe(0)
    })
  })

  it('同 key 回忆幂等：重复创建返回已有条目', async () => {
    await withApp(async (base) => {
      const body = { relationshipId: 'bond1', kind: 'anniversary', key: 'anniv:2026-12-24', title: '平安夜' }
      const first = await post(`${base}/api/memories`, body)
      const second = await post(`${base}/api/memories`, body)
      expect(second.memory.memoryId).toBe(first.memory.memoryId)

      const list = await fetch(`${base}/api/memories/bond1`).then((r) => r.json())
      expect(list.memories.length).toBe(1)
    })
  })
})
