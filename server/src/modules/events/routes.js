/**
 * events/routes.js — REST 端点（V2.0 Task 2）
 *
 * 契约（§10 网络降级）：Socket 断开 → REST 兜底 → 客户端 outbox；按 eventId 去重。
 * 项目规约：API 一律返回 200 JSON（错误也走 JSON body）。
 */
import express from 'express'

export function createEventsRoutes({ service, memories, online, io }) {
  const router = express.Router()

  /** REST 兜底：WS 断线时互动从这里落库（与 Socket 共用同一 service，按 eventId 幂等） */
  router.post('/api/interact', (req, res) => {
    const out = service.settleInteraction(req.body)
    if (out.error || !out.event) return res.json({ ...out, event: null, growth: null })
    if (!out.duplicate) {
      // 实时补推：接收方在线就补播（发送端已有本地反馈，不自回声）
      try {
        const sock = online.get(out.event.receiverId)
        if (sock) io.to(sock).emit('interaction', out.event)
      } catch (_e) { /* 推送失败不影响落库响应 */ }
    }
    res.json(out)
  })

  /** 时间线（旧格式行，客户端 v1.6 兼容读取） */
  router.get('/api/events/:userId', (_req, res) => {
    res.json({ events: service.listEvents(_req.params.userId) })
  })

  // ---------- SharedMoment（双人共同时刻） ----------
  router.post('/api/moments', (req, res) => {
    const out = memories.prepareSharedMoment(req.body ?? {})
    res.json(out)
  })

  router.post('/api/moments/:id/transition', (req, res) => {
    const { state, phaseMarkers } = req.body ?? {}
    res.json(memories.transitionMoment(req.params.id, state, phaseMarkers))
  })

  // ---------- Memory（回忆时间线） ----------
  router.get('/api/memories/:relationshipId', (req, res) => {
    res.json({ memories: memories.listMemories(req.params.relationshipId) })
  })

  router.post('/api/memories', (req, res) => {
    res.json(memories.createMemory(req.body ?? {}))
  })

  router.delete('/api/memories/:id', (req, res) => {
    res.json(memories.softDeleteMemory(req.params.id))
  })

  return router
}
