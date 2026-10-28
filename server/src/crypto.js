/**
 * 加密与编码工具：全部基于 WebCrypto，不引入第三方依赖
 */

const te = new TextEncoder();

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomId(len = 16) {
  return b64(crypto.getRandomValues(new Uint8Array(len)));
}

export function randomDigits(n = 6) {
  const max = 10 ** n;
  const v = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return String(v).padStart(n, '0');
}

export async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** sha256(salt|nonce) 的前导 0 比特数 */
export async function leadingZeroBits(salt, nonce) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(`${salt}|${nonce}`)));
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/**
 * PBKDF2 迭代次数。
 * Cloudflare Workers 的 WebCrypto 对 PBKDF2 有硬性上限：超过 100000 次直接抛
 * NotSupportedError（"iteration counts above 100000 are not supported"），
 * 而本地 wrangler（workerd 的 Node 兼容层）没有这个限制——这是「本地正常、
 * 线上注册 500」的根因。必须 ≤100000。
 */
export const PBKDF2_ITER = 100000;
// 兼容旧哈希：历史存量数据可能用过其它迭代次数，校验时以库中记录的值为准

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER },
    key,
    256,
  );
  return `pbkdf2$sha256$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[2]);
  if (!Number.isFinite(iter) || iter <= 0 || iter > PBKDF2_ITER) return false;
  const salt = unb64(parts[3]);
  const expected = parts[4];
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  const got = b64(bits);
  // 定长比较，避免时序侧信道
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i += 1) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** 与账号绑定的一次性令牌（会话/重置），只把哈希落库 */
export async function newToken() {
  const raw = b64(crypto.getRandomValues(new Uint8Array(32)));
  return { raw, hash: await sha256Hex(`wd-token:${raw}`) };
}

export async function tokenHash(raw) {
  return sha256Hex(`wd-token:${raw}`);
}

export async function codeHash(code, pepper) {
  return sha256Hex(`wd-code:${pepper}:${code}`);
}

/** 简单稳定的字符串哈希，用于把 IP 变成不可逆标识 */
export async function ipHash(ip, pepper) {
  return (await sha256Hex(`wd-ip:${pepper}:${ip || 'unknown'}`)).slice(0, 24);
}
