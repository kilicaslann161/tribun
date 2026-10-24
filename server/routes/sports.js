/**
 * Tribün — spor okuma uçları (AŞAMA 4; router /api/sports altına mount edilir)
 *
 * Bu rotalar HİÇBİR KOŞULDA SportScore'a istek atmaz; yalnızca SQLite'tan okur
 * (api_usage sayacı bu uçlarda artmaz — test edilebilir).
 *
 *  GET /api/sports/matches?date=YYYY-MM-DD&sport=football|basketball&competition=<slug>&status=<enum>
 *      → TR takvim günü (Europe/Istanbul; Intl ile, sabit +3 YOK), lige göre gruplu,
 *        gruplar sort_order, maçlar kickoff sırasıyla; feed_missing=1 dönmez.
 *  GET /api/sports/matches/:id  → temel bilgiler (detay Aşama 8'de)
 *  GET /api/sports/competitions → is_enabled=1, sort_order sırasıyla
 *  GET /api/sports/live         → şu an live/halftime olan maçlar
 *
 * Güvenlik/davranış:
 *  - Beyaz liste doğrulama; geçersiz giriş → 400 + Türkçe mesaj
 *  - express-rate-limit: IP başına 120/dk (index.js mount'unda sportsLimiter)
 *  - Cache-Control: public, max-age=10 + içerik karmaçalı güçlü ETag; If-None-Match → 304
 *  - Hata durumunda iç ayrıntı sızmaz (genel mesaj; beklenmeyen hata global yakalayıcıya düşer)
 *  - Veri yoksa 200 + boş liste + meta; senkron hiç olmadıysa meta.stale=true, reason='no_data'
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const sportsRead = require('../services/sportsRead');

const router = express.Router();

/** Kısa önbellek + ETag gönderimi; istemci aynı ETag'i yollarsa 304 */
function sendWithCache(req, res, payload) {
  const body = JSON.stringify(payload);
  const etag = '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"';
  res.set('Cache-Control', 'public, max-age=10');
  if (req.headers['if-none-match'] && req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  res.set('ETag', etag);
  return res.type('application/json').send(body);
}

/* ---------------- GET /api/sports/matches ---------------- */
router.get('/matches', (req, res) => {
  const r = sportsRead.listMatches(db, {
    date: req.query.date,
    sport: req.query.sport,
    competition: req.query.competition,
    status: req.query.status
  });
  if (!r.ok) return res.status(400).json({ error: r.error });
  return sendWithCache(req, res, r.value);
});

/* ---------------- GET /api/sports/matches/:id ---------------- */
router.get('/matches/:id(\\d+)', (req, res) => {
  const r = sportsRead.getMatchById(db, req.params.id);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  return sendWithCache(req, res, { match: r.value });
});
/* Harf içeren id'ler ayrıca 400 (rota regex'i yakalamadıysa) */
router.get('/matches/:id', (req, res) => {
  return res.status(400).json({ error: 'Maç id pozitif bir tam sayı olmalı.' });
});

/* ---------------- GET /api/sports/matches/:id/detail (AŞAMA 8) ---------------- */
const { getMatchDetail } = require('../services/matchDetail');
const { detailLimiter } = require('../middleware/rateLimit');

/**
 * Maç detayı — SportScore'a istek atabilen TEK kullanıcı rotası.
 * Kurallar servis katmanında (matchDetail.js): TTL, tek-uçuş, kimlik
 * denetimi, bütçe tavanı, skor koruması. Burada: girdi doğrulama + ek sıkı
 * hız limiti (IP başına 30/dk) + no-store (dinamik, bütçe korumalı uç).
 */
router.get('/matches/:id(\\d+)/detail', detailLimiter, async (req, res) => {
  const r = await getMatchDetail(db, req.params.id);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.set('Cache-Control', 'no-store');
  return res.type('application/json').send(JSON.stringify(r.value));
});
/* harf içeren id'ler ayrıca 400 (digit rotası yakalamadıysa) */
router.get('/matches/:id/detail', (req, res) => {
  return res.status(400).json({ error: 'Maç id pozitif bir tam sayı olmalı.' });
});

/* ---------------- GET /api/sports/competitions ---------------- */
router.get('/competitions', (req, res) => {
  return sendWithCache(req, res, sportsRead.listCompetitions(db).value);
});

/* ---------------- GET /api/sports/competitions/:slug/standings (AŞAMA 7) ---------------- */
const SLUG_RE_A7 = /^[a-z0-9-]+$/;
router.get('/competitions/:slug/standings', (req, res) => {
  const slug = String(req.params.slug || '');
  if (!SLUG_RE_A7.test(slug)) {
    return res.status(400).json({ error: 'Lig slug\u0131 yal\u0131z a-z, 0-9 ve tire olabilir.' });
  }
  const r = sportsRead.getStandings(db, slug);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  return sendWithCache(req, res, r.value);
});

/* ---------------- GET /api/sports/competitions/:slug (AŞAMA 7) ---------------- */
router.get('/competitions/:slug', (req, res) => {
  const slug = String(req.params.slug || '');
  if (!SLUG_RE_A7.test(slug)) {
    return res.status(400).json({ error: 'Lig slug\u0131 yal\u0131z a-z, 0-9 ve tire olabilir.' });
  }
  const r = sportsRead.getCompetitionBySlug(db, slug);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  return sendWithCache(req, res, r.value);
});

/* ---------------- GET /api/sports/live ---------------- */
router.get('/live', (req, res) => {
  return sendWithCache(req, res, sportsRead.listLive(db).value);
});

module.exports = router;
