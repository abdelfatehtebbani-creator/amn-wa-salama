// خادم تطوير محلي: يعرض الواجهة ويشغّل كود backend/ على محاكاة Apps Script.
// التشغيل: node tests/dev-server.js  ثم افتح http://localhost:8080
// البيانات في الذاكرة فقط وتُمسح عند الإيقاف.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createEnv } = require('./gas-mock');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.join(__dirname, '..', 'frontend');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json'
};

function start(port = PORT) {
  const env = createEnv();
  env.run('setup()');
  const creds = {};
  env.logs.forEach(line => {
    const m = /^\s+(\w+)\s+\/\s+(\w+)$/.exec(line);
    if (m) creds[m[1]] = m[2];
  });

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const out = env.context.doPost({ postData: { contents: body } }).getContent();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(out);
      });
      return;
    }
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/js/config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      res.end(`export const API_URL = '/api';\nexport const APP_NAME = 'أمن و سلامة';\n`);
      return;
    }
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise(resolve => server.listen(port, () => resolve({ server, env, creds, port })));
}

if (require.main === module) {
  start().then(({ creds, port }) => {
    console.log(`http://localhost:${port}`);
    console.log('الحسابات المؤقتة:', creds);
  });
}

module.exports = { start };
