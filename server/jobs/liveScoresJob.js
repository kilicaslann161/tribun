/**
 * Tribün — canlı skor işi (AŞAMA 5) — server/jobs/liveScoresJob.js
 *
 * Kütüphane YOK: setTimeout zinciri + hafif rastgele sapma (jitter ≤ 10 sn).
 * Tüm kurallar server/services/syncLive.js'te; burada yalnızca ZAMANLAMA:
 *
 *   etkin pencere AÇIK  → tur aralığı = bütçe kademesi (120 → %70'te 240 →
 *                         %90'da 600 sn) × hata çarpanı (ardışık başarısızlıkta
 *                         büyür; sync_state.consecutive_failures'dan okunur),
 *                         üst sınır 30 dk.
 *   etkin pencere KAPALI → 10 dakikada bir YALNIZCA DB kontrolü (istek yok).
 *   tur 'skipped' dönerse (kira meşgul — restart sonrası önceki sürecin kirası
 *                         düşmemişse) 90 sn'de bir sessiz yeniden deneme.
 *
 * DÜZELTME ONE-SHOT'ları: her turdan sonra syncLive.getCorrectionDue ile
 * DB'den türetilir (bellekte "plan listesi" YOK — çökme sonrası kaybolmaz);
 * finished_at + 30 dk'da bir kez ateşlenir, başarılıysa maçlar işaretlenir.
 *
 * Güvenlik: SPORTS_SYNC_ENABLED=true iken server/index.js başlatır;
 * SIGINT/SIGTERM'de stopLiveScoresJob() ile düzgün kapanış; nodemon
 * restart'larında sync_state kirası (locked_until) çift koşuyu engeller.
 */
const {
  syncLiveRound, getLiveWindow, getCorrectionDue,
  intervalForBudget, budgetPct, budgetTier,
  DEFAULT_INTERVAL_SEC, IDLE_CHECK_MS, JOB,
  estimateLiveRequests
} = require('../services/syncLive');
const db = require('../db');

/* Hata geri çekilmesi: ardışık her başarısızlık aralığı 1+kadar büyütür (≤6×) */
const BACKOFF_MAX_MULT = 6;
const MAX_INTERVAL_MS = 30 * 60 * 1000;   // aralık üst sınırı (30 dk)
const JITTER_MS = 10 * 1000;              // +0..10 sn sapma (yüksek anlarda senkron çarpışma yok)
const LEASE_RETRY_MS = 90 * 1000;          // kira meşgulse sessiz deneme aralığı

const state = {
  started: false,
  stopped: false,
  tickTimer: null,          // zincirde TEK bekleyen zamanlayıcı
  correctionTimers: new Map(), // "slug|date" → {timer, fireAtMs}
  nextRunAt: null,
  intervalSec: DEFAULT_INTERVAL_SEC,
  retryLease: false,        // önceki tur kira yüzünden skipped → sessiz hızlı dene
  lastResult: null,
  lastError: null,
  startedAt: null
};

/* ---------------- sync_state okuma ---------------- */

function consecutiveFailures() {
  try {
    const row = db.prepare(
      'SELECT consecutive_failures AS c FROM sync_state WHERE job_name = ?'
    ).get(JOB);
    return row ? Math.max(0, row.c) : 0;
  } catch { return 0; }
}

/** Bütçe kademesi × hata çarpanı (ms); üst sınır 30 dk */
function nextIntervalMs() {
  const pct = budgetPct();
  const baseSec = intervalForBudget(pct, DEFAULT_INTERVAL_SEC);
  const mult = Math.min(1 + consecutiveFailures(), BACKOFF_MAX_MULT);
  return Math.min(baseSec * mult * 1000, MAX_INTERVAL_MS);
}

/* ---------------- düzeltme one-shot'ları ---------------- */

/** DB'den türet: finished + 30 dk kontroli bekleyen (lig, gün) çiftleri.
 *  Çakışmasız dizilim: aynı anda ateşlenen one-shot'lar hep aynı kira
 *  saniyesine düşer → aralarında 15 sn'lik sıra payı eklenir. */
function scheduleCorrections() {
  if (state.stopped) return;
  let due = [];
  try { due = getCorrectionDue(db, Date.now()); } catch (e) {
    console.error(`🔧 [canlı-skor] düzeltme türetimi hatası: ${e.message}`);
    return;
  }
  let slot = 0;
  for (const pair of due) {
    const key = `${pair.competition}|${pair.date}`;
    if (state.correctionTimers.has(key)) continue; // zaten planlı
    const delay = Math.max(1000, pair.fireAtMs - Date.now()) + slot * 15 * 1000;
    slot++;
    const t = setTimeout(() => fireCorrection(key, pair, 0), delay);
    t.unref();
    state.correctionTimers.set(key, {
      timer: t, fireAtMs: Date.now() + delay,
      pair, attempts: 0
    });
  }
}

async function fireCorrection(key, pair, attempt = 0) {
  state.correctionTimers.delete(key); // koştu; tekrar planlamak sonraki türetimin işi
  if (state.stopped) return;
  const { syncCorrection } = require('../services/syncLive');
  try {
    const r = await syncCorrection(pair);
    if (r.status === 'skipped' && attempt < 10) {
      // kira meşgul (ana tur koşuyor) → 90 sn sonra KENDİNİ yeniden dene;
      // 10 deneme sonrası DB türetimine kalır (2 sa bakışla sınırlı zaten)
      const t = setTimeout(() => fireCorrection(key, pair, attempt + 1), LEASE_RETRY_MS);
      t.unref();
      state.correctionTimers.set(key, {
        timer: t, fireAtMs: Date.now() + LEASE_RETRY_MS,
        pair, attempts: attempt + 1
      });
      return;
    }
    console.log(`🔧 [canlı-skor] düzeltme senkronu (${key}): ${r.status}, işaretlenen maç: ${r.marked}` +
      (attempt ? ` (deneme ${attempt + 1})` : ''));
  } catch (e) {
    // Satır işaretlenmedi → sonraki tur yeniden türetir (fireAt = şimdi+60 sn);
    // tur aralığına bağlı olarak ~2-10 dk'da bir yeniden denenir, 2 sa bakışla sınırlı.
    console.error(`🔧 [canlı-skor] düzeltme senkronu hatası (${key}): ${e.message}`);
  }
}

/* ---------------- ana döngü ---------------- */

async function tick() {
  if (state.stopped) return;
  const quiet = state.retryLease; // kira yüzünden skipped olan denemeler sync_runs'a YAZILMAZ
  let r = null;
  try {
    r = await syncLiveRound({ quietSkipped: quiet });
    state.lastError = null;
  } catch (e) {
    state.lastError = e.message;
    console.error(`🔴 [canlı-skor] tur hatası: ${e.message}`);
  }

  if (r) {
    state.lastResult = summarize(r);
    state.retryLease = (r.status === 'skipped');
    if (r.status === 'idle') {
      console.log(`⏸️  [canlı-skor] ${r.reason} (0 istek; 10 dk sonra yalnız-DB kontrolü)`);
    } else if (r.status === 'skipped') {
      // sessiz: kira düşene dek 90 sn'de bir deneniyor
    } else {
      const p = r.window ? r.window.pairs.length : 0;
      console.log(`🔴 [canlı-skor] tur: ${r.status}, ${p} çift, ${r.requests} istek, ` +
        `${r.seen} kayıt, ${r.upserted} yazma${r.frozen ? `, ${r.frozen} donmuş atla` : ''}`);
    }
  }

  scheduleCorrections();
  scheduleNext(r ? r.status : 'error');
}

function summarize(r) {
  return {
    at: new Date().toISOString(),
    status: r.status,
    job: r.job || JOB,
    requests: r.requests || 0,
    seen: r.seen ?? null,
    upserted: r.upserted ?? null,
    skipped: r.skipped ?? null,
    failedPairs: r.failedPairs ?? null,
    frozen: r.frozen ?? null,
    liveCount: r.liveCount ?? (r.window ? r.window.liveCount : null),
    upcomingCount: r.upcomingCount ?? (r.window ? r.window.upcomingCount : null),
    pairs: r.window ? r.window.pairs.length : null,
    reason: r.reason || null
  };
}

/** Sonraki turu planla: kira-retry > etkinse bütçe aralığı > boştaysa 10 dk */
function scheduleNext(lastStatus) {
  if (state.stopped) return;
  let ivMs;
  let kind;
  if (lastStatus === 'skipped') {
    ivMs = LEASE_RETRY_MS; kind = 'lease-retry';
  } else {
    const win = getLiveWindow(db, Date.now()); // yalnız DB — ucuz
    if (win.active) {
      ivMs = nextIntervalMs(); kind = 'round';
    } else {
      ivMs = IDLE_CHECK_MS; kind = 'idle-check';
    }
  }
  const jitter = Math.floor(Math.random() * JITTER_MS);
  state.intervalSec = Math.round(ivMs / 1000);
  state.nextRunKind = kind;
  state.nextRunAt = new Date(Date.now() + ivMs + jitter);
  const t = setTimeout(tick, ivMs + jitter);
  t.unref();
  if (state.tickTimer) clearTimeout(state.tickTimer);
  state.tickTimer = t;
}

/* ---------------- ömür boyunca durum (admin status) ---------------- */

/**
 * GET /api/admin/sports/status'un live bloğu. İş hiç başlatılmamışsa da
 * çağrılabilir (running:false) — pencere/bütçe kısımları DB'den hesaplanır.
 */
function getLiveJobState() {
  let win = null;
  let pct = null;
  let cf = null;
  let dueCorrections = [];
  try {
    win = getLiveWindow(db, Date.now());
    pct = budgetPct();
    cf = consecutiveFailures();
    dueCorrections = getCorrectionDue(db, Date.now());
  } catch { /* DB erişilemezse kalan alanlar null kalır */ }

  const scheduled = [...state.correctionTimers.entries()]
    .map(([key, v]) => ({ pair: key, fireAt: new Date(v.fireAtMs).toISOString() }))
    .sort((a, b) => a.fireAt.localeCompare(b.fireAt));

  return {
    job: JOB,
    running: state.started && !state.stopped,
    started_at: state.startedAt,
    next_run_at: state.nextRunAt ? state.nextRunAt.toISOString() : null,
    next_run_kind: state.nextRunKind || null,
    interval_sec: state.intervalSec,
    consecutive_failures: cf,
    last_result: state.lastResult,
    last_error: state.lastError,
    window: win,                       // {active, liveCount, upcomingCount, pairs[], reason}
    budget: pct === null ? null : {
      pct: Math.round(pct * 1000) / 10,
      tier: budgetTier(pct),
      interval_sec: intervalForBudget(pct, DEFAULT_INTERVAL_SEC)
    },
    corrections: {
      scheduled,                       // bellekteki one-shot'lar (ateşlenme saatleriyle)
      pending_in_db: dueCorrections.length,
      due_pairs: dueCorrections.map((p) => ({
        pair: `${p.competition}|${p.date}`, matches: p.matches,
        fireAt: new Date(p.fireAtMs).toISOString()
      }))
    },
    estimate: win ? estimateLiveRequests(win.pairs.length, state.intervalSec) : null
  };
}

/** Admin POST /api/admin/sports/sync/live → tek seferlik anında tur */
async function runOnceNow() {
  return syncLiveRound({ quietSkipped: false });
}

/* ---------------- başlat / durdur ---------------- */

function startLiveScoresJob(opts = {}) {
  if (state.started) return;
  state.started = true;
  state.stopped = false;
  state.startedAt = new Date().toISOString();

  // İlk tur: fikstür işinin açılış senkronundan (3 sn) sonra, küçük gecikmeyle
  const firstDelay = opts.firstDelayMs ?? 15 * 1000;
  const t = setTimeout(tick, firstDelay);
  t.unref();
  state.tickTimer = t;
  state.nextRunAt = new Date(Date.now() + firstDelay);
  state.nextRunKind = 'first';

  const est = estimateLiveRequests(1, DEFAULT_INTERVAL_SEC);
  console.log(`🔴 Canlı skor işi başladı (temel aralık ${DEFAULT_INTERVAL_SEC} sn; ` +
    `%70 → 240 sn, %90 → 600 sn; boştada yalnız-DB kontrolü 10 dk'da bir).`);
  console.log(`   İstek matematiği: ${est.formula}`);
}

function stopLiveScoresJob() {
  state.stopped = true;
  if (state.tickTimer) clearTimeout(state.tickTimer);
  for (const c of state.correctionTimers.values()) clearTimeout(c.timer);
  state.correctionTimers.clear();
  state.tickTimer = null;
  state.nextRunAt = null;
}

module.exports = { startLiveScoresJob, stopLiveScoresJob, getLiveJobState, runOnceNow };
