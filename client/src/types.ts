export type Mood = 'neutral' | 'happy' | 'low' | 'tired' | 'angry'
export type Visibility = 'public' | 'each-time' | 'discover-after'

export interface User {
  id: string
  name: string
  avatar: string
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
