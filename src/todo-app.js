/**
 * 待办模块交互层
 *
 * 职责：编辑器弹窗（项目 / 待办共用）、拖拽打标与排期、概览视图切换与缩放、
 * 项目折叠、勾选完成。全部走事件委托，视图重绘后无需重新绑定。
 *
 * 拖拽协议（与 todo-views.js 约定）：
 *   可拖元素：data-drag-type="project|todo" + data-drag-id
 *   放置区  ：data-drop="quad:q1" | "day:2026-10-28"
 */
import { icon } from './icons.js';
import * as store from './store.js';
import { confirmDialog } from './dialog.js';
import { renderSelectField, renderDateTimeField, fcValue, mountFormControls, closeAllFc } from './form-controls.js';
import {
  QUADRANTS, QUAD_IDS, quadOf, freeTags, setQuadrant,
  toLocalInput, dayKey, uid,
} from './todo-model.js';

/* ---------------- 存储读写 ---------------- */
const data = () => store.getData();
const projects = () => data().projects || [];
const todos = () => data().todos || [];

const saveProjects = (list) => store.saveData({ projects: list });
const saveTodos = (list) => store.saveData({ todos: list });

const findProject = (id) => projects().find((p) => p.id === id) || null;
const findTodo = (id) => todos().find((t) => t.id === id) || null;

/** 统一入口：按类型取条目，返回 { kind, item } */
function resolve(type, id) {
  if (type === 'project') {
    const p = findProject(id);
    return p ? { kind: 'project', item: p } : null;
  }
  const t = findTodo(id);
  return t ? { kind: 'todo', item: t } : null;
}

/* ---------------- 弹窗宿主 ---------------- */
let host = null;
let onSaved = null;

export function mountTodo(hostEl, { onChange } = {}) {
  host = hostEl;
  onSaved = onChange || null;
  mountFormControls();
  bindDrag();
}

const notify = () => { if (onSaved) onSaved(); };
/** 局部变更通知：只改 DOM，不触发整页重绘（勾选完成这类高频操作） */
const notifyPatch = () => { if (onSaved) onSaved({ patchOnly: true }); };

/**
 * 只切换一条待办的完成态 DOM，不重绘整个视图。
 *
 * 之前勾选一条待办会把整个 stage 重新 innerHTML 一遍（概览视图是 42 个日期格 +
 * 上百个节点），大屏上能明显感到掉帧，拖完/勾完还要等一会儿才能继续操作。
 * 完成态只影响 class 与 aria，就地改即可。
 */
function patchTodoDom(id, done) {
  // 四宫格只渲染未完成的待办，勾完就得真的消失，否则格子会被做完的事挤满
  if (done) dropQuadRows(id);
  document.querySelectorAll(`[data-todo-row="${CSS.escape(id)}"]`).forEach((el) => {
    el.classList.toggle('is-done', done);
  });
  document.querySelectorAll(`[data-toggle-todo="${CSS.escape(id)}"]`).forEach((b) => {
    b.setAttribute('aria-checked', String(done));
    b.setAttribute('aria-label', done ? '标记未完成' : '标记完成');
  });
}

/**
 * 「项目&待办」视图在勾选后是否必须整页重绘。
 *
 * 归档规则让完成态会改变条目所在的区块（独立待办 → 已完成；项目最后一条勾完 →
 * 整张卡搬去已完成），只改 class 会留下假状态。但列表视图通常只有几十个节点，
 * 整页重绘的代价远小于给每种迁移写一套局部 patch，所以这里只在「真的会搬家」
 * 时重绘，其余情况继续走局部更新（四宫格 / 概览的高频勾选不受影响）。
 */
function listNeedsRelayout(todo, next) {
  const stage = document.querySelector('#stage');
  if (!stage || !stage.querySelector('#projectList')) return false;
  if (!todo.projectId) return true;
  const own = todos().filter((x) => x.projectId === todo.projectId);
  if (!own.length) return false;
  const doneNow = own.filter((x) => x.done).length;
  const doneAfter = own.filter((x) => (x.id === todo.id ? next : x.done)).length;
  // 两个方向都要管：勾上最后一条 → 项目归档走；取消归档项目里的任意一条 → 项目搬回来
  return (doneNow === own.length) !== (doneAfter === own.length);
}

/** 重新数格子里的条目，同步角标并补/去空态提示 */
function refreshQuadCell(cell) {
  const body = cell.querySelector('.quad-cell__body');
  if (!body) return;
  const n = body.querySelectorAll('.qi').length;
  const badge = cell.querySelector('.quad-cell__n');
  if (badge) badge.textContent = String(n);
  const empty = body.querySelector('.quad-cell__empty');
  if (!n && !empty) body.insertAdjacentHTML('beforeend', '<div class="quad-cell__empty">拖项目或待办到这里</div>');
  if (n && empty) empty.remove();
}

/** 待分类侧栏同步计数与空态 */
function refreshQuadSide() {
  const list = document.querySelector('#quadSide .quad-side__list');
  if (!list) return;
  const n = list.querySelectorAll('.qi').length;
  const chip = document.querySelector('#quadSide .chip');
  if (chip) chip.textContent = String(n);
  const empty = list.querySelector('.quad-side__empty');
  if (!n && !empty) list.insertAdjacentHTML('beforeend', '<div class="quad-side__empty">全部已分类</div>');
  if (n && empty) empty.remove();
}

/**
 * 把四宫格 / 待分类里的一条待办淡出并移除。
 * 只改 is-done 会留下一条「已完成」的僵尸条目，用户还得自己去找它在哪。
 */
function dropQuadRows(id) {
  const sel = `[data-todo-row="${CSS.escape(id)}"]`;
  document.querySelectorAll(`#quadGrid ${sel}, #quadSide ${sel}`).forEach((el) => {
    const cell = el.closest('.quad-cell');
    const inSide = !!el.closest('.quad-side__list');
    el.classList.add('is-leaving');
    let done = false;
    const gone = () => {
      if (done) return;
      done = true;
      el.remove();
      if (cell) refreshQuadCell(cell);
      else if (inSide) refreshQuadSide();
    };
    // transitionend 在后台标签页或「减少动态效果」下不会触发，用定时器兜底
    el.addEventListener('transitionend', gone, { once: true });
    setTimeout(gone, 320);
  });
}

/* =========================================================
   编辑器：项目 / 待办共用一套表单
   ========================================================= */
let editing = null; // { kind, id, draft }

const TAGS_PRESET = ['产品', '评审', '会议', '文档', '开发', '沟通', '计划', '杂事'];

function fieldRow(label, inner, hint = '') {
  return `<label class="ed__row">
    <span class="ed__label">${label}</span>
    <span class="ed__ctrl">${inner}${hint ? `<em class="ed__hint">${hint}</em>` : ''}</span>
  </label>`;
}

function renderEditor() {
  const { kind, draft, id } = editing;
  const isProject = kind === 'project';
  const q = quadOf(draft.tags);
  const custom = freeTags(draft.tags).filter((t) => !TAGS_PRESET.includes(t));

  return `<div class="ed-mask open" data-ed-close>
    <div class="ed" role="dialog" aria-modal="true" aria-labelledby="edTitle">
      <header class="ed__head">
        <h3 id="edTitle">${icon(isProject ? 'folder' : 'check', 16, 2)} ${id ? '编辑' : '新建'}${isProject ? '项目' : '待办'}</h3>
        <button class="ed__x" data-ed-close aria-label="关闭">${icon('close', 15)}</button>
      </header>

      <div class="ed__body">
        ${fieldRow('标题', `<input class="ed__input" id="edTitleInput" maxlength="80" placeholder="${isProject ? '例：工作台 v2 重构' : '例：提交需求评审材料'}" value="${escAttr(draft.title)}" />`)}

        ${!isProject ? fieldRow('所属项目', renderSelectField({
          id: 'edProject',
          value: draft.projectId || '',
          placeholder: '不归属项目（独立待办）',
          options: [
            { value: '', label: '不归属项目（独立待办）' },
            ...projects().map((p) => ({ value: p.id, label: p.title })),
          ],
        })) : ''}

        ${fieldRow('截止时间', renderDateTimeField({ id: 'edDue', value: draft.due || '' }), '年月日时分')}

        ${fieldRow('计划日期', renderDateTimeField({ id: 'edPlan', value: draft.planAt || '' }), '决定它出现在概览的哪一天')}

        ${fieldRow('四宫格', `<div class="ed__quads" id="edQuads">
            ${QUADRANTS.map((x) => `<button type="button" class="ed__quad ${q === x.id ? 'is-on' : ''}" data-quad-pick="${x.id}" style="--q:${x.accent}">
              <span class="dot"></span>${x.label}
            </button>`).join('')}
            <button type="button" class="ed__quad ed__quad--none ${q ? '' : 'is-on'}" data-quad-pick="">不分格</button>
          </div>`, '只能选一个，选后会同步到四宫格视图')}

        ${fieldRow('Tag', `<div class="ed__tags" id="edTags">
            ${TAGS_PRESET.map((t) => `<button type="button" class="ed__tag ${freeTags(draft.tags).includes(t) ? 'is-on' : ''}" data-tag-pick="${escAttr(t)}">#${escHtml(t)}</button>`).join('')}
            ${custom.map((t) => `<button type="button" class="ed__tag is-on" data-tag-pick="${escAttr(t)}">#${escHtml(t)}</button>`).join('')}
          </div>
          <div class="ed__tagnew">
            <input class="ed__input ed__input--sm" id="edTagNew" maxlength="12" placeholder="自定义 Tag" />
            <button type="button" class="btn btn--ghost btn--sm" data-tag-add>添加</button>
          </div>`)}
      </div>

      <footer class="ed__foot">
        ${id ? `<button class="btn btn--ghost btn--sm ed__del" data-ed-del>${icon('trash', 13)} 删除</button>` : ''}
        <span class="ed__err" data-ed-err></span>
        <button class="btn btn--ghost btn--sm" data-ed-close>取消</button>
        <button class="btn btn--primary btn--sm" data-ed-save>${icon('check', 13, 2.4)} 保存</button>
      </footer>
    </div>
  </div>`;
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escAttr = escHtml;

export function openEditor(kind, id = '', preset = {}) {
  if (!host) return;
  closeAllFc(); // 避免上一个编辑器残留的浮层盖在新弹窗上
  const base = id
    ? resolve(kind, id)?.item
    : { title: '', tags: [], due: '', planAt: '', projectId: preset.projectId || '' };
  if (!base) return;
  editing = {
    kind,
    id,
    draft: {
      title: base.title || '',
      tags: [...(base.tags || [])],
      due: base.due || '',
      planAt: base.planAt || '',
      projectId: base.projectId || '',
    },
  };
  host.innerHTML = renderEditor();
  requestAnimationFrame(() => host.querySelector('#edTitleInput')?.focus());
}

export function closeEditor() {
  closeAllFc();
  editing = null;
  if (host) host.innerHTML = '';
}

function readForm() {
  const d = editing.draft;
  d.title = host.querySelector('#edTitleInput')?.value.trim() || '';
  // 日期/项目是自绘控件，真实值在隐藏 input 里（见 src/form-controls.js）
  d.due = fcValue(host, 'edDue');
  d.planAt = fcValue(host, 'edPlan');
  const proj = host.querySelector('#edProject');
  if (proj) d.projectId = proj.value;
  return d;
}

function submitEditor() {
  if (!editing) return;
  const d = readForm();
  const err = host.querySelector('[data-ed-err]');
  if (!d.title) {
    if (err) err.textContent = '请填写标题';
    host.querySelector('#edTitleInput')?.focus();
    return;
  }

  const { kind, id } = editing;
  if (kind === 'project') {
    const list = projects();
    if (id) {
      saveProjects(list.map((p) => (p.id === id ? { ...p, ...d } : p)));
    } else {
      saveProjects([...list, { id: uid('p'), ...d, createdAt: Date.now() }]);
    }
  } else {
    const list = todos();
    if (id) {
      saveTodos(list.map((t) => (t.id === id ? { ...t, ...d } : t)));
    } else {
      saveTodos([{ id: uid('t'), ...d, done: false, createdAt: Date.now() }, ...list]);
    }
  }
  closeEditor();
  notify();
}

/* =========================================================
   拖拽：把项目/待办拖进四宫格或某一天
   ========================================================= */
let dragging = null; // { kind, id }
let toastFn = null;
const toast = (msg) => { try { toastFn?.(msg); } catch { /* 忽略 */ } };

function bindDrag() {
  document.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('[data-drag-type]');
    if (!el) return;
    dragging = { kind: el.dataset.dragType, id: el.dataset.dragId };
    el.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox 需要写入数据才会触发 drop
    try { e.dataTransfer.setData('text/plain', `${dragging.kind}:${dragging.id}`); } catch { /* 忽略 */ }
  });

  document.addEventListener('dragend', (e) => {
    e.target.closest?.('[data-drag-type]')?.classList.remove('is-dragging');
    document.querySelectorAll('.is-dropover').forEach((n) => n.classList.remove('is-dropover'));
    dragging = null;
  });

  document.addEventListener('dragover', (e) => {
    const zone = e.target.closest?.('[data-drop]');
    if (!zone || !dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!zone.classList.contains('is-dropover')) {
      document.querySelectorAll('.is-dropover').forEach((n) => n.classList.remove('is-dropover'));
      zone.classList.add('is-dropover');
    }
  });

  document.addEventListener('dragleave', (e) => {
    const zone = e.target.closest?.('[data-drop]');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('is-dropover');
  });

  document.addEventListener('drop', (e) => {
    const zone = e.target.closest?.('[data-drop]');
    if (!zone || !dragging) return;
    e.preventDefault();
    zone.classList.remove('is-dropover');
    const [type, value] = zone.dataset.drop.split(':');
    const res = applyDrop(dragging.kind, dragging.id, type, value);
    if (res?.ok && res.msg) toast(`${icon('check')} ${res.msg}`);
    dragging = null;
  });
}

/**
 * 应用放置结果：
 *   quad → 写入四宫格标签（互斥）：项目连同其下待办一起改
 *   day  → 写入计划日期：项目连同其下待办一起改
 */
function applyDrop(kind, id, target, value) {
  const hit = resolve(kind, id);
  if (!hit) return;
  const { item } = hit;

  if (target === 'quad') {
    const nextTags = setQuadrant(item.tags, value);
    if (kind === 'project') {
      saveProjects(projects().map((p) => (p.id === id ? { ...p, tags: nextTags } : p)));
      // 项目下的待办跟随项目一起归类，避免出现「项目在 Q1、待办散落各格」
      saveTodos(todos().map((t) => (t.projectId === id ? { ...t, tags: setQuadrant(t.tags, value) } : t)));
    } else {
      saveTodos(todos().map((t) => (t.id === id ? { ...t, tags: nextTags } : t)));
    }
    const q = QUADRANTS.find((x) => x.id === value);
    notify();
    return { ok: true, msg: `已归入「${q?.label || value}」` };
  }

  if (target === 'day') {
    if (kind === 'project') {
      saveProjects(projects().map((p) => (p.id === id ? { ...p, planAt: value } : p)));
      saveTodos(todos().map((t) => (t.projectId === id ? { ...t, planAt: value } : t)));
    } else {
      saveTodos(todos().map((t) => (t.id === id ? { ...t, planAt: value } : t)));
    }
    notify();
    return { ok: true, msg: `已排到 ${value.slice(5)}` };
  }
  return { ok: false };
}

/**
 * 删除条目（编辑器内的「删除」）。
 * 用应用内的确认弹窗而非原生 confirm：原生弹窗与界面风格割裂，
 * 且支持不了「不再提示」——而删除是高频重复操作，每次都问一遍很烦。
 */
async function deleteEntry(kind, id) {
  if (kind === 'project') {
    const own = todos().filter((t) => t.projectId === id).length;
    const ok = await confirmDialog({
      title: '删除这个项目？',
      desc: own ? `项目下的 ${own} 条待办会一起删除，且无法恢复。` : '删除后无法恢复。',
      confirmText: '删除项目',
      danger: true,
      onceKey: 'delete-project',
      onceLabel: '删除项目时不再提示',
    });
    if (!ok) return;
    saveProjects(projects().filter((p) => p.id !== id));
    saveTodos(todos().filter((t) => t.projectId !== id));
    toast?.(`${icon('trash')} 项目已删除`);
  } else {
    const ok = await confirmDialog({
      title: '删除这条待办？',
      desc: '删除后无法恢复。',
      confirmText: '删除',
      danger: true,
      onceKey: 'delete-todo',
      onceLabel: '删除待办时不再提示',
    });
    if (!ok) return;
    saveTodos(todos().filter((t) => t.id !== id));
    toast?.(`${icon('trash')} 待办已删除`);
  }
  closeEditor();
  notify();
}

/* =========================================================
   事件委托
   ========================================================= */
export function bindTodoEvents({ go, toast: t }) {
  toastFn = t;

  document.addEventListener('click', (e) => {
    /* ---- 编辑器 ---- */
    if (e.target.closest('[data-new-task]')) {
      const kind = e.target.closest('[data-new-task]').dataset.newTask;
      openEditor(kind === 'project' ? 'project' : 'todo');
      return;
    }
    const toProj = e.target.closest('[data-add-todo-to]');
    if (toProj) return openEditor('todo', '', { projectId: toProj.dataset.addTodoTo });

    /* ---- 勾选完成（列表 / 四宫格 / 概览通用） ----
       必须排在「点击条目打开编辑器」之前：列表里整行可点（data-edit-todo 挂在 li 上），
       勾选按钮是它的子节点，先判 edit 会把打勾也变成打开编辑器。 */
    const tg = e.target.closest('[data-toggle-todo]');
    if (tg) {
      const id = tg.dataset.toggleTodo;
      const t = findTodo(id);
      if (!t) return;
      const next = !t.done;
      // 四宫格里勾完条目会直接消失，得告诉用户去哪找回，否则像被误删
      const inQuad = !!document.querySelector('#quadGrid');
      const relayout = listNeedsRelayout(t, next);
      saveTodos(todos().map((x) => (x.id === id ? { ...x, done: next } : x)));
      if (relayout) {
        // 视图已变（归档 / 取消归档），旧节点不可再复用
        notify();
      } else {
        patchTodoDom(id, next);
        notifyPatch();
      }
      if (next && inQuad) {
        toastFn?.(`已完成「${escHtml(t.title)}」，已从四宫格移出；要改回请去「项目&待办」`, 2800);
      }
      return;
    }

    const editT = e.target.closest('[data-edit-todo]');
    if (editT) return openEditor('todo', editT.dataset.editTodo);
    const delT = e.target.closest('[data-del-todo]');
    if (delT) return void deleteEntry('todo', delT.dataset.delTodo);
    const editP = e.target.closest('[data-edit-project]');
    if (editP) return openEditor('project', editP.dataset.editProject);

    /* ---- 折叠（项目卡片 / 待办模块整体） ---- */
    const foldMod = e.target.closest('[data-fold-module]');
    if (foldMod) {
      const key = foldMod.dataset.foldModule;
      const cur = !(data().folded || {})[key];
      store.saveData({ folded: { ...(data().folded || {}), [key]: cur } });
      notify();
      return;
    }

    // 遮罩空白处、关闭按钮、取消按钮都走这里；点弹窗内容区不关闭
    const closeBtn = e.target.closest('.ed__x, .ed [data-ed-close].btn');
    if (closeBtn) return closeEditor();
    if (e.target.classList?.contains('ed-mask')) return closeEditor();
    if (e.target.closest('[data-ed-save]')) return submitEditor();
    if (e.target.closest('[data-ed-del]')) {
      const { kind, id } = editing || {};
      if (!kind || !id) return;
      void deleteEntry(kind, id);
      return;
    }

    /* ---- 表单内的四宫格 / Tag 选择 ---- */
    const qp = e.target.closest('[data-quad-pick]');
    if (qp && editing) {
      readForm();
      const v = qp.dataset.quadPick;
      editing.draft.tags = v ? setQuadrant(editing.draft.tags, v) : setQuadrant(editing.draft.tags, '');
      // 只重绘选择区，避免丢失已填内容
      host.querySelectorAll('[data-quad-pick]').forEach((b) => {
        b.classList.toggle('is-on', b.dataset.quadPick === v);
      });
      return;
    }
    const tp = e.target.closest('[data-tag-pick]');
    if (tp && editing) {
      readForm();
      const tag = tp.dataset.tagPick;
      const cur = freeTags(editing.draft.tags);
      const next = cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag];
      editing.draft.tags = [...next, ...editing.draft.tags.filter((x) => QUAD_IDS.includes(x))];
      tp.classList.toggle('is-on');
      return;
    }
    if (e.target.closest('[data-tag-add]') && editing) {
      readForm();
      const inp = host.querySelector('#edTagNew');
      const tag = (inp?.value || '').trim().replace(/^#/, '');
      if (!tag) return;
      if (!freeTags(editing.draft.tags).includes(tag)) {
        editing.draft.tags = [...editing.draft.tags, tag];
        // 重新渲染以显示新标签
        const keep = { ...editing.draft };
        host.innerHTML = renderEditor();
        editing.draft = keep;
      }
      if (inp) inp.value = '';
      return;
    }

    /* ---- 项目折叠 ---- */
    const fold = e.target.closest('[data-fold-project]');
    if (fold) {
      const id = fold.dataset.foldProject;
      const body = document.querySelector(`[data-fold-body="${id}"]`);
      const open = fold.getAttribute('aria-expanded') === 'true';
      fold.setAttribute('aria-expanded', String(!open));
      if (body) body.hidden = open;
      return;
    }

    /* ---- 概览：视图切换 / 缩放 ---- */
    const rg = e.target.closest('[data-range]');
    if (rg) {
      store.saveData({ overviewRange: rg.dataset.range });
      notify();
      return;
    }
    const zm = e.target.closest('[data-zoom]');
    if (zm) {
      const cur = Number(data().overviewScale) || 1;
      const step = Number(zm.dataset.zoom) * 0.2;
      const next = Math.min(1.6, Math.max(0.6, Math.round((cur + step) * 10) / 10));
      store.saveData({ overviewScale: next });
      // 只改 CSS 变量与数值，避免整页重绘导致滚动位置跳动
      const canvas = document.querySelector('#ovCanvas');
      if (canvas) canvas.style.setProperty('--ov-scale', next);
      const val = document.querySelector('#ovZoomVal');
      if (val) val.textContent = `${Math.round(next * 100)}%`;
      return;
    }
  });

  /* ESC 关闭编辑器 */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editing) closeEditor();
    if (e.key === 'Enter' && editing) {
      const inTag = document.activeElement?.id === 'edTagNew';
      if (inTag) {
        e.preventDefault();
        host.querySelector('[data-tag-add]')?.click();
      }
    }
  });

  return { openEditor, closeEditor };
}
