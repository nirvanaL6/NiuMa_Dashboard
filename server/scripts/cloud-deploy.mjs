/**
 * 一条命令完成 Cloudflare 侧的全部操作（无需浏览器登录）：
 *   1. 用 API Token 解析 Account ID
 *   2. 确保 D1 数据库存在（不存在则创建），把真实 id 写回 wrangler.toml
 *   3. 对远端库执行迁移
 *   4. 写入 secrets（CODE_PEPPER / RESEND_API_KEY）
 *   5. 构建静态产物 + 上传 Worker
 *   6. 用 ?db=1 探一次线上 D1，确认绑定真的通了
 *
 * 用法：
 *   CLOUDFLARE_API_TOKEN=xxx \
 *   CODE_PEPPER=$(openssl rand -base64 32) \
 *   RESEND_API_KEY=re_xxx \
 *   node scripts/cloud-deploy.mjs
 *
 * Token 需要的权限：Workers Scripts:Edit、D1:Edit、Account Settings:Read
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DB_NAME = process.env.D1_NAME || 'worker-desk';
const API = 'https://api.cloudflare.com/client/v4';

const log = (s) => console.log(`\n▸ ${s}`);
const ok = (s) => console.log(`  ✓ ${s}`);
const warn = (s) => console.log(`  ! ${s}`);

if (!TOKEN) {
  console.error('缺少 CLOUDFLARE_API_TOKEN。请提供一个带 Workers Scripts:Edit / D1:Edit / Account Settings:Read 的 Token。');
  process.exit(1);
}

async function cf(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const msg = (body.errors || []).map((e) => `${e.code}:${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(`${path} → ${msg}`);
  }
  return body.result;
}

function wrangler(args, opts = {}) {
  // 需要喂 stdin（secret put / 迁移确认）时必须用管道，不能用 inherit
  const piped = opts.input !== undefined;
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: root,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
    encoding: 'utf8',
    stdio: piped || opts.quiet ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    input: opts.input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ---------- 1. Account ----------
log('解析 Account');
let ACCOUNT = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
if (!ACCOUNT) {
  const accounts = await cf('/accounts?per_page=50');
  if (!accounts.length) throw new Error('Token 下没有可见的 Account，检查权限是否包含 Account Settings:Read');
  if (accounts.length > 1) {
    warn(`Token 可见 ${accounts.length} 个账号，使用第一个：${accounts[0].name}`);
    console.log(accounts.map((a, i) => `    [${i}] ${a.name}  ${a.id}`).join('\n'));
  }
  ACCOUNT = accounts[0].id;
}
ok(`Account ${ACCOUNT}`);

// ---------- 2. D1 ----------
log('检查 D1 数据库');
let dbs = await cf(`/accounts/${ACCOUNT}/d1/database?per_page=100`);
let db = dbs.find((d) => d.name === DB_NAME);
if (!db) {
  db = await cf(`/accounts/${ACCOUNT}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name: DB_NAME }),
  });
  ok(`已创建 ${DB_NAME} → ${db.uuid}`);
} else {
  ok(`已存在 ${DB_NAME} → ${db.uuid}`);
}

const tomlPath = join(root, 'wrangler.toml');
let toml = await readFile(tomlPath, 'utf8');
const cur = toml.match(/database_id\s*=\s*"([^"]*)"/)?.[1];
if (cur !== db.uuid) {
  toml = toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${db.uuid}"`);
  await writeFile(tomlPath, toml);
  ok(`wrangler.toml 的 database_id 已写为真实值`);
} else {
  ok('wrangler.toml 的 database_id 已是最新');
}

// ---------- 3. 迁移 ----------
log('应用远端迁移');
try {
  wrangler(['d1', 'migrations', 'apply', DB_NAME, '--remote'], { input: 'y\n' });
} catch (err) {
  // 迁移已全部应用时 wrangler 会以非 0 退出，这里区分「没有待应用」的情况
  const msg = String(err.stdout || '') + String(err.stderr || '');
  if (/No migrations to apply/i.test(msg)) ok('没有待应用的迁移');
  else throw err;
}
ok('远端表结构就绪');

// ---------- 4. secrets ----------
log('配置 secrets');
const pepper = (process.env.CODE_PEPPER || '').trim();
if (pepper) {
  wrangler(['secret', 'put', 'CODE_PEPPER'], { input: pepper + '\n', quiet: true });
  ok('CODE_PEPPER 已写入');
} else {
  warn('未提供 CODE_PEPPER，接口会返回 500 server_misconfigured');
}

const resend = (process.env.RESEND_API_KEY || '').trim();
if (resend) {
  wrangler(['secret', 'put', 'RESEND_API_KEY'], { input: resend + '\n', quiet: true });
  ok('RESEND_API_KEY 已写入');
} else {
  warn('未提供 RESEND_API_KEY，注册/找回密码会返回 503 mail_not_configured');
}

// ---------- 5. 构建 + 部署 ----------
log('构建静态产物并部署');
execFileSync('node', [join(here, 'build-assets.mjs')], { cwd: root, stdio: 'inherit' });
const out = wrangler(['deploy'], { quiet: true });
const url = out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
console.log(out.split('\n').filter((l) => /Uploaded|Deployed|workers\.dev|Version ID/.test(l)).join('\n'));

if (!url) {
  warn('没从输出里解析到 workers.dev 地址，跳过线上探活');
} else {
  // ---------- 6. 线上探活 ----------
  log(`线上探活 ${url}/api/health?db=1`);
  const r = await fetch(`${url}/api/health?db=1`);
  const j = await r.json().catch(() => ({}));
  console.log('  ', r.status, JSON.stringify(j));
  if (j.db === 'ok') ok(`D1 绑定正常，users 表可读（${j.users} 行）`);
  else {
    warn('D1 探活失败，检查 database_id 与迁移是否落到同一账户');
    process.exitCode = 2;
  }
  const page = await fetch(url);
  console.log('   GET / →', page.status, page.headers.get('content-type'));
  if (page.status !== 200) process.exitCode = 2;
}

console.log('\n完成。');
