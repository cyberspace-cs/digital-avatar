/**
 * live2d/hybrid-avatar.ts — HybridAvatar（V2.2 混合路线：Live2D idle + 序列帧动作）
 *
 * 方案C（docs/superpowers/specs/2026-09-13-rendering-quality-and-live2d-roadmap.md）：
 *   - idle 状态：Live2D 模型渲染（呼吸、眨眼、眼球跟踪、物理摆动）
 *   - action 状态（wave/heart）：切换到序列帧播放，播完自动回 Live2D idle
 *   - 切换时 200ms 淡入淡出，避免硬切
 *   - 降级链：Live2D 加载失败 → 序列帧 idle → 旧模型
 *
 * 本类对 AppStage 暴露与 SpriteAvatar/AvatarSprite 相同的 StageSprite 公共面，
 * 内部同时持有两个子引擎实例，通过 container.alpha 控制可见性切换。
 *
 * 契约红线：不得把 PNG 序列帧当作 Live2D 运行时资产（.moc3 才是）；
 * 不得删除旧模型；不得用 TapBody 下标取模实现动作语义。
 */
import * as PIXI from 'pixi.js'
import type { AvatarManifest } from '@digital-avatar/shared'
import { parseAvatarManifest } from '@digital-avatar/shared'
import type { Mood } from '../types'
import type { QualityTier } from './perf'
import { AvatarSprite } from './avatar'
import { SpriteAvatar, type StageSprite } from './sprite-avatar'
import { AVATAR_HALF_BODY } from './models'

/** 切换淡入淡出时长（ms） */
const CROSSFADE_MS = 200
/** 动作播完后回 idle 的延迟（ms），给末帧一个停留 */
const ACTION_RETURN_DELAY_MS = 100

type HybridMode = 'live2d' | 'sprite'

/**
 * 混合渲染形象：Live2D idle + 序列帧动作。
 * 实现 StageSprite 接口，可与 SpriteAvatar/AvatarSprite 互换。
 */
export class HybridAvatar implements StageSprite {
  /** 舞台容器（两个子引擎的 model 都挂在这里） */
  model: PIXI.Container | null = null
  home = { x: 0, y: 0 }
  target = { x: 0, y: 0 }
  mood: Mood = 'neutral'
  style = 'default'
  variant = 'base'
  lerpSpeed = 0.06

  /** 解析后的角色包 manifest（含 live2d 配置） */
  manifest: AvatarManifest | null = null

  /** Live2D 子引擎（idle 用） */
  private _live2d: AvatarSprite
  /** 序列帧子引擎（动作用，也做 idle 降级兜底） */
  private _sprite: SpriteAvatar
  /** 当前渲染模式 */
  private _mode: HybridMode = 'live2d'
  /** Live2D 是否加载成功（失败则永久降级到 sprite） */
  private _live2dReady = false
  /** 舞台容器引用（子引擎 load 时需要） */
  private _container: PIXI.Container | null = null
  /** 最近一次 load 参数 */
  private _lastLoad: { url: string; scale: number; tier: QualityTier } | null = null
  /** 淡入淡出动画状态 */
  private _fade: { active: boolean; startTs: number; from: HybridMode; to: HybridMode } | null = null
  /** 动作播放完成回调 */
  private _actionComplete: (() => void) | null = null
  /** 动作回 idle 的定时器 */
  private _returnTimer: ReturnType<typeof setTimeout> | null = null
  /** load 会话号（防止竞态） */
  private _loadSeq = 0

  constructor() {
    this._live2d = new AvatarSprite()
    this._sprite = new SpriteAvatar()
  }

  get x() {
    return this.model?.x ?? 0
  }
  get y() {
    return this.model?.y ?? 0
  }

  /**
   * 加载混合角色包：
   * 1. 拉取 manifest（engine=hybrid，含 live2d 配置）
   * 2. 并行加载序列帧（SpriteAvatar）和 Live2D（AvatarSprite）
   * 3. Live2D 加载失败则降级到序列帧 idle
   */
  async load(container: PIXI.Container, url: string, scale: number, tier: QualityTier = 'high'): Promise<unknown> {
    const seq = ++this._loadSeq
    this._container = container
    this._lastLoad = { url, scale, tier }

    // 拉取 manifest
    const res = await fetch(url)
    if (!res.ok) throw new Error(`hybrid manifest 拉取失败 ${res.status}: ${url}`)
    const manifest = parseAvatarManifest(await res.json())
    if (manifest.engine !== 'hybrid') {
      throw new Error(`engine 不是 hybrid: ${manifest.engine}（${url}）`)
    }
    if (!manifest.live2d) {
      throw new Error(`hybrid manifest 缺少 live2d 配置（${url}）`)
    }
    if (seq !== this._loadSeq) return null

    this.manifest = manifest

    // 创建舞台容器
    if (this.model) {
      container.removeChild(this.model)
      this.model.destroy({ children: true })
    }
    this.model = new PIXI.Container()
    container.addChild(this.model)

    const baseUrl = url.replace(/[^/]*$/, '')
    const live2dModelUrl = baseUrl + manifest.live2d.model

    // 并行加载两个子引擎
    // 序列帧：一定能加载成功（做 idle 兜底）
    const spritePromise = this._sprite.load(this.model, url, scale, tier).catch((e) => {
      console.warn('[hybrid] 序列帧加载失败（降级链最后一环也断了）', e)
      return null
    })

    // Live2D：可能失败，失败则降级
    const live2dPromise = this._live2d.load(this.model, live2dModelUrl, scale, tier).then(
      () => true,
      (e) => {
        console.warn('[hybrid] Live2D 加载失败，降级到序列帧 idle', e)
        return false
      },
    )

    const [, live2dOk] = await Promise.all([spritePromise, live2dPromise])
    if (seq !== this._loadSeq) return null

    this._live2dReady = live2dOk
    this._mode = live2dOk ? 'live2d' : 'sprite'

    // 设置初始可见性
    this._applyModeVisibility()

    // 同步位置/锚点到子引擎
    this._syncToChildren()

    return this.model
  }

  /** 换形象（先销毁再加载） */
  async swap(container: PIXI.Container, url: string, scale: number, tier?: QualityTier): Promise<unknown> {
    this._cleanup()
    return this.load(container, url, scale, tier)
  }

  /**
   * 播放动作：
   * - hasNativeActions=true 且 Live2D 就绪 → Live2D 原生动作
   * - 否则 → 序列帧动作（淡入序列帧，播完淡出回 Live2D idle）
   */
  play(action: string): void {
    if (!this.manifest) return

    // Live2D 原生动作模式
    if (this._live2dReady && this.manifest.live2d?.hasNativeActions) {
      this._live2d.play(action)
      return
    }

    // 序列帧动作模式：当前是 live2d → 淡入序列帧
    if (this._mode === 'live2d' && this._live2dReady) {
      this._startFade('sprite')
    } else {
      this._mode = 'sprite'
      this._applyModeVisibility()
    }

    // 播放序列帧动作
    this._sprite.play(action)

    // 动作播完后回 idle
    if (this._returnTimer) clearTimeout(this._returnTimer)
    // 序列帧动作时长：5帧 × 125ms × 2循环 + 250ms末帧停留 ≈ 1500ms
    const actionDurationMs = this._estimateActionDuration(action)
    this._returnTimer = setTimeout(() => {
      this._returnToIdle()
    }, actionDurationMs + ACTION_RETURN_DELAY_MS)
  }

  /** 播放完成后回 Live2D idle */
  private _returnToIdle(): void {
    this._returnTimer = null
    if (this._live2dReady) {
      this._startFade('live2d')
    } else {
      this._mode = 'sprite'
      this._applyModeVisibility()
    }
    this._actionComplete?.()
    this._actionComplete = null
  }

  /** 估算动作时长（ms） */
  private _estimateActionDuration(action: string): number {
    const cap = this.manifest?.capabilities.find((c) => c.actionId === action)
    const frameCount = cap?.frames?.length ?? 5
    const fps = 8
    const loops = 2
    const holdLast = 250
    return (frameCount * 1000 / fps) * loops + holdLast
  }

  /** 开始淡入淡出切换 */
  private _startFade(to: HybridMode): void {
    if (this._mode === to) return
    this._fade = { active: true, startTs: performance.now(), from: this._mode, to }
    this._mode = to
  }

  /** 应用当前模式的可见性（立即切换，无动画） */
  private _applyModeVisibility(): void {
    if (this._live2d.model) this._live2d.model.alpha = this._mode === 'live2d' ? 1 : 0
    if (this._sprite.model) this._sprite.model.alpha = this._mode === 'sprite' ? 1 : 0
  }

  /** 每帧更新：处理淡入淡出动画 + 子引擎 tick */
  tick(delta?: number): void {
    // 淡入淡出动画
    if (this._fade?.active) {
      const elapsed = performance.now() - this._fade.startTs
      const t = Math.min(elapsed / CROSSFADE_MS, 1)
      const fromAlpha = 1 - t
      const toAlpha = t
      if (this._fade.from === 'live2d' && this._live2d.model) this._live2d.model.alpha = fromAlpha
      if (this._fade.from === 'sprite' && this._sprite.model) this._sprite.model.alpha = fromAlpha
      if (this._fade.to === 'live2d' && this._live2d.model) this._live2d.model.alpha = toAlpha
      if (this._fade.to === 'sprite' && this._sprite.model) this._sprite.model.alpha = toAlpha
      if (t >= 1) {
        this._fade = null
        this._applyModeVisibility()
      }
    }

    // 子引擎 tick（两个都更新，保持状态同步）
    this._live2d.tick(delta)
    this._sprite.tick(delta)
  }

  /** 同步位置/锚点/心情到两个子引擎 */
  private _syncToChildren(): void {
    for (const child of [this._live2d, this._sprite]) {
      child.home = { ...this.home }
      child.target = { ...this.target }
      child.mood = this.mood
      child.style = this.style
      child.variant = this.variant
      child.lerpSpeed = this.lerpSpeed
    }
  }

  // ---- StageSprite 接口实现（代理到子引擎） ----

  playSadReaction(): void {
    this._live2d.playSadReaction()
    this._sprite.playSadReaction()
  }

  setMood(mood: Mood): void {
    this.mood = mood
    this._live2d.setMood(mood)
    this._sprite.setMood(mood)
  }

  walkTo(x: number, y: number): void {
    this.target = { x, y }
    this._live2d.walkTo(x, y)
    this._sprite.walkTo(x, y)
  }

  setPosition(x: number, y: number): void {
    if (this.model) {
      this.model.x = x
      this.model.y = y
    }
    this.home = { x, y }
    this.target = { x, y }
  }

  setAnchor(x: number, y: number): void {
    this._live2d.setAnchor(x, y)
    this._sprite.setAnchor(x, y)
  }

  cancelReturn(): void {
    this._live2d.cancelReturn()
    this._sprite.cancelReturn()
  }

  returnHome(): void {
    this._live2d.returnHome()
    this._sprite.returnHome()
  }

  realBounds(): PIXI.Rectangle | null {
    // 返回当前可见模式的 bounds
    if (this._mode === 'live2d' && this._live2dReady) return this._live2d.realBounds()
    return this._sprite.realBounds()
  }

  startIdleLoop(intervalMs?: number): void {
    this._live2d.startIdleLoop(intervalMs)
    this._sprite.startIdleLoop(intervalMs)
  }

  stopIdleLoop(): void {
    this._live2d.stopIdleLoop()
    this._sprite.stopIdleLoop()
  }

  async applyStyle(styleId: string): Promise<boolean> {
    this.style = styleId
    // 换装只对 Live2D 有意义（序列帧无换装），但同步设置
    const r = await this._live2d.applyStyle(styleId)
    return r
  }

  async applyVariant(variantId: string): Promise<boolean> {
    this.variant = variantId
    const r = await this._live2d.applyVariant(variantId)
    return r
  }

  /** 清理资源 */
  private _cleanup(): void {
    if (this._returnTimer) {
      clearTimeout(this._returnTimer)
      this._returnTimer = null
    }
    this._fade = null
    this._actionComplete = null
    this._live2dReady = false
  }

  destroy(): void {
    this._cleanup()
    this._live2d.destroy()
    this._sprite.destroy()
    if (this.model) {
      this.model.destroy({ children: true })
      this.model = null
    }
  }
}
