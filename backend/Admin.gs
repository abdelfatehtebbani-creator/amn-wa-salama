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

function listRoles_() {
  return {
    roles: readAll_('Roles').map(r => ({
      role_id: r.role_id, name: r.name, is_admin: bool_(r.is_admin),
      can_create: String(r.can_create || '').split(',').map(s => s.trim()).filter(Boolean)
    })),
    record_types: Object.keys(RECORD_TYPES).map(k => ({ type: k, label: RECORD_TYPES[k].label }))
  };
}

function listUsers_() {
  return {
    users: readAll_('Users').map(u => ({
      username: u.username, display_name: u.display_name, role: u.role, active: bool_(u.active),
      must_change: bool_(u.must_change), last_login_at: u.last_login_at,
      locked: !!(u.locked_until && u.locked_until > nowStr_())
    }))
  };
}

/**
 * إنشاء مستخدم أو تعديله.
 * إنشاء: { username, display_name, role, password }
 * تعديل: { username, display_name, role, active, existing: true }
 */
function saveUser_(ctx, p) {
  const username = normalizeUsername_(p.username);
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw appError_('INVALID', 'اسم المستخدم: 3 أحرف على الأقل، حروف إنجليزية صغيرة وأرقام فقط.');
  }
  const displayName = text_(p.display_name, 60) || username;
  getRole_(p.role);
  const existing = findOne_('Users', 'username', username);

  if (p.existing) {
    if (!existing) throw appError_('NOT_FOUND', 'المستخدم غير موجود.');
    const active = p.active !== false;
    if (username === ctx.username && (!active || p.role !== existing.role)) {
      throw appError_('INVALID', 'لا يمكنك إيقاف حسابك أو تغيير دورك بنفسك.');
    }
    updateObj_('Users', existing._row, { display_name: displayName, role: p.role, active: active });
    if (!active || p.role !== existing.role) revokeUserSessions_(username);
    audit_(ctx.username, 'user_update', '', { username: username, role: p.role, active: active });
  } else {
    if (existing) throw appError_('INVALID', 'اسم المستخدم مستخدم من قبل.');
    validatePassword_(p.password);
    appendObj_('Users', Object.assign({
      username: username, display_name: displayName, role: p.role, active: true, must_change: true,
      failed_attempts: 0, locked_until: '', created_at: nowStr_(), last_login_at: ''
    }, setPasswordFields_(p.password)));
    audit_(ctx.username, 'user_add', '', { username: username, role: p.role });
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
