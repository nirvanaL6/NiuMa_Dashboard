# 部署到 Cloudflare Workers

前端（静态页）与 API 跑在**同一个 Worker** 上，同域，不需要配 CORS，也不需要单独开 Pages。

```
https://<worker>.<你的子域>.workers.dev
├─ /             → public/index.html
├─ /src/*.js     → 静态资源
└─ /api/*        → Worker（D1 读写）
```

## 一次性准备

```bash
cd server
npx wrangler login                 # 浏览器授权，本机只需一次
npx wrangler d1 create worker-desk # 记下输出里的 database_id
```

把 database_id 填进 `server/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "worker-desk"
database_id = "上一步拿到的 id"
```

建表 + 写密钥：

```bash
npx wrangler d1 migrations apply worker-desk --remote
npx wrangler secret put CODE_PEPPER     # openssl rand -base64 32 生成，必填
npx wrangler secret put RESEND_API_KEY  # 必填，否则注册会 503
```

> `CODE_PEPPER` 缺失时所有接口直接 500 并提示「服务端未配置 CODE_PEPPER」，不会用默认值兜底。
> `RESEND_API_KEY` 缺失时验证码接口返回 503 `mail_not_configured`，避免「显示已发送但用户永远收不到」。

## 部署

```bash
cd server
pnpm deploy      # 或 npm run deploy
```

`deploy` 依次执行：

1. `scripts/preflight.mjs` — 检查 database_id / DEV_MODE / assets / 产物，未通过直接中止
2. `scripts/build-assets.mjs` — 把 `index.html` + `src/` 同步到 `server/public/`（13 个文件）
3. `wrangler deploy` — 上传 Worker 与静态资源

部署成功后终端会打印访问地址，形如 `https://worker-desk-api.<子域>.workers.dev`。

## 部署后自检

```bash
BASE=https://worker-desk-api.<子域>.workers.dev

curl -s $BASE/api/health          # → {"ok":true,...}
curl -s -o /dev/null -w "%{http_code}\n" $BASE/            # → 200（前端页面）
curl -s $BASE/api/nope            # → JSON 404，不应返回 HTML
```

三个都符合即部署正常。再打开页面走一遍注册，确认能收到邮件验证码。

## 环境变量

| 名称 | 位置 | 说明 |
|---|---|---|
| `DEV_MODE` | `wrangler.toml` | 生产必须 `"false"`。为 `true` 时验证码会回显给任何人 |
| `ALLOWED_ORIGINS` | `wrangler.toml` | 同域部署无需改；前端放别的域名时把该域名加进去 |
| `POW_DIFFICULTY` | `wrangler.toml` | 人机验证难度（前导 0 比特），默认 16 |
| `DAILY_WRITES_LIMIT` | `wrangler.toml` | 单用户每日写入上限，默认 300 |
| `MAIL_FROM` | `wrangler.toml` | 发件人，需与 Resend 已验证域名一致 |
| `CODE_PEPPER` | secret | **必填**，验证码/令牌哈希密钥 |
| `RESEND_API_KEY` | secret | **必填**，发信通道（免费额度 100 封/天） |

本地开发用 `server/.dev.vars`（已 gitignore），从 `.dev.vars.example` 复制：

```bash
cp server/.dev.vars.example server/.dev.vars
# 填 CODE_PEPPER，保持 DEV_MODE=true
```

## 本地跑同域版本

```bash
cd server
npm run dev      # build + wrangler dev，访问 http://127.0.0.1:8787
```

生产形态（无开发回显）想本地复现：

```bash
CODE_PEPPER=$(openssl rand -base64 32) npm run dev -- --var DEV_MODE:false
```

## 免费额度

| 项 | 免费额度 | 本项目占用 |
|---|---|---|
| Worker 请求 | 10 万次/天 | 每次页面加载约 1–3 次（含 API） |
| Worker 脚本体积 | 3 MB（含 assets） | 约 32 KiB gzip 8 KiB |
| D1 存储 | 5 GB | 每用户快照约 2 KB |
| D1 读 | 500 万行/天 | 受 `DAILY_WRITES_LIMIT` 与索引保护 |
| D1 写 | 10 万行/天 | 单用户 300 写/天封顶 |

## 常见问题

**部署后打开页面 404** — `public/` 没生成。`npm run build` 后再部署。

**接口全报 500 `server_misconfigured`** — 没设 `CODE_PEPPER`，见上一节。

**注册时报 503 `mail_not_configured`** — 没设 `RESEND_API_KEY`，或 Resend 里没验证 `MAIL_FROM` 的域名。

**数据库报 `no such table`** — 远端没跑迁移，`npx wrangler d1 migrations apply worker-desk --remote`。

**改了本地 database_id 后本地库空了** — 本地 D1 按 id 分目录，id 变了等于新库，重新 `npm run migrate:local`。

## 已部署实例（2026-10-28）

| 项 | 值 |
|---|---|
| **访问地址（推荐）** | **https://desk.763988.xyz** |
| workers.dev 地址 | https://worker-desk-api.hitecbasement8804.workers.dev（部分地区被 SNI 阻断，仅作备用） |
| Worker 名 | `worker-desk-api` |
| D1 数据库 | 名称 `worker-desk`（真实 `database_id` 只存在本地 `wrangler.local.toml`，不入仓库） |
| 表 / 索引 | 11 张表、15 个业务索引（全部查询字段已建索引） |
| secrets | `CODE_PEPPER`、`RESEND_API_KEY` 已写入 |
| 健康检查 | `GET /api/health?db=1` → `{"ok":true,"db":"ok","users":N}` |

发信通道已打通：Resend 域名 `763988.xyz` 已验证（东京区），`MAIL_FROM` 为
`WorkDesk <no-reply@763988.xyz>`。Worker 侧实测 `devMode:false / delivered:true`，
验证码邮件可达。**换域名时**要同步改 `wrangler.toml` 的 `MAIL_FROM` 并在 Resend 侧重新验证，
否则发送会被拒（接口返回 503）。

### 配置拆分：仓库里不放真实资源 id

```
wrangler.toml        # 提交，database_id 为占位符
wrangler.local.toml  # 不提交，只存真实 database_id
wrangler.build.toml  # 不提交，由上面两者生成，deploy 时用 -c 指定
```

wrangler **不会**自动合并 `*.local.toml`，所以需要 `pnpm config:build` 拼一份完整配置；
`deploy` / `dev` / `migrate:*` 都已内置这一步，正常使用无需关心。

### 一条命令完成后续部署

```bash
cd server
CLOUDFLARE_API_TOKEN=xxx CODE_PEPPER=xxx RESEND_API_KEY=re_xxx pnpm cloud:deploy
```

脚本会：解析 Account → 建库（已存在则复用）→ 写 `wrangler.local.toml` → 远端迁移 →
写 secrets → 构建 → 上传 → 探活 `?db=1`。真实 id 不写入 `wrangler.toml`，仓库里始终是占位符。

### 为什么必须有自定义域名

`*.workers.dev` 在部分网络（含国内多数线路）会被 SNI 阻断：TCP 能连上，TLS Client Hello 一发出
就被 RST，表现为浏览器「无法访问此网站」。实测同一 IP `104.16.0.1` 上
`workers.cloudflare.com` 握手正常、`*.workers.dev` 被 reset，属域名级封锁，与部署无关。

解决办法是把 Worker 绑到已在 Cloudflare 托管的域名上（`[[routes]]` + `custom_domain = true`），
Cloudflare 会自动创建 DNS 记录与边缘证书，无需手配 CNAME。

```toml
[[routes]]
pattern = "desk.763988.xyz"
custom_domain = true
```

也可用 API 单独绑定（不需要 DNS:Edit 权限）：

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/domains" \
  -d '{"environment":"production","hostname":"desk.763988.xyz","service":"worker-desk-api","zone_id":"<zone_id>"}'
```
