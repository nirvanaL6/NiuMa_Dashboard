/**
 * 总览模块的数据模型
 *
 * 存储位置与待办、资讯共用同一份快照，因此两种模式（免登录 / 云端）都自动可用：
 *
 *   overview = {
 *     sources: ['weibo', 'zhihu', 'feed:https://sspai.com/feed'],  // 资讯速览要显示哪些列表
 *     links:   [{ id, title, url }],                               // 自定义工具与网页链接
 *   }
 *
 * 资讯源用字符串 id 描述：
 *   - 热榜：'weibo' | 'baidu' | 'zhihu' | 'wechat'
 *   - 订阅：'feed:<订阅地址>'（订阅被删掉后，这里残留的 id 会被自动忽略）
 */
import * as store from './store.js';
import { getNews, hostOf } from './news-model.js';
import { QUADRANTS, quadOf, dayKey } from './todo-model.js';

/** 热榜四路（与 server/src/news.js 的 HOT_SOURCES 保持一致） */
export const HOT_SOURCES = [
  { id: 'weibo', label: '微博热搜', accent: '#f43f5e' },
  { id: 'baidu', label: '百度热搜', accent: '#3b82f6' },
  { id: 'zhihu', label: '知乎热榜', accent: '#6366f1' },
  { id: 'wechat', label: '微信热文', accent: '#22b573' },
];

export const MAX_LINKS = 24;
/** 每个资讯源在速览里露几条（速览 = 一眼扫完，源多时也不会把卡片拉得老长） */
export const SOURCE_PREVIEW = 4;

const str = (v, n = 200) => String(v ?? '').slice(0, n);

export function linkId(url) {
  let h = 0x811c9dc5;
  const s = String(url || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'l' + h.toString(36);
}

const ALL_HOT = HOT_SOURCES.map((s) => s.id);

export function getOverview() {
  const raw = store.getData().overview || {};
  const sources = Array.isArray(raw.sources) ? raw.sources.filter((x) => typeof x === 'string') : null;
  const links = (Array.isArray(raw.links) ? raw.links : [])
    .filter((l) => l?.url)
    .slice(0, MAX_LINKS)
    .map((l) => ({
      id: str(l.id, 20) || linkId(l.url),
      title: str(l.title, 40) || hostOf(l.url),
      url: str(l.url, 900),
    }));
  return {
    // 首次使用没有配置过：默认显示四路热榜，用户改过之后以存储为准（哪怕改成空数组）
    sources: sources ?? ALL_HOT,
    links,
  };
}

export function saveOverview(patch) {
  const cur = getOverview();
  store.saveData({ overview: { ...cur, ...patch } });
  return getOverview();
}

/** 勾选 / 取消勾选一个资讯源 */
export function toggleSource(id) {
  const cur = getOverview();
  const on = cur.sources.includes(id);
  return saveOverview({
    sources: on ? cur.sources.filter((x) => x !== id) : [...cur.sources, id],
  });
}

export function addLink({ title, url }) {
  const cur = getOverview();
  if (cur.links.some((l) => l.url === url)) return { ok: false, reason: 'exists' };
  if (cur.links.length >= MAX_LINKS) return { ok: false, reason: 'limit' };
  saveOverview({ links: [...cur.links, { id: linkId(url), title: title || hostOf(url), url }] });
  return { ok: true };
}

export function removeLink(id) {
  saveOverview({ links: getOverview().links.filter((l) => l.id !== id) });
}

/* ------------------------------------------------------------------ */
/* 资讯源清单：热榜 + 已订阅的源                                        */
/* ------------------------------------------------------------------ */

/**
 * 可选的全部资讯列表。
 * 订阅源排在热榜后面，用户没订阅任何源时只剩四路热榜。
 */
export function allSources() {
  const { subs } = getNews();
  return [
    ...HOT_SOURCES.map((s) => ({ id: s.id, label: s.label, accent: s.accent, kind: 'hot' })),
    ...subs.map((s) => ({ id: `feed:${s.url}`, label: s.title, accent: '#8b5cf6', kind: 'feed', url: s.url })),
  ];
}

/**
 * 勾选后实际要渲染的源。
 * 订阅被取消后 `feed:<url>` 会失效，这里顺手过滤掉，避免总览挂一个空壳卡片。
 */
export function activeSources() {
  const picked = new Set(getOverview().sources);
  return allSources().filter((s) => picked.has(s.id));
}

/* ------------------------------------------------------------------ */
/* 今日待办                                                            */
/* ------------------------------------------------------------------ */

const timeOf = (t) => {
  const v = t.due || t.planAt || '';
  const m = String(v).match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
};

/**
 * 今天的待办：今天到期 / 今天计划 / 已逾期仍未完成。
 *
 * 「当日」的判定用 due 优先、planAt 兜底——待办可能只排了日期没排具体时间，
 * 也可能只写了截止时间，两种都要能落到今天这一栏。
 */
export function todayTodos(now = new Date()) {
  const today = dayKey(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  const list = (store.getData().todos || []).filter((t) => !t.done);
  const picked = [];
  for (const t of list) {
    const day = dayKey(t.due) || dayKey(t.planAt);
    if (!day) continue;
    if (day === today) picked.push({ ...t, __late: false });
    else if (day < today) picked.push({ ...t, __late: true });
  }
  picked.sort((a, b) => {
    // 逾期的最前面；同组内按时间，没有时间的排后面
    if (a.__late !== b.__late) return a.__late ? -1 : 1;
    const ta = timeOf(a), tb = timeOf(b);
    if (ta && tb) return ta < tb ? -1 : ta > tb ? 1 : 0;
    if (ta) return -1;
    if (tb) return 1;
    return 0;
  });
  return picked;
}

export function quadMetaOf(t) {
  return QUADRANTS.find((q) => q.id === quadOf(t.tags)) || null;
}

/** 今日进度：完成数 / 今天该做的总数（含已完成的，用来画进度条） */
export function todayStats(now = new Date()) {
  const todayStr = dayKey(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  const all = (store.getData().todos || []).filter((t) => (dayKey(t.due) || dayKey(t.planAt)) === todayStr);
  const done = all.filter((t) => t.done).length;
  return { done, total: all.length, open: todayTodos(now).length };
}
