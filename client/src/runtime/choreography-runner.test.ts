/**
 * runtime/choreography-runner.test.ts — 双人编排执行器时序测试（V2.0 Task 6，契约 §8）
 *
 * 覆盖：startAt 对齐（早到等待/迟到立即开跑）、五阶段顺序与阶段边界同步、
 * completed/partial 判定（对方离线 / 播放失败 / 抛异常）、走位（approach 贴近 + return 回位）。
 * 时钟与 sleep 全部注入：虚拟时钟随 sleep 推进，时序确定性可断言。
 */
import { describe, it, expect } from 'vitest'
import { CHOREOGRAPHY_PHASES, type ChoreographyPlan } from '@digital-avatar/shared'
import { runChoreography, contactTargets } from './choreography-runner'
import { createChoreography } from '../actions/choreographies'
import type { AvatarRenderer, PlaybackResult, StagePoint } from './avatar-renderer'

/** 虚拟时钟：sleep(ms) 直接推进 now() */
function fakeClock(start = 0) {
  let t = start
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms },
    get time() { return t },
  }
}

interface FakeOpts {
  failPlay?: boolean
  throwPlay?: boolean
}

/** 可断言的假渲染器：记录 play/setAnchor 调用，root 锚点可移动 */
function fakeRenderer(anchors: { root: StagePoint | null }, opts: FakeOpts = {}) {
  const calls: string[] = []
  const renderer: AvatarRenderer = {
    load: async () => { throw new Error('unused in runner tests') },
    play: async (actionId: string): Promise<PlaybackResult> => {
      calls.push(`play:${actionId}`)
      if (opts.throwPlay) throw new Error('play boom')
      return { played: !opts.failPlay, actionId, level: 'exact' }
    },
    setAnchor: (_anchor, pos) => {
      calls.push(`anchor:${Math.round(pos.x)},${Math.round(pos.y)}`)
      anchors.root = pos
    },
    anchorPoint: (anchor) => (anchor === 'root' ? anchors.root : null),
    destroy: () => { },
  }
  return { renderer, calls }
}

const planOf = (actionId = 'hug'): ChoreographyPlan => {
  const plan = createChoreography(actionId, ['u1', 'u2'])
  if (!plan) throw new Error('choreography 未注册')
  return plan
}

describe('contactTargets（走位目标计算）', () => {
  it('双方各向中间移动 (距离-接触距离)/2，y 取平均', () => {
    const t = contactTargets({ x: 200, y: 600 }, { x: 600, y: 640 }, 120)
    expect(t.me.x).toBe(340) // 200 + 140
    expect(t.partner!.x).toBe(460) // 600 - 140
    expect(t.me.y).toBe(620)
    expect(t.partner!.y).toBe(620)
  })

  it('初始距离不足接触距离时不移动', () => {
    const meHome = { x: 200, y: 600 }
    const partnerHome = { x: 260, y: 600 }
    const t = contactTargets(meHome, partnerHome, 120)
    expect(t.me).toEqual(meHome)
    expect(t.partner).toEqual(partnerHome)
  })

  it('对方不在场时不移动', () => {
    const meHome = { x: 200, y: 600 }
    const t = contactTargets(meHome, null, 120)
    expect(t.me).toEqual(meHome)
    expect(t.partner).toBeNull()
  })
})

describe('runChoreography 时序', () => {
  it('startAt 早于当前时间则等待对齐；五阶段按序执行且阶段边界对齐时间轴', async () => {
    const clock = fakeClock(1000)
    const a = fakeRenderer({ root: { x: 200, y: 600 } })
    const b = fakeRenderer({ root: { x: 600, y: 640 } })
    const phases: string[] = []
    const plan = planOf('hug') // approach1200/contact400/hold2200/release400/return1200 = 5400ms

    const res = await runChoreography({
      role: 'initiator',
      plan,
      startAt: 1500,
      me: a.renderer,
      partner: b.renderer,
      contactGapPx: 120,
      onPhase: (p) => phases.push(p),
      now: clock.now,
      sleep: clock.sleep,
    })

    // 等待 500ms 到 startAt，再走完 5400ms 时间轴
    expect(clock.time).toBe(1500 + 5400)
    expect(phases).toEqual([...CHOREOGRAPHY_PHASES])
    expect(res.outcome).toBe('completed')
    expect(res.played).toEqual({ me: true, partner: true })
    // contact 阶段两端都播了动作（各一次）
    expect(a.calls.filter((c) => c.startsWith('play:')).length).toBe(1)
    expect(b.calls.filter((c) => c.startsWith('play:')).length).toBe(1)
  })

  it('startAt 已过（迟到）立即开跑，不补等待', async () => {
    const clock = fakeClock(5000)
    const a = fakeRenderer({ root: { x: 200, y: 600 } })
    const b = fakeRenderer({ root: { x: 600, y: 640 } })

    await runChoreography({
      role: 'initiator',
      plan: planOf(),
      startAt: 4000,
      me: a.renderer,
      partner: b.renderer,
      contactGapPx: 120,
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(clock.time).toBe(5000 + 5400) // 没有 lead 等待
  })

  it('approach 走位贴近、return 回到各家 home', async () => {
    const aAnchors = { root: { x: 200, y: 600 } as StagePoint | null }
    const bAnchors = { root: { x: 600, y: 640 } as StagePoint | null }
    const a = fakeRenderer(aAnchors)
    const b = fakeRenderer(bAnchors)
    const clock = fakeClock()

    await runChoreography({
      role: 'initiator',
      plan: planOf(),
      startAt: 0,
      me: a.renderer,
      partner: b.renderer,
      contactGapPx: 120,
      now: clock.now,
      sleep: clock.sleep,
    })

    // approach：双方 root 各走 (400-120)/2=140 到中线（340/460，y 取平均 620）
    expect(a.calls[0]).toBe('anchor:340,620')
    expect(b.calls[0]).toBe('anchor:460,620')
    // contact：各自播一次双人动作
    expect(a.calls[1]).toBe('play:hug')
    expect(b.calls[1]).toBe('play:hug')
    // return 回原位（calls 序列最后一步）
    expect(a.calls[a.calls.length - 1]).toBe('anchor:200,600')
    expect(b.calls[b.calls.length - 1]).toBe('anchor:600,640')
  })

  it('对方不在场（partner=null）→ 单侧执行 partial', async () => {
    const clock = fakeClock()
    const a = fakeRenderer({ root: { x: 200, y: 600 } })

    const res = await runChoreography({
      role: 'initiator',
      plan: planOf(),
      startAt: 0,
      me: a.renderer,
      partner: null,
      contactGapPx: 120,
      now: clock.now,
      sleep: clock.sleep,
    })

    expect(res.outcome).toBe('partial')
    expect(res.played).toEqual({ me: true, partner: false })
    expect(res.degradeReason).toContain('对方不在场')
    // 己方动作仍播出（单侧执行不中断）
    expect(a.calls.some((c) => c.startsWith('play:'))).toBe(true)
  })

  it('对方动作播放失败（played=false）→ partial', async () => {
    const clock = fakeClock()
    const a = fakeRenderer({ root: { x: 200, y: 600 } })
    const b = fakeRenderer({ root: { x: 600, y: 640 } }, { failPlay: true })

    const res = await runChoreography({
      role: 'initiator',
      plan: planOf(),
      startAt: 0,
      me: a.renderer,
      partner: b.renderer,
      contactGapPx: 120,
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(res.outcome).toBe('partial')
    expect(res.played).toEqual({ me: true, partner: false })
  })

  it('对方 play 抛异常不炸编排（.catch 兜底）→ partial', async () => {
    const clock = fakeClock()
    const a = fakeRenderer({ root: { x: 200, y: 600 } })
    const b = fakeRenderer({ root: { x: 600, y: 640 } }, { throwPlay: true })

    const res = await runChoreography({
      role: 'initiator',
      plan: planOf(),
      startAt: 0,
      me: a.renderer,
      partner: b.renderer,
      contactGapPx: 120,
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(res.outcome).toBe('partial')
    expect(res.played).toEqual({ me: true, partner: false })
    // 时间轴照常走完（异常不阻断阶段同步）
    expect(clock.time).toBe(5400)
  })

  it('己方渲染器异常 → 永不抛错，落 partial', async () => {
    const clock = fakeClock()
    const a = fakeRenderer({ root: null }, { throwPlay: true })
    const b = fakeRenderer({ root: { x: 600, y: 640 } })

    const res = await runChoreography({
      role: 'receiver',
      plan: planOf('handhold'),
      startAt: 0,
      me: a.renderer,
      partner: b.renderer,
      contactGapPx: 90,
      now: clock.now,
      sleep: clock.sleep,
    })
    // root 锚点缺失（模型未就绪）：己方走位跳过且 play 抛异常 → 己方未播；
    // 对方不受影响照常播出（异常只吞己侧，.catch 兜底）
    expect(res.outcome).toBe('partial')
    expect(res.played).toEqual({ me: false, partner: true })
    expect(res.degradeReason).toContain('partial')
  })

  it('三个编排的时间轴总时长与定义一致（hug/handhold/shoulder-lean）', async () => {
    const cases: Array<[string, number]> = [
      ['hug', 1200 + 400 + 2200 + 400 + 1200],
      ['handhold', 1000 + 300 + 2400 + 300 + 1000],
      ['shoulder-lean', 1400 + 500 + 3000 + 500 + 1200],
    ]
    for (const [actionId, totalMs] of cases) {
      const clock = fakeClock()
      const a = fakeRenderer({ root: { x: 200, y: 600 } })
      const b = fakeRenderer({ root: { x: 600, y: 640 } })
      await runChoreography({
        role: 'initiator',
        plan: planOf(actionId),
        startAt: 0,
        me: a.renderer,
        partner: b.renderer,
        contactGapPx: 120,
        now: clock.now,
        sleep: clock.sleep,
      })
      expect(clock.time).toBe(totalMs)
    }
  })
})
