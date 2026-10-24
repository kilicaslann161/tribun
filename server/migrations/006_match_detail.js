/**
 * Migration 006 — AŞAMA 8 (maç detayı; yalnız futbol)
 *
 *  a) matches.match_slug — widget detay ucu çağrısı
 *     GET /api/widget/match/?sport=football&slug=<match_slug>
 *     için gereken takım-slug'ı (url_path'ten geri doldurulur:
 *     /football/match/<slug>/<kimlik>/ → <slug>).
 *  b) matches.ht_home / matches.ht_away — devre arası skoru
 *     (detay yanıtındaki home_ht_score/away_ht_score yazılır).
 *  c) match_details tablosu yeniden kurulur:
 *     - kind listesine 'scoreboard' eklenir (detay düzeyinde skor/
 *       dakika/durum kaydı — listeden DÜŞÜK skor burada yaşar),
 *     - source_updated kolonu eklenir (API'nin `updated` değeri).
 *     Tablo Aşama 8'e dek hiç yazılmadı (0 satır); yine de içerik
 *     taşınır — idempotent ve veri kaybı yok.
 */
const { idsFromUrl } = require('../services/matchNormalizer');

module.exports = {
  version: 6,
  name: 'match_detail',
  up(db) {
    /* a) + b) matches kolonları (idempotent ALTER) */
    const cols = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
    if (!cols.includes('match_slug')) {
      db.exec('ALTER TABLE matches ADD COLUMN match_slug TEXT');
    }
    if (!cols.includes('ht_home')) {
      db.exec('ALTER TABLE matches ADD COLUMN ht_home INTEGER');
    }
    if (!cols.includes('ht_away')) {
      db.exec('ALTER TABLE matches ADD COLUMN ht_away INTEGER');
    }

    /* match_slug geri doldurma: url_path'ten ( futbol: sondan bir önceki
     * parça; basketbol detayı yok ama yine de aynı kural zararsız ) */
    const rows = db.prepare(
      "SELECT id, url_path, kickoff_utc, sport FROM matches WHERE match_slug IS NULL AND url_path IS NOT NULL"
    ).all();
    const upd = db.prepare('UPDATE matches SET match_slug = ? WHERE id = ?');
    const fill = db.transaction(() => {
      for (const r of rows) {
        const ids = idsFromUrl(r.url_path, r.sport, r.kickoff_utc);
        if (ids.matchSlug) upd.run(ids.matchSlug, r.id);
      }
    });
    fill();

    /* c) match_details yeniden kurulum (yeni kind + source_updated) */
    db.exec(`
      CREATE TABLE IF NOT EXISTS match_details_new (
        match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        kind           TEXT    NOT NULL CHECK(kind IN ('events', 'lineups', 'stats', 'periods', 'players', 'scoreboard')),
        payload        TEXT    NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        fetched_at     TEXT,
        source_updated TEXT,
        PRIMARY KEY(match_id, kind)
      );
      INSERT INTO match_details_new (match_id, kind, payload, schema_version, fetched_at)
        SELECT match_id, kind, payload, schema_version, fetched_at FROM match_details;
      DROP TABLE match_details;
      ALTER TABLE match_details_new RENAME TO match_details;
    `);
  }
};
