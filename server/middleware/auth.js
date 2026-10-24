/**
 * Tribün — JWT auth ve admin anahtarı middleware'leri
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

function readToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function loadUser(id) {
  return db.prepare(
    `SELECT id, nickname, fan_title, total_points, streak, last_login_date, created_at
       FROM users WHERE id = ?`
  ).get(id);
}

/** Korumalı uç noktalar için: geçersiz/yok token → 401 */
function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Bu işlem için giriş yapman gerekiyor.' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Oturumun geçersiz ya da süresi dolmuş. Tekrar giriş yap.' });
  }

  const user = loadUser(payload.id);
  if (!user) return res.status(401).json({ error: 'Hesabın bulunamadı. Tekrar giriş yap.' });

  req.user = user;
  next();
}

/** Açık uç noktalar için: token varsa req.user doldurur, yoksa sessizce geçer */
function optionalAuth(req, res, next) {
  const token = readToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = loadUser(payload.id);
      if (user) req.user = user;
    } catch { /* geçersiz token açık uçlarda sorun değil */ }
  }
  next();
}

/** /api/admin/* uç noktaları için: x-admin-key header'ı ADMIN_KEY ile karşılaştırılır */
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_KEY || '';
  if (!expected) return res.status(503).json({ error: 'ADMIN_KEY .env dosyasında tanımlı değil.' });

  const given = req.get('x-admin-key') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Admin anahtarı hatalı.' });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
