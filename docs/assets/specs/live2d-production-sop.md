# Jing/Tao Live2D 模型制作 SOP

> 日期：2026-09-13
> 适用：Jing（女主）、Tao（男主）
> 目标：产出可运行的 .model3.json + .moc3 + 物理 + 动作，替换混合架构中的占位模型

---

## 一、工具准备

| 工具 | 用途 | 版本 | 获取方式 |
|------|------|------|---------|
| Live2D Cubism Editor | 建模、绑定、物理、动作 | 5.x（免费版即可导出） | https://www.live2d.com/download/ |
| Photoshop / Krita / GIMP | 分层 PSD 制作 | 任意 | 自选 |
| See-Through（可选） | AI自动拆分层 | 最新 | https://github.com/...（需GPU） |
| SAM2（可选） | 语义分割辅助 | 最新 | HuggingFace demo |

**免费版限制**：Cubism Editor 免费版可导出 .model3.json 和 .moc3，但导出的模型会带免费版标识（不影响功能，仅官方政策要求标注）。商用需 PRO 版。

---

## 二、阶段1：分层 PSD 制作（最关键，占60%工作量）

### 2.1 分层规范

Live2D 要求每个可动部件单独一层，从下到上顺序如下：

```
┌─────────────────────────────────────┐
│  头发前（刘海、前发）               │  ← 最上层
│  眉毛左 / 眉毛右                    │
│  眼睛白 / 瞳孔左 / 瞳孔右           │
│  高光左 / 高光右                    │
│  嘴巴（闭合/张开/微笑 多版本）       │
│  头部基底（脸、耳朵）               │
│  头发后（后发、长发）               │
│  身体（上衣）                       │
│  手臂左 / 手臂右                    │
│  下装（裙子/裤子）                  │
│  腿 / 鞋子                          │  ← 最下层
└─────────────────────────────────────┘
```

### 2.2 Jing（女主）分层清单

| 层名 | 说明 | 关键点 |
|------|------|--------|
| `hair_back` | 后发，乌黑长直发 | 需补全被身体遮挡的部分 |
| `body_base` | 身体+白色无袖Polo衫 | 领口需完整 |
| `arm_left` | 左臂（自然下垂） | 可动 |
| `arm_right` | 右臂（自然下垂） | 可动 |
| `skirt` | 灰色百褶短裙 | 腰头完整 |
| `leg_left` / `leg_right` | 腿+白堆堆袜+小白鞋 | |
| `head_base` | 脸+耳朵 | 圆润鹅蛋脸 |
| `brow_left` / `brow_right` | 眉毛 | 细弯眉 |
| `eye_white_left` / `eye_white_right` | 眼白 | |
| `pupil_left` / `pupil_right` | 瞳孔（深棕色杏眼） | 含虹膜+瞳孔 |
| `eye_highlight_left` / `eye_highlight_right` | 眼睛高光 | 2-3个光点 |
| `mouth_closed` | 嘴巴-闭合（微笑） | 默认 |
| `mouth_open` | 嘴巴-微张 | 说话用 |
| `hair_front` | 前发+刘海（自然偏分） | 覆盖额头 |

### 2.3 Tao（男主）分层清单

| 层名 | 说明 | 关键点 |
|------|------|--------|
| `hair_back` | 后发，黑色短碎发 | |
| `body_base` | 身体+白短袖衬衫 | 领口完整，胸口星型刺绣 |
| `arm_left` / `arm_right` | 手臂 | 可动 |
| `necktie` | 藏青斜条纹领带 | 独立层，可摆动 |
| `pants` | 黑色直筒西裤 | |
| `leg_left` / `leg_right` | 腿+鞋子 | |
| `head_base` | 脸+耳朵 | |
| `brow_left` / `brow_right` | 眉毛 | |
| `eye_white_left` / `eye_white_right` | 眼白 | |
| `pupil_left` / `pupil_right` | 瞳孔（深色杏眼） | |
| `eye_highlight_left` / `eye_highlight_right` | 高光 | |
| `mouth_closed` / `mouth_open` | 嘴巴 | |
| `hair_front` | 前发+轻薄刘海 | |

### 2.4 分层制作方法

#### 方法A：AI辅助拆分层（推荐，省时间）

1. 用 See-Through 或 SAM2 对基准立绘做语义分割
2. 导出各部件 mask
3. PS 中按 mask 分层，用生成式填充补全被遮挡区域
4. 手动清理边缘

#### 方法B：手动分层（质量最高）

1. PS 中打开基准立绘
2. 用钢笔工具精确勾勒每个部件
3. 复制到新层，用内容识别填充补全遮挡
4. 手绘补全缺失部分

#### 方法C：重新生成分层图（最灵活）

用 AI 图像生成工具，按层分别生成：
- "Q版二次元少女，仅后发，透明背景，正面视角"
- "Q版二次元少女，仅脸部，无头发，透明背景"
- ...以此类推

**注意**：各层必须严格对齐，尺寸相同（建议 2048×2048），位置一致。

### 2.5 PSD 导出规范

- 画布尺寸：2048×2048（或 1024×1024）
- 所有层对齐，底部基线一致
- 层名用英文，无中文、无空格
- 隐藏层不导出
- 保存为 .psd，Cubism Editor 直接导入

---

## 三、阶段2：Cubism Editor 建模

### 3.1 导入 PSD

1. 打开 Cubism Editor → 新建项目
2. 文件 → 导入 → PSD 文件
3. 选择分层 PSD，确认层映射
4. 每个层自动生成一个 Drawable

### 3.2 生成网格（Mesh）

1. 选中每个 Drawable
2. 自动生成网格（或手动编辑）
3. 网格密度：脸部/眼睛密，身体/头发疏
4. 确保变形时不撕裂

### 3.3 设置变形器（Deformer）

按层级建立变形器树：

```
Root
├── BodyDeformer（身体整体）
│   ├── ArmLeftDeformer
│   ├── ArmRightDeformer
│   └── SkirtDeformer
├── HeadDeformer（头部整体）
│   ├── BrowLeftDeformer
│   ├── BrowRightDeformer
│   ├── EyeLeftDeformer
│   │   ├── PupilLeftDeformer
│   │   └── HighlightLeftDeformer
│   ├── EyeRightDeformer
│   └── MouthDeformer
├── HairBackDeformer
└── HairFrontDeformer
```

### 3.4 绑定参数（Parameters）

| 参数 | 范围 | 控制内容 |
|------|------|---------|
| `ParamAngleX` | -30 ~ +30 | 头部左右旋转 |
| `ParamAngleY` | -30 ~ +30 | 头部上下旋转 |
| `ParamAngleZ` | -30 ~ +30 | 头部倾斜 |
| `ParamEyeLOpen` / `ParamEyeROpen` | 0 ~ 1 | 眨眼 |
| `ParamBrowLY` / `ParamBrowRY` | -1 ~ +1 | 眉毛上下 |
| `ParamMouthOpenY` | 0 ~ 1 | 嘴巴张开 |
| `ParamMouthForm` | -1 ~ +1 | 嘴型（微笑/嘟嘴） |
| `ParamBodyAngleX` | -10 ~ +10 | 身体左右摇摆 |
| `ParamBreath` | 0 ~ 1 | 呼吸（身体轻微缩放） |
| `ParamArmLA` / `ParamArmRA` | -10 ~ +10 | 手臂摆动 |

每个参数需要设置关键帧：
- 参数最小值时的形状
- 参数默认值时的形状
- 参数最大值时的形状

### 3.5 物理设置（Physics）

新建 `physics3.json`，设置：

1. **头发摆动**：HairBackDeformer 受重力影响，跟随 ParamAngleX 延迟摆动
2. **领带摆动**（Tao）：NecktieDeformer 物理摆动
3. **裙子摆动**（Jing）：SkirtDeformer 轻微摆动
4. **身体呼吸**：ParamBreath 正弦曲线驱动

物理参数：
- 重力：9.8
- 阻尼：0.5
- 延迟：0.3
- 反弹：0.2

---

## 四、阶段3：动作制作（Motion）

### 4.1 idle 动作（idle.motion3.json）

- 呼吸：ParamBreath 0→1→0，周期4秒
- 眨眼：ParamEyeLOpen/ROpen 随机间隔3-6秒，0.2秒闭合
- 轻微摇摆：ParamBodyAngleX ±2°，周期6秒
- 眼球微动：瞳孔参数轻微偏移

### 4.2 wave 动作（wave.motion3.json）

可选：如果 Live2D 原生动作质量好，可以用 Live2D 做 wave；否则继续用序列帧。

Live2D wave：
- ParamArmRA 0→45°→0（右臂抬起挥动）
- 头部轻微前倾
- 表情微笑

### 4.3 heart 动作（heart.motion3.json）

可选：同上。

Live2D heart（Tao）：
- 右手单手 finger-heart
- 左手扶领带
- 表情开心

---

## 五、阶段4：导出与集成

### 5.1 导出

1. 文件 → 导出为运行时文件
2. 选择输出目录
3. 导出内容：.model3.json、.moc3、textures/、physics3.json、motions/
4. 纹理格式：PNG，2048×2048

### 5.2 集成到项目

将导出文件复制到：
```
client/public/models/jing/live2d/
├── jing.model3.json
├── jing.moc3
├── jing.physics3.json
├── textures/
│   └── jing.2048/texture_00.png
└── motions/
    ├── idle.motion3.json
    ├── wave.motion3.json
    └── heart.motion3.json
```

### 5.3 修改 manifest.json

```json
{
  "engine": "hybrid",
  "live2d": {
    "model": "live2d/jing.model3.json",
    "idleMotion": "idle",
    "hasNativeActions": true
  }
}
```

`hasNativeActions: true` 表示动作也走 Live2D 原生 motion（如果质量够好）；否则保持 false 走序列帧。

---

## 六、质量检查清单

- [ ] 所有部件分层完整，无遗漏
- [ ] 被遮挡区域已补全，旋转时不露馅
- [ ] 网格变形无撕裂、无穿模
- [ ] 参数绑定完整，角度X/Y/Z都有
- [ ] 眨眼自然，无卡顿
- [ ] 呼吸微动不明显但存在
- [ ] 物理摆动自然，不夸张
- [ ] idle 循环无缝
- [ ] 导出文件完整，.moc3 可加载
- [ ] 在 pixi-live2d-display 中渲染正常
- [ ] 边缘无白边（Live2D 矢量网格天然无白边）
- [ ] 男主比女主高大（scale 参数调整）

---

## 七、常见问题

### Q: AI拆分层质量不好怎么办？
A: 手动在 PS 中清理边缘，用钢笔工具重新勾勒。分层质量直接决定最终效果，这步不能省。

### Q: 免费版导出的模型有水印吗？
A: 免费版导出的 .moc3 不含可见水印，但官方政策要求在作品中注明使用了免费版。功能无限制。

### Q: 可以只做 idle 用 Live2D，动作继续用序列帧吗？
A: 可以，这正是方案C混合架构的设计。manifest 中 `hasNativeActions: false` 即可。

### Q: 物理摆动在低端设备卡怎么办？
A: 减少物理计算的顶点数，或在 PerfGovernor 的 saver 模式下禁用物理。

### Q: 两个角色可以共用一套参数绑定吗？
A: 可以，参数结构相同，但每个角色需要独立的 PSD 和网格。
