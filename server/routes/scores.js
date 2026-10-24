/**
 * Tribün — liderlik tablosu (router /api altına mount edilir)
 * GET /api/leaderboard?game=total|penalty|oracle|quiz|bingo|transfer → ilk 20
 */
const express = require('express');
const db = require('../db');

const router = express.Router();

const GAME_KEYS = ['penalty', 'oracle', 'quiz', 'bingo', 'transfer'];
const GAME_NAMES = {
  penalty: 'Penaltı Atışları',
  oracle: 'Kâhin',
  quiz: 'Taraftar Testi',
  bingo: 'Maç Günü Bingo',
  transfer: 'Hayali Transfer'
};

router.get('/leaderboard', (req, res) => {
  const game = String(req.query.game || 'total').toLowerCase();

  let rows;
  if (game === 'total') {
    rows = db.prepare(
      `SELECT id, nickname, fan_title, total_points AS points
         FROM users
        ORDER BY total_points DESC, nickname ASC
        LIMIT 20`
    ).all();
  } else if (GAME_KEYS.includes(game)) {
    rows = db.prepare(
      `SELECT u.id, u.nickname, u.fan_title, SUM(s.points) AS points
         FROM scores s
         JOIN users u ON u.id = s.user_id
        WHERE s.game = ?
        GROUP BY u.id
        ORDER BY points DESC, u.nickname ASC
        LIMIT 20`
    ).all(game);
  } else {
    return res.status(400).json({ error: 'Geçersiz oyun anahtarı. Şunlardan birini dene: total, penalty, oracle, quiz, bingo, transfer' });
  }

  res.json({
    game,
    title: game === 'total' ? 'Genel Sıralama' : GAME_NAMES[game],
    rows: rows.map((r, i) => ({ rank: i + 1, ...r }))
  });
});

module.exports = router;
