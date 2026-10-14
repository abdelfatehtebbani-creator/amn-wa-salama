// الاتصال بخادم Apps Script.
import { API_URL } from './config.js';
import { getToken, clearSession } from './session.js';
import { t, tServer } from './i18n.js';

export class ApiError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra || null;
  }
}

const NETWORK_MESSAGE = 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت ثم أعد المحاولة.';

/**
 * يستدعي إجراءً في الخادم. يُرسل كنص عادي (text/plain) لتجنب طلبات CORS التمهيدية
 * التي لا يدعمها Apps Script.
 */
export async function call(action, params = {}, { timeoutMs = 45000 } = {}) {
  if (API_URL.startsWith('PASTE_')) {
    throw new ApiError('CONFIG', t('لم يُضبط رابط الخادم بعد في الملف js/config.js.'));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: getToken(), params }),
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (err) {
    throw new ApiError('NETWORK', err.name === 'AbortError'
      ? t('انتهت مهلة الاتصال بالخادم. أعد المحاولة.') : t(NETWORK_MESSAGE));
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new ApiError('NETWORK', t(NETWORK_MESSAGE));

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('SERVER', t('وصل رد غير متوقع من الخادم. أعد المحاولة.'));
  }
  if (!body.ok) {
    const message = tServer(body.message);
    if (body.error === 'AUTH') {
      clearSession();
      window.dispatchEvent(new CustomEvent('auth-lost', { detail: message }));
    }
    if (body.error === 'MUST_CHANGE_PASSWORD') {
      window.dispatchEvent(new CustomEvent('must-change'));
    }
    throw new ApiError(body.error, message, body.extra);
  }
  return body.data;
}
