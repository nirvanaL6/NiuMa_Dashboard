/**
 * 总览视图模板
 * 四块等宽卡片：左上北京时间 / 左下当日待办 / 右上资讯速览 / 右下快捷入口
 * 只负责结构，交互由 overview-app.js 的事件委托处理（data-ov-act）
 */
import { icon } from './icons.js';
import {
  allSources, activeSources, getOverview, todayTodos, todayStats, quadMetaOf, SOURCE_PREVIEW,
} from './overview-model.js';
import { newsState, relTime, hostOf } from './news-model.js';
import { fmtDue } from './todo-model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = esc;

/* ------------------------------------------------------------------ */
/* 一、标准北京时间（精确到秒）                                         */
/* ------------------------------------------------------------------ */
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 首屏就用渲染时刻填好内容，避免刚挂载那一帧显示占位符 */
function clockHTML() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    hm: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    s: pad(d.getSeconds()),
    date: `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`,
    week: WEEKDAY[d.getDay()],
  };
}

function cardClock() {
  const c = clockHTML();
  return `<section class="ovw-card ovw-clock" aria-labelledby="ovClockTitle">
    <header class="ovw-card__head">
      <h3 id="ovClockTitle">${icon('clock', 14)} 标准北京时间</h3>
      <span class="ovw-tag">UTC+8</span>
    </header>
    <div class="ovw-clock__face">
      <b class="ovw-clock__hm" data-ov-clock="hm">${c.hm}</b>
      <i class="ovw-clock__s" data-ov-clock="s">${c.s}</i>
    </div>
    <p class="ovw-clock__date">
      <span data-ov-clock="date">${c.date}</span>
      <span class="ovw-dot"></span>
      <span data-ov-clock="week">${c.week}</span>
    </p>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* 二、当日待办                                                         */
/* ------------------------------------------------------------------ */
function todoRow(t) {
  const q = quadMetaOf(t);
  const when = t.__at ? fmtDue(t.__at) : '';
  return `<li class="ovw-todo${t.__late ? ' is-late' : ''}" data-todo-row="${attr(t.id)}">
    <button type="button" class="check" data-toggle-todo="${attr(t.id)}"
      role="checkbox" aria-checked="false" aria-label="标记完成：${attr(t.title)}">
      ${icon('check', 11, 2.6)}
    </button>
    <span class="ovw-todo__body">
      <b class="ovw-todo__t" title="${attr(t.title)}">${esc(t.title)}</b>
      <span class="ovw-todo__m">
        ${t.__late ? `<em class="ovw-late">已逾期</em>` : ''}
        ${when ? `<span>${esc(when)}</span>` : '<span class="ovw-muted">未排时间</span>'}
        ${q ? `<span class="ovw-prio" style="--c:${q.accent}"><i></i>${q.label}</span>` : ''}
      </span>
    </span>
  </li>`;
}

function cardTodos() {
  const list = todayTodos();
  const st = todayStats();
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  return `<section class="ovw-card ovw-todos" aria-labelledby="ovTodoTitle">
    <header class="ovw-card__head">
      <h3 id="ovTodoTitle">${icon('check', 14, 2.4)} 当日待办</h3>
      <span class="ovw-card__meta">${st.done}/${st.total} 已完成</span>
    </header>
    <div class="ovw-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
      aria-label="今日完成度 ${pct}%"><i style="--v:${pct}%"></i></div>
    ${list.length
      ? `<ul class="ovw-todo-list">${list.map(todoRow).join('')}</ul>`
      : `<div class="ovw-empty ovw-empty--sm">
          ${icon('inbox', 20, 1.6)}
          <p>今天没有待办，享受一下。</p>
          <button type="button" class="btn btn--ghost btn--sm" data-jump="todo">去排几件</button>
        </div>`}
    <footer class="ovw-card__foot">
      <a href="#" data-jump="todo">全部待办 ${icon('chevronRight', 12)}</a>
    </footer>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* 三、资讯速览                                                         */
/* ------------------------------------------------------------------ */
function hotBlock(src) {
  const board = (newsState.hot?.boards || []).find((b) => b.id === src.id);
  if (!board) return linkBlock(src, '');
  if (board.error) {
    return `<div class="ovw-src">
      <div class="ovw-src__head"><span class="ovw-src__dot" style="--c:${src.accent}"></span><b>${esc(src.label)}</b></div>
      <p class="ovw-src__err">${esc(board.error)}</p>
    </div>`;
  }
  return `<div class="ovw-src">
    <div class="ovw-src__head">
      <span class="ovw-src__dot" style="--c:${src.accent}"></span><b>${esc(src.label)}</b>
      <span class="ovw-src__more">${board.items.length} 条</span>
    </div>
    <ul class="ovw-src__list">
      ${board.items.slice(0, SOURCE_PREVIEW).map((it) => `<li>
        <a href="${attr(it.url)}" target="_blank" rel="noopener noreferrer" title="${attr(it.title)}">
          <span class="ovw-rank${it.rank <= 3 ? ' is-top' : ''}">${it.rank}</span>
          <span class="ovw-src__t">${esc(it.title)}</span>
        </a>
      </li>`).join('')}
    </ul>
  </div>`;
}

function linkBlock(src, err) {
  const src2 = newsState.feeds[src.url] || {};
  const items = src2.items || [];
  const head = `<div class="ovw-src__head">
    <span class="ovw-src__dot" style="--c:${src.accent}"></span><b>${esc(src.label)}</b>
    ${items.length ? `<span class="ovw-src__more">${items.length} 条</span>` : ''}
  </div>`;
  if (err || src2.error) return `<div class="ovw-src">${head}<p class="ovw-src__err">${esc(err || src2.error)}</p></div>`;
  if (!items.length) return `<div class="ovw-src">${head}<p class="ovw-src__err">还没有内容</p></div>`;
  return `<div class="ovw-src">${head}
    <ul class="ovw-src__list">
      ${items.slice(0, SOURCE_PREVIEW).map((it) => `<li>
        <a href="${attr(it.url)}" target="_blank" rel="noopener noreferrer" title="${attr(it.title)}">
          <span class="ovw-rank ovw-rank--dot"></span>
          <span class="ovw-src__t">${esc(it.title)}</span>
          <span class="ovw-src__time">${esc(relTime(it.ts))}</span>
        </a>
      </li>`).join('')}
    </ul>
  </div>`;
}

/** 勾选面板：热榜 + 已订阅源，就地展开，不弹窗 */
function sourcePicker() {
  const picked = new Set(getOverview().sources);
  const all = allSources();
  const feeds = all.filter((s) => s.kind === 'feed');
  return `<div class="ovw-picker" data-ov-picker hidden>
    <div class="ovw-picker__hd">选择要显示的资讯列表</div>
    <div class="ovw-picker__grid">
      ${all.filter((s) => s.kind === 'hot').map((s) => `<label class="ovw-opt">
        <input type="checkbox" data-ov-src="${attr(s.id)}" ${picked.has(s.id) ? 'checked' : ''} />
        <span class="ovw-opt__box">${icon('check', 11, 2.8)}</span>
        <span>${esc(s.label)}</span>
      </label>`).join('')}
    </div>
    ${feeds.length ? `<div class="ovw-picker__hd">已订阅</div>
      <div class="ovw-picker__grid">
        ${feeds.map((s) => `<label class="ovw-opt">
          <input type="checkbox" data-ov-src="${attr(s.id)}" ${picked.has(s.id) ? 'checked' : ''} />
          <span class="ovw-opt__box">${icon('check', 11, 2.8)}</span>
          <span title="${attr(s.label)}">${esc(s.label)}</span>
        </label>`).join('')}
      </div>` : `<p class="ovw-picker__tip">在「资讯 → 订阅话题」里添加 RSS 源后，这里会多出可选项。</p>`}
  </div>`;
}

function cardNews() {
  const active = activeSources();
  const loading = newsState.hotLoading;
  const err = newsState.hotError;
  return `<section class="ovw-card ovw-news" aria-labelledby="ovNewsTitle">
    <header class="ovw-card__head">
      <h3 id="ovNewsTitle">${icon('flame', 14)} 资讯速览</h3>
      <span class="ovw-card__acts">
        <button type="button" class="ovw-iconbtn" data-ov-act="pick-src" aria-expanded="false"
          title="选择显示的资讯列表" aria-label="选择显示的资讯列表">${icon('filter', 14)}</button>
        <button type="button" class="ovw-iconbtn ${loading ? 'is-spin' : ''}" data-ov-act="refresh-news"
          title="刷新" aria-label="刷新资讯">${icon('refresh', 14)}</button>
      </span>
    </header>
    ${sourcePicker()}
    ${!active.length
      ? `<div class="ovw-empty ovw-empty--sm">
          ${icon('filter', 20, 1.6)}
          <p>还没选择要显示的资讯列表。</p>
          <button type="button" class="btn btn--ghost btn--sm" data-ov-act="pick-src">去选</button>
        </div>`
      : loading && !newsState.hot
        ? `<div class="ovw-skel">${Array.from({ length: 4 }, (_, i) => `<span class="sk" style="width:${92 - i * 9}%"></span>`).join('')}</div>`
        : `<div class="ovw-srcs">${active.map((s) => (s.kind === 'hot' ? hotBlock(s) : linkBlock(s))).join('')}</div>`}
    ${err ? `<p class="ovw-news__err">${esc(err)}<button type="button" class="btn btn--ghost btn--sm" data-ov-act="refresh-news">重试</button></p>` : ''}
    <footer class="ovw-card__foot">
      <a href="#" data-jump="news">完整资讯 ${icon('chevronRight', 12)}</a>
    </footer>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* 四、自定义工具 / 网页超链接                                          */
/* ------------------------------------------------------------------ */
const PALETTE = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];
const accentOf = (s) => {
  let n = 0;
  for (const ch of String(s || '')) n = (n * 31 + ch.charCodeAt(0)) % 997;
  return PALETTE[n % PALETTE.length];
};

function cardLinks() {
  const { links } = getOverview();
  return `<section class="ovw-card ovw-links" aria-labelledby="ovLinksTitle">
    <header class="ovw-card__head">
      <h3 id="ovLinksTitle">${icon('layers', 14)} 快捷入口</h3>
      <span class="ovw-card__acts">
        <button type="button" class="ovw-iconbtn" data-ov-act="add-link"
          title="添加快捷入口" aria-label="添加快捷入口">${icon('plus', 14, 2.6)}</button>
      </span>
    </header>
    ${links.length
      ? `<div class="ovw-linkgrid">
          ${links.map((l) => `<div class="ovw-link" style="--c:${accentOf(l.title)}">
            <a href="${attr(l.url)}" target="_blank" rel="noopener noreferrer" title="${attr(l.url)}">
              <span class="ovw-link__badge">${esc((l.title || '?').slice(0, 1).toUpperCase())}</span>
              <span class="ovw-link__txt"><b>${esc(l.title)}</b><i>${esc(hostOf(l.url))}</i></span>
              ${icon('arrowUpRight', 13)}
            </a>
            <button type="button" class="ovw-link__x" data-ov-act="del-link" data-ov-id="${attr(l.id)}"
              title="删除" aria-label="删除 ${attr(l.title)}">${icon('close', 11)}</button>
          </div>`).join('')}
        </div>`
      : `<div class="ovw-empty">
          ${icon('globe', 22, 1.5)}
          <p>把常去的网站、内部系统挂在这里，一点就到。</p>
          <button type="button" class="btn btn--ghost btn--sm" data-ov-act="add-link">
            ${icon('plus', 12, 2.6)} 添加第一个
          </button>
        </div>`}
  </section>`;
}

/* ------------------------------------------------------------------ */
export function viewOverviewHome() {
  // 用「列」而不是 grid 的行来摆放：同一行里的两个卡片若用 grid-row 对齐，
  // 行高由较高者决定，会把左下的待办一路推到资讯卡下面。分列后左右互不影响，
  // 正好满足「宽度一致、高度各随内容」。移动端退化成单列时，
  // DOM 顺序天然就是 时钟 → 待办 → 资讯 → 入口。
  return `<div class="ovw-grid">
    <div class="ovw-col">${cardClock()}${cardTodos()}</div>
    <div class="ovw-col">${cardNews()}${cardLinks()}</div>
  </div>`;
}
