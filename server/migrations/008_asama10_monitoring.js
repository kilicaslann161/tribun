/**
 * Migration 008 — AŞAMA 10 (Sertleştirme, İzleme ve Belgelendirme)
 *
 *  a) teams.display_name — adminin elle atadığı GÖRÜNEN takım adı (null → feed adı).
 *     Okuma API'leri COALESCE(display_name, name) kullanır; feed adı HİÇBİR ZAMAN
 *     ezilmez (normalize katmanı display_name'den habersizdir).
 *  b) competitions.slug_status — 'active' (allowlist'ten doğrulanmış) |
 *     'candidate' (adminin elle eklediği, henüz doğrulanmamış aday lig).
 *     Allowlist upsert'i config'teki ligleri her zaman 'active' yapar.
 *  c) İzleme/silme (retention) sorguları için EXPLAIN QUERY PLAN denetiminden
 *     geçen dizinler:
 *       - idx_sync_runs_job_id     : iş bazlı son koşular + kademeli silme taraması
 *       - idx_sync_runs_started    : "30 günden eski koşular" taraması
 *       - idx_match_details_fetched: "90 günden eski detaylar" taraması
 *
 * Idempotent: ALTER TABLE kolon kontrolüyle, dizinler IF NOT EXISTS ile.
 */
module.exports = {
  version: 8,
  name: 'asama10_monitoring',
  up(db) {
    // a) teams.display_name
    const teamCols = db.prepare('PRAGMA table_info(teams)').all().map((c) => c.name);
    if (!teamCols.includes('display_name')) {
      db.exec('ALTER TABLE teams ADD COLUMN display_name TEXT');
    }

    // b) competitions.slug_status
    const compCols = db.prepare('PRAGMA table_info(competitions)').all().map((c) => c.name);
    if (!compCols.includes('slug_status')) {
      db.exec(`
        ALTER TABLE competitions ADD COLUMN slug_status TEXT NOT NULL DEFAULT 'active'
          CHECK(slug_status IN ('active', 'candidate'))
      `);
    }
    // Yeni kolon eklenince var olan (allowlist) ligler 'active' sayılır.
    db.prepare("UPDATE competitions SET slug_status = 'active' WHERE slug_status IS NULL OR slug_status = ''").run();

    // c) retention + izleme dizinleri
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sync_runs_job_id
        ON sync_runs(job_name, id);
      CREATE INDEX IF NOT EXISTS idx_sync_runs_started
        ON sync_runs(started_at);
      CREATE INDEX IF NOT EXISTS idx_match_details_fetched
        ON match_details(fetched_at);
    `);
  }
};
