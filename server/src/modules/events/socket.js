/**
 * events/socket.js — Socket.IO 事件接线（V2.0 Task 2）
 *
 * 契约（§10）：Socket 与 REST 接入同一事件服务，按 eventId 幂等；
 * 动画失败（推送异常）不影响事件保存。在线状态（partner_online）保持旧行为。
 */
export function registerEventSockets(io, online, service) {
  io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId
    if (!userId) return
    online.set(userId, socket.id)

    // 告知双方在线状态
    const bond = service.q.bondsOf.get(userId, userId)
    if (bond) {
      const partnerId = bond.user_a === userId ? bond.user_b : bond.user_a
      const partnerSock = online.get(partnerId)
      if (partnerSock) {
        io.to(partnerSock).emit('partner_online', true)
        socket.emit('partner_online', true)
      }
    }

    // 互动：与 REST /api/interact 共用 service.settleInteraction（eventId 幂等）
    socket.on('interaction', (payload) => {
      const out = service.settleInteraction(payload)
      if (!out || out.error || !out.event) {
        // 静默丢弃会让"发互动没反应"无从排查（V2.0 实锤过一次）——至少留日志
        console.warn('[events] socket settle rejected:', out?.error ?? 'no result', out?.issues ?? '')
        return
      }
      const event = out.event
      const { senderId, receiverId } = event

      // 推给接收方（动画触发）；推送失败只记日志，事件已落库
      try {
        const sock = online.get(receiverId)
        if (sock) io.to(sock).emit('interaction', event)
      } catch (err) {
        console.error('[events] receiver push failed (event persisted):', err?.message ?? err)
      }
      // 发送方时间线（自回声只进时间线，不重播动作——V1.4.3 行为保持）
      socket.emit('interaction', { ...event, senderId, self: true })
      // ack：growth 恒 null（V2.0 停止成长写入，字段保留兼容旧客户端）
      socket.emit('interaction_ack', { ...event, status: 'saved', growth: null })
    })

    socket.on('state_update', (payload) => {
      const { userId: uid } = payload ?? {}
      const bond2 = uid && service.q.bondsOf.get(uid, uid)
      if (!bond2) return
      const partnerId = bond2.user_a === uid ? bond2.user_b : bond2.user_a
      const psock = online.get(partnerId)
      if (psock) io.to(psock).emit('state_update', payload)
    })

    socket.on('disconnect', () => {
      if (online.get(userId) === socket.id) online.delete(userId)
      const bond3 = service.q.bondsOf.get(userId, userId)
      if (bond3) {
        const partnerId = bond3.user_a === userId ? bond3.user_b : bond3.user_a
        const psock = online.get(partnerId)
        if (psock) io.to(psock).emit('partner_online', false)
      }
    })
  })
}
