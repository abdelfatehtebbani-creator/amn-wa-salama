// اختبار شامل للواجهة في متصفح حقيقي (Playwright) على خادم التطوير المحلي.
// التشغيل: node tests/e2e.js <مجلد الصور التجريبية> [مجلد لقطات الشاشة]
// يحتاج playwright مثبتًا، وصورتين photo0.jpg وphoto1.jpg في مجلد الصور.
'use strict';
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { start } = require('./dev-server');

const photos = process.argv[2];
const shots = process.argv[3];
const P0 = path.join(photos, 'photo0.jpg');
const P1 = path.join(photos, 'photo1.jpg');

async function shot(page, name) {
  if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
}

async function login(page, username, password) {
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', password);
  await page.click('#login-form button[type=submit]');
}

async function forcedChange(page, oldPw, newPw) {
  await page.waitForSelector('#pw-form');
  await page.fill('input[name=old_password]', oldPw);
  await page.fill('input[name=new_password]', newPw);
  await page.fill('input[name=confirm]', newPw);
  await page.click('#pw-form button[type=submit]');
  await page.waitForSelector('.tiles');
}

(async () => {
  const { server, env, creds, port } = await start(0 || 8099);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const base = `http://localhost:${port}/`;

  try {
    // ---- الإدارة ----
    await page.goto(base);
    await page.waitForSelector('#login-form');
    await shot(page, '01-login');
    await login(page, 'admin', 'wrong-password');
    await page.waitForSelector('#login-status .alert.error');
    await login(page, 'admin', creds.admin);
    await forcedChange(page, creds.admin, 'admin-pass-1');
    assert.equal(await page.locator('.tile').count(), 4);
    await shot(page, '02-home-admin');

    await page.click('a[href="#/settings"]');
    await page.fill('#branch-form input[name=name]', 'فرع باب الوادي');
    await page.click('#branch-form button');
    await page.waitForSelector('#branches li');
    // مستخدم جديد: الصلاحية «مستخدم» والوظيفة «سلامة الغذاء»
    await page.waitForSelector('#user-form select[name=role] option:nth-child(2)', { state: 'attached' });
    await page.locator('details:has(#user-form) summary').click();
    await page.fill('#user-form input[name=username]', 'food1');
    await page.fill('#user-form input[name=display_name]', 'مراقب الغذاء');
    await page.selectOption('#user-form select[name=access]', 'user');
    await page.selectOption('#user-form select[name=role]', { label: 'سلامة الغذاء' });
    await page.fill('#user-form input[name=password]', 'food-temp-1');
    await page.click('#user-form button[type=submit]');
    await page.waitForSelector('#users >> text=مراقب الغذاء');
    await shot(page, '03-settings');

    // بضاعة داخلة بصورتين
    await page.goto(base + '#/home');
    await page.click('a[href="#/new/IN"]');
    await page.fill('input[name=supplier]', 'مطاحن الجنوب');
    await page.fill('input[name=doc_number]', 'F-00777');
    await page.locator('input[type=file][multiple]').setInputFiles([P0, P1]);
    await page.waitForFunction(() => document.querySelectorAll('.thumb').length === 2);
    await shot(page, '04-form-in');
    await page.click('#save-btn');
    await page.waitForSelector('.success .record-id');
    const inId = await page.textContent('.record-id');
    assert.match(inId, /^IN-\d{4}-00001$/);
    await shot(page, '05-success');

    // بضاعة خارجة، مع فشل اتصال في أول محاولة حفظ
    await page.goto(base + '#/new/OUT');
    await page.waitForSelector('select[name=branch] option:nth-child(2)', { state: 'attached' });
    await page.selectOption('select[name=branch]', 'فرع باب الوادي');
    await page.locator('input[type=file][capture]').setInputFiles(P0);
    await page.waitForSelector('.thumb');
    let failOnce = true;
    await page.route('**/api', async route => {
      const body = route.request().postData() || '';
      if (failOnce && body.includes('"createRecord"')) {
        failOnce = false;
        // الخادم يحفظ لكن الرد يضيع في الطريق: أسوأ حالة للتكرار
        await route.fetch();
        return route.abort('failed');
      }
      return route.continue();
    });
    await page.click('#save-btn');
    await page.waitForSelector('#form-status .alert.error');
    assert.equal(await page.locator('.success').count(), 0, 'must not show success before save completes');
    await shot(page, '06-retry');
    await page.click('[data-retry]');
    await page.waitForSelector('.success .record-id');
    assert.match(await page.textContent('.record-id'), /^OUT-\d{4}-00001$/);
    await page.unroute('**/api');
    const outRows = env.sheet('Records').filter(r => String(r[0]).startsWith('OUT-'));
    assert.equal(outRows.length, 1, 'retry must not duplicate the record');

    // الأرشيف
    await page.goto(base + '#/archive');
    await page.waitForSelector('.record-card');
    assert.equal(await page.locator('.record-card').count(), 2);
    await shot(page, '07-archive');
    await page.fill('input[name=q]', 'F-00777');
    await page.click('#search-form button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('.record-card').length === 1);
    await page.click('.record-card');
    await page.waitForSelector('.gallery-item img');
    await page.waitForFunction(() => document.querySelectorAll('.gallery-item img').length === 2);
    await shot(page, '08-record');
    await page.click('.gallery-item');
    await page.waitForSelector('.viewer-stage img:not([hidden])');
    await shot(page, '09-viewer');
    await page.click('[data-act=close]');
    await page.click('#edit-btn');
    await page.fill('textarea[name=notes]', 'تمت المطابقة مع الفاتورة');
    await page.click('#save-edit');
    await page.waitForSelector('.details');
    assert.ok((await page.textContent('.details')).includes('تمت المطابقة'));

    await page.goto(base + '#/home');
    await page.click('#logout-btn');
    await page.waitForSelector('#login-form');

    // ---- الحارس ----
    await login(page, 'guard', creds.guard);
    await forcedChange(page, creds.guard, 'guard-pass-1');
    assert.equal(await page.locator('a[href="#/archive"]').count(), 0);
    assert.equal(await page.locator('a[href="#/today"]').count(), 1);
    await shot(page, '10-home-guard');
    await page.click('a[href="#/new/INC"]');
    assert.equal(await page.locator('text=القسم').count(), 0);
    await page.fill('input[name=person_name]', 'عامل الوردية');
    await page.locator('input[type=file][capture]').setInputFiles(P1);
    await page.waitForSelector('.thumb');
    await page.click('#save-btn');
    await page.waitForSelector('#form-status .alert.error'); // الوصف إلزامي
    await page.fill('textarea[name=description]', 'خروج من البوابة دون إذن');
    await shot(page, '11-form-inc');
    await page.click('#save-btn');
    await page.waitForSelector('.success .record-id');
    await page.goto(base + '#/today');
    await page.waitForSelector('.record-card');
    assert.equal(await page.locator('.record-card').count(), 1);
    await shot(page, '12-today');

    // الحارس لا يفتح الأرشيف حتى بالرابط المباشر
    await page.goto(base + '#/archive');
    await page.waitForSelector('.tiles');

    // «تذكّرني»: الجلسة تبقى بعد فتح صفحة جديدة
    const page2 = await context.newPage();
    await page2.goto(base);
    await page2.waitForSelector('.tiles');
    await page2.close();

    // ---- سلامة الغذاء: يرى المخالفات فقط ----
    await page.goto(base + '#/home');
    await page.click('#logout-btn');
    await page.waitForSelector('#login-form');
    await login(page, 'food1', 'food-temp-1');
    await forcedChange(page, 'food-temp-1', 'food-pass-1');
    assert.equal(await page.locator('a[href="#/new/INC"]').count(), 1);
    assert.equal(await page.locator('a[href="#/new/IN"]').count(), 0);
    assert.equal(await page.locator('a[href="#/new/OUT"]').count(), 0);
    assert.equal(await page.locator('.top-bar >> text=سلامة الغذاء').count(), 1);
    await shot(page, '13-home-food-safety');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('E2E OK');
  } catch (err) {
    await shot(page, 'zz-failure');
    console.error('E2E FAILED:', err);
    console.error('page errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
