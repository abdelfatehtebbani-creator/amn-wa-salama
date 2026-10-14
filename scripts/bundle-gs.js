// يجمع كل ملفات backend/*.gs في ملف واحد Code.gs ليسهل لصقه في محرر Apps Script.
// كل ملفات Apps Script تشترك في نطاق واحد، لذلك يعمل الملف المجمّع تمامًا مثل الملفات المنفصلة.
// التشغيل: npm run bundle  ← الناتج في dist/apps-script/
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'backend');
const out = path.join(root, 'dist', 'apps-script');
// Config أولًا لأن بقية الملفات تستخدم ثوابته
const order = ['Config.gs', 'Db.gs', 'Auth.gs', 'Files.gs', 'Records.gs', 'Admin.gs', 'Main.gs', 'Maintenance.gs', 'Setup.gs'];
const all = fs.readdirSync(src).filter(f => f.endsWith('.gs'));
const missing = all.filter(f => !order.includes(f));
if (missing.length) throw new Error('أضف هذه الملفات إلى ترتيب التجميع: ' + missing.join(', '));

const parts = order.map(f => `// ===================== ${f} =====================\n\n` + fs.readFileSync(path.join(src, f), 'utf8').trim() + '\n');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'Code.gs'),
  '// ملف مجمّع تلقائيًا من مجلد backend/ — لا تعدّله هنا، عدّل الملفات الأصلية ثم أعد التجميع.\n\n' + parts.join('\n'));
fs.copyFileSync(path.join(src, 'appsscript.json'), path.join(out, 'appsscript.json'));
console.log('dist/apps-script/Code.gs + appsscript.json');
