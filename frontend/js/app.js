// نقطة البداية: الدخول، الشاشة الرئيسية، والتنقل بين الشاشات.
import { call } from './api.js';
import { APP_NAME } from './config.js';
import { getUser, getSession, saveSession, updateUser, clearSession } from './session.js';
import { esc, $, render, toast, setBusy, errorBox, TYPE_LABELS, TYPE_ICONS } from './ui.js';
import { renderForm, hasUnsavedForm, leaveForm } from './forms.js';
import { renderArchive, renderRecord, renderToday, resetArchive } from './archive.js';
import { renderSettings, renderPassword } from './admin.js';
import { closeViewer } from './viewer.js';
import { t, applyLang, setLang, otherLang, LANGS } from './i18n.js';

// ---------- اللغة ----------

function langButton() {
  const next = otherLang();
  return `<button type="button" class="btn small secondary" data-lang="${next}" lang="${next}">${esc(LANGS[next])}</button>`;
}

/** زر تبديل اللغة يعيد رسم الشاشة الحالية باللغة الأخرى. */
function bindLang(root, rerender) {
  const btn = root.querySelector('[data-lang]');
  if (btn) btn.addEventListener('click', () => { setLang(btn.dataset.lang); rerender(); });
}

// ---------- الدخول ----------

function renderLogin(message) {
  const app = render(`
    <section class="screen narrow login">
      <div class="lang-switch">${langButton()}</div>
      <div class="brand">
        <img src="icons/icon-192.png" alt="" width="72" height="72">
        <h1>${esc(t(APP_NAME))}</h1>
        <p class="muted">${t('أرشيف مصنع حلويات العكر')}</p>
      </div>
      ${message ? `<div class="alert info">${esc(message)}</div>` : ''}
      <form id="login-form">
        <label class="field"><span>${t('اسم المستخدم')}</span>
          <input type="text" name="username" required autocomplete="username" autocapitalize="off" dir="ltr"></label>
        <label class="field"><span>${t('كلمة المرور')}</span>
          <input type="password" name="password" required autocomplete="current-password" dir="ltr"></label>
        <label class="check"><input type="checkbox" name="remember" checked> ${t('تذكّرني على هذا الجهاز (14 يومًا)')}</label>
        <div id="login-status"></div>
        <button type="submit" class="btn primary big">${t('دخول')}</button>
      </form>
    </section>`);
  bindLang(app, () => renderLogin(message));
  $('#login-form', app).addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type=submit]');
    setBusy(btn, true, t('…جارٍ الدخول'));
    try {
      const data = await call('login', {
        username: form.username.value.trim(),
        password: form.password.value,
        remember: form.remember.checked,
        device_hint: navigator.userAgent.slice(0, 120)
      });
      saveSession(data);
      route();
    } catch (err) {
      setBusy(btn, false);
      $('#login-status', app).innerHTML = errorBox(err.message);
    }
  });
}

async function logout() {
  try {
    await call('logout');
  } catch {
    // حتى لو فشل الاتصال نمسح الجلسة من الجهاز
  }
  clearSession();
  resetArchive();
  location.hash = '#/home';
  renderLogin(t('تم تسجيل الخروج.'));
}

// ---------- الرئيسية ----------

function renderHome(user) {
  const tiles = ['IN', 'OUT', 'INC']
    .filter(type => user.can_create.includes(type))
    .map(type => `<a class="tile t-${type}" href="#/new/${type}"><span class="tile-icon">${TYPE_ICONS[type]}</span>${esc(TYPE_LABELS[type])}</a>`);
  tiles.push(user.is_admin
    ? `<a class="tile t-archive" href="#/archive"><span class="tile-icon">🗂️</span>${t('الأرشيف والبحث')}</a>`
    : `<a class="tile t-archive" href="#/today"><span class="tile-icon">📋</span>${t('سجلاتي اليوم')}</a>`);
  const roleLabel = t(user.function_name || user.access_name || user.role_name || '');

  const app = render(`
    <section class="screen">
      <header class="top-bar">
        <div>
          <strong>${esc(t(APP_NAME))}</strong>
          <div class="muted small">${esc([user.display_name, roleLabel].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="top-actions">
          ${langButton()}
          ${user.is_admin ? `<a class="btn small secondary" href="#/settings" aria-label="${t('الإعدادات')}">⚙️</a>` : ''}
          <a class="btn small secondary" href="#/password" aria-label="${t('تغيير كلمة المرور')}">🔑</a>
          <button type="button" class="btn small secondary" id="logout-btn">${t('خروج')}</button>
        </div>
      </header>
      <nav class="tiles">${tiles.join('')}</nav>
    </section>`);
  $('#logout-btn', app).addEventListener('click', logout);
  bindLang(app, () => renderHome(user));
}

// ---------- التنقل ----------

let lastHash = location.hash;

function route() {
  closeViewer();
  const session = getSession();
  const user = getUser();
  if (!session || !user) {
    renderLogin();
    return;
  }
  if (user.must_change) {
    renderPassword(user, {
      forced: true,
      onDone: () => { updateUser({ ...user, must_change: false }); location.hash = '#/home'; route(); }
    });
    return;
  }

  const [, page, arg] = (location.hash || '#/home').split('/');
  if (page !== 'new') leaveForm();
  switch (page) {
    case 'new': return renderForm(arg, user);
    case 'archive': return user.is_admin ? renderArchive() : renderHome(user);
    case 'record': return user.is_admin ? renderRecord(decodeURIComponent(arg || '')) : renderHome(user);
    case 'today': return renderToday();
    case 'settings': return user.is_admin ? renderSettings(user) : renderHome(user);
    case 'password': return renderPassword(user, { onDone: () => { location.hash = '#/home'; } });
    default: return renderHome(user);
  }
}

window.addEventListener('hashchange', () => {
  if (hasUnsavedForm() && !window.confirm(t('لديك سجل لم يُحفظ بعد. هل تريد تركه؟'))) {
    history.replaceState(null, '', lastHash);
    return;
  }
  lastHash = location.hash;
  route();
});

window.addEventListener('navigate', e => {
  if (location.hash === e.detail) route();
  else location.hash = e.detail;
});

window.addEventListener('auth-lost', e => {
  leaveForm();
  resetArchive();
  renderLogin(e.detail || t('انتهت الجلسة. سجّل الدخول من جديد.'));
});

window.addEventListener('must-change', () => {
  const user = getUser();
  if (user) { updateUser({ ...user, must_change: true }); route(); }
});

window.addEventListener('offline', () => toast(t('انقطع الاتصال بالإنترنت.'), 'error'));
window.addEventListener('online', () => toast(t('عاد الاتصال بالإنترنت.'), 'success'));

// تحديث بيانات المستخدم من الخادم عند فتح التطبيق (الدور قد يتغير).
async function refreshMe() {
  if (!getSession()) return;
  try {
    const { user } = await call('me');
    const before = JSON.stringify(getUser());
    updateUser(user);
    if (JSON.stringify(user) !== before && !hasUnsavedForm()) route();
  } catch {
    // عند انقطاع الإنترنت نكمل بالبيانات المحفوظة
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

applyLang();
route();
refreshMe();
