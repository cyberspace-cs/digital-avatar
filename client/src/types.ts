export type Mood = 'neutral' | 'happy' | 'low' | 'tired' | 'angry'
export type Visibility = 'public' | 'each-time' | 'discover-after'

export interface User {
  id: string
  name: string
  avatar: string
  /** V1.3 换装：穿搭风格（ColorMatrix 预设 id） */
  style?: string
  /** V1.5.0 衣橱 2.0：款式（整纹理替换，'base' = 原生） */
  outfit?: string
  personality: string
}

export interface InteractionEvent {
  id: string
  senderId: string
  receiverId: string
  action: string
  message?: string | null
  stateSnapshot?: string | null
  status: string
  createdAt: string
}

export interface UserState {
  userId: string
  mood: Mood
  visibility: Visibility
  updatedAt: string
}

/**
 * 绑定元信息（V2.0 Task 7 起只消费 id = relationshipId）。
 * 服务端仍只读透传旧火花字段（growth/streak/level 等），V2.0 客户端不再使用：
 * 火花/等级/任务/连续天数组件已随产品清理移除，任何路径不再写入。
 */
export interface BondMeta {
  /** relationshipId：回忆时间线 / 共同时刻的关联键 */
  id: string
}
