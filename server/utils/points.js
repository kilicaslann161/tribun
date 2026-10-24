/**
 * Tribün — puan sistemi ve günlük oyun limitleri
 * Aynı oyundan bir günde en fazla DAILY_LIMITS[game] kadar puan toplanabilir.
 */
const db = require('../db');
const { nowLocal, todayLocal } = require('./helpers');

const DAILY_LIMITS = {
  penalty: 150,    // Penaltı Atışları
  oracle: 30,      // Kâhin
  quiz: 80,        // Taraftar Testi
  bingo: 100,      // Maç Günü Bingo
  transfer: 50,    // Hayali Transfer
  dictionary: 15,  // Sözlüğe terim ekleme bonusu (günde ilk 2 terim × 5 puan)
  memory: 15,      // Anı defterine yazma bonusu (günde ilk anı × 5 puan)
  bonus: 30        // Rozet/ödeme bonusları (ör. Popüler Yazar)
};

const GAME_NAMES = {
  penalty: 'Penaltı Atışları',
  oracle: 'Kâhin',
  quiz: 'Taraftar Testi',
  bingo: 'Maç Günü Bingo',
  transfer: 'Hayali Transfer',
  dictionary: 'Sözlük Terimi',
  memory: 'Anı Defteri',
  bonus: 'Bonus'
};

/** Kullanıcının bugün bu oyundan kazandığı puan (db parametreli iç sürüm) */
function earnedTodayIn(db, userId, game) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(points), 0) AS p
       FROM scores
      WHERE user_id = ? AND game = ? AND substr(created_at, 1, 10) = ?`
  ).get(userId, game, todayLocal());
  return row.p;
}

/** Kullanıcının bugün bu oyundan kazandığı puan */
function earnedToday(userId, game) {
  return earnedTodayIn(db, userId, game);
}

/**
 * Puan ekle (günlük limiti aşan kısmı kırp) — db parametreli çekirdek (AŞAMA 9).
 * Kâhin Sensin sonuçlandırması (settleFixture) puanları bu fonksiyonla dağıtır;
 * dönen scoresRowId, sağlayıcı skoru düzeltirse ödülün geri alınabilmesi için
 * predictions.award_detail'a yazılır.
 * @returns {{awarded:number, capped:boolean, dailyLimit:number, awardedToday:number, scoresRowId:number|null}}
 */
function addPointsIn(db, userId, game, basePoints, meta = null) {
  const limit = DAILY_LIMITS[game] ?? 50;
  const already = earnedTodayIn(db, userId, game);
  const remaining = limit - already;

  if (remaining <= 0 || basePoints <= 0) {
    return { awarded: 0, capped: true, dailyLimit: limit, awardedToday: already, scoresRowId: null };
  }

  const awarded = Math.min(basePoints, remaining);
  const info = db.prepare(
    'INSERT INTO scores (user_id, game, points, meta, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, game, awarded, meta === null ? null : JSON.stringify(meta), nowLocal());
  db.prepare('UPDATE users SET total_points = total_points + ? WHERE id = ?').run(awarded, userId);

  return {
    awarded,
    capped: awarded < basePoints,
    dailyLimit: limit,
    awardedToday: already + awarded,
    scoresRowId: Number(info.lastInsertRowid)
  };
}

/**
 * Puan ekle (günlük limiti aşan kısmı kırp).
 * @returns {{awarded:number, capped:boolean, dailyLimit:number, awardedToday:number}}
 */
function addPoints(userId, game, basePoints, meta = null) {
  return addPointsIn(db, userId, game, basePoints, meta);
}

module.exports = { DAILY_LIMITS, GAME_NAMES, earnedToday, addPoints, addPointsIn };
