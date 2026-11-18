/**
 * 总览模块交互层
 *
 * 四块卡片各自独立，互不依赖：
 *   - 时钟：单例 rAF 循环，只改秒数变化的那几个字符，视图卸载即自动退出
 *   - 待办：勾选走 todo-app 的 data-toggle-todo 协议，局部 patch 不整页重绘
 *   - 资讯：复用 news-app 的 loadHot / loadFeeds，切到资讯模块不必重新拉
 *   - 快捷入口：本地增删，弹窗复用 .ed-* 那一套
 */
import { icon } from './icons.js';
import { confirmDialog } from './dialog.js';
import {
  getOverview, toggleSource, addLink, removeLink, activeSources, MAX_LINKS,
} from './overview-model.js';
import { getNews, hostOf } from './news-model.js';
import { loadHot, loadFeeds } from './news-app.js';

let onChange = () => {};
let toastFn = () => {};
let pickerOpen = false;

export function mountOverview(opts = {}) {
  onChange = opts.onChange || onChange;
  toastFn = opts.toast || toastFn;
}

const refresh = () => onChange();
const toast = (msg) => { try { toastFn(msg); } catch { /* 视图已卸载 */ } };

/* ------------------------------------------------------------------ */
/* 一、北京时间：单例循环，节点断开即停                                  */
/* ------------------------------------------------------------------ */
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
let clockRoot = null;
let rafId = 0;
let lastSec = -1;

function paintClock(root) {
  const d = new Date();
  if (d.getSeconds() === lastSec) return; // 同一秒内不碰 DOM
  lastSec = d.getSeconds();
  const pad = (n) => String(n).padStart(2, '0');
  const set = (k, v) => {
    const el = root.querySelector(`[data-ov-clock="${k}"]`);
    if (el) el.textContent = v;
  };
  set('hm', `${pad(d.getHours())}:${pad(d.getMinutes())}`);
  set('s', pad(d.getSeconds()));
  set('date', `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`);
  set('week', WEEKDAY[d.getDay()]);
}

function startClock(root) {
  clockRoot = root;
  if (rafId) return; // 已有循环在跑，换个 target 就行
  const loop = () => {
    if (!clockRoot?.isConnected) { rafId = 0; clockRoot = null; lastSec = -1; return; }
    paintClock(clockRoot);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ */
/* 二、资讯速览：按需拉取                                                */
/* ------------------------------------------------------------------ */
function ensureNews() {
  const active = activeSources();
  const wantHot = active.some((s) => s.kind === 'hot');
  const wantFeed = active.some((s) => s.kind === 'feed');
  if (wantHot) void loadHot();
  if (wantFeed && getNews().subs.length) void loadFeeds();
}

/* ------------------------------------------------------------------ */
/* 三、添加快捷入口弹窗                                                  */
/* ------------------------------------------------------------------ */
function normalizeUrl(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol)) return '';
    // 浏览器会把「https://not a url」里的空格编码进主机名（not%20a%20url）而不报错，
    // 这种地址打开必挂，得在这里挡掉
    if (!u.hostname || /[%\s]/.test(u.hostname)) return '';
    return u.toString();
  } catch {
    return '';
  }
}

function openLinkDialog() {
  document.querySelector('.ed-mask[data-ov-dialog]')?.remove();
  const mask = document.createElement('div');
  mask.className = 'ed-mask open';
  mask.dataset.ovDialog = '1';
  mask.innerHTML = `
    <div class="ed ed--sub" role="dialog" aria-modal="true" aria-labelledby="ovDlgTitle">
      <header class="ed__head">
        <h3 id="ovDlgTitle">${icon('globe', 16, 2)} 添加快捷入口</h3>
        <button type="button" class="ed__x" data-ov-close aria-label="关闭">${icon('close', 15)}</button>
      </header>
      <div class="ed__body">
        <label class="ed__row">
          <span class="ed__label">网址</span>
          <input class="ed__input" id="ovLinkUrl" placeholder="https://github.com" autocomplete="off" spellcheck="false" />
          <span class="ed__hint">留空协议自动补 https；只支持 http / https</span>
        </label>
        <label class="ed__row">
          <span class="ed__label">名称（可选）</span>
          <input class="ed__input" id="ovLinkName" maxlength="20" placeholder="留空则用域名" autocomplete="off" />
        </label>
      </div>
      <footer class="ed__foot">
        <span class="ed__err" data-ov-err></span>
        <button type="button" class="btn btn--ghost btn--sm" data-ov-close>取消</button>
        <button type="button" class="btn btn--primary btn--sm" data-ov-ok>${icon('check', 13, 2.4)} 添加</button>
      </footer>
    </div>`;

  document.body.appendChild(mask);
  const urlInput = mask.querySelector('#ovLinkUrl');
  const nameInput = mask.querySelector('#ovLinkName');
  const err = mask.querySelector('[data-ov-err]');
  const okBtn = mask.querySelector('[data-ov-ok]');
  requestAnimationFrame(() => urlInput.focus());

  const close = () => mask.remove();
  const submit = () => {
    const url = normalizeUrl(urlInput.value);
    if (!url) { err.textContent = '请填写有效的 http / https 地址'; return; }
    const title = nameInput.value.trim() || hostOf(url);
    const r = addLink({ title, url });
    if (!r.ok) {
      err.textContent = r.reason === 'limit' ? `最多添加 ${MAX_LINKS} 个入口` : '这个网址已经加过了';
      return;
    }
    close();
    refresh();
    toast(`${icon('check')} 已添加「${title}」`);
  };

  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-ov-close]')) return close();
    if (e.target.closest('[data-ov-ok]')) submit();
  });
  mask.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); }
  });
}

/* ------------------------------------------------------------------ */
/* 四、事件委托                                                         */
/* ------------------------------------------------------------------ */
function setPicker(root, open) {
  const box = root.querySelector('[data-ov-picker]');
  if (!box) return;
  pickerOpen = open;
  box.hidden = !open;
  root.querySelectorAll('[data-ov-act="pick-src"]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
}

/** 勾选面板只在总览页有意义，切走时复位，避免下次进来莫名展开 */
export function resetOverviewUi() {
  pickerOpen = false;
  lastSec = -1;
}

export function bindOverviewEvents() {
  // 用捕获阶段拿到 change：checkbox 的 click 在部分浏览器会早于状态更新
  document.addEventListener('change', (e) => {
    const box = e.target.closest('[data-ov-src]');
    if (!box) return;
    toggleSource(box.dataset.ovSrc);
    refresh();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ov-act]');
    if (!btn) return;
    const act = btn.dataset.ovAct;
    const root = btn.closest('.view') || document.querySelector('#stage');

    if (act === 'pick-src') {
      const opened = !pickerOpen;
      setPicker(root, opened);
      if (opened) {
        // 展开后常常需要看订阅源，顺手补一次
        if (getNews().subs.length) void loadFeeds();
      }
      return;
    }

    if (act === 'refresh-news') {
      void loadHot(true);
      if (getNews().subs.length) void loadFeeds(true);
      return;
    }

    if (act === 'add-link') { openLinkDialog(); return; }

    if (act === 'del-link') {
      const id = btn.dataset.ovId;
      const link = getOverview().links.find((l) => l.id === id);
      if (!link) return;
      void confirmDialog({
        title: '删除这个入口？',
        desc: `「${link.title}」将从快捷入口里移除，随时可以重新添加。`,
        confirmText: '删除',
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        removeLink(id);
        refresh();
        toast(`${icon('check')} 已删除`);
      });
    }
  });
}

/** 视图挂载时调用：启动时钟、补资讯数据、恢复勾选面板的开合状态 */
export function onOverviewMounted(root) {
  startClock(root);
  setPicker(root, pickerOpen);
  ensureNews();
}
