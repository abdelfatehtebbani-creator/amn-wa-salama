// اللغة: العربية (الأصل) أو الإنجليزية.
// النص العربي هو مفتاح الترجمة نفسه: t('حفظ') تعيد «Save» بالإنجليزية.
// رسائل الخادم تصل بالعربية وتُترجم هنا أيضًا.
import { EN } from './i18n-en.js';

const KEY = 'amn-lang';
export const LANGS = { ar: 'العربية', en: 'English' };

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

let lang = LANGS[stored()] ? stored() : 'ar';

export function getLang() { return lang; }

export function isRtl() { return lang === 'ar'; }

/** يضبط لغة الصفحة واتجاهها. */
export function applyLang() {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = isRtl() ? 'rtl' : 'ltr';
  document.title = t('أمن و سلامة');
}

export function setLang(next) {
  if (!LANGS[next]) return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* تبقى اللغة لهذه الجلسة فقط */ }
  applyLang();
}

/** اللغة الأخرى، لزر التبديل. */
export function otherLang() { return lang === 'ar' ? 'en' : 'ar'; }

/** يترجم نصًا عربيًا، ويعوّض {name} بالقيم. النص غير المعروف يبقى كما هو. */
export function t(ar, vars) {
  let s = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, ar) ? EN[ar] : ar;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** رسائل الخادم: الأرقام داخل الرسالة تُعامل كقيمة {n}. */
export function tServer(message) {
  const text = String(message || '');
  if (lang !== 'en' || !text) return text;
  if (Object.prototype.hasOwnProperty.call(EN, text)) return EN[text];
  const m = text.match(/\d+/);
  if (m) {
    const key = text.replace(m[0], '{n}');
    if (Object.prototype.hasOwnProperty.call(EN, key)) return EN[key].replace('{n}', m[0]);
  }
  return text;
}

/** سهم الرجوع حسب اتجاه الكتابة. */
export function backArrow() { return isRtl() ? '→' : '←'; }
