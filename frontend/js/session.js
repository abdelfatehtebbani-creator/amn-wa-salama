// حفظ الجلسة في المتصفح.
// مع «تذكّرني»: localStorage (تبقى بعد إغلاق المتصفح حتى انتهاء المدة، 14 يومًا).
// بدونه: sessionStorage (تُمسح بإغلاق المتصفح).
// الخادم هو الحكم النهائي على صلاحية الجلسة في كل طلب.

const KEY = 'amn-session';
let memory = null; // احتياط إذا كان التخزين غير متاح (وضع التصفح الخاص مثلًا)

function read(storage) {
  try {
    const raw = storage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function expired(session) {
  const t = Date.parse(String(session.expires_at || '').replace(' ', 'T'));
  return isFinite(t) && t < Date.now();
}

export function getSession() {
  const s = read(localStorage) || read(sessionStorage) || memory;
  if (s && expired(s)) {
    clearSession();
    return null;
  }
  return s;
}

export function getToken() { return getSession()?.token || ''; }

export function getUser() { return getSession()?.user || null; }

export function saveSession(data) {
  clearSession();
  memory = data;
  try {
    (data.remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(data));
  } catch { /* تبقى الجلسة في الذاكرة فقط */ }
}

export function updateUser(user) {
  const s = getSession();
  if (s) saveSession({ ...s, user });
}

export function clearSession() {
  memory = null;
  try { localStorage.removeItem(KEY); } catch { /* تجاهل */ }
  try { sessionStorage.removeItem(KEY); } catch { /* تجاهل */ }
}
