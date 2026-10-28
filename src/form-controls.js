/**
 * 自绘表单控件：下拉选择、日期时间、时间。
 *
 * 为什么不用原生控件：
 *   <select> 和 input[type=datetime-local] 的下拉面板、日历弹层由浏览器绘制，
 *   不继承任何本项目的 token（圆角、新拟态阴影、强调色、暗色主题），
 *   在新拟态界面里像贴上去的外来控件。这里全部自绘，交互与视觉跟其余组件一致。
 *
 * 协议：
 *   - 容器带 data-fc="select|datetime|time"
 *   - 触发展开：button[data-fc-toggle]
 *   - 真实值写在同容器内的 input[type=hidden]（保持 id / name 不变，读取方无需改）
 *   - 弹层：div[data-fc-pop]，用 position: fixed + JS 定位，避免被滚动容器裁掉
 *   - 全部走 document 级事件委托，视图重绘后无需重新绑定
 */
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');

/* ---------------- 下拉选择 ---------------- */

export function renderSelectField({ id, value = '', options = [], placeholder = '请选择' }) {
  const cur = options.find((o) => String(o.value) === String(value));
  return `<div class="fc" data-fc="select">
    <button type="button" class="fc__field" data-fc-toggle aria-haspopup="listbox" aria-expanded="false">
      <span class="fc__val${cur ? '' : ' is-ph'}">${esc(cur ? cur.label : placeholder)}</span>
      <span class="fc__caret">${icon('chevronDown', 13, 2)}</span>
    </button>
    <input type="hidden" id="${esc(id)}" name="${esc(id)}" value="${esc(value)}" />
    <div class="fc__pop fc__pop--list" data-fc-pop role="listbox" hidden>
      ${options.map((o) => `<button type="button" role="option" class="fc__opt${String(o.value) === String(value) ? ' is-on' : ''}"
        data-fc-value="${esc(o.value)}" aria-selected="${String(o.value) === String(value)}">${esc(o.label)}</button>`).join('')}
    </div>
  </div>`;
}

/* ---------------- 日期时间 ---------------- */

/** 把 'YYYY-MM-DDTHH:mm' 显示成 '10-28 09:00'；跨年时带上年份 */
export function fmtDateTime(v) {
  if (!v) return '';
  const s = String(v).slice(0, 16);
  const [d, t = ''] = s.split('T');
  const [y, m, dd] = d.split('-');
  const nowY = String(new Date().getFullYear());
  const datePart = y === nowY ? `${m}-${dd}` : `${y}-${m}-${dd}`;
  return t ? `${datePart} ${t}` : datePart;
}

/** 只显示时间部分 */
export function fmtTime(v) {
  if (!v) return '';
  return String(v).slice(11, 16) || String(v).slice(0, 5);
}

export function renderDateTimeField({ id, value = '', placeholder = '未设置', clearable = true }) {
  return `<div class="fc" data-fc="datetime" data-fc-clear="${clearable ? '1' : ''}">
    <button type="button" class="fc__field" data-fc-toggle aria-haspopup="dialog" aria-expanded="false">
      <span class="fc__ico">${icon('calendar', 13)}</span>
      <span class="fc__val${value ? '' : ' is-ph'}">${esc(value ? fmtDateTime(value) : placeholder)}</span>
      <span class="fc__caret">${icon('chevronDown', 13, 2)}</span>
    </button>
    <input type="hidden" id="${esc(id)}" name="${esc(id)}" value="${esc(value)}" />
    <div class="fc__pop fc__pop--cal" data-fc-pop hidden></div>
  </div>`;
}

export function renderTimeField({ id, value = '', placeholder = '请选择时间' }) {
  return `<div class="fc" data-fc="time">
    <button type="button" class="fc__field" data-fc-toggle aria-haspopup="dialog" aria-expanded="false">
      <span class="fc__ico">${icon('clock', 13)}</span>
      <span class="fc__val${value ? '' : ' is-ph'}">${esc(value ? fmtTime(value) : placeholder)}</span>
      <span class="fc__caret">${icon('chevronDown', 13, 2)}</span>
    </button>
    <input type="hidden" id="${esc(id)}" name="${esc(id)}" value="${esc(value)}" />
    <div class="fc__pop fc__pop--time" data-fc-pop hidden></div>
  </div>`;
}

/* ---------------- 弹层内容 ---------------- */

const WD = ['一', '二', '三', '四', '五', '六', '日'];

/** 日历：ym = 'YYYY-MM'，value = 'YYYY-MM-DDTHH:mm' */
function calendarHtml(ym, value) {
  const [ys, ms] = ym.split('-');
  const y = Number(ys), m = Number(ms);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // 周一为一周起点
  const daysInMonth = new Date(y, m, 0).getDate();
  const todayKey = localKey(new Date());
  const selDay = String(value || '').slice(0, 10);

  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push('<span class="cal__cell is-void"></span>');
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${y}-${pad(m)}-${pad(d)}`;
    cells.push(`<button type="button" class="cal__cell${key === selDay ? ' is-on' : ''}${key === todayKey ? ' is-today' : ''}" data-fc-day="${key}">${d}</button>`);
  }

  const hh = String(value || '').slice(11, 13) || '09';
  const mm = String(value || '').slice(14, 16) || '00';

  return `<div class="cal" data-fc-ym="${ym}">
    <div class="cal__nav">
      <button type="button" class="cal__nav-btn" data-fc-mon="-1" aria-label="上一月">${icon('chevronLeft', 13, 2.2)}</button>
      <b>${y} 年 ${m} 月</b>
      <button type="button" class="cal__nav-btn" data-fc-mon="1" aria-label="下一月">${icon('chevronRight', 13, 2.2)}</button>
    </div>
    <div class="cal__wd">${WD.map((w) => `<span>周${w}</span>`).join('')}</div>
    <div class="cal__grid">${cells.join('')}</div>
    <div class="cal__time">
      ${stepper('时', hh, 23)}
      <span class="cal__colon">:</span>
      ${stepper('分', mm, 55, 5)}
    </div>
    <div class="cal__foot">
      <button type="button" class="btn btn--ghost btn--sm" data-fc-quick="today">今天</button>
      <button type="button" class="btn btn--ghost btn--sm" data-fc-quick="clear">清除</button>
    </div>
  </div>`;
}

function stepper(label, val, max, step = 1) {
  return `<span class="cal__step" data-fc-step="${label}" data-fc-max="${max}" data-fc-step-by="${step}">
    <button type="button" class="cal__step-btn" data-fc-inc="-1" aria-label="减少${label}">−</button>
    <b class="cal__step-val" data-fc-val>${pad(Number(val))}</b>
    <button type="button" class="cal__step-btn" data-fc-inc="1" aria-label="增加${label}">＋</button>
  </span>`;
}

/** 只选时间：时 + 分 */
function timePickerHtml(value) {
  const hh = String(value || '').slice(11, 13) || String(value || '').slice(0, 2) || '09';
  const mm = String(value || '').slice(14, 16) || String(value || '').slice(3, 5) || '00';
  return `<div class="cal cal--time">
    <div class="cal__time cal__time--big">
      ${stepper('时', hh, 23)}
      <span class="cal__colon">:</span>
      ${stepper('分', mm, 55, 5)}
    </div>
    <div class="cal__foot">
      <button type="button" class="btn btn--primary btn--sm" data-fc-quick="ok">确定</button>
    </div>
  </div>`;
}

function localKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---------------- 行为 ---------------- */

let openFc = null;

function closeFc() {
  if (!openFc) return;
  const { root, pop, toggle } = openFc;
  pop.hidden = true;
  restorePop(pop);
  toggle.setAttribute('aria-expanded', 'false');
  root.classList.remove('is-open');
  openFc = null;
}

/**
 * 弹层必须挂到 body：编辑器遮罩用了 backdrop-filter，会让内部 fixed 元素改成
 * 相对遮罩定位，再被 .ed 的 overflow-y:auto 裁掉——结果就是弹层看得见却点不到，
 * 点击全落到遮罩上。挂到 body 同时也能盖过遮罩的层级（90 > 70）。
 */
function detachPop(pop) {
  if (!pop.__fcHome) {
    pop.__fcHome = pop.parentElement;
    pop.__fcNext = pop.nextSibling;
  }
  document.body.appendChild(pop);
}

function restorePop(pop) {
  const home = pop.__fcHome;
  if (home?.isConnected) home.insertBefore(pop, pop.__fcNext?.isConnected ? pop.__fcNext : null);
  else pop.remove();
  pop.__fcHome = null;
  pop.__fcNext = null;
}

function openFcAt(root, pop, toggle) {
  closeFc();
  const kind = root.dataset.fc;
  const input = root.querySelector('input[type="hidden"]');
  const value = input?.value || '';

  if (kind === 'datetime') {
    pop.innerHTML = calendarHtml(value.slice(0, 7) || localKey(new Date()).slice(0, 7), value);
  } else if (kind === 'time') {
    pop.innerHTML = timePickerHtml(value);
  }
  pop.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  root.classList.add('is-open');
  detachPop(pop);
  placePop(root, pop);
  openFc = { root, pop, toggle };
}

/** 弹层用 fixed 定位：父级有滚动条时 absolute 会被裁切 */
function placePop(root, pop) {
  const r = root.getBoundingClientRect();
  pop.style.visibility = 'hidden';
  pop.style.top = '0px';
  pop.style.left = '0px';
  const h = pop.offsetHeight || 260;
  const w = pop.offsetWidth || r.width;
  const below = window.innerHeight - r.bottom;
  const top = below > h + 12 || below > r.top ? r.bottom + 6 : Math.max(8, r.top - h - 6);
  const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
  pop.style.visibility = '';
}

/** 写回值并刷新显示 */
function commit(root, value) {
  const input = root.querySelector('input[type="hidden"]');
  const valEl = root.querySelector('.fc__val');
  const kind = root.dataset.fc;
  if (input) {
    input.value = value;
    // 让依赖 input 事件的地方（若将来有）能感知
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (valEl) {
    const text = kind === 'datetime' ? fmtDateTime(value) : kind === 'time' ? fmtTime(value) : '';
    valEl.textContent = text || (kind === 'select' ? '' : '未设置');
    valEl.classList.toggle('is-ph', !value);
  }
  if (kind === 'select') {
    // 弹层打开时挂在 body 下，选项要从弹层里找
    const options = [...(openFc?.pop || root).querySelectorAll('[data-fc-value]')];
    options.forEach((o) => {
      const on = o.dataset.fcValue === value;
      o.classList.toggle('is-on', on);
      o.setAttribute('aria-selected', String(on));
    });
    const hit = options.find((o) => o.dataset.fcValue === value);
    if (valEl && hit) {
      valEl.textContent = hit.textContent;
      valEl.classList.remove('is-ph');
    }
  }
}

/** 日历内部：把当前选中日 + 步进器的时分合成值 */
function readCalendar(pop) {
  const cal = pop.querySelector('.cal');
  if (!cal) return '';
  const on = cal.querySelector('.cal__cell.is-on');
  if (!on) return '';
  const vals = [...cal.querySelectorAll('[data-fc-val]')].map((n) => n.textContent);
  const [hh, mm] = vals.length === 2 ? vals : ['09', '00'];
  return `${on.dataset.fcDay}T${hh}:${mm}`;
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

let bound = false;
/** 只绑一次：所有实例共用一套委托 */
export function mountFormControls() {
  if (bound) return;
  bound = true;

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-fc-toggle]');
    if (toggle) {
      e.preventDefault();
      const root = toggle.closest('[data-fc]');
      const pop = root?.querySelector('[data-fc-pop]');
      if (!root || !pop) return;
      // 已打开的就是同一个 → 收起
      if (openFc && openFc.root === root) return closeFc();
      openFcAt(root, pop, toggle);
      return;
    }

    // 点击弹层之外（含别的控件）一律收起
    if (openFc && !e.target.closest('[data-fc-pop]')) {
      const stillInSame = e.target.closest('[data-fc]') === openFc.root;
      if (!stillInSame) closeFc();
    }
  });

  document.addEventListener('click', (e) => {
    const root = openFc?.root;
    if (!root) return;
    // 弹层已挂到 body，不能用 closest('[data-fc]') 判归属——只能看它是否在打开的弹层里
    const opt = e.target.closest('[data-fc-value]');
    if (opt && openFc?.pop.contains(opt)) {
      commit(root, opt.dataset.fcValue);
      closeFc();
      return;
    }

    const day = e.target.closest('[data-fc-day]');
    if (day) {
      const cal = day.closest('.cal');
      cal.querySelectorAll('.cal__cell').forEach((c) => c.classList.remove('is-on'));
      day.classList.add('is-on');
      commit(root, readCalendar(openFc.pop));
      return;
    }

    const inc = e.target.closest('[data-fc-inc]');
    if (inc) {
      const wrap = inc.closest('[data-fc-step]');
      const valEl = wrap?.querySelector('[data-fc-val]');
      if (!wrap || !valEl) return;
      const max = Number(wrap.dataset.fcMax);
      const by = Number(wrap.dataset.fcStepBy) || 1;
      const next = (Number(valEl.textContent) + Number(inc.dataset.fcInc) * by + (max + 1)) % (max + 1);
      // 分钟按步长对齐：步进 5 时不能出现 07 这样的值
      valEl.textContent = pad(by > 1 ? Math.round(next / by) * by % (max + 1) : next);
      if (root.dataset.fc === 'datetime') commit(root, readCalendar(openFc.pop));
      else {
        const hh = openFc.pop.querySelector('[data-fc-step="时"] [data-fc-val]')?.textContent || '09';
        const mm = openFc.pop.querySelector('[data-fc-step="分"] [data-fc-val]')?.textContent || '00';
        commit(root, `${hh}:${mm}`);
      }
      return;
    }

    const quick = e.target.closest('[data-fc-quick]');
    if (quick) {
      const act = quick.dataset.fcQuick;
      if (act === 'today') {
        const k = localKey(new Date());
        commit(root, `${k}T09:00`);
        openFc.pop.innerHTML = calendarHtml(k.slice(0, 7), `${k}T09:00`);
        placePop(root, openFc.pop);
      } else if (act === 'clear') {
        commit(root, '');
      } else if (act === 'ok') {
        closeFc();
      }
      return;
    }

    const mon = e.target.closest('[data-fc-mon]');
    if (mon) {
      const cal = mon.closest('.cal');
      const ym = shiftMonth(cal.dataset.fcYm, Number(mon.dataset.fcMon));
      const cur = root.querySelector('input[type="hidden"]')?.value || '';
      openFc.pop.innerHTML = calendarHtml(ym, cur);
      placePop(root, openFc.pop);
    }
  });

  // 必须用捕获阶段 + stopPropagation：编辑器自己也监听 ESC 关闭，
  // 若让事件继续冒泡，按一次 ESC 会把弹层和编辑器一起关掉。
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openFc) {
      e.stopPropagation();
      e.preventDefault();
      closeFc();
    }
  }, true);

  // 弹层是 fixed 定位，锚点一移动就要跟着走，否则点击会落到错位后的空白处。
  // 用 capture 才能收到祖先容器（如编辑器弹窗）的滚动；内部滚动也要跟随，
  // 所以这里统一重定位而不是关闭——早先「滚动即关闭」会让点击时浏览器把按钮
  // 滚进可视区的那一下就把弹层关掉。
  const onScroll = () => {
    if (!openFc) return;
    const { root, pop } = openFc;
    if (!root.isConnected) { closeFc(); return; }
    placePop(root, pop);
  };
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
}

/** 读取某个控件当前值（编辑器保存时用） */
export function fcValue(root, id) {
  return root.querySelector(`#${CSS.escape(id)}`)?.value || '';
}

/** 关闭所有展开的弹层（打开编辑器 / 切视图前调用，避免残留浮层） */
export function closeAllFc() {
  closeFc();
}
