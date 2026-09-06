# 男性全身模型调研与接入方案（V1.6.3 预研）

> 背景：V1.6.2 取证确认 Chitose 是官方半身模型（cdi3 无「下半身」部件），腿物理不可补。
> 用户需求：找"高富帅"全身男性模型补位。本文档沉淀 2026-09-06/07 两轮调研结论与接入方案。
> 状态：office_m.zip 已下载至 `client/office_m.zip`（35.8MB），**尚未接入**，待排期。

## 一、候选全景与排除过程

### 1. Live2D 官方示例库（zh-CHS sample 页逐个核验）

| 模型 | SDK 版本 | 形象 | 结论 |
|---|---|---|---|
| Chitose | 3.0(3.2) | 温柔青年 | **半身**（V1.6.2 已按胸像构图处理） |
| Natori | 3.0(3.2) | 西装管家 | 全身男性，**已在项目**；合作角色禁改禁商用 |
| Kei | **5.0** | — | Cubism 5 导出，与 pixi-live2d-display 0.4.0 + Cubism 4 core 不兼容（Ren Foster 5.3 前车之鉴）❌ |
| Epsilon | 4.0 | **双马尾少女**（缩略图取证） | 非男性 ❌ |
| Hibiki | 3.0(3.2) | **水手服少女**（缩略图取证） | 非男性 ❌ |
| Haruto | 3.0(3.2) | SD 二头身男孩 | 全身但 Q 版，不"高富帅" ❌ |

**结论：官方免费库内没有第三个成年男性全身模型。**

### 2. 国内渠道（B 站皮套生态 + 模之屋）

| 渠道 | 发现 | 授权判定 |
|---|---|---|
| B站免费/量贩皮套 | 万物社「夹克青年」、白虎、DK 男子高中生等，形象对口 | 使用须知均为「**仅授权给个人（主播）直播使用，禁止一买多用，非买断**」——授权对象是直播场景，**网页应用部署不在授权范围** ❌ |
| B站同人配布 | 陈俊南（十日终焉同人） | 同人版权，作者自述勿商用 ❌ |
| 模之屋 aplaybox | Live2D 资源多，免费 | 协议五花八门，多为「禁商用+禁二次配布」；网页部署=文件上服务器=二次配布灰区，需逐个人工筛 ❓ |
| CSDN/gitcode 镜像 | live2d-widget-models 等 | 全是 **Cubism 2**（.moc/.mtn），与 Cubism 4 core 不兼容 ❌ |

**结论：国内"免费皮套"生态围绕直播授权构建，没有适合嵌入网页应用的授权模式。**

### 3. Booth（最终选定）：office_m 西装男

- 来源：<https://booth.pm/ja/items/5178925>（作者 おおいえ；nizima 预览 <https://nizima.com/Item/DetailItem/88455>）
- 价格：**免费**；授权：**个人・商用自由、改変自由、事前申请不要、报告不要**；仅"二次配布ご遠慮"（软性请求，非禁止）
- **本地实证（已验）**：
  - `office_m.moc3` 版本字节 = **4** → 与项目 Cubism 4 core 兼容 ✅
  - 结构：1×moc3 + 4×2048 纹理 + physics3.json + model3.json
  - **16 组表情**（exp_00~15，各带配套 motion3.json）+ 9 姿势 + 2 待机动作（页面宣称）
  - 含 **cmo3 源文件**（Cubism Editor 工程）→ 后续可自行改造（如换色/改配饰）
- 风格：正装青年，可切眼镜/多套服装，正合"高富帅"

## 二、接入方案（实施 checklist）

1. **落盘**：解压 `office_m/` → `client/public/models/officem/`（改短名），保留 cmo3 于本地不入库
2. **入库卫生**：`client/office_m.zip` 加入 `.gitignore`（35MB 授权二进制**严禁进 git 仓库**=二次配布）
3. **纹理管线**：跑现有脚本生成 WebP（含 PNG fallback）+ `.sd.png` LOD 缩略
4. **注册**：[models.ts](../../client/src/live2d/models.ts) 增加 `{ id: 'officem', label: 'Office M', tag: '西装精英', gender: 'm' }`（全身模型，**不加 halfBody**，自动享受 74% 视口高归一 + 脚底锚定）
5. **动作适配**：核对 model3.json Groups（Idle/TapBody 命名），必要时按 avatar.ts ACTION_MOTIONS/MOOD_RULES 改组名（Chitose 同款经验）；2 待机动作接入桌宠 idle 循环
6. **服务端**：`server/src` 初始形象库加 officem（gender 过滤男色板）
7. **署名合规**：页脚 Live2D 版权声明处追加「Office M © おおいえ（Booth）」，README 致谢节同步
8. **验证**：本地 verify-invite 9/9 + verify-v160 13/13；目检（全身/腿完整/身高归一/桌宠 idle）
9. **部署**：dist tar → 备份 dist.bak.<TS> → 原子换 → 生产双 E2E
10. **归档**：CHANGELOG/ACCEPTANCE V1.6.3 + versions 时间戳副本，双远端提交（Gitee 先行）

## 三、风险与对策

| 风险 | 对策 |
|---|---|
| "二次配布ご遠慮"（软性） | 页脚+README 双处署名出处；不打包源 cmo3；只托管 runtime 必需文件；项目非商用 |
| model3.json 可能含日文路径/注释 | JSON.parse 严格校验（Chitose 踩过 //注释 的坑），必要时清洗 |
| 表情 motion 命名不合 ACTION_MOTIONS | 组名重命名映射（Chitose Tap→TapBody 同款手法） |
| 16 表情全量加载内存 | 仅注册 MOOD_RULES 需要的子集，其余惰性 |

## 四、决策记录

- 2026-09-06：官方库+国内渠道调研完成，判定无合格现役候选；Booth office_m 锁定
- 2026-09-07：office_m.zip 到位，moc3 v4 兼容性实证通过；接入排期待用户指令
