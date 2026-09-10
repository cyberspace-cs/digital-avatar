/**
 * bond/routes.test.js — 绑定关系端点（V2.0 Task 7）
 *
 * 覆盖：
 * - 旧火花字段只读兼容：旧库（手工 seed growth/streak/last_active_day）升级后 GET /api/bond 原样透传
 * - 新版不再写入红线：互动结算 + 拥抱完成后，bonds 的旧增长列逐字节不变
 * - 解绑流程：删除 bond、双端推 unbonded、重复解绑 no_bond、解绑后 GET /api/bond 为 null
 * 项目规约：一切响应 200 JSON。
 */
import { describe, it, expect, afterEach } from 'vitest'
import express from 'express'
import http from 'node:http'
import { createStore } from '../src/db.js'
import { createEventsService } from '../src/modules/events/service.js'
import { createMemoriesService } from '../src/modules/memories/service.js'
import { createBondRoutes } from '../src/modules/bond/routes.js'

let server

/** 挂 bond + events + memories 路由的测试应用；sent 记录 io 广播供断言 */
async function withApp(fn) {
  const { q, uuid } = createStore(':memory:')
  const service = createEventsService({ q, uuid })
  const memories = createMemoriesService({ q, uuid })
  const sent = []
  const online = new Map()
  const io = { to: (sockId) => ({ emit: (event, payload) => sent.push({ sockId, event, payload }) }) }
  const app = express()
  app.use(express.json())
  app.use(createBondRoutes({ q, online, io }))
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base, { q, service, memories, sent, online })
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

const get = (url) => fetch(url).then((r) => r.json())

afterEach(async () => {
  if (server) await new Promise((r) => server.close(r))
})

describe('GET /api/bond — 旧火花字段只读兼容', () => {
  it('旧库 seed 的 growth/streak/last_active_day 原样透传，等级按旧映射计算', async () => {
    await withApp(async (base, { q }) => {
      q.insertUser.run('u1', 'Alice', 'hiyori')
      q.insertUser.run('u2', 'Bob', 'haru')
      q.insertBond.run('bond1', 'u1', 'u2')
      // 模拟 V1.x 旧库：火花系统时代的成长数据留在行上
      q.db.prepare(
        "UPDATE bonds SET growth = 321, streak = 4, last_active_day = '2026-01-01' WHERE id = 'bond1'",
      ).run()

      const out = await get(`${base}/api/bond/u1`)
      expect(out.bond).toEqual({
        id: 'bond1',
        growth: 321,
        streak: 4,
        lastActiveDay: '2026-01-01',
        level: 3, // 321 → 小火人（300 ≤ 321 < 700）
        levelName: '小火人',
        nextLevelAt: 700,
      })
    })
  })

  it('新库默认值：growth/streak 为 0，无等级异常；bond 不存在返回 null', async () => {
    await withApp(async (base, { q }) => {
      q.insertUser.run('u1', 'Alice', 'hiyori')
      q.insertUser.run('u2', 'Bob', 'haru')
      q.insertBond.run('bond1', 'u1', 'u2')
      const out = await get(`${base}/api/bond/u1`)
      expect(out.bond.growth).toBe(0)
      expect(out.bond.streak).toBe(0)
      expect(out.bond.level).toBe(1)
      expect(out.bond.id).toBe('bond1')

      const none = await get(`${base}/api/bond/ghost`)
      expect(none.bond).toBeNull()
    })
  })
})

describe('红线：V2.0 任何路径不再写入旧增长列', () => {
  it('互动结算 + 首次拥抱里程碑完成后，bonds 旧列逐字节不变', async () => {
    await withApp(async (base, { q, service, memories }) => {
      q.insertUser.run('u1', 'Alice', 'hiyori')
      q.insertUser.run('u2', 'Bob', 'haru')
      q.insertBond.run('bond1', 'u1', 'u2')
      q.db.prepare(
        "UPDATE bonds SET growth = 321, streak = 4, last_active_day = '2026-01-01' WHERE id = 'bond1'",
      ).run()

      // 挂上首次互动里程碑 hook（与 index.js 生产装配一致）
      service.setHooks({
        onSettled: ({ bond }) => {
          if (bond) memories.ensureMilestone(bond.id, 'first_interaction', '第一次互动')
        },
      })

      // 两次互动（REST 兜底路径同款 service）+ 一次拥抱走完全状态机
      service.settleInteraction({ senderId: 'u1', receiverId: 'u2', action: 'wave', eventId: 'evt-1' })
      service.settleInteraction({ senderId: 'u2', receiverId: 'u1', action: 'feed', eventId: 'evt-2' })
      const created = memories.prepareSharedMoment({
        relationshipId: 'bond1', choreographyId: 'hug.v1', actionId: 'hug', senderId: 'u1', receiverId: 'u2',
      })
      for (const state of ['accepted', 'preparing', 'ready', 'playing', 'completed']) {
        const step = memories.transitionMoment(created.moment.momentId, state)
        expect(step.error).toBeNull()
      }

      const row = q.db.prepare("SELECT growth, streak, last_active_day FROM bonds WHERE id = 'bond1'").get()
      expect(row).toEqual({ growth: 321, streak: 4, last_active_day: '2026-01-01' })

      // 里程碑正常落库（功能本身不受清理影响）
      const milestones = memories.listMemories('bond1').filter((m) => m.kind === 'milestone')
      expect(milestones.map((m) => m.key).sort()).toEqual(['first_hug', 'first_interaction'])
    })
  })
})

describe('POST /api/unbind — 解绑流程', () => {
  it('解绑删除 bond、向双端在线者推 unbonded、之后 GET /api/bond 为 null', async () => {
    await withApp(async (base, { q, sent, online }) => {
      q.insertUser.run('u1', 'Alice', 'hiyori')
      q.insertUser.run('u2', 'Bob', 'haru')
      q.insertBond.run('bond1', 'u1', 'u2')
      online.set('u1', 'sock:u1')
      online.set('u2', 'sock:u2')

      const out = await post(`${base}/api/unbind`, { userId: 'u1' })
      expect(out).toEqual({ ok: true, partnerId: 'u2' })

      const events = sent.filter((s) => s.event === 'unbonded')
      expect(events).toHaveLength(2)
      expect(events.every((e) => e.payload.by === 'u1' && e.payload.partnerId === 'u2')).toBe(true)
      expect(events.map((e) => e.sockId).sort()).toEqual(['sock:u1', 'sock:u2'])

      const after = await get(`${base}/api/bond/u2`)
      expect(after.bond).toBeNull()
      const rows = q.db.prepare('SELECT COUNT(*) AS n FROM bonds').get()
      expect(rows.n).toBe(0)
    })
  })

  it('重复解绑返回 no_bond（幂等友好，仍 200）', async () => {
    await withApp(async (base, { q }) => {
      q.insertUser.run('u1', 'Alice', 'hiyori')
      q.insertUser.run('u2', 'Bob', 'haru')
      q.insertBond.run('bond1', 'u1', 'u2')
      await post(`${base}/api/unbind`, { userId: 'u1' })
      const again = await post(`${base}/api/unbind`, { userId: 'u1' })
      expect(again).toEqual({ ok: false, error: 'no_bond' })
    })
  })

  it('未绑定用户解绑返回 no_bond，不产生推送', async () => {
    await withApp(async (base, { sent }) => {
      const out = await post(`${base}/api/unbind`, { userId: 'lonely' })
      expect(out.ok).toBe(false)
      expect(sent.filter((s) => s.event === 'unbonded')).toHaveLength(0)
    })
  })
})
