// الأرشيف والبحث، وصفحة تفاصيل السجل، وسجلات اليوم للحارس.
import { call } from './api.js';
import { base64ToBlob } from './images.js';
import {
  esc, $, $$, render, shortDate, toLocalInput, toast, setBusy, confirmDialog,
  TYPE_LABELS, TYPE_ICONS, recordSummary, errorBox
} from './ui.js';
import { openViewer } from './viewer.js';

// نحتفظ بالفلاتر والنتائج حتى يعود المستخدم إليها من صفحة السجل.
const archive = { filters: { q: '', type: '', from: '', to: '', include_deleted: false }, records: [], total: 0, page: 0 };

function recordCard(r, link = true) {
  const lines = recordSummary(r).filter(Boolean);
  const inner = `
    <div class="card-top">
      <span class="type-badge t-${esc(r.type)}">${TYPE_ICONS[r.type] || ''} ${esc(TYPE_LABELS[r.type] || r.type)}</span>
      <span class="rid">${esc(r.record_id)}</span>
    </div>
    <div class="card-date">${esc(shortDate(r.event_at))}</div>
    ${lines.map(l => `<div>${esc(l)}</div>`).join('')}
    ${r.description ? `<div class="muted clamp">${esc(r.description)}</div>` : ''}
    <div class="card-foot">📎 ${r.file_count} · ${esc([r.created_by, r.created_by_role].filter(Boolean).join(' — '))}${r.status === 'deleted' ? ' · <span class="danger">محذوف</span>' : ''}</div>`;
  return link
    ? `<a class="record-card" href="#/record/${encodeURIComponent(r.record_id)}">${inner}</a>`
    : `<div class="record-card">${inner}</div>`;
}

// ---------- الأرشيف ----------

export function renderArchive() {
  const f = archive.filters;
  const app = render(`
    <section class="screen">
      <header class="screen-head">
        <a href="#/home" class="back" aria-label="رجوع">→</a>
        <h1>🗂️ الأرشيف والبحث</h1>
      </header>
      <form id="search-form" class="filters">
        <input type="search" name="q" value="${esc(f.q)}" placeholder="رقم السجل، الفاتورة، المورد، الفرع، الشخص…" aria-label="بحث">
        <div class="filter-row">
          <select name="type" aria-label="نوع السجل">
            <option value="">كل الأنواع</option>
            ${Object.keys(TYPE_LABELS).map(t => `<option value="${t}" ${f.type === t ? 'selected' : ''}>${esc(TYPE_LABELS[t])}</option>`).join('')}
          </select>
          <label class="inline">من <input type="date" name="from" value="${esc(f.from)}"></label>
          <label class="inline">إلى <input type="date" name="to" value="${esc(f.to)}"></label>
        </div>
        <div class="filter-row">
          <label class="check"><input type="checkbox" name="include_deleted" ${f.include_deleted ? 'checked' : ''}> إظهار المحذوف</label>
          <button type="button" class="btn link" id="clear-filters">مسح</button>
          <button type="submit" class="btn primary">بحث</button>
        </div>
      </form>
      <div id="results"></div>
    </section>`);

  const form = $('#search-form', app);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const d = new FormData(form);
    archive.filters = {
      q: String(d.get('q') || '').trim(), type: String(d.get('type') || ''),
      from: String(d.get('from') || ''), to: String(d.get('to') || ''),
      include_deleted: d.get('include_deleted') === 'on'
    };
    search(1);
  });
  $('#clear-filters', app).addEventListener('click', () => {
    archive.filters = { q: '', type: '', from: '', to: '', include_deleted: false };
    renderArchive();
    search(1);
  });

  if (archive.page) drawResults();
  else search(1);
}

async function search(page) {
  const box = document.getElementById('results');
  if (!box) return;
  if (page === 1) box.innerHTML = '<p class="muted center">…جارٍ البحث</p>';
  const more = document.getElementById('load-more');
  setBusy(more, true, '…جارٍ التحميل');
  try {
    const data = await call('search', { ...archive.filters, page });
    archive.records = page === 1 ? data.records : archive.records.concat(data.records);
    archive.total = data.total;
    archive.page = page;
    drawResults();
  } catch (err) {
    setBusy(more, false);
    if (page === 1) {
      box.innerHTML = errorBox(err.message, 'إعادة المحاولة');
      $('[data-retry]', box).addEventListener('click', () => search(page));
    } else {
      toast(err.message, 'error');
    }
  }
}

function drawResults() {
  const box = document.getElementById('results');
  if (!box) return;
  if (!archive.records.length) {
    box.innerHTML = '<p class="muted center">لا توجد سجلات مطابقة.</p>';
    return;
  }
  box.innerHTML = `
    <p class="muted">${archive.total} سجل</p>
    <div class="cards">${archive.records.map(r => recordCard(r)).join('')}</div>
    ${archive.records.length < archive.total ? '<button class="btn secondary wide" id="load-more">عرض المزيد</button>' : ''}`;
  const more = document.getElementById('load-more');
  if (more) more.addEventListener('click', () => search(archive.page + 1));
}

/** بعد تعديل سجل نحدّث نسخته في نتائج الأرشيف. */
function patchArchive(record) {
  archive.records = archive.records.map(r => (r.record_id === record.record_id ? record : r));
}

// ---------- تفاصيل السجل ----------

const imageCache = new Map(); // drive_file_id → { url, name, mime }

async function loadImage(file) {
  if (imageCache.has(file.drive_file_id)) return imageCache.get(file.drive_file_id);
  const data = await call('getImage', { drive_file_id: file.drive_file_id }, { timeoutMs: 90000 });
  const blob = base64ToBlob(data.data, data.mime);
  const entry = { url: URL.createObjectURL(blob), name: data.name, mime: data.mime };
  imageCache.set(file.drive_file_id, entry);
  return entry;
}

export async function renderRecord(recordId) {
  const app = render(`
    <section class="screen">
      <header class="screen-head">
        <a href="#/archive" class="back" aria-label="رجوع">→</a>
        <h1>${esc(recordId)}</h1>
      </header>
      <div id="record-body"><p class="muted center">…جارٍ التحميل</p></div>
    </section>`);
  const body = $('#record-body', app);
  let data;
  try {
    data = await call('getRecord', { record_id: recordId });
  } catch (err) {
    body.innerHTML = errorBox(err.message, 'إعادة المحاولة');
    $('[data-retry]', body).addEventListener('click', () => renderRecord(recordId));
    return;
  }
  drawRecord(body, data);
}

function ltr(text) { return `<span dir="ltr">${esc(text)}</span>`; }

function detailRows(r) {
  // كل قيمة هنا HTML آمن (نصوص المستخدم تمر عبر esc).
  const rows = [
    ['النوع', esc(`${TYPE_ICONS[r.type]} ${TYPE_LABELS[r.type]}`)],
    [r.type === 'INC' ? 'تاريخ الواقعة' : 'التاريخ والوقت', ltr(shortDate(r.event_at))],
    r.type === 'IN' && ['المورد', esc(r.supplier)],
    r.type === 'OUT' && ['الفرع المستلم', esc(r.branch)],
    r.type !== 'INC' && [r.type === 'IN' ? 'رقم الفاتورة' : 'رقم الفاتورة / الإذن', esc(r.doc_number)],
    r.type === 'INC' && ['الشخص المعني', esc(r.person_name)],
    ['الوصف', esc(r.description)],
    ['ملاحظات', esc(r.notes)],
    ['سجّله', `${esc([r.created_by, r.created_by_role].filter(Boolean).join(' — '))} · ${ltr(shortDate(r.created_at))}`],
    r.updated_at && ['آخر تعديل', `${esc(r.updated_by)} · ${ltr(shortDate(r.updated_at))}`],
    r.status === 'deleted' && ['الحالة', '<span class="danger">محذوف</span>']
  ].filter(Boolean);
  return rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v || '<span class="muted">—</span>'}</dd>`).join('');
}

function drawRecord(body, data) {
  const r = data.record;
  body.innerHTML = `
    <dl class="details">${detailRows(r)}</dl>
    <h2 class="section-title">الصور (${data.files.length})</h2>
    <div class="gallery" id="gallery">
      ${data.files.map((f, i) => `
        <button type="button" class="gallery-item loading" data-i="${i}" aria-label="فتح الصورة ${i + 1}">
          <span class="muted">…</span>
        </button>`).join('')}
    </div>
    <div class="actions">
      <button type="button" class="btn secondary" id="edit-btn">✏️ تعديل</button>
      ${r.status === 'deleted'
        ? '<button type="button" class="btn secondary" id="restore-btn">↩️ استرجاع</button>'
        : '<button type="button" class="btn danger" id="delete-btn">🗑️ حذف</button>'}
    </div>`;

  // تحميل الصور المصغّرة واحدة تلو الأخرى
  const items = $$('.gallery-item', body);
  (async () => {
    for (let i = 0; i < data.files.length; i++) {
      const btn = items[i];
      try {
        const img = await loadImage(data.files[i]);
        btn.classList.remove('loading');
        btn.innerHTML = `<img src="${img.url}" alt="صورة ${i + 1}">`;
      } catch (err) {
        btn.classList.remove('loading');
        btn.classList.add('failed');
        btn.innerHTML = '<span>تعذّر التحميل<br>اضغط للمحاولة</span>';
      }
    }
  })();
  items.forEach(btn => btn.addEventListener('click', async () => {
    const i = Number(btn.dataset.i);
    if (btn.classList.contains('failed')) {
      btn.classList.remove('failed');
      btn.innerHTML = '<span class="muted">…</span>';
      try {
        const img = await loadImage(data.files[i]);
        btn.innerHTML = `<img src="${img.url}" alt="صورة ${i + 1}">`;
      } catch (err) {
        btn.classList.add('failed');
        btn.innerHTML = '<span>تعذّر التحميل<br>اضغط للمحاولة</span>';
        toast(err.message, 'error');
      }
      return;
    }
    if (btn.classList.contains('loading')) return;
    openViewer(data.files.map(f => () => loadImage(f)), i, r.record_id);
  }));

  $('#edit-btn', body).addEventListener('click', () => drawEdit(body, data));
  const del = $('#delete-btn', body);
  if (del) del.addEventListener('click', async () => {
    if (!(await confirmDialog('حذف هذا السجل من الأرشيف؟ يمكن استرجاعه لاحقًا من «إظهار المحذوف».'))) return;
    await changeStatus(body, data, 'deleteRecord', del);
  });
  const restore = $('#restore-btn', body);
  if (restore) restore.addEventListener('click', () => changeStatus(body, data, 'restoreRecord', restore));
}

async function changeStatus(body, data, action, button) {
  setBusy(button, true);
  try {
    const res = await call(action, { record_id: data.record.record_id });
    data.record = res.record;
    patchArchive(res.record);
    toast(action === 'deleteRecord' ? 'تم حذف السجل.' : 'تم استرجاع السجل.', 'success');
    drawRecord(body, data);
  } catch (err) {
    setBusy(button, false);
    toast(err.message, 'error');
  }
}

function drawEdit(body, data) {
  const r = data.record;
  const branches = data.branches.includes(r.branch) || !r.branch ? data.branches : [r.branch, ...data.branches];
  const field = (name, label, value, opts = '') => `
    <label class="field"><span>${label}</span>
      <input type="text" name="${name}" value="${esc(value)}" ${opts}></label>`;
  body.innerHTML = `
    <form id="edit-form">
      <label class="field"><span>التاريخ والوقت</span>
        <input type="datetime-local" name="event_at" value="${esc(toLocalInput(r.event_at))}" required></label>
      ${r.type === 'IN' ? field('supplier', 'المورد', r.supplier, 'maxlength="120"') : ''}
      ${r.type === 'OUT' ? `<label class="field"><span>الفرع المستلم</span>
        <select name="branch">${branches.map(b => `<option ${b === r.branch ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>` : ''}
      ${r.type !== 'INC' ? field('doc_number', 'رقم الفاتورة / الإذن', r.doc_number, 'maxlength="60"') : ''}
      ${r.type === 'INC' ? field('person_name', 'الشخص المعني', r.person_name, 'maxlength="120"') : ''}
      <label class="field"><span>الوصف</span><textarea name="description" rows="2" maxlength="500">${esc(r.description)}</textarea></label>
      <label class="field"><span>ملاحظات</span><textarea name="notes" rows="2" maxlength="1000">${esc(r.notes)}</textarea></label>
      <div id="edit-status"></div>
      <div class="actions">
        <button type="button" class="btn secondary" id="cancel-edit">إلغاء</button>
        <button type="submit" class="btn primary" id="save-edit">حفظ التعديل</button>
      </div>
    </form>`;
  $('#cancel-edit', body).addEventListener('click', () => drawRecord(body, data));
  $('#edit-form', body).addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    const { event_at, ...fields } = d;
    const btn = $('#save-edit', body);
    setBusy(btn, true, '…جارٍ الحفظ');
    try {
      const res = await call('updateRecord', { record_id: r.record_id, event_at, fields });
      data.record = res.record;
      patchArchive(res.record);
      toast('تم حفظ التعديل.', 'success');
      drawRecord(body, data);
    } catch (err) {
      setBusy(btn, false);
      $('#edit-status', body).innerHTML = errorBox(err.message);
    }
  });
}

// ---------- سجلاتي اليوم (للحارس) ----------

export async function renderToday() {
  const app = render(`
    <section class="screen">
      <header class="screen-head">
        <a href="#/home" class="back" aria-label="رجوع">→</a>
        <h1>📋 سجلاتي اليوم</h1>
      </header>
      <div id="today"><p class="muted center">…جارٍ التحميل</p></div>
    </section>`);
  const box = $('#today', app);
  try {
    const { records } = await call('myToday');
    box.innerHTML = records.length
      ? `<p class="muted">${records.length} سجل محفوظ اليوم</p><div class="cards">${records.map(r => recordCard(r, false)).join('')}</div>`
      : '<p class="muted center">لم تسجّل شيئًا اليوم بعد.</p>';
  } catch (err) {
    box.innerHTML = errorBox(err.message, 'إعادة المحاولة');
    $('[data-retry]', box).addEventListener('click', renderToday);
  }
}

export function resetArchive() {
  archive.records = [];
  archive.total = 0;
  archive.page = 0;
  imageCache.forEach(e => URL.revokeObjectURL(e.url));
  imageCache.clear();
}
