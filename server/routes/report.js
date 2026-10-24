/**
 * Tribün — bildirme (report) uç noktası (router /api altına mount edilir)
 * POST /api/report {content_type:"term"|"memory", content_id, reason, note?}
 * - İçerik sahibi kendi içeriğini bildiremez
 * - Aynı kullanıcı aynı içeriği iki kez bildiremez
 * - 3 farklı kullanıcı bildirince içerik otomatik gizlenir
 */
const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { autoHideIfReported, isCleanText } = require('../middleware/moderate');
const { nowLocal } = require('../utils/helpers');

const router = express.Router();

const REASONS = ['Küfür/hakaret', 'Spam', 'Uygunsuz içerik', 'Diğer'];
const CONTENT_TABLES = { term: 'dictionary_terms', memory: 'memories' };

router.post('/report', requireAuth, (req, res) => {
  const { content_type: contentType, content_id: contentId, reason, note } = req.body || {};

  if (!CONTENT_TABLES[contentType]) {
    return res.status(400).json({ error: 'content_type "term" ya da "memory" olmalı.' });
  }
  const id = Number(contentId);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Geçersiz içerik id.' });
  }
  if (!REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Geçerli bir bildirme sebebi seç.' });
  }

  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 200) : '';
  if (cleanNote && !isCleanText(cleanNote)) {
    return res.status(400).json({ error: 'Notun uygunsuz ifade barındırıyor.' });
  }

  const row = db.prepare(`SELECT id, user_id FROM ${CONTENT_TABLES[contentType]} WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Bildirilen içerik bulunamadı.' });
  if (row.user_id === req.user.id) {
    return res.status(400).json({ error: 'Kendi içeriğini bildiremezsin. 😅' });
  }

  const already = db.prepare(
    'SELECT id FROM reports WHERE content_type = ? AND content_id = ? AND user_id = ?'
  ).get(contentType, id, req.user.id);
  if (already) {
    return res.status(409).json({ error: 'Bunu zaten bildirdin. Gerisi moderasyonda!' });
  }

  const fullReason = cleanNote ? `${reason} — ${cleanNote}` : reason;
  db.prepare(
    'INSERT INTO reports (content_type, content_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(contentType, id, req.user.id, fullReason, nowLocal());

  const autoHidden = autoHideIfReported(contentType, id);
  res.status(201).json({ ok: true, autoHidden });
});

module.exports = router;
