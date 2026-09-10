/**
 * live2d/perf-policy.ts — 帧率档位纯策略（V2.0 Task 8）
 *
 * 与 PIXI/DOM 解耦的纯函数部分，node/vitest 可直接测：
 * - high=60fps（桌面默认，DPR 上限 2x）
 * - balanced=30fps（移动端默认，1x 分辨率 + SD 纹理 LOD）
 * - saver=15fps（弱设备保底，双模型场景也能流畅待机）
 *
 * 依据（见 docs/ARCHITECTURE.md 渲染性能小节）：
 * pixi-live2d-display #50：渲染帧率 60→30 近似减半 GPU；30→15 再减半。
 * 多模型主要开销是 Draw Call，降帧按比例降低。
 */

export type QualityTier = 'high' | 'balanced' | 'saver'

export const TIER_FPS: Record<QualityTier, number> = { high: 60, balanced: 30, saver: 15 }
export const TIER_ORDER: QualityTier[] = ['high', 'balanced', 'saver']
/** 降档判定：实测均值 < 目标 × 0.75 视为带不动 */
export const DOWNGRADE_RATIO = 0.75
/** 采样窗口 4s，避开瞬时卡顿误判 */
export const WINDOW_MS = 4000

/** 是否应从当前档位降一档；已在 saver 则返回 null（无更低档） */
export function downgradeTier(avgFps: number, current: QualityTier): QualityTier | null {
  if (current === 'saver') return null
  if (avgFps < TIER_FPS[current] * DOWNGRADE_RATIO) {
    return current === 'high' ? 'balanced' : 'saver'
  }
  return null
}

/** 初始档位：URL ?perf= 强制 > localStorage 记忆 > 移动端 balanced > 桌面 high */
export function resolveStartTier(opts: {
  forced?: string | null
  saved?: string | null
  isMobile: boolean
}): QualityTier {
  if (opts.forced === 'high' || opts.forced === 'balanced' || opts.forced === 'saver') return opts.forced
  if (opts.saved === 'high' || opts.saved === 'balanced' || opts.saved === 'saver') return opts.saved
  return opts.isMobile ? 'balanced' : 'high'
}
