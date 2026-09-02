import express from 'express'
import cors from 'cors'
import http from 'node:http'
import { Server } from 'socket.io'
import { q, uuid } from './db.js'

const app = express()
app.use(cors())
app.use(express.json())

const online = new Map() // userId -> socketId

// ---------- REST ----------
app.post('/api/identity', (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name required' })
  const id = uuid()
  q.insertUser.run(id, name.trim())
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
  if (!q.getBond.get(inviter, userId, inviter, userId)) {
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
  const { userId, mood, visibility } = req.body
  q.setState.run(userId, mood ?? 'neutral', visibility ?? 'public')
  res.json({ state: q.getState.get(userId) })
})

app.get('/api/state/:userId', (req, res) => {
  res.json({ state: q.getState.get(req.params.userId) ?? null })
})

app.get('/api/events/:userId', (req, res) => {
  res.json({ events: q.eventsFor.all(req.params.userId, req.params.userId) })
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

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
    const { senderId, receiverId, action, message } = payload ?? {}
    if (!senderId || !receiverId || !action) return
    // 状态快照：接收方当前状态（互动后发现的关键）
    const receiverState = q.getState.get(receiverId)
    const stateSnapshot =
      receiverState && receiverState.mood !== 'neutral'
        ? JSON.stringify({ mood: receiverState.mood, visibility: receiverState.visibility })
        : null

    const id = uuid()
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
    // 推给接收方；若不在线则落库待回看
    const sock = online.get(receiverId)
    if (sock) {
      io.to(sock).emit('interaction', event)
      socket.emit('interaction_ack', { ...event, status: 'played' })
    } else {
      socket.emit('interaction_ack', event)
    }
    // 记录进发送方时间线
    socket.emit('interaction', { ...event, senderId, self: true })
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
