# V1.2 小火人化（轻养成 + App 壳）设计 Spec

> 日期：2026-09-04
> 方向：方向 A（轻养成）——现有双 Live2D 分身保留，叠加养成体系与 App 化界面
> 参考：抖音"小火人"（合养精灵/成长值/每日任务/续火花/断联变灰）调研结论
> 状态：已确认方向，待实施

## 1. 目标

把现有"数字分身陪伴 WebApp"从"网页工具感"升级为"软件/App 感"的高互动陪伴产品：
1. App 化壳：手机优先 + 底部 Tab 导航 + PWA 可添加到主屏幕
2. 强互动：底部互动 Dock（喂食/摸摸/戳戳/抱抱/送花），点击即时反馈
3. 养成感：火花值/等级/连续天数（续火花）+ 每日任务，双端实时同步

## 2. 范围

**做**：App 壳（Tab 导航 + PWA manifest）、互动 Dock（5 个动作）、火花成长体系（7 级）、
连续互动 streak（软惩罚）、每日任务（3 个）、Socket 实时同步、服务端权威结算。

**不做（二期）**：合养精灵新角色、装扮/货币系统、改名、离线 Service Worker 缓存、
分身点击部位差异化反应。

## 3. 界面形态（前端）

### 3.1 Tab 壳
- `App.tsx` 增加 `tab` state：`companion | quests | records | me`
- 顶部保留精简标题栏；底部固定 Tab 导航（4 个 Tab）
- **canvas（Pixi 舞台）常驻不卸载**，切 Tab 用不透明面板覆盖（避免 Live2D 重载开销）
- 各 Tab 内容：
  - 🏠 陪伴：全屏 Live2D 舞台 + 顶部关系卡 + 底部互动 Dock
  - 🎯 任务：每日任务进度 + 续火花提醒卡
  - 💞 记录：现有互动时间线整体迁移
  - ⚙️ 我的：身份卡（名字/人格预设/主题切换 🎨 按钮/邀请入口）

### 3.2 陪伴主屏
- 关系卡：`阿泰 ♡ 小美` + 火花等级徽章（Lv.N + 名称）+ `🔥 连续 N 天`
- 火花进度条：当前等级 → 下一等级进度
- 互动 Dock：🧁喂食 / 🫳摸摸 / 👉戳戳 / 🤗抱抱 / 💐送花
  - 点击 → 本地即时反馈（分身动作 + 表情 + 粒子）→ socket `interaction` → 服务端结算 → 双端 `growth_update`
  - 新动作 ID：`feed`（🧁）、`flower`（💐），加入现有 ACTIONS 列表与 avatar.ts 动作映射
    （复用现有 TapBody/表情系统；映射缺失时回退 idle+开心表情，保证任何模型可用）

### 3.3 断联软惩罚（纯展示，不删数据）
- 判定：`今天 > last_active_day` → 火花变灰、关系卡显示"火花休息中"
- 分身沮丧表情：仅当该分身自己的状态为 neutral 时叠加 `setMood('low')`（用户显式设置的心情优先，避免与状态系统冲突）
- 任务页顶部提醒卡："今天你们还没互动，互相任意互动 1 次即可复燃"
- 互动后立即恢复（last_active_day 更新为今天）

## 4. 成长体系数值（服务端权威）

### 4.1 火花值（growth，挂在 bond 上）
| 行为 | 火花 | 每日上限 |
| --- | --- | --- |
| 任意互动动作（戳/摸/抱/心/挥手/捏脸） | +1 | 合计 30 |
| 喂食 / 送花 | +2 | 各每天最多 5 次（超出发互动但不加火花） |
| 每日任务（3 个，见 4.3） | 各 +10 | 任务一次性 |

- 每日软上限按 `growth_events` 中当天 reason 计数校验，超限只给互动不给火花（静默）

### 4.2 等级（服务端计算）
| Lv | 名称 | 阈值 |
| --- | --- | --- |
| 1 | 火种 | 0 |
| 2 | 火苗 | 100 |
| 3 | 小火人 | 300 |
| 4 | 烈焰 | 700 |
| 5 | 燎原 | 1500 |
| 6 | 不灭 | 3000 |
| 7 | 永恒 | 6000 |

可视化：关系卡徽章 + 主屏背景光晕强度随等级提升。

### 4.3 每日任务（按 bond 当天 events 计算，无需新表）
1. 🤝 互相互动 5 次（双向互动计数）→ +10
2. 💬 说一句话（任意一方发过 message）→ +10
3. 🎂 给 TA 喂一次食（action=feed）→ +10
- 奖励一次性：以 `growth_events.reason = 'quest:<id>:<YYYY-MM-DD>'` 判重

## 5. 数据模型（server/src/db.js）

```sql
-- bonds 加列（ALTER TABLE IF NOT EXISTS 兼容迁移）
ALTER TABLE bonds ADD COLUMN growth INTEGER DEFAULT 0;
ALTER TABLE bonds ADD COLUMN streak INTEGER DEFAULT 0;
ALTER TABLE bonds ADD COLUMN last_active_day TEXT;   -- 'YYYY-MM-DD'

-- 新表：火花流水（结算审计 + 任务判重 + 每日上限校验）
CREATE TABLE IF NOT EXISTS growth_events (
  id TEXT PRIMARY KEY,
  bond_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,      -- 'interaction' | 'feed' | 'flower' | 'quest:poke5:2026-09-04' ...
  day TEXT NOT NULL,         -- 'YYYY-MM-DD'
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

## 6. API（server/src/index.js）

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/bond/:userId` | 返回 `{ bond: { growth, level, levelName, nextLevelAt, streak, lastActiveDay, cold } }`（cold=今天是否断联）；未绑定返回 `{ bond: null }` |
| `GET /api/quests/:userId` | 返回 `{ quests: [{ id, label, target, progress, done, reward }], streak, lastActiveDay }` |

互动结算并入现有 socket `interaction` handler（见 §7）。

## 7. Socket 事件

- 现有 `interaction` handler 内追加结算逻辑：
  1. 落库 events（现状保留）
  2. 计算 streak：`last_active_day == today` 不变；`== yesterday` streak+1；否则 streak=1；更新 last_active_day
  3. 计算火花增量（§4.1 上限校验）→ 更新 bonds.growth → 写 growth_events
  4. 任务奖励判重发放（§4.3）
  5. **双端** emit `growth_update`：`{ growth, delta, level, levelName, streak, lastActiveDay, cold, leveledUp }`
     （leveledUp=true 当本次跨级，前端播放升级特效）
- 客户端：`connectSocket` 增加 `growth_update` 处理 → 更新关系卡/徽章/进度条/光晕

## 8. PWA（软件形态关键）

- `client/public/manifest.json`：name `数字分身`、display `standalone`、theme_color、SVG 图标（192/512 各一，或 vector SVG）
- `client/index.html`：`<link rel="manifest">` + `theme-color` meta + apple-touch-icon
- 不引入 vite-plugin-pwa（YAGNI，manifest 即可满足"添加到主屏幕全屏启动"）

## 9. 错误与边界

- 未绑定用户：Dock 动作本地可玩但不结算（无 bond）；关系卡显示"还没绑定 TA"+ 邀请入口
- growth 结算失败不阻塞互动播放（try/catch，互动体验优先）
- 跨天边界：以服务器本地时区 `YYYY-MM-DD` 为准（与现有 events 表一致）
- 多设备同账号：结算按 bond 幂等，重复互动只会多计 spark 不产生错误

## 10. 验收标准（对应 ACCEPTANCE.md 新增 F7-F10）

- F7 App 壳：手机浏览器打开 → 底部 4 Tab 切换正常，添加到主屏幕后全屏启动无浏览器地址栏
- F8 互动 Dock：点击 5 个动作均触发分身反馈，对方端实时看到同样动作与粒子
- F9 火花成长：互动后双端火花值/等级同步（growth_update）；达到阈值跨级时双端出现升级提示
- F10 续火花：当天首次互动 streak+1；次日不互动 → 火花变灰+沮丧表情+提醒卡；再互动立即复燃

## 11. 部署

- `pnpm build` → dist 部署（保留 dist_old 回滚，沿用 deploy-dist.sh 流程）
- server 变更 → deploy-server.sh 重启（node:sqlite 已在用 node22）
- CHANGELOG / ACCEPTANCE / ARCHITECTURE §6.4 按项目约定更新并归档 versions/
