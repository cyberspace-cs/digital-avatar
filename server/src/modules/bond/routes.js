/**
 * bond/routes.js — 绑定关系端点（V2.0 Task 7）
 *
 * - GET /api/bond/:userId：旧火花字段只读兼容读取（growth/streak/等级镜像透传，永不写入）；
 *   bond.id 同时是 V2.0 的 relationshipId（回忆时间线 / 共同时刻关联键）
 * - POST /api/unbind：解绑流程。删除 bond 行并向两端推 unbonded；
 *   回忆时间线按 relationshipId 保留历史（不级联删除）
 * 项目规约：API 一律返回 200 JSON。
 */
import express from 'express'
import { bondMeta } from './legacy.js'

export function createBondRoutes({ q, online, io }) {
  const router = express.Router()

  // 旧客户端兼容读取（只读）：growth 元信息 + relationshipId
  router.get('/api/bond/:userId', (req, res) => {
    const bond = q.bondsOf.get(req.params.userId, req.params.userId)
    if (!bond) return res.json({ bond: null })
    res.json({ bond: bondMeta(bond) })
  })

  // 解绑：删除 bond 行，双端推 unbonded（在线者收到后各自回到未绑定态）
  router.post('/api/unbind', (req, res) => {
    const { userId } = req.body ?? {}
    const bond = userId && q.bondsOf.get(userId, userId)
    if (!bond) return res.json({ ok: false, error: 'no_bond' })
    const partnerId = bond.user_a === userId ? bond.user_b : bond.user_a
    q.unbindBond.run(bond.id)
    for (const uid of [userId, partnerId]) {
      const sock = online.get(uid)
      if (sock) {
        try { io.to(sock).emit('unbonded', { by: userId, partnerId }) } catch (_e) { /* 推送失败不阻断 */ }
      }
    }
    res.json({ ok: true, partnerId })
  })

  return router
}
