/**
 * Tribün — içerik moderasyonu
 * - isCleanText: kelime filtresi (blocklist.txt + TR normalizasyon + leet +
 *   harf arasına nokta/boşluk koyarak kaçma denemeleri)
 * - spamGuard: tekrar, hız, link ve uzatılmış harf kontrolleri (bellek içi)
 * - autoHideIfReported: 3 farklı kullanıcı rapor ederse hidden=1
 */
const db = require('../db');
const { BAD_WORDS } = require('../data/words');

/** Temel normalizasyon: TR küçük harf → ASCII, @/$, noktalama temizliği (rakamlara dokunmaz) */
function baseNormalize(text) {
  return String(text)
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Leet dönüşümlü normalizasyon: rakam harfleri de eşler (s1kt1r → siktir) */
function leetNormalize(text) {
  return baseNormalize(text)
    .replace(/3/g, 'e').replace(/1/g, 'i').replace(/0/g, 'o')
    .replace(/5/g, 's').replace(/4/g, 'a');
}

/** Tekillik anahtarı: "aynı metni tekrar gönderme" kontrolü için */
function normalizeKey(text) {
  return baseNormalize(text).replace(/\s+/g, ' ');
}

/** Metin uygunsa true döner */
function isCleanText(text) {
  if (typeof text !== 'string') return true;
  const tokens = baseNormalize(text).split(' ').filter(Boolean);
  const leet = leetNormalize(text);
  // Harf arasına nokta/boşluk konmuş kaçış denemeleri: tüm ayraçları sök
  const compact = leet.replace(/[^a-z0-9]/g, '');
  if (!tokens.length && !compact) return true;
  return !BAD_WORDS.some((w) => {
    if (w.length <= 3) {
      // Kısa kökler: tam eşleşme ya da kök+rakam (ör. "amk123")
      return tokens.some((t) => t === w || (t.startsWith(w) && /^\d+$/.test(t.slice(w.length))));
    }
    // Uzun kökler: normal metin + sıkıştırılmış metin (k.ü.f.ü.r → kufur)
    return leet.includes(w) || compact.includes(w);
  });
}

/** Birden çok alanı kontrol et; uygunsuzsa alan adını döner (yoksa null) */
function findDirtyField(fields) {
  for (const [name, value] of Object.entries(fields)) {
    if (!isCleanText(value)) return name;
  }
  return null;
}

/* ---------------- Spam koruması (bellek içi, kullanıcı bazlı) ---------------- */

const RECENT_POSTS = new Map(); // userId → [{key, at}]

/**
 * Spam kontrolleri. Sorun yoksa null, varsa Türkçe hata mesajı döner.
 * @param {number} userId
 * @param {string[]} texts gönderilecek metinler (alanlar birleştirilerek anahtarlanır)
 * @param {{maxPerMinute?:number, dupWindowMs?:number}} opts
 */
function spamGuard(userId, texts, { maxPerMinute = 3, dupWindowMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now();
  const arr = (RECENT_POSTS.get(userId) || []).filter((e) => now - e.at < 3600 * 1000);

  // Hız: 1 dakikada 3'ten fazla içerik
  if (arr.filter((e) => now - e.at < 60 * 1000).length >= maxPerMinute) {
    return 'Çok hızlı içerik gönderiyorsun; biraz soluklan, çayını iç. ☕';
  }

  // Aynı metni kısa sürede tekrar gönderme
  const key = normalizeKey(texts.join(' § '));
  if (key && arr.some((e) => e.key === key && now - e.at < dupWindowMs)) {
    return 'Aynı içeriği kısa süre içinde tekrar gönderemezsin.';
  }

  // Metin kalitesi: link, uzatılmış harf
  for (const t of texts) {
    if (/(https?:\/\/|www\.)/i.test(t)) {
      return 'Bağlantı paylaşımı burada kapalı; tribün link sevmez. 🔗🚫';
    }
    if (/(\S)\1{6,}/.test(t)) {
      return 'Harfleri bu kadar uzatma dostum, tribün sallanıyor! 🌀';
    }
  }

  arr.push({ key, at: now });
  if (arr.length > 50) arr.splice(0, arr.length - 50);
  RECENT_POSTS.set(userId, arr);
  return null;
}

/* ---------------- Otomatik gizleme ---------------- */

/** Rapor sayısı 3 farklı kullanıcıya ulaştıysa içeriği gizle */
function autoHideIfReported(contentType, contentId) {
  const table = contentType === 'term' ? 'dictionary_terms' : 'memories';
  const row = db.prepare(
    `SELECT COUNT(DISTINCT user_id) AS c FROM reports WHERE content_type = ? AND content_id = ?`
  ).get(contentType, contentId);
  if (row.c >= 3) {
    db.prepare(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(contentId);
    return true;
  }
  return false;
}

module.exports = { isCleanText, findDirtyField, autoHideIfReported, spamGuard, normalizeKey, baseNormalize };
