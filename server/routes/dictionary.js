/**
 * Tribün — Taraftar Sözlüğü uç noktaları (router /api altına mount edilir)
 * GET  /api/dictionary?sort=new|top&page=1&limit=20 → gizli olmayan terimler + my_vote
 * POST /api/dictionary                           → terim ekle (giriş + temizlik + spam)
 * POST /api/dictionary/:id/vote                  → oy ver / değiştir / geri çek
 */
const express = require('express');

const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { contentLimiter } = require('../middleware/rateLimit');
const { findDirtyField, spamGuard, normalizeKey } = require('../middleware/moderate');
const { nowLocal, todayLocal } = require('../utils/helpers');
const { addPoints } = require('../utils/points');
const { checkBadges } = require('../utils/badges');

const router = express.Router();

/** Bugün eklenen terim sayısı (puan kuralı: günde ilk 2 terim × 5 puan) */
function termsToday(userId) {
  return db.prepare(
    `SELECT COUNT(*) AS c FROM dictionary_terms WHERE user_id = ? AND substr(created_at, 1, 10) = ?`
  ).get(userId, todayLocal()).c;
}

router.get('/dictionary', optionalAuth, (req, res) => {
  const sort = req.query.sort === 'top' ? 'top' : 'new';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const orderBy = sort === 'top' ? 'score DESC, t.id DESC' : 't.id DESC';

  const rows = db.prepare(`
    SELECT t.id, t.term, t.definition, t.user_id, u.nickname, t.created_at,
           COALESCE(SUM(v.value), 0) AS score,
           COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0) AS up,
           COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS down
      FROM dictionary_terms t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN dictionary_votes v ON v.term_id = t.id
     WHERE t.hidden = 0
     GROUP BY t.id
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?
  `).all(limit, offset);

  const { total } = db.prepare('SELECT COUNT(*) AS total FROM dictionary_terms WHERE hidden = 0').get();

  const myVotes = {};
  if (req.user && rows.length) {
    const q = `SELECT term_id, value FROM dictionary_votes
                WHERE user_id = ? AND term_id IN (${rows.map(() => '?').join(',')})`;
    for (const r of db.prepare(q).all(req.user.id, ...rows.map((r) => r.id))) myVotes[r.term_id] = r.value;
  }

  res.json({
    sort,
    page,
    limit,
    total,
    rows: rows.map((r) => ({
      id: r.id,
      term: r.term,
      definition: r.definition,
      user_id: r.user_id,
      nickname: r.nickname,
      created_at: r.created_at,
      score: r.score,
      up: r.up,
      down: r.down,
      my_vote: myVotes[r.id] ?? 0,
      mine: !!(req.user && r.user_id === req.user.id)
    }))
  });
});

router.post('/dictionary', requireAuth, contentLimiter, (req, res) => {
  const term = typeof (req.body || {}).term === 'string' ? req.body.term.trim() : '';
  const definition = typeof (req.body || {}).definition === 'string' ? req.body.definition.trim() : '';

  if (term.length < 2 || term.length > 40) {
    return res.status(400).json({ error: 'Terim 2-40 karakter olmalı.' });
  }
  if (definition.length < 5 || definition.length > 300) {
    return res.status(400).json({ error: 'Tanım 5-300 karakter olmalı.' });
  }
  if (findDirtyField({ term, definition })) {
    return res.status(400).json({ error: 'İçerik uygunsuz ifade barındırıyor. Sözlüğü temiz tutalım!' });
  }
  const spamErr = spamGuard(req.user.id, ['term:' + term, 'def:' + definition]);
  if (spamErr) return res.status(429).json({ error: spamErr });

  // Aynı terim var mı? (büyük/küçük harf + Türkçe karakter duyarsız)
  const newKey = normalizeKey(term);
  const all = db.prepare('SELECT term FROM dictionary_terms').all();
  if (all.some((r) => normalizeKey(r.term) === newKey)) {
    return res.status(409).json({ error: 'Bu terim sözlükte zaten var. Şansına, başka bir başlık dene!' });
  }

  const info = db.prepare(
    'INSERT INTO dictionary_terms (user_id, term, definition, created_at, hidden) VALUES (?, ?, ?, ?, 0)'
  ).run(req.user.id, term, definition, nowLocal());

  // Puan: günde ilk 2 terim × 5 puan
  const countToday = termsToday(req.user.id); // yeni terim dahil
  const pointsInfo = countToday <= 2
    ? addPoints(req.user.id, 'dictionary', 5, { term })
    : { awarded: 0, capped: true, dailyLimit: 15, awardedToday: countToday };
  const newBadges = checkBadges(req.user.id);

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    term,
    definition,
    nickname: req.user.nickname,
    created_at: nowLocal(),
    score: 0, up: 0, down: 0, my_vote: 0, mine: true,
    points: pointsInfo.awarded,
    pointsInfo,
    newBadges,
    limitMessage: pointsInfo.awarded === 0
      ? 'Bugünlük terim puanın doldu (günde ilk 2 terim puan kazanır). Terimin yine de yayında!'
      : null
  });
});

router.post('/dictionary/:id/vote', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const value = Number((req.body || {}).value);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz terim id.' });
  if (value !== 1 && value !== -1) return res.status(400).json({ error: 'Oy 1 ya da -1 olmalı.' });

  const term = db.prepare('SELECT * FROM dictionary_terms WHERE id = ?').get(id);
  if (!term || term.hidden) return res.status(404).json({ error: 'Terim bulunamadı.' });
  if (term.user_id === req.user.id) {
    return res.status(400).json({ error: 'Kendi terimine oy veremezsin; kendine yazarlık yapma! 😄' });
  }

  const existing = db.prepare(
    'SELECT * FROM dictionary_votes WHERE term_id = ? AND user_id = ?'
  ).get(id, req.user.id);

  let removed = false;
  if (existing && existing.value === value) {
    db.prepare('DELETE FROM dictionary_votes WHERE term_id = ? AND user_id = ?').run(id, req.user.id);
    removed = true; // aynı oy → geri çek
  } else if (existing) {
    db.prepare('UPDATE dictionary_votes SET value = ? WHERE term_id = ? AND user_id = ?').run(value, id, req.user.id);
  } else {
    db.prepare('INSERT INTO dictionary_votes (term_id, user_id, value) VALUES (?, ?, ?)').run(id, req.user.id, value);
  }

  const s = db.prepare(
    `SELECT COALESCE(SUM(value), 0) AS score,
            COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) AS up,
            COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) AS down
       FROM dictionary_votes WHERE term_id = ?`
  ).get(id);

  // Yazara "Popüler Yazar" rozeti + bonus (bir kez)
  let authorBadge = null;
  if (s.score >= 10) {
    const fresh = checkBadges(term.user_id);
    const b = fresh.find((x) => x.key === 'popul_yazar');
    if (b) {
      addPoints(term.user_id, 'bonus', 15, { badge: 'popul_yazar', term: term.term });
      authorBadge = b;
    }
  }

  res.json({
    id,
    score: s.score,
    up: s.up,
    down: s.down,
    my_vote: removed ? 0 : value,
    removed,
    authorBadge
  });
});

module.exports = router;
