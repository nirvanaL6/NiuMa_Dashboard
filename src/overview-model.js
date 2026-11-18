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

const clockOf = (v) => {
  const m = String(v || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
};

const todayKey = (now) => dayKey(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);

/**
 * 今天的待办：今天计划 / 今天到期 / 已逾期仍未完成。
 *
 * 「当日」的判定必须同时看 due 和 planAt，两者是**或**关系：
 * 计划在今天、截止在下周的任务也是今天该做的（历史 bug：只看 due，
 * 这类任务在总览里直接消失）。逾期只认截止时间——没写截止时间的，
 * 退回计划日期判断（计划日已过 = 还没做完的老账）。
 */
export function todayTodos(now = new Date()) {
  const today = todayKey(now);
  const list = (store.getData().todos || []).filter((t) => !t.done);
  const picked = [];
  for (const t of list) {
    const dueDay = dayKey(t.due);
    const planDay = dayKey(t.planAt);
    const late = (!!dueDay && dueDay < today) || (!dueDay && !!planDay && planDay < today);
    const isToday = dueDay === today || planDay === today;
    if (!isToday && !late) continue;
    // 卡片上显示今天这一栏对应的时间：优先今天排的计划时间，其次今天到期的截止时间；
    // 逾期条目沿用原来的截止时间，让「晚了多久」看得出来
    const at = (planDay === today && t.planAt) || (dueDay === today && t.due) || (late ? t.due || t.planAt : '') || t.due || t.planAt;
    picked.push({ ...t, __late: late, __at: at });
  }
  picked.sort((a, b) => {
    // 逾期的最前面；同组内按时间，没有时间的排后面
    if (a.__late !== b.__late) return a.__late ? -1 : 1;
    const ta = clockOf(a.__at), tb = clockOf(b.__at);
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

/**
 * 今日进度：已完成 / 今天要做完的总数。
 *
 * 分母用「今天该做的（含逾期未完成的）+ 今天已完成」，与列表口径保持一致——
 * 否则卡片上写「4 条待办」，进度条却按 3 条算，比例看着就不对。
 */
export function todayStats(now = new Date()) {
  const today = todayKey(now);
  const open = todayTodos(now).length;
  // 已完成的只算今天排期或今天到期的，昨天以前做完的不该压低今天的完成度
  const done = (store.getData().todos || [])
    .filter((t) => t.done && (dayKey(t.due) === today || dayKey(t.planAt) === today)).length;
  return { done, total: open + done, open };
}
