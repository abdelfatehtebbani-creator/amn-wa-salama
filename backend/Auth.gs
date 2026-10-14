/**
 * تسجيل الدخول والخروج والجلسات وكلمات المرور والأدوار.
 */

function hashPassword_(password, salt) {
  const alg = Utilities.DigestAlgorithm.SHA_256;
  let bytes = Utilities.computeDigest(alg, salt + ':' + prop_('PEPPER') + ':' + password, Utilities.Charset.UTF_8);
  for (let i = 0; i < HASH_ITERATIONS; i++) bytes = Utilities.computeDigest(alg, bytes);
  return toHex_(bytes);
}

function normalizeUsername_(u) {
  return text_(u, 40).toLowerCase();
}

function validatePassword_(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
    throw appError_('INVALID', 'كلمة المرور يجب أن تكون ' + MIN_PASSWORD_LENGTH + ' أحرف على الأقل.');
  }
  if (pw.length > 100) throw appError_('INVALID', 'كلمة المرور طويلة جدًا.');
}

function setPasswordFields_(password) {
  const salt = Utilities.getUuid();
  return { salt: salt, password_hash: hashPassword_(password, salt) };
}

function getRole_(roleId) {
  const role = findOne_('Roles', 'role_id', roleId);
  if (!role) throw appError_('FORBIDDEN', 'دور المستخدم غير معرّف. راجع الإدارة.');
  return role;
}

/** يبني «سياق المستخدم» الذي تعتمد عليه كل فحوص الصلاحيات. */
/** الصلاحية: من عمود access، أو من الدور في البيانات القديمة قبل إضافة العمود. */
function userAccess_(user, role) {
  if (user.access === 'admin' || user.access === 'user') return user.access;
  return bool_(role.is_admin) ? 'admin' : 'user';
}

function buildContext_(user) {
  const role = getRole_(user.role);
  const access = userAccess_(user, role);
  const isAdmin = access === 'admin';
  const canCreate = isAdmin
    ? Object.keys(RECORD_TYPES)
    : String(role.can_create || '').split(',').map(s => s.trim()).filter(t => RECORD_TYPES[t]);
  return {
    username: user.username,
    display_name: user.display_name || user.username,
    role_id: role.role_id,
    role_name: role.name,
    function_name: bool_(role.is_admin) ? '' : role.name,
    access: access,
    access_name: ACCESS_LEVELS[access],
    is_admin: isAdmin,
    can_create: canCreate,
    must_change: bool_(user.must_change)
  };
}

function publicUser_(ctx) {
  return {
    username: ctx.username, display_name: ctx.display_name, role_id: ctx.role_id,
    role_name: ctx.role_name, function_name: ctx.function_name, access: ctx.access, access_name: ctx.access_name,
    is_admin: ctx.is_admin, can_create: ctx.can_create,
    must_change: ctx.must_change
  };
}

function sessionCacheKey_(tokenHash) { return 'sess:' + tokenHash; }

/** يتحقق من رمز الجلسة ويعيد سياق المستخدم، أو يرمي خطأ AUTH. */
function requireSession_(token) {
  if (!token || typeof token !== 'string' || token.length > 100) {
    throw appError_('AUTH', 'يجب تسجيل الدخول.');
  }
  const tokenHash = sha256Hex_(token);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(sessionCacheKey_(tokenHash));
  if (cached) {
    const c = JSON.parse(cached);
    if (c.expires_at > nowStr_()) return c.ctx;
  }
  const session = findOne_('Sessions', 'token_hash', tokenHash);
  if (!session || session.expires_at <= nowStr_()) {
    throw appError_('AUTH', 'انتهت الجلسة. سجّل الدخول من جديد.');
  }
  const user = findOne_('Users', 'username', session.username);
  if (!user || !bool_(user.active)) throw appError_('AUTH', 'الحساب غير مفعّل.');
  const ctx = buildContext_(user);
  ctx.token_hash = tokenHash;
  cache.put(sessionCacheKey_(tokenHash), JSON.stringify({ ctx: ctx, expires_at: session.expires_at }), SESSION_CACHE_SECONDS);
  return ctx;
}

function login_(ctx, p) {
  const username = normalizeUsername_(p.username);
  const password = typeof p.password === 'string' ? p.password : '';
  const generic = 'اسم المستخدم أو كلمة المرور غير صحيحة.';
  const user = username ? findOne_('Users', 'username', username) : null;
  if (!user || !bool_(user.active)) throw appError_('LOGIN_FAILED', generic);

  const now = nowStr_();
  if (user.locked_until && user.locked_until > now) {
    const mins = Math.max(1, Math.ceil((parseDate_(user.locked_until) - new Date()) / 60000));
    throw appError_('LOCKED', 'تم إيقاف الحساب مؤقتًا بسبب محاولات خاطئة. حاول بعد ' + mins + ' دقيقة.');
  }

  if (hashPassword_(password, user.salt) !== user.password_hash) {
    const attempts = num_(user.failed_attempts) + 1;
    const patch = { failed_attempts: attempts };
    if (attempts >= MAX_FAILED_LOGINS) {
      patch.failed_attempts = 0;
      patch.locked_until = fmtDate_(new Date(Date.now() + LOCK_MINUTES * 60000));
    }
    updateObj_('Users', user._row, patch);
    audit_(username, 'login_failed', '', null);
    throw appError_('LOGIN_FAILED', generic);
  }

  updateObj_('Users', user._row, { failed_attempts: 0, locked_until: '', last_login_at: now });
  const remember = p.remember === true;
  const ms = remember ? SESSION_DAYS_REMEMBER * 86400000 : SESSION_HOURS_SHORT * 3600000;
  const token = randomToken_();
  const expiresAt = fmtDate_(new Date(Date.now() + ms));
  appendObj_('Sessions', {
    token_hash: sha256Hex_(token), username: username, created_at: now,
    expires_at: expiresAt, remember: remember, device_hint: text_(p.device_hint, 120)
  });
  audit_(username, 'login', '', { remember: remember });
  return { token: token, expires_at: expiresAt, remember: remember, user: publicUser_(buildContext_(user)) };
}

function logout_(ctx) {
  const session = findOne_('Sessions', 'token_hash', ctx.token_hash);
  if (session) deleteRows_('Sessions', [session._row]);
  CacheService.getScriptCache().remove(sessionCacheKey_(ctx.token_hash));
  audit_(ctx.username, 'logout', '', null);
  return { done: true };
}

/** يحذف كل جلسات مستخدم (مثلًا عند ضياع الهاتف أو تغيير كلمة المرور). */
function revokeUserSessions_(username, exceptTokenHash) {
  const sessions = findAll_('Sessions', 'username', username)
    .filter(s => s.token_hash !== exceptTokenHash);
  const cache = CacheService.getScriptCache();
  sessions.forEach(s => cache.remove(sessionCacheKey_(s.token_hash)));
  deleteRows_('Sessions', sessions.map(s => s._row));
  return sessions.length;
}

function changeOwnPassword_(ctx, p) {
  const user = findOne_('Users', 'username', ctx.username);
  if (hashPassword_(String(p.old_password || ''), user.salt) !== user.password_hash) {
    throw appError_('INVALID', 'كلمة المرور الحالية غير صحيحة.');
  }
  validatePassword_(p.new_password);
  if (p.new_password === p.old_password) throw appError_('INVALID', 'اختر كلمة مرور مختلفة عن الحالية.');
  updateObj_('Users', user._row, Object.assign(setPasswordFields_(p.new_password), { must_change: false }));
  revokeUserSessions_(ctx.username, ctx.token_hash);
  CacheService.getScriptCache().remove(sessionCacheKey_(ctx.token_hash));
  audit_(ctx.username, 'change_password', '', null);
  return { done: true };
}
