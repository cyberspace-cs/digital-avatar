/**
 * 形象库（V1.3.2 配置化重构）
 *
 * 模型资产放在 `client/public/models/<id>/` 下（标准 Cubism model3 目录结构），
 * 形象注册只需在下面 AVATAR_LIBRARY 加一行——形象切换按钮、初始随机分配、
 * 换装同步全部自动生效，无需再改 App.tsx。
 *
 * 添加新形象三步走：
 *   1. 把整个模型文件夹拷进 `public/models/<新id>/`（含 .model3.json）
 *   2. 在 AVATAR_LIBRARY 数组里加一条 { id, label, tag, dir }
 *   3. （可选）服务端 index.js 的 INITIAL_AVATARS 加入新 id，让初始随机也能抽到
 *
 * 注意：模型文件名以 dir 下实际的 *.model3.json 为准，path 用相对 models/ 的路径。
 */
const BASE = import.meta.env.BASE_URL

export interface AvatarDef {
  /** 形象 id（持久化在 users.avatar / localStorage，一旦发布不可更改） */
  id: string
  /** UI 显示名（保留英文原名） */
  label: string
  /** 中文气质标签（衣橱按钮副标题） */
  tag: string
  /** model3.json 相对 public/ 的路径 */
  path: string
  /** 性别（V1.5.0）：衣橱色板按此过滤（男模显示男色板，女模显示女色板） */
  gender: 'm' | 'f'
}

export const AVATAR_LIBRARY: AvatarDef[] = [
  // 两女：Hiyori 元气少女 / Haru 文静少女（atlas 取证：连裤袜+芭蕾鞋+女性手势）
  { id: 'hiyori', label: 'Hiyori', tag: '元气少女', path: 'models/hiyori/Hiyori.model3.json', gender: 'f' },
  { id: 'haru', label: 'Haru', tag: '文静少女', path: 'models/haru/Haru.model3.json', gender: 'f' },
  // 两男：Natori 西装青年 / Chitose 温柔青年（官方 "male model"，棕发衬衫马甲；
  // V1.5.0 Mark 移除：卡通小孩形象 + 条款禁止改绘成美男，服务端已迁移 mark → chitose）
  { id: 'natori', label: 'Natori', tag: '西装青年', path: 'models/natori/Natori.model3.json', gender: 'm' },
  { id: 'chitose', label: 'Chitose', tag: '温柔青年', path: 'models/chitose/chitose.model3.json', gender: 'm' },
]

/** id → 性别（未知形象按女处理，仅影响色板过滤） */
export const AVATAR_GENDER: Record<string, 'm' | 'f'> = Object.fromEntries(
  AVATAR_LIBRARY.map((a) => [a.id, a.gender]),
)

/** id → model3 完整 URL（带 base 前缀，生产部署在 /digital-avatar/ 子路径） */
export const MODEL_URLS: Record<string, string> = Object.fromEntries(
  AVATAR_LIBRARY.map((a) => [a.id, `${BASE}${a.path}`]),
)

export const AVATAR_LABELS: Record<string, string> = Object.fromEntries(
  AVATAR_LIBRARY.map((a) => [a.id, `${a.label} · ${a.tag}`]),
)

export const DEFAULT_AVATAR = 'hiyori'
