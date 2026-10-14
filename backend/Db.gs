/**
 * أدوات القراءة والكتابة في Google Sheets، والأقفال، والتواريخ، والأخطاء.
 */

let spreadsheet_ = null;

function prop_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw appError_('SERVER', 'التطبيق غير مُعدّ بعد. شغّل الدالة setup() من محرر Apps Script.');
  return value;
}

function db_() {
  if (!spreadsheet_) spreadsheet_ = SpreadsheetApp.openById(prop_('SPREADSHEET_ID'));
  return spreadsheet_;
}

const checkedHeaders_ = {};

function sheet_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw appError_('SERVER', 'ورقة مفقودة في قاعدة البيانات: ' + name);
  if (!checkedHeaders_[name]) {
    // أعمدة أُضيفت في إصدارات لاحقة تُكتب في صف العناوين تلقائيًا
    const cols = SCHEMA[name].length;
    const header = sh.getRange(1, 1, 1, cols).getValues()[0].map(String);
    if (header.join('|') !== SCHEMA[name].join('|')) sh.getRange(1, 1, 1, cols).setValues([SCHEMA[name]]);
    checkedHeaders_[name] = true;
  }
  return sh;
}

function rowToObj_(name, values, row) {
  const obj = { _row: row };
  SCHEMA[name].forEach((col, i) => { obj[col] = values[i] === null ? '' : String(values[i]); });
  return obj;
}

/** كل صفوف الورقة ككائنات. */
function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, SCHEMA[name].length).getValues();
  return values.map((v, i) => rowToObj_(name, v, i + 2));
}

/** آخر n صف فقط (السجلات تُضاف بالترتيب الزمني). */
function readLast_(name, n) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const first = Math.max(2, last - n + 1);
  const values = sh.getRange(first, 1, last - first + 1, SCHEMA[name].length).getValues();
  return values.map((v, i) => rowToObj_(name, v, first + i));
}

function readRow_(name, row) {
  const values = sheet_(name).getRange(row, 1, 1, SCHEMA[name].length).getValues()[0];
  return rowToObj_(name, values, row);
}

/** كل الصفوف التي يساوي فيها العمود col القيمة value تمامًا. */
function findAll_(name, col, value) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2 || value === '' || value === null || value === undefined) return [];
  const ci = SCHEMA[name].indexOf(col) + 1;
  if (ci < 1) throw new Error('Unknown column ' + col);
  const cells = sh.getRange(2, ci, last - 1, 1)
    .createTextFinder(String(value)).matchEntireCell(true).matchCase(true).findAll();
  return cells.map(c => readRow_(name, c.getRow()));
}

function findOne_(name, col, value) {
  return findAll_(name, col, value)[0] || null;
}

function cellValue_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const s = String(v);
  return s.charAt(0) === '=' ? "'" + s : s; // منع تفسير النص كمعادلة
}

function appendObj_(name, obj) {
  const sh = sheet_(name);
  const cols = SCHEMA[name].length;
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  const range = sh.getRange(row, 1, 1, cols);
  range.setNumberFormat('@');
  range.setValues([SCHEMA[name].map(c => cellValue_(obj[c]))]);
  return row;
}

/** يحدّث الأعمدة المذكورة في patch فقط. */
function updateObj_(name, row, patch) {
  const current = readRow_(name, row);
  const merged = Object.assign({}, current, patch);
  const range = sheet_(name).getRange(row, 1, 1, SCHEMA[name].length);
  range.setNumberFormat('@');
  range.setValues([SCHEMA[name].map(c => cellValue_(merged[c]))]);
  return merged;
}

function deleteRows_(name, rows) {
  const sh = sheet_(name);
  rows.slice().sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
}

function audit_(username, action, recordId, details) {
  appendObj_('AuditLog', {
    at: nowStr_(), username: username || '', action: action,
    record_id: recordId || '', details: details ? JSON.stringify(details) : ''
  });
}

/** ينفذ fn تحت قفل واحد للتطبيق، حتى لا تتداخل عمليات الكتابة. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw appError_('BUSY', 'الخادم مشغول الآن. أعد المحاولة بعد لحظات.');
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

// ---------- التواريخ ----------

function tz_() { return Session.getScriptTimeZone(); }

function fmtDate_(date) { return Utilities.formatDate(date, tz_(), DATE_FORMAT); }

function nowStr_() { return fmtDate_(new Date()); }

function parseDate_(str) {
  return Utilities.parseDate(String(str), tz_(), DATE_FORMAT);
}

/** يقبل 'yyyy-MM-ddTHH:mm' من حقل datetime-local. */
function parseLocalInput_(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(str || ''));
  if (!m) return null;
  return Utilities.parseDate(m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':00', tz_(), DATE_FORMAT);
}

// ---------- أدوات عامة ----------

function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function text_(v, maxLen) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLen || 200);
}

function toHex_(bytes) {
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function sha256Hex_(str) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8));
}

function randomToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function appError_(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  err.extra = extra || null;
  return err;
}
