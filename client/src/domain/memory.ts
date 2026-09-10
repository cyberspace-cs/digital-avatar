/**
 * domain/memory.ts — 共同回忆领域模型（V2.0 Task 3）
 *
 * 纯函数：时间线分组、展示元数据。UI（Task 6 MemoryTimeline）只消费这里。
 * 类型以 shared 契约为准（Memory / SharedMoment），客户端不另造结构。
 */
import type { Memory, MemoryKind, SharedMoment } from '@digital-avatar/shared'

/** 时间线分组条目：按天倒序 */
export interface MemoryDayGroup {
  /** 'YYYY-MM-DD' */
  day: string
  items: Memory[]
}

/** 展示用 emoji（回忆卡片图标） */
export const MEMORY_EMOJI: Record<MemoryKind, string> = {
  interaction: '💬',
  shared_moment: '🤝',
  milestone: '⭐',
  anniversary: '📅',
}

export function memorySubtitle(kind: MemoryKind): string {
  switch (kind) {
    case 'interaction':
      return '互动'
    case 'shared_moment':
      return '共同时刻'
    case 'milestone':
      return '里程碑'
    case 'anniversary':
      return '纪念日'
  }
}

/**
 * SQLite localtime 格式（"YYYY-MM-DD HH:MM:SS"）与 ISO（含 T/Z）统一转可解析格式，
 * 再取本地日期做分组 key。坏数据回退 'unknown'（不炸 UI）。
 */
export function dayKeyOf(occurredAt: string): string {
  const d = new Date(occurredAt.includes('T') || occurredAt.includes('Z') ? occurredAt : occurredAt.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return 'unknown'
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 按天分组（保持传入的倒序；同一天内保持原顺序） */
export function groupMemoriesByDay(memories: Memory[]): MemoryDayGroup[] {
  const groups: MemoryDayGroup[] = []
  const index = new Map<string, MemoryDayGroup>()
  for (const m of memories) {
    const day = dayKeyOf(m.occurredAt)
    let g = index.get(day)
    if (!g) {
      g = { day, items: [] }
      index.set(day, g)
      groups.push(g)
    }
    g.items.push(m)
  }
  return groups
}

/** 一次共同时刻是否可回放（完成/部分完成都可回看） */
export function isReplayableMoment(moment: SharedMoment): boolean {
  return moment.state === 'completed' || moment.state === 'partial'
}
