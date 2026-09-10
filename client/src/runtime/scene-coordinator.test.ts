/**
 * runtime/scene-coordinator.test.ts — 双模型舞台协调测试（V2.0 Task 4）
 *
 * V1.6.2 布局规则移植（缺腿根治的构图规则统一到 root 锚点）：
 * - 全身像：root（脚底）贴 Dock 上沿（dockClearance=96px），且模型中心不低于 45% 视口高
 * - 半身像：胸像构图，截断边（root）压出屏幕底 10% 模型高
 * - 槽位：me x=32% / partner x=68% 视口宽
 */
import { describe, it, expect, vi } from 'vitest'
import { homeYFor, homeXFor, SceneCoordinator } from './scene-coordinator'
import type { AvatarRenderer, LoadStageOptions } from './avatar-renderer'
import type { AvatarManifest } from '@digital-avatar/shared'

const VW = 412
const VH = 850

function fakeRenderer(over: Partial<AvatarRenderer> = {}) {
  const setAnchor = vi.fn()
  const r: AvatarRenderer = {
    load: vi.fn().mockResolvedValue({ manifest: {} as AvatarManifest, engine: 'legacy-pixi' }),
    play: vi.fn().mockResolvedValue({ played: true, actionId: 'idle', level: 'exact' }),
    setAnchor,
    anchorPoint: vi.fn().mockReturnValue({ x: 0, y: 0 }),
    destroy: vi.fn(),
    ...over,
  }
  return { r, setAnchor }
}

const manifest = (halfBody = false): AvatarManifest =>
  ({
    avatarId: halfBody ? 'chitose' : 'hiyori',
    engine: 'legacy-pixi',
  }) as AvatarManifest

describe('homeYFor（V1.6.2 规则）', () => {
  it('全身像：脚底（y + h/2）贴 Dock 上沿 96px', () => {
    const h = 629 // vh - 96 - h/2 = 850 - 96 - 314.5 → y = 439.5
    const y = homeYFor(false, h, VH)
    expect(y + h / 2).toBeCloseTo(VH - 96, 5)
  })

  it('全身像小模型：中心不低于 45% 视口高（钳制生效）', () => {
    // h=800：vh-96-h/2 = 354 < 382.5 → 钳制到 45%
    const y = homeYFor(false, 800, VH)
    expect(y).toBe(VH * 0.45)
  })

  it('半身像：截断边压出屏幕底 10% 模型高（root = y + h/2 = vh + 0.1h）', () => {
    const h = 900
    const y = homeYFor(true, h, VH)
    expect(y).toBe(VH - h / 2 + h * 0.1)
    expect(y + h / 2).toBeCloseTo(VH + h * 0.1, 5)
  })

  it('h<=0（模型未测量）回退 45% 视口高', () => {
    expect(homeYFor(false, 0, VH)).toBe(VH * 0.45)
    expect(homeYFor(true, 0, VH)).toBe(VH * 0.45)
  })
})

describe('homeXFor', () => {
  it('me 32% / partner 68% 视口宽', () => {
    expect(homeXFor('me', VW)).toBeCloseTo(VW * 0.32, 5)
    expect(homeXFor('partner', VW)).toBeCloseTo(VW * 0.68, 5)
  })
})

describe('SceneCoordinator', () => {
  it('place：全身像 root 锚点瞬时定位到（槽位 x, vh-96）', () => {
    const { r, setAnchor } = fakeRenderer()
    const sc = new SceneCoordinator({ viewportW: VW, viewportH: VH })
    sc.place('me', r, false, 629)
    expect(setAnchor).toHaveBeenCalledTimes(1)
    const [anchor, pos, opts] = setAnchor.mock.calls[0]
    expect(anchor).toBe('root')
    expect(pos.x).toBeCloseTo(VW * 0.32, 5)
    expect(pos.y).toBeCloseTo(VH - 96, 5)
    expect(opts).toMatchObject({ instant: true })
  })

  it('place：半身像 root 压出屏幕底 10%', () => {
    const { r, setAnchor } = fakeRenderer()
    const sc = new SceneCoordinator({ viewportW: VW, viewportH: VH })
    const h = 900
    sc.place('partner', r, true, h)
    const [, pos] = setAnchor.mock.calls[0]
    expect(pos.x).toBeCloseTo(VW * 0.68, 5)
    expect(pos.y).toBeCloseTo(VH + h * 0.1, 5)
  })

  it('place：measuredH 缺失时回退 45% 中心规则（不炸）', () => {
    const { r, setAnchor } = fakeRenderer()
    const sc = new SceneCoordinator({ viewportW: VW, viewportH: VH })
    sc.place('me', r, false, 0)
    const [, pos] = setAnchor.mock.calls[0]
    expect(pos.y).toBe(VH * 0.45)
  })

  it('dockClearance 可配置（桌宠模式贴底更高）', () => {
    const { r, setAnchor } = fakeRenderer()
    const sc = new SceneCoordinator({ viewportW: VW, viewportH: VH, dockClearance: 140 })
    sc.place('me', r, false, 629)
    const [, pos] = setAnchor.mock.calls[0]
    expect(pos.y).toBeCloseTo(VH - 140, 5)
  })

  it('loadStage：把 manifest 交给 renderer.load 并注入舞台参数', async () => {
    const { r } = fakeRenderer()
    const sc = new SceneCoordinator({ viewportW: VW, viewportH: VH })
    const stage: LoadStageOptions = { container: {}, scale: 0.12, tier: 'high' }
    await sc.loadStage('me', r, manifest(false), stage)
    expect(r.load).toHaveBeenCalledWith(manifest(false), stage)
  })
})
