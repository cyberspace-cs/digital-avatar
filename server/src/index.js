import express from 'express'
import cors from 'cors'
import http from 'node:http'
import { Server } from 'socket.io'
import { q, uuid } from './db.js'
import { createEventsService } from './modules/events/service.js'
import { createMemoriesService } from './modules/memories/service.js'
import { createEventsRoutes } from './modules/events/routes.js'
import { registerEventSockets } from './modules/events/socket.js'

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

// ---------- V2.0 模块化事件与回忆服务（Socket 与 REST 共用同一 service，按 eventId 幂等） ----------
const service = createEventsService({ q, uuid })
const memories = createMemoriesService({ q, uuid })
// 结算后副作用：首次互动里程碑（仅已绑定关系；memories 内部按 key 幂等，重复互动不重复落）
// 注意：hook 内任何异常都由 service 捕获记录，事件已落库不受影响
service.setHooks({
  onSettled: ({ event, bond }) => {
    if (bond) memories.ensureMilestone(bond.id, 'first_interaction', '第一次互动')
  },
})

// ---------- REST（身份 / 邀请 / 状态 / 情侣装——历史行为不变） ----------
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
  const { userId, mood, visibility, avatar, style, outfit } = req.body
  q.setState.run(userId, mood ?? 'neutral', visibility ?? 'public')
  // V1.3 换装：形象（模型）与穿搭风格（滤镜）持久化在 users 行上
  if (avatar) q.updateUserAvatar.run(avatar, userId)
  if (style) q.updateUserStyle.run(style, userId)
  // V1.5.0 衣橱 2.0：款式（整纹理替换）持久化
  if (outfit) q.updateUserOutfit.run(outfit, userId)
  const user = q.getUser.get(userId)
  res.json({ state: q.getState.get(userId), avatar: user?.avatar, style: user?.style ?? 'default', outfit: user?.outfit ?? 'base' })
})

app.get('/api/state/:userId', (req, res) => {
  const user = q.getUser.get(req.params.userId)
  res.json({
    state: q.getState.get(req.params.userId) ?? null,
    avatar: user?.avatar ?? 'hiyori',
    style: user?.style ?? 'default',
    outfit: user?.outfit ?? 'base',
  })
})

// ---------- V1.6.0 情侣衣橱：一键情侣装（服务端权威结算） ----------
// 与 client/src/live2d/couple.ts 保持镜像（服务端是结算权威，不能依赖客户端传槽位）
const AVATAR_GENDER = { hiyori: 'f', haru: 'f', natori: 'm', chitose: 'm' }
const COUPLE_THEMES = {
  seafog: { label: '海雾情侣', m: { style: 'navy' }, f: { style: 'ocean' } },
  duskcherry: { label: '暮樱情侣', m: { style: 'charcoal' }, f: { style: 'sakura' } },
  wild: { label: '旷野情侣', m: { style: 'olive' }, f: { style: 'sunset' } },
  midnight: { label: '暗夜情侣', m: { style: 'navy' }, f: { style: 'night' } },
  mono: { label: '经典黑白', m: { style: 'mono' }, f: { style: 'mono' } },
  // 成套款（真·同图案情侣针织，纹理见 client/public/models/*/outfits）：
  // variant 仅对支持该变体的形象下发（Chitose knit_sea/knit_heart，Haru sailor_sea/sailor_heart）
  'seafog-plaid': { label: '海雾格纹', m: { style: 'navy', variant: 'knit_sea' }, f: { style: 'ocean', variant: 'sailor_sea' } },
  duskheart: { label: '暮樱爱心', m: { style: 'charcoal', variant: 'knit_heart' }, f: { style: 'sakura', variant: 'sailor_heart' } },
  // 解除情侣装：双方回 原生+base（客户端"解除"按钮专用）
  none: { label: '解除情侣装', m: { style: 'default' }, f: { style: 'default' } },
}

app.post('/api/couple-outfit', (req, res) => {
  const { userId, themeId } = req.body ?? {}
  const theme = COUPLE_THEMES[themeId]
  if (!userId || !theme) return res.status(400).json({ error: 'userId and valid themeId required' })
  const bond = q.bondsOf.get(userId, userId)
  if (!bond) return res.status(400).json({ error: 'no_bond' })
  const partnerId = bond.user_a === userId ? bond.user_b : bond.user_a
  const members = []
  for (const uid of [userId, partnerId]) {
    const user = q.getUser.get(uid)
    if (!user) return res.status(404).json({ error: `user not found: ${uid}` })
    // 按各自形象的性别取对应槽位（同性别组合都取 m 槽 = 双子装）
    const slot = AVATAR_GENDER[user.avatar] === 'f' ? theme.f : theme.m
    const variant = slot.variant ?? 'base'
    q.updateUserStyle.run(slot.style, uid)
    q.updateUserOutfit.run(variant, uid)
    members.push({ userId: uid, avatar: user.avatar, style: slot.style, outfit: variant })
  }
  // 向两端推送（含发起者；发起端用于确认+双端一致，避免乐观态与服务端漂移）
  for (const m of members) {
    const sock = online.get(m.userId)
    if (sock) io.to(sock).emit('couple_applied', { themeId, by: userId, members })
  }
  res.json({ ok: true, themeId, members })
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ---------- 火花/等级/任务：V2.0 起只读兼容（红线：任何路径不再写入） ----------
const LEVELS = [
  { level: 1, name: '火种', at: 0 },
  { level: 2, name: '火苗', at: 100 },
  { level: 3, name: '小火人', at: 300 },
  { level: 4, name: '烈焰', at: 700 },
  { level: 5, name: '燎原', at: 1500 },
  { level: 6, name: '不灭', at: 3000 },
  { level: 7, name: '永恒', at: 6000 },
]
const QUESTS = [
  { id: 'interact5', label: '互相互动 5 次', target: 5, reward: 10 },
  { id: 'saymsg', label: '说一句话', target: 1, reward: 10 },
  { id: 'feed1', label: '给 TA 喂一次食', target: 1, reward: 10 },
]

const todayStr = () => new Date().toLocaleDateString('sv-SE')

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

// 旧客户端兼容读取（只读）：等级元信息
app.get('/api/bond/:userId', (req, res) => {
  const bond = q.bondsOf.get(req.params.userId, req.params.userId)
  if (!bond) return res.json({ bond: null })
  res.json({ bond: bondMeta(bond) })
})

// 旧客户端兼容读取（只读）：任务进度（无奖励发放，仅展示历史进度）
app.get('/api/quests/:userId', (req, res) => {
  const bond = q.bondsOf.get(req.params.userId, req.params.userId)
  if (!bond) return res.json({ quests: [], streak: 0, lastActiveDay: null, cold: true })
  const day = todayStr()
  const rows = q.eventsOfDayForBond.all(
    `${day} 00:00:00`, bond.user_a, bond.user_b, bond.user_b, bond.user_a,
  )
  const counts = {
    interact5: rows.length,
    saymsg: rows.filter((r) => r.message).length,
    feed1: rows.filter((r) => r.action === 'feed').length,
  }
  const quests = QUESTS.map((t) => {
    const progress = Math.min(counts[t.id] ?? 0, t.target)
    return { id: t.id, label: t.label, target: t.target, reward: t.reward, progress, done: progress >= t.target, rewarded: false }
  })
  res.json({ quests, streak: bond.streak ?? 0, lastActiveDay: bond.last_active_day, cold: bond.last_active_day !== day })
})

// ---------- V2.0 事件与回忆端点（REST 兜底 /api/interact、moments、memories） ----------
// io 必须先于路由工厂创建（工厂解构 { io }，先挂载会触发 TDZ ReferenceError）
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })
app.use(createEventsRoutes({ service, memories, online, io }))
registerEventSockets(io, online, service)

const PORT = process.env.PORT || 8090
server.listen(PORT, () => console.log(`[digital-avatar] server on :${PORT}`))
