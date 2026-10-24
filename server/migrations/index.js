/**
 * Tribün — migration çalıştırıcısı
 * - schema_migrations(version, name, applied_at) ile sürüm takibi
 * - Her migration TEK transaction içinde (better-sqlite3 senkron transaction)
 * - Tekrar çalıştırmak zararsız: uygulanmış migration atlanır
 * - Yeni migration uygulanacaksa ÖNCE data/backups/ altına yedek alınır (VACUUM INTO)
 * - Her çalıştırmada allowlist (server/config/sports-competitions.js) competitions'a upsert edilir
 * - Sunucu başlangıcında route'lardan önce ve `npm run db:migrate` ile çağrılır
 */
const path = require('path');
const db = require('../db');
const { backupDb } = require('./backup');
const { SPORTS_COMPETITIONS } = require('../config/sports-competitions');

const MIGRATIONS = [
  require('./001_sports_tables'),
  require('./002_unmapped_and_meta'),
  require('./003_fixture_sync_columns'),
  require('./004_live_scores_columns'),
  require('./005_standings'),
  require('./006_match_detail'),
  require('./007_forecast_kahin_sensin')
].sort((a, b) => a.version - b.version);

function nowIso() {
  return new Date().toISOString();
}

/** Versiyon takip tablosu (idempotent) */
function ensureSchemaTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/**
 * Allowlist'teki DOĞRULANMIŞ ligleri competitions tablosuna upsert eder.
 * Config değişirse (sıra/ad/logo) restart/migrate sonrası tablo güncellenir.
 */
function upsertCompetitions() {
  const stmt = db.prepare(`
    INSERT INTO competitions
      (provider, external_id, slug, sport, name, api_name, country, logo_url, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', ?, ?, ?, ?, COALESCE(?, ?), ?, ?, ?, 1, ?, ?)
    ON CONFLICT(provider, external_id) DO UPDATE SET
      slug       = excluded.slug,
      sport      = excluded.sport,
      name       = excluded.name,
      api_name   = COALESCE(excluded.api_name, excluded.name),
      country    = excluded.country,
      logo_url   = excluded.logo_url,
      sort_order = excluded.sort_order,
      is_enabled = 1,
      updated_at = excluded.updated_at
  `);
  const run = db.transaction(() => {
    for (const c of SPORTS_COMPETITIONS) {
      // apiName verilmediyse name kullanılır (doğrulanmış: fikstür yanıtı adı = allowlist adı)
      stmt.run(c.externalId, c.slug, c.sport, c.name, c.apiName ?? null, c.name,
               c.country, c.logoUrl, c.sortOrder, nowIso(), nowIso());
    }
  });
  run();
}

/**
 * Bekleyen migration'ları uygular.
 * @param {{log?: boolean}} opts log: konsol çıktısı (CLI/sunucu ilk kurulum)
 * @returns {number} uygulanan migration sayısı
 */
function migrate(opts = {}) {
  const log = opts.log ? (...a) => console.log(...a) : () => {};
  ensureSchemaTable();

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );

  let ran = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;

    // Yeni migration öncesi yedek (yalnızca gerçekten uygularken)
    try {
      const b = backupDb();
      log(`🛡️  Yedek alındı: ${path.relative(process.cwd(), b)}`);
    } catch (e) {
      throw new Error(`Yedek alınamadı, migration iptal: ${e.message}`);
    }

    const runMigration = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, nowIso());
    });
    runMigration(); // senkron — transaction içinde async YOK
    log(`📦 Migration ${String(m.version).padStart(3, '0')}_${m.name} uygulandı`);
    ran++;
  }

  // Allowlist her çalıştırmada tazelenir (idempotent upsert)
  upsertCompetitions();

  if (ran === 0) log('Uygulanacak migration yok.');
  return ran;
}

module.exports = { migrate, upsertCompetitions };
