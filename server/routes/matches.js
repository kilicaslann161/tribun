/**
 * Tribün — maç panosu uçları (SportScore widget kaynağı)
 * GET /api/matches → normalize edilmiş günlük maç listesi (futbol + basketbol).
 * Ham SportScore yanıtı asla dışarı sızmaz.
 */
const express = require('express');
const { getMatches } = require('../services/sportscore');

const router = express.Router();

router.get('/matches', async (req, res) => {
  try {
    const d = await getMatches();
    res.json({
      source: 'sportscore-widget',
      attribution: { name: 'Powered by SportScore', url: 'https://sportscore.com/' },
      updated: d.updated,
      stale: !!d.stale,
      unavailable: !!d.unavailable,
      sports: {
        football: d.football,
        basketball: d.basketball
      }
    });
  } catch (e) {
    // Servis katmanı tüm hataları yönetir; buraya düşerse de nazikçe boş dön
    res.json({
      source: 'sportscore-widget',
      attribution: { name: 'Powered by SportScore', url: 'https://sportscore.com/' },
      updated: null,
      stale: false,
      unavailable: true,
      sports: { football: [], basketball: [] }
    });
  }
});

module.exports = router;
