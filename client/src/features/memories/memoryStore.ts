/**
 * features/memories/memoryStore.ts — 回忆时间线状态（V2.0 Task 6）
 *
 * 轻量 hook store：拉取 → 按天分组（domain/memory 纯函数）→ 本地乐观删除。
 * 数据权威在服务端（软删除），UI 只消费这里的 groups。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Memory } from '@digital-avatar/shared'
import { groupMemoriesByDay, type MemoryDayGroup } from '../../domain/memory'
import { api } from '../../api'

export interface MemoryTimelineStore {
  /** 按天倒序分组后的时间线 */
  groups: MemoryDayGroup[]
  loading: boolean
  reload: () => void
  /** 软删除一条回忆（本地乐观移除；服务端失败时抛错给调用方 toast） */
  remove: (memoryId: string) => Promise<void>
}

export function useMemoryTimeline(relationshipId: string | null): MemoryTimelineStore {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(() => {
    if (!relationshipId) {
      setMemories([])
      return
    }
    setLoading(true)
    api.listMemories(relationshipId)
      .then((r) => setMemories(r.memories))
      .catch(() => { /* 拉取失败保持旧数据，UI 可手动刷新 */ })
      .finally(() => setLoading(false))
  }, [relationshipId])

  useEffect(() => {
    reload()
  }, [reload])

  const remove = useCallback(async (memoryId: string) => {
    await api.deleteMemory(memoryId)
    setMemories((prev) => prev.filter((m) => m.memoryId !== memoryId))
  }, [])

  return { groups: groupMemoriesByDay(memories), loading, reload, remove }
}
