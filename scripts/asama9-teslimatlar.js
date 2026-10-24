/**
 * AŞAMA 9 teslimat örneklerini topla (predictions/scores tablo örnekleri +
 * modül bulguları + yapı özeti) → download/asama9-*.json
 */
const fs = require('fs');
const db = require('better-sqlite3')('data/tribun.db', { readonly: true });

const out = {};

/* 1) fixtures örnekleri */
out.fixtures = db.prepare(`
  SELECT f.id, f.home_team, f.away_team, f.kickoff_at, f.competition_label, f.status,
         f.home_score, f.away_score, f.result_1x2, f.result_btts,
         f.review_required, f.review_reason, f.settled_at, f.settled_by, f.created_at
    FROM fixtures f ORDER BY f.id
`).all();

/* 2) predictions örnekleri (sonuçlanan + açık) */
out.predictions = db.prepare(`
  SELECT p.id, p.fixture_id, u.nickname, p.pick_1x2, p.pick_btts,
         p.points_awarded, p.award_detail, p.created_at
    FROM predictions p JOIN users u ON u.id = p.user_id
   ORDER BY p.fixture_id, p.user_id
`).all();

/* 3) scores örnekleri (Kâhin Sensin ödemeleri) */
out.scores = db.prepare(`
  SELECT s.id, s.user_id, u.nickname, s.game, s.points, s.meta, s.created_at
    FROM scores s JOIN users u ON u.id = s.user_id
   WHERE s.game = 'oracle' AND s.meta LIKE '%"fixture_id"%'
   ORDER BY s.id
`).all();

/* 4) bağ kayıtları + denge durumu */
out.forecast_match_links = db.prepare(`
  SELECT l.*, m.status AS match_status, m.home_score, m.away_score, m.fetched_at
    FROM forecast_match_links l JOIN matches m ON m.id = l.match_id
   ORDER BY l.fixture_id
`).all();

/* 5) users.total_points değişimi kanıtı */
out.users = db.prepare(`
  SELECT u.id, u.nickname, u.total_points,
         (SELECT COUNT(*) FROM predictions p WHERE p.user_id = u.id) AS forecast_tahminleri,
         (SELECT COALESCE(SUM(p.points_awarded), 0) FROM predictions p WHERE p.user_id = u.id) AS forecast_puani
    FROM users u ORDER BY u.id
`).all();

db.close();

fs.writeFileSync('/home/z/my-project/download/asama9-predictions-scores-ornekleri.json',
  JSON.stringify(out, null, 2));
console.log('fixtures:', out.fixtures.length, '| predictions:', out.predictions.length,
  '| scores:', out.scores.length, '| links:', out.forecast_match_links.length);
out.fixtures.forEach((f) => console.log(`  fixture #${f.id}: ${f.home_team} - ${f.away_team} [${f.status}]` +
  (f.status === 'finished' ? ` ${f.home_score}-${f.away_score} (${f.settled_by})` : '')));
