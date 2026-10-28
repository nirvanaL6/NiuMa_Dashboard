/**
 * Cloudflare Worker 入口：路由 + CORS + 统一错误处理
 */
import { json } from './http.js';
import * as api from './api.js';

/** 部署漏配项导致的错误：文案对外可见，便于一眼定位 */
const CONFIG_ERRORS = new Set(['server_misconfigured', 'mail_not_configured']);

const ALLOWED_ORIGINS = (env) =>
  (env.ALLOWED_ORIGINS || 'http://localhost:8765,http://127.0.0.1:8765')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function cors(req, env) {
  const origin = req.headers.get('origin') || '';
  const list = ALLOWED_ORIGINS(env);
  const allow = list.includes('*') || list.includes(origin) ? origin || '*' : list[0];
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const ROUTES = [
  ['POST', '/api/auth/pow', (env, req, body) => api.issuePow(env, req, body?.purpose || 'signup')],
  ['POST', '/api/auth/code', (env, req, body) => api.sendCode(env, req, body)],
  ['POST', '/api/auth/signup', (env, req, body) => api.signup(env, req, body)],
  ['POST', '/api/auth/login', (env, req, body) => api.login(env, req, body)],
  ['POST', '/api/auth/logout', (env, req, body) => api.logout(env, req, !!body?.all)],
  ['POST', '/api/auth/reset/verify', (env, req, body) => api.verifyResetCode(env, req, body)],
  ['POST', '/api/auth/reset/confirm', (env, req, body) => api.resetPassword(env, req, body)],
  ['GET', '/api/me', (env, req) => api.me(env, req)],
  ['GET', '/api/state', (env, req) => api.getState(env, req)],
  ['PUT', '/api/state', (env, req, body) => api.putState(env, req, body)],
  ['GET', '/api/backups', (env, req) => api.listBackups(env, req)],
  ['POST', '/api/backups/restore', (env, req, body) => api.restoreBackup(env, req, body?.id)],
  ['POST', '/api/account/delete', (env, req, body) => api.deleteAccount(env, req, body)],
];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const headers = cors(req, env);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (url.pathname === '/api/health') {
      return json({ ok: true, ts: Date.now() }, 200, headers);
    }

    const route = ROUTES.find(([m, p]) => p === url.pathname && m === req.method);
    if (!route) return new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: '接口不存在' } }), { status: 404, headers });

    try {
      let body = null;
      if (req.method !== 'GET') {
        const raw = await req.text();
        if (raw) body = JSON.parse(raw);
      }
      const data = await route[2](env, req, body);
      return json({ ok: true, ...data }, 200, headers);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[api]', err?.stack || err);
      const payload = {
        ok: false,
        error: {
          code: err.code || 'server_error',
          // 配置类错误直接给原因，便于部署后自检；其它 5xx 不暴露细节
          message:
            status >= 500 && !CONFIG_ERRORS.has(err.code)
              ? '服务暂时不可用，请稍重试'
              : err.message,
        },
        ...(err.extra || {}),
      };
      const extra = { ...headers };
      if (err.extra?.['retry-after']) extra['retry-after'] = err.extra['retry-after'];
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
      });
    }
  },
};
