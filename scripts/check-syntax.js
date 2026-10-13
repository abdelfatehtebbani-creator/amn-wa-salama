// يتحقق من صحة صياغة كل ملفات JavaScript في الخادم والواجهة.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

let failed = 0;
const root = path.join(__dirname, '..');

for (const f of fs.readdirSync(path.join(root, 'backend')).filter(f => f.endsWith('.gs'))) {
  try {
    new vm.Script(fs.readFileSync(path.join(root, 'backend', f), 'utf8'), { filename: f });
  } catch (e) {
    failed++;
    console.error(`backend/${f}: ${e.message}`);
  }
}

const frontend = ['frontend/sw.js', ...fs.readdirSync(path.join(root, 'frontend/js')).map(f => 'frontend/js/' + f)];
for (const f of frontend) {
  try {
    execFileSync(process.execPath, ['--check', '--experimental-default-type=module', path.join(root, f)], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`${f}: ${e.stderr.toString()}`);
  }
}

JSON.parse(fs.readFileSync(path.join(root, 'backend/appsscript.json'), 'utf8'));
JSON.parse(fs.readFileSync(path.join(root, 'frontend/manifest.webmanifest'), 'utf8'));

if (failed) process.exit(1);
console.log('Syntax OK');
