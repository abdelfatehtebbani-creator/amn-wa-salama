/**
 * نقطة الدخول الوحيدة للتطبيق.
 * الواجهة ترسل POST بنص JSON: { action, token, params }
 * والخادم يرد دائمًا بـ { ok: true, data } أو { ok: false, error, message }.
 */

/**
 * auth: يتطلب جلسة صالحة. admin: للإدارة فقط. write: يُنفَّذ تحت القفل.
 */
const ACTIONS = {
  login:            { fn: login_, auth: false, write: true },
  logout:           { fn: logout_, auth: true, write: true },
  me:               { fn: ctx => ({ user: publicUser_(ctx) }), auth: true },
  changePassword:   { fn: changeOwnPassword_, auth: true, write: true },

  branches:         { fn: listBranches_, auth: true },
  suppliers:        { fn: supplierSuggestions_, auth: true },
  uploadImage:      { fn: uploadImage_, auth: true, write: true },
  createRecord:     { fn: createRecord_, auth: true, write: true },
  myToday:          { fn: myToday_, auth: true },

  search:           { fn: searchRecords_, auth: true, admin: true },
  getRecord:        { fn: getRecord_, auth: true, admin: true },
  getImage:         { fn: getImage_, auth: true, admin: true, write: true },
  updateRecord:     { fn: updateRecord_, auth: true, admin: true, write: true },
  deleteRecord:     { fn: (ctx, p) => setRecordStatus_(ctx, p, 'deleted'), auth: true, admin: true, write: true },
  restoreRecord:    { fn: (ctx, p) => setRecordStatus_(ctx, p, 'active'), auth: true, admin: true, write: true },

  saveBranch:       { fn: saveBranch_, auth: true, admin: true, write: true },
  roles:            { fn: listRoles_, auth: true, admin: true, write: true },
  saveRole:         { fn: saveRole_, auth: true, admin: true, write: true },
  users:            { fn: listUsers_, auth: true, admin: true },
  saveUser:         { fn: saveUser_, auth: true, admin: true, write: true },
  resetPassword:    { fn: resetPassword_, auth: true, admin: true, write: true },
  revokeSessions:   { fn: revokeSessions_, auth: true, admin: true, write: true }
};

/** إجراءات مسموحة حتى لو وجب على المستخدم تغيير كلمة المرور المؤقتة. */
const ALLOWED_WHEN_MUST_CHANGE = ['logout', 'me', 'changePassword'];

function doPost(e) {
  let out;
  try {
    let req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (err) {
      throw appError_('BAD_REQUEST', 'طلب غير صالح.');
    }
    const def = Object.prototype.hasOwnProperty.call(ACTIONS, req.action) ? ACTIONS[req.action] : null;
    if (!def) throw appError_('BAD_REQUEST', 'إجراء غير معروف.');
    const params = req.params && typeof req.params === 'object' ? req.params : {};

    const run = () => {
      const ctx = def.auth ? requireSession_(req.token) : null;
      if (ctx && ctx.must_change && ALLOWED_WHEN_MUST_CHANGE.indexOf(req.action) < 0) {
        throw appError_('MUST_CHANGE_PASSWORD', 'يجب تغيير كلمة المرور المؤقتة أولًا.');
      }
      if (def.admin && !ctx.is_admin) throw appError_('FORBIDDEN', 'ليست لديك صلاحية لهذه العملية.');
      return def.fn(ctx, params);
    };
    out = { ok: true, data: def.write ? withLock_(run) : run() };
  } catch (err) {
    out = errorPayload_(err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** للتأكد من أن الخادم يعمل عند فتح الرابط في المتصفح. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: APP_NAME }))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorPayload_(err) {
  if (err && err.code) {
    return { ok: false, error: err.code, message: err.message, extra: err.extra || undefined };
  }
  console.error(err && err.stack ? err.stack : err);
  return { ok: false, error: 'SERVER', message: 'حدث خطأ في الخادم. أعد المحاولة، وإن تكرر أبلغ الإدارة.' };
}
