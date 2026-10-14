// عارض الصور بملء الشاشة: تنقّل، تنزيل، طباعة.
import { esc, toast } from './ui.js';
import { t, isRtl } from './i18n.js';

let current = null;

/**
 * loaders: مصفوفة دوال، كل دالة تعيد Promise<{url, name}>.
 */
export function openViewer(loaders, startIndex, title) {
  closeViewer();
  const overlay = document.createElement('div');
  overlay.className = 'viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="viewer-bar">
      <button type="button" class="vbtn" data-act="close" aria-label="${t('إغلاق')}">✕</button>
      <span class="viewer-title"></span>
      <button type="button" class="vbtn" data-act="download" aria-label="${t('تنزيل')}">⬇️ ${t('تنزيل')}</button>
      <button type="button" class="vbtn" data-act="print" aria-label="${t('طباعة')}">🖨️ ${t('طباعة')}</button>
    </div>
    <div class="viewer-stage"><img alt=""><span class="muted viewer-loading">${t('…جارٍ التحميل')}</span></div>
    <button type="button" class="vnav prev" data-act="prev" aria-label="${t('السابقة')}">${isRtl() ? '›' : '‹'}</button>
    <button type="button" class="vnav next" data-act="next" aria-label="${t('التالية')}">${isRtl() ? '‹' : '›'}</button>`;
  document.body.appendChild(overlay);
  document.body.classList.add('viewer-open');

  current = { overlay, loaders, index: startIndex, title, image: null };
  overlay.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  show(startIndex);
}

async function show(index) {
  if (!current) return;
  const { overlay, loaders } = current;
  current.index = (index + loaders.length) % loaders.length;
  const img = overlay.querySelector('.viewer-stage img');
  const loading = overlay.querySelector('.viewer-loading');
  overlay.querySelector('.viewer-title').textContent = `${current.title} · ${current.index + 1}/${loaders.length}`;
  overlay.querySelectorAll('.vnav').forEach(b => { b.hidden = loaders.length < 2; });
  img.hidden = true;
  loading.hidden = false;
  try {
    const wanted = current.index;
    const image = await loaders[wanted]();
    if (!current || current.index !== wanted) return;
    current.image = image;
    img.src = image.url;
    img.alt = image.name;
    img.hidden = false;
    loading.hidden = true;
  } catch (err) {
    loading.textContent = t('تعذّر تحميل الصورة.');
    toast(err.message, 'error');
  }
}

function onClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') closeViewer();
  if (act === 'next') show(current.index + 1);
  if (act === 'prev') show(current.index - 1);
  if (act === 'download') download();
  if (act === 'print') print();
}

function onKey(e) {
  if (!current) return;
  if (e.key === 'Escape') closeViewer();
  // في العربية اليسار هو «التالي»، وفي الإنجليزية العكس.
  const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
  const backward = isRtl() ? 'ArrowRight' : 'ArrowLeft';
  if (e.key === forward) show(current.index + 1);
  if (e.key === backward) show(current.index - 1);
}

function download() {
  if (!current?.image) return;
  const a = document.createElement('a');
  a.href = current.image.url;
  a.download = current.image.name || 'image.jpg';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** الطباعة عبر قسم خاص يظهر وحده عند الطباعة (يعمل في التطبيق المثبّت أيضًا). */
function print() {
  if (!current?.image) return;
  let area = document.getElementById('print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'print-area';
    document.body.appendChild(area);
  }
  area.innerHTML = `<p>${esc(current.title)} · ${current.index + 1}</p><img src="${current.image.url}" alt="">`;
  const img = area.querySelector('img');
  const go = () => { window.print(); };
  if (img.complete) go(); else img.onload = go;
}

export function closeViewer() {
  if (!current) return;
  current.overlay.remove();
  document.removeEventListener('keydown', onKey);
  document.body.classList.remove('viewer-open');
  current = null;
}
