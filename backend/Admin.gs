/**
 * إدارة الفروع والمستخدمين والأدوار (للإدارة فقط، عدا قائمة الفروع المفعّلة).
 */

function listBranches_(ctx, p) {
  const all = readAll_('Branches').sort((a, b) => num_(a.sort_order) - num_(b.sort_order) || a.name.localeCompare(b.name, 'ar'));
  const showAll = ctx.is_admin && p.all === true;
  return {
    branches: all.filter(b => showAll || bool_(b.active))
      .map(b => ({ branch_id: b.branch_id, name: b.name, active: bool_(b.active), sort_order: num_(b.sort_order) }))
  };
}

/** p: { branch_id? , name, active, sort_order } */
function saveBranch_(ctx, p) {
  const name = text_(p.name, FIELD_LIMITS.branch);
  if (!name) throw appError_('INVALID', 'اكتب اسم الفرع.');
  const all = readAll_('Branches');
  const dup = all.filter(b => b.name === name && b.branch_id !== p.branch_id)[0];
  if (dup) throw appError_('INVALID', 'يوجد فرع بنفس الاسم.');

  if (p.branch_id) {
    const branch = all.filter(b => b.branch_id === p.branch_id)[0];
    if (!branch) throw appError_('NOT_FOUND', 'الفرع غير موجود.');
    if (branch.name !== name) {
      throw appError_('INVALID', 'لا يمكن تغيير اسم فرع مستخدم في السجلات. أوقف الفرع القديم وأضف فرعًا جديدًا.');
    }
    updateObj_('Branches', branch._row, { active: p.active !== false, sort_order: Math.floor(num_(p.sort_order)) });
    audit_(ctx.username, 'branch_update', '', { name: name, active: p.active !== false });
  } else {
    appendObj_('Branches', {
      branch_id: 'B' + Utilities.getUuid().slice(0, 8), name: name, active: true,
      sort_order: Math.floor(num_(p.sort_order)) || all.length + 1
    });
    audit_(ctx.username, 'branch_add', '', { name: name });
  }
  return listBranches_(ctx, { all: true });
}

/** الوظائف الافتراضية تُضاف تلقائيًا إن لم تكن موجودة. */
const DEFAULT_FUNCTIONS = [
  { role_id: 'guard', name: 'حارس', can_create: 'IN,OUT,INC', notes: 'البضائع الداخلة والخارجة والمخالفات' },
  { role_id: 'food_safety', name: 'سلامة الغذاء', can_create: 'INC', notes: 'تصوير المخالفات' }
];

function ensureDefaultFunctions_() {
  const ids = readAll_('Roles').map(r => r.role_id);
  DEFAULT_FUNCTIONS.forEach(f => {
    if (ids.indexOf(f.role_id) < 0) appendObj_('Roles', Object.assign({ is_admin: false }, f));
  });
}

function splitTypes_(v) {
  return String(v || '').split(',').map(s => s.trim()).filter(t => RECORD_TYPES[t]);
}

/** الوظائف (حارس، سلامة الغذاء...) وما يستطيع كل منها تسجيله. */
function listRoles_() {
  ensureDefaultFunctions_();
  return {
    roles: readAll_('Roles').map(r => ({
      role_id: r.role_id, name: r.name, is_admin: bool_(r.is_admin), can_create: splitTypes_(r.can_create)
    })),
    record_types: Object.keys(RECORD_TYPES).map(k => ({ type: k, label: RECORD_TYPES[k].label })),
    access_levels: Object.keys(ACCESS_LEVELS).map(k => ({ access: k, label: ACCESS_LEVELS[k] }))
  };
}

/** إضافة وظيفة أو تعديل ما تستطيع تسجيله. p: { role_id?, name, can_create: ['IN', ...] } */
function saveRole_(ctx, p) {
  const name = text_(p.name, 60);
  if (!name) throw appError_('INVALID', 'اكتب اسم الوظيفة.');
  const types = (Array.isArray(p.can_create) ? p.can_create : []).filter(t => RECORD_TYPES[t]);
  if (!types.length) throw appError_('INVALID', 'اختر نوعًا واحدًا على الأقل من السجلات.');
  const all = readAll_('Roles');
  if (all.some(r => r.name === name && r.role_id !== p.role_id)) throw appError_('INVALID', 'توجد وظيفة بنفس الاسم.');

  if (p.role_id) {
    const role = all.filter(r => r.role_id === p.role_id)[0];
    if (!role) throw appError_('NOT_FOUND', 'الوظيفة غير موجودة.');
    if (bool_(role.is_admin)) throw appError_('INVALID', 'لا يمكن تعديل هذا الدور.');
    updateObj_('Roles', role._row, { name: name, can_create: types.join(',') });
    audit_(ctx.username, 'role_update', '', { role_id: role.role_id, name: name, can_create: types });
  } else {
    const roleId = 'R' + Utilities.getUuid().slice(0, 8);
    appendObj_('Roles', { role_id: roleId, name: name, can_create: types.join(','), is_admin: false, notes: '' });
    audit_(ctx.username, 'role_add', '', { role_id: roleId, name: name, can_create: types });
  }
  return listRoles_();
}

function publicUserRow_(u, rolesById) {
  const role = rolesById[u.role] || { is_admin: 'FALSE', name: u.role };
  const access = userAccess_(u, role);
  return {
    username: u.username, display_name: u.display_name, role: u.role,
    role_name: bool_(role.is_admin) ? '' : role.name,
    access: access, access_name: ACCESS_LEVELS[access], active: bool_(u.active),
    must_change: bool_(u.must_change), last_login_at: u.last_login_at,
    locked: !!(u.locked_until && u.locked_until > nowStr_())
  };
}

function listUsers_() {
  const rolesById = {};
  readAll_('Roles').forEach(r => { rolesById[r.role_id] = r; });
  return { users: readAll_('Users').map(u => publicUserRow_(u, rolesById)) };
}

/**
 * يتحقق من الصلاحية والوظيفة ويعيد قيمة عمود role المناسبة.
 * المستخدم يحتاج وظيفة عادية. الإدارة وظيفتها اختيارية، وبدونها تُربط بدور الإدارة.
 */
function resolveRole_(access, roleId) {
  if (!ACCESS_LEVELS[access]) throw appError_('INVALID', 'اختر الصلاحية: إدارة أو مستخدم.');
  const roles = readAll_('Roles');
  const role = roleId ? roles.filter(r => r.role_id === roleId)[0] : null;
  if (roleId && !role) throw appError_('INVALID', 'الوظيفة غير موجودة.');
  if (access === 'user') {
    if (!role || bool_(role.is_admin)) throw appError_('INVALID', 'اختر وظيفة المستخدم.');
    return role.role_id;
  }
  if (role) return role.role_id;
  const adminRole = roles.filter(r => bool_(r.is_admin))[0];
  if (!adminRole) throw appError_('SERVER', 'دور الإدارة غير موجود في ورقة Roles.');
  return adminRole.role_id;
}

/**
 * إنشاء مستخدم أو تعديله.
 * إنشاء: { username, display_name, access, role, password }
 * تعديل: { username, display_name, access, role, active, existing: true }
 */
function saveUser_(ctx, p) {
  const username = normalizeUsername_(p.username);
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw appError_('INVALID', 'اسم المستخدم: 3 أحرف على الأقل، حروف إنجليزية صغيرة وأرقام فقط.');
  }
  const displayName = text_(p.display_name, 60) || username;
  const access = p.access || 'user';
  const roleId = resolveRole_(access, p.role);
  const existing = findOne_('Users', 'username', username);

  if (p.existing) {
    if (!existing) throw appError_('NOT_FOUND', 'المستخدم غير موجود.');
    const active = p.active !== false;
    const currentAccess = userAccess_(existing, getRole_(existing.role));
    if (username === ctx.username && (!active || access !== currentAccess)) {
      throw appError_('INVALID', 'لا يمكنك إيقاف حسابك أو تغيير صلاحيتك بنفسك.');
    }
    updateObj_('Users', existing._row, { display_name: displayName, role: roleId, access: access, active: active });
    if (!active || roleId !== existing.role || access !== currentAccess) revokeUserSessions_(username);
    audit_(ctx.username, 'user_update', '', { username: username, access: access, role: roleId, active: active });
  } else {
    if (existing) throw appError_('INVALID', 'اسم المستخدم مستخدم من قبل.');
    validatePassword_(p.password);
    appendObj_('Users', Object.assign({
      username: username, display_name: displayName, role: roleId, access: access, active: true, must_change: true,
      failed_attempts: 0, locked_until: '', created_at: nowStr_(), last_login_at: ''
    }, setPasswordFields_(p.password)));
    audit_(ctx.username, 'user_add', '', { username: username, access: access, role: roleId });
  }
  return listUsers_();
}

/** تعيين كلمة مرور مؤقتة لمستخدم وإنهاء كل جلساته. */
function resetPassword_(ctx, p) {
  const user = findOne_('Users', 'username', normalizeUsername_(p.username));
  if (!user) throw appError_('NOT_FOUND', 'المستخدم غير موجود.');
  validatePassword_(p.password);
  updateObj_('Users', user._row, Object.assign(setPasswordFields_(p.password), {
    must_change: true, failed_attempts: 0, locked_until: ''
  }));
  const revoked = revokeUserSessions_(user.username, user.username === ctx.username ? ctx.token_hash : null);
  audit_(ctx.username, 'password_reset', '', { username: user.username });
  return { done: true, sessions_ended: revoked };
}

/** إنهاء جلسات مستخدم (مثلًا عند ضياع الهاتف). */
function revokeSessions_(ctx, p) {
  const username = normalizeUsername_(p.username);
  const revoked = revokeUserSessions_(username, username === ctx.username ? ctx.token_hash : null);
  audit_(ctx.username, 'sessions_revoked', '', { username: username, count: revoked });
  return { sessions_ended: revoked };
}
