/**
 * Tribün — puan durumu işi (AŞAMA 7) — server/jobs/standingsJob.js
 *
 * Kütüphane YOK: setTimeout zinciri + hafif jitter (≤ 10 sn). ZAMANLAMA:
 *
 *   her 5 dakikada bir YALNIZCA DB kontrolü (getStandingsDue — istek yok):
 *     • lig hiç senkronlanmadıysa            → senkronla (first_sync)
 *     • son senkron 8 saat+ eskiyse          → senkronla (baseline; günde ~3 kez)
 *     • ligin bir maçı finished'a geçmişse   → senkronla (match_finished;
 *       son senkrondan en az 15 dk geçmişse — "en çok 15 dakikada bir")
 *   due yoksa hiçbir şey yapılmaz (0 istek).
 *
 * Bütçe: fetch DÜŞÜK önceliklidir (%70+ → istek atılmaz). Tur tamamen
 * bütçe redleriyle boşa çıkarsa sonraki kontrol 15 dk sonraya atılır
 * (sync_runs'ı gereksiz doldurmamak için).
 *
 * İstek matematiği (F = futbol ligi sayısı):
 *   taban: 3 × F istek/gün; finished tetikleyicileri: maç günü lig başına
 *   ek en fazla ~4-6 istek (15 dk hız sınırı + tek günde birden çok maç bitişi
 *   birlikte düşer) → F=9 için ~30-70 istek/gün (7000 bütçenin ~%1'i).
 *
 * Güvenlik: SPORTS_SYNC_ENABLED=true iken server/index.js başlatır;
 * SIGINT/SIGTERM'de stopStandingsJob() ile düzgün kapanış; kira kilidi
 * (sync_state 'standings') restart sonrası çift koşuyu engeller.
 */
const db = require('../db');
const {
  syncStandingsRound, getStandingsDue, JOB
} = require('../services/syncStandings');

const CHECK_MS = 5 * 60 * 1000;        // due kontrol aralığı (yalnız DB)
const CHECK_MS_AFTER_BUDGET = 15 * 60 * 1000; // bütçe redli turdan sonra
const JITTER_MS = 10 * 1000;           // +0..10 sn sapma
const LEASE_RETRY_MS = 90 * 1000;      // kira meşgulse sessiz yeniden deneme

const state = {
  started: false,
  stopped: false,
  timer: null,
  nextRunAt: null,
  nextKind: null,
  lastResult: null,
  lastError: null,
  startedAt: null,
  leaseRetry: false
};

/* ---------------- ana döngü ---------------- */

async function tick() {
  if (state.stopped) return;

  const dueInfo = getStandingsDue(db, Date.now());
  const due = dueInfo.comps.filter((c) => c.due);

  if (!due.length) {
    scheduleNext('idle-check', CHECK_MS);
    return;
  }

  const quiet = state.leaseRetry;
  let r = null;
  try {
    r = await syncStandingsRound({
      competitions: due.map((c) => c.slug),
      phase: 'timer',
      quietSkipped: quiet
    });
    state.lastError = null;
  } catch (e) {
    state.lastError = String(e.message).slice(0, 200);
    console.error(`🥇 [puan-durumu] tur hatası: ${e.message}`);
  }

  if (r) {
    state.lastResult = {
      at: new Date().toISOString(),
      status: r.status,
      requests: r.requests || 0,
      updated: r.updated ?? null,
      comps: (r.comps || []).map((c) => ({ slug: c.slug, result: c.result }))
    };
    state.leaseRetry = (r.status === 'skipped' && r.reason === 'lease meşgul');
    if (r.status === 'skipped' && r.reason === 'lease meşgul') {
      scheduleNext('lease-retry', LEASE_RETRY_MS);
      return;
    }
    const budgetStop = (r.comps || []).every((c) => c.result === 'budget' || c.result === 'circuit');
    if (r.status !== 'skipped') {
      console.log(`🥇 [puan-durumu] tur: ${r.status}, ${due.length} lig, ${r.requests} istek, ` +
        `${r.updated} lig güncellendi`);
    }
    scheduleNext('idle-check', budgetStop ? CHECK_MS_AFTER_BUDGET : CHECK_MS);
    return;
  }

  scheduleNext('idle-check', CHECK_MS);
}

function scheduleNext(kind, ivMs) {
  if (state.stopped) return;
  const jitter = Math.floor(Math.random() * JITTER_MS);
  state.nextKind = kind;
  state.nextRunAt = new Date(Date.now() + ivMs + jitter);
  const t = setTimeout(tick, ivMs + jitter);
  t.unref();
  if (state.timer) clearTimeout(state.timer);
  state.timer = t;
}

/* ---------------- admin görünümü ---------------- */

/** GET /api/admin/sports/status için standings bloğu */
function getStandingsJobState() {
  let due = null;
  try { due = getStandingsDue(db, Date.now()); } catch { /* DB erişilemezse null */ }

  return {
    job: JOB,
    running: state.started && !state.stopped,
    started_at: state.startedAt,
    next_run_at: state.nextRunAt ? state.nextRunAt.toISOString() : null,
    next_run_kind: state.nextKind,
    last_result: state.lastResult,
    last_error: state.lastError,
    cadence: { baseline_per_day: 3, finished_cooldown_min: 15, due_check_min: 5 },
    competitions: due ? due.comps : []
  };
}

/** Admin POST /api/admin/sports/sync/standings → anında tur (due kurallarını BEKLEMEZ) */
async function runOnceNow(competition) {
  return syncStandingsRound({
    ...(competition ? { competitions: [competition] } : {}),
    phase: 'manual'
  });
}

/* ---------------- başlat / durdur ---------------- */

function startStandingsJob(opts = {}) {
  if (state.started) return;
  state.started = true;
  state.stopped = false;
  state.startedAt = new Date().toISOString();

  // İlk kontrol: fikstür açılış senkronu (teams havuzu dolsun) için +90 sn
  const firstDelay = opts.firstDelayMs ?? 90 * 1000;
  const t = setTimeout(tick, firstDelay);
  t.unref();
  state.timer = t;
  state.nextRunAt = new Date(Date.now() + firstDelay);
  state.nextKind = 'first';

  const F = db.prepare(
    "SELECT COUNT(*) AS c FROM competitions WHERE is_enabled = 1 AND sport = 'football'"
  ).get().c;
  console.log(`🥇 Puan durumu işi başladı (${F} futbol ligi; taban günde 3 kez; ` +
    'biten maç sonrası en çok 15 dk\'da bir).');
  console.log(`   İstek matematiği: 3×F = ${3 * F} istek/gün + finished tetikleyicileri ` +
    '(~%1 bütçe; bütçe %70+ → düşük öncelik istek ATILMAZ).');
}

function stopStandingsJob() {
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.nextRunAt = null;
}

module.exports = { startStandingsJob, stopStandingsJob, getStandingsJobState, runOnceNow, JOB };
