/**
 * Tribün — rozet uç noktası (router /api altına mount edilir)
 * GET /api/badges → tüm rozet tanımları + giriş yapılmışsa kazanılmış bilgisi
 */
const express = require('express');
const db = require('../db');
const { optionalAuth } = require('../middleware/auth');
const { BADGES } = require('../utils/badges');

const router = express.Router();

router.get('/badges', optionalAuth, (req, res) => {
  const owned = new Set(
    req.user
      ? db.prepare('SELECT badge_key FROM badges WHERE user_id = ?').all(req.user.id).map((r) => r.badge_key)
      : []
  );
  res.json({
    badges: Object.entries(BADGES).map(([key, d]) => ({
      key,
      name: d.name,
      emoji: d.emoji,
      desc: d.desc,
      earned: owned.has(key)
    }))
  });
});

module.exports = router;
