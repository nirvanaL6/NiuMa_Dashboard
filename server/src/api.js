/**
 * 业务逻辑：账号、会话、验证码、人机验证、云端数据快照
 * 所有 SQL 都带索引条件，见 migrations/0001_init.sql
 */
import {
  b64, codeHash, hashPassword, ipHash, leadingZeroBits, newToken, randomDigits, randomId, tokenHash, verifyPassword,
} from './crypto.js';
import { sendCodeMail } from './mail.js';
import { bumpUsage, countRecent, enforceCloudWriteQuota, usageToday } from './limits.js';

const MIN = 60 * 1000;
const CODE_TTL = 10 * MIN;
const SESSION_TTL = 30 * 24 * 60 * MIN;
const RESET_TTL = 15 * MIN;
const POW_TTL = 5 * MIN;
const MAX_CODE_ATTEMPTS = 5;
const MAX_LOGIN_FAILS = 6;
const LOCK_MS = 10 * MIN;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validEmail(email) {
  const e = normalizeEmail(email);
  if (e.length < 6 || e.length > 254) return false;
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e);
}

export function passwordProblem(pwd) {
  const p = String(pwd || '');
  if (p.length < 8) return '密码至少 8 位';
  if (p.length > 128) return '密码最长 128 位';
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return '密码需同时包含字母和数字';
  if (/^(.)\1+$/.test(p)) return '不能用重复字符';
  return null;
}

/**
 * 取哈希 pepper。
 * 生产必须用 `wrangler secret put CODE_PEPPER` 配置；只有显式 DEV_MODE=true 时才允许
 * 使用固定的本地占位值，避免漏配时用一个公开字符串伪装成安全配置。
 */
function pepper(env) {
  const v = (env.CODE_PEPPER || '').trim();
  if (v) return v;
  if (env.DEV_MODE === 'true') return 'dev-only-pepper-not-for-production';
  throw Object.assign(new Error('服务端未配置 CODE_PEPPER，请先设置 secret'), {
    code: 'server_misconfigured',
    status: 500,
  });
}

const devModeOn = (env) => env.DEV_MODE === 'true';

function clientIp(req) {
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
}

async function sha(env) {
  return pepper(env);
}

/* ------------------------------------------------------------------ */
/* 人机验证：服务端签发 PoW 挑战，前端找 nonce 使 sha256(salt|nonce) 前导 0 比特达标 */
/* ------------------------------------------------------------------ */
export async function issuePow(env, req, purpose) {
  const iph = await ipHash(clientIp(req), await sha(env));
  // 每 IP 每分钟最多 40 次挑战：单次登录/注册最多用 1 次，远超正常用户；批量脚本会被卡住
  const recent = await countRecent(
    env,
    'SELECT COUNT(*) AS n FROM pow_challenges WHERE ip_hash = ?1 AND created_at > ?2',
    [iph, Date.now() - MIN],
  );
  if (recent > 40) {
    const e = new Error('请求过于频繁，请稍后再试');
    e.code = 'too_many_requests';
    e.status = 429;
    throw e;
  }
  const id = randomId(12);
  const salt = randomId(12);
  // 难度：默认 16 bit（约 6.5 万次哈希，浏览器 50–150ms），可用环境变量调节
  const difficulty = Number(env.POW_DIFFICULTY || 16);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO pow_challenges (id, salt, difficulty, purpose, ip_hash, attempts, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)`,
  ).bind(id, salt, difficulty, purpose, iph, now + POW_TTL, now).run();
  // 顺手清理过期挑战（两次写合并成一次往返）
  // 挑战有效期 5 分钟，过期 10 分钟后清掉，够排查又不囤数据
  await env.DB.prepare('DELETE FROM pow_challenges WHERE expires_at < ?1').bind(now - 10 * MIN).run();
  return { id, salt, difficulty };
}

async function consumePow(env, payload) {
  const id = payload?.powId;
  const nonce = payload?.nonce;
  if (!id || nonce == null) {
    const e = new Error('请先完成人机验证');
    e.code = 'captcha_required';
    e.status = 400;
    throw e;
  }
  const row = await env.DB.prepare(
    'SELECT salt, difficulty, expires_at, consumed_at, attempts FROM pow_challenges WHERE id = ?1',
  ).bind(id).first();
  const bad = () => {
    const e = new Error('人机验证未通过，请重试');
    e.code = 'captcha_failed';
    e.status = 400;
    throw e;
  };
  if (!row || row.consumed_at || row.expires_at < Date.now()) bad();
  if (row.attempts > 20) bad();
  const bits = await leadingZeroBits(row.salt, String(nonce));
  if (bits < row.difficulty) {
    await env.DB.prepare('UPDATE pow_challenges SET attempts = attempts + 1 WHERE id = ?1').bind(id).run();
    bad();
  }
  const res = await env.DB.prepare(
    'UPDATE pow_challenges SET consumed_at = ?1 WHERE id = ?2 AND consumed_at IS NULL',
  ).bind(Date.now(), id).run();
  if (!res.meta.changes) bad();
  return true;
}

/* ------------------------------------------------------------------ */
/* 验证码 */
/* ------------------------------------------------------------------ */
export async function sendCode(env, req, { email, purpose, pow, honeypot }) {
  if (honeypot) {
    // 蜜罐被填：机器人，直接返回成功但不做任何事
    return { sent: true, devMode: false, delivered: false };
  }
  if (!['signup', 'reset'].includes(purpose)) {
    const e = new Error('验证码用途不合法');
    e.code = 'bad_request'; e.status = 400; throw e;
  }
  await consumePow(env, pow);
  const emailNorm = normalizeEmail(email);
  if (!validEmail(emailNorm)) {
    const e = new Error('邮箱格式不正确');
    e.code = 'bad_request'; e.status = 400; throw e;
  }

  const now = Date.now();
  // 同一邮箱 60 秒内只发一次（按用途分别计时：刚注册完马上找回密码不该被拦）
  const recent = await countRecent(
    env,
    'SELECT COUNT(*) AS n FROM email_codes WHERE email_norm = ?1 AND purpose = ?2 AND created_at > ?3',
    [emailNorm, purpose, now - MIN],
  );
  if (recent > 0) {
    const e = new Error('验证码刚才已发送，请 1 分钟后再试');
    e.code = 'too_many_requests'; e.status = 429; throw e;
  }
  // 同一邮箱 1 小时最多 8 次
  const hourly = await countRecent(
    env,
    'SELECT COUNT(*) AS n FROM email_codes WHERE email_norm = ?1 AND created_at > ?2',
    [emailNorm, now - 60 * MIN],
  );
  if (hourly >= 8) {
    const e = new Error('该邮箱今日验证码发送次数过多，请稍后再试');
    e.code = 'too_many_requests'; e.status = 429; throw e;
  }

  const exists = await env.DB.prepare('SELECT 1 AS e FROM users WHERE email_norm = ?1').bind(emailNorm).first();
  // 注册：邮箱已注册时明确提示（注册场景需要，否则用户不知道为啥收不到后续）
  // 找回密码：无论是否存在都返回成功，避免邮箱枚举
  if (purpose === 'signup' && exists) {
    const e = new Error('这个邮箱已经注册过了，可直接登录');
    e.code = 'email_taken'; e.status = 409; throw e;
  }

  const code = randomDigits(6);
  await env.DB.prepare(
    `INSERT INTO email_codes (id, email_norm, purpose, code_hash, attempts, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)`,
  ).bind(randomId(12), emailNorm, purpose, await codeHash(code, await sha(env)), now + CODE_TTL, now).run();
  await env.DB.prepare('DELETE FROM email_codes WHERE expires_at < ?1').bind(now - 24 * 60 * MIN).run();

  if (purpose === 'reset' && !exists) {
    // 不存在也返回 sent，前端提示统一文案
    return { sent: true, devMode: devModeOn(env), delivered: false, masked: maskEmail(emailNorm) };
  }
  // 生产环境没配发信通道时不能假装成功：否则用户永远收不到验证码，却看到「已发送」
  if (!devModeOn(env) && !env.RESEND_API_KEY) {
    throw Object.assign(new Error('服务端未配置发信通道（RESEND_API_KEY），验证码无法送达'), {
      code: 'mail_not_configured',
      status: 503,
    });
  }
  const out = await sendCodeMail(env, emailNorm, code, purpose);
  // devCode 只在显式开发模式下回传，否则生产漏配发信通道就等于任何人都能拿到验证码
  const echo = devModeOn(env);
  return {
    sent: true,
    devMode: echo,
    delivered: out.delivered,
    devCode: echo ? out.devCode : undefined,
    masked: maskEmail(emailNorm),
  };
}

function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

async function verifyCode(env, emailNorm, purpose, code) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts, expires_at FROM email_codes
     WHERE email_norm = ?1 AND purpose = ?2 AND consumed_at IS NULL AND expires_at > ?3
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(emailNorm, purpose, now).first();
  if (!row) {
    const e = new Error('验证码已过期，请重新获取');
    e.code = 'code_expired'; e.status = 400; throw e;
  }
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    const e = new Error('验证码错误次数过多，请重新获取');
    e.code = 'code_locked'; e.status = 429; throw e;
  }
  const expect = row.code_hash;
  const got = await codeHash(String(code || '').trim(), await sha(env));
  if (got !== expect) {
    await env.DB.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?1').bind(row.id).run();
    const e = new Error('验证码不正确');
    e.code = 'code_invalid'; e.status = 400; throw e;
  }
  await env.DB.prepare(
    'UPDATE email_codes SET consumed_at = ?1 WHERE id = ?2 AND consumed_at IS NULL',
  ).bind(now, row.id).run();
  return true;
}

/* ------------------------------------------------------------------ */
/* 会话 */
/* ------------------------------------------------------------------ */
async function createSession(env, userId, req) {
  const { raw, hash } = await newToken();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, ua, ip_hash)
     VALUES (?1, ?2, ?3, ?4, ?3, ?5, ?6)`,
  ).bind(hash, userId, now, now + SESSION_TTL, (req.headers.get('user-agent') || '').slice(0, 180), await ipHash(clientIp(req), await sha(env))).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now).run();
  return raw;
}

export async function requireUser(env, req) {
  const auth = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    const e = new Error('请先登录');
    e.code = 'unauthorized'; e.status = 401; throw e;
  }
  const hash = await tokenHash(m[1].trim());
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.expires_at, u.id, u.email, u.email_verified, u.status, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
  ).bind(hash, Date.now()).first();
  if (!row || row.status !== 'active') {
    const e = new Error('登录状态已失效，请重新登录');
    e.code = 'unauthorized'; e.status = 401; throw e;
  }
  return { tokenHash: hash, user: { id: row.id, email: row.email, emailVerified: !!row.email_verified, createdAt: row.created_at } };
}

export function publicUser(u) {
  return { id: u.id, email: u.email, emailVerified: !!u.emailVerified, createdAt: u.createdAt };
}

/* ------------------------------------------------------------------ */
/* 注册 / 登录 / 找回密码 */
/* ------------------------------------------------------------------ */
export async function signup(env, req, body) {
  if (body?.website) {
    // 蜜罐字段有内容 → 静默失败，避免给机器人可读的信号
    const e = new Error('注册失败，请稍后重试');
    e.code = 'bad_request'; e.status = 400; throw e;
  }
  await consumePow(env, body?.pow);
  const emailNorm = normalizeEmail(body?.email);
  if (!validEmail(emailNorm)) {
    const e = new Error('邮箱格式不正确'); e.code = 'bad_request'; e.status = 400; throw e;
  }
  if (body?.password !== body?.password2) {
    const e = new Error('两次输入的密码不一致'); e.code = 'password_mismatch'; e.status = 400; throw e;
  }
  const pwErr = passwordProblem(body?.password);
  if (pwErr) {
    const e = new Error(pwErr); e.code = 'password_weak'; e.status = 400; throw e;
  }
  await verifyCode(env, emailNorm, 'signup', body?.code);

  const dup = await env.DB.prepare('SELECT 1 AS e FROM users WHERE email_norm = ?1').bind(emailNorm).first();
  if (dup) {
    const e = new Error('这个邮箱已经注册过了，可直接登录'); e.code = 'email_taken'; e.status = 409; throw e;
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_norm, password_hash, email_verified, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 1, 'active', ?5, ?5)`,
  ).bind(id, emailNorm, emailNorm, await hashPassword(body.password), now).run();
  const token = await createSession(env, id, req);
  return { token, user: { id, email: emailNorm, emailVerified: true, createdAt: now } };
}

export async function login(env, req, body) {
  await consumePow(env, body?.pow);
  const emailNorm = normalizeEmail(body?.email);
  const password = String(body?.password || '');
  const locked = await env.DB.prepare(
    'SELECT fails, locked_until FROM login_attempts WHERE email_norm = ?1',
  ).bind(emailNorm).first();
  if (locked?.locked_until && locked.locked_until > Date.now()) {
    const mins = Math.ceil((locked.locked_until - Date.now()) / MIN);
    const e = new Error(`密码错误次数过多，请 ${mins} 分钟后再试`); e.code = 'locked'; e.status = 429; throw e;
  }
  const row = await env.DB.prepare(
    'SELECT id, email, password_hash, email_verified, status, created_at FROM users WHERE email_norm = ?1',
  ).bind(emailNorm).first();
  const ok = row && row.status === 'active' && (await verifyPassword(password, row.password_hash));
  if (!ok) {
    const fails = (locked?.fails || 0) + 1;
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO login_attempts (email_norm, fails, locked_until, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(email_norm) DO UPDATE SET fails = ?2, locked_until = ?3, updated_at = ?4`,
    ).bind(emailNorm, fails, fails >= MAX_LOGIN_FAILS ? now + LOCK_MS : null, now).run();
    const e = new Error('邮箱或密码不正确'); e.code = 'bad_credentials'; e.status = 401; throw e;
  }
  const now = Date.now();
  await env.DB.prepare('UPDATE users SET last_login_at = ?1 WHERE id = ?2').bind(now, row.id).run();
  await env.DB.prepare('DELETE FROM login_attempts WHERE email_norm = ?1').bind(emailNorm).run();
  const token = await createSession(env, row.id, req);
  return {
    token,
    user: { id: row.id, email: row.email, emailVerified: !!row.email_verified, createdAt: row.created_at },
  };
}

export async function logout(env, req, all = false) {
  const { tokenHash: hash, user } = await requireUser(env, req);
  if (all) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id).run();
  else await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(hash).run();
  return { ok: true };
}

export async function me(env, req) {
  const { user } = await requireUser(env, req);
  const state = await env.DB.prepare(
    'SELECT version, updated_at, bytes FROM user_state WHERE user_id = ?1',
  ).bind(user.id).first();
  return {
    user: publicUser(user),
    cloud: state ? { version: state.version, updatedAt: state.updated_at, bytes: state.bytes } : null,
    usage: await usageToday(env, user.id),
  };
}

/** 找回密码第一步：校验验证码并签发一次性重置令牌 */
export async function verifyResetCode(env, req, body) {
  await consumePow(env, body?.pow);
  const emailNorm = normalizeEmail(body?.email);
  await verifyCode(env, emailNorm, 'reset', body?.code);
  const row = await env.DB.prepare('SELECT id FROM users WHERE email_norm = ?1').bind(emailNorm).first();
  if (!row) {
    // 邮箱不存在：验证码本来就发不出去，这里保守失败
    const e = new Error('验证码不正确'); e.code = 'code_invalid'; e.status = 400; throw e;
  }
  const { raw, hash } = await newToken();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  ).bind(hash, row.id, now, now + RESET_TTL).run();
  return { resetToken: raw, expiresIn: RESET_TTL };
}

export async function resetPassword(env, req, body) {
  const { raw, password, password2 } = body || {};
  if (password !== password2) {
    const e = new Error('两次输入的密码不一致'); e.code = 'password_mismatch'; e.status = 400; throw e;
  }
  const pwErr = passwordProblem(password);
  if (pwErr) {
    const e = new Error(pwErr); e.code = 'password_weak'; e.status = 400; throw e;
  }
  const hash = await tokenHash(String(raw || ''));
  const row = await env.DB.prepare(
    `SELECT user_id, expires_at, consumed_at FROM password_resets WHERE token_hash = ?1`,
  ).bind(hash).first();
  if (!row || row.consumed_at || row.expires_at < Date.now()) {
    const e = new Error('重置链接已失效，请重新获取验证码'); e.code = 'reset_expired'; e.status = 400; throw e;
  }
  const now = Date.now();
  await env.DB.prepare('UPDATE password_resets SET consumed_at = ?1 WHERE token_hash = ?2').bind(now, hash).run();
  await env.DB.prepare('UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3')
    .bind(await hashPassword(password), now, row.user_id).run();
  // 改密后踢掉所有旧会话，再签发新会话
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(row.user_id).run();
  await env.DB.prepare('DELETE FROM login_attempts WHERE email_norm = (SELECT email_norm FROM users WHERE id = ?1)').bind(row.user_id).run();
  const token = await createSession(env, row.user_id, req);
  const u = await env.DB.prepare('SELECT id, email, email_verified, created_at FROM users WHERE id = ?1').bind(row.user_id).first();
  return { token, user: { id: u.id, email: u.email, emailVerified: !!u.email_verified, createdAt: u.created_at } };
}

/* ------------------------------------------------------------------ */
/* 云端用户数据（整包快照） */
/* ------------------------------------------------------------------ */
export const MAX_STATE_BYTES = 512 * 1024;

export async function getState(env, req) {
  const { user } = await requireUser(env, req);
  const row = await env.DB.prepare(
    'SELECT payload, version, updated_at, bytes FROM user_state WHERE user_id = ?1',
  ).bind(user.id).first();
  if (!row) return { payload: null, version: 0, updatedAt: 0, bytes: 0 };
  return { payload: JSON.parse(row.payload), version: row.version, updatedAt: row.updated_at, bytes: row.bytes };
}

export async function putState(env, req, body) {
  const { user } = await requireUser(env, req);
  await enforceCloudWriteQuota(env, user.id);
  const payload = body?.payload;
  if (!payload || typeof payload !== 'object') {
    const e = new Error('数据格式不合法'); e.code = 'bad_request'; e.status = 400; throw e;
  }
  const text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_STATE_BYTES) {
    const e = new Error(`数据超过 ${Math.round(MAX_STATE_BYTES / 1024)}KB 上限，请先清理历史数据`);
    e.code = 'payload_too_large'; e.status = 413; throw e;
  }
  const now = Date.now();
  const baseVersion = Number(body?.baseVersion || 0);
  const row = await env.DB.prepare('SELECT version FROM user_state WHERE user_id = ?1').bind(user.id).first();
  const current = row?.version || 0;
  if (baseVersion && current && baseVersion !== current && !body?.force) {
    const e = new Error('云端数据已在其他设备更新');
    e.code = 'version_conflict';
    e.status = 409;
    e.extra = { serverVersion: current };
    throw e;
  }
  const next = current + 1;
  await env.DB.prepare(
    `INSERT INTO user_state (user_id, payload, version, bytes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id) DO UPDATE SET payload = ?2, version = ?3, bytes = ?4, updated_at = ?5`,
  ).bind(user.id, text, next, bytes, now).run();
  // 自动备份：只在版本是 5 的倍数时留档，控制写入量
  if (next % 5 === 0) {
    await env.DB.prepare(
      'INSERT INTO backups (id, user_id, payload, version, bytes, source, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    ).bind(randomId(12), user.id, text, next, bytes, 'auto', now).run();
    // 每个用户只保留最近 5 份
    await env.DB.prepare(
      `DELETE FROM backups WHERE user_id = ?1 AND id NOT IN (
         SELECT id FROM backups WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 5)`,
    ).bind(user.id).run();
  }
  await bumpUsage(env, user.id, 'writes');
  return { version: next, updatedAt: now, bytes };
}

export async function listBackups(env, req) {
  const { user } = await requireUser(env, req);
  const { results } = await env.DB.prepare(
    'SELECT id, version, bytes, source, created_at FROM backups WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 5',
  ).bind(user.id).all();
  return { backups: results || [] };
}

export async function restoreBackup(env, req, id) {
  const { user } = await requireUser(env, req);
  await enforceCloudWriteQuota(env, user.id);
  const row = await env.DB.prepare(
    'SELECT payload, version FROM backups WHERE id = ?1 AND user_id = ?2',
  ).bind(id, user.id).first();
  if (!row) {
    const e = new Error('备份不存在或已被清理'); e.code = 'not_found'; e.status = 404; throw e;
  }
  const now = Date.now();
  const bytes = new TextEncoder().encode(row.payload).length;
  const cur = await env.DB.prepare('SELECT version FROM user_state WHERE user_id = ?1').bind(user.id).first();
  const next = (cur?.version || 0) + 1;
  await env.DB.prepare(
    `INSERT INTO user_state (user_id, payload, version, bytes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id) DO UPDATE SET payload = ?2, version = ?3, bytes = ?4, updated_at = ?5`,
  ).bind(user.id, row.payload, next, bytes, now).run();
  await bumpUsage(env, user.id, 'writes');
  return { payload: JSON.parse(row.payload), version: next, updatedAt: now, bytes };
}

export async function deleteAccount(env, req, body) {
  const { user } = await requireUser(env, req);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?1').bind(user.id).first();
  if (!(await verifyPassword(String(body?.password || ''), row?.password_hash))) {
    const e = new Error('密码不正确'); e.code = 'bad_credentials'; e.status = 401; throw e;
  }
  // 显式逐表删除，避免依赖外键级联（D1 默认不开 PRAGMA foreign_keys）
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM user_state WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM backups WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM usage_daily WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM email_codes WHERE email_norm = (SELECT email_norm FROM users WHERE id = ?1)').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(user.id),
  ]);
  return { ok: true };
}

export { b64 };
