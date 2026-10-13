/**
 * الإعداد الأول. شغّل setup() مرة واحدة من محرر Apps Script.
 * آمنة للتكرار: لا تنشئ مجلدات أو أوراق أو حسابات موجودة من قبل.
 *
 * تنشئ:
 *  - المجلد الرئيسي في Drive والمجلدات الفرعية لكل نوع ومجلد _System
 *  - ملف Sheets بكل الأوراق والأعمدة
 *  - السر العام لتجزئة كلمات المرور (في Script Properties)
 *  - دوري «الإدارة» و«الحارس»
 *  - حسابي admin وguard بكلمات مرور مؤقتة تظهر في سجل التنفيذ (Execution log)
 *  - مشغّل التنظيف اليومي
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PEPPER')) props.setProperty('PEPPER', randomToken_());

  // المجلدات
  let root = folderFromProp_(props, 'ROOT_FOLDER_ID');
  if (!root) {
    root = DriveApp.createFolder(ROOT_FOLDER_NAME);
    props.setProperty('ROOT_FOLDER_ID', root.getId());
  }
  Object.keys(RECORD_TYPES).forEach(type => {
    if (!folderFromProp_(props, 'FOLDER_' + type)) {
      props.setProperty('FOLDER_' + type, childFolder_(root, RECORD_TYPES[type].folder).getId());
    }
  });
  const systemFolder = childFolder_(root, SYSTEM_FOLDER_NAME);

  // قاعدة البيانات
  let ss = null;
  const ssId = props.getProperty('SPREADSHEET_ID');
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(systemFolder);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  spreadsheet_ = ss;

  Object.keys(SCHEMA).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const cols = SCHEMA[name].length;
    sh.getRange(1, 1, 1, cols).setValues([SCHEMA[name]]).setFontWeight('bold').setBackground('#e8eef5');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols).setNumberFormat('@');
    sh.setRightToLeft(true);
  });
  const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('ورقة1');
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);

  // الأدوار
  if (!readAll_('Roles').length) {
    appendObj_('Roles', { role_id: 'admin', name: 'الإدارة', can_create: 'IN,OUT,INC', is_admin: true, notes: 'كل الصلاحيات' });
    appendObj_('Roles', { role_id: 'guard', name: 'الحارس', can_create: 'IN,OUT,INC', is_admin: false, notes: 'تسجيل السجلات ورفع الصور' });
  }

  // الحسابات المبدئية
  const created = [];
  if (!readAll_('Users').length) {
    [['admin', 'الإدارة', 'admin'], ['guard', 'الحارس', 'guard']].forEach(u => {
      const password = tempPassword_();
      appendObj_('Users', Object.assign({
        username: u[0], display_name: u[1], role: u[2], active: true, must_change: true,
        failed_attempts: 0, locked_until: '', created_at: nowStr_(), last_login_at: ''
      }, setPasswordFields_(password)));
      created.push(u[0] + '  /  ' + password);
    });
  }

  // مشغّل التنظيف اليومي
  const hasTrigger = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailyCleanup');
  if (!hasTrigger) ScriptApp.newTrigger('dailyCleanup').timeBased().everyDays(1).atHour(3).create();

  console.log('تم الإعداد بنجاح.');
  console.log('المجلد الرئيسي: ' + root.getUrl());
  console.log('قاعدة البيانات: ' + ss.getUrl());
  if (created.length) {
    console.log('الحسابات المبدئية (اسم المستخدم / كلمة المرور المؤقتة) — احفظها الآن، لن تظهر مرة أخرى:');
    created.forEach(line => console.log('  ' + line));
  }
}

/**
 * للطوارئ: إذا نُسيت كلمة مرور حساب الإدارة.
 * غيّر اسم المستخدم أدناه إن لزم، ثم شغّل الدالة واقرأ كلمة المرور المؤقتة من سجل التنفيذ.
 */
function emergencyResetAdminPassword() {
  const username = 'admin';
  withLock_(() => {
    const user = findOne_('Users', 'username', username);
    if (!user) throw new Error('المستخدم غير موجود: ' + username);
    const password = tempPassword_();
    updateObj_('Users', user._row, Object.assign(setPasswordFields_(password), {
      must_change: true, failed_attempts: 0, locked_until: '', active: true
    }));
    revokeUserSessions_(username);
    audit_('system', 'emergency_reset', '', { username: username });
    console.log('كلمة المرور المؤقتة الجديدة لـ ' + username + ': ' + password);
  });
}

function folderFromProp_(props, key) {
  const id = props.getProperty(key);
  if (!id) return null;
  try {
    const f = DriveApp.getFolderById(id);
    return f.isTrashed() ? null : f;
  } catch (e) {
    return null;
  }
}

function tempPassword_() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid());
  let out = '';
  for (let i = 0; i < 10; i++) out += chars.charAt((bytes[i] + 256) % chars.length);
  return out;
}
