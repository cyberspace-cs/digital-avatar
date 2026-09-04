// 生产部署在 nginx 子路径 /digital-avatar/ 下
const BASE = import.meta.env.PROD ? '/digital-avatar' : ''

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

export const api = {
  createUser: (name: string) =>
    req<{ user: any }>('/api/identity', { method: 'POST', body: JSON.stringify({ name }) }),
  getUser: (id: string) => req<{ user: any }>(`/api/identity/${id}`),
  createInvite: (userId: string) =>
    req<{ code: string }>('/api/invite', { method: 'POST', body: JSON.stringify({ userId }) }),
  acceptInvite: (code: string, userId: string) =>
    req<{ partner: any }>(`/api/invite/${code}/accept`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  getPartner: (userId: string) => req<{ partner: any | null }>(`/api/partner/${userId}`),
  getState: (userId: string) =>
    req<{ state: any | null; avatar?: string; style?: string; outfit?: string }>(`/api/state/${userId}`),
  setState: (userId: string, mood: string, visibility: string) =>
    req<{ state: any }>('/api/state', {
      method: 'POST',
      body: JSON.stringify({ userId, mood, visibility }),
    }),
  getEvents: (userId: string) => req<{ events: any[] }>(`/api/events/${userId}`),
  // ---------- V1.3 换装：形象 / 穿搭风格 / V1.5.0 款式 ----------
  setLook: (userId: string, look: { avatar?: string; style?: string; outfit?: string }) =>
    req<{ state: any; avatar?: string; style?: string; outfit?: string }>('/api/state', {
      method: 'POST',
      body: JSON.stringify({ userId, ...look }),
    }),
  // ---------- V1.2 火花成长 ----------
  getBond: (userId: string) => req<{ bond: any | null }>(`/api/bond/${userId}`),
  getQuests: (userId: string) =>
    req<{ quests: any[]; streak: number; lastActiveDay: string | null; cold: boolean }>(
      `/api/quests/${userId}`,
    ),
  // ---------- V1.4.3 互动 REST 兜底：WS 断线时从这里落库 + 火花结算（幂等） ----------
  interact: (payload: { senderId: string; receiverId: string; action: string; message?: string | null; eventId: string }) =>
    req<{ event: any | null; growth: any | null; duplicate?: boolean; error?: string }>('/api/interact', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
