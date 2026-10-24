/**
 * AŞAMA 10 — EXPLAIN QUERY PLAN performans denetimi
 *
 * Amaç: sıradan (kalabalık) tablolarda tam taramaya (SCAN) düşen sıcak sorguları
 * bulmak; dizin eksiklerini migration 008 öncesi/sonrası raporlamak.
 *
 * Kullanım: node scripts/asama10-explain-audit.js   (tribun kökünden)
 * Veritabanı YEDEK MODDA (readonly) ayrı bağlantıyla açılır — yazma yok.
 * Sonuç: her sorgu için plan satırları + SCAN uyarıları.
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.TRIBUN_DB_PATH || path.join(__dirname, '..', 'data', 'tribun.db');
const db = new Database(DB_PATH, { readonly: true });

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString();

/* Sorgular: üretimdeki sıcak yolların temsilîleri (parametreler gerçekçi) */
const QUERIES = [
  ['A1 maç panosu: gün aralığı + branş (sportsRead)',
    'SELECT COUNT(*) FROM matches WHERE kickoff_utc >= ? AND kickoff_utc < ? AND sport = ?',
    [today + 'T00:00:00.000Z', tomorrow, 'football']],
  ['A2 maç panosu: lig + gün aralığı',
    'SELECT COUNT(*) FROM matches WHERE competition_id = 1 AND kickoff_utc >= ? AND kickoff_utc < ?',
    [today + 'T00:00:00.000Z', tomorrow]],
  ['A3 canlı liste: durum canlı/devre (feed_missing=0)',
    "SELECT COUNT(*) FROM matches WHERE status IN ('live','halftime') AND feed_missing = 0",
    []],
  ['A4 feed_missing taraması: (lig, gün, scheduled)',
    "SELECT COUNT(*) FROM matches WHERE competition_id = 1 AND substr(kickoff_utc, 1, 10) = ? AND status = 'scheduled' AND feed_missing = 0",
    [today]],
  ['A5 tek maç kimlikle bul (upsert koruması)',
    "SELECT id FROM matches WHERE provider = 'sportscore' AND external_id = 'x'",
    []],
  ['A6 puan durumu: ligin satırları',
    'SELECT COUNT(*) FROM standings WHERE competition_id = 1',
    []],
  ['A7 maç detayı: (match_id, kind) birleşik PK',
    "SELECT COUNT(*) FROM match_details WHERE match_id = 1 AND kind = 'events'",
    []],
  ['A8 iş bazlı son koşular: (job_name, id) — AŞAMA 10 dizini',
    "SELECT id FROM sync_runs WHERE job_name = 'live_scores' ORDER BY id DESC LIMIT 5",
    []],
  ['A9 retention taraması: 30+ gün koşular — AŞAMA 10 dizini',
    'SELECT rowid FROM sync_runs WHERE started_at < ? LIMIT 10',
    ['2020-01-01T00:00:00.000Z']],
  ['A10 retention taraması: 90+ gün detaylar — AŞAMA 10 dizini',
    'SELECT rowid FROM match_details WHERE fetched_at < ? LIMIT 10',
    ['2020-01-01T00:00:00.000Z']],
  ['A11 bütçe okuma: gün toplamı (PK öneki day_utc)',
    'SELECT COALESCE(SUM(count),0) FROM api_usage WHERE day_utc = ?',
    [today]],
  ['A12 eşleşmeyen değerler: tür listesi',
    "SELECT COUNT(*) FROM unmapped_values WHERE kind = 'team_name'",
    []],
  ['A13 takım kimlikle bul (upsert)',
    "SELECT id FROM teams WHERE provider = 'sportscore' AND external_id = 'x'",
    []],
  ['A14 admin lig listesi: sayaç alt sorguları',
    'SELECT (SELECT COUNT(*) FROM matches m WHERE m.competition_id = c.id) AS mc FROM competitions c WHERE c.is_enabled = 1',
    []],
  ['A15 Kâhin Sensin: bağlanmamış yaklaşan maçlar (forecastCore)',
    `SELECT COUNT(*) FROM matches m
      WHERE m.sport = 'football' AND m.status = 'scheduled' AND m.feed_missing = 0
        AND m.kickoff_utc >= ? AND m.kickoff_utc < ?
        AND NOT EXISTS (SELECT 1 FROM forecast_match_links l WHERE l.match_id = m.id)`,
    [today + 'T00:00:00.000Z', new Date(Date.now() + 7 * 86400000).toISOString()]]
];

const BIG_TABLES = new Set(['matches', 'sync_runs', 'match_details', 'api_usage', 'unmapped_values', 'standings', 'teams', 'predictions', 'fixtures']);

let scanCount = 0;
console.log('EXPLAIN QUERY PLAN denetimi — ' + DB_PATH + '\n');
for (const [label, sql, args] of QUERIES) {
  console.log('── ' + label);
  let plan;
  try {
    plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args);
  } catch (e) {
    console.log('   HATA: ' + e.message);
    continue;
  }
  for (const row of plan) {
    const detail = row.detail || '';
    console.log('   ' + detail);
    // Kalabalık tabloda indekssiz tam tarama uyarısı
    if (/^SCAN \w+$/i.test(detail.trim())) {
      const table = detail.trim().split(/\s+/)[1];
      if (BIG_TABLES.has(table)) {
        scanCount++;
        console.log(`   ⚠️ UYARI: ${table} tablosunda tam tarama (dizin eksik olabilir)`);
      }
    }
  }
}
console.log('\nSonuç: ' + (scanCount === 0
  ? 'kalabalık tablolarda tam tarama YOK — tüm sıcak sorgular indeksli ✅'
  : scanCount + ' tam tarama uyarısı (yukarıya bak) ⚠️'));

/* Tablo boyutları bağlam için */
console.log('\nTablo boyutları:');
for (const t of ['matches', 'sync_runs', 'match_details', 'api_usage', 'unmapped_values', 'standings', 'teams']) {
  try {
    const c = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    console.log(`   ${t.padEnd(16)} ${String(c).padStart(6)} satır`);
  } catch { /* tablo yoksa atla */ }
}
db.close();
