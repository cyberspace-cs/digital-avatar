/**
 * bond/legacy.js — 旧火花成长字段只读兼容（V2.0 Task 7）
 *
 * V1.2 火花系统（growth/streak/last_active_day/等级/任务）已在 V2.0 产品清理中移除：
 * - 新版任何路径都不再写入这些列（红线，由 bond.routes.test.js 守护）
 * - 但旧数据库里已有值仍要能读出来（只读透传），避免旧库升级后接口缺字段
 * - cold（断联变灰）随连续天数一起删除：last_active_day 不再写入后 cold 恒真，语义已死
 */

const LEVELS = [
  { level: 1, name: '火种', at: 0 },
  { level: 2, name: '火苗', at: 100 },
  { level: 3, name: '小火人', at: 300 },
  { level: 4, name: '烈焰', at: 700 },
  { level: 5, name: '燎原', at: 1500 },
  { level: 6, name: '不灭', at: 3000 },
  { level: 7, name: '永恒', at: 6000 },
]

/** 旧等级映射（只读展示用，V2.0 客户端不再消费） */
export function levelOf(growth) {
  let cur = LEVELS[0]
  let next = null
  for (const l of LEVELS) {
    if (growth >= l.at) cur = l
    else { next = l; break }
  }
  return { level: cur.level, levelName: cur.name, nextLevelAt: next ? next.at : null }
}

/** 只读透传：bond.id 是 V2.0 的 relationshipId；growth 系列为旧库兼容镜像 */
export function bondMeta(bond) {
  return {
    id: bond.id,
    growth: bond.growth ?? 0,
    streak: bond.streak ?? 0,
    lastActiveDay: bond.last_active_day ?? null,
    ...levelOf(bond.growth ?? 0),
  }
}
