// يتأكد أن لكل نص عربي في الواجهة ولكل رسالة من الخادم ترجمة إنجليزية.
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

async function loadEN() {
  const url = 'file://' + path.join(root, 'frontend/js/i18n-en.js');
  return (await import(url)).EN;
}

test('every t(\'...\') string in the frontend has an English translation', async () => {
  const EN = await loadEN();
  const dir = 'frontend/js';
  const missing = [];
  for (const f of fs.readdirSync(path.join(root, dir))) {
    if (!f.endsWith('.js') || f.startsWith('i18n')) continue;
    for (const m of read(`${dir}/${f}`).matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
      if (!(m[1] in EN)) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every server message has an English translation', async () => {
  const EN = await loadEN();
  const missing = [];
  const dir = 'backend';
  for (const f of fs.readdirSync(path.join(root, dir))) {
    const src = read(`${dir}/${f}`);
    // appError_('CODE', 'نص') و appError_('CODE', 'نص ' + رقم + ' نص')
    for (const m of src.matchAll(/appError_\('[A-Z_]+', '([^']*)'(?: \+ \w+ \+ '([^']*)')?/g)) {
      if (f === 'Db.gs' && m[1].startsWith('ورقة مفقودة')) continue; // خطأ إعداد داخلي
      const key = m[2] !== undefined ? `${m[1]}{n}${m[2]}` : m[1];
      if (!(key in EN)) missing.push(`${f}: ${key}`);
    }
    for (const m of src.matchAll(/(?:generic = |message: )'([^']*[؀-ۿ][^']*)'/g)) {
      if (!(m[1] in EN)) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('t() and tServer() translate, fill values and fall back to Arabic', async () => {
  const store = {};
  global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  global.document = { documentElement: {}, title: '' };
  const i18n = await import('file://' + path.join(root, 'frontend/js/i18n.js'));
  assert.equal(i18n.getLang(), 'ar');
  assert.equal(i18n.t('{n} سجل', { n: 3 }), '3 سجل');
  i18n.setLang('en');
  assert.equal(document.documentElement.dir, 'ltr');
  assert.equal(store['amn-lang'], 'en');
  assert.equal(i18n.t('{n} سجل', { n: 3 }), '3 record(s)');
  assert.equal(i18n.t('نص غير معروف'), 'نص غير معروف');
  assert.equal(i18n.tServer('كلمة المرور يجب أن تكون 6 أحرف على الأقل.'), 'The password must be at least 6 characters.');
  assert.equal(i18n.tServer('يجب تسجيل الدخول.'), 'Please sign in.');
  i18n.setLang('ar');
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(i18n.tServer('يجب تسجيل الدخول.'), 'يجب تسجيل الدخول.');
});
