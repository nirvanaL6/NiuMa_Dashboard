/**
 * 待办模块：项目&待办 / 四宫格 / 概览
 *
 * 视图只负责「渲染成字符串」+「声明数据属性」，交互全部由 todo-app.js 的
 * 事件委托处理。拖拽协议：
 *   - 可拖拽元素带 data-drag-type="project|todo" + data-drag-id
 *   - 放置区带 data-drop="quad:q1|day:2026-10-28"
 */
import { icon } from './icons.js';
import { getData } from './store.js';
import { QUADRANTS, quadOf, freeTags, fmtDue, isOverdue, dayKey, dayDate } from './todo-model.js';

/* ---------------- 数据 getter（每次渲染读最新） ---------------- */
const projects = () => getData().projects || [];
const todos = () => getData().todos || [];

const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 一个条目可拖拽的公共属性 */
const dragAttrs = (type, id, extra = '') => `draggable="true" data-drag-type="${type}" data-drag-id="${esc(id)}" ${extra}`;

/* =========================================================
   1. 项目 & 待办
   ========================================================= */
function tagChip(t) {
  const q = QUADRANTS.find((x) => x.id === t);
  if (q) return `<span class="tag tag--quad" style="--tag:${q.accent}">${q.label}</span>`;
  return `<span class="tag">#${esc(t)}</span>`;
}

/**
 * 待办行。
 * 整行可点（data-edit-todo 挂在 li 上）：大屏用户不必再去瞄准右侧的小铅笔。
 * 勾选按钮独立且先于行命中，点它只切换完成态、不会打开编辑器。
 */
function todoRow(t, { showProject = true } = {}) {
  const p = projects().find((x) => x.id === t.projectId);
  const overdue = isOverdue(t);
  const due = fmtDue(t.due);
  return `<li class="td ${t.done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}" data-id="${esc(t.id)}"
      data-todo-row="${esc(t.id)}" data-edit-todo="${esc(t.id)}"
      ${dragAttrs('todo', t.id)}>
    <button class="td__check" data-toggle-todo="${esc(t.id)}" aria-checked="${t.done}" role="checkbox"
      aria-label="${t.done ? '标记未完成' : '标记完成'}">${icon('check', 11, 3)}</button>
    <div class="td__main">
      <div class="td__title" title="${esc(t.title)}">${esc(t.title)}</div>
      <div class="td__meta">
        ${due ? `<span class="td__due ${overdue ? 'is-late' : ''}">${icon('clock', 11)} ${due}</span>` : '<span class="td__due is-empty">未设截止</span>'}
        ${t.planAt ? `<span class="td__plan">${icon('calendar', 11)} ${dayKey(t.planAt).slice(5)}</span>` : ''}
        ${showProject && p ? `<span class="td__proj" title="${esc(p.title)}">${esc(p.title)}</span>` : ''}
        ${freeTags(t.tags).map((x) => `<span class="td__tag">#${esc(x)}</span>`).join('')}
        ${quadOf(t.tags) ? tagChip(quadOf(t.tags)) : ''}
      </div>
    </div>
    <span class="td__edit" aria-hidden="true" title="点击编辑">${icon('pencil', 13)}</span>
  </li>`;
}

function projectCard(p) {
  const own = todos().filter((t) => t.projectId === p.id);
  const done = own.filter((t) => t.done).length;
  const pct = own.length ? Math.round((done / own.length) * 100) : 0;
  const overdue = own.filter((t) => isOverdue(t)).length;
  return `<section class="pj" data-pid="${esc(p.id)}" ${dragAttrs('project', p.id)}>
    <header class="pj__head">
      <button class="pj__fold" data-fold-project="${esc(p.id)}" aria-expanded="true" aria-label="折叠">${icon('chevronRight', 12, 2.4)}</button>
      <div class="pj__title-wrap">
        <h4 class="pj__title" title="${esc(p.title)}">${esc(p.title)}</h4>
        <div class="pj__meta">
          <span>${own.length} 条待办${overdue ? ` · <b class="is-late">${overdue} 条逾期</b>` : ''}</span>
          ${p.due ? `<span class="td__due">${icon('clock', 11)} ${fmtDue(p.due)}</span>` : ''}
          ${p.planAt ? `<span class="td__plan">${icon('calendar', 11)} ${dayKey(p.planAt).slice(5)}</span>` : ''}
          ${freeTags(p.tags).map((x) => `<span class="td__tag">#${esc(x)}</span>`).join('')}
          ${quadOf(p.tags) ? tagChip(quadOf(p.tags)) : ''}
        </div>
      </div>
      <div class="pj__right">
        <div class="pj__bar" title="完成 ${done}/${own.length}"><i style="width:${pct}%"></i></div>
        <span class="pj__pct">${pct}%</span>
        <button class="pj__add" data-add-todo-to="${esc(p.id)}" title="在此项目下新建待办">${icon('plus', 13, 2.6)}</button>
        <button class="pj__edit" data-edit-project="${esc(p.id)}" title="编辑项目">${icon('pencil', 13)}</button>
      </div>
    </header>
    <ul class="pj__list" data-fold-body="${esc(p.id)}">
      ${own.length ? own.map((t) => todoRow(t, { showProject: false })).join('') : `<li class="pj__empty">还没有待办，点右上角 + 添加</li>`}
    </ul>
  </section>`;
}

export function viewTodoList() {
  const loose = todos().filter((t) => !t.projectId);
  const all = todos();
  const open = all.filter((t) => !t.done).length;
  const overdue = all.filter((t) => isOverdue(t)).length;

  return `
  <div class="td-bar">
    <div class="td-bar__stats">
      <span><b>${projects().length}</b> 个项目</span>
      <span class="dot-line"></span>
      <span><b>${open}</b> 条未完成</span>
      ${overdue ? `<span class="dot-line"></span><span class="is-late"><b>${overdue}</b> 条逾期</span>` : ''}
    </div>
    <div class="td-bar__actions">
      <button class="btn btn--ghost btn--sm" data-new-task="todo">${icon('plus', 13, 2.4)} 新建待办</button>
      <button class="btn btn--primary btn--sm" data-new-task="project">${icon('folder', 13, 2)} 新建项目</button>
    </div>
  </div>

  <div class="pj-list" id="projectList">
    ${projects().length ? projects().map(projectCard).join('') : stateBlock({ title: '还没有项目', desc: '点右上角「新建项目」开始，或先建一条独立待办' })}
  </div>

  <section class="pj pj--loose">
    <header class="pj__head">
      <span class="pj__fold is-static">${icon('inbox', 13)}</span>
      <div class="pj__title-wrap">
        <h4 class="pj__title">独立待办</h4>
        <div class="pj__meta"><span>${loose.length} 条 · 未归入项目</span></div>
      </div>
      <div class="pj__right">
        <button class="pj__add" data-new-task="todo" title="新建独立待办">${icon('plus', 13, 2.6)}</button>
      </div>
    </header>
    <ul class="pj__list" id="looseList">
      ${loose.length ? loose.map((t) => todoRow(t, { showProject: false })).join('') : `<li class="pj__empty">暂无独立待办</li>`}
    </ul>
  </section>`;
}

/* =========================================================
   2. 四宫格
   ========================================================= */
function quadItems(qid) {
  const ps = projects().filter((p) => quadOf(p.tags) === qid);
  const ts = todos().filter((t) => quadOf(t.tags) === qid);
  return { ps, ts };
}

export function viewTodoQuadrant() {
  // 待办也带 projectId 字段，不能靠它区分类型，统一打上 kind 标记
  const unassigned = [
    ...projects().filter((p) => !quadOf(p.tags)).map((data) => ({ kind: 'project', data })),
    ...todos().filter((t) => !quadOf(t.tags)).map((data) => ({ kind: 'todo', data })),
  ];
  return `
  <div class="quad-wrap">
    <div class="quad-grid" id="quadGrid">
      ${QUADRANTS.map((q) => {
        const { ps, ts } = quadItems(q.id);
        return `<section class="quad-cell" data-drop="quad:${q.id}" data-quad="${q.id}" style="--q:${q.accent}">
          <header class="quad-cell__head">
            <div class="quad-cell__name">
              <span class="quad-cell__dot"></span>
              <b>${q.label}</b>
              <span class="quad-cell__sub">${q.cell}</span>
            </div>
            <span class="quad-cell__n">${ps.length + ts.length}</span>
          </header>
          <div class="quad-cell__body">
            ${ps.map((p) => `<div class="qi qi--pj" ${dragAttrs('project', p.id)} title="项目：拖到其他格可改分类">
              <span class="qi__badge">${icon('folder', 11)}</span>
              <span class="qi__txt" title="${esc(p.title)}">${esc(p.title)}</span>
              <span class="qi__n">${todos().filter((t) => t.projectId === p.id).length}</span>
            </div>`).join('')}
            ${ts.map((t) => `<div class="qi ${t.done ? 'is-done' : ''}" data-todo-row="${esc(t.id)}" ${dragAttrs('todo', t.id)}>
              <button class="qi__check" data-toggle-todo="${esc(t.id)}" aria-checked="${t.done}" role="checkbox"
                aria-label="${t.done ? '标记未完成' : '标记完成'}">${icon('check', 10, 3)}</button>
              <span class="qi__txt" data-edit-todo="${esc(t.id)}" title="${esc(t.title)}（点击编辑）">${esc(t.title)}</span>
              ${t.due ? `<span class="qi__due">${dayKey(t.due).slice(5)}</span>` : ''}
            </div>`).join('')}
            ${ps.length + ts.length === 0 ? '<div class="quad-cell__empty">拖项目或待办到这里</div>' : ''}
          </div>
        </section>`;
      }).join('')}
      <div class="quad-axis quad-axis--y"><span>紧急</span><span>不紧急</span></div>
      <div class="quad-axis quad-axis--x"><span>重要</span><span>不重要</span></div>
    </div>

    <aside class="quad-side" id="quadSide">
      <header class="quad-side__head">
        <b>待分类</b>
        <span class="chip">${unassigned.length}</span>
      </header>
      <p class="quad-side__hint">拖动条目到左侧任一格，会自动打上对应的四宫格标签（每条只能在一格）</p>
      <div class="quad-side__list">
        ${unassigned.length ? unassigned.map((x) => {
          const isPj = x.kind === 'project';
          return `<div class="qi qi--side" ${dragAttrs(isPj ? 'project' : 'todo', x.data.id)}>
          <span class="qi__badge">${icon(isPj ? 'folder' : 'check', 11)}</span>
          <span class="qi__txt" title="${esc(x.data.title)}">${esc(x.data.title)}</span>
        </div>`;
        }).join('') : '<div class="quad-side__empty">全部已分类</div>'}
      </div>
    </aside>
  </div>`;
}

/* =========================================================
   3. 概览（日 / 周 / 月 + 缩放）
   ========================================================= */
const WD = ['一', '二', '三', '四', '五', '六', '日'];

/** 某天的条目：计划日期 = 当天 */
function itemsOn(key) {
  const ps = projects().filter((p) => dayKey(p.planAt) === key);
  const ts = todos().filter((t) => dayKey(t.planAt) === key);
  return { ps, ts };
}

function dayCell(d, { today, range }) {
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const { ps, ts } = itemsOn(key);
  const isToday = key === today;
  const other = d.getMonth() !== new Date().getMonth() ? ' is-other' : '';
  const total = ps.length + ts.length;
  // 缩放越大能显示越多条目；超出部分折叠成 +N，保证截图时也不溢出
  const limit = range === 'day' ? 99 : range === 'week' ? 8 : 3;
  const shown = [...ps.map((p) => ({ kind: 'p', x: p })), ...ts.map((t) => ({ kind: 't', x: t }))].slice(0, limit);
  const more = total - shown.length;

  return `<div class="day ${isToday ? 'is-today' : ''}${other}" data-drop="day:${key}" data-day="${key}">
    <div class="day__head">
      <span class="day__num">${d.getDate()}</span>
      ${isToday ? '<span class="day__today">今天</span>' : ''}
      ${other ? `<span class="day__mon">${d.getMonth() + 1}月</span>` : ''}
    </div>
    <div class="day__body">
      ${shown.map(({ kind, x }) => `<div class="de de--${kind} ${x.done ? 'is-done' : ''}" ${kind === 'p' ? `data-project-row="${esc(x.id)}"` : `data-todo-row="${esc(x.id)}"`} ${dragAttrs(kind === 'p' ? 'project' : 'todo', x.id)}>
        ${kind === 'p'
          ? `<span class="de__badge">项</span><span class="de__txt" data-edit-project="${esc(x.id)}" title="${esc(x.title)}（点击编辑）">${esc(x.title)}</span>`
          : `<button class="de__check" data-toggle-todo="${esc(x.id)}" aria-checked="${x.done}" role="checkbox"
              aria-label="${x.done ? '标记未完成' : '标记完成'}">${icon('check', 9, 3)}</button>
             <span class="de__txt" data-edit-todo="${esc(x.id)}" data-todo-anchor="${esc(x.id)}" title="${esc(x.title)}（点击编辑）">${esc(x.title)}</span>`}
      </div>`).join('')}
      ${more > 0 ? `<div class="de de--more">+${more} 条</div>` : ''}
      ${total === 0 ? '<div class="day__empty"></div>' : ''}
    </div>
  </div>`;
}

function weekDays(base) {
  const d = new Date(base);
  const dow = (d.getDay() + 6) % 7; // 周一为 0
  d.setDate(d.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return x;
  });
}

export function viewTodoOverview() {
  const data = getData();
  const range = data.overviewRange || 'week';
  const scale = Number(data.overviewScale) || 1;
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  let body = '';
  let title = '';

  if (range === 'day') {
    title = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
    const { ps, ts } = itemsOn(today);
    body = `<div class="ov-day">
      <div class="ov-day__col">
        <h5>项目 ${ps.length}</h5>
        ${ps.length ? ps.map((p) => `<div class="de de--p" data-project-row="${esc(p.id)}" ${dragAttrs('project', p.id)}><span class="de__badge">项</span><span class="de__txt" data-edit-project="${esc(p.id)}" title="${esc(p.title)}（点击编辑）">${esc(p.title)}</span></div>`).join('') : '<div class="ov-none">今天没有项目</div>'}
      </div>
      <div class="ov-day__col">
        <h5>待办 ${ts.length}</h5>
        ${ts.length ? ts.map((t) => `<div class="de de--t ${t.done ? 'is-done' : ''}" data-todo-row="${esc(t.id)}" ${dragAttrs('todo', t.id)}>
          <button class="de__check" data-toggle-todo="${esc(t.id)}" aria-checked="${t.done}" role="checkbox" aria-label="${t.done ? '标记未完成' : '标记完成'}">${icon('check', 9, 3)}</button>
          <span class="de__txt" data-edit-todo="${esc(t.id)}" title="${esc(t.title)}（点击编辑）">${esc(t.title)}</span>
          <span class="de__time">${t.due ? dayKey(t.due).slice(5) : ''} ${t.due ? String(t.due).slice(11, 16) : ''}</span></div>`).join('') : '<div class="ov-none">今天没有待办</div>'}
      </div>
    </div>`;
  } else if (range === 'week') {
    const days = weekDays(now);
    title = `${days[0].getMonth() + 1} 月 ${days[0].getDate()} 日 — ${days[6].getMonth() + 1} 月 ${days[6].getDate()} 日`;
    body = `<div class="ov-grid ov-grid--week">
      ${days.map((d, i) => `<div class="ov-col-head">周${WD[i]}</div>`).join('')}
      ${days.map((d) => dayCell(d, { today, range })).join('')}
    </div>`;
  } else {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(1 - startOffset);
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
    title = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
    body = `<div class="ov-grid ov-grid--month">
      ${WD.map((w) => `<div class="ov-col-head">周${w}</div>`).join('')}
      ${cells.map((d) => dayCell(d, { today, range })).join('')}
    </div>`;
  }

  return `
  <div class="ov-bar">
    <div class="ov-bar__title">${icon('calendar', 14)} <b>${title}</b></div>
    <div class="ov-bar__right">
      <span class="segmented segmented--sm" id="ovRange">
        <button data-range="day" class="${range === 'day' ? 'is-active' : ''}">日</button>
        <button data-range="week" class="${range === 'week' ? 'is-active' : ''}">周</button>
        <button data-range="month" class="${range === 'month' ? 'is-active' : ''}">月</button>
      </span>
      <span class="zoom" id="ovZoom">
        <button data-zoom="-1" aria-label="缩小" title="缩小">−</button>
        <span class="zoom__val" id="ovZoomVal">${Math.round(scale * 100)}%</span>
        <button data-zoom="1" aria-label="放大" title="放大">＋</button>
      </span>
    </div>
  </div>
  <div class="ov-panel">
    <div class="ov-canvas" id="ovCanvas" style="--ov-scale:${scale}">
      <div class="ov-inner">${body}</div>
    </div>
  </div>`;
}

/* 空状态块：与主视图共用同一套样式，避免循环依赖而在此本地实现 */
function stateBlock({ title = '空', desc = '' } = {}) {
  return `<div class="state-block"><b>${esc(title)}</b>${desc ? `<p>${esc(desc)}</p>` : ''}</div>`;
}
