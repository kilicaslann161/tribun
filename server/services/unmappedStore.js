/**
 * Tribün — unmapped_values yazıcısı (Aşama 2)
 * matchNormalizer SAF olduğundan; tabloya yazma bu küçük depoda.
 * Aynı (kind, raw_value, sport) tekrar görülürse hits artar.
 */
const db = require('../db');

/**
 * @param {Array<{kind:string, rawValue:string, nameKey?:string}>} items
 * @param {string|null} sport
 * @param {object} [dbConn] better-sqlite3 bağlantısı (AŞAMA 8: bellek-içi
 *        testler için enjeksiyon; verilmezse db singleton'u kullanılır)
 */
function recordUnmapped(items, sport = null, dbConn = null) {
  if (!Array.isArray(items) || !items.length) return 0;
  const conn = dbConn || db;
  const stmt = conn.prepare(`
    INSERT INTO unmapped_values (kind, raw_value, sport, seen_at, hits)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(kind, raw_value, sport) DO UPDATE SET hits = hits + 1, seen_at = excluded.seen_at
  `);
  const tx = conn.transaction(() => {
    let n = 0;
    for (const it of items) {
      if (!it || it.rawValue === undefined || it.rawValue === null || it.rawValue === '') continue;
      stmt.run(it.kind, String(it.rawValue), it.sport ?? null, new Date().toISOString());
      n++;
    }
    return n;
  });
  return tx();
}

module.exports = { recordUnmapped };
