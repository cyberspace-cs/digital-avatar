/**
 * runtime/adapters/legacy-pixi.test.ts — LegacyPixiAdapter 端口适配测试（V2.0 Task 4）
 *
 * 用 FakeSprite 替身覆盖四职责边界（加载/动作/外观/生命周期）：
 * - load：manifest.model3Url/scale/tier 透传给 sprite.load
 * - play：解析期降级链（exact/semantic/generic/neutral-bubble/event-only）映射到 sprite 调用
 * - play：运行时播放失败 → 能力声明 degradesTo 备用 → idle 表情 → 永不抛错
 * - setAnchor/anchorPoint：命名锚点 ↔ 全局坐标换算（realBounds 近似）
 * - destroy：sprite.destroy 必达，销毁后 play 落 event-only
 */
import { describe, it, expect, vi } from 'vitest'
import type { AvatarManifest } from '@digital-avatar/shared'
import { LegacyPixiAdapter, legacyManifest } from './legacy-pixi'
import type { AvatarSpriteRoles } from '../avatar-renderer'

function fakeSprite(over: Partial<AvatarSpriteRoles> = {}) {
  const sprite: AvatarSpriteRoles = {
    load: vi.fn().mockResolvedValue({}),
    destroy: vi.fn(),
    play: vi.fn(),
    playSadReaction: vi.fn(),
    setMood: vi.fn(),
    walkTo: vi.fn(),
    setPosition: vi.fn(),
    get x() { return 200 },
    get y() { return 300 },
    realBounds: vi.fn().mockReturnValue({ x: 100, y: 200, width: 50, height: 100 }),
    model: {},
    ...over,
  }
  return sprite
}

const manifest = (over: Record<string, unknown> = {}): AvatarManifest =>
  ({
    avatarId: 'hiyori',
    name: 'Hiyori',
    engine: 'legacy-pixi',
    version: '1.0.0',
    model3Url: '/digital-avatar/models/hiyori/Hiyori.model3.json',
    anchors: {
      root: { x: 0.5, y: 1 },
      head: { x: 0.5, y: 0.08 },
      'hand.left': { x: 0.18, y: 0.45 },
      'hand.right': { x: 0.82, y: 0.45 },
      'foot.left': { x: 0.35, y: 1 },
      'foot.right': { x: 0.65, y: 1 },
      heart: { x: 0.5, y: 0.35 },
      shoulder: { x: 0.5, y: 0.25 },
      'hug.chest': { x: 0.5, y: 0.42 },
    },
    capabilities: [
      { actionId: 'wave', motion: 'TapBody' },
      { actionId: 'idle', motion: 'Idle' },
    ],
    ...over,
  }) as AvatarManifest

const noopStage = { container: {}, scale: 0.12, tier: 'high' as const }

describe('LegacyPixiAdapter — 加载/生命周期', () => {
  it('load：model3Url/scale/tier 透传 sprite.load，返回 handle', async () => {
    const sprite = fakeSprite()
    const a = new LegacyPixiAdapter(sprite, manifest())
    const h = await a.load(manifest(), noopStage)
    expect(sprite.load).toHaveBeenCalledWith(noopStage.container, manifest().model3Url, 0.12, 'high')
    expect(h.manifest.avatarId).toBe('hiyori')
    expect(h.engine).toBe('legacy-pixi')
  })

  it('destroy：sprite.destroy 必达，之后 play 落五级 event-only 不抛错', async () => {
    const sprite = fakeSprite()
    const a = new LegacyPixiAdapter(sprite, manifest())
    a.destroy()
    expect(sprite.destroy).toHaveBeenCalledTimes(1)
    const r = await a.play('wave')
    expect(r.played).toBe(false)
    expect(r.level).toBe('event-only')
  })
})

describe('LegacyPixiAdapter — 动作播放（解析期降级链映射）', () => {
  it('exact：能力命中 → sprite.play(原动作)', async () => {
    const sprite = fakeSprite()
    const a = new LegacyPixiAdapter(sprite, manifest())
    const r = await a.play('wave')
    expect(sprite.play).toHaveBeenCalledWith('wave')
    expect(r).toMatchObject({ played: true, actionId: 'wave', level: 'exact' })
  })

  it('semantic：heart 无能力 → 降级播 wave（与 V1.2 行为一致）', async () => {
    const sprite = fakeSprite()
    const a = new LegacyPixiAdapter(sprite, manifest())
    const r = await a.play('heart')
    expect(sprite.play).toHaveBeenCalledWith('wave')
    expect(r.level).toBe('semantic')
    expect(r.degradeReason).toBeTruthy()
  })

  it('generic：只有 idle 能力 → 表情反应（setMood happy），不播动作', async () => {
    const sprite = fakeSprite({ play: vi.fn() })
    const a = new LegacyPixiAdapter(sprite, manifest({ capabilities: [{ actionId: 'idle', motion: 'Idle' }] }))
    const r = await a.play('hug')
    expect(sprite.play).not.toHaveBeenCalled()
    expect(sprite.setMood).toHaveBeenCalledWith('happy')
    expect(r.played).toBe(true)
    expect(r.level).toBe('generic')
  })

  it('neutral-bubble：模型在但无能力声明 → 无 sprite 调用（气泡由 App 层负责）', async () => {
    const sprite = fakeSprite()
    const a = new LegacyPixiAdapter(sprite, manifest({ capabilities: [] }))
    const r = await a.play('wave')
    expect(sprite.play).not.toHaveBeenCalled()
    expect(sprite.setMood).not.toHaveBeenCalled()
    expect(r.played).toBe(false)
    expect(r.level).toBe('neutral-bubble')
  })

  it('运行时播放失败 → degradesTo 候选兜底（第二级备用元数据）', async () => {
    const sprite = fakeSprite({
      play: vi.fn((action: string) => {
        if (action === 'heart') throw new Error('motion not found')
      }),
    })
    const m = manifest({
      capabilities: [
        { actionId: 'heart', motion: 'heart.motion3.json', degradesTo: ['cheer'] },
        { actionId: 'cheer', motion: 'cheer.motion3.json' },
        { actionId: 'idle', motion: 'Idle' },
      ],
    })
    const a = new LegacyPixiAdapter(sprite, m)
    const r = await a.play('heart')
    expect(sprite.play).toHaveBeenNthCalledWith(1, 'heart')
    expect(sprite.play).toHaveBeenNthCalledWith(2, 'cheer')
    expect(r.played).toBe(true)
    expect(r.actionId).toBe('cheer')
    expect(r.level).toBe('semantic')
    expect(r.degradeReason).toContain('运行时')
  })

  it('播放彻底失败 → 回落 idle 表情，不向上抛错（动画失败不阻断事件）', async () => {
    const sprite = fakeSprite({
      play: vi.fn(() => { throw new Error('boom') }),
    })
    const a = new LegacyPixiAdapter(sprite, manifest())
    const r = await a.play('wave')
    expect(r.played).toBe(false)
    expect(r.error).toBeTruthy()
    expect(sprite.setMood).toHaveBeenCalledWith('happy') // idle 表情兜底
  })
})

describe('LegacyPixiAdapter — 锚点（编排走位原语）', () => {
  it('anchorPoint：realBounds → 9 个锚点的全局坐标近似', () => {
    const a = new LegacyPixiAdapter(fakeSprite(), manifest())
    // bounds {x:100,y:200,w:50,h:100}
    expect(a.anchorPoint('root')).toEqual({ x: 125, y: 300 })
    expect(a.anchorPoint('head')).toEqual({ x: 125, y: 208 })
    expect(a.anchorPoint('heart')).toEqual({ x: 125, y: 235 })
    expect(a.anchorPoint('hug.chest')).toEqual({ x: 125, y: 242 })
  })

  it('realBounds 不可用时 anchorPoint 返回 null（模型未加载/隐藏）', () => {
    const sprite = fakeSprite({ realBounds: vi.fn().mockReturnValue(null) })
    const a = new LegacyPixiAdapter(sprite, manifest())
    expect(a.anchorPoint('root')).toBeNull()
  })

  it('setAnchor：把 root 锚点平移到目标位置 → walkTo 目标 = 当前位姿 + 锚点位移', async () => {
    const sprite = fakeSprite() // x=200, y=300；root 全局 = (125, 300)
    const a = new LegacyPixiAdapter(sprite, manifest())
    await a.setAnchor('root', { x: 500, y: 640 })
    // delta = (500-125, 640-300) → walkTo(200+375, 300+340)
    expect(sprite.walkTo).toHaveBeenCalledWith(575, 640)
  })

  it('setAnchor instant：舞台摆放用 setPosition 瞬时定位（不走 lerp）', async () => {
    const sprite = fakeSprite()
    const a = new LegacyPixiAdapter(sprite, manifest())
    await a.setAnchor('root', { x: 500, y: 640 }, { instant: true })
    expect(sprite.walkTo).not.toHaveBeenCalled()
    expect(sprite.setPosition).toHaveBeenCalledWith(575, 640)
  })
})

describe('legacyManifest — 旧模型合成 manifest', () => {
  it('注册形象：通过 parseAvatarManifest 校验，能力表覆盖 7 动作 + idle', () => {
    const m = legacyManifest('hiyori')!
    expect(m).not.toBeNull()
    expect(m.engine).toBe('legacy-pixi')
    expect(m.avatarId).toBe('hiyori')
    expect(m.model3Url).toContain('models/hiyori/Hiyori.model3.json')
    for (const id of ['poke', 'pat', 'pinch', 'wave', 'heart', 'hug', 'flick', 'idle']) {
      expect(m.capabilities.some((c) => c.actionId === id)).toBe(true)
    }
    expect(Object.keys(m.anchors).sort()).toHaveLength(9)
  })

  it('四个旧模型全部可合成（红线：旧模型一个都不能少）', () => {
    for (const id of ['hiyori', 'haru', 'natori', 'chitose']) {
      expect(legacyManifest(id)?.avatarId).toBe(id)
    }
  })

  it('未注册形象返回 null', () => {
    expect(legacyManifest('jing')).toBeNull() // Jing 要等正式资产包（Task 5），不走 legacy 合成
    expect(legacyManifest('')).toBeNull()
  })
})
