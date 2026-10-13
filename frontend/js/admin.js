// الإعدادات (للإدارة): الفروع والمستخدمون.
import { call } from './api.js';
import { esc, $, $$, render, toast, setBusy, confirmDialog, errorBox, shortDate } from './ui.js';

export function renderSettings(user) {
  const app = render(`
    <section class="screen">
      <header class="screen-head">
        <a href="#/home" class="back" aria-label="رجوع">→</a>
        <h1>⚙️ الإعدادات</h1>
      </header>

      <h2 class="section-title">الفروع</h2>
      <div id="branches"><p class="muted">…جارٍ التحميل</p></div>
      <form id="branch-form" class="inline-form">
        <input type="text" name="name" maxlength="120" placeholder="اسم فرع جديد" required aria-label="اسم فرع جديد">
        <button type="submit" class="btn primary">إضافة</button>
      </form>

      <h2 class="section-title">المستخدمون</h2>
      <div id="users"><p class="muted">…جارٍ التحميل</p></div>
      <details class="panel">
        <summary>➕ إضافة مستخدم</summary>
        <form id="user-form">
          <label class="field"><span>اسم الدخول (حروف إنجليزية صغيرة وأرقام)</span>
            <input type="text" name="username" required pattern="[a-z0-9._\\-]{3,40}" autocapitalize="off" autocomplete="off" dir="ltr"></label>
          <label class="field"><span>الاسم الظاهر</span>
            <input type="text" name="display_name" maxlength="60" required></label>
          <label class="field"><span>الدور</span><select name="role" id="role-select"></select></label>
          <label class="field"><span>كلمة مرور مؤقتة (6 أحرف على الأقل)</span>
            <input type="text" name="password" minlength="6" required autocomplete="off" dir="ltr"></label>
          <p class="muted">سيُطلب من المستخدم تغييرها عند أول دخول.</p>
          <button type="submit" class="btn primary">إنشاء الحساب</button>
        </form>
      </details>
    </section>`);

  const ctx = { user, roles: [], users: [], branches: [] };
  loadBranches(ctx);
  loadUsers(ctx);

  $('#branch-form', app).addEventListener('submit', async e => {
    e.preventDefault();
    const input = e.target.elements.name;
    const btn = e.target.querySelector('button');
    setBusy(btn, true);
    try {
      const { branches } = await call('saveBranch', { name: input.value.trim() });
      ctx.branches = branches;
      input.value = '';
      drawBranches(ctx);
      toast('تمت إضافة الفرع.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  $('#user-form', app).addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const d = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector('button');
    setBusy(btn, true);
    try {
      const { users } = await call('saveUser', d);
      ctx.users = users;
      form.reset();
      form.closest('details').open = false;
      drawUsers(ctx);
      toast('تم إنشاء الحساب.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });
}

async function loadBranches(ctx) {
  const box = document.getElementById('branches');
  try {
    ctx.branches = (await call('branches', { all: true })).branches;
    drawBranches(ctx);
  } catch (err) {
    if (box) box.innerHTML = errorBox(err.message);
  }
}

function drawBranches(ctx) {
  const box = document.getElementById('branches');
  if (!box) return;
  box.innerHTML = ctx.branches.length
    ? `<ul class="list">${ctx.branches.map(b => `
        <li class="${b.active ? '' : 'inactive'}">
          <span>${esc(b.name)}${b.active ? '' : ' <small class="muted">(موقوف)</small>'}</span>
          <button type="button" class="btn small secondary" data-toggle="${esc(b.branch_id)}">${b.active ? 'إيقاف' : 'تفعيل'}</button>
        </li>`).join('')}</ul>`
    : '<p class="muted">لا توجد فروع بعد. أضف أول فرع أدناه.</p>';
  $$('[data-toggle]', box).forEach(btn => btn.addEventListener('click', async () => {
    const b = ctx.branches.find(x => x.branch_id === btn.dataset.toggle);
    setBusy(btn, true);
    try {
      ctx.branches = (await call('saveBranch', { ...b, active: !b.active })).branches;
      drawBranches(ctx);
    } catch (err) {
      setBusy(btn, false);
      toast(err.message, 'error');
    }
  }));
}

async function loadUsers(ctx) {
  const box = document.getElementById('users');
  try {
    const [rolesData, usersData] = await Promise.all([call('roles'), call('users')]);
    ctx.roles = rolesData.roles;
    ctx.users = usersData.users;
    const select = document.getElementById('role-select');
    if (select) select.innerHTML = ctx.roles.map(r => `<option value="${esc(r.role_id)}">${esc(r.name)}</option>`).join('');
    drawUsers(ctx);
  } catch (err) {
    if (box) box.innerHTML = errorBox(err.message);
  }
}

function roleName(ctx, id) { return ctx.roles.find(r => r.role_id === id)?.name || id; }

function drawUsers(ctx) {
  const box = document.getElementById('users');
  if (!box) return;
  box.innerHTML = `<ul class="list users">${ctx.users.map(u => `
    <li class="${u.active ? '' : 'inactive'}">
      <div>
        <strong>${esc(u.display_name)}</strong> <span class="muted" dir="ltr">${esc(u.username)}</span><br>
        <small class="muted">${esc(roleName(ctx, u.role))}
          ${u.active ? '' : ' · موقوف'}${u.locked ? ' · مقفل مؤقتًا' : ''}
          ${u.last_login_at ? ' · آخر دخول ' + esc(shortDate(u.last_login_at)) : ''}</small>
      </div>
      ${u.username === ctx.user.username ? '<small class="muted">(أنت)</small>' : `
      <div class="user-actions">
        <button type="button" class="btn small secondary" data-act="reset" data-u="${esc(u.username)}">كلمة مرور جديدة</button>
        <button type="button" class="btn small secondary" data-act="sessions" data-u="${esc(u.username)}">إنهاء الجلسات</button>
        <button type="button" class="btn small ${u.active ? 'danger' : 'secondary'}" data-act="active" data-u="${esc(u.username)}">${u.active ? 'إيقاف' : 'تفعيل'}</button>
      </div>`}
    </li>`).join('')}</ul>`;

  $$('[data-act]', box).forEach(btn => btn.addEventListener('click', async () => {
    const u = ctx.users.find(x => x.username === btn.dataset.u);
    try {
      if (btn.dataset.act === 'reset') {
        const pw = window.prompt(`كلمة مرور مؤقتة جديدة لـ «${u.display_name}» (6 أحرف على الأقل):`);
        if (!pw) return;
        setBusy(btn, true);
        await call('resetPassword', { username: u.username, password: pw });
        toast('تم تعيين كلمة المرور. سيُطلب منه تغييرها عند الدخول.', 'success');
      }
      if (btn.dataset.act === 'sessions') {
        if (!(await confirmDialog(`تسجيل خروج «${u.display_name}» من كل الأجهزة؟`))) return;
        setBusy(btn, true);
        const res = await call('revokeSessions', { username: u.username });
        toast(`تم إنهاء ${res.sessions_ended} جلسة.`, 'success');
      }
      if (btn.dataset.act === 'active') {
        if (u.active && !(await confirmDialog(`إيقاف حساب «${u.display_name}»؟ لن يتمكن من الدخول.`))) return;
        setBusy(btn, true);
        ctx.users = (await call('saveUser', { ...u, existing: true, active: !u.active })).users;
        drawUsers(ctx);
        return;
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(btn, false);
  }));
}

/** تغيير كلمة المرور الخاصة (لكل المستخدمين). */
export function renderPassword(user, { forced = false, onDone } = {}) {
  const app = render(`
    <section class="screen narrow">
      <header class="screen-head">
        ${forced ? '' : '<a href="#/home" class="back" aria-label="رجوع">→</a>'}
        <h1>🔑 تغيير كلمة المرور</h1>
      </header>
      ${forced ? '<div class="alert info">مرحبًا ' + esc(user.display_name) + '. اختر كلمة مرور خاصة بك بدل كلمة المرور المؤقتة.</div>' : ''}
      <form id="pw-form">
        <label class="field"><span>كلمة المرور الحالية</span>
          <input type="password" name="old_password" required autocomplete="current-password"></label>
        <label class="field"><span>كلمة المرور الجديدة (6 أحرف على الأقل)</span>
          <input type="password" name="new_password" minlength="6" required autocomplete="new-password"></label>
        <label class="field"><span>تأكيد كلمة المرور الجديدة</span>
          <input type="password" name="confirm" minlength="6" required autocomplete="new-password"></label>
        <div id="pw-status"></div>
        <button type="submit" class="btn primary big">حفظ</button>
      </form>
    </section>`);
  $('#pw-form', app).addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    const status = $('#pw-status', app);
    if (d.new_password !== d.confirm) {
      status.innerHTML = errorBox('كلمتا المرور غير متطابقتين.');
      return;
    }
    const btn = e.target.querySelector('button');
    setBusy(btn, true, '…جارٍ الحفظ');
    try {
      await call('changePassword', { old_password: d.old_password, new_password: d.new_password });
      toast('تم تغيير كلمة المرور.', 'success');
      onDone && onDone();
    } catch (err) {
      setBusy(btn, false);
      status.innerHTML = errorBox(err.message);
    }
  });
}
