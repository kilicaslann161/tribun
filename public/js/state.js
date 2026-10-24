/**
 * Tribün — kullanıcı durumu (basit observable)
 * Token localStorage'da; kullanıcı bilgisi /api/me'den gelir.
 */
import { api, isLoggedIn } from './api.js';

let currentUser = null;
const listeners = new Set();

export function getUser() {
  return currentUser;
}

export function setUser(u) {
  const prev = currentUser;
  currentUser = u;
  listeners.forEach((fn) => { try { fn(currentUser, prev); } catch { /* dinleyici hatası yut */ } });
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Token varsa /api/me ile kullanıcıyı tazele */
export async function loadMe() {
  if (!isLoggedIn()) {
    setUser(null);
    return null;
  }
  try {
    const d = await api.get('/api/me');
    setUser(d.user);
    return d;
  } catch (e) {
    if (e.status === 401) setUser(null);
    return null; // ağ hatası vb.: mevcut durum bozulmasın
  }
}
