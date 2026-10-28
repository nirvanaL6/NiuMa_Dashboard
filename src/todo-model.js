/**
 * 待办模块的数据模型
 *
 * 模型约定：
 *   Project { id, title, tags[], due, planAt, createdAt }
 *   Todo    { id, title, tags[], due, planAt, projectId, done, createdAt }
 *
 * 标签体系（tags）：
 *   - 四宫格：q1 紧急重要 / q2 重要不紧急 / q3 紧急不重要 / q4 不紧急不重要
 *             **互斥**：一个条目最多带一个 q*，写入时由 setQuadrant 保证
 *   - 其他自定义 Tag：自由文本，不参与互斥
 *
 * 时间字段统一用 ISO 字符串 'YYYY-MM-DDTHH:mm'（本地时区），便于直接喂给
 * <input type="datetime-local">；计划日期用于「概览」按日聚合。
 */

export const QUADRANTS = [
  { id: 'q1', label: '紧急重要', short: '急·重', urgent: true, important: true, cell: '马上做', accent: '#f43f5e' },
  { id: 'q2', label: '重要不紧急', short: '重', urgent: false, important: true, cell: '计划做', accent: '#6366f1' },
  { id: 'q3', label: '紧急不重要', short: '急', urgent: true, important: false, cell: '委托做', accent: '#f59e0b' },
  { id: 'q4', label: '不紧急不重要', short: '不急·不重', urgent: false, important: false, cell: '抽空做', accent: '#7a839a' },
];

export const QUAD_IDS = QUADRANTS.map((q) => q.id);

export const quadOf = (tags) => (tags || []).find((t) => QUAD_IDS.includes(t)) || '';

export const quadMeta = (id) => QUADRANTS.find((q) => q.id === id) || null;

/** 非四宫格的自由标签 */
export const freeTags = (tags) => (tags || []).filter((t) => !QUAD_IDS.includes(t));

/**
 * 设置四宫格标签：写入时清掉其它 q*，保证「仅能在一格内」。
 * 传空值表示移出四宫格。
 */
export function setQuadrant(tags, quadId) {
  const rest = (tags || []).filter((t) => !QUAD_IDS.includes(t));
  return quadId && QUAD_IDS.includes(quadId) ? [...rest, quadId] : rest;
}

/* ---------------- 时间工具 ---------------- */

const pad = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DDTHH:mm' */
export function toLocalInput(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** 'YYYY-MM-DDTHH:mm' → 'YYYY-MM-DD'（空值返回 ''） */
export function dayKey(v) {
  if (!v) return '';
  const s = String(v);
  // 已经只到日的直接返回
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s.slice(0, 10);
}

/** 'YYYY-MM-DD' → 本地 Date（当天 0 点），避免 new Date('YYYY-MM-DD') 被当成 UTC */
export function dayDate(key) {
  if (!key) return null;
  const [y, m, d] = dayKey(key).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function sameDay(a, b) {
  return dayKey(a) && dayKey(a) === dayKey(b);
}

/** 展示：今天 14:30 / 明天 09:00 / 10-30 14:30 / 空 */
export function fmtDue(v, now = new Date()) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `明天 ${hm}`;
  if (diff === -1) return `昨天 ${hm}`;
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md} ${hm}`;
}

/** 是否已过期（未完成且截止早于此刻） */
export function isOverdue(item, now = new Date()) {
  if (!item?.due || item.done) return false;
  const d = new Date(item.due);
  return !Number.isNaN(d.getTime()) && d < now;
}

/** 生成短 id */
export const uid = (prefix = 'i') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
