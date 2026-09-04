import express from 'express'
import cors from 'cors'
import http from 'node:http'
import { Server } from 'socket.io'
import { q, uuid } from './db.js'

const app = express()
app.use(cors())
app.use(express.json())
// 项目规约：API 始终返回 200 JSON——body JSON 解析失败也不走 express 默认 HTML 400
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.json({ error: 'bad_json' })
  }
  next(err)
})

const online = new Map() // userId -> socketId

// ---------- REST ----------
app.post('/api/identity', (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  const id = uuid()
  // V1.3.2：创建时随机分配一个形象（形象库见 client/src/live2d/models.ts）。
  // V1.5.0：mark → chitose（Mark 卡通小孩 + 条款禁改绘美男，已整体移除）
  const INITIAL_AVATARS = ['hiyori', 'haru', 'natori', 'chitose']
  const avatar = INITIAL_AVATARS[Math.floor(Math.random() * INITIAL_AVATARS.length)]
  q.insertUser.run(id, name.trim(), avatar)
  res.json({ user: q.getUser.get(id) })
})

app.get('/api/identity/:id', (req, res) => {
  const user = q.getUser.get(req.params.id)
  if (!user) return res.status(404).json({ error: 'not found' })
  res.json({ user })
})

// 邀请码：base64(邀请人id)
app.post('/api/invite', (req, res) => {
  const { userId } = req.body
  if (!q.getUser.get(userId)) return res.status(404).json({ error: 'user not found' })
  res.json({ code: Buffer.from(userId).toString('base64url') })
})

app.post('/api/invite/:code/accept', (req, res) => {
  const inviter = Buffer.from(req.params.code, 'base64url').toString()
  const { userId } = req.body
  if (inviter === userId) return res.status(400).json({ error: 'cannot invite self' })
  const inviterUser = q.getUser.get(inviter)
  if (!inviterUser || !q.getUser.get(userId))
    return res.status(404).json({ error: 'user not found' })
  if (!q.getBond.get(inviter, userId, userId, inviter)) {
    // V1.3.2 一人一伴：任一方已与其他人绑定则拒绝（否则会产生多条 bond，
    // getPartner 永远返回旧对象，表现为"邀请链接没用"）
    const b1 = q.bondsOf.get(inviter, inviter)
    const b2 = q.bondsOf.get(userId, userId)
    if (b1 || b2) return res.status(409).json({ error: 'already_bound' })
    q.insertBond.run(uuid(), inviter, userId)
  }
  // 通知双方
  const s1 = online.get(inviter)
  const s2 = online.get(userId)
  if (s1) io.to(s1).emit('bonded', { partner: q.getUser.get(userId) })
  if (s2) io.to(s2).emit('bonded', { partner: inviterUser })
  res.json({ partner: inviterUser })
})

app.get('/api/partner/:userId', (req, res) => {
  const uid = req.params.userId
  const bond = q.bondsOf.get(uid, uid)
  if (!bond) return res.json({ partner: null })
  const partnerId = bond.user_a === uid ? bond.user_b : bond.user_a
  res.json({ partner: q.getUser.get(partnerId) })
})

app.post('/api/state', (req, res) => {
  const { userId, mood, visibility, avatar, style } = req.body
  q.setState.run(userId, mood ?? 'neutral', visibility ?? 'public')
  // V1.3 换装：形象（模型）与穿搭风格（滤镜）持久化在 users 行上
  if (avatar) q.updateUserAvatar.run(avatar, userId)
  if (style) q.updateUserStyle.run(style, userId)
  const user = q.getUser.get(userId)
  res.json({ state: q.getState.get(userId), avatar: user?.avatar, style: user?.style ?? 'default' })
})

app.get('/api/state/:userId', (req, res) => {
  const user = q.getUser.get(req.params.userId)
  res.json({
    state: q.getState.get(req.params.userId) ?? null,
    avatar: user?.avatar ?? 'hiyori',
    style: user?.style ?? 'default',
  })
})

app.get('/api/events/:userId', (req, res) => {
  res.json({ events: q.eventsFor.all(req.params.userId, req.params.userId) })
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ---------- V1.2 火花成长体系（服务端权威） ----------
const LEVELS = [
  { level: 1, name: '火种', at: 0 },
  { level: 2, name: '火苗', at: 100 },
  { level: 3, name: '小火人', at: 300 },
  { level: 4, name: '烈焰', at: 700 },
  { level: 5, name: '燎原', at: 1500 },
  { level: 6, name: '不灭', at: 3000 },
  { level: 7, name: '永恒', at: 6000 },
]
// 火花规则：interaction 每日上限按次数（30 次×1）；feed/flower 每日 5 次×2
const SPARK_RULES = {
  interaction: { delta: 1, capTimes: 30 },
  feed: { delta: 2, capTimes: 5 },
  flower: { delta: 2, capTimes: 5 },
}
const QUESTS = [
  { id: 'interact5', label: '互相互动 5 次', target: 5, reward: 10 },
  { id: 'saymsg', label: '说一句话', target: 1, reward: 10 },
  { id: 'feed1', label: '给 TA 喂一次食', target: 1, reward: 10 },
]

const todayStr = () => new Date().toLocaleDateString('sv-SE')
const yesterdayStr = () => new Date(Date.now() - 86400000).toLocaleDateString('sv-SE')

function levelOf(growth) {
  let cur = LEVELS[0]
  let next = null
  for (const l of LEVELS) {
    if (growth >= l.at) cur = l
    else { next = l; break }
  }
  return { level: cur.level, levelName: cur.name, nextLevelAt: next ? next.at : null }
}

function bondMeta(bond) {
  return {
    growth: bond.growth ?? 0,
    streak: bond.streak ?? 0,
    lastActiveDay: bond.last_active_day ?? null,
    cold: !bond.last_active_day || bond.last_active_day < todayStr(),
    ...levelOf(bond.growth ?? 0),
  }
}

function questCountsToday(bond, day) {
  const rows = q.eventsOfDayForBond.all(
    `${day} 00:00:00`, bond.user_a, bond.user_b, bond.user_b, bond.user_a,
  )
  return {
    interact5: rows.length,
    saymsg: rows.filter((r) => r.message).length,
    feed1: rows.filter((r) => r.action === 'feed').length,
  }
}

app.get('/api/bond/:userId', (req, res) => {
  const bond = q.bondsOf.get(req.params.userId, req.params.userId)
  if (!bond) return res.json({ bond: null })
  res.json({ bond: bondMeta(bond) })
})

app.get('/api/quests/:userId', (req, res) => {
  const bond = q.bondsOf.get(req.params.userId, req.params.userId)
  if (!bond) return res.json({ quests: [], streak: 0, lastActiveDay: null, cold: true })
  const day = todayStr()
  const counts = questCountsToday(bond, day)
  const quests = QUESTS.map((t) => {
    const progress = Math.min(counts[t.id] ?? 0, t.target)
    return {
      id: t.id,
      label: t.label,
      target: t.target,
      reward: t.reward,
      progress,
      done: progress >= t.target,
      rewarded: !!q.growthEventExists.get(bond.id, `quest:${t.id}:${day}`),
    }
  })
  res.json({ quests, streak: bond.streak ?? 0, lastActiveDay: bond.last_active_day, cold: bond.last_active_day !== day })
})

// ---------- V1.4.3 互动结算（Socket 与 REST 双链路共用，幂等） ----------
// V1.4.2 的问题：火花结算只走 Socket.IO。WS 断线（生产日志反复出现 ECONNRESET）时
// 互动静默丢失 → "喂食/送花/摸头没有回应，火花也不涨"。现在：
//  - 客户端为每次互动生成 eventId（uuid），两条链路共用，按 events.id 去重，绝不重复结算；
//  - Socket 在线即实时播放；REST 兜底保证落库与火花结算必达。
function settleInteraction({ senderId, receiverId, action, message, eventId } = {}) {
  if (!senderId || !receiverId || !action) return null
  const id = eventId || uuid()
  // 幂等去重：同 eventId 的互动只结算一次
  if (q.getEvent.get(id)) {
    return { event: q.getEvent.get(id), growth: null, duplicate: true }
  }

  // 状态快照：接收方当前状态（互动后发现的关键）
  const receiverState = q.getState.get(receiverId)
  const stateSnapshot =
    receiverState && receiverState.mood !== 'neutral'
      ? JSON.stringify({ mood: receiverState.mood, visibility: receiverState.visibility })
      : null

  q.insertEvent.run(id, senderId, receiverId, action, message ?? null, stateSnapshot)
  const event = {
    id,
    senderId,
    receiverId,
    action,
    message: message ?? null,
    stateSnapshot,
    status: 'delivered',
    createdAt: new Date().toLocaleString('sv-SE').replace('T', ' '),
  }

  // ---- 火花结算（服务端权威）----
  let growth = null
  try {
    // 双向传参（x,y,y,x）：无论谁发起都能命中同一条 bond
    const bond = q.getBond.get(senderId, receiverId, receiverId, senderId)
    if (bond) {
      const day = todayStr()
      const before = levelOf(bond.growth ?? 0)

      // streak：今天首次互动 → 连续 +1；断档 → 重置为 1
      let streak = bond.streak ?? 0
      if (bond.last_active_day !== day) {
        streak = bond.last_active_day === yesterdayStr() ? streak + 1 : 1
      }

      // 火花增量：按当日 reason 计数做软上限
      const reasonKey = action === 'feed' || action === 'flower' ? action : 'interaction'
      const rule = SPARK_RULES[reasonKey]
      let delta = 0
      const used = q.growthCountsOfDay.all(bond.id, day).find((r) => r.reason === reasonKey)?.n ?? 0
      if (rule && used < rule.capTimes) delta = rule.delta

      // 每日任务奖励（判重：quest:<id>:<day> 每天只发一次）
      let questDelta = 0
      const counts = questCountsToday(bond, day)
      for (const t of QUESTS) {
        if ((counts[t.id] ?? 0) >= t.target && !q.growthEventExists.get(bond.id, `quest:${t.id}:${day}`)) {
          q.insertGrowthEvent.run(uuid(), bond.id, t.reward, `quest:${t.id}:${day}`, day)
          questDelta += t.reward
        }
      }

      if (delta > 0) q.insertGrowthEvent.run(uuid(), bond.id, delta, reasonKey, day)
      growth = (bond.growth ?? 0) + delta + questDelta
      q.updateBondGrowth.run(growth, streak, day, bond.id)

      const after = levelOf(growth)
      growth = {
        bond: { ...bondMeta({ ...bond, growth, streak, last_active_day: day }), growth, ...after },
        delta: delta + questDelta,
        leveledUp: after.level > before.level,
      }
    }
  } catch (err) {
    console.error('[digital-avatar] growth settlement failed:', err)
    growth = null
  }
  return { event, growth, duplicate: false }
}

// REST 兜底：WS 断线时互动从这里落库 + 结算（按项目规约始终 200）。
// V1.4.3 修复：结算后必须把事件推给接收方（原实现只返回 HTTP 响应，
// 发送端 WS 半开时走兜底 → 火花涨了但对方永远看不到反应 = "喂食/送花没回应"）。
app.post('/api/interact', (req, res) => {
  const out = settleInteraction(req.body)
  if (!out) return res.json({ error: 'senderId/receiverId/action required', event: null, growth: null })
  const { event, growth } = out
  // 实时补推：接收方在线就补播（发送端自己已有本地反馈，不再自回声）
  if (event && !out.duplicate) {
    const sock = online.get(event.receiverId)
    if (sock) io.to(sock).emit('interaction', event)
    if (growth) {
      const s1 = online.get(event.senderId)
      const s2 = online.get(event.receiverId)
      if (s1) io.to(s1).emit('growth_update', growth)
      if (s2) io.to(s2).emit('growth_update', growth)
    }
  }
  res.json(out)
})

// ---------- Socket.IO ----------
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId
  if (!userId) return
  online.set(userId, socket.id)

  // 告知双方在线状态
  const bond = q.bondsOf.get(userId, userId)
  if (bond) {
    const partnerId = bond.user_a === userId ? bond.user_b : bond.user_a
    const partnerSock = online.get(partnerId)
    if (partnerSock) {
      io.to(partnerSock).emit('partner_online', true)
      socket.emit('partner_online', true)
    }
  }

  socket.on('interaction', (payload) => {
    const out = settleInteraction(payload)
    if (!out) return
    const { event, growth } = out
    const { senderId, receiverId } = event
    // 推给接收方；若不在线则落库待回看
    const sock = online.get(receiverId)
    if (sock) {
      io.to(sock).emit('interaction', event)
      socket.emit('interaction_ack', { ...event, status: 'played', growth })
    } else {
      socket.emit('interaction_ack', { ...event, growth })
    }
    // 记录进发送方时间线
    socket.emit('interaction', { ...event, senderId, self: true })

    // ---- V1.4.3 火花成长：结算结果双端实时同步（REST 兜底时由 HTTP 响应带回）----
    if (growth) {
      const s1 = online.get(senderId)
      const s2 = online.get(receiverId)
      if (s1) io.to(s1).emit('growth_update', growth)
      if (s2) io.to(s2).emit('growth_update', growth)
    }
  })

  socket.on('state_update', (payload) => {
    const { userId: uid } = payload ?? {}
    const bond2 = uid && q.bondsOf.get(uid, uid)
    if (!bond2) return
    const partnerId = bond2.user_a === uid ? bond2.user_b : bond2.user_a
    const psock = online.get(partnerId)
    if (psock) io.to(psock).emit('state_update', payload)
  })

  socket.on('disconnect', () => {
    if (online.get(userId) === socket.id) online.delete(userId)
    const bond3 = q.bondsOf.get(userId, userId)
    if (bond3) {
      const partnerId = bond3.user_a === userId ? bond3.user_b : bond3.user_a
      const psock = online.get(partnerId)
      if (psock) io.to(psock).emit('partner_online', false)
    }
  })
})

const PORT = process.env.PORT || 8090
server.listen(PORT, () => console.log(`[digital-avatar] server on :${PORT}`))
