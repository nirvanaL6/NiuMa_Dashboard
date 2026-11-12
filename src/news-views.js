/**
 * 资讯模块视图模板
 * 只负责结构，交互由 news-app.js 的事件委托处理（data-news-act）
 */
import { icon } from './icons.js';
import {
  getNews, findKeep, newsState, BOARD_PREVIEW, relTime, clockTime, accentOf, indexItems, hostOf, PRESET_FEEDS,
} from './news-model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = esc;

const SOURCE_LABEL = { rss: 'RSS', atom: 'Atom', json: 'JSON Feed', page: '网页' };

/* ------------------------------------------------------------------ */
/* 条目右侧的两个单图标：稍后读 / 收藏                                  */
/* ------------------------------------------------------------------ */
function acts(it, { later, fav }) {
  const b = (kind, on, iconName, label) => `<button type="button"
    class="ni__act ${on ? 'is-on' : ''}" data-news-act="${kind}" data-news-id="${attr(it.id)}"
    aria-pressed="${on}" title="${label}" aria-label="${label}">${icon(iconName, 14)}</button>`;
  return `<span class="ni__acts">
    ${b('later', later, 'bookmark', later ? '取消稍后读' : '稍后读')}
    ${b('fav', fav, 'star', fav ? '取消收藏' : '收藏')}
  </span>`;
}

function timeTag(it) {
  return it.ts ? relTime(it.ts) : '';
}

/* ------------------------------------------------------------------ */
/* 一、实时推荐：四列热榜并列                                           */
/* ------------------------------------------------------------------ */
function marksOf(it, lists) {
  return { later: findKeep(lists.later, it.id), fav: findKeep(lists.fav, it.id) };
}

function hotRow(it, lists) {
  return `<li class="ni">
    <a class="ni__link" href="${attr(it.url)}" target="_blank" rel="noopener noreferrer" title="${attr(it.title)}">
      <span class="ni__rank${it.rank <= 3 ? ' top' : ''}">${it.rank || ''}</span>
      <span class="ni__t">${esc(it.title)}</span>
      ${it.hot ? `<span class="ni__hot">${esc(it.hot)}</span>` : ''}
    </a>
    ${acts(it, marksOf(it, lists))}
  </li>`;
}

function skeletonBoard() {
  return `<div class="board board--sk" aria-hidden="true">
    <div class="board__head"><span class="sk sk--dot"></span><span class="sk sk--ttl"></span></div>
    ${Array.from({ length: 7 }, (_, i) => `<div class="board__line"><span class="sk" style="width:${88 - i * 4}%"></span></div>`).join('')}
  </div>`;
}

function boardCard(b, lists) {
  const open = !!newsState.expanded[b.id];
  const list = open ? b.items : b.items.slice(0, BOARD_PREVIEW);
  const rest = b.items.length - list.length;
  // 有的源不返回热度（百度常见）：整列都不显示时把热度列让给标题
  const hasHot = b.items.some((it) => it.hot);
  return `<section class="board${hasHot ? '' : ' board--nohot'}" data-board="${attr(b.id)}" style="--c:${attr(b.accent)}">
    <header class="board__head">
      <span class="board__dot"></span>
      <h3 class="board__ttl">${esc(b.label)}</h3>
      <a class="board__home" href="${attr(b.home)}" target="_blank" rel="noopener noreferrer" title="打开${attr(b.label)}">${icon('arrowUpRight', 13)}</a>
    </header>
    ${b.error
      ? `<div class="board__empty">
          <span class="board__err">${esc(b.error)}</span>
          <button type="button" class="btn btn--ghost btn--sm" data-news-act="refresh" data-news-scope="hot">${icon('refresh', 13)} 重试</button>
        </div>`
      : `<ol class="board__list">${list.map((it) => hotRow(it, lists)).join('')}</ol>
        ${rest > 0 || open ? `<button type="button" class="board__more" data-news-act="expand" data-board-id="${attr(b.id)}">
          ${open ? '收起' : `展开全部 ${b.items.length} 条`}
        </button>` : ''}`}
  </section>`;
}

export function viewNewsRealtime() {
  const { hot, hotLoading, hotError } = newsState;
  const { later, fav } = getNews();
  const lists = { later, fav };

  if (hot?.boards?.length) indexItems(hot.boards.flatMap((b) => b.items));

  let body;
  if (hot?.boards?.length) {
    body = `<div class="board-row" data-board-row data-scrollx>
      ${hot.boards.map((b) => boardCard(b, lists)).join('')}
    </div>`;
  } else if (hotError && !hotLoading) {
    body = `<div class="card"><div class="news-empty">
      <span class="news-empty__ic">${icon('bolt', 22, 1.6)}</span>
      <h4>热榜没拉到</h4><p>${esc(hotError)}</p>
      <button type="button" class="btn btn--primary btn--sm" data-news-act="refresh" data-news-scope="hot">${icon('refresh', 13)} 重新获取</button>
    </div></div>`;
  } else {
    body = `<div class="board-row">${Array.from({ length: 4 }, skeletonBoard).join('')}</div>`;
  }

  return `
  <div class="view-actions">
    <span class="na-meta">
      <span class="na-live"><i></i>实时</span>
      <span class="card-sub">${hot ? `更新于 ${clockTime(hot.fetchedAt)} · 每 2 分钟自动刷新` : '正在获取实时热榜…'}</span>
    </span>
    <div class="na-tools">
      <button type="button" class="btn btn--ghost btn--sm" data-news-act="refresh" data-news-scope="hot">${icon('refresh', 13)} 刷新</button>
    </div>
  </div>
  ${body}`;
}

/* ------------------------------------------------------------------ */
/* 二、订阅话题：按源分框，横向排列                                     */
/* ------------------------------------------------------------------ */
function subItem(it, lists, sourceTitle) {
  const item = { ...it, source: sourceTitle };
  return `<li class="si${it.image ? ' has-img' : ''}">
    <a class="si__link" href="${attr(item.url)}" target="_blank" rel="noopener noreferrer" title="${attr(item.title)}">
      <span class="si__t">${esc(item.title)}</span>
      <span class="si__m">${esc(timeTag(item) || hostOf(item.url))}</span>
    </a>
    ${it.image ? `<span class="si__thumb"><img src="${attr(it.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>` : ''}
    ${acts(item, marksOf(item, lists))}
  </li>`;
}

function subCard(sub, lists) {
  const src = newsState.feeds[sub.url];
  const items = src?.items || [];
  const title = src?.title || sub.title;
  const busy = newsState.feedLoading && !src;
  const type = src?.type || sub.type;

  return `<section class="sub" data-sub-id="${attr(sub.id)}">
    <header class="sub__head">
      <span class="sub__badge" style="--c:${accentOf(title)}">${esc(String(title).slice(0, 1))}</span>
      <span class="sub__ttl"><b title="${attr(title)}">${esc(title)}</b>
        <span>${esc(SOURCE_LABEL[type] || 'RSS')}${items.length ? ` · ${items.length} 条` : ''}</span>
      </span>
      <button type="button" class="sub__x" data-news-act="del-sub" data-news-id="${attr(sub.id)}"
        title="取消订阅" aria-label="取消订阅 ${attr(title)}">${icon('trash', 14)}</button>
    </header>
    ${busy ? `<div class="sub__list">${Array.from({ length: 4 }, (_, i) => `<div class="sub__line"><span class="sk" style="width:${86 - i * 7}%"></span></div>`).join('')}</div>`
      : src?.error
        ? `<div class="sub__err">${esc(src.error)}<button type="button" class="btn btn--ghost btn--sm" data-news-act="refresh" data-news-scope="feed">重试</button></div>`
        : items.length
          ? `<ul class="sub__list">${items.slice(0, 8).map((it) => subItem(it, lists, title)).join('')}</ul>`
          : `<div class="sub__err">这个源暂时没有条目</div>`}
    ${items.length > 8 ? `<footer class="sub__foot"><a href="${attr(src?.siteUrl || sub.url)}" target="_blank" rel="noopener noreferrer">还有 ${items.length - 8} 条，去站点看全部 ${icon('arrowUpRight', 12)}</a></footer>` : ''}
  </section>`;
}

export function viewNewsTopics() {
  const { subs, later, fav } = getNews();
  const lists = { later, fav };
  Object.values(newsState.feeds).forEach((s) => indexItems(s.items));

  return `
  <div class="view-actions">
    <span class="na-meta">
      <span class="chip chip--primary">${icon('rss', 12)} ${subs.length} 个源</span>
      <span class="card-sub">支持 RSS / Atom / 普通网页，每 10 分钟自动刷新</span>
    </span>
    <div class="na-tools">
      ${subs.length ? `<button type="button" class="btn btn--ghost btn--sm" data-news-act="refresh" data-news-scope="feed">${icon('refresh', 13)} 刷新</button>` : ''}
      <button type="button" class="btn btn--primary btn--sm" data-news-act="add-sub">${icon('plus', 13, 2.2)} 添加订阅</button>
    </div>
  </div>
  ${subs.length
    ? `<div class="sub-row" data-scrollx>${subs.map((s) => subCard(s, lists)).join('')}</div>`
    : `<div class="card"><div class="news-empty">
        <span class="news-empty__ic">${icon('rss', 22, 1.6)}</span>
        <h4>还没有订阅源</h4>
        <p>粘贴任意 RSS / Atom 地址，或直接丢一个常看的网站首页，我们会自动找它的订阅源。</p>
        <div class="news-presets">
          ${PRESET_FEEDS.map((p) => `<button type="button" class="preset" data-news-act="quick-sub" data-url="${attr(p.url)}" data-title="${attr(p.title)}">
            <b>${esc(p.title)}</b><span>${esc(p.desc)}</span>
          </button>`).join('')}
        </div>
      </div></div>`}`;
}

/* ------------------------------------------------------------------ */
/* 三、稍后读 / 四、收藏                                                */
/* ------------------------------------------------------------------ */
function keepRow(it, kind, lists) {
  return `<li class="ki">
    <a class="ki__link" href="${attr(it.url)}" target="_blank" rel="noopener noreferrer" title="${attr(it.title)}">
      ${it.image ? `<span class="ki__thumb"><img src="${attr(it.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>` : ''}
      <span class="ki__main">
        <span class="ki__t">${esc(it.title)}</span>
        <span class="ki__m"><span>${esc(it.source || hostOf(it.url))}</span><span class="dot-line"></span><span>${esc(relTime(it.ts))}${kind === 'later' ? '加入' : '收藏'}</span></span>
      </span>
    </a>
    ${acts(it, marksOf(it, lists))}
  </li>`;
}

function keepView(kind) {
  const { later, fav } = getNews();
  const list = kind === 'later' ? later : fav;
  const lists = { later, fav };
  indexItems(list);

  const copy = kind === 'later'
    ? { title: '稍后读', desc: '存下来还没读的，读完记得点掉书签', empty: '还没有标记稍后读的内容', cta: '去实时推荐挑几条' }
    : { title: '收藏', desc: '值得留档的条目，按收藏时间倒序', empty: '还没有收藏的内容', cta: '去实时推荐看看' };

  return `
  <div class="view-actions">
    <span class="na-meta">
      <span class="chip chip--primary">${icon(kind === 'later' ? 'bookmark' : 'star', 12)} ${list.length} 条</span>
      <span class="card-sub">${copy.desc}</span>
    </span>
  </div>
  ${list.length
    ? `<ul class="keep-list">${list.map((it) => keepRow(it, kind, lists)).join('')}</ul>`
    : `<div class="card"><div class="news-empty">
        <span class="news-empty__ic">${icon(kind === 'later' ? 'bookmark' : 'star', 22, 1.6)}</span>
        <h4>${copy.empty}</h4>
        <p>在「实时推荐」或「订阅话题」里点条目右侧的图标，就会出现在这里。</p>
        <button type="button" class="btn btn--ghost btn--sm" data-news-act="go-realtime">${icon('flame', 13)} ${copy.cta}</button>
      </div></div>`}`;
}

export const viewNewsLater = () => keepView('later');
export const viewNewsFav = () => keepView('fav');

export { SOURCE_LABEL };
