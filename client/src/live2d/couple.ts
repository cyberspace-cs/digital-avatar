/**
 * V1.6.0 情侣衣橱：情侣装主题系统
 *
 * 三种机制共用一张主题表：
 *  A. 一键情侣装 —— 服务端权威结算（server/src/index.js COUPLE_THEMES 与本表镜像），
 *     双方按各自形象性别取对应槽位，style 必换，variant 仅对支持的模型生效。
 *  B. 情侣徽章 —— 纯客户端匹配（matchCoupleTheme），双方 style/outfit 命中同一主题即点亮。
 *  C. 成套款式 —— variant 槽引用 OUTFIT_VARIANTS 中的同图案情侣针织（gen-outfit-variants.mjs 生成）。
 */

export interface CoupleSlot {
  style: string
  variant?: string
}

export interface CoupleTheme {
  id: string
  label: string
  emoji: string
  desc: string
  /** chip 双色渐变（男主色 → 女主色） */
  swatch: [string, string]
  m: CoupleSlot
  f: CoupleSlot
}

export const COUPLE_THEMES: Record<string, CoupleTheme> = {
  seafog: {
    id: 'seafog', label: '海雾情侣', emoji: '🌊', desc: '同蓝系深浅呼应，像一起看过海',
    swatch: ['#4a6b9c', '#6cc3ff'],
    m: { style: 'navy' }, f: { style: 'ocean' },
  },
  duskcherry: {
    id: 'duskcherry', label: '暮樱情侣', emoji: '🌸', desc: '灰调衬粉，克制又温柔',
    swatch: ['#5c616e', '#f59ec4'],
    m: { style: 'charcoal' }, f: { style: 'sakura' },
  },
  wild: {
    id: 'wild', label: '旷野情侣', emoji: '🌲', desc: '军绿撞元气橙，露营感的互补色',
    swatch: ['#7d8f5a', '#ffb26b'],
    m: { style: 'olive' }, f: { style: 'sunset' },
  },
  midnight: {
    id: 'midnight', label: '暗夜情侣', emoji: '🌌', desc: '深夜蓝紫，属于两个人的夜',
    swatch: ['#4a6b9c', '#a78bfa'],
    m: { style: 'navy' }, f: { style: 'night' },
  },
  mono: {
    id: 'mono', label: '经典黑白', emoji: '🖤', desc: '永不出错的情侣款',
    swatch: ['#2b2b33', '#e8e8e8'],
    m: { style: 'mono' }, f: { style: 'mono' },
  },
  // ---- 成套款（C）：同图案情侣针织，仅 Chitose/Haru 有 variant 槽；其他形象自动退化为纯色主题 ----
  'seafog-plaid': {
    id: 'seafog-plaid', label: '海雾格纹', emoji: '🧵', desc: '同款海雾蓝格纹针织衫，一眼成套',
    swatch: ['#3f5f8f', '#8fd0f5'],
    m: { style: 'navy', variant: 'knit_sea' }, f: { style: 'ocean', variant: 'sailor_sea' },
  },
  duskheart: {
    id: 'duskheart', label: '暮樱爱心', emoji: '🩷', desc: '同款爱心图章，把心事穿在身上',
    swatch: ['#5c616e', '#f59ec4'],
    m: { style: 'charcoal', variant: 'knit_heart' }, f: { style: 'sakura', variant: 'sailor_heart' },
  },
}

/** 成套款主题 id（UI 上与纯色主题分组展示） */
export const OUTFIT_COUPLE_SETS = ['seafog-plaid', 'duskheart']

/** 情侣装行的展示顺序 */
export const COUPLE_THEME_ORDER = [
  'seafog', 'duskcherry', 'wild', 'midnight', 'mono', 'seafog-plaid', 'duskheart',
]

/**
 * 徽章匹配：双方 style/outfit 是否命中同一主题。
 * - 颜色主题：双方 style 都在该主题槽位色集合中（mono 要求双方都是 mono；同性别双子装天然命中）
 * - 成套款：双方 outfit 是该主题对应槽位的 variant（各按性别）
 * @returns 命中的主题，未命中返回 null
 */
export function matchCoupleTheme(
  myStyle: string,
  myOutfit: string,
  partnerStyle: string,
  partnerOutfit: string,
): CoupleTheme | null {
  for (const id of [...OUTFIT_COUPLE_SETS, ...COUPLE_THEME_ORDER]) {
    const t = COUPLE_THEMES[id]
    const styles = [t.m.style, t.f.style]
    const byStyle = styles.includes(myStyle) && styles.includes(partnerStyle)
    if (!byStyle) continue
    // 成套款还要求双方 variant 就位（退化为纯色时不点亮成套徽章，避免误导）
    if (OUTFIT_COUPLE_SETS.includes(id)) {
      const mineOk = !!t.m.variant && myOutfit === t.m.variant
      const partnerOk = !!t.f.variant && partnerOutfit === t.f.variant
      if (mineOk && partnerOk) return t
      continue
    }
    // 纯色主题：同色组合（如 双藏青双子装）也算命中
    return t
  }
  return null
}

/** 给定主题 + 形象性别，取出该侧槽位（服务端镜像逻辑，客户端用于乐观更新） */
export function slotFor(theme: CoupleTheme, gender: 'm' | 'f'): CoupleSlot {
  return gender === 'f' ? theme.f : theme.m
}
