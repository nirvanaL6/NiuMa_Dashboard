/**
 * 通用弹窗：确认框（confirm）。
 *
 * 存在的理由：原生 confirm() 的样式完全由浏览器决定，在新拟态界面里突兀得
 * 像错误弹窗，而且不支持「不再提示」。这里复用编辑器弹窗（.ed-*）的同一套
 * token，视觉上就是本应用自己的对话框。
 *
 * 用法：
 *   const ok = await confirmDialog({
 *     title: '删除这条待办？',
 *     desc: '删除后无法恢复。',
 *     confirmText: '删除',
 *     danger: true,
 *     onceKey: 'todo-delete',   // 传了才会出现「不再提示」勾选
 *   });
 */
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ONCE_PREFIX = 'wd-noask:';
/** 用户勾过「不再提示」的 key 集合，读到内存里避免每次开弹窗都解析一次 */
const muted = new Set(
  Object.keys(localStorage).filter((k) => k.startsWith(ONCE_PREFIX) && localStorage.getItem(k) === '1')
    .map((k) => k.slice(ONCE_PREFIX.length)),
);

export function isMuted(key) {
  return !!key && muted.has(key);
}

function setMuted(key, on) {
  if (!key) return;
  if (on) {
    muted.add(key);
    localStorage.setItem(ONCE_PREFIX + key, '1');
  } else {
    muted.delete(key);
    localStorage.removeItem(ONCE_PREFIX + key);
  }
}

let activeDialog = null;

/**
 * @returns {Promise<boolean>} 确认 true / 取消 false
 */
export function confirmDialog({
  title = '确认操作',
  desc = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onceKey = '',
  onceLabel = '不再提示',
} = {}) {
  // 「不再提示」只对本次会话之后的同类操作生效：已经勾过就直接放行
  if (onceKey && isMuted(onceKey)) return Promise.resolve(true);

  return new Promise((resolve) => {
    // 同一时刻只保留一个弹窗（编辑器里连点删除不该叠两层）
    activeDialog?.close(false);

    const mask = document.createElement('div');
    mask.className = 'ed-mask open dlg-mask';
    mask.innerHTML = `
      <div class="ed dlg" role="alertdialog" aria-modal="true" aria-labelledby="dlgTitle">
        <header class="ed__head">
          <h3 id="dlgTitle" class="${danger ? 'is-danger' : ''}">${icon(danger ? 'alert' : 'help', 16, 1.9)} ${esc(title)}</h3>
          <button class="ed__x" data-dlg="cancel" aria-label="关闭">${icon('close', 15)}</button>
        </header>
        <div class="ed__body">
          ${desc ? `<p class="dlg__desc">${esc(desc)}</p>` : ''}
          ${onceKey ? `<label class="dlg__once">
            <input type="checkbox" data-dlg-once />
            <span class="dlg__box" aria-hidden="true">${icon('check', 11, 3)}</span>
            <span>${esc(onceLabel)}</span>
          </label>` : ''}
        </div>
        <footer class="ed__foot">
          <span class="ed__err"></span>
          <button class="btn btn--ghost btn--sm" data-dlg="cancel">${esc(cancelText)}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'} btn--sm" data-dlg="ok">${esc(confirmText)}</button>
        </footer>
      </div>`;

    const onceBox = mask.querySelector('[data-dlg-once]');
    const okBtn = mask.querySelector('[data-dlg="ok"]');

    function close(result) {
      if (!mask.isConnected) return;
      document.removeEventListener('keydown', onKey, true);
      activeDialog = null;
      mask.remove();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
      if (e.key === 'Enter') { e.stopPropagation(); close(true); }
    }

    mask.addEventListener('click', (e) => {
      if (e.target === mask) return close(false);
      const act = e.target.closest('[data-dlg]');
      if (!act) return;
      if (act.dataset.dlg === 'ok') {
        if (onceBox?.checked) setMuted(onceKey, true);
        close(true);
      } else {
        close(false);
      }
    });

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(mask);
    activeDialog = { close };
    // 默认焦点给「取消」：删除类操作不该让回车误伤
    requestAnimationFrame(() => (danger ? mask.querySelector('[data-dlg="cancel"]') : okBtn)?.focus());
  });
}

/** 清掉所有「不再提示」记录（设置里可加一个入口调用） */
export function resetMuted() {
  [...muted].forEach((k) => setMuted(k, false));
}
