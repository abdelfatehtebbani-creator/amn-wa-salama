// الإعدادات (للإدارة): الفروع، الوظائف، المستخدمون.
import { call } from './api.js';
import { esc, $, $$, render, toast, setBusy, confirmDialog, errorBox, shortDate, TYPE_LABELS } from './ui.js';
import { t, backArrow } from './i18n.js';

const ACCESS = { admin: 'إدارة', user: 'مستخدم' };

export function renderSettings(user) {
  const app = render(`
    <section class="screen">
      <header class="screen-head">
        <a href="#/home" class="back" aria-label="${t('رجوع')}">${backArrow()}</a>
        <h1>⚙️ ${t('الإعدادات')}</h1>
      </header>

      <h2 class="section-title">${t('الفروع')}</h2>
      <div id="branches"><p class="muted">${t('…جارٍ التحميل')}</p></div>
      <form id="branch-form" class="inline-form">
        <input type="text" name="name" maxlength="120" placeholder="${t('اسم فرع جديد')}" required aria-label="${t('اسم فرع جديد')}">
        <button type="submit" class="btn primary">${t('إضافة')}</button>
      </form>

      <h2 class="section-title">${t('الوظائف')}</h2>
      <p class="muted small">${t('لكل وظيفة أنواع السجلات التي يستطيع صاحبها تسجيلها.')}</p>
      <div id="functions"><p class="muted">${t('…جارٍ التحميل')}</p></div>
      <details class="panel">
        <summary>➕ ${t('إضافة وظيفة')}</summary>
        <form id="function-form">
          <label class="field"><span>${t('اسم الوظيفة')}</span>
            <input type="text" name="name" maxlength="60" required placeholder="${t('مثلًا: مراقب الجودة')}"></label>
          <div class="field"><span>${t('يستطيع تسجيل')}</span><div class="type-checks"></div></div>
          <button type="submit" class="btn primary">${t('إضافة الوظيفة')}</button>
        </form>
      </details>

      <h2 class="section-title">${t('المستخدمون')}</h2>
      <div id="users"><p class="muted">${t('…جارٍ التحميل')}</p></div>
      <details class="panel">
        <summary>➕ ${t('إضافة مستخدم')}</summary>
        <form id="user-form">
          <label class="field"><span>${t('اسم الدخول (حروف إنجليزية صغيرة وأرقام)')}</span>
            <input type="text" name="username" required pattern="[a-z0-9._\\-]{3,40}" autocapitalize="off" autocomplete="off" dir="ltr"></label>
          <label class="field"><span>${t('الاسم الظاهر')}</span>
            <input type="text" name="display_name" maxlength="60" required></label>
          <div class="access-fields"></div>
          <label class="field"><span>${t('كلمة مرور مؤقتة (6 أحرف على الأقل)')}</span>
            <input type="text" name="password" minlength="6" required autocomplete="off" dir="ltr"></label>
          <p class="muted">${t('سيُطلب من المستخدم تغييرها عند أول دخول.')}</p>
          <button type="submit" class="btn primary">${t('إنشاء الحساب')}</button>
        </form>
      </details>
    </section>`);

  const ctx = { user, roles: [], users: [], branches: [], types: [] };
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
      toast(t('تمت إضافة الفرع.'), 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  $('#function-form', app).addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    setBusy(btn, true);
    try {
      applyRoles(ctx, await call('saveRole', { name: form.elements.name.value.trim(), can_create: checkedTypes(form) }));
      form.reset();
      form.closest('details').open = false;
      toast(t('تمت إضافة الوظيفة.'), 'success');
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
      drawAccessFields(ctx, $('.access-fields', form));
      form.closest('details').open = false;
      drawUsers(ctx);
      toast(t('تم إنشاء الحساب.'), 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });
}

// ---------- الفروع ----------

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
          <span>${esc(b.name)}${b.active ? '' : ` <small class="muted">${t('(موقوف)')}</small>`}</span>
          <button type="button" class="btn small secondary" data-toggle="${esc(b.branch_id)}">${b.active ? t('إيقاف') : t('تفعيل')}</button>
        </li>`).join('')}</ul>`
    : `<p class="muted">${t('لا توجد فروع بعد. أضف أول فرع أدناه.')}</p>`;
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

// ---------- الوظائف ----------

/** الوظائف العادية فقط (دور «الإدارة» الداخلي لا يظهر كوظيفة). */
function functions(ctx) { return ctx.roles.filter(r => !r.is_admin); }

function typeChecks(ctx, selected = []) {
  return ctx.types.map(type => `
    <label class="check inline-check"><input type="checkbox" name="can_create" value="${type.type}" ${selected.includes(type.type) ? 'checked' : ''}> ${esc(TYPE_LABELS[type.type] || type.label)}</label>`).join('');
}

function checkedTypes(form) {
  return $$('input[name="can_create"]:checked', form).map(i => i.value);
}

function applyRoles(ctx, data) {
  ctx.roles = data.roles;
  ctx.types = data.record_types;
  drawFunctions(ctx);
  const checks = document.querySelector('#function-form .type-checks');
  if (checks) checks.innerHTML = typeChecks(ctx);
  const fields = document.querySelector('#user-form .access-fields');
  if (fields) drawAccessFields(ctx, fields);
}

function drawFunctions(ctx) {
  const box = document.getElementById('functions');
  if (!box) return;
  const list = functions(ctx);
  box.innerHTML = list.length
    ? `<ul class="list">${list.map(r => `
        <li>
          <div><strong>${esc(t(r.name))}</strong><br>
            <small class="muted">${r.can_create.map(type => esc(TYPE_LABELS[type] || type)).join(' · ')}</small></div>
          <button type="button" class="btn small secondary" data-edit-role="${esc(r.role_id)}">${t('تعديل')}</button>
        </li>`).join('')}</ul>`
    : `<p class="muted">${t('لا توجد وظائف بعد.')}</p>`;
  $$('[data-edit-role]', box).forEach(btn => btn.addEventListener('click', () => {
    const r = ctx.roles.find(x => x.role_id === btn.dataset.editRole);
    const li = btn.closest('li');
    li.innerHTML = `
      <form class="edit-inline">
        <input type="text" name="name" value="${esc(r.name)}" maxlength="60" required aria-label="${t('اسم الوظيفة')}">
        <div class="type-checks">${typeChecks(ctx, r.can_create)}</div>
        <div class="user-actions">
          <button type="button" class="btn small secondary" data-cancel>${t('إلغاء')}</button>
          <button type="submit" class="btn small primary">${t('حفظ')}</button>
        </div>
      </form>`;
    const form = $('form', li);
    $('[data-cancel]', form).addEventListener('click', () => drawFunctions(ctx));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const save = form.querySelector('[type=submit]');
      setBusy(save, true);
      try {
        applyRoles(ctx, await call('saveRole', { role_id: r.role_id, name: form.elements.name.value.trim(), can_create: checkedTypes(form) }));
        drawUsers(ctx);
        toast(t('تم حفظ الوظيفة.'), 'success');
      } catch (err) {
        setBusy(save, false);
        toast(err.message, 'error');
      }
    });
  }));
}

// ---------- المستخدمون ----------

/** حقلا «الصلاحية» و«الوظيفة». الوظيفة إلزامية للمستخدم واختيارية للإدارة. */
function drawAccessFields(ctx, box, current = { access: 'user', role: '' }) {
  const list = functions(ctx);
  box.innerHTML = `
    <label class="field"><span>${t('الصلاحية')}</span>
      <select name="access">
        <option value="user" ${current.access === 'user' ? 'selected' : ''}>${t('مستخدم: يسجّل فقط')}</option>
        <option value="admin" ${current.access === 'admin' ? 'selected' : ''}>${t('إدارة: الأرشيف والإعدادات وكل الأنواع')}</option>
      </select></label>
    <label class="field"><span>${t('الوظيفة')} <small data-optional hidden>${t('(اختيارية للإدارة)')}</small></span>
      <select name="role">
        <option value="" data-none>${t('— بدون وظيفة —')}</option>
        ${list.map(r => `<option value="${esc(r.role_id)}" ${r.role_id === current.role ? 'selected' : ''}>${esc(t(r.name))}</option>`).join('')}
      </select></label>`;
  const access = $('select[name="access"]', box);
  const sync = () => {
    const isAdmin = access.value === 'admin';
    $('[data-optional]', box).hidden = !isAdmin;
    $('[data-none]', box).hidden = !isAdmin;
    const role = $('select[name="role"]', box);
    role.required = !isAdmin;
    if (!isAdmin && !role.value && list[0]) role.value = list[0].role_id;
  };
  access.addEventListener('change', sync);
  sync();
}

async function loadUsers(ctx) {
  const box = document.getElementById('users');
  try {
    const [rolesData, usersData] = await Promise.all([call('roles'), call('users')]);
    ctx.users = usersData.users;
    applyRoles(ctx, rolesData);
    drawUsers(ctx);
  } catch (err) {
    if (box) box.innerHTML = errorBox(err.message);
  }
}

function userLabel(u) {
  return [ACCESS[u.access] ? t(ACCESS[u.access]) : u.access, t(u.role_name || '')].filter(Boolean).join(' · ');
}

function drawUsers(ctx) {
  const box = document.getElementById('users');
  if (!box) return;
  box.innerHTML = `<ul class="list users">${ctx.users.map(u => `
    <li class="${u.active ? '' : 'inactive'}" data-user="${esc(u.username)}">
      <div>
        <strong>${esc(u.display_name)}</strong> <span class="muted" dir="ltr">${esc(u.username)}</span><br>
        <small class="muted">${esc(userLabel(u))}
          ${u.active ? '' : ' · ' + t('موقوف')}${u.locked ? ' · ' + t('مقفل مؤقتًا') : ''}
          ${u.last_login_at ? ' · ' + t('آخر دخول {date}', { date: esc(shortDate(u.last_login_at)) }) : ''}</small>
      </div>
      ${u.username === ctx.user.username ? `<small class="muted">${t('(أنت)')}</small>` : `
      <div class="user-actions">
        <button type="button" class="btn small secondary" data-act="edit" data-u="${esc(u.username)}">${t('تعديل')}</button>
        <button type="button" class="btn small secondary" data-act="reset" data-u="${esc(u.username)}">${t('كلمة مرور جديدة')}</button>
        <button type="button" class="btn small secondary" data-act="sessions" data-u="${esc(u.username)}">${t('إنهاء الجلسات')}</button>
        <button type="button" class="btn small ${u.active ? 'danger' : 'secondary'}" data-act="active" data-u="${esc(u.username)}">${u.active ? t('إيقاف') : t('تفعيل')}</button>
      </div>`}
    </li>`).join('')}</ul>`;

  $$('[data-act]', box).forEach(btn => btn.addEventListener('click', async () => {
    const u = ctx.users.find(x => x.username === btn.dataset.u);
    try {
      if (btn.dataset.act === 'edit') {
        editUser(ctx, btn.closest('li'), u);
        return;
      }
      if (btn.dataset.act === 'reset') {
        const pw = window.prompt(t('كلمة مرور مؤقتة جديدة لـ «{name}» (6 أحرف على الأقل):', { name: u.display_name }));
        if (!pw) return;
        setBusy(btn, true);
        await call('resetPassword', { username: u.username, password: pw });
        toast(t('تم تعيين كلمة المرور. سيُطلب منه تغييرها عند الدخول.'), 'success');
      }
      if (btn.dataset.act === 'sessions') {
        if (!(await confirmDialog(t('تسجيل خروج «{name}» من كل الأجهزة؟', { name: u.display_name })))) return;
        setBusy(btn, true);
        const res = await call('revokeSessions', { username: u.username });
        toast(t('تم إنهاء {n} جلسة.', { n: res.sessions_ended }), 'success');
      }
      if (btn.dataset.act === 'active') {
        if (u.active && !(await confirmDialog(t('إيقاف حساب «{name}»؟ لن يتمكن من الدخول.', { name: u.display_name })))) return;
        setBusy(btn, true);
        ctx.users = (await call('saveUser', { ...userPayload(ctx, u), active: !u.active })).users;
        drawUsers(ctx);
        return;
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(btn, false);
  }));
}

/** بيانات التعديل: وظيفة الإدارة الداخلية لا تُرسل كوظيفة. */
function userPayload(ctx, u) {
  const isFunction = functions(ctx).some(r => r.role_id === u.role);
  return {
    username: u.username, display_name: u.display_name, access: u.access,
    role: isFunction ? u.role : '', active: u.active, existing: true
  };
}

function editUser(ctx, li, u) {
  const base = userPayload(ctx, u);
  li.innerHTML = `
    <form class="edit-inline">
      <label class="field"><span>${t('الاسم الظاهر')}</span>
        <input type="text" name="display_name" value="${esc(u.display_name)}" maxlength="60" required></label>
      <div class="access-fields"></div>
      <div class="user-actions">
        <button type="button" class="btn small secondary" data-cancel>${t('إلغاء')}</button>
        <button type="submit" class="btn small primary">${t('حفظ')}</button>
      </div>
    </form>`;
  const form = $('form', li);
  drawAccessFields(ctx, $('.access-fields', form), base);
  $('[data-cancel]', form).addEventListener('click', () => drawUsers(ctx));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form).entries());
    const save = form.querySelector('[type=submit]');
    setBusy(save, true);
    try {
      ctx.users = (await call('saveUser', { ...base, ...d })).users;
      drawUsers(ctx);
      toast(t('تم حفظ التعديل. سيُطلب من المستخدم الدخول من جديد إن تغيّرت صلاحيته أو وظيفته.'), 'success');
    } catch (err) {
      setBusy(save, false);
      toast(err.message, 'error');
    }
  });
}

/** تغيير كلمة المرور الخاصة (لكل المستخدمين). */
export function renderPassword(user, { forced = false, onDone } = {}) {
  const app = render(`
    <section class="screen narrow">
      <header class="screen-head">
        ${forced ? '' : `<a href="#/home" class="back" aria-label="${t('رجوع')}">${backArrow()}</a>`}
        <h1>🔑 ${t('تغيير كلمة المرور')}</h1>
      </header>
      ${forced ? `<div class="alert info">${esc(t('مرحبًا {name}. اختر كلمة مرور خاصة بك بدل كلمة المرور المؤقتة.', { name: user.display_name }))}</div>` : ''}
      <form id="pw-form">
        <label class="field"><span>${t('كلمة المرور الحالية')}</span>
          <input type="password" name="old_password" required autocomplete="current-password"></label>
        <label class="field"><span>${t('كلمة المرور الجديدة (6 أحرف على الأقل)')}</span>
          <input type="password" name="new_password" minlength="6" required autocomplete="new-password"></label>
        <label class="field"><span>${t('تأكيد كلمة المرور الجديدة')}</span>
          <input type="password" name="confirm" minlength="6" required autocomplete="new-password"></label>
        <div id="pw-status"></div>
        <button type="submit" class="btn primary big">${t('حفظ')}</button>
      </form>
    </section>`);
  $('#pw-form', app).addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    const status = $('#pw-status', app);
    if (d.new_password !== d.confirm) {
      status.innerHTML = errorBox(t('كلمتا المرور غير متطابقتين.'));
      return;
    }
    const btn = e.target.querySelector('button');
    setBusy(btn, true, t('…جارٍ الحفظ'));
    try {
      await call('changePassword', { old_password: d.old_password, new_password: d.new_password });
      toast(t('تم تغيير كلمة المرور.'), 'success');
      onDone && onDone();
    } catch (err) {
      setBusy(btn, false);
      status.innerHTML = errorBox(err.message);
    }
  });
}
