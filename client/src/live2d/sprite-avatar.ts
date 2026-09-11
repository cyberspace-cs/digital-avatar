/**
 * live2d/sprite-avatar.ts — SpriteAvatar（V2.1 QQ秀路线：PNG 序列帧轻量渲染）
 *
 * 调研结论（docs/assets/specs/asset-production-spec.md V2.1 修订）：QQ 秀 20 年
 * "实时更新动作"的本质是"动作即素材包"——预渲染帧序列 + 分层静态合成，渲染端
 * 轻到只是换图片。本类对 AppStage 暴露与 AvatarSprite 相同的舞台公共面
 * （StageSprite 结构类型），load() 拉取角色包 manifest.json（engine=sprite-sequence）：
 *   - idle = 基准立绘 + 程序呼吸微动效（QQ秀做法：静态立绘即可用，零额外素材）
 *   - 动作 = 播放 capabilities[].frames 帧序列（8fps，播完回 idle）
 *   - 帧纹理懒加载：首次 play 时拉取，失败回退 idle（绝不抛错）
 *
 * 编排链路复用：本类满足 AvatarSpriteRoles 结构，可被 LegacyPixiAdapter 直接包装
 * （锚点/走位/降级链全走既有 port），AppStage 无需为序列帧形态新开编排通道。
 */
import * as PIXI from 'pixi.js'
import type { AvatarManifest } from '@digital-avatar/shared'
import { parseAvatarManifest } from '@digital-avatar/shared'
import type { Mood } from '../types'
import type { QualityTier } from './perf'
import { AVATAR_HALF_BODY } from './models'

/** 动作帧率（QQ秀级别 8fps 足够顺滑，saver 档零压力） */
export const SPRITE_ACTION_FPS = 8
/** 末帧停留时长（ms）：峰值动作多看一眼再回待机 */
export const SPRITE_HOLD_LAST_MS = 250
/** idle 呼吸幅度（±scale 比例） */
const BREATHE_AMP = 0.012
const BREATHE_PERIOD_MS = 3000

/**
 * 舞台形象公共面：AppStage 对 meS/partnerS 的全部依赖（AvatarSprite 与 SpriteAvatar
 * 的公共结构子集）。AvatarSprite 有私有字段不可做联合目标，故收窄为接口——
 * AvatarSprite 结构上满足本接口（公开成员超集），运行时二者可互换。
 */
export interface StageSprite {
  model: PIXI.Container | null
  home: { x: number; y: number }
  target: { x: number; y: number }
  mood: Mood
  style: string
  variant: string
  lerpSpeed: number
  load(container: PIXI.Container, url: string, scale: number, tier?: QualityTier): Promise<unknown>
  swap(container: PIXI.Container, url: string, scale: number, tier?: QualityTier): Promise<unknown>
  destroy(): void
  play(action: string): void
  playSadReaction(): void
  setMood(mood: Mood): void
  walkTo(x: number, y: number): void
  setPosition(x: number, y: number): void
  setAnchor(x: number, y: number): void
  cancelReturn(): void
  returnHome(): void
  readonly x: number
  readonly y: number
  realBounds(): PIXI.Rectangle | null
  tick(delta?: number): void
  startIdleLoop(intervalMs?: number): void
  stopIdleLoop(): void
  applyStyle(styleId: string): Promise<boolean>
  applyVariant(variantId: string): Promise<boolean>
}

/** 播放帧下标计算（纯函数，单测用）：返回当前应显示帧号，序列播完且停留结束时返回 -1（回 idle） */
export function frameIndexAt(elapsedMs: number, frameCount: number, fps = SPRITE_ACTION_FPS, holdLastMs = SPRITE_HOLD_LAST_MS): number {
  if (frameCount <= 0) return -1
  const frameMs = 1000 / fps
  const idx = Math.floor(elapsedMs / frameMs)
  if (idx < frameCount) return idx
  return elapsedMs < (frameCount * 1000) / fps + holdLastMs ? frameCount - 1 : -1
}

/** manifest 能力表 → 动作帧 URL 映射（纯函数，单测用）。无 frames 声明的动作不进表 */
export function clipsFromManifest(manifest: AvatarManifest, manifestUrl: string): Map<string, string[]> {
  const base = manifestUrl.replace(/[^/]*$/, '')
  const map = new Map<string, string[]>()
  for (const cap of manifest.capabilities) {
    if (!cap.frames?.length) continue
    map.set(cap.actionId, cap.frames.map((f) => base + f))
  }
  return map
}

/** 一个动作的帧序列剪辑（纹理懒加载缓存） */
interface FrameClip {
  urls: string[]
  textures: Array<PIXI.Texture | null>
  loading: Promise<void> | null
}

/**
 * 纹理加载（pixi 6 无 PIXI.Assets）：Image 解码后包装 BaseTexture。
 * 同一 URL 的 Image 会命中浏览器缓存，帧序列重复拉取零开销。
 */
function loadTexture(url: string): Promise<PIXI.Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(new PIXI.Texture(new PIXI.BaseTexture(img)))
    img.onerror = () => reject(new Error(`纹理加载失败: ${url}`))
    img.src = url
  })
}

export class SpriteAvatar implements StageSprite {
  model: PIXI.Container | null = null
  home = { x: 0, y: 0 }
  target = { x: 0, y: 0 }
  mood: Mood = 'neutral'
  style = 'default'
  /** 衣橱字段与 AvatarSprite 对齐；序列帧形象换装为 no-op（record 后 applyStyle 返回 false） */
  variant = 'base'
  lerpSpeed = 0.06
  /** 解析后的角色包 manifest（adapterFor 据此构造真实能力表适配器） */
  manifest: AvatarManifest | null = null

  private _stageContainer: PIXI.Container | null = null
  private _clips = new Map<string, FrameClip>()
  private _idleTex: PIXI.Texture | null = null
  private _frameSprite: PIXI.Sprite | null = null
  private _playing: { clip: FrameClip; startTs: number } | null = null
  private _returning = false
  private _phase = 0
  private _bounce = 0
  private _lastTs = 0
  private _loadSeq = 0

  get x() {
    return this.model?.x ?? 0
  }
  get y() {
    return this.model?.y ?? 0
  }

  /** 拉取 manifest 并加载 idle 立绘。url = models/<id>/manifest.json */
  async load(container: PIXI.Container, url: string, _scale: number, _tier?: QualityTier): Promise<unknown> {
    const seq = ++this._loadSeq
    const res = await fetch(url)
    if (!res.ok) throw new Error(`sprite manifest 拉取失败 ${res.status}: ${url}`)
    const manifest = parseAvatarManifest(await res.json())
    if (manifest.engine !== 'sprite-sequence') {
      throw new Error(`engine 不是 sprite-sequence: ${manifest.engine}（${url}）`)
    }
    const idleUrl = url.replace(/[^/]*$/, '') + manifest.model3Url
    const tex = await loadTexture(idleUrl)
    // 过期加载（快速连点换形象）：产物直接丢弃
    if (seq !== this._loadSeq) return null

    this.manifest = manifest
    this._idleTex = tex
    const frameUrls = clipsFromManifest(manifest, url)
    this._clips = new Map()
    for (const [id, urls] of frameUrls) {
      this._clips.set(id, { urls, textures: urls.map(() => null), loading: null })
    }
    this._mount(container, tex, AVATAR_HALF_BODY[manifest.avatarId] === true)
    this._stageContainer = container
    return this.model
  }

  /** 换形象（与 AvatarSprite.swap 语义一致：先销毁旧模型再加载新 manifest） */
  async swap(container: PIXI.Container, url: string, scale: number, tier?: QualityTier): Promise<unknown> {
    this._teardownModel()
    return this.load(container, url, scale, tier)
  }

  /** 把 idle 立绘挂上舞台（高度归一规则与 AvatarSprite 一致：全身 ~74% 视口高） */
  private _mount(container: PIXI.Container, tex: PIXI.Texture, halfBody: boolean) {
    if (this.model) this._teardownModel()
    const model = new PIXI.Container()
    const frameSprite = new PIXI.Sprite(tex)
    frameSprite.anchor.set(0.5, 0.5)
    model.addChild(frameSprite)
    if (tex.height > 0) {
      const targetH = halfBody ? window.innerHeight : window.innerHeight * 0.74
      model.scale.set(targetH / tex.height)
    }
    container.addChild(model)
    this.model = model
    this._frameSprite = frameSprite
    this._playing = null
  }

  private _teardownModel() {
    if (this.model) {
      this.model.parent?.removeChild(this.model)
      this.model.destroy({ children: true })
    }
    this.model = null
    this._frameSprite = null
    this._playing = null
  }

  /** 帧纹理懒加载（同一 clip 并发复用同一 promise；失败向上抛给 _playClip 兜底） */
  private _ensureTextures(clip: FrameClip): Promise<void> {
    if (!clip.loading) {
      clip.loading = Promise.all(
        clip.urls.map(async (u, i) => {
          if (!clip.textures[i]) clip.textures[i] = await loadTexture(u)
        }),
      ).then(() => undefined)
    }
    return clip.loading
  }

  play(action: string) {
    const clip = this._clips.get(action)
    if (action === 'idle' || !clip) {
      // 无帧可播（未知动作/帧包缺失）：轻微弹跳给可见反馈，绝不抛错
      this._bounce = 1
      return
    }
    void this._ensureTextures(clip)
      .then(() => {
        if (this.model && this._loadSeq > 0) this._playing = { clip, startTs: performance.now() }
      })
      .catch((e) => {
        console.warn('[sprite] 帧加载失败，回退 idle', action, e)
        this._bounce = 1
      })
  }

  /** 接收方 mood === low 时的"负面反应"：序列帧形象用表情弹跳表达 */
  playSadReaction() {
    this.setMood('low')
  }

  setMood(mood: Mood) {
    this.mood = mood
    // QQ秀级反馈：开心 = 轻微弹跳（程序动效，零素材）
    if (mood === 'happy') this._bounce = 1
  }

  walkTo(tx: number, ty: number) {
    this._returning = false
    this.target.x = tx
    this.target.y = ty
  }

  setPosition(x: number, y: number) {
    this.home.x = x
    this.home.y = y
    this.target.x = x
    this.target.y = y
    if (this.model) {
      this.model.x = x
      this.model.y = y
    }
  }

  setAnchor(x: number, y: number) {
    this.setPosition(x, y)
  }

  cancelReturn() {
    this._returning = false
  }

  returnHome() {
    this._returning = true
    this.target.x = this.home.x
    this.target.y = this.home.y
  }

  realBounds(): PIXI.Rectangle | null {
    if (!this.model || !this.model.visible) return null
    return this.model.getBounds() as PIXI.Rectangle
  }

  tick(delta?: number) {
    const model = this.model
    const frameSprite = this._frameSprite
    if (!model || !frameSprite) return
    const d = (delta ?? 1) | 0
    // 走位 lerp（与 AvatarSprite 同构）
    if (this._returning) {
      model.x += (this.home.x - model.x) * this.lerpSpeed * d
      model.y += (this.home.y - model.y) * this.lerpSpeed * d
    } else {
      model.x += (this.target.x - model.x) * this.lerpSpeed * d
      model.y += (this.target.y - model.y) * this.lerpSpeed * d
    }
    const now = performance.now()
    const dt = Math.min(100, this._lastTs ? now - this._lastTs : 16)
    this._lastTs = now
    // 动作帧推进（8fps + 末帧停留）
    if (this._playing) {
      const { clip, startTs } = this._playing
      const idx = frameIndexAt(now - startTs, clip.textures.length)
      if (idx < 0) {
        this._playing = null
      } else if (clip.textures[idx]) {
        frameSprite.texture = clip.textures[idx]!
      }
    }
    // idle 呼吸（播放动作时暂停呼吸避免叠加抖动）
    if (!this._playing) {
      this._phase = (this._phase + dt) % BREATHE_PERIOD_MS
      const breathe = Math.sin((this._phase / BREATHE_PERIOD_MS) * Math.PI * 2)
      // 开心弹跳：指数衰减的 scale 脉冲，叠加在呼吸上
      let bounce = 0
      if (this._bounce > 0.01) {
        bounce = Math.sin(this._bounce * Math.PI) * 0.05
        this._bounce = Math.max(0, this._bounce - dt / 450)
      }
      frameSprite.scale.set(1 - BREATHE_AMP * breathe, 1 + BREATHE_AMP * breathe + bounce)
    }
  }

  startIdleLoop(_intervalMs?: number) {
    /* 呼吸由 tick 程序驱动，无需轮换 idle 动作 */
  }

  stopIdleLoop() {
    /* 同上 */
  }

  /** 序列帧形象换装 no-op：字段照记（UI/同步层兼容），返回 false = 未重载 */
  applyStyle(styleId: string): Promise<boolean> {
    this.style = styleId
    return Promise.resolve(false)
  }

  applyVariant(variantId: string): Promise<boolean> {
    this.variant = variantId
    return Promise.resolve(false)
  }

  destroy() {
    this._loadSeq++ // 使在途加载作废
    this._stageContainer = null
    this.manifest = null
    this._clips.clear()
    this._idleTex = null
    this._teardownModel()
  }
}
