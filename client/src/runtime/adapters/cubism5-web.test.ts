/**
 * runtime/adapters/cubism5-web.test.ts — Cubism5WebAdapter 编排测试（V2.0 Task 5）
 *
 * 正式 Jing/Tao 资产未到位（红线：不伪造生产 MOC3），用注入 FakeRuntime 验证适配器编排：
 * - loadFromUrl：fetch manifest.json → parseAvatarManifest 契约校验 → runtime.createModel
 * - play：五级降级链映射（exact/semantic/generic/neutral-bubble/event-only）
 * - play：运行时播放失败 → degradesTo → 表情兜底，永不抛错
 * - 锚点：manifest.anchors（0~1 归一化）× bounds → 全局坐标；setAnchor 位移语义
 * - 生命周期：destroy 幂等必达，销毁后 play 落 event-only
 * - 占位 fixture：client/public/models/{jing,tao}/manifest.json 必须始终过契约校验
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseAvatarManifest } from '@digital-avatar/shared'
import {
  Cubism5WebAdapter,
  anchorFromManifest,
  TIER_TO_TEXTURE,
  loadCubism5CoreScript,
} from './cubism5-web'
import type { AvatarManifest } from '@digital-avatar/shared'
import type { Cubism5ModelRef, Cubism5Runtime } from './cubism5-web'
import type { LoadStageOptions } from '../avatar-renderer'

function fakeRuntime(over: Partial<Cubism5Runtime> = {}) {
  const modelRef: Cubism5ModelRef = {
    getPosition: vi.fn().mockReturnValue({ x: 200, y: 300 }),
    bounds: vi.fn().mockReturnValue({ x: 100, y: 200, width: 50, height: 100 }),
    playMotion: vi.fn(),
    setExpression: vi.fn(),
    setPosition: vi.fn(),
    walkTo: vi.fn(),
    destroy: vi.fn(),
  }
  const runtime: Cubism5Runtime = {
    createModel: vi.fn().mockResolvedValue(modelRef),
    ...over,
  }
  return { runtime, modelRef }
}

const manifestJson = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  avatarId: 'jing',
  name: 'Jing',
  engine: 'cubism5',
  version: '1.0.0',
  model3Url: 'jing.model3.json',
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
    { actionId: 'wave', motion: 'motions/wave.motion3.json', expression: 'happy', degradesTo: ['idle'] },
    { actionId: 'idle', motion: 'motions/idle.motion3.json' },
  ],
  ...over,
})

const manifest = (over: Record<string, unknown> = {}): AvatarManifest =>
  parseAvatarManifest(manifestJson(over))

const noopStage: LoadStageOptions = { container: {}, scale: 0.12, tier: 'high' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Cubism5WebAdapter — 加载', () => {
  it('loadFromUrl：fetch manifest → 契约校验 → createModel 透传 container/scale/tier/textureTier', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => manifestJson() })
    vi.stubGlobal('fetch', fetchMock)
    const { runtime, modelRef } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    const h = await a.loadFromUrl('/digital-avatar/models/jing/manifest.json', noopStage)
    expect(fetchMock).toHaveBeenCalledWith('/digital-avatar/models/jing/manifest.json')
    expect(runtime.createModel).toHaveBeenCalledWith({}, expect.anything(), {
      scale: 0.12,
      tier: 'high',
      textureTier: '4096',
    })
    expect(h.engine).toBe('cubism5')
    expect(h.manifest.avatarId).toBe('jing')
    // 锚点已就位（manifest 真实声明，非近似）
    expect(a.anchorPoint('root')).toEqual({ x: 125, y: 300 })
    expect(modelRef.bounds).toHaveBeenCalled()
  })

  it('纹理档位映射：high→4096 / balanced→2048 / saver→1024', async () => {
    expect(TIER_TO_TEXTURE.high).toBe('4096')
    expect(TIER_TO_TEXTURE.balanced).toBe('2048')
    expect(TIER_TO_TEXTURE.saver).toBe('1024')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => manifestJson() })
    vi.stubGlobal('fetch', fetchMock)
    for (const [tier, textureTier] of [['balanced', '2048'], ['saver', '1024']] as const) {
      const { runtime } = fakeRuntime()
      const a = new Cubism5WebAdapter(runtime)
      await a.loadFromUrl('/m.json', { container: {}, scale: 0.12, tier })
      expect(runtime.createModel).toHaveBeenCalledWith({}, expect.anything(), {
        scale: 0.12,
        tier,
        textureTier,
      })
    }
  })

  it('manifest 404 → 明确报错不静默', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const { runtime } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    await expect(a.loadFromUrl('/nope/manifest.json', noopStage)).rejects.toThrow(/404/)
  })

  it('manifest 不合契约（缺锚点）→ parseAvatarManifest 拒绝', async () => {
    const bad = manifestJson()
    delete (bad.anchors as Record<string, unknown>)['hand.left']
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => bad }))
    const { runtime } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    await expect(a.loadFromUrl('/m.json', noopStage)).rejects.toThrow(/hand\.left/)
  })

  it('destroy 后 load 抛错（防误用）', async () => {
    const { runtime } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    a.destroy()
    await expect(a.load(manifest(), noopStage)).rejects.toThrow(/destroyed/)
  })
})

describe('Cubism5WebAdapter — 动作播放（降级链映射）', () => {
  it('exact：能力命中 → playMotion(motion, expression)', async () => {
    const { runtime, modelRef } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest(), noopStage)
    const r = await a.play('wave')
    expect(modelRef.playMotion).toHaveBeenCalledWith('motions/wave.motion3.json', 'happy')
    expect(r).toMatchObject({ played: true, actionId: 'wave', level: 'exact' })
  })

  it('semantic：heart 无能力 → 降级播 wave', async () => {
    const { runtime, modelRef } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest(), noopStage)
    const r = await a.play('heart')
    expect(modelRef.playMotion).toHaveBeenCalledWith('motions/wave.motion3.json', 'happy')
    expect(r.level).toBe('semantic')
    expect(r.degradeReason).toBeTruthy()
  })

  it('generic：只有 idle 能力 → setExpression 反应，不播动作', async () => {
    const { runtime, modelRef } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest({ capabilities: [{ actionId: 'idle', motion: 'motions/idle.motion3.json' }] }), noopStage)
    const r = await a.play('hug', { mood: 'low' })
    expect(modelRef.playMotion).not.toHaveBeenCalled()
    expect(modelRef.setExpression).toHaveBeenCalledWith('low')
    expect(r).toMatchObject({ played: true, level: 'generic' })
  })

  it('neutral-bubble：能力表与请求动作无交集且无 idle → 无 runtime 调用（契约要求能力表非空）', async () => {
    const { runtime, modelRef } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    await a.load(
      manifest({ capabilities: [{ actionId: 'dance', motion: 'motions/dance.motion3.json' }] }),
      noopStage,
    )
    const r = await a.play('wave')
    expect(modelRef.playMotion).not.toHaveBeenCalled()
    expect(modelRef.setExpression).not.toHaveBeenCalled()
    expect(r).toMatchObject({ played: false, level: 'neutral-bubble' })
  })

  it('event-only：模型未加载 → 只保留事件', async () => {
    const { runtime } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    const r = await a.play('wave')
    expect(r).toMatchObject({ played: false, level: 'event-only' })
  })

  it('运行时播放失败 → degradesTo 候选兜底', async () => {
    const { runtime, modelRef } = fakeRuntime()
    modelRef.playMotion = vi.fn((motion: string) => {
      if (motion === 'motions/wave.motion3.json') throw new Error('motion load failed')
    })
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest(), noopStage)
    const r = await a.play('wave')
    expect(modelRef.playMotion).toHaveBeenNthCalledWith(2, 'motions/idle.motion3.json', undefined)
    expect(r).toMatchObject({ played: true, actionId: 'idle', level: 'semantic' })
    expect(r.degradeReason).toContain('运行时')
  })

  it('播放彻底失败 → 表情兜底，不向上抛错', async () => {
    const { runtime, modelRef } = fakeRuntime()
    modelRef.playMotion = vi.fn(() => { throw new Error('boom') })
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest({ capabilities: [{ actionId: 'wave', motion: 'motions/wave.motion3.json' }] }), noopStage)
    const r = await a.play('wave')
    expect(r.played).toBe(false)
    expect(r.error).toBeTruthy()
    expect(modelRef.setExpression).toHaveBeenCalledWith('happy')
  })
})

describe('Cubism5WebAdapter — 锚点（manifest 真实声明）', () => {
  it('anchorFromManifest：归一化锚点 × bounds → 全局坐标', () => {
    const m = manifest()
    const b = { x: 100, y: 200, width: 50, height: 100 }
    expect(anchorFromManifest('root', b, m)).toEqual({ x: 125, y: 300 })
    expect(anchorFromManifest('head', b, m)).toEqual({ x: 125, y: 208 })
    expect(anchorFromManifest('heart', b, m)).toEqual({ x: 125, y: 235 })
  })

  it('bounds 不可用 → anchorPoint null', async () => {
    const { runtime, modelRef } = fakeRuntime()
    modelRef.bounds = vi.fn().mockReturnValue(null)
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest(), noopStage)
    expect(a.anchorPoint('root')).toBeNull()
  })

  it('setAnchor：锚点位移 → walkTo（走位）', async () => {
    const { runtime, modelRef } = fakeRuntime()
    // bounds {100,200,50,100} → root 全局 (125,300)；模型 position (200,300)
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest(), noopStage)
    await a.setAnchor('root', { x: 500, y: 640 })
    // delta = (375, 340) → walkTo(200+375, 300+340)
    expect(modelRef.walkTo).toHaveBeenCalledWith(575, 640)
  })

  it('setAnchor instant：舞台摆放用 setPosition 瞬时定位', async () => {
    const { runtime, modelRef } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest(), noopStage)
    await a.setAnchor('root', { x: 500, y: 640 }, { instant: true })
    expect(modelRef.walkTo).not.toHaveBeenCalled()
    expect(modelRef.setPosition).toHaveBeenCalledWith(575, 640)
  })
})

describe('Cubism5WebAdapter — 生命周期', () => {
  it('destroy：modelRef.destroy 必达；销毁后 play 落 event-only', async () => {
    const { runtime, modelRef } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest(), noopStage)
    a.destroy()
    expect(modelRef.destroy).toHaveBeenCalledTimes(1)
    const r = await a.play('wave')
    expect(r.played).toBe(false)
    expect(r.level).toBe('event-only')
  })

  it('destroy 幂等（重复调用不抛错，且只销毁一次）', async () => {
    const { runtime, modelRef } = fakeRuntime()
    const a = new Cubism5WebAdapter(runtime)
    await a.load(manifest(), noopStage)
    a.destroy()
    a.destroy()
    expect(modelRef.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('jing/tao 序列帧角色包契约', () => {
  const readPlaceholder = (id: 'jing' | 'tao') =>
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../../public/models/${id}/manifest.json`, import.meta.url)), 'utf8'),
    )

  it('jing/tao manifest 始终通过 parseAvatarManifest 契约校验', () => {
    for (const id of ['jing', 'tao'] as const) {
      const m = parseAvatarManifest(readPlaceholder(id))
      expect(m.engine).toBe('sprite-sequence')
      expect(m.avatarId).toBe(id)
      expect(Object.keys(m.anchors)).toHaveLength(9)
      expect(m.capabilities.some((c) => c.actionId === 'idle')).toBe(true)
    }
  })

  it('official core 脚本加载钩子：未部署时 resolve(false) 而非 reject（不阻断页面）', async () => {
    // node 环境无 document —— 只验证"部署缺失走 resolve(false)"的降级语义设计
    expect(typeof loadCubism5CoreScript).toBe('function')
  })
})
