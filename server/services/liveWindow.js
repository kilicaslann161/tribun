/**
 * Tribün — canlı skor SAF karar çekirdeği (AŞAMA 5) — services/liveWindow.js
 *
 * Bu modül db singleton'ı require ETMEZ ve SportScore'a HİÇ istek atmaz:
 * tüm fonksiyonlar ilk parametre olarak better-sqlite3 bağlantısı alır
 * (rota/iş gerçek db'yi, testler bellek-içi db'yi geçirir — Aşama 4'teki
 * sportsRead deseni). Yan etkisi olan tur fonksiyonları (syncLiveRound,
 * syncCorrection) services/syncLive.js'tedir.
 *
 * İçerik:
 *  - intervalForBudget: bütçe kademesine göre tur aralığı (120 → 240 → 600 sn)
 *  - getLiveWindow    : ETKİN PENCERE KAPISI — yalnızca veritabanına bakar;
 *                       (a) live/halftime maç ya da (b) kickoff'u
 *                       [şimdi−3,5 sa, şimdi+15 dk] penceresindeki scheduled
 *                       maç varsa etkindir; etkin (lig, kickoff UTC GÜNÜ)
 *                       çiftlerini döndürür. Gece yarısını aşan maçta o maçın
 *                       başlangıç günü kullanılır, "bugün" değil.
 *  - getCorrectionDue : finished + 30 dk düzeltme kontroli bekleyen çiftleri
 *                       DB'den TÜRETİR ("plan" bellekte tutulmaz → çökme
 *                       sonrası kaybolmaz; correction_synced_at kalıcıdır).
 *  - markCorrectionsSynced: düzeltme senkronu sonrası kendi +30 dk'sı gelmiş
 *                       maçları işaretler (sonradan bitecek maçın hakkı korunur).
 *  - writeIdleRun    : boşta turunun sync_runs 'skipped' kaydı (istek 0).
 *  - estimateLiveRequests: etkin çift başına saatte 3600/aralık istek (README).
 */
const DEFAULT_INTERVAL_SEC = Math.max(30,
  Number(process.env.SPORTS_LIVE_INTERVAL_SEC) || 120);

const SCHEDULED_WINDOW_BACK_MS = 3.5 * 3600 * 1000;  // scheduled: kickoff ≥ şimdi − 3,5 sa
const SCHEDULED_WINDOW_FWD_MS = 15 * 60 * 1000;     // scheduled: kickoff ≤ şimdi + 15 dk
const IDLE_CHECK_MS = 10 * 60 * 1000;                // boştada 10 dk'da bir yalnız-DB kontrolü

/* Güvenlik: kickoff'u 12 saatten eski "live" kayıtları artık canlı DEĞİLDİR
 * (çöpte kalmış veri) — pencereyi sonsuza dek açık tutup bütçe yakamazlar.
 * İyileştirme kaybolmaz: Aşama 3'ün 3 saatlik canlı-pencere senkronu bu
 * kayıtları hâlâ çeker ve finished'a taşır. */
const STALE_LIVE_MS = 12 * 3600 * 1000;

const CORRECTION_DELAY_MS = 30 * 60 * 1000;      // finished_at + 30 dk
const CORRECTION_LOOKBACK_MS = 2 * 3600 * 1000;  // en fazla 2 sa eski bitişler planlanır

const JOB = 'live_scores';

const nowIso = () => new Date().toISOString();

/* ================= bütçe kademesine göre aralık (saf) ================= */

/**
 * @param {number} pct 0..1+ (bugünkü kullanım / etkin günlük limit)
 * @param {number} baseSec normal kademe (varsayılan 120; asgari 30)
 */
function intervalForBudget(pct, baseSec = DEFAULT_INTERVAL_SEC) {
  if (pct >= 0.9) return 600;
  if (pct >= 0.7) return 240;
  return Math.max(30, Number(baseSec) || DEFAULT_INTERVAL_SEC);
}

/* ================= etkin pencere (YALNIZCA DB okur) ================= */

/**
 * Kapı kararı. HİÇBİR SportScore isteği atmaz; yalnızca SQLite okur.
 * @param {object} database better-sqlite3 bağlantısı (test bellek-içi olabilir)
 * @param {number} nowMs
 * @returns {{active:boolean, liveCount:number, upcomingCount:number,
 *            pairs:Array<{competition:string, sport:string, date:string, matchCount:number}>,
 *            reason:string, checkedAt:string}}
 */
function getLiveWindow(database, nowMs = Date.now()) {
  const from = new Date(nowMs - SCHEDULED_WINDOW_BACK_MS).toISOString();
  const to = new Date(nowMs + SCHEDULED_WINDOW_FWD_MS).toISOString();
  const liveCutoff = new Date(nowMs - STALE_LIVE_MS).toISOString();

  /* (a) canlı maçlar — feed_missing=1 gizli; yalnız is_enabled=1 ligler;
   *     kickoff'u 12 saatten eski live kayıtları çöptür → pencereyi yakmaz */
  const liveRows = database.prepare(`
    SELECT m.external_id, m.kickoff_utc, c.slug, c.sport
      FROM matches m JOIN competitions c ON c.id = m.competition_id
     WHERE m.status IN ('live','halftime')
       AND m.feed_missing = 0 AND c.is_enabled = 1
       AND (m.kickoff_utc IS NULL OR m.kickoff_utc >= ?)
  `).all(liveCutoff);

  /* (b) penceredeki scheduled maçlar (başlayacaklar + az önce başlaması
   *     gerekip henüz live'a geçmemiş olanlar: −3,5 sa geriye bakış) */
  const upcomingRows = database.prepare(`
    SELECT m.external_id, m.kickoff_utc, c.slug, c.sport
      FROM matches m JOIN competitions c ON c.id = m.competition_id
     WHERE m.status = 'scheduled'
       AND m.feed_missing = 0 AND c.is_enabled = 1
       AND m.kickoff_utc >= ? AND m.kickoff_utc <= ?
  `).all(from, to);

  /* (lig, kickoff GÜNÜ) çiftleri — gece yarısını aşan maçta maçın kendi
   * başlangıç tarihi kullanılır, "bugün" değil. kickoff NULL satırlar çift
   * üretemez → sayaçta raporlanır. */
  const pairMap = new Map(); // "slug|date" → pair
  let noKickoff = 0;
  const addPairs = (rows) => {
    for (const r of rows) {
      if (!r.kickoff_utc) { noKickoff++; continue; }
      const date = String(r.kickoff_utc).slice(0, 10);
      const key = `${r.slug}|${date}`;
      if (!pairMap.has(key)) {
        pairMap.set(key, { competition: r.slug, sport: r.sport, date, matchCount: 0 });
      }
      pairMap.get(key).matchCount++;
    }
  };
  addPairs(liveRows);
  addPairs(upcomingRows);

  const pairs = [...pairMap.values()].sort((a, b) =>
    (a.competition + a.date).localeCompare(b.competition + b.date));
  const active = pairs.length > 0;

  let reason;
  if (active) {
    reason = liveRows.length
      ? `canlı maç: ${liveRows.length}, penceredeki scheduled: ${upcomingRows.length}`
      : `penceredeki scheduled maç: ${upcomingRows.length}`;
  } else {
    reason = 'etkin pencere kapalı (canlı/penceredeki maç yok) — istek atılmadı';
  }
  if (noKickoff) reason += `; kickoff'u olmayan ${noKickoff} maç çift üretemedi`;

  return {
    active,
    liveCount: liveRows.length,
    upcomingCount: upcomingRows.length,
    pairs,
    reason,
    checkedAt: nowIso()
  };
}

/* ================= düzeltme senkronu türetimi (DB'den; saf) ================= */

/**
 * finished'a geçmiş ama +30 dk düzeltme kontrolü YAPILMAMIŞ maçları türetir.
 * "Plan" bellekte tutulmaz: her tur bu sorgu çağrılır → süreç çökse bile
 * restart'ta tekrar türetilir (correction_synced_at DB'de kalıcıdır).
 * @returns {Array<{competition:string, competitionId:number, date:string,
 *                  fireAtMs:number, matches:number}>} — (lig, gün) çifti başına
 *   en geç biten maçın +30 dk'sı (o andan önce bitenler bu senkronda işaretlenir)
 */
function getCorrectionDue(database, nowMs = Date.now()) {
  const minFinishedAt = new Date(nowMs - CORRECTION_LOOKBACK_MS).toISOString();
  const rows = database.prepare(`
    SELECT m.external_id, m.finished_at, m.kickoff_utc,
           c.slug, c.sport, c.id AS competition_id
      FROM matches m JOIN competitions c ON c.id = m.competition_id
     WHERE m.status = 'finished'
       AND m.correction_synced_at IS NULL
       AND m.finished_at IS NOT NULL
       AND m.finished_at >= ?
       AND c.is_enabled = 1
  `).all(minFinishedAt);

  const byPair = new Map(); // "slug|date" → {pair, lastFinishMs}
  for (const r of rows) {
    if (!r.kickoff_utc) continue; // kickoff yoksa (lig, gün) çifti kurulamaz
    const date = String(r.kickoff_utc).slice(0, 10);
    const key = `${r.slug}|${date}`;
    const finMs = Date.parse(r.finished_at);
    const cur = byPair.get(key);
    if (!cur) {
      byPair.set(key, {
        competition: r.slug, sport: r.sport, date,
        competitionId: r.competition_id,
        lastFinishMs: finMs, matches: 1
      });
    } else {
      cur.matches++;
      if (finMs > cur.lastFinishMs) cur.lastFinishMs = finMs;
    }
  }

  return [...byPair.values()]
    .map((p) => ({
      competition: p.competition, sport: p.sport, date: p.date,
      competitionId: p.competitionId,
      matches: p.matches,
      fireAtMs: Math.max(p.lastFinishMs + CORRECTION_DELAY_MS, nowMs + 60 * 1000)
    }))
    .sort((a, b) => a.fireAtMs - b.fireAtMs);
}

/**
 * Düzeltme senkronu BAŞARILI olduktan sonra çağrılır: o (lig, gün) çiftindeki,
 * kendi +30 dk'sı GELMİŞ finished maçlar correction_synced_at ile işaretlenir.
 * (Sonradan bitecek maçın kendi düzeltme hakkı korunur — çalınmaz.)
 */
function markCorrectionsSynced(database, competitionId, date, nowMs = Date.now()) {
  const cutoff = new Date(nowMs - CORRECTION_DELAY_MS).toISOString();
  const info = database.prepare(`
    UPDATE matches
       SET correction_synced_at = ?
     WHERE status = 'finished'
       AND correction_synced_at IS NULL
       AND competition_id = ?
       AND substr(kickoff_utc, 1, 10) = ?
       AND finished_at IS NOT NULL AND finished_at <= ?
  `).run(nowIso(), competitionId, date, cutoff);
  return info.changes;
}

/* ================= boşta tur kaydı (kira ALMAZ) ================= */

/**
 * Etkin pencere kapalıysa: sync_runs'a status='skipped' satırı (istek 0) +
 * sync_state.last_run_at güncellenir (kira KİLİDİ ALINMAZ — boşta kontrol,
 * hemen ardından açılacak etkin turu engellememeli).
 * status 'skipped' olduğu için okuma API'sindeki meta.last_live_sync_at
 * DEĞERİNİ DEĞİŞTİRMEZ (yalnız success/partial sayılır → "gerçek canlı
 * senkron zamanı" boşta kontrolle sahteleşmez).
 */
function writeIdleRun(database, windowInfo) {
  const tx = database.transaction(() => {
    database.prepare(`
      INSERT INTO sync_runs (job_name, started_at, finished_at, status,
                             requests_made, records_seen, records_upserted, records_skipped,
                             error_message, meta)
      VALUES (?, ?, ?, 'skipped', 0, 0, 0, 0, NULL, ?)
    `).run(JOB, windowInfo.checkedAt, nowIso(), JSON.stringify({
      phase: 'live', idle: true,
      reason: windowInfo.reason,
      liveCount: windowInfo.liveCount,
      upcomingCount: windowInfo.upcomingCount
    }));
    database.prepare(`
      INSERT INTO sync_state (job_name, last_run_at) VALUES (?, ?)
      ON CONFLICT(job_name) DO UPDATE SET last_run_at = excluded.last_run_at
    `).run(JOB, nowIso());
  });
  tx();
}

/* ================= istek tahmini (README hesabı) ================= */

/**
 * Etkin her (lig, tarih) çifti için saatte 3600/aralık istek.
 * @param {number} pairCount etkin çift sayısı
 * @param {number} intervalSec tur aralığı (varsayılan 120 → 30 istek/saat)
 */
function estimateLiveRequests(pairCount, intervalSec = DEFAULT_INTERVAL_SEC) {
  const p = Math.max(0, Number(pairCount) || 0);
  const perHour = Math.round(3600 / Math.max(1, Number(intervalSec) || DEFAULT_INTERVAL_SEC));
  return {
    pairs: p,
    intervalSec: Number(intervalSec) || DEFAULT_INTERVAL_SEC,
    perPairPerHour: perHour,
    totalPerHour: p * perHour,
    formula: 'etkin çift sayısı × (3600 / aralık) = saatlik istek; 120 sn → çift başına 30/saat'
  };
}

module.exports = {
  JOB,
  DEFAULT_INTERVAL_SEC, IDLE_CHECK_MS, STALE_LIVE_MS,
  SCHEDULED_WINDOW_BACK_MS, SCHEDULED_WINDOW_FWD_MS,
  CORRECTION_DELAY_MS, CORRECTION_LOOKBACK_MS,
  intervalForBudget,
  getLiveWindow, getCorrectionDue, markCorrectionsSynced, writeIdleRun,
  estimateLiveRequests
};
