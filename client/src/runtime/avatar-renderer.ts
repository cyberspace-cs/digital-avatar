/**
 * runtime/avatar-renderer.ts — 渲染器端口（V2.0 Task 4，契约 §3.1 渐进式双适配器）
 *
 * 本模块是"端口"：只定义接口与数据类型，不依赖 PIXI / Live2D（可在 node 环境单测）。
 * 适配器实现：
 *   - adapters/legacy-pixi.ts  → Hiyori/Haru/Natori/Chitose（pixi-live2d-display 0.4.0 + Cubism 4 core）
 *   - adapters/cubism5-web.ts  → Jing/Tao（Cubism SDK for Web R5，Task 5）
 *
 * 领域层只面对本端口；渲染异常不向上抛（契约：动画失败不影响事件保存）。
 */
import type { AnchorName, AvatarManifest, RenderEngine } from '@digital-avatar/shared'
import type { Mood } from '../types'
import type { DegradeLevel } from '../actions/registry'

/** 全局舞台坐标（像素） */
export interface StagePoint {
  x: number
  y: number
}

/** 播放上下文：通用反应时的表情建议等 */
export interface PlaybackContext {
  /** 通用反应（第三级）时建议表情；缺省 happy */
  mood?: Mood
}

/** 播放结果：调用方据此决定是否补气泡/粒子（渲染失败绝不抛错） */
export interface PlaybackResult {
  /** 是否产生了可见动画/表情反馈 */
  played: boolean
  /** 实际执行的 actionId（exact/semantic 时为可播放动作） */
  actionId: string
  /** 命中的降级链级别（1~5） */
  level: DegradeLevel
  degradeReason?: string
  /** 渲染失败原因（仅 played=false 且为异常时） */
  error?: string
}

/** 舞台加载参数（旧 PIXI 管线需要容器/缩放/纹理档位） */
export interface LoadStageOptions {
  container: unknown
  scale: number
  tier?: 'high' | 'balanced' | 'saver'
}

/** load 的产物：调用方不直接持有模型实例，一切经渲染器操作 */
export interface AvatarHandle {
  manifest: AvatarManifest
  engine: RenderEngine
}

/**
 * 旧 AvatarSprite 的结构化职责子集（四职责边界，AvatarSprite 本尊保持行为不变）：
 *   生命周期 = load/destroy；动作 = play/playSadReaction；外观 = setMood；舞台 = walkTo/setPosition/x/y/realBounds
 * 结构化类型（而非 class 继承）：单测用替身，运行时传 AvatarSprite 实例。
 */
export interface AvatarSpriteRoles {
  // 生命周期
  load(container: unknown, url: string, scale: number, tier?: 'high' | 'balanced' | 'saver'): Promise<unknown>
  destroy(): void
  // 动作
  play(action: string): void
  playSadReaction(): void
  // 外观
  setMood(mood: Mood): void
  // 舞台
  walkTo(x: number, y: number): void
  /** 瞬时定位（home+target+模型位姿同时设定，不走 lerp） */
  setPosition(x: number, y: number): void
  readonly x: number
  readonly y: number
  /** 角色真实绘制范围（全局像素）；模型未加载/隐藏时为 null */
  realBounds(): { x: number; y: number; width: number; height: number } | null
  model: unknown
}

/**
 * 渲染器端口（契约 §4 Task 4 核心接口）。
 * setAnchor：把模型上命名锚点定位到全局位置——编排走位的唯一原语；
 *            instant=true 用于舞台摆放（瞬时），缺省走位（lerp）。
 */
export interface AvatarRenderer {
  load(manifest: AvatarManifest, stage: LoadStageOptions): Promise<AvatarHandle>
  play(actionId: string, context?: PlaybackContext): Promise<PlaybackResult>
  setAnchor(anchor: AnchorName, position: StagePoint, opts?: { instant?: boolean }): void
  /** 读当前命名锚点的全局位置（模型不可用时为 null） */
  anchorPoint(anchor: AnchorName): StagePoint | null
  destroy(): void
}
