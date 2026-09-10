/**
 * application/sendInteraction.ts — 互动发送用例（V2.0 Task 3）
 *
 * 契约 §10 网络降级：Socket → REST → 本地 outbox（Task 8）→ 重连按 eventId 去重。
 * 双链路共用同一 eventId：
 *   - Socket 在线：emit('interaction')，等待服务端 interaction_ack；
 *     1.6s 内没等到 ack（WS 半开）→ 自动走 REST 兜底，服务端按 eventId 幂等去重。
 *   - Socket 离线：直接 REST。
 * 发送端自回声（self: true）由 socket 接线层过滤（只记时间线，不重播动作）。
 *
 * 从 App.tsx 移出的部分：eventId 生成、ack 等待、超时兜底、回执匹配。
 */
import { newEventId, toWirePayload, type SendInteractionCommand } from '../domain/interaction'

/** REST /api/interact 的响应形状（旧格式行 + duplicate 标记） */
export interface RestInteractResponse {
  event: Record<string, unknown> | null
  duplicate?: boolean
  error?: string
  issues?: string[]
}

export interface AckPayload {
  id?: string
  eventId?: string
  duplicate?: boolean
  event?: Record<string, unknown>
  [k: string]: unknown
}

export interface SendInteractionPorts {
  /** Socket emit（socket.ts 的 emit） */
  emit: (event: string, payload: unknown) => void
  /** Socket 连接状态（socket.ts 的 isSocketConnected） */
  isSocketConnected: () => boolean
  /** REST 兜底（api.interact） */
  restInteract: (payload: Record<string, unknown>) => Promise<RestInteractResponse>
  /** ack 等待超时（默认 1600ms，与 V1.4.3 行为一致） */
  ackTimeoutMs?: number
  /** 测试注入 eventId（生产走 domain.newEventId） */
  genEventId?: () => string
}

export interface SendInteractionResult {
  event: Record<string, unknown> | null
  /** 结算通道：ack = socket 回执；rest = 离线直接 REST；rest-after-timeout = ack 超时后兜底 */
  settledBy: 'ack' | 'rest' | 'rest-after-timeout'
  duplicate: boolean
}

export interface SendInteractionHandle {
  sendInteraction: (command: SendInteractionCommand) => Promise<SendInteractionResult>
  /** 接线层把 socket 的 interaction_ack 转投到这里（App.tsx 一行） */
  handleAck: (ack: AckPayload | null | undefined) => void
}

export function createSendInteraction(ports: SendInteractionPorts): SendInteractionHandle {
  const timeoutMs = ports.ackTimeoutMs ?? 1600
  /** eventId → resolve（socket 链路的 ack 等待者） */
  const waiters = new Map<string, (r: SendInteractionResult) => void>()

  function restFallback(payload: Record<string, unknown>, settledBy: 'rest' | 'rest-after-timeout') {
    return ports.restInteract(payload).then(
      (r): SendInteractionResult => ({
        event: r.event ?? null,
        settledBy,
        duplicate: !!r.duplicate,
      }),
      (): SendInteractionResult => {
        // REST 也失败（彻底断网）：事件返回 null，调用方决定是否进入 outbox（Task 8）
        return { event: null, settledBy, duplicate: false }
      },
    )
  }

  function sendInteraction(command: SendInteractionCommand): Promise<SendInteractionResult> {
    const eventId = command.eventId ?? ports.genEventId?.() ?? newEventId()
    const payload = toWirePayload({ ...command, eventId })

    // 离线：直接 REST（不 emit，避免半开 socket 静默丢失）
    if (!ports.isSocketConnected()) {
      return restFallback(payload, 'rest')
    }

    // 在线：emit + 等 ack；超时 → REST 兜底（同 eventId，服务端幂等）
    return new Promise<SendInteractionResult>((resolve) => {
      let settled = false
      const done = (r: SendInteractionResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        waiters.delete(eventId)
        resolve(r)
      }
      waiters.set(eventId, (r) => done(r))
      const timer = setTimeout(() => {
        waiters.delete(eventId)
        restFallback(payload, 'rest-after-timeout').then(done)
      }, timeoutMs)
      ports.emit('interaction', payload)
    })
  }

  function handleAck(ack: AckPayload | null | undefined) {
    const id = (ack?.eventId ?? ack?.id) as string | undefined
    if (!id) return
    const waiter = waiters.get(id)
    if (!waiter) return
    waiter({
      event: (ack?.event as Record<string, unknown> | undefined) ?? null,
      settledBy: 'ack',
      duplicate: !!ack?.duplicate,
    })
  }

  return { sendInteraction, handleAck }
}
