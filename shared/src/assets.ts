/**
 * 角色资产包类型与校验（契约 §3.3：资产包必须携带 manifest/anchors/capabilities）
 * 统一锚点（契约 §3.3）：head / hand.left / hand.right / foot.left / foot.right / heart / shoulder / hug.chest / root
 */

/** 统一锚点名（9 个，不多不少） */
export const ANCHOR_NAMES = [
  'head',
  'hand.left',
  'hand.right',
  'foot.left',
  'foot.right',
  'heart',
  'shoulder',
  'hug.chest',
  'root',
] as const
export type AnchorName = (typeof ANCHOR_NAMES)[number]

/** 渲染引擎：Jing/Tao(V2.2 混合路线)走 hybrid(Live2D idle+序列帧动作)，V2.1 sprite-sequence 保留，旧四模型走 legacy-pixi，cubism5 保留给未来正式 Live2D 包 */
export const RENDER_ENGINES = ['cubism5', 'legacy-pixi', 'sprite-sequence', 'hybrid'] as const
export type RenderEngine = (typeof RENDER_ENGINES)[number]

/** hybrid 引擎的 Live2D 子资产配置（idle 用 Live2D，动作用序列帧） */
export interface HybridLive2DConfig {
  /** .model3.json 相对 manifest 所在目录的路径 */
  model: string
  /** idle 动作组名（Cubism motion group，通常为 'Idle'） */
  idleMotion: string
  /** true=动作也走 Live2D 原生 motion；false=动作用序列帧（当前阶段） */
  hasNativeActions: boolean
}

/** 纹理档位（契约要求 4096/2048/1024 三档） */
export const TEXTURE_TIERS = ['4096', '2048', '1024'] as const
export type TextureTier = (typeof TEXTURE_TIERS)[number]

/** 动作能力声明：角色包声明自己支持哪些 actionId 及其资源 */
export interface ActionCapability {
  actionId: string
  /**
   * 资源引用。sprite-sequence 包：动作帧序列首帧相对路径（兼容契约校验的"非空路径"）；
   * cubism5/legacy 包：motion3.json 相对路径。
   */
  motion: string
  /**
   * sprite-sequence 专用：动作帧序列（相对路径，按播放顺序 1..N，8fps）。
   * 声明了 frames 的能力按 QQ秀式序列帧播放；未声明按 motion 资源处理。
   */
  frames?: string[]
  /** 同语义动作降级候选（降级链第 2 级），如 heart 降级为 positive */
  degradesTo?: string[]
  /** 可选：动作建议表情 */
  expression?: string
}

/** 锚点坐标（模型归一化坐标，0~1，root 为基准） */
export interface AnchorPoint {
  x: number
  y: number
}

/** 角色包 manifest（运行时消费的唯一入口描述） */
export interface AvatarManifest {
  avatarId: string
  name: string
  engine: RenderEngine
  /** 角色包版本（如 jing@1.0.0 的 "1.0.0"），semver */
  version: string
  model3Url: string
  /** 必须覆盖全部 9 个统一锚点 */
  anchors: Record<AnchorName, AnchorPoint>
  /** 至少声明 idle 能力；未声明的 actionId 走降级链 */
  capabilities: ActionCapability[]
  textures?: Partial<Record<TextureTier, string>>
  thumbnailUrl?: string
  /** hybrid 引擎专用：Live2D 子资产配置（engine='hybrid' 时必填） */
  live2d?: HybridLive2DConfig
  /** 文件相对路径 → sha256（资产校验器使用） */
  files?: Record<string, string>
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const SEMVER_RE = /^\d+\.\d+\.\d+$/
const ACTION_ID_RE = /^[a-z][a-z0-9_-]*$/

import { SchemaError } from './errors.js'

export { SchemaError }

/** 校验动作能力声明 */
export function parseActionCapability(input: unknown): ActionCapability {
  if (!isRecord(input)) throw new SchemaError(['ActionCapability 必须是对象'])
  const issues: string[] = []
  if (typeof input.actionId !== 'string' || !ACTION_ID_RE.test(input.actionId)) {
    issues.push(`actionId 非法: ${JSON.stringify(input.actionId ?? null)}`)
  }
  if (typeof input.motion !== 'string' || input.motion.length === 0) {
    issues.push('motion 必须是非空路径')
  }
  if (input.frames !== undefined) {
    if (
      !Array.isArray(input.frames) ||
      input.frames.length === 0 ||
      !input.frames.every((f) => typeof f === 'string' && f.length > 0)
    ) {
      issues.push('frames 必须是非空字符串数组（sprite-sequence 帧序列）')
    }
  }
  if (input.degradesTo !== undefined) {
    if (
      !Array.isArray(input.degradesTo) ||
      !input.degradesTo.every((d) => typeof d === 'string' && ACTION_ID_RE.test(d))
    ) {
      issues.push('degradesTo 必须是合法 actionId 数组')
    }
  }
  if (input.expression !== undefined && (typeof input.expression !== 'string' || input.expression.length === 0)) {
    issues.push('expression 必须是非空字符串')
  }
  if (issues.length > 0) throw new SchemaError(issues)
  return {
    actionId: input.actionId as string,
    motion: input.motion as string,
    frames: input.frames as string[] | undefined,
    degradesTo: input.degradesTo as string[] | undefined,
    expression: input.expression as string | undefined,
  }
}

function isAnchorPoint(v: unknown): v is AnchorPoint {
  return (
    isRecord(v) &&
    typeof v.x === 'number' &&
    Number.isFinite(v.x) &&
    typeof v.y === 'number' &&
    Number.isFinite(v.y)
  )
}

/**
 * 校验角色包 manifest。
 * 硬规则：anchors 必须恰好覆盖 9 个统一锚点（缺一拒绝，未知名拒绝）。
 */
export function parseAvatarManifest(input: unknown): AvatarManifest {
  if (!isRecord(input)) throw new SchemaError(['AvatarManifest 必须是对象'])
  const issues: string[] = []

  if (typeof input.avatarId !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(input.avatarId)) {
    issues.push(`avatarId 非法: ${JSON.stringify(input.avatarId ?? null)}`)
  }
  if (typeof input.name !== 'string' || input.name.length === 0) issues.push('name 必须是非空字符串')
  if (typeof input.engine !== 'string' || !(RENDER_ENGINES as readonly string[]).includes(input.engine)) {
    issues.push(`engine 必须是 ${RENDER_ENGINES.join('/')}`)
  }
  if (typeof input.version !== 'string' || !SEMVER_RE.test(input.version)) {
    issues.push(`version 必须是 semver 三段式: ${JSON.stringify(input.version ?? null)}`)
  }
  if (typeof input.model3Url !== 'string' || input.model3Url.length === 0) issues.push('model3Url 必须是非空路径')

  if (!isRecord(input.anchors)) {
    issues.push('anchors 必须是对象')
  } else {
    const keys = Object.keys(input.anchors)
    for (const name of ANCHOR_NAMES) {
      if (!keys.includes(name)) issues.push(`缺少锚点: ${name}`)
    }
    for (const k of keys) {
      if (!(ANCHOR_NAMES as readonly string[]).includes(k)) issues.push(`未知锚点名: ${k}`)
      else if (!isAnchorPoint(input.anchors[k])) issues.push(`锚点 ${k} 必须是 {x:number, y:number}`)
    }
  }

  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    issues.push('capabilities 必须是非空数组（至少含 idle 能力）')
  } else {
    for (const cap of input.capabilities) {
      try {
        parseActionCapability(cap)
      } catch (e) {
        issues.push(`capabilities[${String((cap as Record<string, unknown>)?.actionId ?? '?')}]: ${(e as Error).message}`)
      }
    }
  }

  if (input.textures !== undefined) {
    if (!isRecord(input.textures)) {
      issues.push('textures 必须是对象')
    } else {
      for (const tier of Object.keys(input.textures)) {
        if (!(TEXTURE_TIERS as readonly string[]).includes(tier)) issues.push(`未知纹理档位: ${tier}`)
      }
    }
  }

  if (input.files !== undefined && !isRecord(input.files)) issues.push('files 必须是 {路径: sha256} 对象')

  // hybrid 引擎必须声明 live2d 配置
  if (input.engine === 'hybrid') {
    if (!isRecord(input.live2d)) {
      issues.push('engine=hybrid 时必须提供 live2d 配置对象')
    } else {
      if (typeof input.live2d.model !== 'string' || input.live2d.model.length === 0) {
        issues.push('live2d.model 必须是非空路径')
      }
      if (typeof input.live2d.idleMotion !== 'string' || input.live2d.idleMotion.length === 0) {
        issues.push('live2d.idleMotion 必须是非空字符串')
      }
      if (typeof input.live2d.hasNativeActions !== 'boolean') {
        issues.push('live2d.hasNativeActions 必须是 boolean')
      }
    }
  }

  if (issues.length > 0) throw new SchemaError(issues)

  return {
    avatarId: input.avatarId as string,
    name: input.name as string,
    engine: input.engine as RenderEngine,
    version: input.version as string,
    model3Url: input.model3Url as string,
    anchors: input.anchors as AvatarManifest['anchors'],
    capabilities: input.capabilities as ActionCapability[],
    textures: input.textures as AvatarManifest['textures'],
    thumbnailUrl: input.thumbnailUrl as string | undefined,
    live2d: input.live2d as HybridLive2DConfig | undefined,
    files: input.files as Record<string, string> | undefined,
  }
}
