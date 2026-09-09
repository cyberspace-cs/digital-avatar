# Jing Tao 数字分身重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有 Web/PWA 的前提下，引入 Jing/Tao 生产级 Live2D、统一动作语义、双人编排和共同回忆模型。

**Architecture:** 采用渐进式双适配器迁移。领域、事件、动作和回忆不依赖渲染器；Jing/Tao 使用 Cubism5WebAdapter，旧模型继续由 LegacyPixiAdapter 承载。服务端保持模块化单体，Socket.IO 与 REST 共用幂等事件服务。

**Tech Stack:** React、TypeScript、Vite、Node.js、Express、Socket.IO、SQLite、Cubism SDK for Web、IndexedDB/Cache Storage、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md`

## Global Constraints

- Jing/Tao 造型不可改变；女主动作参考板为 10 张，男主动作参考板为对应 10 张。
- Web/PWA 是第一阶段唯一交付平台，但 contracts、资产包和编排必须跨平台复用。
- 删除等级、火花、任务、连续打卡、奖励和关系评分。
- 保留 Hiyori/Haru/Natori/Chitose 作为 LegacyPixiAdapter 过渡模型。
- 禁止将动作绑定到 TapBody 下标或直接使用 PNG 帧替代 Live2D motion3。
- 动画失败不影响事件保存；Socket、REST、outbox 按 eventId 幂等。
- 任何代码变更都必须有对应测试或验收证据。

### Task 1: 建立基线与共享契约

**Files:**
- Create: `shared/package.json`
- Create: `shared/src/events.ts`
- Create: `shared/src/assets.ts`
- Create: `shared/src/choreography.ts`
- Create: `shared/src/schema.ts`
- Modify: `pnpm-workspace.yaml`
- Test: `shared/src/*.test.ts`

**Interfaces:**
- Produces `InteractionEvent`, `SharedMoment`, `Memory`, `AvatarManifest`, `ActionCapability`, `ChoreographyDefinition`。

- [ ] 写出 schema 失败测试：缺少 `eventId`、未知 major schema、无效 actionId 必须被拒绝。
- [ ] 运行 `pnpm --filter shared test`，确认测试先失败。
- [ ] 实现共享类型和运行时 schema 校验。
- [ ] 运行 `pnpm --filter shared test`，确认通过。
- [ ] 运行 `pnpm -r build`，确认客户端和服务端能消费 shared 包。

### Task 2: 服务端事件与回忆模块化

**Files:**
- Create: `server/src/modules/events/service.ts`
- Create: `server/src/modules/events/routes.ts`
- Create: `server/src/modules/events/socket.ts`
- Create: `server/src/modules/memories/service.ts`
- Create: `server/src/db/migrations/20260909_memories.sql`
- Modify: `server/src/index.js` 或迁移后的 `server/src/index.ts`
- Modify: `server/src/db.js`
- Test: `server/src/modules/events/*.test.ts`

**Interfaces:**
- Consumes shared event schemas。
- Produces `settleInteraction(input)`, `prepareSharedMoment(input)`, `completeSharedMoment(input)`。

- [ ] 为重复 `eventId`、断线 REST 兜底、未知动作和动画失败不影响落库编写失败测试。
- [ ] 添加 `memories`、`shared_moments` 和必要索引的幂等迁移。
- [ ] 将 Socket 和 REST 都接入同一事件服务。
- [ ] 停止成长、等级、任务写入；保留旧字段只用于兼容读取。
- [ ] 运行 `pnpm --filter server test` 和 `pnpm --filter server start`。

### Task 3: 前端应用层和动作注册表

**Files:**
- Create: `client/src/domain/interaction.ts`
- Create: `client/src/domain/memory.ts`
- Create: `client/src/application/sendInteraction.ts`
- Create: `client/src/application/sharedMoment.ts`
- Create: `client/src/actions/registry.ts`
- Create: `client/src/actions/choreographies.ts`
- Modify: `client/src/App.tsx`
- Test: `client/src/actions/*.test.ts`

**Interfaces:**
- `resolveAction(capabilities, actionId): ActionPlan`
- `createChoreography(actionId, participants): ChoreographyPlan`
- `sendInteraction(command): Promise<InteractionEvent>`

- [ ] 为 wave、heart、hug、未知动作和能力缺失编写映射测试。
- [ ] 实现精确动作→同语义动作→通用反应→气泡的降级链。
- [ ] 从 App.tsx 移出互动发送、双人编排和回忆状态。
- [ ] 运行客户端单元测试和现有邀请/互动 E2E。

### Task 4: 渲染器端口与旧模型适配器

**Files:**
- Create: `client/src/runtime/avatar-renderer.ts`
- Create: `client/src/runtime/scene-coordinator.ts`
- Create: `client/src/runtime/adapters/legacy-pixi.ts`
- Modify: `client/src/live2d/avatar.ts`
- Modify: `client/src/live2d/models.ts`
- Test: `client/src/runtime/*.test.ts`

**Interfaces:**
- `AvatarRenderer.load(manifest): Promise<AvatarHandle>`
- `AvatarRenderer.play(actionId, context): Promise<PlaybackResult>`
- `AvatarRenderer.setAnchor(anchor, position)`
- `AvatarRenderer.destroy()`

- [ ] 为旧模型加载、动作降级、销毁和双模型定位编写测试。
- [ ] 将旧 `AvatarSprite` 细分为加载、动作、外观和生命周期职责。
- [ ] 保持现有旧模型行为不回归。
- [ ] 运行现有本地和生产诊断脚本。

### Task 5: Jing/Tao 资产校验和 Cubism 5 适配器

**Files:**
- Create: `client/src/runtime/adapters/cubism5-web.ts`
- Create: `scripts/validate-avatar-package.mjs`
- Create: `client/public/models/jing/manifest.json`
- Create: `client/public/models/tao/manifest.json`
- Test: `scripts/validate-avatar-package.test.mjs`

**Interfaces:**
- `Cubism5WebAdapter.load(manifestUrl): Promise<AvatarHandle>`
- `validateAvatarPackage(path): ValidationReport`

- [ ] 先用 fixture 角色包写 manifest、hash、anchor、capability 校验失败测试。
- [ ] 接入官方 Cubism 5 Web runtime，不修改旧模型 adapter。
- [ ] 接入 Jing/Tao 包后验证三档纹理、物理、动作和销毁。
- [ ] 角色正式资产到位前只允许使用占位 fixture，不得伪造生产 MOC3。

### Task 6: 双人编排与回忆界面

**Files:**
- Create: `client/src/runtime/choreography-runner.ts`
- Create: `client/src/features/memories/MemoryTimeline.tsx`
- Create: `client/src/features/memories/memoryStore.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles.css`
- Test: `client/src/runtime/choreography-runner.test.ts`

**Interfaces:**
- `runChoreography(plan, scene): Promise<SharedMomentResult>`
- `replayMemory(memoryId): Promise<void>`

- [ ] 为 prepare/ready/start/complete、partial、offline replay 写时序测试。
- [ ] 使用 serverStartAt 和 phase markers，不做逐帧网络同步。
- [ ] 完成 hug，再完成 handhold 和 shoulder-lean。
- [ ] 将原任务页改为回忆时间线，移除等级和任务 UI。

### Task 7: 产品清理与数据迁移

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Modify: `server/src/db.js`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ACCEPTANCE.md`
- Test: `client/verify-v*.cjs`

- [ ] 为旧增长字段只读兼容和新版不再写入编写测试。
- [ ] 删除火花、等级、任务、连续天数和奖励组件。
- [ ] 增加首次互动、首次拥抱、纪念日、删除和解绑流程。
- [ ] 更新架构和验收文档，明确本契约是新基线。

### Task 8: 性能、弱网和发布验收

**Files:**
- Modify: `client/vite.config.ts`
- Modify: `client/src/live2d/perf.ts`
- Modify: `client/public/sw.js`
- Create: `scripts/verify-avatar-contract.mjs`
- Create: `scripts/verify-offline-replay.mjs`

- [ ] 验证主 JS 分包和角色包按需加载。
- [ ] 验证 60/30/15fps、后台暂停、双模型和移动端。
- [ ] 验证 Socket 断开、REST fallback、outbox、重连去重。
- [ ] 验证资产加载失败、动作未知、旧模型回退和回忆保存。
- [ ] 运行 `pnpm build`、全部单元测试、契约测试、E2E 和资产校验器。
- [ ] 所有验收通过后再发布 Jing/Tao 正式角色包。

