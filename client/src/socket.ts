import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export function connectSocket(userId: string, handlers: Record<string, (...args: any[]) => void>) {
  socket?.disconnect()
  socket = io('/', {
    query: { userId },
    // 生产环境走 nginx 子路径，开发环境直连 vite 代理
    path: import.meta.env.PROD ? '/digital-avatar/socket.io' : '/socket.io',
    // V1.4.3：强制 polling、禁用 ws 升级。实测代理链路（vite preview / 部分生产环境）
    // 在 polling→websocket 升级时会 ECONNRESET，socket 变半开——connected=true 但 emit
    // 静默丢失（"喂食/送花没回应"的传输层根因）。polling 有常挂 GET，延迟毫秒级，
    // 可靠性优先。互动另有 REST 幂等兜底（eventId 去重）双保险。
    transports: ['polling'],
    upgrade: false,
  })
  for (const [evt, fn] of Object.entries(handlers)) {
    socket.on(evt, fn as any)
  }
  return socket
}

export function getSocket() {
  return socket
}

/** V1.4.3：WS 连接状态（互动 REST 兜底判断用） */
export function isSocketConnected() {
  return !!socket?.connected
}

export function emit(evt: string, payload: any) {
  socket?.emit(evt, payload)
}

// 开发环境暴露调试钩子（自动化验证用，生产构建不含）
if (import.meta.env.DEV) {
  ; (window as any).__da = { emit, connectSocket }
}
