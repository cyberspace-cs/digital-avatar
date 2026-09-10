# Jing/Tao 数字分身产品需求文档（PRD）

> 状态：草案，待确认
> 日期：2026-09-09
> 上级契约：`docs/superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md`
> 实施计划：`docs/superpowers/plans/2026-09-09-jing-tao-digital-avatar.md`

## 1. 产品概述

### 1.1 产品定位

Jing/Tao 数字分身是一款基于 Web/PWA 的双人虚拟陪伴应用。用户可以与两个 Q 版角色（女主 Jing、男主 Tao）进行互动、共同创造回忆，关系价值由共同经历表达，不量化为等级或积分。

### 1.2 核心价值

- **陪伴感**：角色常驻舞台，自然待机，轻触互动，短句气泡
- **共同经历**：双人互动产生 SharedMoment，沉淀为可回看的回忆
- **身份一致**：Jing/Tao 造型、动作、气质严格锁定，跨平台复用
- **轻量化**：PWA 即开即用，离线可用，弱网可回放

### 1.3 第一阶段平台

- Web/PWA（唯一交付平台）
- 事件协议、角色资产包、动作语义、双人编排必须可复用于未来 Windows/macOS/Android/iOS

## 2. 用户场景

| 场景 | 描述 |
|------|------|
| 日常陪伴 | 打开应用，Jing/Tao 在舞台待机，轻触触发动作和气泡 |
| 双人互动 | 两端用户同时在线，发起拥抱/牵手等双人动作 |
| 回忆回看 | 浏览共同经历时间线，回放第一次互动、第一次拥抱 |
| 离线留言 | 对方不在线时，互动事件保存，上线后显示"TA 来过" |
| 换装搭配 | 切换角色服装部件（当前阶段为设计参考，后续接入衣橱） |

## 3. 信息架构

### 3.1 一级页面

```
├── 陪伴（Companion）
├── 回忆（Memories）
└── 我的（Profile）
```

### 3.2 陪伴页

- Jing/Tao 常驻舞台
- 自然待机动画（呼吸、眨眼、轻微头部摆动）
- 轻触/长按触发动作和短句气泡
- 状态表达（开心、害羞、思考等）
- 双人共同场景（同时在线时）

### 3.3 回忆页

- 互动时间线（按时间倒序）
- SharedMoment 卡片（双人动作记录）
- 里程碑标记：第一次互动、第一次拥抱、自定义纪念日
- 搜索 / 筛选 / 删除 / 回放
- 离线事件默认不强制播放，显示"TA 来过"，由用户选择回放

### 3.4 我的页

- 身份和关系信息
- 状态可见性设置
- 角色包和衣橱（换装）
- 授权管理
- 解绑 / 数据删除
- 通知和存在感设置

## 4. 角色系统

### 4.1 Jing（女主）

- **造型**：中分深色长发、大眼和淡腮红、白色无袖针织上衣、灰色百褶裙、白色堆堆袜、白色运动鞋
- **气质**：温柔、清新、略带俏皮
- **头身比**：2.5～3 头身 Q 版
- **动作风格**：自然大方，挥手活泼，比心用双手

### 4.2 Tao（男主）

- **造型**：黑色蓬松短发、白色短袖衬衫、深色条纹领带、黑色长裤、白色运动鞋
- **气质**：温柔、可靠、略腼腆
- **头身比**：2.5～3 头身 Q 版
- **动作风格**：克制自然，挥手肩部高度轻挥，比心优先单手 finger-heart

### 4.3 换装系统（设计参考阶段）

当前阶段生成部件素材作为设计参考，后续接入衣橱功能：

**Jing 部件：**
- 发型：乌黑长直发
- 上衣：白色绞花针织 Polo
- 下装：灰色百褶短裙

**Tao 部件：**
- 发型：黑色短碎发
- 上衣：白色短袖衬衫
- 领带：藏青白条纹
- 下装：黑色直筒西裤
- 外套：深酒黑休闲西装（可选）

## 5. 动作系统

### 5.1 动作语义

动作通过 `actionId` 标识，不绑定 TapBody 下标。未知动作按语义降级：
精确动作 → 同语义动作 → 通用反应 → 中性待机+气泡 → 只保留事件

### 5.2 当前阶段动作

| 动作 | actionId | Jing | Tao | 帧数 |
|------|----------|------|-----|------|
| 挥手 | `wave` | 右手肩侧挥手 | 肩部高度轻挥，略微前倾 | 5 |
| 比心 | `heart` | 双手胸前比心 | 单手 finger-heart，另一手扶领带 | 5 |

### 5.3 规划中动作

`tie_adjust`（整理领带）、`thumbsup`（点赞）、`shy_lookaway`（害羞转头）、`offer`（递东西）、`pat`（拍头）、`poke_react`（被戳反应）、`receive`（接收）、`hug_open`（张开怀抱）

### 5.4 动作节拍结构

每个动作 5 帧关键姿势：
1. 自然站立 / anticipation（待机起始）
2. 动作准备
3. 动作启动
4. 动作峰值 / 保持
5. 动作收尾 / 回到待机

## 6. 双人编排

### 6.1 动作状态

`requested → accepted → preparing → ready → playing → completed`
失败可为 `partial` 或 `failed`

### 6.2 阶段固定

`approach`（接近）→ `contact`（接触）→ `hold`（保持）→ `release`（释放）→ `return`（回位）

### 6.3 同步机制

- 服务端创建 `momentId`，广播 `moment.prepare`
- 包含 `choreographyId`、角色能力、`serverStartAt` 和锚点配置
- 两端返回 ready 后广播 start
- 客户端只同步开始时间、阶段标记和完成状态，**不逐帧同步 Cubism 参数**

### 6.4 统一锚点

`head`、`hand.left`、`hand.right`、`foot.left`、`foot.right`、`heart`、`shoulder`、`hug.chest`、`root`

## 7. 领域模型

| 领域对象 | 说明 |
|----------|------|
| `PersonAvatar` | 角色化身 |
| `Relationship` | 关系（不量化评分） |
| `PresenceState` | 在线状态 |
| `InteractionEvent` | 互动事件（幂等 eventId） |
| `SharedMoment` | 双人共同时刻 |
| `Memory` | 回忆记录 |
| `Consent` | 授权同意 |

## 8. 技术要求

### 8.1 技术栈

- 前端：React 19、TypeScript、Vite、PixiJS 6（过渡）、Cubism SDK for Web R5
- 后端：Node.js 24 LTS、Express、Socket.IO、SQLite
- 共享：pnpm workspace、shared contracts、schema 校验
- 测试：Vitest（单元）、Playwright（E2E）
- 缓存：IndexedDB / Cache Storage、Service Worker（PWA 离线）

### 8.2 渲染架构

- **渐进式双适配器迁移**
- Jing/Tao：Cubism5WebAdapter（生产级 Live2D）
- 旧模型（Hiyori/Haru/Natori/Chitose）：LegacyPixiAdapter（过渡保留）
- 领域、事件、动作和回忆不依赖渲染器

### 8.3 资产包规范

每个角色独立版本发布（`jing@1.0.0`、`tao@1.0.0`），包含：
`manifest.json`、`model3.json`、`moc3`、`physics3.json`、`pose3.json`、`cdi3.json`、expressions、motions、4096/2048/1024 三档纹理、thumbnail、`anchors.json`、`capabilities.json`、QA 报告和授权记录

## 9. 非功能需求

### 9.1 性能

- 主 JS 分包，角色包按需加载
- 支持 60/30/15fps，后台暂停
- 双模型移动端稳定运行
- 高/中/低 LOD 均可用

### 9.2 离线与弱网

- Socket 断开 → REST fallback → 本地 outbox
- 重连按 `eventId` 去重
- 离线事件不强制播放，显示"TA 来过"
- 资产加载失败 → 兼容旧模型 → 安全占位态，不能白屏

### 9.3 数据安全

- 动画失败不影响事件保存
- 重复事件不重复写入
- 支持数据删除和解绑
- 授权记录可审计

## 10. 明确不做（第一阶段）

- 不做等级、火花、进度条、任务、连续打卡、奖励、排行榜、关系评分
- 不做 Windows/macOS/Android/iOS 原生端（但协议和资产需可复用）
- 不把 PNG 动作序列帧直接当作 Live2D 运行时动画
- 不用 TapBody 下标取模实现动作语义
- 不删除旧模型（Hiyori/Haru/Natori/Chitose 作为过渡保留）
