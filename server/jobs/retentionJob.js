/**
 * Tribün — retention (veri tutma) işi (AŞAMA 10)
 *
 * Günlük BİR kez çalışır; kütüphanesiz setTimeout zinciri (diğer işlerin deseni).
 *  - İlk koşu: açılıştan 15 dk sonra (taze açılan sunucu birikmiş veriyi hemen temizler)
 *  - Sonraki koşular: 24 saat ± 30 dk jitter (gece yarısına denk gelmemesi için değil;
 *    amaç, saat tam vururken diğer işlerle aynı anda uyanmaması)
 *  - Hata YUTULMAZ: loglanır, bir sonraki 24 saat turunda tekrar denenir.
 *  - sync_state'e YAZMAZ (bu bir senkron değil, bakım turudur; kira kilidi gerekmez —
 *    silme sorguları idempotent, iki tur çakışırsa da zarar yok).
 *
 * start/stop düzgün kapanma: SIGINT/SIGTERM'de index.js çağırır.
 */
const db = require('../db');
const { runRetention } = require('../services/retention');

const FIRST_RUN_MS = 15 * 60 * 1000;          // açılış + 15 dk
const INTERVAL_MS = 24 * 60 * 60 * 1000;      // 24 saat
const JITTER_MAX_MS = 30 * 60 * 1000;         // ±30 dk

let timer = null;
let running = false;
let lastResult = null;
let nextRunAt = null;

const jitter = () => Math.floor((Math.random() * 2 - 1) * JITTER_MAX_MS);

function scheduleNext(delayMs) {
  nextRunAt = new Date(Date.now() + delayMs).toISOString();
  timer = setTimeout(async () => {
    if (running) return; // zaten koşuyor (teorik; timer zinciri tek)
    running = true;
    try {
      const r = await runRetention(db);
      lastResult = r;
      console.log(`🧹 [retention] ${r.deleted_sync_runs} eski koşu (>${r.cutoff_sync_runs.slice(0, 10)}) + ` +
        `${r.deleted_match_details} eski detay (>${r.cutoff_match_details.slice(0, 10)}) silindi.`);
    } catch (e) {
      console.error(`🧹 [retention] hata: ${e.message}`);
    } finally {
      running = false;
      scheduleNext(INTERVAL_MS + jitter());
    }
  }, delayMs);
}

function startRetentionJob() {
  if (timer) return; // çift başlatma yok
  console.log(`🧹 Retention işi başladı (ilk tur +${Math.round(FIRST_RUN_MS / 60000)} dk; sonra 24 saatte bir ±30 dk).`);
  console.log(`   Politika: sync_runs > 30 gün, match_details > 90 gün silinir.`);
  scheduleNext(FIRST_RUN_MS + jitter());
}

function stopRetentionJob() {
  if (timer) clearTimeout(timer);
  timer = null;
  nextRunAt = null;
}

/** Admin paneli için durum (koşuyor mu, sıradaki tur, son sonuç) */
function getRetentionJobState() {
  return { running, next_run_at: nextRunAt, last_result: lastResult };
}

module.exports = { startRetentionJob, stopRetentionJob, getRetentionJobState };
