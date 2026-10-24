/**
 * Tribün — oyun uç noktaları (router /api/games altına, gameLimiter ile mount edilir)
 *
 * POST /api/games/penalty/play     → {zone:1-6}; kaleci SUNUCUDA belirlenir, 5 atışlık
 *                                    seri sunucuda takip edilir, puan seri bitince verilir.
 * GET  /api/games/penalty/state    → sayfa yenilendiğinde yarım kalan seriyi geri yükler.
 * POST /api/games/oracle/predict   → {home, away}; seed'li tahmin, günde ilk tahmine puan.
 * POST /api/games/quiz/submit      → {answers:[10x 0-3]}; tip SUNUCUDA hesaplanır, unvana işlenir.
 *
 * KÂHİN SENSİN (AŞAMA 9; gerçek maç tahminleri — kristal küre Kâhin'den ayrı):
 * GET  /api/games/forecast/fixtures → tahmine açık maçlar + son sonuçlananlar (+kullanıcının tahminleri)
 * POST /api/games/forecast/predict  → {fixtureId, pick1x2:'1|X|2', pickBtts:'yes|no'};
 *                                    puanlar maç sonuçlanınca otomatik dağıtılır.
 */
const express = require('express');
const crypto = require('crypto');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { findDirtyField } = require('../middleware/moderate');
const { addPoints, earnedToday, DAILY_LIMITS } = require('../utils/points');
const { checkBadges } = require('../utils/badges');
const { FAN_TYPES, QUIZ_TYPE_PRIORITY, QUIZ_QUESTIONS } = require('../data/quiz-questions');
const ORACLE = require('../data/oracle-templates');
const forecast = require('../services/forecastCore');

const router = express.Router();

/* ================= PENALTI ================= */

// Yarım kalan seriler (bellek içi; sunucu yeniden başlarsa seri sıfırdan başlar)
const penaltySeries = new Map();

function penaltyShot(zone) {
  const keeper = 1 + Math.floor(Math.random() * 6); // kaleci bölgesi sunucuda belirlenir
  if (keeper === zone) return { keeper, outcome: 'save' };
  if (Math.random() < 0.12) return { keeper, outcome: 'out' }; // auta / direk
  return { keeper, outcome: 'goal' };
}

function personalBestGoals(userId) {
  const rows = db.prepare(`SELECT meta FROM scores WHERE user_id = ? AND game = 'penalty'`).all(userId);
  let best = 0;
  for (const r of rows) {
    try {
      const m = JSON.parse(r.meta || '{}');
      if (Number(m.goals) > best) best = Number(m.goals);
    } catch { /* bozuk meta yok say */ }
  }
  return best;
}

router.get('/penalty/state', requireAuth, (req, res) => {
  const s = penaltySeries.get(req.user.id);
  const shots = s ? s.shots.filter((_, i) => i < 5) : [];
  res.json({ active: shots.length > 0 && shots.length < 5, shots });
});

router.post('/penalty/play', requireAuth, (req, res) => {
  const zone = Number((req.body || {}).zone);
  if (!Number.isInteger(zone) || zone < 1 || zone > 6) {
    return res.status(400).json({ error: 'Bölge 1 ile 6 arasında bir sayı olmalı.' });
  }

  let s = penaltySeries.get(req.user.id);
  if (!s || s.shots.length >= 5) {
    s = { shots: [] };
    penaltySeries.set(req.user.id, s);
  }

  const { keeper, outcome } = penaltyShot(zone);
  s.shots.push({ zone, keeper, outcome });
  const goals = s.shots.filter((x) => x.outcome === 'goal').length;
  const shotNumber = s.shots.length;

  if (shotNumber < 5) {
    return res.json({ shotNumber, zone, keeper, outcome, series: s.shots, goals, finished: false });
  }

  // Seri bitti → puan seri sonunda verilir
  const finishedSeries = s.shots;
  penaltySeries.delete(req.user.id);

  const base = goals * 8 + (goals === 5 ? 10 : 0); // 5/5 bonusu
  const pointsInfo = addPoints(req.user.id, 'penalty', base, { goal: goals > 0, goals, shots: 5 });
  const best = Math.max(personalBestGoals(req.user.id), goals);
  const newBadges = checkBadges(req.user.id);

  res.json({
    shotNumber,
    zone,
    keeper,
    outcome,
    series: finishedSeries,
    goals,
    finished: true,
    points: pointsInfo.awarded,
    pointsInfo,
    best,
    newBadges,
    limitMessage: pointsInfo.capped && base > 0
      ? `Bugünlük penaltı puan sınırına ulaştın (${DAILY_LIMITS.penalty}). Oynamaya devam edebilirsin, puanlar yarın yeniden!`
      : null
  });
});

/* ================= KÂHİN ================= */

// Aynı girdi → aynı tahmin (seed'li PRNG)
function seededRandom(seedStr) {
  const h = crypto.createHash('sha256').update(seedStr).digest();
  let i = 0;
  return () => {
    const x = h.readUInt32BE(i);
    i = (i + 4) % h.length;
    return x / 0xffffffff;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

router.post('/oracle/predict', requireAuth, (req, res) => {
  const { home, away } = req.body || {};
  const h = typeof home === 'string' ? home.trim() : '';
  const a = typeof away === 'string' ? away.trim() : '';

  if (h.length < 2 || h.length > 24 || a.length < 2 || a.length > 24) {
    return res.status(400).json({ error: 'Takım adları 2-24 karakter olmalı.' });
  }
  if (findDirtyField({ home: h, away: a })) {
    return res.status(400).json({ error: 'Takım adlarından biri uygunsuz içerik barındırıyor.' });
  }
  if (h.toLocaleLowerCase('tr') === a.toLocaleLowerCase('tr')) {
    return res.status(400).json({ error: 'Kendine karşı maç mı oynatıyorsun? İki farklı takım yaz. 😄' });
  }

  const today = new Date().toLocaleDateString('tr-TR');
  const rng = seededRandom(`${h}|${a}|${today}`);
  const comment = pick(rng, ORACLE.COMMENTS).replaceAll('{home}', h).replaceAll('{away}', a);

  const prediction = {
    home: h,
    away: a,
    score: pick(rng, ORACLE.SCORES),
    redCards: pick(rng, ORACLE.RED_CARDS),
    controversy: pick(rng, ORACLE.CONTROVERSIES),
    motm: pick(rng, ORACLE.MOTM),
    comment
  };

  // Puan yalnızca günün ilk tahmininde
  const firstToday = earnedToday(req.user.id, 'oracle') === 0;
  const pointsInfo = firstToday
    ? addPoints(req.user.id, 'oracle', 10, { home: h, away: a })
    : { awarded: 0, capped: false, dailyLimit: DAILY_LIMITS.oracle, awardedToday: earnedToday(req.user.id, 'oracle') };
  const newBadges = checkBadges(req.user.id);

  res.json({
    prediction,
    firstToday,
    points: pointsInfo.awarded,
    pointsInfo,
    newBadges,
    limitMessage: !firstToday
      ? 'Bugünlük kâhin puanını zaten aldın. Tahmin etmeye devam edebilirsin!'
      : (pointsInfo.capped ? `Bugünlük kâhin puanı sınırına ulaştın (${DAILY_LIMITS.oracle}).` : null)
  });
});

/* ================= KÂHİN SENSİN (AŞAMA 9) ================= */

// Tahmin listesi: açık maçlar + son sonuçlar (+ kullanıcının kendi tahminleri).
// Bu uç SportScore'a istek ATMAZ; yalnızca DB'den okur.
router.get('/forecast/fixtures', requireAuth, (req, res) => {
  try {
    res.json(forecast.listForecastForUser(db, req.user.id));
  } catch {
    res.status(500).json({ error: 'Kâhin Sensin listesi şu an alınamadı.' });
  }
});

// Tahmin gönder: her iki tür (1/X/2 + karşılıklı gol) zorunlu; başlama saatinde kapanır.
router.post('/forecast/predict', requireAuth, (req, res) => {
  const { fixtureId, pick1x2, pickBtts } = req.body || {};
  const r = forecast.submitPrediction(db, req.user.id, Number(fixtureId), { pick1x2, pickBtts });
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json(r.value);
});

/* ================= TARAFTAR TESTİ ================= */

router.post('/quiz/submit', requireAuth, (req, res) => {
  const answers = (req.body || {}).answers;

  if (!Array.isArray(answers) || answers.length !== QUIZ_QUESTIONS.length) {
    return res.status(400).json({ error: `Cevap dizisi ${QUIZ_QUESTIONS.length} soru içermeli.` });
  }
  if (!answers.every((x) => Number.isInteger(x) && x >= 0 && x <= 3)) {
    return res.status(400).json({ error: 'Her cevap 0-3 arasında bir seçenek numarası olmalı.' });
  }

  // Tip sayımları SUNUCUDA yapılır
  const counts = {};
  for (const t of Object.values(FAN_TYPES)) counts[t.key] = 0;
  answers.forEach((optIdx, qi) => {
    const opt = QUIZ_QUESTIONS[qi].options[optIdx];
    if (opt && counts[opt.type] != null) counts[opt.type] += 1;
  });

  const winnerKey = QUIZ_TYPE_PRIORITY
    .slice()
    .sort((x, y) => counts[y] - counts[x] || QUIZ_TYPE_PRIORITY.indexOf(x) - QUIZ_TYPE_PRIORITY.indexOf(y))[0];
  const meta = FAN_TYPES[winnerKey];

  // Unvan kullanıcıya işlenir
  db.prepare('UPDATE users SET fan_title = ? WHERE id = ?').run(meta.name, req.user.id);

  const firstToday = earnedToday(req.user.id, 'quiz') === 0;
  const pointsInfo = firstToday
    ? addPoints(req.user.id, 'quiz', 30, { type: winnerKey })
    : { awarded: 0, capped: false, dailyLimit: DAILY_LIMITS.quiz, awardedToday: earnedToday(req.user.id, 'quiz') };
  const newBadges = checkBadges(req.user.id);

  const countsByName = {};
  for (const t of Object.values(FAN_TYPES)) countsByName[t.name] = counts[t.key];

  res.json({
    type: winnerKey,
    name: meta.name,
    emoji: meta.emoji,
    description: meta.desc,
    counts: countsByName,
    points: pointsInfo.awarded,
    pointsInfo,
    titleUpdated: true,
    newBadges,
    limitMessage: !firstToday
      ? 'Bugün zaten test puanını aldın. Testi istediğin kadar tekrar çözebilirsin!'
      : null
  });
});

module.exports = router;
