/**
 * Tribün — veri tutma (retention) politikası (AŞAMA 10)
 *
 * Kurallar:
 *  - sync_runs     : 30 günden eski koşular silinir (izleme günlüğü)
 *  - match_details : 90 günden eski detay kayıtları silinir (olay/diziliş/istatistik)
 *  - matches/teams/standings ASLA silinmez: bunlar ana veri setidir; SportScore
 *    yanıtındaki "silme" anlamı bize ait DEĞİLDİR (Aşama 3 kural 6: ASLA silinmez).
 *
 * Çalışma biçimi (event loop'u BLOKLAMAMA):
 *  - Günlük bir kez, GECE yarısına yakın sessiz saatte (retentionJob).
 *  - Küçük parçalar (batch) halinde: her turda en fazla BATCH silinir, tur arasında
 *    setImmediate ile event loop'a nefes verilir; tek dev DELETE yok.
 *  - Tüm sorgular parametreli; her iki tablonun da ilgili dizini vardır
 *    (idx_sync_runs_started, idx_match_details_fetched — migration 008).
 *
 * SAF fonksiyonlar: db parametre olarak alınır (test edilebilirlik deseni).
 */
const SYNC_RUNS_MAX_AGE_DAYS = 30;
const MATCH_DETAILS_MAX_AGE_DAYS = 90;
const BATCH = 500;

const nowIso = () => new Date().toISOString();
const yieldLoop = () => new Promise((r) => setImmediate(r));

/** YYYY-MM-DD günü ISO tarihine çevirir */
function isoDaysAgo(now, days) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/**
 * Tek tablo için kademeli silme. Silinen TOPLAM satırı döner.
 * rowid kullanılır: match_details'in bileşik PK'sı var (id sütunu YOK),
 * sync_runs ise AUTOINCREMENT id'li — rowid ikisinde de çalışır.
 * @param {import('better-sqlite3').Database} db
 */
async function purgeOlderThan(db, table, timeCol, cutoffIso, batch = BATCH) {
  const del = db.prepare(`DELETE FROM ${table} WHERE rowid IN (
    SELECT rowid FROM ${table} WHERE ${timeCol} < ? LIMIT ${Number(batch) || 500}
  )`);
  let total = 0;
  for (;;) {
    const r = del.run(cutoffIso);
    total += r.changes;
    if (r.changes < batch) break;
    await yieldLoop(); // uzun silmede event loop'u bloklama
  }
  return total;
}

/**
 * Retention turu: eski sync_runs + match_details satırlarını siler.
 * @param {import('better-sqlite3').Database} db
 * @param {{now?: number}} opts test için saat geçersiz kılma
 * @returns {Promise<{ran_at:string, cutoff_sync_runs:string, cutoff_match_details:string,
 *                    deleted_sync_runs:number, deleted_match_details:number}>}
 */
async function runRetention(db, opts = {}) {
  const now = opts.now ?? Date.now();
  const cutoffSyncRuns = isoDaysAgo(now, SYNC_RUNS_MAX_AGE_DAYS);
  const cutoffDetails = isoDaysAgo(now, MATCH_DETAILS_MAX_AGE_DAYS);

  const deletedSyncRuns = await purgeOlderThan(db, 'sync_runs', 'started_at', cutoffSyncRuns, BATCH);
  const deletedDetails = await purgeOlderThan(db, 'match_details', 'fetched_at', cutoffDetails, BATCH);

  return {
    ran_at: nowIso(),
    cutoff_sync_runs: cutoffSyncRuns,
    cutoff_match_details: cutoffDetails,
    deleted_sync_runs: deletedSyncRuns,
    deleted_match_details: deletedDetails
  };
}

/**
 * İzleme kartı için tablo istatistikleri (satır sayıları + en eski kayıt).
 * @param {import('better-sqlite3').Database} db
 */
function retentionStats(db) {
  const syncRuns = db.prepare(
    'SELECT COUNT(*) AS c, MIN(started_at) AS oldest FROM sync_runs'
  ).get();
  const matchDetails = db.prepare(
    'SELECT COUNT(*) AS c, MIN(fetched_at) AS oldest FROM match_details'
  ).get();
  const apiUsage = db.prepare(
    'SELECT COUNT(*) AS c, MIN(day_utc) AS oldest FROM api_usage'
  ).get();
  return {
    policy: {
      sync_runs_days: SYNC_RUNS_MAX_AGE_DAYS,
      match_details_days: MATCH_DETAILS_MAX_AGE_DAYS
    },
    sync_runs: syncRuns,
    match_details: matchDetails,
    api_usage: apiUsage
  };
}

module.exports = {
  runRetention,
  retentionStats,
  SYNC_RUNS_MAX_AGE_DAYS,
  MATCH_DETAILS_MAX_AGE_DAYS,
  BATCH
};
