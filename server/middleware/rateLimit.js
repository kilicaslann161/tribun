/**
 * Tribün — hız limitleri (express-rate-limit)
 */
const rateLimit = require('express-rate-limit');

/** Genel limit: tüm /api istekleri
 *  1500/15dk: bingo oda ekranı 3 sn'de bir poll eder (20/dk);
 *  aynı IP'den 2-3 açık sekme + işaretleme bu bütçeye sığmalı. */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Çok fazla istek gönderdin, biraz nefes al ve tekrar dene.' }
});

/** Giriş/kayıt için sıkı limit (brute-force koruması) — SADECE login/register'a uygulanır */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi yaptın. 15 dakika sonra tekrar gel.' }
});

/** Oyun uç noktaları için orta limit (spam atış / tahmin önleme) */
const gameLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Biraz yavaşla dostum, tribün başını döndürüyor!' }
});

/** İçerik ekleme limiti: kullanıcı bazlı, saatte 10 (terim/anı) */
const contentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String((req.user && req.user.id) || req.ip),
  message: { error: 'Saatlik içerik ekleme sınırına ulaştın (10). Kafanı dinle, sonra gel!' }
});

/** Spor okuma uçları (Aşama 4): IP başına dakikada 120 — yalnızca DB'den okur,
 *  SportScore'a istek atmadığı için bütçeyi tüketmez. */
const sportsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Maç listesi istekleri çok hızlandı. Bir dakika içinde tekrar dene.' }
});

/** Maç detayı ucu (AŞAMA 8): IP başına dakikada 30 — SportScore'a istek
 *  atabilen TEK kullanıcı rotası olduğu için ek sıkı limit (talimat). */
const detailLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Maç detay istekleri çok hızlandı. Bir dakika içinde tekrar dene.' }
});

/** Admin uçları (AŞAMA 10 sertleştirme): IP başına dakikada 30. Anahtar asla
 *  localStorage'a yazılmaz; yine de anahtar denemesini (brute-force) yavaşlatmak
 *  için /api/admin'e ek katman uygulanır — x-admin-key yanlışsa da limit dolar. */
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Admin istekleri çok hızlandı. Bir dakika içinde tekrar dene.' }
});

module.exports = { generalLimiter, authLimiter, gameLimiter, contentLimiter, sportsLimiter, detailLimiter, adminLimiter };
