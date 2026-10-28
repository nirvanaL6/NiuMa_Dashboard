#!/usr/bin/env node
/**
 * 部署前置自检：把「上线后才会炸」的配置项提前查出来。
 * 无需登录即可运行（只读 wrangler.toml + 环境探测）。
 *
 *   node scripts/preflight.mjs
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tomlPath = join(here, '..', 'wrangler.toml');

const problems = [];
const warns = [];
const oks = [];

const toml = await readFile(tomlPath, 'utf8');

/* ---- 1. D1 database_id 是否已替换 ---- */
const dbId = toml.match(/database_id\s*=\s*"([^"]*)"/)?.[1] || '';
if (!dbId || /REPLACE|placeholder|local-dev/i.test(dbId)) {
  problems.push(
    'D1 的 database_id 仍是占位值。执行 `npx wrangler d1 create worker-desk` 拿到真实 id 填进 wrangler.toml',
  );
} else {
  oks.push(`D1 database_id 已配置（${dbId.slice(0, 8)}…）`);
}

/* ---- 2. DEV_MODE 必须是 false ---- */
const devMode = toml.match(/DEV_MODE\s*=\s*"([^"]*)"/)?.[1];
if (devMode !== 'false') {
  problems.push(`DEV_MODE 应为 "false"，当前是 "${devMode ?? '(未设置)'}"；为 true 时验证码会回显给任何人`);
} else {
  oks.push('DEV_MODE = false（验证码不回显）');
}

/* ---- 3. 静态资源目录 ---- */
if (!/\[assets\]/.test(toml)) {
  problems.push('缺少 [assets] 配置，前端不会随 Worker 一起发布');
} else {
  const dir = toml.match(/directory\s*=\s*"([^"]*)"/)?.[1] || '';
  if (dir !== 'public') warns.push(`[assets].directory = "${dir}"，预期 "public"（由 npm run build 生成）`);
  else oks.push('静态资源目录 public/');
}

/* ---- 4. 生产域名下的 ALLOWED_ORIGINS ---- */
const origins = toml.match(/ALLOWED_ORIGINS\s*=\s*"([^"]*)"/)?.[1] || '';
if (/localhost|127\.0\.0\.1/.test(origins) && !/https?:\/\/(?!localhost|127)/.test(origins)) {
  warns.push(
    'ALLOWED_ORIGINS 只含 localhost。同域部署无需改（浏览器不发跨域请求）；若前端放别的域名，要把该域名加进去',
  );
} else {
  oks.push('ALLOWED_ORIGINS 已包含非本地域名');
}

/* ---- 5. secret 提醒（读不到值，只能提示） ---- */
warns.push('确认已执行：npx wrangler secret put CODE_PEPPER（缺失会导致所有接口 500）');
warns.push('确认已执行：npx wrangler secret put RESEND_API_KEY（缺失时注册/找回密码会返回 503）');

/* ---- 6. 产物是否已构建 ---- */
try {
  await readFile(join(here, '..', 'public', 'index.html'));
  oks.push('public/ 已有构建产物');
} catch {
  warns.push('public/ 尚未生成，部署前先跑 `npm run build`（deploy 脚本会自动跑）');
}

/* ---- 输出 ---- */
const line = '─'.repeat(58);
console.log(line);
for (const o of oks) console.log(`  OK    ${o}`);
for (const w of warns) console.log(`  WARN  ${w}`);
for (const p of problems) console.log(`  FAIL  ${p}`);
console.log(line);
console.log(problems.length ? `自检未通过：${problems.length} 项必须先修` : '自检通过，可以部署');
process.exit(problems.length ? 1 : 0);
