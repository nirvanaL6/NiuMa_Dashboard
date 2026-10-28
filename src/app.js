/**
 * 打工人工作台 · 交互主控
 * - 一级导航 → 二级导航 → 视图 三层状态
 * - 视图切换使用「方向感知」的进出场动画，避免生硬
 * - 全局：搜索（⌘K）、设置浮层、快捷键、Toast
 */
import { MODULES, SETTINGS_SECTIONS, ACCENTS } from './config.js';
import { icon } from './icons.js';
import { renderView } from './views.js';
import { seedData } from './data.js';
import * as store from './store.js';
import { authApi, stateApi, getToken, setToken, ApiError } from './api.js';
import { mountAuth, refreshAccountUI, openAuth, closeAuth, currentUser as authUser, bootstrapSession, logout, setUser } from './auth.js';
import { mountTodo, bindTodoEvents } from './todo-app.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const app = $('#app');
const railNav = $('#railNav');
const subNav = $('#segNav');
let segThumb = $('.seg-nav__thumb', subNav);
const stage = $('#stage');
const toasts = $('#toasts');

/* ---------------- 状态 ---------------- */
const state = {
  moduleId: 'overview',
  viewId: 'today',
  prefs: { payTick: true, couponPush: true, quiet: false },
};

/* ---------------- 一级导航 ---------------- */
function renderRail() {
  railNav.innerHTML = MODULES.map((m, i) => {
    const badge = m.id === 'news' ? 3 : m.id === 'food' ? 6 : 0;
    return `<button class="rail__item" data-module="${m.id}" aria-current="${m.id === state.moduleId ? 'page' : 'false'}"
      aria-label="${m.label}（⌘${i + 1}）" title="${m.label} · ⌘${i + 1}">
      ${icon(m.icon, 21)}
      <span class="rail__lbl">${m.label}</span>
      ${badge ? `<span class="rail__badge">${badge}</span>` : ''}
    </button>`;
  }).join('');
}

/* ---------------- 二级导航 ---------------- */
function renderPanel() {
  const m = MODULES.find((x) => x.id === state.moduleId);
  $('#panelKicker').textContent = m.kicker;
  $('#panelTitle').textContent = m.title;
  $('#panelDesc').textContent = m.desc;

  // 分段控件：所有按钮等宽（滑块宽度可预测），文字截断时用 title 兜底
  subNav.innerHTML = `<span class="seg-nav__thumb" aria-hidden="true"></span>${m.views.map((v, i) => `
    <button type="button" role="tab" data-view="${v.id}" aria-selected="${v.id === state.viewId}" tabindex="${v.id === state.viewId ? 0 : -1}"
      title="${v.label}：${v.hint}（${i + 1}）">
      ${icon(v.icon, 13)}<span class="lbl">${v.label}</span>
    </button>`).join('')}`;
  segThumb = subNav.querySelector('.seg-nav__thumb');
  placeThumb(true);
}

/**
 * 滑块对齐当前选中项
 * init=true：布局刚变（折叠/断点切换），先关过渡再落位，避免从旧位置横穿整栏
 */
function placeThumb(init = false) {
  // 手机端纵向滚动时左栏不可见，跳过测量
  if (subNav.offsetParent === null) return;
  // 布局动画中量到的宽度是中间态，等过渡结束再落位一次
  if (init) {
    clearTimeout(placeThumb.timer);
    placeThumb.timer = setTimeout(() => placeThumb(true), 460);
  }
  const active = subNav.querySelector('[data-view][aria-selected="true"]');
  if (!active || !segThumb) return;
  const vertical = getComputedStyle(subNav).flexDirection.startsWith("column");

  if (init) segThumb.style.transition = 'none';
  if (vertical) {
    segThumb.style.width = 'auto';
    segThumb.style.transform = `translateX(0) translateY(${active.offsetTop - 5}px)`;
    segThumb.style.height = `${active.offsetHeight}px`;
    segThumb.style.right = '5px';
    segThumb.style.left = '5px';
    segThumb.style.minWidth = '0';
  } else {
    segThumb.style.height = 'calc(100% - 10px)';
    segThumb.style.left = '5px';
    segThumb.style.right = 'auto';
    segThumb.style.transform = `translateY(0) translateX(${active.offsetLeft - 5}px)`;
    segThumb.style.width = `${active.offsetWidth}px`;
    segThumb.style.minWidth = '0';
  }
  // 窄栏 + 3 个选项时按钮只剩 ~60px，滑块紧贴文字，改用细描边避免糊成一团
  segThumb.classList.toggle('tight', active.offsetWidth < 78);
  if (init) {
    void segThumb.offsetWidth;
    // 弹层/布局过渡结束后再恢复滑块动画，避免中间态宽度被写死
    setTimeout(() => {
      segThumb.style.transition = '';
      placeThumb(true);
    }, 520);
    // 兜底：字体/弹层/图片加载完成后再校正一次
    setTimeout(() => placeThumb(true), 1600);
  }
}

/* ---------------- 视图渲染 + 转场 ---------------- */
function renderStage(dir = 'forward', animate = true) {
  const html = renderView(state.moduleId, state.viewId);
  const next = document.createElement('section');
  next.className = 'view';
  next.dataset.viewKey = `${state.moduleId}:${state.viewId}`;
  next.setAttribute('role', 'tabpanel');
  next.setAttribute('aria-label', MODULES.find((m) => m.id === state.moduleId).title);
  next.innerHTML = html;

  // 旧视图：先用「断开式」隐藏（pointer-events / visibility 同时失效），
  // 再延迟移除。逐个持有节点与计时器，避免连续切换时旧的 removal 计时器
  // 被新一轮覆盖、导致已隐藏的视图残留在 DOM 里
  // animate=false（登出/导入/重绘）直接移除，不做淡出，否则会短暂叠两层
  $$('.view', stage).forEach((old) => {
    if (old === next || !old.isConnected) return;
    if (reduced || !animate) { old.remove(); return; }
    old.style.transition = 'opacity 160ms var(--ease-out), transform 160ms var(--ease-out)';
    old.style.opacity = '0';
    old.style.visibility = 'hidden';
    old.style.pointerEvents = 'none';
    old.setAttribute('aria-hidden', 'true');
    old.style.transform = dir === 'forward' ? 'translateX(-10px)' : 'translateX(10px)';
    const node = old;
    node.__kill = setTimeout(() => node.remove(), 200);
  });

  next.dataset.dir = dir;
  stage.appendChild(next);
  // 用 WAAPI 播放入场：动画对象可被 GC，不会因合成的 long-frame 冻结在首帧
  if (animate && !reduced) {
    const from = dir === 'forward' ? 16 : -16;
    next.animate(
      [
        { opacity: 0, transform: `translate3d(${from}px, 6px, 0)`, filter: 'blur(3px)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)', filter: 'blur(0)' },
      ],
      { duration: 420, easing: 'cubic-bezier(.16, 1, .3, 1)' },
    );
  }

  // 滚动容器由 .stage 承担（视图共用一套滚动条，避免切换时跳动）
  const scroller = stage;
  scroller.classList.add('scroll-y');
  scroller.scrollTop = 0;

  onViewMounted(next);
}

/* ---------------- 导航动作 ---------------- */
function go(moduleId, viewId, opts = {}) {
  const sameModule = moduleId === state.moduleId;
  const sameView = viewId === state.viewId;
  if (sameModule && sameView && !opts.force) return;

  const mi = MODULES.findIndex((m) => m.id === moduleId);
  const vi = MODULES.findIndex((m) => m.id === state.moduleId);
  const dir = mi === vi ? 'forward' : mi > vi ? 'forward' : 'back';

  state.moduleId = moduleId;
  state.viewId = viewId;
  renderRail();
  renderPanel();
  renderStage(dir);
  if (location.hash.slice(1) !== `${moduleId}/${viewId}`) {
    history.replaceState(null, '', `#${moduleId}/${viewId}`);
  }
}

railNav.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-module]');
  if (!btn) return;
  const m = MODULES.find((x) => x.id === btn.dataset.module);
  go(m.id, m.views[0].id);
});

subNav.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  go(state.moduleId, btn.dataset.view);
});

/* 视图内的快捷跳转（data-jump="todo" / data-shortcut） */
document.addEventListener('click', (e) => {
  // 视图内的「新建待办」按钮：统一走待办编辑器
  if (e.target.closest('[data-action="new-task"]')) {
    newTodo('todo');
    return;
  }
  if (e.target.closest('[data-action="focus"]')) { toast(`${icon('target')} 已进入专注模式 · 25 分钟`); return; }
  const jump = e.target.closest('[data-jump]');
  if (jump) {
    e.preventDefault();
    const id = jump.dataset.jump;
    const m = MODULES.find((x) => x.id === id);
    if (m) go(m.id, m.views[0].id);
    return;
  }
  const sc = e.target.closest('[data-shortcut]');
  if (sc) {
    if (sc.dataset.shortcut === 'new-task') newTodo('todo');
    if (sc.dataset.shortcut === 'focus') toast(`${icon('target')} 已进入专注模式 · 25 分钟`);
  }
});

/* ---------------- 视图挂载后的行为 ---------------- */
function onViewMounted(root) {
  // 今日速览：初始化倒计时与读秒
  if (root.dataset.viewKey === 'overview:today') {
    startOffworkCountdown(root);
    startSalaryTicker(root);
  }
  if (root.dataset.viewKey === 'salary:live') {
    startSalaryClock(root, 'full');
  }
}

/* ---------------- 待办交互 ---------------- */
/**
 * 待办模块的交互（编辑器 / 拖拽 / 缩放）全部由 todo-app.js 接管。
 * 这里只保留两件事：给侧栏与视图内的「新建待办」快捷键找到统一入口，
 * 以及维护侧栏待办角标。
 */
function newTodo(kind = 'todo') {
  if (state.moduleId !== 'todo' || state.viewId !== 'list') {
    go('todo', 'list');
    setTimeout(() => openTodoEditor(kind), 320);
  } else {
    openTodoEditor(kind);
  }
}

let openTodoEditor = () => {};
/** 由启动段注入（todo-app 的 openEditor），避免模块间循环依赖 */
export function provideTodoEditor(fn) { openTodoEditor = fn; }

/** 侧栏一级导航的未完成角标 */
function refreshTodoBadge() {
  const btn = railNav.querySelector('[data-module="todo"]');
  if (!btn) return;
  const list = store.getData().todos || [];
  const open = list.filter((t) => !t.done).length;
  let dot = btn.querySelector('.rail__badge');
  if (!open) { dot?.remove(); return; }
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'rail__badge';
    btn.appendChild(dot);
  }
  dot.textContent = String(open);
}


/* ---------------- 通用开关 / 领券 / 收藏 ---------------- */
document.addEventListener('click', (e) => {
  const sw = e.target.closest('[data-action="toggle"]');
  if (sw) {
    sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true'));
    return;
  }

  const claim = e.target.closest('[data-claim]');
  if (claim) {
    const id = claim.dataset.claim;
    const claims = { ...(store.getData().claims || {}), [id]: Date.now() };
    store.saveData({ claims }, { silent: true });
    claim.textContent = '已领取';
    claim.className = 'btn btn--ghost btn--sm';
    claim.disabled = true;
    claim.closest('.coupon')?.classList.add('has-claimed');
    toast(`${icon('coupon')} 领取成功，12:00 前下单可用`);
    void id;
    return;
  }

  const save = e.target.closest('[data-action="save-news"]');
  if (save) {
    save.style.color = 'var(--primary)';
    toast(`${icon('book')} 已加入「稍后读」`);
    return;
  }

  if (e.target.closest('[data-action="claim-all"]')) {
    const claims = { ...(store.getData().claims || {}) };
    $$('[data-claim]:not([disabled])').forEach((b) => { claims[b.dataset.claim] = Date.now(); });
    store.saveData({ claims }, { silent: true });
    $$('[data-claim]:not([disabled])').forEach((b, i) => {
      setTimeout(() => {
        b.textContent = '已领取';
        b.className = 'btn btn--ghost btn--sm';
        b.disabled = true;
      }, i * 90);
    });
    toast(`${icon('bolt')} 5 张券已入账，最高省 ¥51`);
    return;
  }

  if (e.target.closest('[data-action="save-rules"]')) {
    toast(`${icon('check')} 计薪规则已保存，读秒基数已更新`);
    return;
  }

  if (e.target.closest('[data-action="toggle-pay"]')) {
    pausePay(!payPaused);
    const btn = e.target.closest('[data-action="toggle-pay"]');
    btn.innerHTML = payPaused ? `${icon('play', 14)} 继续` : `${icon('pause', 14)} 暂停`;
    toast(payPaused ? `${icon('pause')} 已暂停读秒` : `${icon('play')} 继续读秒`);
    return;
  }

  // 分段控件（视图内筛选）
  const segBtn = e.target.closest('.segmented button');
  if (segBtn && !segBtn.dataset.viewMode) {
    $$('button', segBtn.parentElement).forEach((b) => b.classList.toggle('is-active', b === segBtn));
  }
});

/* ---------------- 读秒计薪核心 ---------------- */
const RATE = { monthly: 12000, days: 21.75, hoursPerDay: 8, startH: 9.5, endH: 18, breakMin: 60 };
/** 每秒到账（元/秒）= 月薪 ÷ 计薪天数 ÷ 每日工时 ÷ 3600 */
const PER_SECOND = RATE.monthly / RATE.days / RATE.hoursPerDay / 3600;
let payPaused = false;

/**
 * 已计薪秒数
 * 规则：上班后开始累计，午休期间冻结，下班后封顶为整日工时的 80%
 */
function earnedSeconds() {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const day = (RATE.endH - RATE.startH) * 3600 - RATE.breakMin * 60;
  if (h <= RATE.startH) return 0;
  if (h >= RATE.endH) return day;

  const worked = (h - RATE.startH) * 3600;
  const lunchStart = (RATE.startH + RATE.endH) / 2 - RATE.breakMin / 120;
  const lunchEnd = lunchStart + RATE.breakMin / 60;
  const paused = h > lunchStart ? Math.min(RATE.breakMin * 60, (h - lunchStart) * 3600) : 0;
  void lunchEnd;
  return Math.max(0, worked - paused);
}

const tickers = new Set();
/** 暂停开始时冻结的已计薪秒数 */
let frozenAt = 0;

function tick() {
  const base = payPaused ? frozenAt : earnedSeconds();
  const value = base * PER_SECOND;
  tickers.forEach((fn) => fn(value));
  requestAnimationFrame(tick);
}

function registerTicker(root, fn) {
  const wrapped = (v) => {
    if (!root.isConnected) { tickers.delete(wrapped); return; }
    fn(v);
  };
  tickers.add(wrapped);
  fn(earnedSeconds() * PER_SECOND);
}

function pausePay(next) {
  if (next === payPaused) return;
  payPaused = next;
  frozenAt = earnedSeconds();
}

const fmt = (n, d = 2) => n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');

/** 总览页的小型读秒 + 下班倒计时 */
function startSalaryTicker(root) {
  registerTicker(root, (v) => {
    const el = root.querySelector('[data-live="salary-mini"]');
    if (el) el.textContent = fmt(v);
  });
}



/* ---------------- 下班倒计时（单一 requestAnimationFrame 统一驱动） ---------------- */
function startOffworkCountdown(root) {
  registerTicker(root, (v) => {
    void v;
    const now = new Date();
    const end = new Date(now);
    end.setHours(RATE.endH, 0, 0, 0);
    const diff = Math.max(0, Math.floor((end - now) / 1000));
    const hh = Math.floor(diff / 3600);
    const mm = Math.floor((diff % 3600) / 60);
    const ss = diff % 60;
    const a = root.querySelector('#offworkLeft');
    if (a) a.textContent = hh > 0 ? `${hh} 小时 ${pad2(mm)} 分` : `${mm} 分 ${pad2(ss)} 秒`;
    const set = (u, val) => {
      const b = root.querySelector(`[data-cd="${u}"]`);
      if (b) b.textContent = val;
    };
    set('时', pad2(hh));
    set('分', pad2(mm));
    set('秒', pad2(ss));
  });
}

/** 读秒页完整版：金额、工作进度条、等价换算 */
function startSalaryClock(root) {
  const bars = root.querySelector('#clockBars');
  if (bars && !bars.childElementCount) {
    bars.innerHTML = Array.from({ length: 8 }, () => '<i></i>').join('');
  }
  registerTicker(root, (v) => {
    const int = root.querySelector('[data-live="salary-int"]');
    const frac = root.querySelector('[data-live="salary-frac"]');
    if (!int || !frac) return;
    const whole = Math.floor(v);
    int.textContent = whole.toLocaleString('zh-CN');
    frac.textContent = '.' + String(Math.floor((v - whole) * 100)).padStart(2, '0');
    if (state.prefs.payTick) {
      int.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-1.5px)' }, { transform: 'translateY(0)' }],
        { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
    const worked = earnedSeconds();
    const set = (k, val) => { const el = root.querySelector(`[data-live="${k}"]`); if (el) el.textContent = val; };
    set('worked', `${pad2(worked / 3600)}:${pad2((worked % 3600) / 60)}:${pad2(worked % 60)}`);
    const dayTarget = ((RATE.endH - RATE.startH) * 3600 - RATE.breakMin * 60) * PER_SECOND;
    set('left', `¥${fmt(Math.max(0, dayTarget - v))}`);
    set('d-day', `¥${Math.round(v).toLocaleString('zh-CN')}`);
    set('eq-coffee', (v / 18).toFixed(1));
    set('eq-takeout', (v / 28).toFixed(1));
    set('eq-taxi', (v / 45).toFixed(2));
    if (bars) {
      const ratio = Math.min(1, v / (((RATE.endH - RATE.startH) * 3600 - RATE.breakMin * 60) * PER_SECOND));
      [...bars.children].forEach((b, i) => {
        b.classList.toggle('filled', i / 8 < ratio);
        b.classList.toggle('now', Math.floor(ratio * 8) === i);
      });
    }
  });
}

requestAnimationFrame(tick);

/* ---------------- 全局设置浮层 ---------------- */
const mask = $('#sheetMask');
const sheetBody = $('#sheetBody');

let activeAccent = '#6366f1';

function renderSheet() {
  sheetBody.innerHTML = accountPanel() + syncPanel() + SETTINGS_SECTIONS.map((sec) => `
    <div class="sheet__group">
      <div class="sheet__label">${sec.label}</div>
      ${sec.rows.map((r) => {
        if (r.type === 'switch') return `<div class="setting-row"><div class="txt"><b>${r.title}</b><span>${r.desc}</span></div>
          <button class="switch" role="switch" aria-checked="${state.prefs[r.key]}" data-pref="${r.key}" aria-label="${r.title}"></button></div>`;
        if (r.type === 'theme') return `<div class="setting-row"><div class="txt"><b>${r.title}</b><span>${r.desc}</span></div>
          <button class="btn btn--ghost btn--sm" id="themeToggle" aria-label="切换深色模式">${icon('moon', 14)} 深色</button></div>`;
        if (r.type === 'accent') return `<div class="setting-row" style="flex-wrap:wrap"><div class="txt" style="flex:1 0 100%"><b>${r.title}</b><span>${r.desc}</span></div>
          <div class="swatches">${ACCENTS.map((a) => `<button class="swatch" style="--c:${a.value}" aria-pressed="${a.value === activeAccent}" aria-label="${a.name}" data-accent="${a.value}"></button>`).join('')}</div></div>`;
        return `<div class="setting-row"><span style="color:var(--ink-3)">${icon(r.icon || 'layers', 17)}</span><div class="txt"><b>${r.title}</b><span>${r.desc}</span></div>
          <button class="btn btn--ghost btn--sm" data-action="coming">打开</button></div>`;
      }).join('')}
    </div>`).join('');
}

/* --- 账户区：模式切换是全局的，所以放在设置最上面 --- */
function accountPanel() {
  const online = store.mode() === 'cloud' && !!getToken();
  const u = authUser();
  if (!online) {
    return `<div class="sheet__group">
      <div class="sheet__label">账户</div>
      <div class="acct-card">
        <span class="acct-avatar">本</span>
        <div class="acct-txt">
          <b>免登录模式</b>
          <span>数据只存在这台设备的浏览器里，随时可导出备份</span>
        </div>
      </div>
      <div class="acct-actions">
        <button class="btn btn--primary btn--sm" data-auth="login">${icon('lock', 14)} 登录 / 注册</button>
        <button class="btn btn--ghost btn--sm" data-backup="export">${icon('download', 14)} 下载备份</button>
        <button class="btn btn--ghost btn--sm" data-backup="import">${icon('upload', 14)} 恢复备份</button>
      </div>
      <p class="acct-hint">登录后同一份数据自动同步云端，换设备登录即可接着用。</p>
    </div>`;
  }
  const st = store.syncStatus();
  const label = { idle: '已同步', dirty: '待上传', syncing: '同步中', error: '同步失败', conflict: '有冲突' }[st.state] || '已同步';
  return `<div class="sheet__group">
    <div class="sheet__label">账户</div>
    <div class="acct-card">
      <span class="acct-avatar accent">${(u?.email || '?')[0].toUpperCase()}</span>
      <div class="acct-txt">
        <b>${u?.email || '已登录'}</b>
        <span><i class="sync-dot ${st.state}" aria-hidden="true"></i>${label}${st.lastSyncAt ? ' · ' + new Date(st.lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''} · v${st.version}</span>
      </div>
    </div>
    <div class="acct-actions">
      <button class="btn btn--primary btn--sm" data-sync="now">${icon('refresh', 14)} 立即同步</button>
      <button class="btn btn--ghost btn--sm" data-backup="export">${icon('download', 14)} 下载备份</button>
      <button class="btn btn--ghost btn--sm" data-backup="import">${icon('upload', 14)} 恢复备份</button>
      <button class="btn btn--ghost btn--sm" data-backup="history">${icon('clock', 14)} 云端历史</button>
      <button class="btn btn--ghost btn--sm" data-auth="logout">${icon('logout', 14)} 退出登录</button>
    </div>
  </div>`;
}

/* --- 数据区：体积、更新时间、清空 --- */
function syncPanel() {
  const s = store.stats();
  const when = s.updatedAt ? new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—';
  return `<div class="sheet__group">
    <div class="sheet__label">我的数据</div>
    <div class="setting-row">
      <span style="color:var(--ink-3)">${icon('database', 17)}</span>
      <div class="txt"><b>${(s.bytes / 1024).toFixed(1)} KB</b><span>最近保存 ${when}</span></div>
      <button class="btn btn--ghost btn--sm" data-backup="reset">重置为示例</button>
    </div>
  </div>`;
}

function openSheet() {
  renderSheet();
  mask.hidden = false;
  requestAnimationFrame(() => mask.classList.add('open'));
  setTimeout(() => $('#sheetClose')?.focus(), 60);
}
function closeSheet() {
  mask.classList.remove('open');
  setTimeout(() => { mask.hidden = true; }, 260);
}

$('#railSettings').addEventListener('click', openSheet);
$('#btnAccount').addEventListener('click', () => {
  // 已登录 → 账户区在设置面板里（已展开则收起，避免点了像没反应）
  if (store.mode() === 'cloud' && getToken()) {
    if (mask.classList.contains('open')) closeSheet();
    else openSheet();
  } else {
    openAuth('login');
  }
});
$('#btnHelp').addEventListener('click', () => toast(`${icon('help')} 快捷键：⌘K 搜索 · ⌘B 折叠 · ⌘1~6 切模块`));
$('#btnBell').addEventListener('click', () => {
  toast(`${icon('bell')} 3 条通知：评审 22 分钟后开始`);
  $('.dot', $('#btnBell'))?.remove();
});
$('#sheetClose').addEventListener('click', closeSheet);
mask.addEventListener('click', (e) => { if (e.target === mask) closeSheet(); });

sheetBody.addEventListener('click', (e) => {
  const pref = e.target.closest('[data-pref]');
  if (pref) {
    const k = pref.dataset.pref;
    state.prefs[k] = pref.getAttribute('aria-checked') !== 'true';
    pref.setAttribute('aria-checked', String(state.prefs[k]));
    store.saveData({ prefs: { ...state.prefs } }, { silent: true });
    toast(`${icon('check')} ${state.prefs[k] ? '已开启' : '已关闭'}${k === 'payTick' ? '薪资数字滚动' : k === 'couponPush' ? '外卖券推送' : '专注免打扰'}`);
    return;
  }
  const accent = e.target.closest('[data-accent]');
  if (accent) {
    activeAccent = accent.dataset.accent;
    document.documentElement.style.setProperty('--primary', activeAccent);
    document.documentElement.style.setProperty('--primary-strong', activeAccent);
    $$('.swatch', sheetBody).forEach((s) => s.setAttribute('aria-pressed', String(s === accent)));
    toast(`${icon('sparkle')} 强调色已切换，全站同步`);
    return;
  }
  if (e.target.closest('#themeToggle')) {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    e.target.innerHTML = `${icon(dark ? 'moon' : 'sun', 14)} ${dark ? '深色' : '浅色'}`;
    toast(`${icon(dark ? 'sun' : 'moon')} 已切换为${dark ? '浅色' : '深色'}主题`);
    return;
  }
  if (e.target.closest('[data-action="coming"]')) toast(`${icon('sparkle')} 该功能在下一版接入`);
});

/* ---------------- 搜索（⌘K，全局存在） ---------------- */
const searchInput = $('#globalSearch');
const INDEX = [
  ...['今日速览', '本周节奏'].map((t) => ({ t, k: '总览', go: ['overview', 'today'] })),
  { t: '提交 Q4 需求评审材料', k: '待办', go: ['todo', 'mine'] },
  { t: '四象限排优先级', k: '待办', go: ['todo', 'quadrant'] },
  { t: 'AI 工具接管重复汇报', k: '资讯', go: ['news', 'feed'] },
  { t: '外卖券：饿了么 ¥12', k: '外卖', go: ['food', 'coupons'] },
  { t: '三平台比价', k: '外卖', go: ['food', 'compare'] },
  { t: '实时读秒计薪', k: '计薪', go: ['salary', 'live'] },
  { t: '计薪规则：月薪 / 工时', k: '计薪', go: ['salary', 'rules'] },
];

let searchPop = null;
function closeSearchPop() { searchPop?.remove(); searchPop = null; }

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  closeSearchPop();
  if (!q) return;
  const hits = INDEX.filter((x) => x.t.includes(q) || x.k.includes(q)).slice(0, 6);
  const pop = document.createElement('div');
  pop.style.cssText = `position:absolute;left:0;right:0;top:50px;z-index:20;background:var(--surface);border-radius:16px;box-shadow:var(--sh-lg);padding:8px;`;
  pop.innerHTML = hits.length
    ? hits.map((h) => `<button style="display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border-radius:10px;font-size:12.5px;text-align:left;color:var(--ink-2)" onmouseover="this.style.background='var(--surface-raised)'" onmouseout="this.style.background='none'" data-go='${h.go.join(',')}'>
        <span style="color:var(--ink-3)">${icon('search', 14)}</span><span style="flex:1">${h.t}</span><span class="chip" style="height:20px;font-size:10.5px">${h.k}</span></button>`).join('')
    : `<div style="padding:14px;font-size:12.5px;color:var(--ink-3)">没有找到「${q.replace(/[<>&]/g, '')}」，试试「读秒」「券」</div>`;
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const [m, v] = b.dataset.go.split(',');
    go(m, v);
    closeSearchPop();
    searchInput.value = '';
    searchInput.blur();
  });
  searchInput.closest('.searchbar').appendChild(pop);
  searchPop = pop;
});

document.addEventListener('click', (e) => {
  if (searchPop && !e.target.closest('.search')) closeSearchPop();
});

/* ---------------- 尺寸变化 ---------------- */
// 分段导航在窄屏会隐藏文字、变宽/变窄，滑块需要重新量一次尺寸
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => placeThumb(true), 120);
});

/* ---------------- 备份：下载 / 导入 / 重置 ---------------- */
function exportBackup() {
  const data = store.getData();
  const meta = {
    app: 'worker-desk',
    schema: data.v || 2,
    mode: store.mode(),
    account: authUser()?.email || null,
    exportedAt: new Date().toISOString(),
    counts: {
      todos: (data.todos || []).length,
      claimed: Object.keys(data.claims || {}).length,
    },
  };
  const file = { ...meta, data };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = URL.createObjectURL(blob);
  a.download = `workdesk-backup-${ts}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast(`${icon('download')} 备份已下载（${(blob.size / 1024).toFixed(1)} KB）`);
}

function pickBackupFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const data = parsed?.data && parsed.app === 'worker-desk' ? parsed.data : parsed;
      if (!data || typeof data !== 'object' || !Array.isArray(data.todos)) {
        throw new Error('文件里没有找到待办数据，可能不是本应用导出的备份');
      }
      const summary = `${(data.todos || []).length} 条待办 · ${Object.keys(data.claims || {}).length} 张券`;
      const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间';
      if (!confirm(`将用这份备份覆盖当前数据：\n\n${summary}\n导出时间：${when}\n\n当前数据会先留一份快照，可随时在「恢复备份」的撤销里找回。继续？`)) return;
      localStorage.setItem('wd-data-before-import', JSON.stringify(store.getData()));
      store.replaceData(data);
      renderStage('forward', false);
      closeSheet();
      toast(`${icon('upload')} 备份已恢复：${summary}`);
      if (store.mode() === 'cloud') store.pushNow({ force: true }).catch(() => {});
    } catch (err) {
      toast(`${icon('alert')} 恢复失败：${err.message}`);
    }
  });
  input.click();
}

async function showCloudHistory() {
  try {
    const { backups } = await stateApi.backups();
    if (!backups.length) {
      toast(`${icon('clock')} 还没有云端历史版本（每 5 次同步自动留档一份）`);
      return;
    }
    const list = backups.map((b, i) => {
      const when = new Date(b.created_at).toLocaleString('zh-CN', { hour12: false });
      return `${i + 1}. v${b.version} · ${when} · ${(b.bytes / 1024).toFixed(1)}KB`;
    }).join('\n');
    const pick = prompt(`云端历史备份（输入序号恢复）：\n\n${list}`, '1');
    if (!pick) return;
    const idx = Number(pick) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= backups.length) {
      toast(`${icon('alert')} 序号不正确`);
      return;
    }
    const res = await stateApi.restore(backups[idx].id);
    store.replaceData(res.payload, { touch: false });
    store.applyCloudVersion(res.version, res.updatedAt);
    renderStage('forward', false);
    closeSheet();
    toast(`${icon('check')} 已恢复到 v${backups[idx].version}`);
  } catch (err) {
    toast(`${icon('alert')} ${err.message || '读取历史失败'}`);
  }
}

async function doLogout() {
  if (!confirm('退出后本机数据保留，但不再自动同步云端。确定退出？')) return;
  await logout();
  closeSheet();
  toast(`${icon('logout')} 已退出，切换为免登录模式`);
  renderStage('forward', false);
}

document.addEventListener('click', async (e) => {
  const auth = e.target.closest('[data-auth]');
  if (auth) {
    if (auth.dataset.auth === 'login') openAuth('login');
    if (auth.dataset.auth === 'logout') doLogout();
    return;
  }
  const sync = e.target.closest('[data-sync="now"]');
  if (sync) {
    try {
      await store.pushNow();
      toast(`${icon('check')} 已同步到云端 · v${store.syncStatus().version}`);
      renderSheet();
    } catch (err) {
      toast(`${icon('alert')} 同步失败：${err.message}`);
    }
    return;
  }
  const bk = e.target.closest('[data-backup]');
  if (bk) {
    const kind = bk.dataset.backup;
    if (kind === 'export') exportBackup();
    if (kind === 'import') pickBackupFile();
    if (kind === 'history') showCloudHistory();
    if (kind === 'reset') {
      if (!confirm('重置会用示例数据覆盖当前待办与券状态。建议先下载备份。继续？')) return;
      localStorage.setItem('wd-data-before-reset', JSON.stringify(store.getData()));
      store.replaceData(seedData());
      renderStage('forward', false);
      closeSheet();
      toast(`${icon('refresh')} 已重置为示例数据`);
      if (store.mode() === 'cloud') store.pushNow({ force: true }).catch(() => {});
    }
    return;
  }
});

/* ---------------- 快捷键 ---------------- */
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
  if (e.key === 'Escape') { closeSheet(); closeSearchPop(); searchInput.blur(); return; }
  if (mod && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    const m = MODULES[Number(e.key) - 1];
    if (m) go(m.id, m.views[0].id);
  }
  // 二级视图：按数字键 1..9（非输入态）
  if (!mod && /^[1-9]$/.test(e.key) && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    const m = MODULES.find((x) => x.id === state.moduleId);
    const v = m.views[Number(e.key) - 1];
    if (v) go(m.id, v.id);
  }
});

/* ---------------- Toast ---------------- */
function toast(html, ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = html;
  toasts.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* ---------------- 启动 ---------------- */
const [hashM, hashV] = decodeURIComponent(location.hash.slice(1)).split('/');
const startModule = MODULES.find((m) => m.id === hashM) || MODULES[0];
state.moduleId = startModule.id;
state.viewId = startModule.views.some((v) => v.id === hashV) ? hashV : startModule.views[0].id;

/* ---- 数据引导：首次访问写入种子；已有数据则以存储为准 ---- */
if (!localStorage.getItem('wd-data')) {
  store.replaceData(seedData(), { touch: false });
}
state.prefs = { ...state.prefs, ...(store.getData().prefs || {}) };

renderRail();
renderPanel();
renderStage('forward', false);
mountAuth(document.body);

/* ---- 待办模块：编辑器宿主 + 交互委托 ---- */
let todoEditor = document.getElementById('todoEditor');
if (!todoEditor) {
  todoEditor = document.createElement('div');
  todoEditor.id = 'todoEditor';
  document.body.appendChild(todoEditor);
}
mountTodo(todoEditor, {
  // 数据变化后只重绘舞台，保持模块/视图状态与滚动容器不变
  onChange: () => { renderStage('forward', false); refreshTodoBadge(); },
});
const todoApi = bindTodoEvents({ go, toast });
provideTodoEditor(todoApi.openEditor);
refreshTodoBadge();

// 恢复登录态（token 有效则切到 cloud 模式并拉取云端快照）
bootstrapSession().then(async (me) => {
  if (me?.user) setUser(me.user);
  if (me && store.mode() === 'cloud') {
    try {
      const cloud = await store.pullCloud();
      if (cloud.payload) {
        store.replaceData(cloud.payload, { touch: false });
        state.prefs = { ...state.prefs, ...(cloud.payload.prefs || {}) };
        renderStage('forward', false);
      } else {
        await store.pushNow();
      }
    } catch { /* 离线时先按本地数据展示 */ }
    refreshSyncBadge();
  }
});

/* ---- 全局同步状态指示：设置里之外的入口也能看到 ---- */
function refreshSyncBadge() {
  const av = $('#btnAccount .avatar');
  if (!av) return;
  const st = store.syncStatus();
  av.dataset.sync = st.mode === 'cloud' ? st.state : '';
  $('#btnAccount').setAttribute('data-sync', st.mode === 'cloud' ? st.state : '');
}
store.onData((type) => {
  if (type === 'sync' || type === 'mode') refreshSyncBadge();
});

document.addEventListener('auth:done', (e) => {
  const { user } = e.detail || {};
  if (user) setUser(user);
  state.prefs = { ...state.prefs, ...(store.getData().prefs || {}) };
  // 登录浮层关掉后不该留一块设置面板挡在界面上（用户可能从任意入口进来的）
  if (mask.classList.contains('open')) closeSheet();
  renderStage('forward', false);
  refreshSyncBadge();
  refreshAccountUI();
  toast(`${icon('check')} 已登录 ${user?.email || ''}，数据开始云端同步`);
});
document.addEventListener('auth:logout', () => {
  // 退出入口在设置面板里，面板不关会把界面挡在后面
  closeSheet();
  renderStage('forward', false);
  refreshSyncBadge();
});
document.addEventListener('auth:skip', () => {
  toast(`${icon('info')} 当前为免登录模式，数据只存在本机`);
});
store.onData((type) => {
  // 云端同步失败时给一次明确提示，避免用户以为已保存
  if (type === 'sync' && store.syncStatus().state === 'error') {
    toast(`${icon('alert')} 云端同步失败，数据已保存在本机`);
  }
});

// 首屏后提示一次快捷键，帮助用户发现搜索与切换
setTimeout(() => {
  if (sessionStorage.getItem('wd-hint')) return;
  sessionStorage.setItem('wd-hint', '1');
  if (store.mode() === 'guest') {
    // 免登录也能用，但要让用户知道数据只在本地
    toast(`${icon('shield')} 现在是免登录模式，数据只存本机 · <button class="toast-link" data-auth="login">登录同步</button>`, 5200);
  } else {
    toast(`${icon('search')} 按 ⌘K 全局搜索，⌘1–6 切模块`);
  }
}, 900);

// 字体加载完成后字宽变化，滑块需要重新对齐
document.fonts?.ready.then(() => placeThumb(true));

window.addEventListener('hashchange', () => {
  const [m, v] = decodeURIComponent(location.hash.slice(1)).split('/');
  const mod = MODULES.find((x) => x.id === m);
  if (mod) go(mod.id, mod.views.some((x) => x.id === v) ? v : mod.views[0].id);
});
