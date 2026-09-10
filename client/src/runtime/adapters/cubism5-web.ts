/**
 * runtime/adapters/cubism5-web.ts — Cubism5WebAdapter（V2.0 Task 5，契约 §3.1 双适配器之新侧）
 *
 * 面向 Jing/Tao（Cubism SDK for Web R5）。两条铁律：
 *   1. 不修改旧模型 adapter（legacy-pixi.ts 保持行为不变）；
 *   2. 正式资产到位前不伪造生产 MOC3——官方 runtime 经"注入 seam"接入：
 *      - Cubism5Runtime 接口 = 适配器需要的最小 runtime 能力面（createModel）；
 *      - 单测注入 FakeRuntime 验证编排（manifest 解析/降级链/锚点/销毁）；
 *      - loadCubism5CoreScript() 是官方 live2dcubismcore.min.js（R5 core）的标准加载钩子，
 *        正式资产到位后由 Framework glue（createModel 实现）补全，本文件不写假实现。
 *
 * 与 legacy 的差异：锚点来自 manifest.anchors（角色包真实声明，0~1 归一化），
 * 不再用 realBounds 目测比例近似。
 */
import type { AnchorName, AvatarManifest, TextureTier } from '@digital-avatar/shared'
import { parseAvatarManifest } from '@digital-avatar/shared'
import { resolveAction } from '../../actions/registry'
import type {
  AvatarHandle,
  AvatarRenderer,
  LoadStageOptions,
  PlaybackContext,
  PlaybackResult,
  StagePoint,
} from '../avatar-renderer'

/** 质量档位 → 纹理档（契约：4096/2048/1024 三档，perfeGovernor 档位直映射） */
export const TIER_TO_TEXTURE: Record<NonNullable<LoadStageOptions['tier']>, TextureTier> = {
  high: '4096',
  balanced: '2048',
  saver: '1024',
}

/** 官方 Cubism 5 core（live2dcubismcore.min.js）的部署位置（不随仓库分发，部署时放置） */
export const CUBISM5_CORE_URL = '/digital-avatar/live2d/cubism5/live2dcubismcore.min.js'

/** 加载官方 Cubism 5 Web core 脚本（幂等）。已加载或加载成功返回 true，部署缺失返回 false。 */
export function loadCubism5CoreScript(src: string = CUBISM5_CORE_URL): Promise<boolean> {
  const w = window as unknown as { Live2DCubismCore?: unknown }
  if (w.Live2DCubismCore) return Promise.resolve(true)
  return new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve(!!(window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore)
    s.onerror = () => resolve(false) // 未部署 = 静默走降级（event-only），绝不阻断页面
    document.head.appendChild(s)
  })
}

/** 适配器持有的运行时模型句柄（由官方 Framework glue 实现；单测注入替身） */
export interface Cubism5ModelRef {
  /** 模型当前 root 位置（全局像素）——setAnchor 位移计算用 */
  getPosition(): StagePoint
  /** 角色真实绘制范围（全局像素）；未就绪为 null */
  bounds(): { x: number; y: number; width: number; height: number } | null
  playMotion(motion: string, expression?: string): void
  setExpression(expression: string): void
  setPosition(x: number, y: number): void
  walkTo(x: number, y: number): void
  destroy(): void
}

/** 官方 runtime 的最小能力面（Framework glue 实现它，FakeRuntime 测试它） */
export interface Cubism5Runtime {
  createModel(
    container: unknown,
    manifest: AvatarManifest,
    opts: { scale: number; tier?: 'high' | 'balanced' | 'saver'; textureTier: TextureTier },
  ): Promise<Cubism5ModelRef>
}

/** manifest.anchors（0~1 归一化）× bounds → 全局锚点坐标 */
export function anchorFromManifest(
  anchor: AnchorName,
  b: { x: number; y: number; width: number; height: number },
  manifest: AvatarManifest,
): StagePoint {
  const a = manifest.anchors[anchor]
  return { x: b.x + a.x * b.width, y: b.y + a.y * b.height }
}

export class Cubism5WebAdapter implements AvatarRenderer {
  private runtime: Cubism5Runtime | null
  private modelRef: Cubism5ModelRef | null = null
  private manifest: AvatarManifest | null = null

  constructor(runtime: Cubism5Runtime) {
    this.runtime = runtime
  }

  /** 端口方法：加载已解析的 manifest */
  async load(manifest: AvatarManifest, stage: LoadStageOptions): Promise<AvatarHandle> {
    if (!this.runtime) throw new Error('adapter already destroyed')
    const textureTier = TIER_TO_TEXTURE[stage.tier ?? 'high']
    this.modelRef = await this.runtime.createModel(stage.container, manifest, {
      scale: stage.scale,
      tier: stage.tier,
      textureTier,
    })
    this.manifest = manifest
    return { manifest, engine: manifest.engine }
  }

  /** 契约核心接口：从 manifestUrl 拉取并解析 manifest.json 再加载（spec Task 5） */
  async loadFromUrl(manifestUrl: string, stage: LoadStageOptions): Promise<AvatarHandle> {
    const res = await fetch(manifestUrl)
    if (!res.ok) throw new Error(`manifest 拉取失败 ${res.status}: ${manifestUrl}`)
    const manifest = parseAvatarManifest(await res.json())
    return this.load(manifest, stage)
  }

  async play(actionId: string, context?: PlaybackContext): Promise<PlaybackResult> {
    const modelRef = this.modelRef
    const manifest = this.manifest
    const plan = resolveAction(manifest?.capabilities ?? null, actionId)

    // 五级：只保留事件（模型未加载/已销毁）
    if (!modelRef || !manifest || plan.level === 'event-only') {
      return { played: false, actionId, level: 'event-only', degradeReason: plan.degradeReason }
    }

    // 四级：中性待机 + 气泡（气泡由 App 层负责）
    if (plan.level === 'neutral-bubble') {
      return { played: false, actionId, level: 'neutral-bubble', degradeReason: plan.degradeReason }
    }

    // 三级：通用反应 = 表情变化
    if (plan.level === 'generic') {
      modelRef.setExpression(context?.mood ?? 'happy')
      return { played: true, actionId: 'idle', level: 'generic', degradeReason: plan.degradeReason }
    }

    // 一/二级：播放解析到的动作；失败走运行时降级（永不向上抛）
    try {
      // exact/semantic 必带 motion；异常缺失视为运行时故障走降级链
      if (!plan.motion) throw new Error(`plan 缺少 motion（${plan.actionId}/${plan.level}）`)
      modelRef.playMotion(plan.motion, plan.expression)
      return { played: true, actionId: plan.actionId, level: plan.level, degradeReason: plan.degradeReason }
    } catch (err) {
      return this.runtimeFallback(actionId, plan.actionId, err)
    }
  }

  /** 运行时降级：degradesTo 候选 → 表情兜底（与 LegacyPixiAdapter 同构） */
  private runtimeFallback(requestedId: string, failedId: string, err: unknown): PlaybackResult {
    const modelRef = this.modelRef!
    const failedCap = this.manifest!.capabilities.find((c) => c.actionId === failedId)
    for (const candidateId of failedCap?.degradesTo ?? []) {
      const cap = this.manifest!.capabilities.find((c) => c.actionId === candidateId)
      if (!cap) continue
      try {
        modelRef.playMotion(cap.motion, cap.expression)
        return {
          played: true,
          actionId: candidateId,
          level: 'semantic',
          degradeReason: `${failedId} 运行时播放失败 → degradesTo ${candidateId}`,
        }
      } catch { /* 继续下一个候选 */ }
    }
    try { modelRef.setExpression('happy') } catch { /* 彻底放弃 */ }
    return {
      played: false,
      actionId: requestedId,
      level: 'generic',
      degradeReason: `${failedId} 运行时播放失败且无 degradesTo 候选 → 表情兜底`,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  setAnchor(anchor: AnchorName, position: StagePoint, opts?: { instant?: boolean }): void {
    const cur = this.anchorPoint(anchor)
    const modelRef = this.modelRef
    if (!cur || !modelRef) return
    const dx = position.x - cur.x
    const dy = position.y - cur.y
    const pos = modelRef.getPosition()
    if (opts?.instant) modelRef.setPosition(pos.x + dx, pos.y + dy)
    else modelRef.walkTo(pos.x + dx, pos.y + dy)
  }

  anchorPoint(anchor: AnchorName): StagePoint | null {
    const b = this.modelRef?.bounds() ?? null
    if (!b || !this.manifest) return null
    return anchorFromManifest(anchor, b, this.manifest)
  }

  destroy(): void {
    this.modelRef?.destroy()
    this.modelRef = null
    this.manifest = null
    this.runtime = null
  }
}
