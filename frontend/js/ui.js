// أدوات واجهة صغيرة مشتركة.
import { t } from './i18n.js';

// getters: التسمية تتبع اللغة الحالية.
export const TYPE_LABELS = {
  get IN() { return t('بضاعة داخلة'); },
  get OUT() { return t('بضاعة خارجة'); },
  get INC() { return t('مخالفات العمال'); }
};
export const TYPE_ICONS = { IN: '📥', OUT: '📤', INC: '⚠️' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function $(selector, root = document) { return root.querySelector(selector); }
export function $$(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

export function render(html) {
  const app = document.getElementById('app');
  app.innerHTML = html;
  window.scrollTo(0, 0);
  return app;
}

/** 'yyyy-MM-dd HH:mm:ss' → 'yyyy-MM-dd HH:mm' */
export function shortDate(s) { return String(s || '').slice(0, 16); }

/** قيمة حقل datetime-local للوقت الحالي بتوقيت الجهاز. */
export function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** 'yyyy-MM-dd HH:mm:ss' → قيمة datetime-local */
export function toLocalInput(s) { return String(s || '').slice(0, 16).replace(' ', 'T'); }

let toastTimer = null;
export function toast(message, kind = 'info') {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = 'toast'; }, 3500);
}

/** نافذة تأكيد بسيطة. */
export function confirmDialog(message) {
  return Promise.resolve(window.confirm(message));
}

export function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText || t('…جارٍ');
    button.disabled = true;
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
  }
}

export function recordSummary(r) {
  if (r.type === 'IN') return [r.supplier && t('المورد: {v}', { v: r.supplier }), r.doc_number && t('فاتورة: {v}', { v: r.doc_number })];
  if (r.type === 'OUT') return [r.branch && t('الفرع: {v}', { v: r.branch }), r.doc_number && t('رقم الإذن: {v}', { v: r.doc_number })];
  return [r.person_name && t('الشخص: {v}', { v: r.person_name })];
}

export function errorBox(message, retryLabel) {
  return `<div class="alert error" role="alert"><p>${esc(message)}</p>${
    retryLabel ? `<button type="button" class="btn" data-retry>${esc(retryLabel)}</button>` : ''}</div>`;
}
