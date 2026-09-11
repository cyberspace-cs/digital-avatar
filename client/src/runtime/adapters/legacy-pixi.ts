/**
 * runtime/adapters/legacy-pixi.ts — LegacyPixiAdapter（V2.0 Task 4）
 *
 * 把旧 AvatarSprite（pixi-live2d-display 0.4.0 + Cubism 4 core）包装成 AvatarRenderer 端口：
 * - 动作语义：resolveAction 解析期降级链（精确 → 同语义 → 通用反应 → 中性待机 → 只保留事件）
 *   + 运行时播放失败时消费能力声明的 degradesTo（第二级备用元数据），最终回落 idle 表情，永不抛错
 * - 锚点：旧模型没有 anchors.json，用角色真实绘制范围（realBounds，顶点级）近似 9 个统一锚点
 * - 生命周期：load/destroy 直通 sprite（Blob URL 释放、Worker 终止等既有逻辑不动）
 *
 * 红线：不改变 AvatarSprite 行为——适配层只做"端口翻译"，保证旧模型不回归。
 */
import type { AnchorName, AvatarManifest } from '@digital-avatar/shared'
import { parseAvatarManifest } from '@digital-avatar/shared'
import { resolveAction, legacyCapabilities } from '../../actions/registry'
import { avatarDef, MODEL_URLS } from '../../live2d/models'
import type { AvatarRenderer, AvatarSpriteRoles, LoadStageOptions, PlaybackContext, PlaybackResult, StagePoint } from '../avatar-renderer'

/**
 * realBounds 矩形 → 统一锚点近似（归一化比例按角色立绘目测校准）。
 * bounds = {x, y, width, height}（全局像素）；left/right 以【画面视角】为准。
 */
function anchorFromBounds(anchor: AnchorName, b: { x: number; y: number; width: number; height: number }): StagePoint {
  const cx = b.x + b.width / 2
  switch (anchor) {
    case 'head': return { x: cx, y: b.y + b.height * 0.08 }
    case 'hand.left': return { x: b.x + b.width * 0.18, y: b.y + b.height * 0.45 }
    case 'hand.right': return { x: b.x + b.width * 0.82, y: b.y + b.height * 0.45 }
    case 'foot.left': return { x: b.x + b.width * 0.35, y: b.y + b.height }
    case 'foot.right': return { x: b.x + b.width * 0.65, y: b.y + b.height }
    case 'heart': return { x: cx, y: b.y + b.height * 0.35 }
    case 'shoulder': return { x: cx, y: b.y + b.height * 0.25 }
    case 'hug.chest': return { x: cx, y: b.y + b.height * 0.42 }
    case 'root': return { x: cx, y: b.y + b.height }
  }
}

export class LegacyPixiAdapter implements AvatarRenderer {
  private sprite: AvatarSpriteRoles | null
  private readonly manifest: AvatarManifest

  constructor(sprite: AvatarSpriteRoles, manifest: AvatarManifest) {
    this.sprite = sprite
    this.manifest = manifest
  }

  async load(manifest: AvatarManifest, stage: LoadStageOptions) {
    if (!this.sprite) throw new Error('adapter already destroyed')
    await this.sprite.load(stage.container, manifest.model3Url, stage.scale, stage.tier)
    return { manifest, engine: manifest.engine } as const
  }

  async play(actionId: string, context?: PlaybackContext): Promise<PlaybackResult> {
    const sprite = this.sprite
    const plan = resolveAction(this.manifest.capabilities, actionId)

    // 五级：只保留事件（无模型/已销毁）
    if (!sprite || plan.level === 'event-only') {
      return { played: false, actionId, level: 'event-only', degradeReason: plan.degradeReason }
    }

    // 四级：中性待机 + 气泡（气泡由 App 层负责，渲染层无事可做）
    if (plan.level === 'neutral-bubble') {
      return { played: false, actionId, level: 'neutral-bubble', degradeReason: plan.degradeReason }
    }

    // 三级：通用反应 = 表情变化（与 App.playPlanLocal 行为一致：不播 idle 动作）
    if (plan.level === 'generic') {
      sprite.setMood(context?.mood ?? 'happy')
      return { played: true, actionId: 'idle', level: 'generic', degradeReason: plan.degradeReason }
    }

    // 一/二级：播放解析到的动作；失败走运行时降级
    try {
      sprite.play(plan.actionId)
      return { played: true, actionId: plan.actionId, level: plan.level, degradeReason: plan.degradeReason }
    } catch (err) {
      return this.runtimeFallback(actionId, plan.actionId, err)
    }
  }

  /**
   * 运行时降级：动作播放失败 → 能力声明 degradesTo 候选（运行时备用元数据）
   * → idle 表情 → 放弃播放（返回 played=false），全程不向上抛（契约：动画失败不阻断事件）
   */
  private runtimeFallback(requestedId: string, failedId: string, err: unknown): PlaybackResult {
    const sprite = this.sprite!
    const failedCap = this.manifest.capabilities.find((c) => c.actionId === failedId)
    for (const candidateId of failedCap?.degradesTo ?? []) {
      const cap = this.manifest.capabilities.find((c) => c.actionId === candidateId)
      if (!cap) continue
      try {
        sprite.play(candidateId)
        return {
          played: true,
          actionId: candidateId,
          level: 'semantic',
          degradeReason: `${failedId} 运行时播放失败 → degradesTo ${candidateId}`,
        }
      } catch { /* 继续下一个候选 */ }
    }
    // 最终兜底：表情反馈（idle 状态下的 mood 变化总可见）
    try { sprite.setMood('happy') } catch { /* 彻底放弃 */ }
    return {
      played: false,
      actionId: requestedId,
      level: 'generic',
      degradeReason: `${failedId} 运行时播放失败且无 degradesTo 候选 → idle 表情`,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  setAnchor(anchor: AnchorName, position: StagePoint, opts?: { instant?: boolean }): void {
    const cur = this.anchorPoint(anchor)
    const sprite = this.sprite
    if (!cur || !sprite) return
    const dx = position.x - cur.x
    const dy = position.y - cur.y
    if (opts?.instant) sprite.setPosition(sprite.x + dx, sprite.y + dy)
    else sprite.walkTo(sprite.x + dx, sprite.y + dy)
  }

  anchorPoint(anchor: AnchorName): StagePoint | null {
    const b = this.sprite?.realBounds() ?? null
    return b ? anchorFromBounds(anchor, b) : null
  }

  destroy(): void {
    this.sprite?.destroy()
    this.sprite = null
  }
}

/**
 * 旧模型合成 manifest（契约 §3.3 的 legacy 侧实现）：旧模型没有 manifest.json 文件，
 * 由代码合成——engine=legacy-pixi、锚点用统一近似比例、能力表用 registry.legacyCapabilities()。
 * 未注册形象返回 null（调用方回退默认形象）。
 */
export function legacyManifest(avatarId: string): AvatarManifest | null {
  const def = avatarDef(avatarId)
  const url = MODEL_URLS[avatarId]
  // sprite-sequence 形态（jing/tao）有自己的 manifest.json，绝不走 legacy 合成
  if (!def || !url || def.engine === 'sprite-sequence') return null
  return parseAvatarManifest({
    avatarId: def.id,
    name: def.label,
    engine: 'legacy-pixi',
    version: '1.0.0',
    model3Url: url,
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
    capabilities: legacyCapabilities(),
  })
}
