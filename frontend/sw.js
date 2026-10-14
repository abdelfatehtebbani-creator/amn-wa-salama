// Service worker: يحفظ ملفات الواجهة فقط لتسريع الفتح.
// لا يحفظ أي بيانات أو صور من الخادم، ولا يعمل التطبيق دون إنترنت.
// عند تعديل أي ملف في الواجهة غيّر رقم الإصدار أدناه.
const VERSION = 'v2';
const CACHE = 'amn-shell-' + VERSION;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/api.js', 'js/config.js', 'js/session.js', 'js/ui.js', 'js/images.js',
  'js/forms.js', 'js/archive.js', 'js/viewer.js', 'js/admin.js', 'js/i18n.js', 'js/i18n-en.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('amn-shell-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// الشبكة أولًا لملفات الواجهة (حتى تصل التحديثات فورًا)، ثم النسخة المحفوظة عند انقطاع الاتصال.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
