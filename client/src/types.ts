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

/** 火花成长（V1.2 小火人化） */
export interface BondMeta {
  growth: number
  streak: number
  lastActiveDay: string | null
  cold: boolean
  level: number
  levelName: string
  nextLevelAt: number | null
}

export interface QuestItem {
  id: string
  label: string
  target: number
  reward: number
  progress: number
  done: boolean
  rewarded: boolean
}
