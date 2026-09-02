const BASE = ''

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
  getState: (userId: string) => req<{ state: any | null }>(`/api/state/${userId}`),
  setState: (userId: string, mood: string, visibility: string) =>
    req<{ state: any }>('/api/state', {
      method: 'POST',
      body: JSON.stringify({ userId, mood, visibility }),
    }),
  getEvents: (userId: string) => req<{ events: any[] }>(`/api/events/${userId}`),
}
