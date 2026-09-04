# V1.5.0 设计方案：男性形象升级（Chitose）+ 衣橱 2.0（换款式 × 换色）

> 文档版本：V1.0（2026-09-05 11:10）
> 前置调研：Live2D 官方样本模型条款逐个核实（见附录 A）
> 关联文档：[小火人化游戏化设计](./2026-09-04-xiaohuoren-gamification-design.md)、[ARCHITECTURE](../../ARCHITECTURE.md)

---

## 0. 一句话目标

把"阳光少年 Mark"换成官方帅气男模 **Chitose**，同时把换装系统从"只换颜色"升级为
**"款式 × 颜色"双轴衣橱**——男生女生各有性别化穿搭（男生：卫衣/休闲衬衫/正装，
女生：连衣裙/水手服/常服），肤色依旧零改动，双端依旧实时同步。

---

## 1. 背景与问题

| # | 问题 | 现状 |
|---|---|---|
| P1 | Mark 形象偏卡通小孩，用户评价"太傻" | 官方条款还明文禁止"改绘成美男"，无法救 |
| P2 | 换装只有换色（V1.4.2 纹理重染），"版型"永远是同一件衣服 | 用户期待"穿搭不一样"的性别化换装 |
| P3 | 男女模型共用同一套色板语义 | 女生色板（樱花粉）套在男模上违和 |
| P4 | 授权雷区未排查：Hiyori/Natori 条款限制设计变更 | 详见 §3 合规决策 |

---

## 2. 方案对比（为什么选 C）

### 方案 A：仅替换模型（Chitose 进，Mark 出），换装维持换色
- 工作量最小（1 天级），但"穿搭不一样"的诉求只解决一半。

### 方案 B：全部模型做 AI 服装重绘
- 效果上限最高，但 Hiyori/Natori 直接违反条款；且每模型 3 套 × 4 模型 = 12 套
  atlas 重绘 + 校准，工期和校准风险爆炸。

### 方案 C（推荐）：分模型分级换装
1. **Mark → Chitose**（两男两女：Chitose + Natori / Hiyori + Haru）
2. **换款式只在授权安全模型上做**：Chitose、Haru 各 2 套变体（原生 + 2 新款）
3. **换色（现管线）继续全员可用**，男模新增男色板（军绿/藏青/炭灰）
4. Hiyori/Natori 的合规问题单独决策（§3）

工作量可控（款式资源只做 2 模型 × 2 套），合规清晰，效果质变。

---

## 3. 合规决策（需要用户拍板，但不阻塞开发）

条款核实结论（附录 A）：

| 模型 | 个体条款 | 换色 | 换款 |
|---|---|---|---|
| Chitose / Haru | 无 | ✅ | ✅ |
| Mark | 禁止改绘美男 | ⚠️ 勉强 | ❌ |
| Hiyori | "设计的一切变更不允许" | ⚠️ 严格讲踩线 | ❌ |
| Natori | 合作角色：禁改动+禁商用 | ⚠️ 踩线 | ❌ |

**决策项 D1（Hiyori/Natori 已上线的换色怎么办）：**
- 选项 1（推荐）：**保留现状**。项目为个人非商用、小规模，风险极低；UI 上加一行
  版权声明（条款本来就要求显示 "This content uses sample data owned by Live2D Inc."）。
- 选项 2：回退这两模型的换色按钮，只留"原生"。

**决策项 D2（版权声明）：** 无论选哪个，本次版本在 About/页脚加 Live2D 版权声明（合规成本≈0）。

---

## 4. 详细设计

### 4.1 形象库变更（models.ts + 服务端）

```ts
export const AVATAR_LIBRARY: AvatarDef[] = [
  { id: 'hiyori',  label: 'Hiyori',  tag: '元气少女', path: 'models/hiyori/Hiyori.model3.json' },
  { id: 'haru',    label: 'Haru',    tag: '文静少女', path: 'models/haru/Haru.model3.json' },
  { id: 'natori',  label: 'Natori',  tag: '西装青年', path: 'models/natori/Natori.model3.json' },
  // V1.5.0：Mark（卡通小孩 + 禁美男条款）→ Chitose（官方"male model"，棕发衬衫马甲青年）
  { id: 'chitose', label: 'Chitose', tag: '温柔青年', path: 'models/chitose/Chitose.model3.json' },
]
```

- 资产：官方 sample 页下载 Chitose runtime 文件（.moc3/model3.json/贴图/动作/物理/
  pose/exp/cdi）→ `client/public/models/chitose/`；按既有约定转 WebP（PNG 兜底）+
  `.sd.png` LOD 半图（prefetch.worker 现有逻辑自动生效）。
- 服务端 `index.js`：`INITIAL_AVATARS` 加 `chitose` 删 `mark`。
- **迁移（幂等）**：`UPDATE users SET avatar='chitose' WHERE avatar='mark'`（db.js 启动时执行）；
  客户端 `MODEL_URLS[avatar]` 查不到时兜底 `DEFAULT_AVATAR`（防 localStorage 残留 'mark'）。
- 动作映射：Chitose 自带基础动作（挥手等）；pat/hug/feed/flower 在 avatar.ts 动作表
  里按现有 fallback 规则挂接（缺动作回退 idle，触摸优先 ParamAngleX/Y 摇摆）。

### 4.2 衣橱 2.0 数据模型（outfit.ts 扩展）

**双轴：款式（variant，整纹理替换）× 颜色（style，现有重染）。**

```ts
/** 款式定义：textures 里没列的纹理文件沿用原生 */
export interface OutfitVariant {
  id: string            // 'base' = 原生
  label: string         // UI：'连帽卫衣'
  swatch: string        // UI 小图
  gender: 'm' | 'f'
  textures: Record<string, string>  // { 'texture_01.png': 'outfits/hoodie/texture_01.png' }
}

export const OUTFIT_VARIANTS: Record<string, OutfitVariant[]> = {
  chitose: [
    { id: 'base',    label: '原生马甲', swatch: '#d9c9a8', gender: 'm', textures: {} },
    { id: 'hoodie',  label: '连帽卫衣', swatch: '#7f9c6a', gender: 'm', textures: { 'texture_01.png': 'outfits/hoodie/texture_01.webp' } },
    { id: 'casual',  label: '休闲衬衫', swatch: '#6f8fb5', gender: 'm', textures: { 'texture_01.png': 'outfits/casual/texture_01.webp' } },
  ],
  haru: [
    { id: 'base',    label: '原生西装裙', swatch: '#c9c9d6', gender: 'f', textures: {} },
    { id: 'sailor',  label: '水手服',     swatch: '#5b7ea6', gender: 'f', textures: { 'texture_01.png': 'outfits/sailor/texture_01.webp' } },
    { id: 'onedress',label: '连衣裙',     swatch: '#d98a9c', gender: 'f', textures: { 'texture_01.png': 'outfits/onedress/texture_01.webp' } },
  ],
  // Hiyori/Natori：仅换色（无 variants 条目 → UI 不显示款式行）
}
```

- 男色板新增（OUTFIT_STYLES 追加，男模 UI 过滤）：`军绿 olive` / `藏青 navy` / `炭灰 charcoal`；
  女生保持现有 6 色。
- **重染矩形按变体区分**：`OUTFIT_PROTECT` / `OUTFIT_ALLOW` / `SKIN_RULE` 的 key 从
  `avatarId` 扩展为 `avatarId + '|' + variantId`（新变体的服装区域和原生不同，保护矩形
  必须重标定；肤色阈值沿用模型级）。

### 4.3 运行时管线（零侵入，复用 blobMap 机制）

加载顺序（关键：**变体 + 颜色都在模型加载前生效，单次加载不开双份**）：

```
prefetch.worker（原生 blobMap）
  → applyOutfitVariant(blobMap, avatarId, variantId)   // 新函数：变体纹理条目原位替换
      - 变体资产 URL：models/<id>/outfits/<variant>/<tex>（WebP→PNG 兜底，.sd 半图逻辑同款）
      - 缓存 Map<'avatar|variant|tex', blobURL>，销毁时 revoke（与 recolorCache 同策略）
  → recolorOutfitTextures(blobMap, avatarId, styleId, variantId)  // 现有函数加 variantId 参数
  → Live2DFactory jsonToSettings → 纹理加载全部走 blobMap
```

- `AvatarSprite` API：`applyStyle(styleId)` → 扩展为 `setOutfit({ variant, style })`；
  切款式=重新走一遍加载管线（复用现有 swap 通道，"换装中…" toast 已有）。
- 变体纹理校验：`content-type` 必须 `image/*`（V1.4.3 的 SPA-fallback 教训直接继承）。

### 4.4 持久化与双端同步

- DB 迁移（幂等，V1.3 style 列同款写法）：`ALTER TABLE users ADD COLUMN outfit TEXT DEFAULT 'base';`
- `q.updateUserOutfit` 新增；`/api/look` 接受 `{ style, outfit }`。
- `state_update` 事件带 `{ userId, style, outfit }`；`swapPartnerLook` 先记 outfit/style
  再单次加载（继承 V1.4.2 的防双开逻辑）。
- localStorage：`da_outfit`；刷新后 `loadOutfit(avatar)` 恢复。

### 4.5 UI（衣橱面板）

- 款式行：`model.ts` 有 variants 的模型显示（图标 + 中文名 chip，点选即换）；
  无 variants 的模型隐藏整行（Hiyori/Natori 界面不变）。
- 颜色行：按模型性别过滤色板（男模只显示男色板 + 原生）。
- 形象库按钮 `AVATAR_EMOJI` 加 `chitose: '🧥'`。
- 样式沿用 `.style-chip`，款 chip 与色 chip 视觉区分（款=描边图标，色=色块）。

### 4.6 变体纹理资产生产（本方案唯一的新增资源工序）

- 生产方式：以原生 atlas 为底，AI 图像编辑（inpainting）只重绘服装区域，其余像素
  强制保持原值；生成后跑**像素 diff 校验脚本**（scripts/verify-outfit-atlas.mjs）：
  服装矩形外 diff 像素数必须为 0，肤色像素（isSkin 规则）diff 必须为 0 → 不合格不出库。
- 命名：`client/public/models/<id>/outfits/<variant>/texture_NN.webp`（+ .png 兜底 + .sd 半图）。
- 每模型先做 1 套新变体（MVP），验收通过后再补第 2 套。

---

## 5. 分期实施

| 阶段 | 内容 | 交付物 |
|---|---|---|
| **A（本版核心）** | Chitose 资产接入 + Mark 移除与迁移 + 动作映射 + 版权声明 + 男色板 | 形象库两男两女可用 |
| **B** | variant 管线（blobMap 替换 + 缓存 + setOutfit API + UI 款式行） | Chitose/Haru 各 1 套新变体可换 |
| **C** | 第二套变体 + atlas 校验脚本 + E2E（verify-v150.cjs）+ 部署 | 全量验收 |

E2E 覆盖（继承 verify-v143.cjs 的 incognito/evaluate 教训）：Chitose 加载无纹理错误、
mark 用户登录后 avatar 迁移为 chitose、款式切换双端同步、款式×颜色组合无花斑、
dist 备份回滚演练。

## 6. 验收项（M 系列）

- [ ] M1 形象库显示 Chitose·温柔青年，Mark 不再出现；旧 mark 用户自动迁移
- [ ] M2 Chitose 互动（摸头/喂食/送花/抱抱）有动作有回应（与 V1.4.3 同标准）
- [ ] M3 款式切换：Chitose 卫衣 ↔ 马甲， Haru 水手服 ↔ 西装裙，加载单次无闪烁
- [ ] M4 款式×颜色组合（至少 4 组）截图校验：服装变色正确、脸/发/手/肤色零改动
- [ ] M5 桌宠模式下换装/换款同样生效
- [ ] M6 双端同步：A 换款式，B 端 1s 内跟随（含刷新后）
- [ ] M7 页脚出现 Live2D 版权声明
- [ ] M8 移动端真机：款式 chips 触控正常、无横向溢出

---

## 附录 A：授权条款核查记录（2026-09-05，官方条款页实查）

- 条款页：live2d.com/eula/live2d-sample-model-terms_en.html（韩文页交叉验证）
- 原创角色（小规模商用免费）：Chitose、Epsilon、Koharu&Haruto、Haru、Ren Foster、Mark-kun…
  - Mark-kun："不可改绘成美男或戏剧化画风"（→ 移除依据）
  - Miara / Momose Hiyori（含视频版）："设计的一切变更不允许"（→ Hiyori 换色风险）
- 合作角色（禁商用+禁改动）：**Jin Natori**（"不能无视管家身份使用"）、春笠酸欠
  （→ Natori 换色风险，且理论上禁商用）
- Ren Foster：Cubism 5.3 专属特性（blend mode/offscreen），当前技术栈
  pixi-live2d-display 0.4.0 + Cubism 4 core 不兼容 → 排除
- Koharu & Haruto：SD 幼态，不符"帅气男模"诉求 → 排除
- Epsilon：Cubism 4.0、无附加条款，白发清冷系 → **备选**（若用户不喜欢 Chitose 气质）
