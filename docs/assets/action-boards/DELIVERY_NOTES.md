# 动作参考板交付说明

> 交付日期：2026-09-09
> 交付方：豆包（资产生成）
> 接收方：workbuddy / trae（代码实现）
> 上级契约：`docs/superpowers/specs/2026-09-09-jing-tao-digital-avatar-contract.md`

---

## 1. 交付物清单

```
docs/assets/action-boards/
├── DELIVERY_NOTES.md              ← 本文件
├── jing/
│   └── jing_action_board.png      ← 女主合并动作板（用户提供，2行×5列）
├── tao/
│   ├── tao_wave_01.png            ← 挥手-待机起始
│   ├── tao_wave_02.png            ← 挥手-右手抬起
│   ├── tao_wave_03.png            ← 挥手-最高点
│   ├── tao_wave_04.png            ← 挥手-保持
│   ├── tao_wave_05.png            ← 挥手-回到待机
│   ├── tao_heart_01.png           ← 比心-待机起始
│   ├── tao_heart_02.png           ← 比心-右手抬起
│   ├── tao_heart_03.png           ← 比心-单手finger-heart
│   ├── tao_heart_04.png           ← 比心-保持+wink
│   └── tao_heart_05.png           ← 比心-回到待机
└── tao_action_board.png           ← 男主合并动作板（2行×5列，自动拼接）
```

## 2. 图片技术规格

| 参数 | Tao 单独帧 | Tao 合并板 | Jing 合并板 |
|------|-----------|-----------|------------|
| 格式 | PNG（RGBA，透明背景） | PNG（RGB，浅灰白底） | PNG |
| 尺寸 | 1024×1024 px | 5400×2348 px | 以用户提供为准 |
| 背景 | 完全透明，无地面投影 | #F5F5F5 浅灰白 | 白底 |
| 角色高度 | 约占画布 88%～91%（男生比女生高大） | 同左 | 约占画布 82%～85% |
| 脚底基线 | 10帧统一，距底部约 5% | 同左 | 同左 |
| 文字/水印 | 无 | 帧名标注（单元格下方） | 有帧名标注 |

## 3. 动作语义映射

### Tao（男主）

| actionId | 帧前缀 | 帧数 | 播放顺序 | 动作描述 |
|----------|--------|------|----------|----------|
| `wave` | `tao_wave_` | 5 | 01→02→03→04→05 | 肩部高度轻挥，略微前倾，掌心打开，动作克制自然 |
| `heart` | `tao_heart_` | 5 | 01→02→03→04→05 | 单手 finger-heart（拇指食指交叉），左手轻扶领带，腼腆微笑 |

### Jing（女主）

| actionId | 帧前缀 | 帧数 | 播放顺序 | 动作描述 |
|----------|--------|------|----------|----------|
| `wave` | `girl_wave_` | 5 | 01→02→03→04→05 | 右手肩侧挥手，手掌张开朝外 |
| `heart` | `girl_heart_` | 5 | 01→02→03→04→05 | 双手胸前组合爱心 |

### 节拍结构（两个角色通用）

```
帧01: 自然站立 / anticipation（待机起始）
帧02: 动作准备
帧03: 动作启动 / 峰值
帧04: 动作峰值 / 保持
帧05: 动作收尾 / 回到待机
```

## 4. 男女角色差异

| 维度 | Jing（女主） | Tao（男主） |
|------|-------------|-------------|
| 身高 | 约占画布 82%～85% | 约占画布 88%～91%（更高大） |
| 肩宽 | 较窄 | 略宽 |
| wave | 右手肩侧活泼挥手 | 肩部高度轻挥，略微前倾，克制自然 |
| heart | 双手胸前比心 | **单手 finger-heart**，左手扶领带 |
| 气质 | 温柔清新，略带俏皮 | 温柔可靠，略腼腆 |

## 5. 代码端注意事项（给 trae / workbuddy）

### 5.1 这些 PNG 是设计参考，不是运行时资产

- 本目录下所有 PNG 是**动作设计参考板**，用于 Live2D 动作师制作 `motion3.json` 时的姿势参照
- **禁止**将这些 PNG 序列帧直接作为运行时动画播放（如逐帧切换 PNG）
- 正式运行时必须使用 Cubism 5 的参数动画：`motion3.json`、`pose3.json`、`physics3.json`
- 运行时模型包后续放入 `client/public/models/jing/` 和 `client/public/models/tao/`

### 5.2 动作语义通过 actionId 标识

- 动作通过 `actionId`（如 `"wave"`、`"heart"`）在事件协议中传递
- **禁止**使用 TapBody 下标取模实现动作语义
- 未知动作按降级链处理：精确动作 → 同语义动作 → 通用反应 → 中性待机+气泡 → 只保留事件

### 5.3 建议的 Cubism 参数映射

| 动作 | 主要参数 |
|------|----------|
| wave | `ParamArmR`、`ParamHandR`、`ParamShoulderY`、身体前倾 |
| heart | `ParamArmR`、`ParamHandR`（finger-heart 手型替换件）、`ParamArmL`（扶领带）、表情参数 |

参考契约第5节建议统一参数：`ParamHandL`、`ParamHandR`、`ParamShoulderY`、`ParamArmL`、`ParamArmR`、`ParamHairFront`、`ParamHairSide`、`ParamHairBack`。

### 5.4 降级契约

- 动画失败不影响事件保存
- 资产加载失败 → 兼容旧模型 → 安全占位态，不能白屏
- 重复事件按 `eventId` 幂等，不重复写入

## 6. 契约合规声明

- [x] 未将 PNG 动作图放入 `client/public/models/` 运行时目录
- [x] 未修改任何代码文件
- [x] 未删除旧模型（Hiyori/Haru/Natori/Chitose 保留）
- [x] 未恢复等级/任务/火花系统
- [x] 未使用 TapBody 下标取模
- [x] Tao heart 为单手 finger-heart（非双手比心）
- [x] 所有帧透明背景、无水印、无文字
- [x] 男生角色身高高于女生

## 7. 后续动作规划（当前阶段不生成）

契约要求 Tao 还需规划以下动作，后续阶段制作：
`tie_adjust`（整理领带）、`thumbsup`（点赞）、`shy_lookaway`（害羞转头）、`offer`（递东西）、`pat`（拍头）、`poke_react`（被戳反应）、`receive`（接收）、`hug_open`（张开怀抱）
