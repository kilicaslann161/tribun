/**
 * Migration 002 — Aşama 2 altyapısı
 *  a) unmapped_values: sağlayıcıdan gelen, eşleme tablosunda olmayan ham değerler
 *     (status, status_text/period, team_name, incident_type, stats_label ...)
 *  b) sync_runs.meta: yanıtlardaki rate-limit/retry-after header'ları (JSON metin)
 * Mevcut satırlara/sütunlara dokunmaz; idempotent.
 */
module.exports = {
  version: 2,
  name: 'unmapped_and_meta',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS unmapped_values (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        kind      TEXT    NOT NULL,   -- 'status' | 'status_text' | 'team_name' | 'incident_type' | 'stats_label'
        raw_value TEXT    NOT NULL,
        sport     TEXT,
        seen_at   TEXT    NOT NULL,
        hits      INTEGER NOT NULL DEFAULT 1,
        UNIQUE(kind, raw_value, sport)
      );

      CREATE INDEX IF NOT EXISTS idx_unmapped_kind ON unmapped_values(kind);
    `);

    // sync_runs.meta sütunu (kolon kontrolüyle — ALTER TABLE idempotent değil)
    const cols = db.prepare('PRAGMA table_info(sync_runs)').all().map((c) => c.name);
    if (!cols.includes('meta')) {
      db.exec('ALTER TABLE sync_runs ADD COLUMN meta TEXT');
    }
  }
};
