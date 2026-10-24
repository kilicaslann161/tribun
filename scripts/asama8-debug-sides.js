/** AŞAMA 8 — sağlayıcı tarafı denetimi: ev/deplasman yönü, İY skoru, dakika */
const { fetchMatchDetail } = require('/home/z/my-project/tribun/server/services/sportScoreClient');
const db = require('/home/z/my-project/tribun/server/db');

(async () => {
  const ids = [7, 14]; // bitmiş + canlı
  for (const id of ids) {
    const row = db.prepare('SELECT id, match_slug, external_id, status, home_score, away_score, ht_home, ht_away, minute FROM matches WHERE id = ?').get(id);
    console.log(`\n=== maç ${id} (DB) ===`);
    console.log(JSON.stringify(row));
    try {
      const r = await fetchMatchDetail({ sport: 'football', matchSlug: row.match_slug });
      const m = r.json.match;
      console.log('widget:', JSON.stringify({
        home: m.home, away: m.away,
        home_score: m.home_score, away_score: m.away_score,
        home_ht_score: m.home_ht_score, away_ht_score: m.away_ht_score,
        live_minute: m.live_minute, status: m.status, status_text: m.status_text,
        tracker_id: m.tracker && m.tracker.id
      }));
    } catch (e) {
      console.log('widget HATA:', e.message);
    }
  }
  db.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
