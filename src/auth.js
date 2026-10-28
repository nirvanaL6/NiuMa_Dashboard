/**
 * 账号体系 UI：登录 / 注册 / 找回密码 三合一浮层 + 账户菜单
 *
 * 设计取向：
 * - 浮层复用新拟态体系（同 --surface / --sh-*），与主界面无割裂
 * - 免登录模式始终可用，登录只是「升级」，不挡路
 * - 人机验证在提交时静默进行，界面上只给一行轻提示，不弹弹窗
 */
import { icon } from './icons.js';
import { authApi, runCaptcha, ApiError, setToken, getToken, API_BASE } from './api.js';
import * as store from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let root = null;
let mode = 'login'; // login | signup | reset
let busy = false;
let resetToken = '';
let resendTimer = 0;
let lastEmail = '';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

/* ---------------- 壳 ---------------- */
export function mountAuth(host) {
  root = el('div', 'auth-mask');
  root.id = 'authMask';
  root.hidden = true;
  root.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authTitle">
      <button class="btn btn--icon auth-close" data-close aria-label="关闭">
        ${icon('close', 16)}
      </button>
      <div class="auth-brand">
        <span class="auth-brand__mark">${icon('home', 20)}</span>
        <div>
          <b>打工人工作台</b>
          <span>登录后数据自动云端保存，换设备也能接着用</span>
        </div>
      </div>
      <div class="auth-tabs" role="tablist" aria-label="账号操作">
        <button role="tab" data-tab="login">登录</button>
        <button role="tab" data-tab="signup">注册</button>
      </div>
      <div id="authBody"></div>
      <div class="auth-foot">
        <button class="auth-link" data-skip>继续免登录使用</button>
        <span class="auth-state" id="authState"></span>
      </div>
    </div>`;
  host.appendChild(root);

  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('input', onInput);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !root.hidden) closeAuth();
  });
  render();
}

export function openAuth(tab = 'login') {
  if (!root) return;
  mode = tab;
  resetToken = '';
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add('open'));
  render();
  setTimeout(() => $('#authBody input')?.focus(), 80);
}

export function closeAuth() {
  if (!root) return;
  root.classList.remove('open');
  setTimeout(() => { if (!root.classList.contains('open')) root.hidden = true; }, 180);
}

/* ---------------- 渲染 ---------------- */
function field(id, label, type, attrs = '') {
  return `<label class="auth-field" for="${id}">
    <span>${label}</span>
    <input id="${id}" name="${id}" type="${type}" ${attrs} />
    <em class="auth-err" data-err="${id}" aria-live="polite"></em>
  </label>`;
}

function render() {
  if (!root) return;
  $$('[data-tab]', root).forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === mode));
  });
  $('.auth-tabs', root).style.display = mode === 'reset' ? 'none' : 'flex';
  const body = $('#authBody', root);

  if (mode === 'login') {
    body.innerHTML = `
      <h2 id="authTitle" class="auth-title">欢迎回来</h2>
      <p class="auth-sub">登录后，待办与券状态会同步到云端</p>
      <form novalidate>
        ${field('email', '电子邮箱', 'email', 'autocomplete="username" placeholder="you@company.com"')}
        ${field('password', '密码', 'password', 'autocomplete="current-password" placeholder="至少 8 位"')}
        <div class="auth-row">
          <label class="auth-check"><input type="checkbox" id="remember" checked /> 记住我（30 天）</label>
          <button type="button" class="auth-link" data-forgot>忘记密码？</button>
        </div>
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="auth-hp" aria-hidden="true" />
        <button class="btn btn--primary auth-submit" type="submit">${icon('lock', 15)} 登录</button>
        <div class="auth-human" id="captchaState">${icon('shield', 13)} <span>提交时会自动完成人机验证</span></div>
      </form>`;
  } else if (mode === 'signup') {
    body.innerHTML = `
      <h2 id="authTitle" class="auth-title">创建账号</h2>
      <p class="auth-sub">只需邮箱 + 验证码，30 秒搞定</p>
      <form novalidate>
        ${field('email', '电子邮箱', 'email', 'autocomplete="email" placeholder="you@company.com"')}
        <div class="auth-field">
          <span>邮箱验证码</span>
          <div class="auth-code">
            <input id="code" name="code" type="text" inputmode="numeric" maxlength="6" placeholder="6 位数字" autocomplete="one-time-code" />
            <button type="button" class="btn btn--ghost btn--sm" data-sendcode>获取验证码</button>
          </div>
          <em class="auth-err" data-err="code" aria-live="polite"></em>
        </div>
        ${field('password', '设置密码', 'password', 'autocomplete="new-password" placeholder="至少 8 位，含字母和数字"')}
        ${field('password2', '确认密码', 'password', 'autocomplete="new-password" placeholder="再输入一次"')}
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="auth-hp" aria-hidden="true" />
        <button class="btn btn--primary auth-submit" type="submit">${icon('check', 15, 2.2)} 注册并登录</button>
        <div class="auth-human" id="captchaState">${icon('shield', 13)} <span>提交时会自动完成人机验证</span></div>
      </form>`;
  } else {
    body.innerHTML = `
      <h2 id="authTitle" class="auth-title">找回密码</h2>
      <p class="auth-sub">${resetToken ? '验证已通过，设置一个新密码' : '输入注册邮箱，我们会发送验证码'}</p>
      ${resetToken ? `
      <form novalidate data-step="confirm">
        ${field('password', '新密码', 'password', 'autocomplete="new-password" placeholder="至少 8 位，含字母和数字"')}
        ${field('password2', '确认新密码', 'password', 'autocomplete="new-password" placeholder="再输入一次"')}
        <button class="btn btn--primary auth-submit" type="submit">${icon('lock', 15)} 重设密码</button>
        <div class="auth-human">${icon('shield', 13)} <span>重设成功后旧设备会自动退出登录</span></div>
      </form>` : `
      <form novalidate data-step="verify">
        ${field('email', '电子邮箱', 'email', 'autocomplete="email" placeholder="you@company.com"')}
        <div class="auth-field">
          <span>邮箱验证码</span>
          <div class="auth-code">
            <input id="code" name="code" type="text" inputmode="numeric" maxlength="6" placeholder="6 位数字" autocomplete="one-time-code" />
            <button type="button" class="btn btn--ghost btn--sm" data-sendcode>获取验证码</button>
          </div>
          <em class="auth-err" data-err="code" aria-live="polite"></em>
        </div>
        <button class="btn btn--primary auth-submit" type="submit">${icon('arrowRight', 15)} 下一步</button>
        <div class="auth-human" id="captchaState">${icon('shield', 13)} <span>提交时会自动完成人机验证</span></div>
      </form>`}
      <button class="auth-link auth-back" data-tab="login">${icon('chevronLeft', 13)} 返回登录</button>`;
  }

  // 回填邮箱，减少重复输入
  if (lastEmail) {
    const inp = $('#email', body);
    if (inp && !inp.value) inp.value = lastEmail;
  }
  updateResendLabel();
}

/* ---------------- 交互 ---------------- */
/**
 * 错误展示。`code` 不在表单里有对应字段时（例如 code_invalid），
 * 名字就叫 code，选择器能匹配到 data-err="code"，之前却因为只认 password 兜底而丢失提示。
 */
function showErr(name, msg) {
  const em = root.querySelector(`[data-err="${name}"]`);
  if (em) em.textContent = msg || '';
  const input = root.querySelector(`#${name}`);
  if (input) input.classList.toggle('is-bad', !!msg);
}

/** 兜底提示：字段不存在时打到表单底部，绝不静默吞掉错误 */
function showFormMsg(msg) {
  const st = $('#authState', root);
  if (st) st.textContent = msg;
  else setCaptchaText(`${icon('alert', 13)} <span>${msg}</span>`);
}

function clearErrs() {
  $$('.auth-err', root).forEach((e) => { e.textContent = ''; });
  $$('.is-bad', root).forEach((e) => e.classList.remove('is-bad'));
  const st = $('#authState', root);
  if (st) st.textContent = '';
}

function setBusy(on, label = '处理中…') {
  busy = on;
  const btn = root.querySelector('.auth-submit');
  if (!btn) return;
  btn.disabled = on;
  if (on) {
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${label}`;
  } else if (btn.dataset.label) {
    btn.innerHTML = btn.dataset.label;
  }
}

function setCaptchaText(html) {
  const n = $('#captchaState', root);
  if (n) n.innerHTML = html;
}

/** 未验证的初始文案。用 innerHTML 复刻模板里的结构，保证样式与图标一致 */
function resetCaptcha() {
  setCaptchaText(`${icon('shield', 13)} <span>提交时会自动完成人机验证</span>`);
}

function onClick(e) {
  const t = e.target.closest('button, [data-tab]');
  if (!t) return;
  if (t.hasAttribute('data-close') || t.classList.contains('auth-mask')) return closeAuth();
  if (t.hasAttribute('data-skip')) {
    closeAuth();
    document.dispatchEvent(new CustomEvent('auth:skip'));
    return;
  }
  if (t.dataset.tab) {
    mode = t.dataset.tab;
    resetToken = '';
    // 倒计时只约束「同一个表单」，切页签后按钮要重新可用，
    // 否则从注册切到找回密码会看到一个禁用的「48s 后重发」
    resetResend();
    clearErrs();
    render();
    setTimeout(() => $('#authBody input')?.focus(), 60);
    return;
  }
  if (t.hasAttribute('data-forgot')) {
    mode = 'reset';
    resetResend();
    clearErrs();
    render();
    return;
  }
  if (t.hasAttribute('data-sendcode')) sendCode(t);
}

function onInput(e) {
  const name = e.target.name;
  if (name) showErr(name, '');
  const st = $('#authState', root);
  if (st) st.textContent = '';
}

function emailValue() {
  return ($('#email', root)?.value || '').trim();
}

function pwdProblem(pwd, pwd2) {
  if (pwd.length < 8) return '密码至少 8 位';
  if (!/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) return '密码需同时包含字母和数字';
  if (pwd2 != null && pwd !== pwd2) return '两次输入的密码不一致';
  return '';
}

/**
 * 倒计时按钮文案。
 * 用 data-busy 区分「发送中」与「读秒中」两种禁用态，两者不能互相覆盖——
 * 之前一律用 textContent 硬写，发送中的按钮会被倒计时文案顶掉，反之亦然。
 */
function updateResendLabel() {
  const btn = root?.querySelector('[data-sendcode]');
  if (!btn) return;
  if (btn.dataset.busy === '1') return; // 发送中由 sendCode 自己管文案
  if (resendTimer > 0) {
    btn.textContent = `${resendTimer}s 后重发`;
    btn.disabled = true;
  } else {
    btn.textContent = '获取验证码';
    btn.disabled = false;
  }
}

/**
 * 倒计时。
 * 关键点：不能按「每秒 -1」累加，那样主线程被 PoW 算力挤占时会连续掉帧、丢秒，
 * 表现就是用户说的「偶尔不读秒」。改成记截止时间戳，每帧按真实时间差重算，
 * 掉帧后自动追平，永远不会越读越慢。
 */
function startResend(sec = 60) {
  clearInterval(startResend.timer);
  startResend.deadline = Date.now() + sec * 1000;
  resendTimer = sec;
  updateResendLabel();
  startResend.timer = setInterval(() => {
    const left = Math.ceil((startResend.deadline - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(startResend.timer);
      startResend.deadline = 0;
      resendTimer = 0;
    } else {
      resendTimer = left;
    }
    updateResendLabel();
  }, 250);
}

/** 切换表单时清掉倒计时（服务端仍有 60s 限流兜底） */
function resetResend() {
  clearInterval(startResend.timer);
  startResend.deadline = 0;
  resendTimer = 0;
  const btn = root?.querySelector('[data-sendcode]');
  if (btn) delete btn.dataset.busy;
  updateResendLabel();
}

async function solveCaptcha(purpose) {
  setCaptchaText(`${icon('shield', 13)} <span>正在完成人机验证…</span>`);
  const t0 = performance.now();
  const pow = await runCaptcha(purpose);
  const ms = Math.round(performance.now() - t0);
  setCaptchaText(`${icon('check', 13, 2.4)} <span>人机验证通过（${ms}ms）</span>`);
  return pow;
}

async function sendCode(btn) {
  const email = emailValue();
  if (!EMAIL_RE.test(email)) return showErr('email', '请输入正确的邮箱地址');
  // busy 标记：防止 updateResendLabel 在发送期间把「发送中…」覆盖成「获取验证码」
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = '发送中…';
  try {
    const pow = await solveCaptcha(mode === 'reset' ? 'reset' : 'signup');
    const res = await authApi.sendCode({
      email,
      purpose: mode === 'reset' ? 'reset' : 'signup',
      pow,
      honeypot: root.querySelector('[name="website"]')?.value || '',
    });
    lastEmail = email;
    delete btn.dataset.busy;
    startResend(60);
    document.dispatchEvent(new CustomEvent('auth:code-sent', { detail: res }));
    // 人机验证已在本函数开头完成，这里统一收起「通过」状态，避免用户误以为还有第二次验证
    setCaptchaText(`${icon('check', 13, 2.4)} <span>人机验证已通过</span>`);
    if (res.devMode && res.devCode) {
      // 开发模式：后端没配邮件通道，把验证码填进去省事，并明确告知
      const code = $('#code', root);
      if (code) code.value = res.devCode;
      showErr('code', `开发模式：验证码 ${res.devCode} 已自动填入（生产环境走邮件）`);
    } else {
      showErr('code', `验证码已发送到 ${res.masked || email}`);
    }
  } catch (err) {
    // 发送失败时人机验证并未通过，要把状态复位，否则会一直显示「通过」
    resetCaptcha();
    handleErr(err, 'email');
    delete btn.dataset.busy;
    updateResendLabel();
  }
}

function handleErr(err, fallbackField = 'password') {
  const code = err?.code || '';
  const map = {
    email_taken: 'email',
    bad_request: 'email',
    code_invalid: 'code',
    code_expired: 'code',
    code_locked: 'code',
    password_mismatch: 'password2',
    password_weak: 'password',
    bad_credentials: 'password',
    locked: 'password',
    captcha_failed: null,
    captcha_required: null,
    captcha_timeout: null,
    network: null,
  };
  const fieldName = code in map ? map[code] : fallbackField;
  const msg = err?.message || '操作失败，请重试';
  if (fieldName && root.querySelector(`[data-err="${fieldName}"]`)) {
    showErr(fieldName, msg);
  } else {
    // 字段不存在（例如挑战类错误、风控类错误）时落到表单底部，绝不静默吞掉
    showFormMsg(msg);
    if (code.startsWith('captcha')) setCaptchaText(`${icon('alert', 13)} <span>${msg}</span>`);
  }
}

async function onSubmit(e) {
  e.preventDefault();
  if (busy) return;
  clearErrs();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const email = String(data.email || '').trim();
  const hp = String(data.website || '');

  if (mode === 'login') {
    if (!EMAIL_RE.test(email)) return showErr('email', '请输入正确的邮箱地址');
    if (!data.password) return showErr('password', '请输入密码');
    setBusy(true, '登录中…');
    try {
      const pow = await solveCaptcha('login');
      const res = await authApi.login({ email, password: data.password, pow, honeypot: hp });
      await afterAuth(res, 'login');
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy(false);
    }
    return;
  }

  if (mode === 'signup') {
    if (!EMAIL_RE.test(email)) return showErr('email', '请输入正确的邮箱地址');
    if (!/^\d{6}$/.test(String(data.code || ''))) return showErr('code', '请输入 6 位数字验证码');
    const bad = pwdProblem(data.password || '', data.password2);
    if (bad) return showErr(bad.includes('两次') ? 'password2' : 'password', bad);
    setBusy(true, '注册中…');
    try {
      // 注册的人机验证在「获取验证码」时已完成且被服务端消费，这里不能再来一次：
      // 挑战是一次性的，重复求解既浪费时间又必然失败
      const res = await authApi.signup({ email, code: data.code, password: data.password, password2: data.password2, honeypot: hp });
      await afterAuth(res, 'signup');
    } catch (err) {
      handleErr(err);
    } finally {
      setBusy(false);
    }
    return;
  }

  // 找回密码
  if (!resetToken) {
    if (!EMAIL_RE.test(email)) return showErr('email', '请输入正确的邮箱地址');
    if (!/^\d{6}$/.test(String(data.code || ''))) return showErr('code', '请输入 6 位数字验证码');
    setBusy(true, '校验中…');
    try {
      // 人机验证同样在「获取验证码」时完成，服务端校验的是验证码记录上的标记
      const res = await authApi.verifyReset({ email, code: data.code });
      resetToken = res.resetToken;
      lastEmail = email;
      setBusy(false);
      render();
      setTimeout(() => $('#authBody input')?.focus(), 60);
    } catch (err) {
      handleErr(err);
      setBusy(false);
    }
    return;
  }

  const bad = pwdProblem(data.password || '', data.password2);
  if (bad) return showErr(bad.includes('两次') ? 'password2' : 'password', bad);
  setBusy(true, '重设中…');
  try {
    const res = await authApi.resetConfirm({ raw: resetToken, password: data.password, password2: data.password2 });
    resetToken = '';
    await afterAuth(res, 'reset');
  } catch (err) {
    handleErr(err);
  } finally {
    setBusy(false);
  }
}

/* ---------------- 登录成功后的数据接管 ---------------- */
/**
 * 登录前本地可能已有免登录数据：
 *  - 云端为空 → 直接把本地数据推上去（不丢东西）
 *  - 云端有数据 → 以云端为准，本地先留一份快照到 wd-data-before-login，可回滚
 */
async function afterAuth(res, kind) {
  setToken(res.token);
  store.setMode('cloud');
  const localBefore = store.getData();
  let cloud = { version: 0, payload: null };
  try {
    cloud = await store.pullCloud();
  } catch { /* 网络异常时先带着本地数据继续 */ }

  if (!cloud.payload) {
    await store.pushNow();
  } else {
    localStorage.setItem('wd-data-before-login', JSON.stringify(localBefore));
    store.replaceData(cloud.payload, { touch: false });
    store.applyCloudVersion(cloud.version, cloud.updatedAt);
  }
  document.dispatchEvent(new CustomEvent('auth:done', { detail: { kind, user: res.user, merged: !!(cloud.payload && localBefore.todos?.length) } }));
  closeAuth();
  refreshAccountUI();
}

/* ---------------- 账户入口 UI ---------------- */
const user = { data: null };

export function currentUser() {
  return user.data;
}

export function refreshAccountUI() {
  const btn = $('#btnAccount');
  if (!btn) return;
  const u = user.data;
  const online = store.mode() === 'cloud' && !!getToken();
  const who = btn.querySelector('.who b');
  btn.classList.toggle('is-online', online);

  if (who) {
    if (online && u) {
      who.textContent = u.email.split('@')[0];
      btn.querySelector('.who span').textContent = '云端已同步';
      const av = btn.querySelector('.avatar');
      if (av) av.textContent = u.email[0].toUpperCase();
    } else {
      who.textContent = '免登录模式';
      btn.querySelector('.who span').textContent = '数据仅存本机';
      const av = btn.querySelector('.avatar');
      if (av) av.textContent = '本';
    }
  }
  btn.setAttribute('aria-label', online && u ? `账户：${u.email}` : '账户：免登录模式，点击登录');
  document.dispatchEvent(new CustomEvent('account:changed'));
}

export async function bootstrapSession() {
  if (!getToken()) {
    user.data = null;
    refreshAccountUI();
    return null;
  }
  try {
    const me = await authApi.me();
    user.data = me.user;
    store.setMode('cloud');
    store.applyCloudVersion(me.cloud?.version || 0, me.cloud?.updatedAt || 0);
    refreshAccountUI();
    return me;
  } catch (err) {
    if (err.status === 401) {
      setToken('');
      store.setMode('guest');
    }
    user.data = null;
    refreshAccountUI();
    return null;
  }
}

export function setUser(u) {
  user.data = u;
  refreshAccountUI();
}

export async function logout(all = false) {
  try {
    await authApi.logout(all);
  } catch { /* 本地照样清干净 */ }
  setToken('');
  store.setMode('guest');
  user.data = null;
  refreshAccountUI();
  document.dispatchEvent(new CustomEvent('auth:logout'));
}

export function showFormError(msg) {
  showFormMsg(msg);
}

export { API_BASE };
