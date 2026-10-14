// نماذج إنشاء السجلات الثلاثة، مع رفع الصور وإعادة المحاولة دون تكرار.
import { call } from './api.js';
import { compressImage, blobToBase64, newRequestId } from './images.js';
import { esc, $, $$, render, nowLocalInput, toast, TYPE_LABELS, TYPE_ICONS, errorBox } from './ui.js';
import { t, backArrow } from './i18n.js';

const MAX_IMAGES = 10;

let state = null;

function unloadGuard(e) {
  if (state && state.images.length && !state.saved) {
    e.preventDefault();
    e.returnValue = '';
  }
}

export function hasUnsavedForm() {
  return !!(state && !state.saved && state.images.length);
}

export function leaveForm() {
  state = null;
  window.removeEventListener('beforeunload', unloadGuard);
}

const FIELD_HTML = {
  event_at: type => `
    <label class="field">
      <span>${type === 'INC' ? t('تاريخ ووقت الواقعة') : t('التاريخ والوقت')}</span>
      <input type="datetime-local" name="event_at" value="${nowLocalInput()}" required>
    </label>`,
  supplier: () => `
    <label class="field">
      <span>${t('اسم المورد')} <small>${t('(اختياري)')}</small></span>
      <input type="text" name="supplier" maxlength="120" list="supplier-list" autocomplete="off">
      <datalist id="supplier-list"></datalist>
    </label>`,
  branch: () => `
    <label class="field">
      <span>${t('الفرع المستلم')}</span>
      <select name="branch" required><option value="">${t('…جارٍ تحميل الفروع')}</option></select>
    </label>`,
  doc_number: type => `
    <label class="field">
      <span>${type === 'IN' ? t('رقم الفاتورة') : t('رقم الفاتورة أو إذن التسليم')} <small>${t('(اختياري)')}</small></span>
      <input type="text" name="doc_number" maxlength="60" inputmode="text" autocomplete="off">
    </label>`,
  person_name: () => `
    <label class="field">
      <span>${t('اسم الشخص المعني')} <small>${t('(إن كان معروفًا)')}</small></span>
      <input type="text" name="person_name" maxlength="120" autocomplete="off">
    </label>`,
  description: type => `
    <label class="field">
      <span>${t('وصف مختصر')} ${type === 'INC' ? '' : `<small>${t('(اختياري)')}</small>`}</span>
      <textarea name="description" maxlength="500" rows="2" ${type === 'INC' ? 'required' : ''}></textarea>
    </label>`,
  notes: () => `
    <label class="field">
      <span>${t('ملاحظات')} <small>${t('(اختياري)')}</small></span>
      <textarea name="notes" maxlength="1000" rows="2"></textarea>
    </label>`
};

const FIELDS = {
  IN: ['event_at', 'supplier', 'doc_number', 'description', 'notes'],
  OUT: ['event_at', 'branch', 'doc_number', 'description', 'notes'],
  INC: ['event_at', 'person_name', 'description', 'notes']
};

export function renderForm(type, user) {
  if (!FIELDS[type] || !user.can_create.includes(type)) {
    location.hash = '#/home';
    return;
  }
  state = { type, requestId: newRequestId(), images: [], nextIndex: 1, saving: false, saved: null };
  window.addEventListener('beforeunload', unloadGuard);

  const app = render(`
    <section class="screen">
      <header class="screen-head">
        <a href="#/home" class="back" aria-label="${t('رجوع')}">${backArrow()}</a>
        <h1>${TYPE_ICONS[type]} ${esc(TYPE_LABELS[type])}</h1>
      </header>
      <form id="record-form" novalidate>
        ${FIELDS[type].map(f => FIELD_HTML[f](type)).join('')}

        <div class="field">
          <span>${t('الصور')} <small>${t('(صورة واحدة على الأقل، حتى {n})', { n: MAX_IMAGES })}</small></span>
          <div class="thumbs" id="thumbs"></div>
          <div class="photo-buttons">
            <label class="btn secondary">📷 ${t('التقاط صورة')}
              <input type="file" accept="image/*" capture="environment" hidden data-pick>
            </label>
            <label class="btn secondary">🖼️ ${t('من الجهاز')}
              <input type="file" accept="image/*" multiple hidden data-pick>
            </label>
          </div>
        </div>

        <p class="muted">${t('يُسجَّل باسم:')} <strong>${esc(user.display_name)}</strong></p>
        <div id="form-status" aria-live="polite"></div>
        <button type="submit" class="btn primary big" id="save-btn">${t('حفظ السجل')}</button>
      </form>
    </section>`);

  const form = $('#record-form', app);
  $$('[data-pick]', form).forEach(input => input.addEventListener('change', onPick));
  form.addEventListener('submit', e => { e.preventDefault(); save(); });
  loadLookups(type, form);
  renderThumbs();
}

async function loadLookups(type, form) {
  try {
    if (type === 'OUT') {
      const { branches } = await call('branches');
      const select = $('select[name="branch"]', form);
      if (!select) return;
      select.innerHTML = branches.length
        ? `<option value="">${t('اختر الفرع')}</option>` + branches.map(b => `<option>${esc(b.name)}</option>`).join('')
        : `<option value="">${t('لا توجد فروع. اطلب من الإدارة إضافتها.')}</option>`;
    }
    if (type === 'IN') {
      const { suppliers } = await call('suppliers');
      const list = $('#supplier-list', form);
      if (list) list.innerHTML = suppliers.map(s => `<option value="${esc(s)}">`).join('');
    }
  } catch (err) {
    if (type === 'OUT') {
      const select = $('select[name="branch"]', form);
      if (select) select.innerHTML = `<option value="">${t('تعذّر تحميل الفروع، أعد فتح الصفحة')}</option>`;
    }
  }
}

async function onPick(e) {
  const input = e.target;
  const files = Array.from(input.files || []);
  input.value = '';
  if (!state || state.saving) return;
  for (const file of files) {
    if (state.images.length >= MAX_IMAGES) {
      toast(t('الحد الأقصى {n} صور للسجل الواحد.', { n: MAX_IMAGES }), 'error');
      break;
    }
    try {
      const blob = await compressImage(file);
      if (!state) return;
      state.images.push({ index: state.nextIndex++, blob, url: URL.createObjectURL(blob), status: 'new' });
      renderThumbs();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

const STATUS_LABELS = { new: '', uploading: '⏳', done: '✓', error: '!' };

function renderThumbs() {
  const box = document.getElementById('thumbs');
  if (!box || !state) return;
  box.innerHTML = state.images.length
    ? state.images.map(img => `
      <figure class="thumb ${img.status}">
        <img src="${img.url}" alt="${t('صورة {n}', { n: img.index })}">
        ${STATUS_LABELS[img.status] ? `<span class="badge">${STATUS_LABELS[img.status]}</span>` : ''}
        ${state.saving ? '' : `<button type="button" class="remove" data-remove="${img.index}" aria-label="${t('حذف الصورة')}">×</button>`}
      </figure>`).join('')
    : `<p class="muted empty-thumbs">${t('لم تُرفق صور بعد')}</p>`;
  $$('[data-remove]', box).forEach(btn => btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.remove);
    const img = state.images.find(i => i.index === idx);
    if (img) URL.revokeObjectURL(img.url);
    state.images = state.images.filter(i => i.index !== idx);
    renderThumbs();
  }));
}

function setStatus(html) {
  const box = document.getElementById('form-status');
  if (box) box.innerHTML = html;
}

function collectFields(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const fields = {};
  FIELDS[state.type].filter(f => f !== 'event_at').forEach(f => { fields[f] = (data[f] || '').trim(); });
  return { event_at: data.event_at, fields };
}

function validate(values) {
  if (!state.images.length) return t('أرفق صورة واحدة على الأقل.');
  if (!values.event_at) return t('حدّد التاريخ والوقت.');
  if (state.type === 'OUT' && !values.fields.branch) return t('اختر الفرع المستلم.');
  if (state.type === 'INC' && !values.fields.description) return t('اكتب وصفًا مختصرًا للواقعة.');
  return '';
}

async function uploadPending() {
  const pending = state.images.filter(i => i.status !== 'done');
  let n = state.images.length - pending.length;
  for (const img of pending) {
    img.status = 'uploading';
    renderThumbs();
    setStatus(`<div class="alert info">${t('جارٍ رفع الصور… {n} من {total}', { n, total: state.images.length })}</div>`);
    try {
      await call('uploadImage', {
        request_id: state.requestId, index: img.index, type: state.type,
        mime: 'image/jpeg', data: await blobToBase64(img.blob)
      }, { timeoutMs: 120000 });
      img.status = 'done';
      n++;
    } catch (err) {
      img.status = 'error';
      renderThumbs();
      throw err;
    }
  }
  renderThumbs();
}

async function save() {
  if (!state || state.saving) return;
  const form = document.getElementById('record-form');
  const values = collectFields(form);
  const problem = validate(values);
  if (problem) {
    setStatus(errorBox(problem));
    return;
  }

  const button = document.getElementById('save-btn');
  state.saving = true;
  button.disabled = true;
  button.textContent = t('…جارٍ الحفظ');
  renderThumbs();

  try {
    let result;
    for (let attempt = 0; ; attempt++) {
      await uploadPending();
      setStatus(`<div class="alert info">${t('جارٍ حفظ السجل…')}</div>`);
      try {
        result = await call('createRecord', {
          request_id: state.requestId, type: state.type, event_at: values.event_at,
          fields: values.fields, image_indexes: state.images.map(i => i.index)
        });
        break;
      } catch (err) {
        // الخادم لم يجد بعض الصور: نعيد رفعها مرة واحدة تلقائيًا.
        if (err.code === 'IMAGES_MISSING' && attempt === 0) {
          const missing = new Set(err.extra?.missing || []);
          state.images.forEach(i => { if (missing.has(i.index)) i.status = 'new'; });
          continue;
        }
        throw err;
      }
    }
    state.saved = result.record;
    showSuccess(result.record);
  } catch (err) {
    state.saving = false;
    renderThumbs();
    button.disabled = false;
    button.textContent = t('إعادة المحاولة');
    setStatus(errorBox(`${t('لم يُحفظ السجل.')} ${err.message}`, t('إعادة المحاولة')));
    const retry = document.querySelector('[data-retry]');
    if (retry) retry.addEventListener('click', save);
  }
}

function showSuccess(record) {
  const type = state.type;
  state.images.forEach(i => URL.revokeObjectURL(i.url));
  leaveForm();
  render(`
    <section class="screen success">
      <div class="success-mark" aria-hidden="true">✓</div>
      <h1>${t('تم حفظ السجل بنجاح')}</h1>
      <p class="record-id">${esc(record.record_id)}</p>
      <p class="muted">${esc(TYPE_LABELS[record.type] || record.type_label)} · ${t('{n} صورة', { n: record.file_count })}</p>
      <div class="stack">
        <a class="btn primary big" href="#/new/${type}" data-again>${esc(t('تسجيل {type} جديد', { type: TYPE_LABELS[type] }))}</a>
        <a class="btn secondary" href="#/home">${t('الصفحة الرئيسية')}</a>
      </div>
    </section>`);
  // نفس الرابط الحالي لا يُطلق hashchange، لذا نعيد الرسم يدويًا.
  document.querySelector('[data-again]').addEventListener('click', e => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('navigate', { detail: `#/new/${type}` }));
  });
}
