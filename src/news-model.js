/**
 * 资讯模块的数据模型
 *
 * 存储位置：与待办共用同一份快照（localStorage / 云端 payload），
 * 因此免登录与登录模式都能用，且不需要新建表。
 *
 *   news = {
 *     subs:  [{ id, url, title, type: 'rss'|'page', addedAt }],
 *     later: [{ id, url, title, source, image, ts }],   // 稍后读
 *     fav:   [{ id, url, title, source, image, ts }],   // 收藏
 *   }
 *
 * 热榜条目不落库（每天都在变），只把用户点过「稍后读 / 收藏」的那一条
 * 存成快照，断网也能看到自己存了什么。
 */
import * as store from './store.js';

export const MAX_KEEP = 200;
export const MAX_SUBS = 12;

const str = (v, n = 600) => String(v ?? '').slice(0, n);

export function itemId(url) {
  let h = 0x811c9dc5;
  const s = String(url || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'n' + h.toString(36) + s.length.toString(36);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return str(url, 60);
  }
}

function normalizeKeep(x) {
  if (!x || !x.url || !x.title) return null;
  return {
    id: str(x.id, 24) || itemId(x.url),
    url: str(x.url, 900),
    title: str(x.title, 200),
    source: str(x.source, 40),
    image: str(x.image, 900),
    ts: Number(x.ts) || Date.now(),
  };
}

export function getNews() {
  const raw = store.getData().news || {};
  const subs = (Array.isArray(raw.subs) ? raw.subs : [])
    .filter((s) => s?.url)
    .slice(0, MAX_SUBS)
    .map((s) => ({
      id: str(s.id, 24) || itemId(s.url),
      url: str(s.url, 900),
      title: str(s.title, 60) || hostOf(s.url),
      type: s.type === 'page' ? 'page' : 'rss',
      addedAt: Number(s.addedAt) || 0,
    }));
  const keep = (list) => (Array.isArray(list) ? list : []).map(normalizeKeep).filter(Boolean).slice(0, MAX_KEEP);
  return { subs, later: keep(raw.later), fav: keep(raw.fav) };
}

export function saveNews(patch) {
  const cur = getNews();
  store.saveData({ news: { ...cur, ...patch } });
  return getNews();
}

export const findKeep = (list, id) => list.some((x) => x.id === id);

/**
 * 切换「稍后读 / 收藏」。
 * @returns {boolean} 切换后是否处于已收藏状态
 */
export function toggleKeep(kind, item) {
  const cur = getNews();
  const list = cur[kind] || [];
  const on = !findKeep(list, item.id);
  const next = on
    ? [normalizeKeep({ ...item, ts: item.ts || Date.now() }), ...list].slice(0, MAX_KEEP)
    : list.filter((x) => x.id !== item.id);
  saveNews({ [kind]: next });
  return on;
}

export function addSub({ url, title, type = 'rss' }) {
  const cur = getNews();
  if (cur.subs.some((s) => s.url === url)) return { ok: false, reason: 'exists' };
  if (cur.subs.length >= MAX_SUBS) return { ok: false, reason: 'limit' };
  saveNews({ subs: [...cur.subs, { id: itemId(url), url, title: title || hostOf(url), type, addedAt: Date.now() }] });
  return { ok: true };
}

export function removeSub(id) {
  const cur = getNews();
  saveNews({ subs: cur.subs.filter((s) => s.id !== id) });
}

/* ------------------------------------------------------------------ */
/* 运行时状态：热榜与订阅源都放内存，切视图不重复请求                    */
/* ------------------------------------------------------------------ */
export const newsState = {
  hot: null,           // { boards:[...], fetchedAt }
  hotLoading: false,
  hotError: '',
  feeds: {},           // url -> { title, type, items, error, at }
  feedLoading: false,
  feedError: '',
  feedTriedAt: 0,
  expanded: {},        // boardId -> bool（每个榜单先露 10 条）
};

/** 每个榜单首屏露多少条 */
export const BOARD_PREVIEW = 10;

/* 条目索引：按钮上只带 id，避免把标题/链接塞满 DOM 属性 */
const index = new Map();

export function indexItems(list) {
  if (index.size > 800) index.clear();
  (list || []).forEach((it) => {
    if (it?.id && !index.has(it.id)) index.set(it.id, it);
  });
}

export function lookupItem(id) {
  if (index.has(id)) return index.get(id);
  const { later, fav } = getNews();
  return later.find((x) => x.id === id) || fav.find((x) => x.id === id) || null;
}

/* ---------------- 展示辅助 ---------------- */
export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (!Number.isFinite(diff) || diff < 0) return '';
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)} 天前`;
  const d = new Date(Number(ts));
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function clockTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const PALETTE = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];
export function accentOf(str2) {
  let n = 0;
  for (const ch of String(str2 || '')) n = (n * 31 + ch.charCodeAt(0)) % 997;
  return PALETTE[n % PALETTE.length];
}

/** 空状态与订阅弹窗共用的预设源 */
export const PRESET_FEEDS = [
  { title: '少数派', url: 'https://sspai.com/feed', desc: '效率工具与数字生活' },
  { title: 'IT之家', url: 'https://www.ithome.com/rss/', desc: '科技新闻密度高' },
  { title: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', desc: '每周科技周刊' },
];
