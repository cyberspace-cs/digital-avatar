/**
 * scripts/verify-offline-replay.mjs — 弱网降级链端到端契约验证（V2.0 Task 8）
 *
 * 用真实 HTTP 服务（server 模块 + 内存 SQLite）验证契约 §10：
 *   Socket 断开 → REST fallback → outbox 本地排队 → 重连顺序回放 → eventId 去重
 *
 * 场景：
 *   1. 离线期间互动只进本地队列，服务端零事件
 *   2. 重连后按入队顺序逐条 POST /api/interact（新契约载荷），全部落库且保序
 *   3. 再次重放同一批 eventId（页面重载/超时歧义）→ duplicate，服务端事件数不变（幂等去重）
 *   4. 重放后新事件仍可正常送达（队列未被去重逻辑污染）
 *   5. 队列中夹杂非法载荷不会阻断后续条目（坏的保留/跳过，好的继续）
 *
 * 运行：node --test scripts/verify-offline-replay.mjs
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from '../server/src/db.js'
import { createEventsService } from '../server/src/modules/events/service.js'
import { createMemoriesService } from '../server/src/modules/memories/service.js'
import { createEventsRoutes } from '../server/src/modules/events/routes.js'

// 脚本位于根 scripts/：express 不装在根，复用 server 工作区的依赖（CJS 经文件 URL 导入）
const __dirname = dirname(fileURLToPath(import.meta.url))
const { default: express } = await import(
  pathToFileURL(join(__dirname, '..', 'server', 'node_modules', 'express', 'index.js')).href
)

let base
let q
let server

/** 极简 outbox：镜像 client/src/application/outbox.ts 的顺序回放语义（持久化由 localStorage 承担） */
function makeClientOutbox(post) {
  let queue = []
  return {
    enqueue: (payload) => {
      // 条目形状 { payload, tries }：去重键在 payload.eventId（与 client outbox 语义一致）
      if (!queue.some((e) => e.payload.eventId === payload.eventId)) queue.push({ payload, tries: 0 })
    },
    pending: () => queue.length,
    /** 重连顺序回放；返回每条结果；成功/duplicate 移除，失败保留（与客户端判定一致） */
    flush: async () => {
      const results = []
      const remaining = []
      for (const entry of queue) {
        let r
        try {
          r = await post(entry.payload)
        } catch {
          r = { event: null }
        }
        const delivered = !!r.event || r.duplicate === true
        results.push({ eventId: entry.payload.eventId, delivered, duplicate: !!r.duplicate })
        if (!delivered) remaining.push(entry)
      }
      queue = remaining
      return results
    },
  }
}

/** 与 client domain/interaction.toWirePayload 同构的新契约载荷 */
function wirePayload(eventId, actionId, n) {
  return {
    schemaVersion: '1.0.0',
    eventId,
    senderId: 'u1',
    receiverId: 'u2',
    actionId,
    action: actionId,
    choreographyId: null,
    message: null,
    clientOccurredAt: new Date(2026, 8, 11, 10, 0, n).toISOString(),
    payload: {},
    privacy: {},
  }
}

before(async () => {
  const store = createStore(':memory:')
  q = store.q
  const service = createEventsService({ q, uuid: store.uuid })
  const memories = createMemoriesService({ q, uuid: store.uuid })
  const io = { to: () => ({ emit: () => { } }) }
  const app = express()
  app.use(express.json())
  app.use(createEventsRoutes({ service, memories, online: new Map(), io }))
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  q.insertUser.run('u1', 'Alice', 'hiyori')
  q.insertUser.run('u2', 'Bob', 'haru')
  q.insertBond.run('bond1', 'u1', 'u2')
})

after(async () => {
  await new Promise((r) => server.close(r))
})

const postInteract = (payload) =>
  fetch(`${base}/api/interact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json())

test('离线期间：互动只进 outbox，服务端零事件', async () => {
  const outbox = makeClientOutbox(postInteract)
  outbox.enqueue(wirePayload('off-1', 'wave', 1))
  outbox.enqueue(wirePayload('off-2', 'feed', 2))
  outbox.enqueue(wirePayload('off-3', 'poke', 3))
  assert.equal(outbox.pending(), 3)
  // 未 flush（断网）→ DB 无事件
  const n = q.db.prepare('SELECT COUNT(*) AS n FROM events').get().n
  assert.equal(n, 0)
})

test('重连回放：按入队顺序全部落库，重复入队自动合并', async () => {
  const outbox = makeClientOutbox(postInteract)
  const p1 = wirePayload('off-1', 'wave', 1)
  outbox.enqueue(p1)
  outbox.enqueue(wirePayload('off-2', 'feed', 2))
  outbox.enqueue(wirePayload('off-3', 'poke', 3))
  outbox.enqueue(p1) // 同 eventId 重复入队（连点/多标签）→ 合并
  assert.equal(outbox.pending(), 3)

  const results = await outbox.flush()
  assert.deepEqual(results.map((r) => r.eventId), ['off-1', 'off-2', 'off-3'])
  assert.ok(results.every((r) => r.delivered && !r.duplicate))
  assert.equal(outbox.pending(), 0)

  const rows = q.db.prepare('SELECT action, id AS event_id FROM events ORDER BY created_at, rowid').all()
  assert.deepEqual(rows.map((r) => r.event_id), ['off-1', 'off-2', 'off-3'])
})

test('二次回放（重载/超时歧义）：全部 duplicate，服务端事件数不增加', async () => {
  const before = q.db.prepare('SELECT COUNT(*) AS n FROM events').get().n
  const outbox = makeClientOutbox(postInteract)
  // 模拟刷新后 outbox 仍残留 → 手工再排同一批
  outbox.enqueue(wirePayload('off-1', 'wave', 1))
  outbox.enqueue(wirePayload('off-2', 'feed', 2))
  outbox.enqueue(wirePayload('off-3', 'poke', 3))
  const results = await outbox.flush()
  assert.ok(results.every((r) => r.delivered && r.duplicate), '重复事件应被服务端幂等吞掉')
  const after = q.db.prepare('SELECT COUNT(*) AS n FROM events').get().n
  assert.equal(after, before, '去重后事件数必须不变')
  assert.equal(outbox.pending(), 0, 'duplicate 视为送达，出队')
})

test('去重不污染队列：回放后新事件正常落库', async () => {
  const outbox = makeClientOutbox(postInteract)
  outbox.enqueue(wirePayload('off-fresh', 'flower', 9))
  const results = await outbox.flush()
  assert.equal(results[0].delivered, true)
  assert.equal(results[0].duplicate, false)
  const hit = q.db.prepare('SELECT 1 AS ok FROM events WHERE id = ?').get('off-fresh')
  assert.ok(hit)
})

test('坏载荷不阻塞队列：失败条目出队语义由客户端保留，后续好条目照常送达', async () => {
  const outbox = makeClientOutbox(postInteract)
  // 非法载荷：REST 返回 event=null（200 JSON），客户端判定未送达保留重试
  outbox.enqueue({ eventId: 'bad-1', junk: true })
  outbox.enqueue(wirePayload('off-good', 'pat', 5))
  const results = await outbox.flush()
  assert.equal(results[0].eventId, 'bad-1')
  assert.equal(results[0].delivered, false)
  assert.equal(results[1].eventId, 'off-good')
  assert.equal(results[1].delivered, true)
  // 坏条目保留在队列（下次联网继续重试/等待死信阈值），好的不被它挡住
  assert.equal(outbox.pending(), 1)
  const good = q.db.prepare('SELECT 1 AS ok FROM events WHERE id = ?').get('off-good')
  assert.ok(good)
})
