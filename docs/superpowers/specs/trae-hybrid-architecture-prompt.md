# 给 Trae 的代码迭代提示词：Live2D + 序列帧混合架构

> 日期：2026-09-13
> 前置文档：`docs/superpowers/specs/2026-09-13-rendering-quality-and-live2d-roadmap.md`（方案C）
> 契约红线：不得恢复等级/任务/火花、不得删除旧模型、不得把PNG当Live2D运行时资产、不得用TapBody下标取模

---

## 一、目标

实现 **Live2D + 序列帧混合渲染架构**：
- **idle 状态**：用 Live2D 模型渲染（呼吸、眨眼、眼球跟踪、物理摆动）
- **action 状态（wave/heart）**：切换到序列帧播放，播完自动回 Live2D idle
- 切换时 200ms 淡入淡出，避免硬切
- 完整降级链：Live2D 加载失败 → 序列帧 idle → 旧模型

## 二、当前代码状态

### 已有
- `client/src/live2d/sprite-avatar.ts` — 序列帧引擎（SpriteAvatar），已支持 wave/heart 动作播放、idle 呼吸微动效
- `client/src/live2d/avatar-sprite.ts` — Live2D 引擎（AvatarSprite），基于 pixi-live2d-display，旧模型 hiyori/haru/natori/chitose 可用
- `client/src/live2d/models.ts` — 角色库，Jing/Tao 标记 `engine: 'sprite-sequence'`，旧模型无标记走 legacy-pixi
- `client/src/AppStage.tsx` — 舞台，根据 `isSpriteAvatar(avatarId)` 选择 SpriteAvatar 或 AvatarSprite
- `client/public/models/jing/` `tao/` — 序列帧运行时包（manifest/anchors/capabilities/idle.png/frames/）
- `client/public/models/hiyori/` 等 — 旧 Live2D 模型（.model3.json 标准结构）

### 刚修复（commit 7bd62bf）
- sprite-avatar.ts：纹理 `scaleMode=NEAREST`（消除白边）
- AppStage.tsx：`PIXI.settings.ROUND_PIXELS=true`
- 20帧重新去底（边缘腐蚀+去边）

## 三、混合架构设计

### 3.1 角色包结构扩展

Jing/Tao 的角色包同时包含 Live2D 和序列帧两套资产：

```
client/public/models/jing/
├── manifest.json          # 扩展：增加 live2d 字段
├── anchors.json
├── capabilities.json
├── idle.png               # 序列帧 idle 兜底
├── frames/                # 序列帧动作
│   ├── wave/frame_01~05.png
│   └── heart/frame_01~05.png
└── live2d/                # 【新增】Live2D 资产（占位用 hiyori，后续替换）
    ├── jing.model3.json
    ├── jing.moc3
    ├── textures/
    ├── physics3.json
    └── motions/
        ├── idle.motion3.json
        ├── wave.motion3.json   # 可选：Live2D原生动作（没有则用序列帧）
        └── heart.motion3.json
```

### 3.2 manifest.json 扩展

```json
{
  "id": "jing",
  "name": "Jing",
  "engine": "hybrid",
  "sprite": {
    "idle": "idle.png",
    "clips": { "wave": 5, "heart": 5 }
  },
  "live2d": {
    "model": "live2d/jing.model3.json",
    "idleMotion": "idle",
    "hasNativeActions": false
  },
  "scale": 0.28,
  "yOffset": 0
}
```

- `engine: "hybrid"` — 混合模式
- `live2d.hasNativeActions: false` — 动作走序列帧（当前阶段），后续可改为 true 走 Live2D 原生 motion

### 3.3 状态机

```
┌─────────┐  action(wave/heart)  ┌──────────────┐  播放完成  ┌─────────┐
│ Live2D  │ ───────────────────> │  序列帧动作   │ ─────────> │ Live2D  │
│  idle   │                      │  (200ms淡入)  │            │  idle   │
│         │ <─────────────────── │               │ <───────── │         │
└─────────┘   (200ms淡出回切)    └──────────────┘   自动回切  └─────────┘
     │
     │ Live2D加载失败
     ▼
┌─────────┐
│ 序列帧   │  action → 序列帧动作 → 回序列帧idle
│  idle   │
└─────────┘
```

### 3.4 新增 HybridAvatar 类

`client/src/live2d/hybrid-avatar.ts`（新建）：

```typescript
class HybridAvatar implements StageSprite {
  private live2d: AvatarSprite    // Live2D 子精灵
  private sprite: SpriteAvatar    // 序列帧子精灵
  private mode: 'live2d' | 'sprite' = 'live2d'
  private container: PIXI.Container

  async load(avatarId, manifest, tier) {
    // 并行加载 Live2D 和序列帧
    // Live2D 加载失败则 mode='sprite'
  }

  playAction(actionId, onComplete) {
    // 1. 序列帧淡入（alpha 0→1，200ms）
    // 2. Live2D 淡出（alpha 1→0，200ms）
    // 3. 序列帧播放动作
    // 4. 播完后序列帧淡出，Live2D 淡入，回 idle
  }

  update(delta) {
    if (mode === 'live2d') live2d.update(delta)
    else sprite.update(delta)
  }
}
```

### 3.5 AppStage.tsx 修改

- `isSpriteAvatar()` 扩展：`engine === 'sprite-sequence' || 'hybrid'`
- hybrid 角色用 `HybridAvatar` 而非 `SpriteAvatar`
- 角色切换时正确销毁 HybridAvatar 的两个子精灵

### 3.6 models.ts 修改

- Jing/Tao 的 `engine` 从 `'sprite-sequence'` 改为 `'hybrid'`
- 增加 `live2d` 字段（当前指向占位模型，后续替换）

## 四、占位策略

当前阶段 Jing/Tao 没有真正的 Live2D 模型，用以下方式占位验证架构：

1. **复制 hiyori 模型**到 `client/public/models/jing/live2d/` 和 `tao/live2d/`（仅用于架构验证，后续替换）
2. manifest 中 `live2d.model` 指向占位模型
3. 验证通过后，等真正的 Jing/Tao Live2D 模型做好，直接替换 `live2d/` 目录即可

**注意**：占位模型只是验证架构用，最终交付前必须替换为真正的 Jing/Tao 模型，不能用 hiyori 冒充。

## 五、降级链（必须完整）

```
HybridAvatar.load()
  ├─ Live2D 加载成功 → mode='live2d'，idle 用 Live2D
  ├─ Live2D 加载失败 → mode='sprite'，idle 用序列帧 idle.png
  └─ 序列帧也失败 → 回退 DEFAULT_AVATAR（旧模型 hiyori）
```

任何一步失败都不能白屏，必须有兜底。

## 六、验收标准

1. Jing/Tao 角色 idle 状态显示 Live2D 模型（占位 hiyori），有呼吸/眨眼动画
2. 点击 wave/heart 按钮，平滑切换到序列帧动作播放
3. 动作播完自动平滑切回 Live2D idle
4. 切换过程无闪烁、无硬切（200ms 淡入淡出）
5. 断开 Live2D 资产（删除 live2d/ 目录），自动降级到序列帧 idle，不白屏
6. 旧模型 hiyori/haru/natori/chitose 不受影响，仍可正常切换
7. TypeScript 编译通过，无 lint 错误
8. 性能：混合模式 GPU 占用不超过 Live2D 单独模式的 120%

## 七、禁止项（契约红线）

- ❌ 不得删除旧模型目录（hiyori/haru/natori/chitose）
- ❌ 不得把 PNG 序列帧当作 Live2D 运行时资产（.moc3 才是）
- ❌ 不得恢复等级/任务/火花系统
- ❌ 不得用 TapBody 下标取模实现动作语义
- ❌ 不得用占位 hiyori 模型冒充 Jing/Tao 最终交付

## 八、实施顺序

1. 新建 `hybrid-avatar.ts`，实现双引擎容器+状态机+淡入淡出
2. 扩展 `manifest.json` 结构和类型定义
3. 修改 `models.ts`，Jing/Tao 改为 hybrid，复制 hiyori 占位
4. 修改 `AppStage.tsx`，hybrid 角色用 HybridAvatar
5. 实现降级链
6. 本地测试：idle→action→idle 切换、断 Live2D 降级、旧模型兼容
7. 提交推送
