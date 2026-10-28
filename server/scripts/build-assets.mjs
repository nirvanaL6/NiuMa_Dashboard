/**
 * 把前端产物同步到 server/public，供 Workers Static Assets 发布。
 * 只复制运行必需的文件（index.html + src/ 下的 js/css），不含后端源码与测试。
 */
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');       // 项目根
const out = join(here, '..', 'public');    // 产物目录

const ALLOW = /\.(js|css|html|json|svg|png|jpg|jpeg|ico|woff2?)$/i;

async function copyTree(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const name of await readdir(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    const st = await stat(from);
    if (st.isDirectory()) await copyTree(from, to);
    else if (ALLOW.test(name)) await cp(from, to);
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'index.html'), join(out, 'index.html'));
await copyTree(join(root, 'src'), join(out, 'src'));

async function count(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await count(join(dir, e.name)) : 1;
  }
  return n;
}
console.log(`assets → ${out}（${await count(out)} 个文件）`);
