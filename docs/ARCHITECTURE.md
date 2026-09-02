# 数字分身陪伴 Web App · 技术架构方案

> 文档版本：V1.0（2026-09-02 21:35）
> 依据：[产品方案需求书 V1 原始版](./versions/2026-09-02_产品方案需求书_V1_原始版.docx)
> 每次架构迭代：修改本文档 → 在 `versions/` 存档带时间戳副本 → 更新 CHANGELOG

## 1. 技术选型（已联网调研确认，2026-09-02）

| 层 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 前端构建 | Vite | 5.x | 秒级 HMR，2026 主流 |
| 前端框架 | React | 18.x | 生态最成熟 |
| 语言 | TypeScript | 5.x | 全栈类型安全 |
| Live2D 渲染 | pixi-live2d-display | 0.4.x | MIT 开源，社区唯一活跃统一方案 |
| 渲染引擎 | PixiJS | 6.5.x | 与 pixi-live2d-display 0.4.x 兼容 |
| Cubism Core | live2dcubismcore.min.js | Cubism 4 | 官方运行时；个人/年营收<1000万日元免费 |
| 后端 | Node.js + Express | 22 LTS | 轻量，与前端同语言 |
| 实时通信 | Socket.IO | 4.x | 自动重连/房间/降级，社区共识优于裸 WS |
| 数据库 | SQLite (better-sqlite3) | — | 零配置，MVP 够用，字段设计兼容未来 Postgres |
| 样式 | 原生 CSS (CSS Modules 可选) | — | MVP 不引入额外复杂度 |

**许可合规**：pixi-live2d-display 为 MIT；Cubism SDK 对个人/小规模免费（Live2D 官方许可表）；示例模型 Haru/Hiyori 为官方免费素材（Free Material License，小规模可用）。

## 2. 系统分层（与需求书第二十一节对齐）

```
┌─────────────────────────────────────────────┐
│  前端 (Vite+React+TS)                        │
│  ┌─────────┐ ┌─────────┐ ┌────────────────┐ │
│  │ Avatar层 │ │ Action层 │ │ State层        │ │
│  │ Live2D   │ │ poke/    │ │ happy/sad/...  │ │
│  │ 模型渲染  │ │ pat/hug  │ │ 视觉规则映射    │ │
│  └─────────┘ └─────────┘ └────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │ Event层：互动事件 → 本地播放 + Socket.IO  │ │
│  └─────────────────────────────────────────┘ │
└──────────────┬──────────────────────────────┘
               │ Socket.IO (ws)
┌──────────────▼──────────────────────────────┐
│  后端 (Express + Socket.IO)                  │
│  REST: 身份/关系/事件记录   WS: 事件实时推送   │
└──────────────┬──────────────────────────────┘
               │
        SQLite (users / bonds / events / states)
```

### 四层职责
- **Avatar 层**：Live2D 模型加载、渲染、拖拽定位、闲置行为（眨眼/呼吸/探头）
- **Action 层**：统一动作 ID（poke/pat/hug/heart/wave...），动作资源与角色解耦
- **State 层**：心情状态（happy/low/tired/angry），控制表情、动作速度、可见性
- **Event 层**：`event_id / sender_id / receiver_id / action_id / timestamp / state_snapshot / status / message`，动画播放失败不影响记录落库

## 3. 目录结构

```
Digital-avatar/
├── docs/                    # 版本化文档
│   ├── ARCHITECTURE.md      # 本文档（最新）
│   ├── ACCEPTANCE.md        # 功能验收文档
│   ├── CHANGELOG.md         # 版本历史
│   └── versions/            # 每次迭代的不可变存档
├── client/                  # Vite + React + TS
│   ├── public/
│   │   ├── live2d/          # Cubism Core（本地化，不依赖 CDN）
│   │   └── models/          # Live2D 模型（Hiyori/Haru）
│   └── src/
│       ├── live2d/          # Avatar 层封装
│       ├── actions/         # Action 层（动作定义/映射）
│       ├── states/          # State 层
│       ├── events/          # Event 层（socket 客户端）
│       └── pages/           # 页面
└── server/                  # Express + Socket.IO + SQLite
    └── src/
        ├── db.js            # better-sqlite3
        ├── routes/          # REST
        └── socket.js        # 实时事件
```

## 4. MVP 关键决策（用户已确认 2026-09-02 21:20）

1. **技术栈**：Vite+React+Node（而非 Next.js/Vue）
2. **账号**：轻量身份——昵称创建 + 邀请链接绑定，不做注册登录
3. **双人拥抱**：走近 + 双人同画面拥抱动画（需求书 MVP 降级策略），不做完整双人骨骼同步
4. **交付**：本地运行 + GitHub/Gitee 双推 + 服务器部署（43.143.231.106, taoxie.vip 子路径）

## 5. 部署架构

- 前端 `pnpm build` → `dist/` 静态文件 scp 至服务器，nginx 子路径 `/digital-avatar/`
- 后端 tmux 会话跑 Node 服务（端口 8090），nginx `proxy_pass` + WebSocket upgrade 头
- 服务器：`ubuntu@43.143.231.106`（SSH 密钥 `id_ed25519_audit_server`）
- 仓库：gitee.com/buleboy8065/digital-avatar + GitHub 同步

## 6. 已识别风险

| 风险 | 对策 |
|---|---|
| 双人拥抱需两模型同屏 | 同一 Pixi Application stage 加两个 Live2DModel，独立控制位置/缩放/zIndex |
| 状态"互动后发现"需拦截默认反应 | 事件处理时先查 receiver 当前状态，命中规则则替换反应脚本 |
| Cubism Core 不可再分发 | 仅本地开发使用 + 服务器部署时单独 scp，不进公开仓库（.gitignore） |
| pixi-live2d-display 与 Pixi 版本耦合 | 锁定 pixi@6.5.10 + pixi-live2d-display@0.4.0 |
