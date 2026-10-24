/**
 * Tribün — canlı skor senkronu (AŞAMA 5) — server/services/syncLive.js
 *
 * Önkoşul notu: widget/matches uç noktası 10 maç döndürdüğü için KULLANILMAZ;
 * canlı güncelleme de AŞAMA 3'teki gibi LİG BAZLI fikstür isteğiyle yapılır
 * (GET /api/v1/fixtures/?sport=&date=&competition= — "bugün" DEĞİL, maçın
 * kickoff UTC GÜNÜ ile).
 *
 * SAF karar çekirdeği (pencere, düzeltme türetimi, aralık kademeleri) ayrı
 * modülde: services/liveWindow.js (db singleton'u require ETMEZ — testler
 * bellek-içi db kullanır). Burada YAN ETKİLİ tur fonksiyonları var:
 *
 *   syncLiveRound: kapı (yalnız DB) → kapalıysa boşta kaydı (istek YOK);
 *     açıksa AŞAMA 3 MOTORU syncFixtures({jobName:'live_scores', pairs,
 *     priority:'critical'}) ile → kira kilidi, tek transaction, TÜM upsert
 *     korumaları (NULL ezmez, durum geri dönüşü yasak, skor düşüşü ardışık
 *     2 onay, finished_at ilk geçişte, feed_missing, unmapped_values) +
 *     Aşama 5'in 24 saat dondurma kuralı. minute alanı list yanıtında
 *     bulunmadığından BU GÖREV YAZMAZ (yalnız detay — Aşama 8).
 *   syncCorrection: finished + 30 dk TEK düzeltme senkronu; başarılıysa
 *     liveWindow.markCorrectionsSynced ile işaretler.
 *
 * ARALIK (işin döngüsü jobs/liveScoresJob.js'de): temel 120 sn
 * (.env SPORTS_LIVE_INTERVAL_SEC), bütçe %70 → 240 sn, %90 → 600 sn;
 * istek başına ≥ 1 sn aralık (motor içinde); ardışık başarısızlıkta aralık
 * büyür (sync_state.consecutive_failures motor tarafından artar).
 * Her tur sync_runs'a yazılır (kira 'skipped'ları dahil; boşta turları
 * status='skipped' satırı olarak).
 */
const db = require('../db');
const { syncFixtures } = require('./syncFixtures');
const { usageToday, effectiveLimit } = require('./sportScoreClient');
const {
  JOB, getLiveWindow, writeIdleRun
} = require('./liveWindow');

const LEASE_NOTE = 'canlı skor işi';

/* ================= bütçe seviyesi ================= */

/** Bugünkü kullanım / etkin limit (0..1+). 429 sonrası düşürülmüş limit dahil. */
function budgetPct() {
  const eff = effectiveLimit();
  return eff > 0 ? usageToday() / eff : 1;
}

/** Seviye etiketi: admin status çıktısında gösterilir */
function budgetTier(pct) {
  if (pct >= 1) return 'exhausted';
  if (pct >= 0.9) return 'critical';
  if (pct >= 0.7) return 'elevated';
  return 'normal';
}

/* ================= tur ================= */

/**
 * TEK canlı skor turu.
 *   1) Kapı (yalnız DB) → kapalıysa boşta kaydı yaz, istek ATMA.
 *   2) Açıksa etkin (lig, kickoff günü) çiftleri için AŞAMA 3 motoru:
 *      jobName='live_scores' → kendi kira satırı (fixtures ile paralel
 *      koşabilir; yazılar her transaction'da atomiktir) + phase='live'.
 *
 * @param {{quietSkipped?:boolean}} opts
 * @returns {Promise<{status:'success'|'partial'|'failed'|'skipped'|'idle', ...}>}
 */
async function syncLiveRound(opts = {}) {
  const win = getLiveWindow(db, Date.now());
  if (!win.active) {
    writeIdleRun(db, win);
    return {
      status: 'idle', job: JOB, phase: 'live',
      requests: 0, reason: win.reason,
      liveCount: win.liveCount, upcomingCount: win.upcomingCount
    };
  }
  const r = await syncFixtures({
    jobName: JOB,
    phase: 'live',
    pairs: win.pairs,
    priority: 'critical', // %90 bütçede bile canlı skor yaşamalıdır
    quietSkipped: opts.quietSkipped
  });
  return { ...r, window: win };
}

/**
 * Tek seferlik düzeltme senkronu (finished + 30 dk): o (lig, gün) çiftini
 * bir kez daha çeker; başarılıysa ilgili maçları işaretler. Öncelik
 * 'normal' — %90+ bütçede canlı skorun önüne geçmez.
 * @param {{competition:string, competitionId:number, date:string}} pair
 * @returns {Promise<{status:string, marked:number}>}
 */
async function syncCorrection(pair) {
  const r = await syncFixtures({
    jobName: JOB,
    phase: 'correction',
    pairs: [pair],
    priority: 'normal',
    // kira çakışması (ana tur koşarken) sync_runs'a skipped satırı YAZMAZ —
    // one-shot kendini +90 sn'de yeniden dener; başarılı/partial satırı her
    // durumda yazılır.
    quietSkipped: true
  });
  let marked = 0;
  if (r.status === 'success' || r.status === 'partial') {
    const { markCorrectionsSynced } = require('./liveWindow');
    marked = markCorrectionsSynced(db, pair.competitionId, pair.date, Date.now());
  }
  return { ...r, marked };
}

/* liveWindow'dan yeniden ihraç: çağıranlar (liveScoresJob, admin) tek
 * modülden her şeye ulaşabilsin — testler db'siz liveWindow'u doğrudan alır. */
module.exports = {
  JOB, LEASE_NOTE,
  budgetPct, budgetTier,
  syncLiveRound, syncCorrection,
  ...require('./liveWindow')
};
