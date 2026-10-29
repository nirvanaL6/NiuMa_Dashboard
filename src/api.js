/**
 * 后端 API 客户端（无依赖，纯 fetch）
 * - 自动带 Bearer token
 * - 人机验证走 Cloudflare Turnstile，只负责拿一次性 token 交给后端校验
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

/* ---------------- 人机验证：Cloudflare Turnstile ---------------- */

const TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let tsLoader = null;

/** 加载 Turnstile 脚本（只加载一次，重复调用复用同一个 Promise） */
function loadTurnstile() {
  if (tsLoader) return tsLoader;
  tsLoader = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = TS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      // 脚本就位后 window.turnstile 还要再等一拍才可用
      let n = 0;
      const t = setInterval(() => {
        if (window.turnstile) { clearInterval(t); resolve(window.turnstile); }
        else if (++n > 120) {
          clearInterval(t);
          tsLoader = null;
          reject(new ApiError('captcha_error', '人机验证组件加载超时，请检查网络后重试'));
        }
      }, 100);
    };
    s.onerror = () => {
      tsLoader = null;
      reject(new ApiError('captcha_error', '人机验证组件加载失败，请检查网络后重试'));
    };
    document.head.appendChild(s);
  });
  return tsLoader;
}

/** 后端告知站点密钥；没启用时返回 null，调用方直接跳过验证 */
export async function captchaConfig() {
  try {
    return await request('GET', '/api/auth/captcha-config', undefined, { auth: false });
  } catch {
    return { provider: 'turnstile', siteKey: '', enabled: false };
  }
}

/**
 * Turnstile 错误码 → 可操作的提示。
 * 这几种情况重试是没用的，必须告诉用户换条路走，否则会被弹窗卡死在登录页：
 *   110200 站点密钥里没配当前域名   —— 部署配置问题，不是用户的问题
 *   400020 站点密钥无效
 *   600010 挑战无法完成             —— 常见于机房 IP / VPN / 代理 / 隐私插件拦截
 */
const TS_ERRORS = {
  110200: ['域名未在 Turnstile 授权', '当前域名未加入人机验证白名单，请联系管理员'],
  400020: ['站点密钥无效', '人机验证配置有误，请联系管理员'],
  400070: ['站点密钥域名不匹配', '人机验证配置有误，请联系管理员'],
  600010: ['环境被判定为风险', '当前网络环境（VPN / 代理 / 公司机房）无法通过人机验证，请换一个网络后重试'],
  300030: ['挑战超时', '人机验证超时，请重试'],
};

function tsError(code) {
  const [short, hint] = TS_ERRORS[Number(code)] || ['人机验证失败', '人机验证未通过，请重试'];
  const err = new ApiError('captcha_error', hint, 0);
  err.tsCode = Number(code);
  err.tsShort = short;
  return err;
}

/**
 * 渲染一次 Turnstile 并拿到 token。
 * 组件是「无人值守」的：绝大多数用户看不到任何交互，验证在后台自动完成；
 * 只有被判定为可疑时才要求点一下复选框。
 */
export function runTurnstile({ siteKey, slot, theme, onState }) {
  // 项目的深色模式是手动切的（html[data-theme]），Turnstile 的 auto 只看系统偏好，
  // 所以这里显式把项目当前主题传进去，避免深色界面里嵌一块白卡片
  const cur = document.documentElement.dataset.theme;
  const tsTheme = theme || (cur === 'dark' ? 'dark' : cur === 'light' ? 'light' : 'auto');
  return loadTurnstile().then((ts) => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    // 15 秒拿不到 token 基本就是环境问题（机房 IP / 代理 / 插件拦截），
    // 与其让用户在登录页干等一分钟，不如早点给出可操作的提示
    const timer = setTimeout(() => {
      const err = new ApiError('captcha_timeout', '人机验证超时：若长期停在这里，通常是 VPN、代理或广告拦截插件所致，换个网络或关掉插件后重试', 0);
      err.tsCode = -1;
      err.tsShort = '人机验证超时';
      finish(reject, err);
    }, 15000);
    let widgetId = null;
    // 同一个挂载点可能被复用（连点两次「获取验证码」），先把上一个组件摘掉，
    // 否则 widget 会一层层叠上去，且旧组件永远不会回调
    if (slot.__tsWidget != null) {
      try { ts.remove(slot.__tsWidget); } catch { /* 已销毁 */ }
      slot.__tsWidget = null;
    }
    slot.innerHTML = '';
    try {
      widgetId = ts.render(slot, {
        sitekey: siteKey,
        theme: tsTheme,
        size: 'flexible',
        callback: (token) => finish(resolve, token),
        'error-callback': (code) => finish(reject, tsError(code)),
        'expired-callback': () => finish(reject, new ApiError('captcha_timeout', '人机验证已过期，请重试')),
        'timeout-callback': () => finish(reject, new ApiError('captcha_timeout', '人机验证超时，请重试')),
        'before-interactive-callback': () => onState?.('interactive'),
        'after-interactive-callback': () => onState?.('done'),
        'unsupported-callback': () => finish(reject, new ApiError('captcha_error', '当前浏览器不支持人机验证，请换用 Chrome / Edge / Safari 最新版')),
      });
    } catch (err) {
      finish(reject, new ApiError('captcha_error', '人机验证启动失败，请刷新页面'));
      return;
    }
    // 渲染完把引用挂在 slot 上，便于调用方在失败/完成时 reset
    slot.__tsWidget = widgetId;
  }));
}

/** 让组件回到未验证状态（下次还能再出一道题） */
export function resetTurnstile(slot) {
  if (window.turnstile && slot?.__tsWidget != null) {
    try { window.turnstile.reset(slot.__tsWidget); } catch { /* 组件已销毁 */ }
  }
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
