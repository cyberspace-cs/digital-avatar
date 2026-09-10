/**
 * runtime/scene-coordinator.ts — 双模型舞台协调（V2.0 Task 4，契约 §3.1）
 *
 * 职责：把"我"和"TA"两个 AvatarRenderer 摆到正确的 home 位置，并把 V1.6.2 的
 * 构图规则（缺腿根治）统一收敛到 root 锚点：
 *   - 全身像：root（脚底）贴 Dock 上沿（dockClearance），模型中心不低于 45% 视口高
 *   - 半身像：胸像构图，截断边（root）压出屏幕底 10% 模型高
 * Task 6 的 choreography-runner 用 anchorPoint/setAnchor 做双人走位（approach→contact）。
 * 本模块不依赖 PIXI（布局是纯几何），renderer 端口传入即用。
 */
import type { AvatarManifest } from '@digital-avatar/shared'
import type { AvatarRenderer, LoadStageOptions } from './avatar-renderer'

export interface StageSpec {
  viewportW: number
  viewportH: number
  /** Dock 上沿预留高度（V1.2 互动 Dock 96px；桌宠模式可传更大值） */
  dockClearance?: number
}

export type StageSlot = 'me' | 'partner'

/**
 * home y（V1.6.2 规则的纯函数化，App.tsx 原内联实现移植）。
 * @param halfBody 是否半身像模型（chitose）
 * @param measuredH 模型渲染高度（px，AvatarSprite.model.height 实测值；未测量传 0）
 */
export function homeYFor(
  halfBody: boolean,
  measuredH: number,
  viewportH: number,
  dockClearance = 96,
): number {
  if (measuredH > 0) {
    if (halfBody) return viewportH - measuredH / 2 + measuredH * 0.1
    return Math.max(viewportH * 0.45, viewportH - dockClearance - measuredH / 2)
  }
  return viewportH * 0.45
}

/** 槽位 home x：me 32% / partner 68% 视口宽（双人同屏留出中央互动区） */
export function homeXFor(slot: StageSlot, viewportW: number): number {
  return viewportW * (slot === 'me' ? 0.32 : 0.68)
}

export class SceneCoordinator {
  private readonly spec: Required<StageSpec>

  constructor(spec: StageSpec) {
    this.spec = {
      viewportW: spec.viewportW,
      viewportH: spec.viewportH,
      dockClearance: spec.dockClearance ?? 96,
    }
  }

  /** 把模型加载到舞台（透传 manifest + 舞台参数给渲染器） */
  async loadStage(slot: StageSlot, renderer: AvatarRenderer, manifest: AvatarManifest, stage: LoadStageOptions) {
    void slot
    return renderer.load(manifest, stage)
  }

  /**
   * 摆位：root 锚点瞬时定位到槽位 home。
   * @param halfBody 来自 manifest 所对应模型的 AvatarDef.halfBody
   * @param measuredH 模型实测渲染高度（px）；0 = 未测量，走 45% 中心回退
   */
  place(slot: StageSlot, renderer: AvatarRenderer, halfBody: boolean, measuredH: number): void {
    // homeYFor 返回的是模型中心 y；setAnchor 的语义是"锚点落到该全局位置"，
    // 所以 root（脚底/截断边）落点 = 中心 y + h/2（全身= vh-dock，半身= vh+0.1h）
    const y = homeYFor(halfBody, measuredH, this.spec.viewportH, this.spec.dockClearance)
    renderer.setAnchor(
      'root',
      { x: homeXFor(slot, this.spec.viewportW), y: y + measuredH / 2 },
      { instant: true },
    )
  }
}
