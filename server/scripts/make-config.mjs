/**
 * 生成部署用的完整配置：wrangler.toml（占位符）+ wrangler.local.toml（真实 database_id）
 *   → wrangler.build.toml（gitignore，不提交）
 *
 * wrangler 不会自动合并 *.local.toml，只能用 --config 指定一份完整文件，
 * 所以这里做一次就地拼装：把占位符替换成真实 id，其余原样保留。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PLACEHOLDER = 'REPLACE_WITH_YOUR_D1_DATABASE_ID';

const main = await readFile(join(root, 'wrangler.toml'), 'utf8');

let dbId = '';
try {
  const local = await readFile(join(root, 'wrangler.local.toml'), 'utf8');
  dbId = local.match(/database_id\s*=\s*"([^"]*)"/)?.[1] || '';
} catch {
  /* 首次部署时还不存在 */
}

// 也允许直接用环境变量覆盖（CI 场景不必落盘）
dbId = (process.env.D1_DATABASE_ID || dbId).trim();

if (!dbId || /REPLACE|placeholder/i.test(dbId)) {
  console.error(
    '缺少真实的 D1 database_id。\n' +
      '  - 跑 `pnpm cloud:deploy`（自动建库并写入 wrangler.local.toml），或\n' +
      '  - 手动 `npx wrangler d1 create worker-desk` 后把 id 写进 wrangler.local.toml',
  );
  process.exit(1);
}

if (!main.includes(PLACEHOLDER)) {
  console.error(
    `wrangler.toml 里没有找到占位符 ${PLACEHOLDER}。\n` +
      '如果你把真实 id 写进了 wrangler.toml，请改回占位符，避免随仓库公开。',
  );
  process.exit(1);
}

const out =
  `# 自动生成，请勿手改。源：wrangler.toml + wrangler.local.toml\n` +
  `# 重新生成：pnpm config:build\n` +
  main.replaceAll(PLACEHOLDER, dbId);

await writeFile(join(root, 'wrangler.build.toml'), out);
console.log(`config → wrangler.build.toml（DB ${dbId.slice(0, 8)}…）`);
