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
  bindDrag();
}

const notify = () => { if (onSaved) onSaved(); };

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

        ${!isProject ? fieldRow('所属项目', `<select class="ed__input" id="edProject">
            <option value="">不归属项目（独立待办）</option>
            ${projects().map((p) => `<option value="${escAttr(p.id)}" ${draft.projectId === p.id ? 'selected' : ''}>${escHtml(p.title)}</option>`).join('')}
          </select>`) : ''}

        ${fieldRow('截止时间', `<input class="ed__input" type="datetime-local" id="edDue" value="${escAttr(toLocalInput0(draft.due))}" />`, '年月日时分')}

        ${fieldRow('计划日期', `<input class="ed__input" type="datetime-local" id="edPlan" value="${escAttr(toLocalInput0(draft.planAt))}" />`, '决定它出现在概览的哪一天')}

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

/** datetime-local 需要 'YYYY-MM-DDTHH:mm'；只到日的补 09:00 */
function toLocalInput0(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T09:00`;
  return s.slice(0, 16);
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escAttr = escHtml;

export function openEditor(kind, id = '', preset = {}) {
  if (!host) return;
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
  editing = null;
  if (host) host.innerHTML = '';
}

function readForm() {
  const d = editing.draft;
  d.title = host.querySelector('#edTitleInput')?.value.trim() || '';
  d.due = host.querySelector('#edDue')?.value || '';
  d.planAt = host.querySelector('#edPlan')?.value || '';
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

    const editT = e.target.closest('[data-edit-todo]');
    if (editT) return openEditor('todo', editT.dataset.editTodo);
    const editP = e.target.closest('[data-edit-project]');
    if (editP) return openEditor('project', editP.dataset.editProject);

    // 遮罩空白处、关闭按钮、取消按钮都走这里；点弹窗内容区不关闭
    const closeBtn = e.target.closest('.ed__x, .ed [data-ed-close].btn');
    if (closeBtn) return closeEditor();
    if (e.target.classList?.contains('ed-mask')) return closeEditor();
    if (e.target.closest('[data-ed-save]')) return submitEditor();
    if (e.target.closest('[data-ed-del]')) {
      const { kind, id } = editing || {};
      if (!kind || !id) return;
      if (kind === 'project') {
        const own = todos().filter((t) => t.projectId === id).length;
        if (!confirm(`删除项目会同时删除其下 ${own} 条待办，确定？`)) return;
        saveProjects(projects().filter((p) => p.id !== id));
        saveTodos(todos().filter((t) => t.projectId !== id));
      } else {
        if (!confirm('确定删除这条待办？')) return;
        saveTodos(todos().filter((t) => t.id !== id));
      }
      closeEditor();
      notify();
      toast?.(`${icon('trash')} 已删除`);
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

    /* ---- 勾选完成 ---- */
    const tg = e.target.closest('[data-toggle-todo]');
    if (tg) {
      const id = tg.dataset.toggleTodo;
      const t = findTodo(id);
      if (!t) return;
      saveTodos(todos().map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
      notify();
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
