/**
 * Tribün — Futbol Anı Defteri uç noktaları (router /api altına mount edilir)
 * GET    /api/memories?mine=0|1&page=1&limit=10 → zaman çizgisi verisi
 * POST   /api/memories                          → anı ekle (giriş + temizlik + spam)
 * DELETE /api/memories/:id                      → SADECE kendi anını sil
 */
const express = require('express');

const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { contentLimiter } = require('../middleware/rateLimit');
const { findDirtyField, spamGuard } = require('../middleware/moderate');
const { nowLocal, todayLocal } = require('../utils/helpers');
const { addPoints } = require('../utils/points');
const { checkBadges } = require('../utils/badges');

const router = express.Router();

const currentYear = () => new Date().getFullYear();

router.get('/memories', optionalAuth, (req, res) => {
  const mine = req.query.mine === '1';
  if (mine && !req.user) return res.status(401).json({ error: 'Kendi anılarını görmek için giriş yapmalısın.' });

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(30, Math.max(3, parseInt(req.query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  // Genel liste: yalnız gizli olmayanlar. "Benim Anılarım": kendi anları (gizliler de, işaretli)
  const where = mine ? 'WHERE m.user_id = ?' : 'WHERE m.hidden = 0';
  const params = mine ? [req.user.id] : [];

  const rows = db.prepare(`
    SELECT m.id, m.title, m.body, m.year, m.user_id, m.hidden, m.created_at, u.nickname
      FROM memories m
      JOIN users u ON u.id = m.user_id
      ${where}
     ORDER BY m.year DESC, m.id DESC
     LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM memories m ${where}`).get(...params);

  res.json({
    mine,
    page,
    limit,
    total,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      year: r.year,
      nickname: r.nickname,
      created_at: r.created_at,
      hidden: !!r.hidden,
      mine: !!(req.user && r.user_id === req.user.id)
    }))
  });
});

router.post('/memories', requireAuth, contentLimiter, (req, res) => {
  const title = typeof (req.body || {}).title === 'string' ? req.body.title.trim() : '';
  const body = typeof (req.body || {}).body === 'string' ? req.body.body.trim() : '';
  const year = Number((req.body || {}).year);

  if (title.length < 3 || title.length > 60) {
    return res.status(400).json({ error: 'Başlık 3-60 karakter olmalı.' });
  }
  if (body.length < 5 || body.length > 600) {
    return res.status(400).json({ error: 'Anı 5-600 karakter olmalı.' });
  }
  if (!Number.isInteger(year) || year < 1950 || year > currentYear()) {
    return res.status(400).json({ error: `Yıl 1950 ile ${currentYear()} arasında bir sayı olmalı.` });
  }
  if (findDirtyField({ title, body })) {
    return res.status(400).json({ error: 'Anı uygunsuz ifade barındırıyor. Temiz tutalım!' });
  }
  const spamErr = spamGuard(req.user.id, ['memory:' + title, 'body:' + body]);
  if (spamErr) return res.status(429).json({ error: spamErr });

  const info = db.prepare(
    'INSERT INTO memories (user_id, title, body, year, created_at, hidden) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(req.user.id, title, body, year, nowLocal());

  // Puan: günün ilk anı × 5 puan
  const countToday = db.prepare(
    `SELECT COUNT(*) AS c FROM memories WHERE user_id = ? AND substr(created_at, 1, 10) = ?`
  ).get(req.user.id, todayLocal()).c;
  const pointsInfo = countToday <= 1
    ? addPoints(req.user.id, 'memory', 5, { title })
    : { awarded: 0, capped: true, dailyLimit: 15, awardedToday: countToday };
  const newBadges = checkBadges(req.user.id);

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    title,
    body,
    year,
    nickname: req.user.nickname,
    created_at: nowLocal(),
    hidden: false,
    mine: true,
    points: pointsInfo.awarded,
    pointsInfo,
    newBadges,
    limitMessage: pointsInfo.awarded === 0
      ? 'Bugün zaten puanlı anını yazdın (günde 1 anı puanlıdır). Anın yine de defterde!'
      : null
  });
});

router.delete('/memories/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz anı id.' });

  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Anı bulunamadı.' });
  if (row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Sadece kendi anını silebilirsin.' });
  }

  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  db.prepare(`DELETE FROM reports WHERE content_type = 'memory' AND content_id = ?`).run(id); // yetim rapor kalmasın
  res.json({ ok: true });
});

module.exports = router;
