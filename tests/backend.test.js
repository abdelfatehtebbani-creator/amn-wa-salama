// اختبارات الخادم على محاكاة Apps Script. التشغيل: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./gas-mock');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]).toString('base64');

function setup() {
  const env = createEnv();
  env.run('setup()');
  const creds = {};
  env.logs.forEach(line => {
    const m = /^\s+(\w+)\s+\/\s+(\w+)$/.exec(line);
    if (m) creds[m[1]] = m[2];
  });
  return { env, creds };
}

function ok(res) {
  assert.equal(res.ok, true, JSON.stringify(res));
  return res.data;
}

/** دخول وتغيير كلمة المرور المؤقتة، يعيد رمز جلسة صالحًا. */
function loginReady(env, username, tempPw, newPw = 'secret123') {
  let data = ok(env.post({ action: 'login', params: { username, password: tempPw, remember: true } }));
  assert.equal(data.user.must_change, true);
  const blocked = env.post({ action: 'search', token: data.token, params: {} });
  assert.equal(blocked.error, 'MUST_CHANGE_PASSWORD');
  ok(env.post({ action: 'changePassword', token: data.token, params: { old_password: tempPw, new_password: newPw } }));
  data = ok(env.post({ action: 'login', params: { username, password: newPw, remember: false } }));
  assert.equal(data.user.must_change, false);
  return data.token;
}

test('setup creates folders, sheets, roles and two users', () => {
  const { env, creds } = setup();
  assert.ok(env.props.SPREADSHEET_ID && env.props.FOLDER_IN && env.props.FOLDER_OUT && env.props.FOLDER_INC);
  assert.deepEqual(Object.keys(creds).sort(), ['admin', 'guard']);
  const users = env.sheet('Users');
  assert.equal(users.length, 3);
  assert.ok(!users.flat().includes(creds.admin), 'password must not be stored in plain text');
  // setup مرة ثانية لا يكرر شيئًا
  env.run('setup()');
  assert.equal(env.sheet('Users').length, 3);
  assert.equal(env.sheet('Roles').length, 3);
});

test('login failures lock the account after 5 attempts', () => {
  const { env, creds } = setup();
  for (let i = 0; i < 5; i++) {
    assert.equal(env.post({ action: 'login', params: { username: 'guard', password: 'wrong' } }).error, 'LOGIN_FAILED');
  }
  assert.equal(env.post({ action: 'login', params: { username: 'guard', password: creds.guard } }).error, 'LOCKED');
});

test('guard creates records with retry-safe uploads; admin searches and views', () => {
  const { env, creds } = setup();
  const admin = loginReady(env, 'admin', creds.admin);
  const guard = loginReady(env, 'guard', creds.guard);

  // الحارس لا يصل للأرشيف ولا للإعدادات
  assert.equal(env.post({ action: 'search', token: guard, params: {} }).error, 'FORBIDDEN');
  assert.equal(env.post({ action: 'saveBranch', token: guard, params: { name: 'x' } }).error, 'FORBIDDEN');
  assert.equal(env.post({ action: 'search', token: 'bogus', params: {} }).error, 'AUTH');

  ok(env.post({ action: 'saveBranch', token: admin, params: { name: 'فرع الوسط' } }));

  // بضاعة داخلة بصورتين، مع إعادة رفع نفس الصورة
  const rid = 'req-in-0001';
  const up = i => env.post({ action: 'uploadImage', token: guard, params: { request_id: rid, index: i, type: 'IN', mime: 'image/jpeg', data: JPEG } });
  ok(up(1));
  assert.equal(ok(up(1)).duplicate, true);
  ok(up(2));
  assert.equal(env.sheet('Files').length, 3);

  const createParams = {
    request_id: rid, type: 'IN', event_at: '2025-01-05T09:30',
    fields: { supplier: 'مورد السكر', doc_number: '00123', description: '=HYPERLINK("x")' }, image_indexes: [1, 2]
  };
  const first = ok(env.post({ action: 'createRecord', token: guard, params: createParams }));
  assert.match(first.record.record_id, /^IN-\d{4}-00001$/);
  assert.equal(first.record.doc_number, '00123');
  assert.equal(first.record.description, '=HYPERLINK("x")');
  const again = ok(env.post({ action: 'createRecord', token: guard, params: createParams }));
  assert.equal(again.duplicate, true);
  assert.equal(again.record.record_id, first.record.record_id);
  assert.equal(env.sheet('Records').length, 2);

  // صورة ناقصة
  const missing = env.post({ action: 'createRecord', token: guard, params: { ...createParams, request_id: 'req-in-0002' } });
  assert.equal(missing.error, 'IMAGES_MISSING');
  assert.deepEqual(missing.extra.missing, [1, 2]);

  // بضاعة خارجة تتطلب فرعًا موجودًا
  ok(env.post({ action: 'uploadImage', token: guard, params: { request_id: 'req-out-0001', index: 1, type: 'OUT', mime: 'image/jpeg', data: JPEG } }));
  const badBranch = env.post({ action: 'createRecord', token: guard, params: { request_id: 'req-out-0001', type: 'OUT', fields: { branch: 'غير موجود' }, image_indexes: [1] } });
  assert.equal(badBranch.error, 'INVALID');
  const out = ok(env.post({ action: 'createRecord', token: guard, params: { request_id: 'req-out-0001', type: 'OUT', fields: { branch: 'فرع الوسط' }, image_indexes: [1] } }));
  assert.match(out.record.record_id, /^OUT-\d{4}-00001$/);

  // مخالفة تتطلب وصفًا
  ok(env.post({ action: 'uploadImage', token: guard, params: { request_id: 'req-inc-0001', index: 3, type: 'INC', mime: 'image/jpeg', data: JPEG } }));
  assert.equal(env.post({ action: 'createRecord', token: guard, params: { request_id: 'req-inc-0001', type: 'INC', fields: {}, image_indexes: [3] } }).error, 'INVALID');
  const inc = ok(env.post({ action: 'createRecord', token: guard, params: { request_id: 'req-inc-0001', type: 'INC', fields: { description: 'تدخين قرب البوابة', person_name: 'سمير' }, image_indexes: [3] } }));
  assert.match(inc.record.record_id, /^INC-/);

  // الحارس يرى سجلاته اليوم فقط، ولا يفتح الصور
  assert.equal(ok(env.post({ action: 'myToday', token: guard })).records.length, 3);
  const fileId = Object.values(env.files).find(f => f.name && f.name.startsWith('INC-')).id;
  assert.equal(env.post({ action: 'getImage', token: guard, params: { drive_file_id: fileId } }).error, 'FORBIDDEN');

  // الإدارة: بحث وتصفية
  assert.equal(ok(env.post({ action: 'search', token: admin, params: {} })).total, 3);
  assert.equal(ok(env.post({ action: 'search', token: admin, params: { q: '00123' } })).total, 1);
  assert.equal(ok(env.post({ action: 'search', token: admin, params: { q: 'سمير' } })).records[0].type, 'INC');
  assert.equal(ok(env.post({ action: 'search', token: admin, params: { type: 'OUT' } })).total, 1);
  assert.equal(ok(env.post({ action: 'search', token: admin, params: { from: '2025-01-01', to: '2025-01-31' } })).total, 1);

  const detail = ok(env.post({ action: 'getRecord', token: admin, params: { record_id: first.record.record_id } }));
  assert.equal(detail.files.length, 2);
  const img = ok(env.post({ action: 'getImage', token: admin, params: { drive_file_id: detail.files[0].drive_file_id } }));
  assert.equal(img.data, JPEG);
  assert.equal(img.name, first.record.record_id + '_01.jpg');

  // تعديل وحذف ناعم واسترجاع
  const edited = ok(env.post({ action: 'updateRecord', token: admin, params: { record_id: first.record.record_id, fields: { notes: 'تم التحقق' } } }));
  assert.equal(edited.record.notes, 'تم التحقق');
  assert.equal(edited.record.supplier, 'مورد السكر');
  ok(env.post({ action: 'deleteRecord', token: admin, params: { record_id: first.record.record_id } }));
  assert.equal(ok(env.post({ action: 'search', token: admin, params: {} })).total, 2);
  assert.equal(ok(env.post({ action: 'search', token: admin, params: { include_deleted: true } })).total, 3);
  ok(env.post({ action: 'restoreRecord', token: admin, params: { record_id: first.record.record_id } }));

  // إيقاف الحارس ينهي جلساته
  ok(env.post({ action: 'saveUser', token: admin, params: { username: 'guard', display_name: 'الحارس', role: 'guard', active: false, existing: true } }));
  assert.equal(env.post({ action: 'myToday', token: guard }).error, 'AUTH');
});

test('admin can add a new role-based user (e.g. food safety)', () => {
  const { env, creds } = setup();
  const admin = loginReady(env, 'admin', creds.admin);
  // دور جديد يُضاف من ورقة Roles مباشرة
  env.run(`appendObj_('Roles', { role_id: 'food_safety', name: 'مسؤول سلامة الغذاء', can_create: 'INC', is_admin: false })`);
  ok(env.post({ action: 'saveUser', token: admin, params: { username: 'food1', display_name: 'سلامة الغذاء', role: 'food_safety', password: 'temp123' } }));
  const t = loginReady(env, 'food1', 'temp123');
  const me = ok(env.post({ action: 'me', token: t }));
  assert.deepEqual(me.user.can_create, ['INC']);
  assert.equal(env.post({ action: 'uploadImage', token: t, params: { request_id: 'req-food-001', index: 1, type: 'IN', mime: 'image/jpeg', data: JPEG } }).error, 'FORBIDDEN');
});

test('cleanup trashes stale pending uploads and expired sessions', () => {
  const { env, creds } = setup();
  const guard = loginReady(env, 'guard', creds.guard);
  ok(env.post({ action: 'uploadImage', token: guard, params: { request_id: 'req-stale-01', index: 1, type: 'IN', mime: 'image/jpeg', data: JPEG } }));
  const files = env.sheet('Files');
  files[1][8] = '2020-01-01 00:00:00'; // uploaded_at قديم
  const sessions = env.sheet('Sessions');
  const before = sessions.length;
  sessions[1][3] = '2020-01-01 00:00:00'; // expires_at منتهٍ
  env.run('dailyCleanup()');
  assert.equal(env.sheet('Files')[1][10], 'deleted');
  assert.equal(Object.values(env.files).find(f => f.id === files[1][4]).trashed, true);
  assert.equal(env.sheet('Sessions').length, before - 1);
});
