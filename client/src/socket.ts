import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export function connectSocket(userId: string, handlers: Record<string, (...args: any[]) => void>) {
  socket?.disconnect()
  socket = io('/', { query: { userId } })
  for (const [evt, fn] of Object.entries(handlers)) {
    socket.on(evt, fn as any)
  }
  return socket
}

export function getSocket() {
  return socket
}

export function emit(evt: string, payload: any) {
  socket?.emit(evt, payload)
}

// 开发环境暴露调试钩子（自动化验证用，生产构建不含）
if (import.meta.env.DEV) {
  ; (window as any).__da = { emit, connectSocket }
}
