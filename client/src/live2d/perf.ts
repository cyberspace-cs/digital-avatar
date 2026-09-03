/**
 * 渲染性能治理器（Perf 层）。
 *
 * 依据（Loop Engineering 调研存档，见 docs/ARCHITECTURE.md 渲染性能小节）：
 * - pixi-live2d-display #50（作者认可）：渲染帧率 60→30 可近似减半 GPU 占用
 * - PixiJS 官方 Performance Tips：antialias:false 对弱设备提升明显；resolution 决定填充率
 * - Live2D 官方 FAQ：多模型场景主要开销是 Draw Call，降帧直接按比例降低
 *
 * 三档位：high=60fps/2x分辨率，balanced=30fps/1x，saver=20fps/1x。
 * 实测 FPS 持续低于档位目标 75% 时自动降档；可用 URL ?perf= 强制指定。
 */

import * as PIXI from 'pixi.js'

export type QualityTier = 'high' | 'balanced' | 'saver'

const TIER_FPS: Record<QualityTier, number> = { high: 60, balanced: 30, saver: 20 }
const TIER_RES: Record<QualityTier, number> = {
  high: Math.min(window.devicePixelRatio || 1, 2),
  balanced: 1,
  saver: 1,
}
/** 降档判定窗口与阈值：实测均值 < 目标 × 0.75 视为带不动 */
const WINDOW_MS = 4000
const DOWNGRADE_RATIO = 0.75

export function isMobileDevice() {
  return window.matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
}

export function resolveStartTier(): QualityTier {
  const forced = new URLSearchParams(location.search).get('perf')
  if (forced === 'high' || forced === 'balanced' || forced === 'saver') return forced
  const saved = localStorage.getItem('da_perf') as QualityTier | null
  if (saved && saved in TIER_FPS) return saved
  // 移动端默认平衡档，配合纹理 LOD SD
  if (isMobileDevice()) return 'balanced'
  return 'high'
}

export class PerfGovernor {
  private tier: QualityTier
  private frames = 0
  private windowStart = performance.now()
  private hud: HTMLDivElement | null = null
  private backgroundPaused = false

  constructor(
    private app: PIXI.Application,
    private onChange?: (t: QualityTier) => void,
  ) {
    this.tier = resolveStartTier()
    this.applyTier(this.tier)

    app.ticker.add(this.onTick, null, PIXI.UPDATE_PRIORITY.LOW)
    // 页面切后台/前台：暂停渲染，释放 GPU + CPU（切回瞬间避免 deltaTime 尖峰）
    document.addEventListener('visibilitychange', this.onVisibility)

    if (new URLSearchParams(location.search).has('fps')) this.showHud()
    // 调试探针（控制台可用 __perf 查看当前档位/帧率统计）
    ;(window as any).__perf = this
  }

  get current() {
    return this.tier
  }

  private onVisibility = () => {
    if (document.hidden && !this.backgroundPaused) {
      this.backgroundPaused = true
      this.app.ticker.remove(this.onTick)
      this.app.stop()
    } else if (!document.hidden && this.backgroundPaused) {
      this.backgroundPaused = false
      this.frames = 0
      this.windowStart = performance.now()
      this.app.ticker.add(this.onTick, null, PIXI.UPDATE_PRIORITY.LOW)
      this.app.start()
    }
  }

  private applyTier(t: QualityTier) {
    this.tier = t
    localStorage.setItem('da_perf', t)
    this.app.ticker.maxFPS = TIER_FPS[t]
      // resolution 变更后需 resize 才会重建缓冲区（autoDensity 同步 CSS 尺寸）
      ; (this.app.renderer as PIXI.Renderer).resolution = TIER_RES[t]
    this.app.renderer.resize(window.innerWidth, window.innerHeight)
    this.onChange?.(t)
  }

  private onTick = () => {
    this.frames++
    const now = performance.now()
    if (now - this.windowStart < WINDOW_MS) return
    const avgFps = (this.frames * 1000) / (now - this.windowStart)
    this.frames = 0
    this.windowStart = now
    this.updateHud(avgFps)

    const target = TIER_FPS[this.tier]
    // 已在低帧率档仍不达标 → 再降一档；high 档实际跑不满 60 才降
    if (avgFps < target * DOWNGRADE_RATIO) {
      const next: QualityTier = this.tier === 'high' ? 'balanced' : 'saver'
      if (next !== this.tier) {
        this.applyTier(next)
        console.info(`[perf] 降档 ${this.tier} → ${next}（${avgFps.toFixed(0)}fps < ${target * DOWNGRADE_RATIO}）`)
      }
    }
  }

  /** ?fps=1 打开调试 HUD */
  private showHud() {
    this.hud = document.createElement('div')
    this.hud.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:9999;font:12px/1.4 monospace;' +
      'background:rgba(0,0,0,.55);color:#7CFC9B;padding:4px 8px;border-radius:6px;pointer-events:none'
    document.body.appendChild(this.hud)
  }

  private updateHud(avgFps: number) {
    if (!this.hud) return
    const r = (this.app.renderer as PIXI.Renderer).resolution
    const pauseTag = this.backgroundPaused ? ' · paused(back)' : ''
    this.hud.textContent = `${avgFps.toFixed(0)}fps · cap ${TIER_FPS[this.tier]} · res ${r}x · ${this.tier}${pauseTag}`
  }

  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.app.ticker.remove(this.onTick)
    this.hud?.remove()
    this.hud = null
  }
}
