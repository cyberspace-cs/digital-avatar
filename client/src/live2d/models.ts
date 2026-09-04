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
}

export const AVATAR_LIBRARY: AvatarDef[] = [
  { id: 'hiyori', label: 'Hiyori', tag: '元气少女', path: 'models/hiyori/Hiyori.model3.json' },
  { id: 'natori', label: 'Natori', tag: '沉稳御姐', path: 'models/natori/Natori.model3.json' },
  { id: 'haru', label: 'Haru', tag: '阳光少年', path: 'models/haru/Haru.model3.json' },
]

/** id → model3 完整 URL（带 base 前缀，生产部署在 /digital-avatar/ 子路径） */
export const MODEL_URLS: Record<string, string> = Object.fromEntries(
  AVATAR_LIBRARY.map((a) => [a.id, `${BASE}${a.path}`]),
)

export const AVATAR_LABELS: Record<string, string> = Object.fromEntries(
  AVATAR_LIBRARY.map((a) => [a.id, `${a.label} · ${a.tag}`]),
)

export const DEFAULT_AVATAR = 'hiyori'
