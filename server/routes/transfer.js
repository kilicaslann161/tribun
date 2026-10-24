/**
 * Tribün — Hayali Transfer uç noktaları (router /api/transfer altına mount edilir)
 *
 * GET  /api/transfer/players?pos=KL|DF|OS|FV → oyuncu havuzu
 * GET  /api/transfer/squad                   → kullanıcının kayıtlı kadrosu
 * POST /api/transfer/squad                   → kadro kaydet (TÜM doğrulama ve hesap SUNUCUDA)
 *
 * Kadro puanı formülü (README'de de yazıyor):
 *   squad_score = toplam güç + floor((100 - toplam maliyet) / 2)
 * Yani boş kalan bütçe de (milyon başına yarım puan) skora katkı verir: hem yıldız
 * kadro hem tutumlu kadro anlamlıdır; abartılı harcama yapmadan güç toplamak ödüllendirilir.
 */
const express = require('express');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { addPoints } = require('../utils/points');
const { checkBadges } = require('../utils/badges');
const { nowLocal } = require('../utils/helpers');

const router = express.Router();

const BUDGET = 100; // milyon
const FIRST_SAVE_POINTS = 25;

const FORMATIONS = {
  '4-3-3': { KL: 1, DF: 4, OS: 3, FV: 3 },
  '4-4-2': { KL: 1, DF: 4, OS: 4, FV: 2 },
  '3-5-2': { KL: 1, DF: 3, OS: 5, FV: 2 }
};

const squadScore = (power, cost) => power + Math.floor((BUDGET - cost) / 2);

router.get('/players', (req, res) => {
  const pos = req.query.pos;
  let rows;
  if (['KL', 'DF', 'OS', 'FV'].includes(pos)) {
    rows = db.prepare('SELECT * FROM transfer_players WHERE pos = ? ORDER BY power DESC').all(pos);
  } else {
    rows = db.prepare('SELECT * FROM transfer_players ORDER BY pos, power DESC').all();
  }
  res.json({ budget: BUDGET, formations: FORMATIONS, players: rows });
});

router.get('/squad', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM transfer_squads WHERE user_id = ?').get(req.user.id);
  if (!row) return res.json({ squad: null, budget: BUDGET, formations: FORMATIONS });

  const ids = JSON.parse(row.player_ids);
  const players = [];
  for (const id of ids) {
    const p = db.prepare('SELECT * FROM transfer_players WHERE id = ?').get(id);
    if (p) players.push(p);
  }
  res.json({
    squad: {
      formation: row.formation,
      players,
      total_power: row.total_power,
      total_cost: row.total_cost,
      squad_score: row.squad_score,
      updated_at: row.updated_at
    },
    budget: BUDGET,
    formations: FORMATIONS
  });
});

router.post('/squad', requireAuth, (req, res) => {
  const { formation, playerIds } = req.body || {};

  const counts = FORMATIONS[formation];
  if (!counts) {
    return res.status(400).json({ error: 'Formasyon 4-3-3, 4-4-2 ya da 3-5-2 olmalı.' });
  }
  if (!Array.isArray(playerIds) || playerIds.length !== 11) {
    return res.status(400).json({ error: 'Tam 11 oyuncu seçmelisin.' });
  }
  const ids = playerIds.map(Number);
  if (!ids.every((x) => Number.isInteger(x) && x > 0)) {
    return res.status(400).json({ error: 'Geçersiz oyuncu kimliği.' });
  }
  if (new Set(ids).size !== 11) {
    return res.status(400).json({ error: 'Aynı oyuncu iki kez seçilemez; bir futbolcu tek yerde oynar!' });
  }

  // Fiyat ve güç HER ZAMAN sunucudaki tablodan
  const posCount = { KL: 0, DF: 0, OS: 0, FV: 0 };
  let totalPower = 0;
  let totalCost = 0;
  const players = [];
  for (const id of ids) {
    const p = db.prepare('SELECT * FROM transfer_players WHERE id = ?').get(id);
    if (!p) return res.status(400).json({ error: `Oyuncu bulunamadı (id: ${id}).` });
    posCount[p.pos] += 1;
    totalPower += p.power;
    totalCost += p.price_m;
    players.push(p);
  }

  for (const pos of Object.keys(counts)) {
    if (posCount[pos] !== counts[pos]) {
      return res.status(400).json({
        error: `${formation} formasyonu ${counts[pos]} ${pos} ister, sen ${posCount[pos]} seçtin.`
      });
    }
  }
  if (totalCost > BUDGET) {
    return res.status(400).json({
      error: `Bütçe aşıldı: ${totalCost.toFixed(1)}M harcadın, kasada ${BUDGET}M var.`
    });
  }

  const score = squadScore(totalPower, totalCost);
  const now = nowLocal();

  const prev = db.prepare('SELECT squad_score AS s FROM transfer_squads WHERE user_id = ?').get(req.user.id);
  const first = !prev;

  db.prepare(`
    INSERT INTO transfer_squads (user_id, formation, player_ids, total_power, total_cost, squad_score, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      formation = excluded.formation,
      player_ids = excluded.player_ids,
      total_power = excluded.total_power,
      total_cost = excluded.total_cost,
      squad_score = excluded.squad_score,
      updated_at = excluded.updated_at
  `).run(req.user.id, formation, JSON.stringify(ids), totalPower, Number(totalCost.toFixed(1)), score, now, now);

  // Puan: ilk kayıtta sabit; sonrasında yalnızca İYİLEŞEN fark (günlük limit addPoints'te)
  const base = first ? FIRST_SAVE_POINTS : Math.max(0, score - prev.s);
  const pointsInfo = base > 0 ? addPoints(req.user.id, 'transfer', base, { formation, squad_score: score }) : { awarded: 0 };
  const newBadges = checkBadges(req.user.id); // Teknik Direktör / Bütçe Ustası

  res.json({
    formation,
    players,
    total_power: totalPower,
    total_cost: Number(totalCost.toFixed(1)),
    squad_score: score,
    first,
    improved: !first && score > prev.s,
    points: pointsInfo.awarded,
    pointsInfo,
    newBadges
  });
});

module.exports = router;
