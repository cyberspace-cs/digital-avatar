import * as PIXI from 'pixi.js'
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4'
import type { Mood } from '../types'

/**
 * 动作 ID → Live2D motion 映射（Action 层：动作与角色解耦）。
 * 官方免费模型只有 Idle / TapBody 两组，TapBody 含多个动作，
 * index 越界时会在 play() 中自动回退，保证任何动作都有反馈。
 */
const ACTION_MOTIONS: Record<string, { group: string; index?: number }> = {
  poke: { group: 'TapBody', index: 0 },
  pat: { group: 'TapBody', index: 1 },
  pinch: { group: 'TapBody', index: 2 },
  wave: { group: 'TapBody', index: 3 },
  heart: { group: 'TapBody', index: 4 },
  hug: { group: 'TapBody', index: 5 },
  flick: { group: 'TapBody', index: 6 },
}

/** 状态 → 视觉规则（State 层）。Natori 用命名表情；Hiyori 无表情文件会静默跳过 */
const MOOD_RULES: Record<Mood, { expression?: string; speed: number }> = {
  neutral: { speed: 1 },
  happy: { expression: 'Smile', speed: 1.2 },
  low: { expression: 'Sad', speed: 0.6 },
  tired: { speed: 0.5 },
  angry: { expression: 'Angry', speed: 1.1 },
}

export class AvatarSprite {
  model: Live2DModel | null = null
  home = { x: 0, y: 0 }
  target = { x: 0, y: 0 }
  mood: Mood = 'neutral'
  lerpSpeed = 0.06
  private _returning = false

  async load(container: PIXI.Container, url: string, scale: number) {
    this.model = (await Live2DModel.from(url)) as Live2DModel
    this.model.scale.set(scale)
    this.model.anchor.set(0.5, 0.5)
    this.model.interactive = true
    container.addChild(this.model)
    return this.model
  }

  get x() {
    return this.model?.x ?? 0
  }
  get y() {
    return this.model?.y ?? 0
  }

  setPosition(x: number, y: number) {
    if (!this.model) return
    this.model.x = x
    this.model.y = y
    this.home = { x, y }
    this.target = { x, y }
  }

  /** 平滑走向某点（双人拥抱用） */
  walkTo(x: number, y: number) {
    this.target = { x, y }
    this._returning = false
  }

  goHome() {
    this.target = { ...this.home }
    this._returning = true
  }

  get arrivedHome() {
    return this._returning && this.near(this.home.x, this.home.y, 2)
  }

  near(x: number, y: number, eps: number) {
    return Math.abs((this.model?.x ?? 0) - x) < eps && Math.abs((this.model?.y ?? 0) - y) < eps
  }

  /** 每帧更新：平滑移动 + 呼吸/摇摆由 Live2D 内建 idle 驱动 */
  tick() {
    if (!this.model) return
    const dx = this.target.x - this.model.x
    const dy = this.target.y - this.model.y
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      this.model.x += dx * this.lerpSpeed
      this.model.y += dy * this.lerpSpeed
      // 行走时轻微左右摇摆
      this.model.rotation = Math.sin(Date.now() / 90) * 0.06
    } else {
      this.model.rotation = 0
    }
  }

  play(action: string) {
    if (!this.model) return
    const conf = ACTION_MOTIONS[action] ?? { group: 'TapBody', index: undefined }
    // TapBody 只有有限个动作：index 越界或播放失败时回退到 TapBody 0
    this.model
      .motion(conf.group, conf.index, MotionPriority.FORCE)
      .catch(() => this.model!.motion('TapBody', 0, MotionPriority.FORCE).catch(() => { }))
  }

  /** 状态视觉：Container 不支持 tint，用 ColorMatrixFilter 实现情绪色调 */
  private moodFilter = new PIXI.filters.ColorMatrixFilter()

  setMood(mood: Mood) {
    this.mood = mood
    if (!this.model) return
    const rule = MOOD_RULES[mood]
    // 只对带表情文件的模型生效（如 Haru F01-F08）；Hiyori 无表情则静默跳过
    if (rule.expression && (this.model.internalModel as any)?.motionManager?.expressionManager) {
      this.model.expression(rule.expression).catch(() => { })
    }
    const f = this.moodFilter
    f.reset()
    let filters: PIXI.Filter[] = []
    if (mood === 'low') {
      f.desaturate()
      f.brightness(0.72, true)
      filters = [f]
    } else if (mood === 'tired') {
      f.desaturate()
      f.brightness(0.85, true)
      filters = [f]
    } else if (mood === 'angry') {
      f.saturate(1.4, true)
      filters = [f]
    } else if (mood === 'happy') {
      f.brightness(1.08, true)
      filters = [f]
    }
    this.model.filters = filters
  }

  /** 被戳后的低落异常反应（互动后发现） */
  playSadReaction() {
    if (!this.model) return
    this.setMood('low')
    this.model.motion('Idle', 2, MotionPriority.FORCE).catch(() => { })
  }

  destroy() {
    this.model?.destroy()
    this.model = null
  }
}
