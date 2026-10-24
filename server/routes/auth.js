/**
 * Tribün — auth uç noktaları (router /api altına mount edilir)
 * POST /api/auth/register  → kayıt (takma ad + şifre), JWT döner
 * POST /api/auth/login     → giriş, streak sunucuda hesaplanır, JWT döner
 * GET  /api/me             → kullanıcı, puan, unvan, rozetler, seri, günlük limit durumları
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { findDirtyField } = require('../middleware/moderate');
const { isValidNickname, isValidPassword, nowLocal, todayLocal, yesterdayLocal } = require('../utils/helpers');
const { checkBadges } = require('../utils/badges');
const { earnedToday, DAILY_LIMITS } = require('../utils/points');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user.id, nick: user.nickname }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function publicUser(u) {
  return {
    id: u.id,
    nickname: u.nickname,
    fan_title: u.fan_title,
    total_points: u.total_points,
    streak: u.streak,
    created_at: u.created_at
  };
}

router.post('/auth/register', authLimiter, (req, res) => {
  const { nickname, password } = req.body || {};

  if (!isValidNickname(nickname)) {
    return res.status(400).json({ error: 'Takma ad 3-20 karakter olmalı; harf, rakam ve _ kullanabilirsin.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });
  }
  const dirty = findDirtyField({ nickname });
  if (dirty) {
    return res.status(400).json({ error: 'Bu takma ad uygunsuz içerik barındırıyor, başka bir tane dene.' });
  }

  const nick = nickname.trim();
  if (db.prepare('SELECT id FROM users WHERE nickname = ?').get(nick)) {
    return res.status(409).json({ error: 'Bu takma ad çoktan alındı, başka bir tane dene.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    `INSERT INTO users (nickname, password_hash, fan_title, total_points, streak, last_login_date, created_at)
     VALUES (?, ?, 'Çaylak Taraftar', 0, 1, ?, ?)`
  ).run(nick, hash, todayLocal(), nowLocal());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/auth/login', authLimiter, (req, res) => {
  const { nickname, password } = req.body || {};
  if (typeof nickname !== 'string' || typeof password !== 'string' || !nickname.trim() || !password) {
    return res.status(400).json({ error: 'Takma ad ve şifre gerekli.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Takma ad veya şifre hatalı.' });
  }

  // Günlük giriş serisi (streak) sunucuda hesaplanır
  const today = todayLocal();
  if (user.last_login_date !== today) {
    const streak = user.last_login_date === yesterdayLocal() ? user.streak + 1 : 1;
    db.prepare('UPDATE users SET streak = ?, last_login_date = ? WHERE id = ?').run(streak, today, user.id);
    user.streak = streak;
    user.last_login_date = today;
  }

  const newBadges = checkBadges(user.id);
  res.json({ token: signToken(user), user: publicUser(user), newBadges });
});

router.get('/me', requireAuth, (req, res) => {
  const badges = db.prepare('SELECT badge_key, earned_at FROM badges WHERE user_id = ? ORDER BY earned_at').all(req.user.id);
  const daily = {};
  for (const [game, limit] of Object.entries(DAILY_LIMITS)) {
    daily[game] = { earned: earnedToday(req.user.id, game), limit };
  }
  res.json({ user: publicUser(req.user), badges, daily });
});

module.exports = router;
