/**
 * actions/registry.ts — 动作注册表与降级链（V2.0 Task 3）
 *
 * 契约 §6 动作降级链（必须实现，禁止 TapBody 下标取模）：
 *   1 精确动作（actionId 匹配且角色有该 motion）
 *   → 2 同语义动作（如 heart 降级为通用 positive 反应）
 *     → 3 通用反应（idle + 表情变化）
 *       → 4 中性待机 + 文字气泡
 *         → 5 只保留事件（不播放动画）
 *
 * 本模块是纯函数层：不碰 PIXI、不发网络请求。
 * 渲染器如何执行 ActionPlan（LegacyPixiAdapter / Cubism5WebAdapter）是 Task 4/5 的事。
 */
import type { ActionCapability } from '@digital-avatar/shared'

/** 降级链五级（levelIndex 供测试/日志断言） */
export const DEGRADE_LEVELS = ['exact', 'semantic', 'generic', 'neutral-bubble', 'event-only'] as const
export type DegradeLevel = (typeof DEGRADE_LEVELS)[number]

/** 动作执行计划：resolveAction 的产物，渲染器只看这个 */
export interface ActionPlan {
  /** 最终要执行的 actionId（exact/semantic 时是可播放动作；generic 时为 'idle'） */
  actionId: string
  level: DegradeLevel
  levelIndex: 1 | 2 | 3 | 4 | 5
  /** exact/semantic 时的 motion 资源引用（来自能力声明） */
  motion?: string
  /** 建议表情（能力声明可选提供） */
  expression?: string
  /** neutral-bubble 级别的气泡文案 */
  bubble?: string
  /** 降级原因（日志/调试） */
  degradeReason?: string
}

const LEVEL_INDEX: Record<DegradeLevel, 1 | 2 | 3 | 4 | 5> = {
  exact: 1,
  semantic: 2,
  generic: 3,
  'neutral-bubble': 4,
  'event-only': 5,
}

/**
 * 语义降级候选表：actionId → 候选链（能力声明未提供 degradesTo 时使用）。
 * 'positive'/'affection'/'playful' 是抽象反应动作，由角色包能力声明决定是否真的存在；
 * 链尾放具体动作（wave/poke）兜底。
 */
export const ACTION_SEMANTICS: Record<string, string[]> = {
  heart: ['positive', 'wave'],
  flower: ['positive', 'wave'],
  feed: ['positive', 'wave'],
  hug: ['affection', 'pat', 'poke'],
  pat: ['affection', 'poke'],
  pinch: ['playful', 'poke'],
  poke: ['wave'],
  kiss: ['affection', 'heart', 'wave'],
  wave: ['positive'],
}

/** 动作显示名（时间线/菜单/气泡兜底） */
export const ACTION_LABELS: Record<string, string> = {
  poke: '戳一下',
  pat: '摸摸头',
  hug: '抱抱',
  heart: '比心',
  wave: '挥手',
  pinch: '捏脸',
  feed: '喂食',
  flower: '送花',
  kiss: '亲亲',
  flick: '弹脑门',
  // V2.0 Task 6：双人编排动作（走位 + 双人动作，非单人互动）
  handhold: '牵手',
  'shoulder-lean': '靠肩',
  idle: '待机',
  positive: '开心反应',
  affection: '亲密反应',
  playful: '调皮反应',
}

/** 动作气泡文案（动作播不出来时也必有可见反馈） */
export const ACTION_BUBBLES: Record<string, string> = {
  poke: '戳戳你 👉',
  pat: '摸摸头～',
  hug: '抱抱！🤗',
  heart: '比心 ❤️',
  wave: '嗨嗨～ 👋',
  pinch: '捏捏脸',
  feed: '请你吃蛋糕 🧁',
  flower: '送你花 💐',
  kiss: '么么哒 😚',
  handhold: '牵住你的手 🤝',
  'shoulder-lean': '靠靠你 🫂',
}

/** 互动菜单（Dock/长按菜单共用顺序） */
export const MENU_ACTIONS = ['poke', 'pat', 'hug', 'heart', 'wave', 'pinch', 'feed', 'flower'] as const

export function actionLabel(actionId: string): string {
  return ACTION_LABELS[actionId] ?? actionId
}

export function actionBubble(actionId: string): string {
  return ACTION_BUBBLES[actionId] ?? `${actionLabel(actionId)} ✨`
}

/**
 * 旧模型（Hiyori/Haru/Natori/Chitose）的合成能力表。
 * 官方免费模型只有 Idle / TapBody 两组 motion，可真实映射的动作为 7 个；
 * feed/flower 没有独立动作 → 不进能力表，由语义链降级为 wave（与 V1.2 行为一致）。
 * Task 4 的 LegacyPixiAdapter 接管后，motion 字段由适配器解析为 group#index。
 */
export function legacyCapabilities(): ActionCapability[] {
  const REAL_ACTIONS = ['poke', 'pat', 'pinch', 'wave', 'heart', 'hug', 'flick']
  return [
    ...REAL_ACTIONS.map((actionId) => ({ actionId, motion: 'TapBody' })),
    { actionId: 'idle', motion: 'Idle' },
  ]
}

const isIdle = (caps: ActionCapability[]) => caps.some((c) => c.actionId === 'idle')

/**
 * 解析动作执行计划（降级链入口）。
 * @param capabilities 角色能力声明；null 表示"没有模型/渲染不可用"（直接 event-only），
 *                     空数组表示"模型在但无能力声明"（neutral-bubble）
 */
export function resolveAction(capabilities: ActionCapability[] | null, actionId: string): ActionPlan {
  const cap = capabilities?.find((c) => c.actionId === actionId) ?? null

  // 1) 精确动作
  if (cap) {
    return {
      actionId,
      level: 'exact',
      levelIndex: LEVEL_INDEX.exact,
      motion: cap.motion,
      expression: cap.expression,
    }
  }

  // 2) 同语义动作：按内置语义表找第一个角色真实具备的候选。
  //    （能力声明的 degradesTo 是运行时"动作播放失败"时的备用元数据，由渲染器消费，不参与解析期降级——
  //     声明了 heart 的角色在解析期必然 exact 命中，走不到这里）
  const candidates = ACTION_SEMANTICS[actionId] ?? []
  for (const candidateId of candidates) {
    const c = capabilities?.find((x) => x.actionId === candidateId)
    if (c) {
      return {
        actionId: candidateId,
        level: 'semantic',
        levelIndex: LEVEL_INDEX.semantic,
        motion: c.motion,
        expression: c.expression,
        degradeReason: `${actionId} → ${candidateId}（同语义降级）`,
      }
    }
  }

  // 3) 通用反应：有 idle 能力就播 idle + 表情变化
  if (capabilities && isIdle(capabilities)) {
    const idle = capabilities.find((c) => c.actionId === 'idle')!
    return {
      actionId: 'idle',
      level: 'generic',
      levelIndex: LEVEL_INDEX.generic,
      motion: idle.motion,
      degradeReason: `${actionId} 无精确/同语义动作 → 通用反应`,
    }
  }

  // 4) 中性待机 + 文字气泡：模型在但完全没有能力声明
  if (capabilities) {
    return {
      actionId,
      level: 'neutral-bubble',
      levelIndex: LEVEL_INDEX['neutral-bubble'],
      bubble: actionBubble(actionId),
      degradeReason: '无能力声明 → 中性待机 + 气泡',
    }
  }

  // 5) 只保留事件（不播放动画）
  return {
    actionId,
    level: 'event-only',
    levelIndex: LEVEL_INDEX['event-only'],
    degradeReason: '无模型/渲染不可用 → 只保留事件',
  }
}
