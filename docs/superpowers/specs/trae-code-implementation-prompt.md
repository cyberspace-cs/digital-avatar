# 给 Trae 的代码迭代提示词：Jing/Tao 数字分身重构

> 用途：本文件是给代码实现端（Trae /workbuddy）的完整实现提示词，包含契约、资产、架构、协议和验收要求。
> 日期：2026-09-09
> 上级契约：
>
> `docs/superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md`
> 实施计划：
>
> `docs/superpowers/plans/2026-09-09-jing-tao-digital-avatar.md`
> 资产交付说明：
>
> `docs/assets/action-boards/DELIVERY_NOTES.md`



***

## 0. 你是谁，要做什么

你是 Jing/Tao 数字分身项目的代码实现端。你的任务是在现有 Web/PWA 项目中，渐进式引入 Jing/Tao 生产级 Live2D 角色、统一动作语义、双人编排和共同回忆模型。**你不负责资产生成**（动作参考板已由设计端交付），你负责把这些设计落地为可运行的代码。

项目根目录：`D:\download\project\TX-budddy\Digital-avatar`

技术栈：pnpm workspace、React 19、TypeScript、Vite、Node.js 24、Express、Socket.IO、SQLite、PixiJS 6（过渡）、Cubism SDK for Web R5（新增）、Vitest、Playwright。



***

## 1. 不可违反的硬约束（红线）

以下任何一条违反都视为交付失败，必须停止并报告：



1. **不得恢复等级 / 任务 / 火花系统**：不得重新引入成长值、等级、进度条、任务、连续打卡、奖励、排行榜、关系评分。旧字段只允许只读兼容读取，不得写入。

2. **不得删除旧模型**：`client/public/models/` 下的 `hiyori`、`haru`、`natori`、`chitose` 四个旧模型必须保留，继续由 `LegacyPixiAdapter` 承载。

3. **不得把 PNG 动作图直接当作 Live2D 运行时资产**：`docs/assets/action-boards/` 下的所有 PNG 是设计参考板，不是运行时动画。正式运行时必须使用 Cubism 5 的 `motion3.json`、`pose3.json`、`physics3.json`。禁止逐帧切换 PNG 实现动画。

4. **不得使用 TapBody 下标取模实现动作语义**：动作通过 `actionId`（如 `"wave"`、`"heart"`）标识和路由。未知动作按语义降级链处理，禁止 `actions[tapIndex % actions.length]` 这类写法。

5. **不得伪造生产 MOC3**：Jing/Tao 正式 Live2D 资产（moc3、纹理等）到位前，只允许使用占位 fixture，不得编造假的 moc3 文件。

6. **动画失败不影响事件保存**：任何渲染异常不得阻断互动事件落库。

7. **重复事件不重复写入**：按 `eventId` 幂等。



***

## 2. 已交付的资产（设计端产出，你只需引用）

### 2.1 动作参考板



```
docs/assets/action-boards/

├── DELIVERY\_NOTES.md              ← 动作语义、命名规范、代码端注意事项

├── jing/

│   ├── jing\_action\_board.png      ← 女主合并动作板

│   ├── girl\_wave\_01.png \~ 05.png  ← 女主挥手5帧（设计参考）

│   └── girl\_heart\_01.png \~ 05.png ← 女主比心5帧（设计参考）

├── tao/

│   ├── tao\_wave\_01.png \~ 05.png   ← 男主挥手5帧（设计参考，透明背景1024×1024）

│   └── tao\_heart\_01.png \~ 05.png  ← 男主比心5帧（设计参考，透明背景1024×1024）

└── tao\_action\_board.png           ← 男主合并动作板
```

### 2.2 动作语义映射



| actionId | 角色   | 帧前缀           | 帧数 | 动作描述                                    |
| -------- | ---- | ------------- | -- | --------------------------------------- |
| `wave`   | Jing | `girl_wave_`  | 5  | 右手肩侧挥手，手掌张开朝外                           |
| `heart`  | Jing | `girl_heart_` | 5  | 双手胸前组合爱心                                |
| `wave`   | Tao  | `tao_wave_`   | 5  | 肩部高度轻挥，略微前倾，掌心打开，克制自然                   |
| `heart`  | Tao  | `tao_heart_`  | 5  | **单手 finger-heart**（拇指食指交叉），左手轻扶领带，腼腆微笑 |

节拍结构（所有动作通用）：



```
帧01: 自然站立 / anticipation（待机起始）

帧02: 动作准备

帧03: 动作启动 / 峰值

帧04: 动作峰值 / 保持

帧05: 动作收尾 / 回到待机
```

### 2.3 角色造型基准



* **Jing**：中分深色长发、大眼淡腮红、白色无袖针织上衣、灰色百褶裙、白色堆堆袜、白色运动鞋。2.5～3 头身，身高约占画布 82%～85%。

* **Tao**：黑色蓬松短发、白色短袖衬衫、深色条纹领带、黑色长裤、白色运动鞋。温柔可靠略腼腆。2.5～3 头身，身高约占画布 88%～91%（比女生高大）。

### 2.4 统一锚点

`head`、`hand.left`、`hand.right`、`foot.left`、`foot.right`、`heart`、`shoulder`、`hug.chest`、`root`



***

## 3. 目标架构

### 3.1 渐进式双适配器



```
领域层（不依赖渲染器）

├── domain/        ← InteractionEvent、SharedMoment、Memory、Relationship

├── application/   ← sendInteraction、sharedMoment 用例

└── actions/       ← registry（actionId→ActionPlan）、choreographies、降级链

渲染层（端口+适配器）

├── runtime/

│   ├── avatar-renderer.ts      ← AvatarRenderer 接口（load/play/setAnchor/destroy）

│   ├── scene-coordinator.ts    ← 双模型舞台协调、锚点定位

│   ├── choreography-runner.ts  ← 双人编排时序执行

│   └── adapters/

│       ├── legacy-pixi.ts      ← LegacyPixiAdapter（Hiyori/Haru/Natori/Chitose）

│       └── cubism5-web.ts      ← Cubism5WebAdapter（Jing/Tao，新增）
```

### 3.2 服务端



```
server/src/modules/

├── events/

│   ├── service.ts   ← settleInteraction（幂等、动画失败不影响落库）

│   ├── routes.ts    ← REST 端点

│   └── socket.ts    ← Socket.IO 事件

└── memories/

&#x20;   └── service.ts   ← SharedMoment、Memory CRUD、回放
```

### 3.3 共享包



```
shared/src/

├── events.ts         ← InteractionEvent、SharedMoment、Memory 类型

├── assets.ts         ← AvatarManifest、ActionCapability、锚点类型

├── choreography.ts   ← ChoreographyDefinition、阶段类型

└── schema.ts         ← 运行时 schema 校验（zod 或自定义）
```



***

## 4. 分阶段实施任务（按顺序）

### Task 1：建立基线与共享契约

**文件：**



* 新建 `shared/package.json`、`shared/src/events.ts`、`shared/src/assets.ts`、`shared/src/choreography.ts`、`shared/src/schema.ts`

* 修改 `pnpm-workspace.yaml` 加入 `shared`

* 测试 `shared/src/*.test.ts`

**要求：**



* 先写失败测试：缺少 `eventId`、未知 major schema、无效 `actionId` 必须被拒绝

* 实现类型和运行时 schema 校验

* `pnpm --filter shared test` 通过

* `pnpm -r build` 确认客户端和服务端能消费 shared 包

**InteractionEvent 统一格式：**



```
{

&#x20; "schemaVersion": "1.0.0",

&#x20; "eventId": "uuid",

&#x20; "type": "interaction.requested",

&#x20; "relationshipId": "uuid",

&#x20; "senderId": "uuid",

&#x20; "receiverId": "uuid",

&#x20; "actionId": "wave",

&#x20; "choreographyId": null,

&#x20; "clientOccurredAt": "ISO-8601",

&#x20; "serverOccurredAt": "ISO-8601",

&#x20; "payload": {},

&#x20; "privacy": {},

&#x20; "status": "accepted"

}
```

### Task 2：服务端事件与回忆模块化

**文件：**



* 新建 `server/src/modules/events/service.ts`、`routes.ts`、`socket.ts`

* 新建 `server/src/modules/memories/service.ts`

* 新建 `server/src/db/migrations/20260909_memories.sql`

* 修改 `server/src/index.js`（或迁移为 `.ts`）、`server/src/db.js`

**要求：**



* 为重复 `eventId`、断线 REST 兜底、未知动作、动画失败不影响落库写失败测试

* 添加 `memories`、`shared_moments` 表和必要索引的幂等迁移

* Socket 和 REST 都接入同一事件服务

* 停止成长、等级、任务写入；旧字段只用于兼容读取

* `pnpm --filter server test` 和 `pnpm --filter server start` 通过

### Task 3：前端应用层和动作注册表

**文件：**



* 新建 `client/src/domain/interaction.ts`、`client/src/domain/memory.ts`

* 新建 `client/src/application/sendInteraction.ts`、`client/src/application/sharedMoment.ts`

* 新建 `client/src/actions/registry.ts`、`client/src/actions/choreographies.ts`

* 修改 `client/src/App.tsx`

**核心接口：**



```
resolveAction(capabilities: ActionCapability\[], actionId: string): ActionPlan

createChoreography(actionId: string, participants: string\[]): ChoreographyPlan

sendInteraction(command: SendInteractionCommand): Promise\<InteractionEvent>
```

**降级链（必须实现）：**



```
精确动作（actionId 匹配且角色有该 motion）

&#x20; → 同语义动作（如 heart 降级为通用 positive 反应）

&#x20;   → 通用反应（idle + 表情变化）

&#x20;     → 中性待机 + 文字气泡

&#x20;       → 只保留事件（不播放动画）
```

**要求：**



* 为 wave、heart、hug、未知动作、能力缺失写映射测试

* 从 App.tsx 移出互动发送、双人编排和回忆状态

* 运行客户端单元测试和现有邀请 / 互动 E2E

### Task 4：渲染器端口与旧模型适配器

**文件：**



* 新建 `client/src/runtime/avatar-renderer.ts`、`scene-coordinator.ts`、`adapters/legacy-pixi.ts`

* 修改 `client/src/live2d/avatar.ts`、`client/src/live2d/models.ts`

**核心接口：**



```
interface AvatarRenderer {

&#x20; load(manifest: AvatarManifest): Promise\<AvatarHandle>

&#x20; play(actionId: string, context?: PlaybackContext): Promise\<PlaybackResult>

&#x20; setAnchor(anchor: AnchorName, position: Point): void

&#x20; destroy(): void

}
```

**要求：**



* 为旧模型加载、动作降级、销毁、双模型定位写测试

* 将旧 `AvatarSprite` 细分为加载、动作、外观、生命周期职责

* 保持现有旧模型行为不回归

* 运行现有本地和生产诊断脚本

### Task 5：Jing/Tao 资产校验和 Cubism 5 适配器

**文件：**



* 新建 `client/src/runtime/adapters/cubism5-web.ts`

* 新建 `scripts/validate-avatar-package.mjs`

* 新建 `client/public/models/jing/manifest.json`、`client/public/models/tao/manifest.json`（占位 fixture）

* 测试 `scripts/validate-avatar-package.test.mjs`

**核心接口：**



```
Cubism5WebAdapter.load(manifestUrl: string): Promise\<AvatarHandle>

validateAvatarPackage(path: string): ValidationReport
```

**资产包 manifest 必须校验：**



* `manifest.json`、`model3.json`、`moc3`、`physics3.json`、`pose3.json`、`cdi3.json` 存在

* expressions、motions 目录存在

* 4096/2048/1024 三档纹理存在

* `anchors.json` 包含全部 9 个统一锚点

* `capabilities.json` 声明支持的 actionId 列表

* 文件 hash 校验

**要求：**



* 先用 fixture 角色包写 manifest、hash、anchor、capability 校验失败测试

* 接入官方 Cubism 5 Web runtime，不修改旧模型 adapter

* 正式资产到位前只用占位 fixture，不得伪造生产 MOC3

* 接入后验证三档纹理、物理、动作、销毁

### Task 6：双人编排与回忆界面

**文件：**



* 新建 `client/src/runtime/choreography-runner.ts`

* 新建 `client/src/features/memories/MemoryTimeline.tsx`、`memoryStore.ts`

* 修改 `client/src/App.tsx`、`client/src/styles.css`

**双人编排状态机：**



```
requested → accepted → preparing → ready → playing → completed

&#x20;                       ↘ partial / failed
```

**阶段固定：** `approach` → `contact` → `hold` → `release` → `return`

**同步机制：**



* 服务端创建 `momentId`，广播 `moment.prepare`（含 `choreographyId`、角色能力、`serverStartAt`、锚点配置）

* 两端返回 ready 后广播 start

* 客户端只同步开始时间、阶段标记、完成状态，**不逐帧同步 Cubism 参数**

**要求：**



* 为 prepare/ready/start/complete、partial、offline replay 写时序测试

* 完成 hug，再完成 handhold 和 shoulder-lean

* 将原任务页改为回忆时间线，移除等级和任务 UI

### Task 7：产品清理与数据迁移

**文件：**



* 修改 `client/src/App.tsx`、`types.ts`、`api.ts`

* 修改 `server/src/db.js`

* 修改 `docs/ARCHITECTURE.md`、`docs/ACCEPTANCE.md`

**要求：**



* 为旧增长字段只读兼容和新版不再写入写测试

* 删除火花、等级、任务、连续天数、奖励组件

* 增加首次互动、首次拥抱、纪念日、删除、解绑流程

* 更新架构和验收文档

### Task 8：性能、弱网和发布验收

**文件：**



* 修改 `client/vite.config.ts`、`client/src/live2d/perf.ts`、`client/public/sw.js`

* 新建 `scripts/verify-avatar-contract.mjs`、`scripts/verify-offline-replay.mjs`

**要求：**



* 主 JS 分包，角色包按需加载

* 验证 60/30/15fps、后台暂停、双模型、移动端

* 验证 Socket 断开 → REST fallback → outbox → 重连去重

* 验证资产加载失败 → 旧模型回退 → 安全占位态，不能白屏

* `pnpm build`、全部单元测试、契约测试、E2E、资产校验器全部通过

* 所有验收通过后再发布 Jing/Tao 正式角色包



***

## 5. 一级页面信息架构



```
陪伴（Companion）

├── Jing/Tao 常驻舞台

├── 自然待机（呼吸、眨眼、轻微头部摆动）

├── 轻触/长按触发动作 + 短句气泡

├── 状态表达（开心、害羞、思考）

└── 双人共同场景（同时在线）

回忆（Memories）

├── 互动时间线（倒序）

├── SharedMoment 卡片

├── 里程碑：第一次互动、第一次拥抱、自定义纪念日

├── 搜索/筛选/删除/回放

└── 离线事件显示"TA 来过"，用户选择回放（不强制播放）

我的（Profile）

├── 身份和关系信息

├── 状态可见性

├── 角色包和衣橱（换装）

├── 授权管理

├── 解绑/数据删除

└── 通知和存在感设置
```



***

## 6. 降级契约（必须实现）



| 维度 | 降级链                                        |
| -- | ------------------------------------------ |
| 动作 | 精确动作 → 同语义动作 → 通用反应 → 中性待机 + 气泡 → 只保留事件    |
| 资产 | 同版本缓存 → 兼容旧模型 → 安全占位态（不能白屏、不能重复发送事件）       |
| 网络 | Socket → REST → 本地 outbox → 重连按 eventId 去重 |



***

## 7. 测试要求

每个 Task 必须有对应测试：



* **单元测试**（Vitest）：类型、schema、动作注册表、降级链、事件幂等、编排状态机

* **契约测试**：shared schema 校验、资产 manifest 校验

* **E2E**（Playwright）：邀请 / 互动流程、双人编排、离线回放、回忆增删

* **资产校验**：`scripts/validate-avatar-package.mjs` 自动化

测试先行：每个 Task 的第一步是写失败测试，确认失败后再实现。



***

## 8. 验收门禁（全部通过才算完成）



* [ ] Jing/Tao 在静态、转头、抬手、坐姿、双人动作中身份一致

* [ ] wave/heart 动作有前摇、峰值保持、收尾

* [ ] 头发、领带、衣物、手型无明显穿插或撕裂

* [ ] 双人接触点稳定，离线 / 弱网可回放

* [ ] 页面无等级、任务、积分、关系评分

* [ ] 首次互动、首次拥抱、纪念日可回看、删除

* [ ] 重复事件不重复写入，动画失败不影响事件保存

* [ ] 高 / 中 / 低 LOD 均可用，双模型移动端稳定

* [ ] 构建、单元测试、契约测试、E2E、资产校验全部通过

* [ ] 旧模型（Hiyori/Haru/Natori/Chitose）行为不回归



***

## 9. 你可以引用的文档



| 文档      | 路径                                                                      |
| ------- | ----------------------------------------------------------------------- |
| 产品与技术契约 | `docs/superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md` |
| 实施计划    | `docs/superpowers/plans/2026-09-09-jing-tao-digital-avatar.md`          |
| 资产生成规范  | `docs/assets/specs/asset-production-spec.md`                            |
| 技术执行规范  | `docs/assets/specs/technical-execution-spec.md`                         |
| 动作交付说明  | `docs/assets/action-boards/DELIVERY_NOTES.md`                           |
| 产品需求文档  | `docs/prd/digital-avatar-prd.md`                                        |
| 动作描述词   | `docs/assets/prompts/action-sequences.md`                               |



***

## 10. 开始前的检查清单

在写第一行代码前，确认：



* [ ] 你已阅读 `docs/superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md` 全文

* [ ] 你已阅读 `docs/superpowers/plans/2026-09-09-jing-tao-digital-avatar.md` 全文

* [ ] 你理解第 1 节的 7 条硬约束

* [ ] 你知道动作参考板在 `docs/assets/action-boards/`，是设计参考不是运行时资产

* [ ] 你从 Task 1 开始，按顺序执行，不跳步

* [ ] 每个 Task 先写失败测试

确认后，从 Task 1（建立基线与共享契约）开始。