# 打工人工作台 · v0.3（待办模块）

新拟态（Neumorphism）风格的可交互高保真原型，含**两种使用模式**：免登录（数据只存本机）与登录（数据云端同步）。

## 运行

### 1. 前端（纯静态，无需构建）

```bash
cd worker-desk && python3 -m http.server 8765
# 打开 http://localhost:8765
```

### 2. 后端（Cloudflare Worker + D1）

```bash
cd worker-desk/server
pnpm install            # 只装 wrangler

# 本地跑（自动创建本地 D1，无需 Cloudflare 账号）
pnpm run migrate:local  # 建表 + 建索引
pnpm run dev            # http://127.0.0.1:8787
```

前端会自动识别：页面跑在 `localhost:8765`（或其它本地端口）时，API 指向 `http://127.0.0.1:8787`。

### 3. 部署到 Cloudflare

```bash
cd server
npx wrangler d1 create worker-desk          # 记下返回的 database_id
# 把 database_id 填进 wrangler.toml 的 [[d1_databases]]

npx wrangler d1 migrations apply worker-desk --remote
npx wrangler secret put CODE_PEPPER         # 验证码/令牌哈希的 pepper，随意长随机串
npx wrangler secret put RESEND_API_KEY      # 可选；不配则走开发模式（验证码回显到页面）

# 改 wrangler.toml 的 ALLOWED_ORIGINS 为前端域名，然后发布
npx wrangler deploy
```

前端部署后需把 `src/api.js` 里的 `API_BASE` 推断结果指向 Worker 域名（或直接写死常量）。

## 账号体系

| 能力 | 实现 |
|---|---|
| 注册 | 邮箱 + 6 位邮箱验证码 + 密码（两次），前端与后端双重校验强度 |
| 登录 | 邮箱 + 密码（最多连续失败 6 次 → 锁 10 分钟） |
| 找回密码 | 邮箱 + 验证码 → 15 分钟内有效的一次性重置令牌 → 重设密码（所有旧会话立即失效） |
| 人机验证 | 自研 PoW：服务端签发挑战（`sha256(salt\|nonce)` 前导 0 比特 ≥ 16），前端 4 个 Web Worker 并行求解；另设隐藏蜜罐字段 `website` |
| 会话 | 32 字节随机不透明 token，DB 只存 `sha256("wd-token:"+raw)`，30 天有效 |
| 密码存储 | PBKDF2-SHA256 210,000 轮 + 16 字节随机盐，定长比较防时序侧信道 |

### 数据同步

- 免登录：只写 `localStorage['wd-data']`，永不外发。
- 登录：本地即时写入 + **5 秒防抖**整包推送云端（`user_state.payload`），并用 `version` 做乐观锁（客户端带 `baseVersion`，冲突返回 `409 version_conflict`）。
- 登录时的数据接管：云端为空 → 把本地数据推上去；云端有数据 → 以云端为准，本地先快照到 `wd-data-before-login`。
- 自动备份：`version % 5 === 0` 时写 `backups` 表，每用户保留最近 5 份，可在「恢复备份 → 云端历史」里回滚。
- 两种模式都支持**下载备份 JSON** 与**导入恢复**（导入前自动留 `wd-data-before-import` 快照）。

### D1 结构与配额保护

表：`users` / `email_codes` / `sessions` / `password_resets` / `pow_challenges` / `login_attempts` / `user_state` / `backups` / `usage_daily`。

所有查询走索引（详见 `server/migrations/0001_init.sql`）：

- `users(email_norm)` 唯一索引 —— 登录/注册查重
- `email_codes(email_norm, purpose, created_at DESC)` —— 限流计数与取最新码
- `sessions(user_id, created_at DESC)` / `sessions(expires_at)` —— 列表与过期清理
- `password_resets(user_id, created_at DESC)` / `(expires_at)`
- `pow_challenges(ip_hash, created_at DESC)` —— 按 IP 限流
- `backups(user_id, created_at DESC)` —— 历史列表
- `usage_daily(day)` —— 每用户每日写入计数，默认上限 300 次（`DAILY_WRITES_LIMIT`）

限流阈值：同邮箱同用途发码 60 秒 1 次、每小时 8 次；每 IP 每分钟 40 次挑战；单次快照 512KB。

## 目录

```
worker-desk/
├─ index.html        # 骨架：一级导航 / 搜索行 / 页头 / 二级导航 / 视图舞台 / 设置浮层
├─ src/
│  ├─ styles.css     # Design Token + 基础组件 + 布局 + 响应式（全部色值在此）
│  ├─ icons.js       # 线性图标集（currentColor，24 网格）
│  ├─ config.js      # 模块 / 视图 / 设置项 / 强调色配置（ready 标记控制「施工中」）
│  ├─ data.js        # 演示数据 + 种子数据 seedData()
│  ├─ views.js       # 通用视图模板（待办视图已拆到 todo-views.js）
│  ├─ todo-model.js  # 待办数据模型：四宫格互斥、时间格式化、逾期判定
│  ├─ todo-views.js  # 待办三视图：项目&待办 / 四宫格 / 概览
│  ├─ todo-app.js    # 待办交互：编辑器、拖拽打标与排期、缩放
│  ├─ store.js       # 数据层：免登录 / 云端两套模式共用读写，5s 防抖同步
│  ├─ api.js         # Worker 接口封装 + PoW 求解器
│  ├─ auth.js        # 登录 / 注册 / 找回密码浮层
│  └─ app.js         # 路由状态、转场、读秒引擎、搜索、设置、账户、备份
├─ server/
│  ├─ src/           # index.js 路由 / api.js 业务 / crypto.js / mail.js / limits.js
│  ├─ migrations/    # D1 建表与索引
│  ├─ test/          # Node 直连 Worker 的 E2E（26 项）
│  └─ wrangler.toml
└─ preview/          # 各断点与深色模式的验证截图
```

## 待办模块

一级导航「待办」下三个视图，其余一级模块统一显示「施工中」（`config.js` 里 `ready: false`，由 `renderView()` 前置拦截）。

### 1. 项目 & 待办（`todo:list`）

- 项目卡片可折叠，显示完成度进度条、待办数、逾期数；右上角 `+` 直接在该项目下新建待办，铅笔进入编辑。
- 独立待办单列一块，`projectId` 为空即归此处。
- 勾选复选框即完成，实时写入 `localStorage`（登录态下 5s 防抖同步云端）。

### 2. 四宫格（`todo:quadrant`）

- 四个格子由 `QUADRANTS` 配置驱动：q1 紧急重要 / q2 重要不紧急 / q3 紧急不重要 / q4 不紧急不重要，各带一个行动建议（马上做 / 计划做 / 委托做 / 抽空做）。
- 右侧「待分类」列出所有没有四宫格标签的项目与待办，拖进任一格即自动打标。
- **互斥由写入口保证**，不靠 UI 约束：

```js
export function setQuadrant(tags, quadId) {
  const rest = (tags || []).filter((t) => !QUAD_IDS.includes(t));
  return quadId && QUAD_IDS.includes(quadId) ? [...rest, quadId] : rest;
}
```

- 拖动项目时，其下所有待办一并继承该格，避免「项目在 Q1、待办散落各格」。

### 3. 概览（`todo:overview`）

- 右上角切换日 / 周 / 月：日视图左右两栏列当天项目与待办；周视图 7 列；月视图 42 格（含上下月补位，`is-other` 弱化）。
- 任一格子都是放置区，把项目或待办拖进去即写入计划日期（`planAt`），项目同样连同下属待办一起排期。
- 缩放 60% – 160%（步长 20%，钳制在两端）写在 `--ov-scale` 上：字号、内边距、行高下限全部按比例走，文字统一 `text-overflow: ellipsis` 单行截断；放大后超出容器时内层滚动，截图可滚到任意位置取全部文字。缩放值与视图选择都持久化在 `data.overviewScale` / `data.overviewRange`。

### 数据模型

```js
Project { id, title, tags[], due, planAt, createdAt }
Todo    { id, title, tags[], due, planAt, projectId, done, createdAt }
```

- `due` / `planAt` 统一 `YYYY-MM-DDTHH:mm`（喂 `<input type="datetime-local">`）；`planAt` 也接受 `YYYY-MM-DD`，概览按 `dayKey()` 聚合。
- `tags` 里 `q1~q4` 是保留的四宫格标签，其余都算自由 Tag。

### 拖拽协议

可拖元素带 `data-drag-type="project|todo"` + `data-drag-id`，放置区带 `data-drop="quad:q1"` 或 `data-drop="day:2026-10-28"`。全部走 `document` 上的事件委托，视图重绘后无需重新绑定。

## 结构与交互约定

| 层级 | 位置 | 交互 |
|---|---|---|
| 一级导航 | 最左 rail，常驻 | 点击切换模块，自动落到该模块首个视图；⌘/Ctrl + 1~6 |
| 页面标题 | 主区域顶部、搜索框下方 | 模块上层标题（kicker）+ 主标题 + 一句说明，随模块切换更新 |
| 二级导航 | 页面标题下方、独立一行的分段式按钮 | 当前模块的 2–4 个视图做成滑块分段控件（滑块跟随选中项滑动）；数字键 1~9 切换 |
| 全局能力 | 搜索行 + 页头右侧（帮助 / 通知 / 账户）、rail 底部设置 | ⌘/Ctrl + K 搜索（建议列表直接跳视图）；设置浮层可改主题 / 强调色 / 偏好 |

布局：**两栏**——`rail`（92px 一级导航）+ `main`。主区域内自上而下为：搜索行（`⌘K`，独立成行、最长 520px）→ 页头（模块 kicker / 标题 / 说明 + 帮助·通知·账户）→ 二级导航行（分段控件 + 「新建待办」）→ 视图舞台（`.stage` 是唯一滚动容器）。原左侧二级面板列已移除，标题信息与导航全部上提到主区域顶部，横向空间全部留给内容。

响应式：≤1400px rail 收窄到 84px、卡片重新分栏；≤1180px 分段按钮收紧内边距（不隐藏文字）；≤1120px rail 76px、标题 20px、搜索行 380px、隐藏账户文字；≤760px 单列，rail 变顶部横条，隐藏帮助/通知图标与「新建待办」按钮，分段按钮均分整行。

视图切换转场：方向感知（模块自上向下切换向右滑入，反向向左滑入）+ 透明度与轻微模糊，420ms `cubic-bezier(.16,1,.3,1)`，仅使用 transform / opacity / filter，不触发布局。旧视图 160ms 淡出后移除，`prefers-reduced-motion` 下全部关闭。

## Design Token 摘要（详见 styles.css 的 `:root`）

- 底色 `#E9EDF4`，卡片与底色同色，靠双层阴影（左上高光 / 右下投影）分层
- 主色 `#6366F1`，渐变体系 Indigo → Violet → Cyan
- 文字三级 `#1E2438 / #4A5268 / #7A839A`，正文最小 11px，主文案 13–14px
- 圆角 8 / 12 / 16 / 22 / 28，卡片统一 22px
- 阴影四档 `--sh-xs ~ --sh-lg`，内凹两档 `--sh-in-sm / --sh-in`
- 已提供 `[data-theme="dark"]` 覆盖，切换即时生效

## 待确认（业务决策，未实现）

1. 计薪规则目前为固定常量（月薪 12000 / 21.75 天 / 8 小时，午休不计薪）。规则页表单尚未与读秒引擎联动。
2. 外卖券、资讯为本地示例数据，未接真实接口。
3. 通知中心、导入日历、导出 CSV 为占位交互；待办已支持「项目&待办 / 四宫格 / 概览」三视图。
4. 同平台浏览器字体：优先 Manrope（数字/西文），中文回落 Noto Sans CJK / 苹方；若要完全离线，需将 Manrope 字体文件下载到本地。
5. 未配置 `RESEND_API_KEY` 时后端走**开发模式**，验证码会在响应里回显并自动填入表单——上线前必须配好发信通道。

## 测试

```bash
# 后端：Node 直连 Worker，26 项断言
cd server && pnpm run dev   # 先起服务
node test/api.test.mjs

# 前端 A：账号全流程（注册→同步→登出→登录→找回密码→备份）
python3 test/auth_flow.py

# 前端 B：待办模块（三视图 + 新建/编辑 + 拖拽打标排期 + 四宫格互斥 + 缩放 + 施工中拦截）
python3 test/todo_flow.py
```

两套前端脚本都要求先起静态服务器（8765）与 Worker（8787）。
