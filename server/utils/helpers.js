/**
 * Tribün — ortak yardımcı fonksiyonlar
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Yerel saat ile 'YYYY-MM-DD' (streak ve günlük limit hesapları için) */
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Yerel saat ile tam zaman damgası: 'YYYY-MM-DD HH:MM:SS' */
function nowLocal(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Bugünün tarihi (yerel) */
function todayLocal() {
  return fmtDate(new Date());
}

/** Dünün tarihi (yerel) */
function yesterdayLocal() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return fmtDate(d);
}

/** Takma ad: 3-20 karakter, harf (TR dahil), rakam, alt çizgi */
function isValidNickname(n) {
  return typeof n === 'string' && /^[a-zA-ZçğıöşüÇĞİÖŞÜ0-9_]{3,20}$/.test(n.trim());
}

/** Şifre: 6-72 karakter */
function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 72;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

module.exports = { nowLocal, todayLocal, yesterdayLocal, isValidNickname, isValidPassword, clamp };
