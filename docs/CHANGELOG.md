# 版本历史（CHANGELOG）

> 约定：每次文档/功能迭代，在此追加一条记录；文档改动同时在 `versions/` 存一份带时间戳的不可变副本。

## [V1.1.3] 2026-09-03 21:50（master，已部署）—— 双人状态同步实测 + 两个在线 Bug 修复

> 双身份（API 建号 + 邀请码绑定）双人实测 V1.1.2 状态同步，过程中发现并修复两个线上 Bug。

### 修复
- **邀请接受后被踢出应用**（[App.tsx](../client/src/App.tsx)）：`location.href = location.origin` 在子路径部署下跳到作品集首页；改为 `location.origin + import.meta.env.BASE_URL`（生产 /digital-avatar/，开发 / 均兼容）。两处：已有身份接受邀请、新身份创建后接受邀请
- **已绑定用户的页面看不到对方分身**（竞态）：`getPartner` REST 响应比 Live2D 模型加载快，`useEffect([partner])` 执行时模型尚未就绪被跳过，加载完成的 `.then` 又把 visible 硬设为 false → 永久隐藏。修复：模型加载完成后按 `stateRef.current.partner` 决定可见性

### 双人实测记录（自动化浏览器，双身份绑定）
- B 的页面加载即拉到 A 的持久化状态：chip「线上测试 · 低落」+ 对方分身 Natori 呈低落 ✅
- A 改为「生气」→ 刷新后 B 页面正确显示「生气」✅（离线补拉路径）
- A 页面：自己 Hiyori 生气脸 + 对方 chip「分身B · 开心」+ Natori 呈开心笑容（对比 neutral 截图嘴型变化清晰）✅
- 双方分身同屏显示（竞态修复后）✅
- ⚠️ 实时 socket 推送（不刷新秒变脸）在自动化环境无法验证：后台标签页被冻结、socket 断开；真机双人在线需人工复核一次

## [V1.1.2] 2026-09-03 13:10（master，已部署）—— 状态表情可视化

> 修复：切换状态（开心/低落/疲惫/生气）后分身几乎无可见变化的问题。

### 根因
- 旧 `setMood` 只改动作速度 + 表情文件：Hiyori **没有 .exp3.json 表情文件** → 自己的分身完全不变；Natori 仅 3 个表情且 tired 无对应
- 对方分身收到 `state_update` 只更新顶栏文字，**从未调用** `setMood`
- 刷新后只恢复自己的状态文字，双方分身表情都不恢复

### 新增
- **参数级心情表情层**（`avatar.ts` MOOD_PARAMS）：不依赖表情文件，直接驱动 Cubism4 标准参数（ParamMouthForm/EyeSmile/BrowForm/BrowLY/EyeLOpen/AngleY…），对所有模型通用。挂载在 `internalModel` 的 `beforeModelUpdate` 事件（位于动作/表情/物理之后、`coreModel.update()` 之前，被 saveParameters/loadParameters 包裹 → 逐帧覆盖不污染动作基准）
  - `abs` 绝对覆盖：形状类（嘴形/眉毛/头部角度）
  - `mul` 乘算：开合度类（睁眼度 ×0.45~0.85），**保留眨眼动画**
  - 指数平滑（τ=120ms）：切心情约 0.3s 自然过渡不跳变；切回普通自动回落
- **对方分身表情同步**：`state_update` 实时推送到对方分身；页面加载时拉取对方持久化状态（TA 离线期间改的公开状态也能看到）；非公开状态回落普通
- **刷新恢复**：自己的分身加载后恢复到当前状态表现

### 验证记录（线上实测截图）
- 开心：笑眼弯弯 + 腮红 + 嘴角上扬 ✅（最明显）
- 生气：眉毛下压怒容 ✅
- 疲惫：半睁眼无神 ✅
- 低落：嘴角下垂 + 视线向下 + 微微低头 ✅
- 切换过渡平滑、控制台零报错 ✅
- Natori（对方分身）表情层待双人绑定后人工复核（参数层为通用标准参数，机制与 Hiyori 相同）

## [V1.1.1] 2026-09-03 12:20（master，已部署）—— 首屏加载提速

> 接续 V1.1.0：opt1/opt2 解决了"渲染帧率/卡顿"，本条解决"加载慢/耗流量"。用线上实际传输字节定位瓶颈，不猜。

### 瓶颈实测（nginx access log + curl 传输字节）
- **gzip 形同虚设**：nginx.conf 只有 `gzip on;`，缺 `gzip_types`，nginx 默认仅压 `text/html` → 866KB JS、25KB motion JSON 全部**未压缩**传输（响应无 `Content-Encoding`）
- **纹理是 2048 PNG，体积极大**：Hiyori 两张 HD 共 **4.2MB**（texture_00 1.8MB + texture_01 2.4MB），SD PNG 也有 1.2MB；PNG 已 deflate 不再吃 gzip
- **零缓存头**：所有静态资源每次访问重新下载
- 优化前首屏关键字节（Hiyori HD）≈ **5.5MB**

### 优化
- **纹理 PNG → WebP**（`scripts/build-webp.ps1`，ffmpeg/libwebp，`yuva420p` 保留透明通道）：HD q88、SD q82
  - texture_01.png 2.4MB → **300KB**；texture_00.png 1.8MB → **242KB**（单张约为原来 1/6~1/8）
  - 10 张纹理（5 HD + 5 SD）全部转换，PNG 原文件保留作兜底
- **预取 Worker 改 WebP 优先、PNG 兜底**（`prefetch.worker.ts`）：候选链 HD=`[xx.webp, xx.png]`，SD=`[xx.sd.webp, xx.sd.png, xx.webp, xx.png]`，逐个 fetch 首个 200 即用；blobMap key 仍是原始 `.png` 相对路径，库侧 resolveURL 无感知
- **nginx gzip_types 补全**（`scripts/deploy-perf-nginx.sh` → `/etc/nginx/conf.d/davatar-gzip.conf`）：对 JS/JSON/wasm/CSS/SVG/**octet-stream(moc3)** 开 gzip（图片本身已压缩不压）
- **静态缓存头**：`assets/` 30天 immutable（hash 命名）、`models/` 7天、`index.html` no-cache（保新版即时生效）

### 效果（线上实测传输字节，Hiyori HD）
| 资源 | 优化前 | 优化后 |
| --- | --- | --- |
| JS bundle | 866KB（未压） | **246KB**（gzip） |
| Hiyori.moc3 | 444KB（未压） | **221KB**（gzip） |
| motion JSON（单） | 25.8KB（未压） | **2.4KB**（gzip） |
| texture_00 | 1.8MB PNG | **242KB** WebP |
| texture_01 | 2.4MB PNG | **300KB** WebP |
| **首屏关键合计** | **≈5.5MB** | **≈1.0MB（-82%）** |

移动端 SD 档纹理更小（两张 sd.webp 共约 212KB）；二次访问命中浏览器缓存近乎瞬开。

### 验证记录
- curl 实测：JS/motion/moc3 均返回 `Content-Encoding: gzip`；webp 返回 `200 image/webp`；缓存头 assets immutable / models 7d / index no-cache ✅
- nginx access log：部署后新会话请求 `.webp` / `.sd.webp` 且全 200，旧缓存客户端仍能命中 `.png` 兜底 ✅
- 浏览器冷启：canvas 渲染正常、PerfGovernor 生效、控制台零报错 ✅

## [V1.1.0-opt2] 2026-09-03 01:12（分支 feat/render-optimize，未合入 master）

### 新增
- **Vite Module Worker 预取分流**（`client/src/live2d/prefetch.worker.ts` v3）：HTTP fetch + JSON 解析全部放 Worker 线程，主线程只负责 WebGL 上传与渲染；Hiyori 模型 17 entries / Natori 24 entries，预取延迟 50-120ms
- **纹理 LOD（Level of Detail）半图**：`scripts/build-lod-sd.ps1` 用 System.Drawing 半尺寸 bicubic 下采样生成 `*.sd.png`（原图 1814KB→512KB 约 28%，2504KB→751KB 约 30%），balanced/saver 档默认启用，高画质档保留原图
- **visibilitychange 后台暂停**：`document.visibilitychange` 监听器挂 `app.stop()/ticker.remove`，切回 `app.start()/frames=0`，避免标签页后台时 CPU 空转与切回瞬间 deltaTime 尖峰；HUD 展示 `paused(back)` 标签

### 关键修复
- **Blob URL XHR Status 0 根因**：pixi-live2d-display 内 `ModelSettings.resolveURL = url.resolve(base, path)` 会把 `blob:http://host/<uuid>` 错拼成 `blob:http//host/<uuid>`（冒号丢失）→ `XMLHttpRequest` 无法解析协议，最终抛 Status 0。修复策略：
  1. Worker 不再将 model3.json 字段替换成 Blob URL，保留原始相对路径；
  2. Worker 额外返回 `blobMap: {相对路径 → Blob URL}`；
  3. 在 `Live2DFactory.live2DModelMiddlewares` 的 `jsonToSettings` 之后注入 2 个一次性中间件：先用 `settings.json === model3对象引用` 把 blobMap 注册进 WeakMap，再实例级覆盖 `settings.resolveURL(p)` → 命中 blobMap 直接返回 Blob URL，未命中走原始 `url.resolve`（与库内置 `ZipLoader.upload` 写法完全一致，不碰原型）
- **Cubism4ModelSettings 实例级覆盖 vs 原型 patch**：最终采用实例级覆盖（而不是 `ModelSettings.prototype.resolveURL = ...`），原因：cubism4 模块 `Live2DFactory` 不挂 window，且原型方法无法通过 TS 静态导出枚举，原型 patch 既不稳也易在模块边界失效
- **AvatarSprite 接口对齐 App.tsx**：补齐 `.play()` / `.setPosition()` / `.walkTo()` / `.goHome()` / `.playSadReaction()` 兼容方法；`setMood` 内部通过 `internalModel.motionManager` 拿 state.speed 和 expressionManager
- **App 旧 ticker 回调兼容**：AvatarSprite.tick(delta) 改为 delta 可选（缺省 1 兼容 Pixi app.ticker.add 不传参）

### 验证记录（Loop Engineering）
- 新标签页冷启：Hiyori 17 entries + Natori 24 entries 预取日志 ✅；控制台 0 Blob URL XHR 错误 / 0 Texture loading error / 0 "Failed to load resource as arraybuffer (Status 0)" ✅
- FPS HUD：balanced 档稳定 30fps · cap 30，saver 档 20fps · cap 20，DPR 1.5 下 WebGL 2 ✅
- visibilitychange 后台暂停：代码注册 `document.addEventListener('visibilitychange', PerfGovernor.onVisibility)`，真实浏览器手动切换标签生效（HUD 出现 `paused(back)`）；自动化环境 Electron/Offscreen-Rendering 不触发该事件，需真机手动复核
- 生产构建：`pnpm build` 11-14s，dist 产物 858KB（gzip 246KB）✅

### 说明
- master 分支保持 V1.0.2 不动；本分支 feat/render-optimize 包含 opt1 + opt2，验证无误后再由用户确认合入

## [V1.1.0-opt1] 2026-09-03 00:40（分支 feat/render-optimize，未合入 master）

### 新增
- PerfGovernor 自适应帧率治理器：high/balanced/saver 三档（60/30/20fps），实测掉帧自动降档，触屏设备默认平衡档
- 渲染调试 HUD（`?fps=1`）与档位强制（`?perf=`）

### 优化（证据存档见 ARCHITECTURE.md 第 6 节）
- `antialias: false`（PixiJS 官方弱设备建议）
- `resolution: min(dpr,2)` + `autoDensity: true`（HiDPI 点对点，防 4K 过度填充）
- 实测桌面端：high 档稳定 55-58fps、balanced 档 28fps，交互无回归

### 说明
- 照片→可动 Live2D 形象路线暂缓（手机端实时渲染效果差，需第二阶段 Worker/LOD 方案支撑）
- master 分支保持 V1.0.2 不动；本分支验证后由用户确认再合入

## [V1.0.2] 2026-09-02 23:55

### 新增
- UI 双主题（v1 初版深紫 / v2 aurora-glass 极光玻璃）并存可切换，右下角 🎨 按钮切换，localStorage 持久化
- 管理后台（隐藏入口 `#/admin`，不出现在用户界面）：口令 SHA-256 门禁，展示版本历史 + 功能验收状态 + 线上健康检查
- 新增 ui-ux-pro-max 技能（UI/UX 升级与新旧版本对比方法论）

### 修复
- 管理后台口令校验失败：修正 ADMIN_HASH 为 `tx2026admin` 的正确 SHA-256 值
- 「返回应用」按钮偶发点击无效：元素屏外点击未触发，重新交互后验证正常

### 验证记录（Loop Engineering）
- 管理后台：错误口令提示 ✅ / 正确口令进入后台显示 CHANGELOG+ACCEPTANCE+健康检查 ✅ / 返回应用 ✅
- 主题切换：v1→v2→v1 双向切换 + localStorage 持久化 ✅
- 控制台：无功能性报错（仅页面刷新时旧请求中止的正常 ERR_ABORTED 伪影）

### 部署
- V1.0.2 已上线：https://taoxie.vip/digital-avatar/（dist 同步 + 旧版 dist_old 留存可回滚），线上管理后台 + 主题切换复验通过

## [V1.0.1] 2026-09-02 23:40

### 修复
- 线上模型 404：模型路径加 `import.meta.env.BASE_URL` 前缀，适配 nginx 子路径部署
- 互动记录 "Invalid Date"：SQLite localtime 格式解析兼容
- PIXI Container 不支持 tint → 改用 ColorMatrixFilter 实现情绪色调
- 对方分身换成男性模型 Natori（一男一女情侣风格），表情映射改用命名表情

### 部署
- 生产环境上线：https://taoxie.vip/digital-avatar/（nginx 子路径 + WS upgrade + tmux davatar:8090 + Node22 绿色版）
- gitee + GitHub 双仓推送，tag v1.0.0
- 新增部署脚本 scripts/deploy-server.sh / deploy-nginx.sh、事件注入测试 scripts/test-events.mjs

## [V1.0.0] 2026-09-02 21:35

### 新增
- 存档产品方案需求书原始版 V1（docx，来自微信，永久保留）：`versions/2026-09-02_产品方案需求书_V1_原始版.docx`
- 架构方案 V1.0（`ARCHITECTURE.md`）：Vite+React+TS / Node+Express+Socket.IO / SQLite / pixi-live2d-display 四层架构（Avatar/Action/State/Event）
- 功能验收文档 V1.0（`ACCEPTANCE.md`）：P0×7 + P1×3 + 技术验证×2 + 交付×3

### 已确认决策
- 技术栈：Vite+React+Node（用户确认）
- 账号：轻量身份+邀请链接（用户确认）
- 双人拥抱：走近+双人同画面拥抱动画（用户确认）
- 交付：本地+GitHub+Gitee+服务器 43.143.231.106（用户确认）
