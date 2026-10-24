/**
 * Tribün — tek API yardımcı modülü
 * - Token'ı otomatik ekler (localStorage)
 * - Hatalarda anlaşılır Türkçe mesaj üretir
 * - 401'de token'ı temizler ve 'tribun:401' olayı yayınlar (app.js dinler)
 */
const TOKEN_KEY = 'tribun_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn() {
  return !!getToken();
}

function defaultMsg(status) {
  if (status === 401) return 'Giriş yapman gerekiyor.';
  if (status === 403) return 'Bunun için yetkin yok.';
  if (status === 404) return 'Aradığın şey bulunamadı.';
  if (status === 429) return 'Çok hızlı istek gönderdin, biraz sakin ol.';
  if (status >= 500) return 'Sunucuda bir terslik oldu, birazdan tekrar dene.';
  return 'İstek başarısız oldu.';
}

/**
 * fetch sarmalayıcı.
 * @param {string} path ör. '/api/me'
 * @param {{method?:string, body?:object, auth?:boolean, headers?:object}} opts
 */
export async function apiFetch(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (auth) {
    const t = getToken();
    if (t) h.Authorization = 'Bearer ' + t;
  }

  let res;
  try {
    res = await fetch(path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) {
    throw new Error('Sunucuya ulaşılamadı. Sunucu açık mı? (npm run dev)');
  }

  let data = null;
  try { data = await res.json(); } catch { /* gövde boş olabilir */ }

  if (!res.ok) {
    if (res.status === 401 && auth) {
      clearToken();
      window.dispatchEvent(new CustomEvent('tribun:401'));
    }
    const err = new Error((data && data.error) || defaultMsg(res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path, opts) => apiFetch(path, opts),
  post: (path, body, opts) => apiFetch(path, { method: 'POST', body, ...opts })
};
