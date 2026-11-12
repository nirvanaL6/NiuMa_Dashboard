/**
 * 资讯模块交互层
 *
 * 数据获取全部走 Worker：浏览器直连微博 / 百度 / 知乎会被 CORS 和 Referer
 * 校验挡掉，订阅源同理。这里只负责「什么时候拉、拉到之后怎么渲染」。
 *
 * 刷新策略（避免把接口当轮询用，也避免每次切视图都重新拉）：
 *   - 进入「实时推荐」：数据超过 2 分钟才拉
 *   - 进入「订阅话题」：缺失或超过 10 分钟的源才拉
 *   - 页面重新可见时，同样按上面两条判断
 *   - 不设定时器：这个模块不需要后台常驻任务
 */
import { icon } from './icons.js';
import { API_BASE } from './api.js';
import { confirmDialog } from './dialog.js';
import {
  getNews, saveNews, addSub, removeSub, toggleKeep, lookupItem, newsState,
  hostOf, MAX_SUBS, PRESET_FEEDS,
} from './news-model.js';

const HOT_TTL = 2 * 60 * 1000;
const FEED_TTL = 10 * 60 * 1000;

let onChange = () => {};
let toastFn = () => {};
let goFn = () => {};
let bound = false;

export function mountNews(opts = {}) {
  onChange = opts.onChange || onChange;
  toastFn = opts.toast || toastFn;
  goFn = opts.go || goFn;
  // 切回标签页时补一次：用户很可能在别的页面待了很久
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const key = document.querySelector('#stage .view')?.dataset.viewKey || '';
    if (key === 'news:realtime' && Date.now() - (newsState.hot?.fetchedAt || 0) > HOT_TTL) void loadHot();
    if (key === 'news:topics' && needsFeeds()) void loadFeeds();
  });
}

const refresh = () => onChange({ keepScroll: true });
const toast = (msg) => { try { toastFn(msg); } catch { /* 视图已卸载 */ } };

function failText(e) {
  if (e?.name === 'TypeError') return '无法连接资讯服务，请检查网络后重试';
  return e?.message || '获取失败，请稍后重试';
}

/* ---------------- 热榜 ---------------- */
export async function loadHot(force = false) {
  if (newsState.hotLoading) return;
  if (!force && newsState.hot && Date.now() - newsState.hot.fetchedAt < HOT_TTL) return;
  // 失败后 30 秒内不再自动重试：视图每次重绘都会走到这里，
  // 没有这个闸门就会「失败 → 重绘 → 再失败」无限打转，把主线程占满。
  if (!force && Date.now() - newsState.hotTriedAt < 30_000) return;

  newsState.hotTriedAt = Date.now();
  newsState.hotLoading = true;
  newsState.hotError = '';
  refresh();
  try {
    const res = await fetch(`${API_BASE}/api/news/hot`, { headers: { accept: 'application/json' } });
    let data = null;
    try { data = await res.json(); } catch { /* 网关错误页 */ }
    if (!res.ok || data?.ok === false) throw new Error(data?.error?.message || `服务异常（${res.status}）`);
    const boards = Array.isArray(data.boards) ? data.boards : [];
    newsState.hot = { boards, fetchedAt: data.fetchedAt || Date.now() };
    if (!boards.some((b) => b.items?.length)) newsState.hotError = '四个数据源都没有返回内容，稍后再试';
  } catch (err) {
    newsState.hotError = failText(err);
    newsState.hot = null;
  } finally {
    newsState.hotLoading = false;
    refresh();
  }
}

/* ---------------- 订阅源 ---------------- */
function needsFeeds() {
  const { subs } = getNews();
  return subs.some((s) => {
    const hit = newsState.feeds[s.url];
    return !hit || Date.now() - (hit.at || 0) > FEED_TTL;
  });
}

export async function loadFeeds(force = false) {
  if (newsState.feedLoading) return;
  if (!force && Date.now() - newsState.feedTriedAt < 30_000) return;
  const { subs } = getNews();
  const urls = subs.filter((s) => force || !newsState.feeds[s.url] || Date.now() - (newsState.feeds[s.url].at || 0) > FEED_TTL)
    .map((s) => s.url);
  if (!urls.length) return;

  newsState.feedTriedAt = Date.now();
  newsState.feedLoading = true;
  newsState.feedError = '';
  refresh();
  try {
    const res = await fetch(`${API_BASE}/api/news/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* 网关错误页 */ }
    if (!res.ok || data?.ok === false) throw new Error(data?.error?.message || `服务异常（${res.status}）`);
    const list = Array.isArray(data.sources) ? data.sources : [];
    // 失败也记时间戳：否则每次进页面都会重试同一条坏链接
    list.forEach((s) => { newsState.feeds[s.url] = { ...s, at: s.at || Date.now() }; });
    backfillTitles(list);
    if (list.length && list.every((s) => s.error)) newsState.feedError = list[0].error;
  } catch (err) {
    newsState.feedError = failText(err);
    toast(`${icon('alert')} 订阅源刷新失败：${newsState.feedError}`);
  } finally {
    newsState.feedLoading = false;
    refresh();
  }
}

/** 首次订阅时只有域名当标题，抓到真名后写回存储，下次打开就不用再猜 */
function backfillTitles(list) {
  const { subs } = getNews();
  let dirty = false;
  const next = subs.map((s) => {
    const src = list.find((x) => x.url === s.url && x.title);
    if (!src) return s;
    if (s.title && s.title !== hostOf(s.url) && s.title !== s.url) return s;
    if (src.title === s.title) return s;
    dirty = true;
    return { ...s, title: src.title, type: src.type === 'page' ? 'page' : 'rss' };
  });
  // 走 model 的写入入口，保持「先本地后云端」的既有节奏
  if (dirty) saveNews({ subs: next });
}

/* ---------------- 进入视图时按需拉取 ---------------- */
export function loadNewsView(viewKey) {
  if (viewKey === 'news:realtime') { void loadHot(); return; }
  if (viewKey === 'news:topics') { if (needsFeeds()) void loadFeeds(); }
}

/* ---------------- 订阅弹窗 ---------------- */
function normalizeUrl(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.toString();
  } catch {
    return '';
  }
}

function openSubDialog(prefill = '') {
  document.querySelector('.ed-mask[data-sub-dialog]')?.remove();
  const mask = document.createElement('div');
  mask.className = 'ed-mask open';
  mask.dataset.subDialog = '1';
  mask.innerHTML = `
    <div class="ed ed--sub" role="dialog" aria-modal="true" aria-labelledby="subDlgTitle">
      <header class="ed__head">
        <h3 id="subDlgTitle">${icon('rss', 16, 2)} 添加订阅</h3>
        <button type="button" class="ed__x" data-sub-close aria-label="关闭">${icon('close', 15)}</button>
      </header>
      <div class="ed__body">
        <label class="ed__row">
          <span class="ed__label">RSS / 网页地址</span>
          <input class="ed__input" id="subUrl" value="${prefill.replace(/"/g, '&quot;')}" placeholder="https://sspai.com/feed" autocomplete="off" spellcheck="false" />
          <span class="ed__hint">支持 RSS、Atom、JSON Feed；填网站首页会自动找它的订阅源</span>
        </label>
        <label class="ed__row">
          <span class="ed__label">名称（可选）</span>
          <input class="ed__input" id="subName" maxlength="30" placeholder="留空则用站点标题" autocomplete="off" />
        </label>
        <div class="sub-presets">
          ${PRESET_FEEDS.map((p) => `<button type="button" class="preset preset--sm" data-sub-preset="${p.url}" data-preset-title="${p.title}">
            <b>${p.title}</b><span>${p.desc}</span></button>`).join('')}
        </div>
      </div>
      <footer class="ed__foot">
        <span class="ed__err" data-sub-err></span>
        <button type="button" class="btn btn--ghost btn--sm" data-sub-close>取消</button>
        <button type="button" class="btn btn--primary btn--sm" data-sub-ok>${icon('check', 13, 2.4)} 添加</button>
      </footer>
    </div>`;

  document.body.appendChild(mask);
  const input = mask.querySelector('#subUrl');
  const nameInput = mask.querySelector('#subName');
  const err = mask.querySelector('[data-sub-err]');
  const okBtn = mask.querySelector('[data-sub-ok]');
  requestAnimationFrame(() => input.focus());

  const close = () => mask.remove();
  const showErr = (msg) => { err.textContent = msg; };

  async function submit() {
    const url = normalizeUrl(input.value);
    if (!url) return showErr('请填写有效的 http / https 地址');
    const { subs } = getNews();
    if (subs.some((s) => s.url === url)) return showErr('这个源已经订阅过了');
    if (subs.length >= MAX_SUBS) return showErr(`最多订阅 ${MAX_SUBS} 个源`);

    okBtn.disabled = true;
    okBtn.innerHTML = `${icon('refresh', 13)} 正在读取…`;
    showErr('');
    try {
      const res = await fetch(`${API_BASE}/api/news/feed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: [url] }),
      });
      let data = null;
      try { data = await res.json(); } catch { /* 网关错误页 */ }
      if (!res.ok || data?.ok === false) throw new Error(data?.error?.message || `服务异常（${res.status}）`);
      const src = data.sources?.[0];
      if (!src) throw new Error('没有拿到内容，请确认地址是否可访问');
      if (src.error) throw new Error(src.error);
      const title = nameInput.value.trim() || src.title || hostOf(url);
      const added = addSub({ url, title, type: src.type === 'page' ? 'page' : 'rss' });
      if (!added.ok) throw new Error(added.reason === 'limit' ? `最多订阅 ${MAX_SUBS} 个源` : '这个源已经订阅过了');
      newsState.feeds[url] = src;
      close();
      refresh();
      toast(`${icon('check')} 已订阅「${title}」`);
    } catch (e) {
      showErr(failText(e));
      okBtn.disabled = false;
      okBtn.innerHTML = `${icon('check', 13, 2.4)} 添加`;
    }
  }

  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-sub-close]')) return close();
    const preset = e.target.closest('[data-sub-preset]');
    if (preset) {
      input.value = preset.dataset.subPreset;
      nameInput.value = preset.dataset.presetTitle || '';
      showErr('');
      return;
    }
    if (e.target.closest('[data-sub-ok]') && !okBtn.disabled) void submit();
  });
  mask.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); if (!okBtn.disabled) void submit(); }
  });
}

/* ---------------- 事件委托 ---------------- */
export function bindNewsEvents() {
  if (bound) return;
  bound = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-news-act]');
    if (!btn) return;
    const act = btn.dataset.newsAct;

    if (act === 'later' || act === 'fav') {
      const id = btn.dataset.newsId;
      const item = lookupItem(id);
      if (!item) return;
      const on = toggleKeep(act, item);
      toast(on
        ? `${icon(act === 'later' ? 'bookmark' : 'star')} 已加入${act === 'later' ? '稍后读' : '收藏'}`
        : `${icon('check')} 已取消${act === 'later' ? '稍后读' : '收藏'}`);
      refresh();
      return;
    }

    if (act === 'expand') {
      const bid = btn.dataset.boardId;
      newsState.expanded[bid] = !newsState.expanded[bid];
      refresh();
      return;
    }

    if (act === 'refresh') {
      if (btn.dataset.newsScope === 'feed') void loadFeeds(true);
      else void loadHot(true);
      return;
    }

    if (act === 'add-sub') { openSubDialog(); return; }

    if (act === 'quick-sub') {
      const url = btn.dataset.url;
      const title = btn.dataset.title;
      const r = addSub({ url, title });
      if (!r.ok) { toast(`${icon('info')} 已经订阅过这个源`); return; }
      toast(`${icon('check')} 已订阅「${title}」`);
      refresh();
      void loadFeeds(true);
      return;
    }

    if (act === 'del-sub') {
      const id = btn.dataset.newsId;
      const sub = getNews().subs.find((s) => s.id === id);
      if (!sub) return;
      void confirmDialog({
        title: '取消订阅？',
        desc: `「${sub.title}」将不再出现在订阅话题里，随时可以重新添加。`,
        confirmText: '取消订阅',
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        removeSub(id);
        delete newsState.feeds[sub.url];
        refresh();
        toast(`${icon('check')} 已取消订阅`);
      });
      return;
    }

    if (act === 'go-realtime') { goFn('news', 'realtime'); }
  });
}

export { openSubDialog };
