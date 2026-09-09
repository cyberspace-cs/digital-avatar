# Jing Tao 数字分身产品与技术契约

> 状态：已确认的设计基线
> 日期：2026-09-09
> 适用对象：产品、前端、后端、Live2D 画师、绑定师、测试和后续桌面/移动端实施者

## 1. 契约优先级

本文件是 Jing/Tao 重构的唯一产品与技术基线。仓库中的历史需求、旧 changelog 和旧版本设计只作为背景，不得覆盖本文件。若实现、资产或旧代码与本文件冲突，应停止并报告冲突，不得自行恢复旧设计。

用户提供的 `Jing.png`、`Tao.png` 是最终角色造型基准；用户提供的女主动作板是动作设计和验收参考，不是最终运行时帧动画。

## 2. 不可变产品决策

- 第一阶段只交付 Web/PWA。
- 事件协议、角色资产包、动作语义和双人编排必须可复用于未来 Windows/macOS/Android/iOS。
- 使用生产级 Live2D；Jing/Tao 走 Cubism 5 Web 适配器。
- 现有 Hiyori、Haru、Natori、Chitose 作为过渡模型保留，走 LegacyPixiAdapter。
- 删除火花、等级、进度条、任务、连续打卡、奖励、排行榜和关系评分。
- 关系价值由共同经历表达，不量化关系。
- 一级页面为：陪伴、回忆、我的。

## 3. 角色资产契约

### 3.1 Jing

中分深色长发、大眼和淡腮红、白色无袖针织上衣、灰色百褶裙、白色堆堆袜、白色运动鞋。不得改变脸型、发型、服装、比例、主色和画风。

### 3.2 Tao

黑色蓬松短发、白色短袖衬衫、深色条纹领带、黑色长裤、白色运动鞋。动作应体现温柔、可靠、略腼腆；男性化不等于夸张、粗暴或僵硬。

### 3.3 资产包

角色以独立版本发布：`jing@1.0.0`、`tao@1.0.0`。每个包至少包含：

- `manifest.json`
- `model3.json`
- `moc3`
- `physics3.json`
- `pose3.json`
- `cdi3.json`
- expressions、motions
- 4096/2048/1024 三档纹理
- thumbnail、`anchors.json`、`capabilities.json`
- QA 报告和授权记录

必须归档但不公开发布的源文件：PSD、CMO3、CAN3、纹理源图、动作命名表、补画说明。

统一锚点：`head`、`hand.left`、`hand.right`、`foot.left`、`foot.right`、`heart`、`shoulder`、`hug.chest`、`root`。

每角色预计 120–180 个可维护图层。禁止只交 MOC3、用整体缩放代替重心动作、或在运行时肉眼调整双人接触点。

## 4. 女主和男主动作板契约

女主参考板总计 10 张，2 行 × 5 列：

- `girl_wave_01.png` ～ `girl_wave_05.png`
- `girl_heart_01.png` ～ `girl_heart_05.png`

两组各代表一个动作的五个关键姿势：

1. 自然站立 / anticipation
2. 动作准备
3. 动作启动
4. 动作峰值 / 保持
5. 动作收尾 / 回到待机

Tao 必须生成结构对应的 10 张动作参考图：

- `tao_wave_01.png` ～ `tao_wave_05.png`
- `tao_heart_01.png` ～ `tao_heart_05.png`

两套动作板必须保持相同画布、角色高度、脚底基线、镜头距离、透明背景、节拍结构，且无文字、水印、背景和多余阴影。

Tao wave：肩部高度轻挥、略微前倾、掌心打开、动作克制自然。Tao heart：优先单手 finger-heart，另一只手自然下垂或轻扶领带，可额外制作双手爱心版本但不能替代基础版本。

Tao 还需规划：`tie_adjust`、`thumbsup`、`shy_lookaway`、`offer`、`pat`、`poke_react`、`receive`、`hug_open`。

动作板只用于设计、沟通和验收；正式运行时必须使用 Cubism 参数、部件可见性、`pose3.json`、`physics3.json` 和 `motion3.json`。

## 5. 资产生产管线

AI 可用于：参考放大、遮挡区域补画方案、动作 storyboard、姿势控制参考、身份差异检查和低成本动作预演。

AI 不得直接作为：最终 PSD、正式纹理、MOC3、动作运行时帧或身份设计来源。

正式管线：

1. 冻结造型基准和颜色/比例表。
2. 为 wave、heart 和核心动作分别制作关键姿势板。
3. 人工高分辨率重绘隐藏区域和可动部件。
4. 制作标准 PSD 分层，准备独立手型、手臂替换件和遮挡补画。
5. 在 Cubism 中绑定标准参数、物理和动作。
6. 输出标准运行时文件和三档纹理。
7. 在 Web/PWA 真机环境验收。

建议统一参数：`ParamHandL`、`ParamHandR`、`ParamShoulderY`、`ParamArmL`、`ParamArmR`、`ParamHairFront`、`ParamHairSide`、`ParamHairBack`。主要动作按 30fps 制作，同时检查 15fps 和 60fps。

## 6. 产品信息架构

### 陪伴

Jing/Tao 常驻舞台、自然待机、轻触/长按、短句气泡、状态表达、双人共同场景。

### 回忆

互动时间线、SharedMoment、第一次互动、第一次拥抱、自定义纪念日、搜索/筛选/删除/回放。

### 我的

身份和关系、状态可见性、角色包和衣橱、授权、解绑、数据删除、通知和存在感设置。

离线事件默认不强制播放，显示“TA 来过”，由用户选择回放。

## 7. 领域和事件契约

领域对象：`PersonAvatar`、`Relationship`、`PresenceState`、`InteractionEvent`、`SharedMoment`、`Memory`、`Consent`。

统一事件格式：

```json
{
  "schemaVersion": "1.0.0",
  "eventId": "uuid",
  "type": "interaction.requested",
  "relationshipId": "uuid",
  "senderId": "uuid",
  "receiverId": "uuid",
  "actionId": "wave",
  "choreographyId": null,
  "clientOccurredAt": "ISO-8601",
  "serverOccurredAt": "ISO-8601",
  "payload": {},
  "privacy": {},
  "status": "accepted"
}
```

规则：`eventId` 幂等；服务端是最终权威；客户端忽略未知字段；major schema 变化必须有迁移器；动画失败不影响事件保存；未知动作按语义降级，禁止按 TapBody 下标取模。

## 8. 双人编排契约

双人动作状态：`requested → accepted → preparing → ready → playing → completed`，失败可为 `partial` 或 `failed`。

服务端创建 `momentId`，广播 `moment.prepare`，包含 `choreographyId`、角色能力、`serverStartAt` 和锚点配置；两端返回 ready 后广播 start。客户端只同步开始时间、阶段标记和完成状态，不逐帧同步 Cubism 参数。

阶段固定为：`approach`、`contact`、`hold`、`release`、`return`。

## 9. 技术边界

继续使用：pnpm、React、TypeScript、Vite、Socket.IO、SQLite、PWA。

过渡使用：PixiJS 6、`pixi-live2d-display@0.4.0`、现有旧模型和 LegacyPixiAdapter。

新增：Cubism5WebAdapter、共享 contracts、schema 校验、Vitest、Playwright、资产 manifest 校验器、动作能力校验器、IndexedDB/Cache Storage 缓存。

设计基线为 Node.js 24 LTS、React 19.2、Vite 8.x、Cubism SDK for Web R5；实施时重新核验并锁定具体版本。

## 10. 降级契约

动作：精确动作 → 同语义动作 → 通用反应 → 中性待机+气泡 → 只保留事件。

资产：同版本缓存 → 兼容旧模型 → 安全占位态；不能白屏、不能重复发送事件。

网络：Socket → REST → 本地 outbox；重连按 `eventId` 去重。

## 11. 验收门禁

- Jing/Tao 在静态、转头、抬手、坐姿和双人动作中身份一致。
- wave/heart 动作有前摇、峰值保持和收尾。
- 头发、领带、衣物和手型无明显穿插或撕裂。
- 双人接触点稳定，离线/弱网可回放。
- 页面无等级、任务、积分和关系评分。
- 首次互动、首次拥抱和纪念日可回看、删除。
- 重复事件不重复写入，动画失败不影响事件保存。
- 高/中/低 LOD 均可用，双模型移动端稳定。
- 构建、单元测试、契约测试、E2E 和资产校验全部通过。

## 12. 官方参考

- [Cubism PSD Import](https://docs.live2d.com/en/cubism-editor-manual/psd-import/)
- [Pose Switching](https://docs.live2d.com/en/cubism-editor-manual/change-pose/)
- [Embedded Data Export](https://docs.live2d.com/en/cubism-editor-manual/export-moc3-motion3-files/)
- [Standard Parameters](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/)
- [Physics](https://docs.live2d.com/en/cubism-editor-manual/physics-operation/)

