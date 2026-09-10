/**
 * runtime/choreography-runner.ts — 双人编排执行器（V2.0 Task 6，契约 §8）
 *
 * 职责：拿到 ChoreographyPlan（五阶段时间轴）+ 两端渲染器端口后，在本地按时间轴执行：
 *   approach（走位贴近）→ contact（播放双人动作）→ hold → release → return（各回各家）
 * 同步边界（红线）：只对齐 serverStartAt 开始时间与阶段标记，禁止逐帧同步 Cubism 参数。
 * 降级：对方不在场/动作播放失败 → 单侧执行并返回 partial（不抛错、不阻断事件落库）。
 */
import type { ChoreographyPhase, ChoreographyPlan } from '@digital-avatar/shared'
import type { AvatarRenderer, StagePoint } from './avatar-renderer'

export type ChoreographyRole = 'initiator' | 'receiver'

export interface ChoreographyRunResult {
  outcome: 'completed' | 'partial'
  /** contact 阶段两端是否真正播出了动作（partial 判定依据） */
  played: { me: boolean; partner: boolean }
  degradeReason?: string
}

export interface RunChoreographyArgs {
  role: ChoreographyRole
  plan: ChoreographyPlan
  /** 服务端广播的开跑时间（epoch ms）；runner 自动等待对齐 */
  startAt: number
  me: AvatarRenderer
  /** 对方渲染器；null = 对方离线/模型未就绪（单侧执行 → partial） */
  partner: AvatarRenderer | null
  /** 接触距离（服务端 prepare 下发，px） */
  contactGapPx: number
  /** 阶段回调（App 层做气泡/粒子/REST 阶段标记） */
  onPhase?: (phase: ChoreographyPhase) => void
  /** 可注入时钟/等待（时序测试确定性）；缺省真实时间 */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)))

/** 双方各向对方移动 (初始距离-接触距离)/2；初始距离不足则不移动 */
export function contactTargets(
  meHome: StagePoint,
  partnerHome: StagePoint | null,
  gapPx: number,
): { me: StagePoint; partner: StagePoint | null } {
  if (!partnerHome) return { me: meHome, partner: null }
  const dist = Math.abs(partnerHome.x - meHome.x)
  if (dist <= gapPx) return { me: meHome, partner: partnerHome }
  const step = (dist - gapPx) / 2
  const dir = partnerHome.x > meHome.x ? 1 : -1
  return {
    me: { x: meHome.x + dir * step, y: (meHome.y + partnerHome.y) / 2 },
    partner: { x: partnerHome.x - dir * step, y: (meHome.y + partnerHome.y) / 2 },
  }
}

/** 按编排时间轴执行一次双人编排（永不抛错） */
export async function runChoreography(args: RunChoreographyArgs): Promise<ChoreographyRunResult> {
  const now = args.now ?? (() => Date.now())
  const sleep = args.sleep ?? realSleep
  const timeline = args.plan.timeline

  try {
    // 1) 对齐 serverStartAt（早到就等；迟到立即开跑）
    const lead = args.startAt - now()
    if (lead > 0) await sleep(lead)
    const t0 = now()

    // 2) 记录各家 home（return 阶段回位）
    const meHome = args.me.anchorPoint('root')
    const partnerHome = args.partner?.anchorPoint('root') ?? null
    const targets = contactTargets(meHome ?? { x: 0, y: 0 }, partnerHome, args.contactGapPx)

    let playedMe = false
    let playedPartner = false

    for (let i = 0; i < timeline.length; i++) {
      const seg = timeline[i]
      args.onPhase?.(seg.phase)

      if (seg.phase === 'approach') {
        if (meHome) args.me.setAnchor('root', targets.me) // 非瞬时 → walkTo 走位
        if (partnerHome && args.partner && targets.partner) args.partner.setAnchor('root', targets.partner)
      } else if (seg.phase === 'contact') {
        // 双人动作：走渲染器端口（内部过动作注册表降级链，旧模型 hug 有精确动作，
        // handhold/shoulder-lean 降级为同语义/通用反应——编排走位仍完整）
        const meRes = await args.me.play(args.plan.actionId).catch(() => null)
        playedMe = !!meRes?.played
        if (args.partner && partnerHome) {
          const pRes = await args.partner.play(args.plan.actionId).catch(() => null)
          playedPartner = !!pRes?.played
        }
      } else if (seg.phase === 'return') {
        if (meHome) args.me.setAnchor('root', meHome)
        if (partnerHome && args.partner) args.partner.setAnchor('root', partnerHome)
      }

      // 3) 阶段收尾对齐时间轴（只同步阶段边界，不逐帧）
      const wait = t0 + seg.endMs - now()
      if (wait > 0) await sleep(wait)
    }

    const bothPlayed = playedMe && playedPartner
    return {
      outcome: bothPlayed ? 'completed' : 'partial',
      played: { me: playedMe, partner: playedPartner },
      degradeReason: bothPlayed
        ? undefined
        : !playedPartner
          ? '对方不在场或动作未播出 → 单侧执行 partial'
          : '己方动作未播出 → partial',
    }
  } catch (err) {
    return {
      outcome: 'partial',
      played: { me: false, partner: false },
      degradeReason: `编排执行异常 → partial: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
