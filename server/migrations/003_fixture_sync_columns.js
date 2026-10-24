/**
 * Migration 003 — Aşama 3 (fikstür senkronizasyonu v2) şema ihtiyaçları
 *
 *  a) competitions.api_name — sağlayıcı FİKSTÜR yanıtındaki lig adı.
 *     Senkron bu adı api_name ile karşılaştırır (farklıysa uyarı, meta'ya yazılır).
 *     Allowlist 'name' değeriyle başlar: keşif + canlı doğrulamada yanıt adı = kayıt adı.
 *  b) matches.feed_missing (varsayılan okuma API'sinde gizlenir, ASLA silinmez)
 *     ve matches.miss_streak (ardışık "başarılı senkronda dönmedi" sayacı;
 *     streak >= 2 → feed_missing=1).
 *  c) matches.url_path — Aşama 2 gereği sağlayıcıdaki maç yolu (okuma API'leri için).
 *
 * Idempotent: kolon kontrolleriyle ALTER TABLE; tekrar çalıştırmak zararsız.
 */
module.exports = {
  version: 3,
  name: 'fixture_sync_columns',
  up(db) {
    // a) competitions.api_name
    const compCols = db.prepare('PRAGMA table_info(competitions)').all().map((c) => c.name);
    if (!compCols.includes('api_name')) {
      db.exec('ALTER TABLE competitions ADD COLUMN api_name TEXT');
    }
    // Allowlist adıyla geri doldur (api_name NULL olan satırlar)
    db.exec('UPDATE competitions SET api_name = COALESCE(api_name, name)');

    // b) + c) matches kolonları
    const cols = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
    if (!cols.includes('feed_missing')) {
      db.exec('ALTER TABLE matches ADD COLUMN feed_missing INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.includes('miss_streak')) {
      db.exec('ALTER TABLE matches ADD COLUMN miss_streak INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.includes('url_path')) {
      db.exec('ALTER TABLE matches ADD COLUMN url_path TEXT');
    }

    // feed_missing filtresi okuma API'lerinde sürekli kullanılacak
    db.exec('CREATE INDEX IF NOT EXISTS idx_matches_feed_missing ON matches(feed_missing, status)');
  }
};
