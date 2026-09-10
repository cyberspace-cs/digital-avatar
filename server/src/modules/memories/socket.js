/**
 * memories/socket.js — 双人编排 socket 同步（V2.0 Task 6，契约 §8）
 *
 * 流程（服务端只同步开始时间/就绪状态/完成状态，禁止逐帧同步）：
 *   1. 发起端 REST POST /api/moments 拿到 momentId（state=requested）
 *   2. 发起端 emit moment.prepare {momentId, choreographyId, actionId, senderId, receiverId}
 *   3. 服务端校验 bond → 向两端广播 moment.prepare（附 serverStartAt = now+PREPARE_LEAD_MS
 *      与锚点配置 contactGapPx）
 *   4. 两端各自就绪后 emit moment.ready；集齐两端 → 广播 moment.start {startAt, readyCount:2}
 *   5. 若到 serverStartAt 仍未集齐 → 也广播 moment.start（readyCount=已就绪数），
 *      发起端据此走 partial 降级（对方离线不阻断：动画可单侧播，落 partial 回忆）
 */

const PREPARE_LEAD_MS = 2500 // prepare 广播 → 预定开跑的提前量（两端装填动画/走位预算）
const READY_GRACE_MS = 1500 // 预定开跑后的额外等待宽限

/** 编排 → 接触距离（px，root 锚点间距；hug 最近，shoulder-lean 贴得最近） */
const CONTACT_GAP_PX = {
  'hug.v1': 120,
  'handhold.v1': 90,
  'shoulder-lean.v1': 70,
}

export function registerMomentSockets(io, online, memories) {
  /**
   * momentId → 会话元数据
   * { senderId, receiverId, ready:Set<userId>, started, timer, broadcastStart() }
   */
  const sessions = new Map()

  io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId
    if (!userId) return

    socket.on('moment.prepare', (payload) => {
      const { momentId, choreographyId, actionId, senderId, receiverId } = payload ?? {}
      if (!momentId || !senderId || !receiverId || senderId !== userId) return
      const bond = memories.q.bondsOf.get(senderId, senderId)
      const isPair =
        bond &&
        ((bond.user_a === senderId && bond.user_b === receiverId) ||
          (bond.user_a === receiverId && bond.user_b === senderId))
      if (!isPair) {
        socket.emit('moment.prepare_rejected', { momentId, reason: 'not bonded' })
        return
      }

      const body = {
        momentId,
        choreographyId: choreographyId ?? 'hug.v1',
        actionId: actionId ?? 'hug',
        senderId,
        receiverId,
        serverStartAt: Date.now() + PREPARE_LEAD_MS,
        anchors: { contactGapPx: CONTACT_GAP_PX[choreographyId] ?? 120 },
      }

      // 广播给两端（接收方 + 发起方回声；发起端凭回声推进 accepted→preparing→ready）
      const rsock = online.get(receiverId)
      if (rsock) {
        try { io.to(rsock).emit('moment.prepare', body) } catch (_e) { /* 推送失败不阻断 */ }
      }
      socket.emit('moment.prepare', body)

      // 同 momentId 重复 prepare：重置就绪集（幂等）
      const prev = sessions.get(momentId)
      if (prev) clearTimeout(prev.timer)
      const session = {
        senderId,
        receiverId,
        ready: new Set(),
        started: false,
        timer: null,
      }
      session.broadcastStart = () => {
        if (session.started) return
        session.started = true
        clearTimeout(session.timer)
        const startBody = { momentId, startAt: Date.now(), readyCount: session.ready.size }
        for (const uid of [session.senderId, session.receiverId]) {
          const sock = online.get(uid)
          if (sock) {
            try { io.to(sock).emit('moment.start', startBody) } catch (_e) { /* 忽略 */ }
          }
        }
        sessions.delete(momentId)
      }
      session.timer = setTimeout(() => session.broadcastStart(), PREPARE_LEAD_MS + READY_GRACE_MS)
      sessions.set(momentId, session)
    })

    // 连接级 ready 监听：任一端的 ready 都能到达（prepare 与 ready 可能在不同连接）
    socket.on('moment.ready', (p) => {
      const momentId = p?.momentId
      if (!momentId) return
      const session = sessions.get(momentId)
      if (!session || session.started) return
      if (userId !== session.senderId && userId !== session.receiverId) return
      session.ready.add(userId)
      if (session.ready.size >= 2) session.broadcastStart()
    })
  })
}
