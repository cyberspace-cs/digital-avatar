# V1.6.0 情侣衣橱（情侣装配对系统）设计文档

> 2026-09-05 · 用户需求："每个形象穿搭都无法完全对上男女主" → 情侣装机制。用户拍板：A（一键情侣主题）+ B（同主题徽章）+ C（真·成套款式）全要，做细。

## 0. 背景与约束

- 现有系统：颜色轴 `OUTFIT_STYLES`（选择性重上色，男板 olive/navy/charcoal，女板 sakura/ocean/sunset/night，通用 mono）+ 款式轴 `OUTFIT_VARIANTS`（整纹理替换，仅 Chitose knit / Haru sailor）+ 服务端 users.style/outfit 持久化与双端同步。
- 授权红线：Hiyori/Natori 禁改款式 → 情侣机制对这两者只能走颜色轴；成套款式（C）只做 Chitose×Haru。
- 工程红线（V1.4.3 教训）：服务端权威结算；REST 幂等；socket 强制 polling 已定；self-echo 只记 timeline 不回放。

## 1. 主题数据模型（client/src/live2d/couple.ts，服务端镜像一份槽位表）

```ts
interface CoupleTheme {
  id: string
  label: string
  emoji: string
  desc: string
  swatch: string          // chip 渐变主色
  m: { style: string; variant?: string }   // 男主槽（style 必填，variant 可选）
  f: { style: string; variant?: string }   // 女主槽
  hues: number[]          // 徽章匹配用色相集（该主题涉及的全部 style 的 hue）
  unlock?: string         // 解除主题的哨兵见 §4
}
```

| id | label | m.style | f.style | 氛围 |
| --- | --- | --- | --- | --- |
| seafog | 海雾情侣 | navy(222) | ocean(208) | 同蓝系深浅呼应 |
| duskcherry | 暮樱情侣 | charcoal(220) | sakura(335) | 灰调衬粉 |
| wild | 旷野情侣 | olive(95) | sunset(22) | 互补撞色 |
| midnight | 暗夜情侣 | navy(222) | night(268) | 深夜蓝紫 |
| mono | 经典黑白 | mono | mono | 永不出错 |

成套款（C，仅 Chitose/Haru 有 variant 槽）：`seafog-plaid`（海雾格纹：m.variant=knit_sea × f.variant=sailor_sea）、`duskheart`（暮樱爱心：m.variant=knit_heart × f.variant=sailor_heart）。成套款在 UI 上是独立 chip，应用时 = 颜色主题结算 + 双方 variant 下发。

## 2. 机制 A：一键情侣装

### 流程
1. 衣橱「我的」tab，partner 存在时显示「情侣装」行：5 主题 chip + 2 成套款 chip + 「解除」chip。
2. 点主题 → 本地乐观更新自己槽位（applyStyleLocal/applyVariantLocal 复用）→ `POST /api/couple-outfit { userId, themeId }`。
3. 服务端权威结算：校验 bond 存在 → 对双方按 `AVATAR_GENDER[avatar]` 取对应槽位（m/f；同性别组合都用 m 槽 = 双子装）→ variant 仅当该 avatar 在 OUTFIT_VARIANTS 服务端镜像表中存在时下发 → 更新双方 users.style/outfit → 向两端 emit `couple_applied { themeId, by, members: [{ userId, avatar, style, outfit }] }`（房间广播，含发起者）。
4. 客户端收到 `couple_applied`：若 member 是自己 → 应用 style/variant（与本地已应用值相同则跳过）；只记 timeline，**不回发**（服务端已结算，防回声）。
5. 掉线兜底：socket 断开时 REST 结果即权威（发起方直接 200）；接收方上线时 `getState` 自然对齐，无需额外通道。

### 服务端协议（server/src/index.js）
- `POST /api/couple-outfit`：body `{ userId, themeId }`；响应 `{ ok, theme, members: [{userId, style, outfit}] }`。无 bond → 400；未知 themeId → 400。
- 服务端镜像常量：`AVATAR_GENDER`（hiyori:f haru:f natori:m chitose:m）、`COUPLE_THEMES`（§1 槽位表，variant 名单 `knit_sea/sailor_sea/knit_heart/sailor_heart`）。
- `GET /api/couple-theme/:userId`：返回 `{ themeId | null }` —— 接收方上线/刷新时用于衣橱高亮（按双方 style 匹配推导即可，见 §3，故此接口可选，本期不实现，YAGNI）。

## 3. 机制 B：情侣徽章

- 纯客户端计算，服务端零新列：`matchCoupleTheme(myStyle, myOutfit, partnerStyle, partnerOutfit)`：
  - 颜色主题：双方 style 同属某主题的槽位色集合（无序；mono 主题要求双方都 mono）→ 命中。
  - 成套款：双方 outfit 为同一成套主题的对应 variant → 命中。
- 展示：火花卡 + 记录 tab 头部「✨ 海雾情侣」徽章 chip；点亮瞬间双方头顶各冒一次小心心（复用 hearts 粒子）。
- 解除：双方回 default/base，徽章自动熄灭（匹配不到即熄灭）。

## 4. 机制 C：真·成套款式（像素工程）

`scripts/gen-outfit-variants.mjs` 扩展 2 套 JOBS（程序化生成 + 像素 diff 校验，替换区外零改动）：

| 变体 | 基底 | transform | pattern |
| --- | --- | --- | --- |
| chitose/knit_sea | chitose texture_00（knit 矩形组） | 服装区 → 海雾蓝针织（hue≈208，保线稿 v<0.12），领带 → 藏青 | 白色细格纹（间距 48px，alpha 0.14，仅服装矩形内） |
| haru/sailor_sea | haru texture_01（sailor 矩形组） | 服装区 → 海雾蓝 + 白条纹保留 | 同款白格纹叠加 |
| chitose/knit_heart | 同上矩形组 | 炭灰针织（hue 220 sat 0.22），领带 → 樱粉 | 樱粉爱心图章（心形 path，36px 周期，仅在针织矩形内） |
| haru/sailor_heart | haru texture_01 | 樱粉水手服（hue 335）+ 白条纹 | 白色爱心图章同周期 |

校验：替换区外像素逐一 diff = 0；生成物注册进 `OUTFIT_VARIANTS.chitose/haru`（swatch 主题色）。衣橱普通款式行也会出现这 4 个变体（个人单穿同样允许）。

## 5. UI 细节（App.tsx / styles.css）

- 「情侣装」行位于款式行与色板行之间，`partner` 存在才渲染；chip = 双色渐变圆点 + emoji + label，当前生效主题高亮（双方 style/outfit 命中即高亮，无需服务端状态）。
- 应用手感：toast「已换上海雾情侣 🌊，对方上线也会同步」；接收端 toast「TA 给你换上了海雾情侣 🌊」。
- 徽章：`coupleBadge` state（getPartner/getState/couple_applied 后重算）。

## 6. 验证计划（verify-v160.cjs + probe-couple.cjs）

T1 主题行显示（有/无 partner）· T2 一键海雾双端 state+像素断言 · T3 接收端免操作自动应用 · T4 徽章点亮/解除熄灭 · T5 成套款双端同步（variant 断言）· T6 同性别组合取 m 槽 · T7 socket 断开 REST 兜底幂等 · P 像素探针（色相分桶，双人双端）。

完成后上网调研同类系统（实时协同状态同步/虚拟形象换装同步/Socket.IO 一致性测试）的测试做法，有证据地补充测试面，再 loop 一轮。

## 7. 交付

CHANGELOG/ACCEPTANCE（docs/versions 时间戳归档）→ 提交双远端（Gitee+GitHub 同 hash）→ 生产部署（tar dist + deploy-dist.sh 备份滚动；服务端 scp index.js 重启 davatar）→ 线上 curl + 探针复验。
