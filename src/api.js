/**
 * 后端 API 客户端（无依赖，纯 fetch）
 * - 自动带 Bearer token
 * - PoW 人机验证在前端解算，不阻塞主线程（用 Web Worker 跑哈希）
 * - 统一错误对象 { code, message, status }
 */

const DEFAULT_BASE = (() => {
  const { protocol, hostname, port } = location;
  // 本地静态服务器（8765）与 Worker（8787）分开跑时的默认约定
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return port === '8787' ? '' : 'http://127.0.0.1:8787';
  }
  return ''; // 同域部署
})();

export const API_BASE = (localStorage.getItem('wd-api-base') || DEFAULT_BASE).replace(/\/$/, '');
export const TOKEN_KEY = 'wd-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(method, path, body, { auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  const token = auth ? getToken() : '';
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', '无法连接服务器，请检查网络或稍后重试', 0);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应（如网关错误） */
  }
  if (!res.ok || data.ok === false) {
    throw new ApiError(data?.error?.code || 'http_' + res.status, data?.error?.message || '请求失败', res.status);
  }
  return data;
}

/* ---------------- 人机验证：proof-of-work ---------------- */

const workerSrc = `
self.onmessage = async (e) => {
  const { salt, difficulty, start, step } = e.data;
  const enc = new TextEncoder();
  const target = difficulty;
  for (let n = start; ; n += step) {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(salt + '|' + n));
    const d = new Uint8Array(buf);
    let bits = 0;
    for (const b of d) { if (b === 0) { bits += 8; continue; } bits += Math.clz32(b) - 24; break; }
    if (bits >= target) { self.postMessage({ nonce: n }); return; }
  }
};
`;

let workerUrl = null;
function getWorkerUrl() {
  if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
  return workerUrl;
}

/** 解一道 PoW：4 个 worker 分片并行，进度通过 onProgress 回调 */
export function solvePow(ch, onProgress) {
  const parallel = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
  return new Promise((resolve, reject) => {
    const workers = [];
    let done = false;
    const cleanup = () => {
      workers.forEach((w) => w.terminate());
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new ApiError('captcha_timeout', '人机验证超时，请重试'));
    }, 20000);
    for (let i = 0; i < parallel; i += 1) {
      const w = new Worker(getWorkerUrl());
      workers.push(w);
      w.onmessage = (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve({ powId: ch.id, nonce: e.data.nonce });
      };
      w.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new ApiError('captcha_error', '人机验证启动失败，请刷新页面'));
      };
      w.postMessage({ salt: ch.salt, difficulty: ch.difficulty, start: i, step: parallel });
    }
    // 粗粒度进度提示（无需精确）
    if (onProgress) onProgress(0);
  });
}

/** 完整流程：领挑战 → 解挑战 */
export async function runCaptcha(purpose = 'login', onProgress) {
  const ch = await request('POST', '/api/auth/pow', { purpose }, { auth: false });
  return solvePow(ch, onProgress);
}

/* ---------------- 业务接口 ---------------- */
export const authApi = {
  sendCode: (payload) => request('POST', '/api/auth/code', payload, { auth: false }),
  signup: (payload) => request('POST', '/api/auth/signup', payload, { auth: false }),
  login: (payload) => request('POST', '/api/auth/login', payload, { auth: false }),
  logout: (all = false) => request('POST', '/api/auth/logout', { all }),
  verifyReset: (payload) => request('POST', '/api/auth/reset/verify', payload, { auth: false }),
  resetConfirm: (payload) => request('POST', '/api/auth/reset/confirm', payload, { auth: false }),
  me: () => request('GET', '/api/me'),
  deleteAccount: (password) => request('POST', '/api/account/delete', { password }),
};

export const stateApi = {
  get: () => request('GET', '/api/state'),
  put: (payload, baseVersion, force = false) => request('PUT', '/api/state', { payload, baseVersion, force }),
  backups: () => request('GET', '/api/backups'),
  restore: (id) => request('POST', '/api/backups/restore', { id }),
};
