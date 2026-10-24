/**
 * Migration 004 — Aşama 5 (canlı skorlar) şema ihtiyaçları
 *
 *  a) matches.correction_synced_at — maç finished'a geçtikte ~30 dk sonra
 *     yapılan TEK düzeltme kontrolünün işaretini taşır (null = kontrol bekliyor).
 *     Süreç çökse bile işaret DB'de kalır → yeniden başlatmada türetilebilir
 *     ("schedule" bellekte tutulmaz, DB'den türetilir).
 *  b) Kısmi (partial) index: finished + düzeltme bekleyen satırların hızlı bulunması.
 *
 * "24 saat sonra kaydı dondur" kuralı için KOLON GEREKMEZ: dondurma koşulu
 * (status='finished' AND finished_at < şimdi-24s) mevcut finished_at'tan türetilir.
 *
 * Idempotent: kolon kontrolüyle ALTER TABLE; tekrar çalıştırmak zararsız.
 */
module.exports = {
  version: 4,
  name: 'live_scores_columns',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
    if (!cols.includes('correction_synced_at')) {
      db.exec('ALTER TABLE matches ADD COLUMN correction_synced_at TEXT');
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_matches_correction_pending
        ON matches(competition_id, kickoff_utc)
        WHERE status = 'finished' AND correction_synced_at IS NULL
    `);
  }
};
