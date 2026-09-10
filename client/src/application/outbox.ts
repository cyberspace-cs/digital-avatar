/**
 * application/outbox.ts — 离线发件箱（V2.0 Task 8 弱网兜底）
 *
 * 网络降级链最后一环：Socket → REST → outbox 本地持久化 → 重连逐条回放。
 * - 彻底断网（REST 也失败）时，互动载荷以 eventId 为键存入 localStorage，绝不丢消息；
 * - 重连 / 浏览器 online / 回到前台时 flush：按入队顺序逐条 REST 投递；
 * - 服务端按 eventId 幂等：重复回放返回 duplicate 也视为已送达，直接移除，不产生重复互动；
 * - 投递仍失败的条目保留（tries++），超 maxTries 才作为死信丢弃，避免坏数据永久卡死队列。
 *
 * 纯逻辑 + 可注入存储，便于 node/vitest 单测；浏览器绑定见 createBrowserOutbox。
 */

export interface OutboxEntry {
  eventId: string
  payload: Record<string, unknown>
  createdAt: number
  tries: number
}

export interface OutboxFlushReport {
  /** 本轮新送达 */
  delivered: number
  /** 重复回放被服务端幂等吞掉（也算送达） */
  duplicate: number
  /** 仍失败，保留在队列 */
  failed: number
  /** 超最大重试被丢弃的死信 */
  dropped: number
}

export interface OutboxStorage {
  read(): OutboxEntry[]
  write(entries: OutboxEntry[]): void
}

export interface CreateOutboxDeps {
  storage: OutboxStorage
  /** 逐条投递（生产 = api.interact REST）。true/duplicate 视为送达；throw/false 保留重试 */
  flushOne: (entry: OutboxEntry) => Promise<boolean | { duplicate: boolean }>
  now?: () => number
  /** 队列上限，超出淘汰最旧（防 localStorage 被刷爆，默认 50） */
  maxEntries?: number
  /** 死信阈值（默认 20） */
  maxTries?: number
}

export interface Outbox {
  /** 入队（同 eventId 幂等，不重复排队）；返回队列当前长度 */
  enqueue: (eventId: string, payload: Record<string, unknown>) => number
  pendingCount: () => number
  /** 顺序回放全部待发；并发安全：flush 进行中复用同一个 promise */
  flush: () => Promise<OutboxFlushReport>
  subscribe: (fn: (count: number) => void) => () => void
}

export function createOutbox(deps: CreateOutboxDeps): Outbox {
  const now = deps.now ?? (() => Date.now())
  const maxEntries = deps.maxEntries ?? 50
  const maxTries = deps.maxTries ?? 20
  let entries: OutboxEntry[] = safeRead(deps.storage)
  let flushing: Promise<OutboxFlushReport> | null = null
  const listeners = new Set<(count: number) => void>()

  function persist() {
    try {
      deps.storage.write(entries)
    } catch {
      /* 隐私模式/配额满：本轮仅内存保留，不影响互动主流程 */
    }
    listeners.forEach((fn) => fn(entries.length))
  }

  function enqueue(eventId: string, payload: Record<string, unknown>): number {
    if (!eventId) return entries.length
    if (entries.some((e) => e.eventId === eventId)) return entries.length
    entries.push({ eventId, payload, createdAt: now(), tries: 0 })
    if (entries.length > maxEntries) entries = entries.slice(entries.length - maxEntries)
    persist()
    return entries.length
  }

  function pendingCount() {
    return entries.length
  }

  // 不能用 async 包装：async 会把返回的 promise 再包一层，两次调用拿到不同引用，
  // 调用方无法做身份判重（并发回放去重失效）
  function flush(): Promise<OutboxFlushReport> {
    if (flushing) return flushing
    flushing = doFlush().finally(() => {
      flushing = null
    })
    return flushing
  }

  async function doFlush(): Promise<OutboxFlushReport> {
    const report: OutboxFlushReport = { delivered: 0, duplicate: 0, failed: 0, dropped: 0 }
    if (entries.length === 0) return report
    // 快照顺序遍历；投递结果决定下一轮持久化内容
    const remaining: OutboxEntry[] = []
    for (const entry of entries) {
      let outcome: boolean | { duplicate: boolean } = false
      try {
        outcome = await deps.flushOne(entry)
      } catch {
        outcome = false
      }
      const isDuplicate = typeof outcome === 'object' && outcome !== null && outcome.duplicate === true
      const delivered = outcome === true || isDuplicate
      if (delivered) {
        if (isDuplicate) report.duplicate++
        else report.delivered++
      } else {
        const next = { ...entry, tries: entry.tries + 1 }
        if (next.tries >= maxTries) report.dropped++
        else {
          remaining.push(next)
          report.failed++
        }
      }
    }
    entries = remaining
    persist()
    return report
  }

  function subscribe(fn: (count: number) => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return { enqueue, pendingCount, flush, subscribe }
}

function safeRead(storage: OutboxStorage): OutboxEntry[] {
  try {
    const rows = storage.read()
    if (!Array.isArray(rows)) return []
    return rows.filter(
      (r): r is OutboxEntry =>
        !!r && typeof r.eventId === 'string' && typeof r.payload === 'object' && r.payload !== null,
    )
  } catch {
    return [] // 坏 JSON / 隐私模式：按空队列起步，不阻塞应用
  }
}

const BROWSER_KEY = 'da_outbox_v1'

/** localStorage 存储绑定（坏数据安全降级为空队列） */
export function localStorageOutboxStorage(key = BROWSER_KEY): OutboxStorage {
  return {
    read() {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as OutboxEntry[]) : []
    },
    write(rows) {
      localStorage.setItem(key, JSON.stringify(rows))
    },
  }
}
