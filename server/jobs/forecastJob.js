/**
 * Tribün — Kâhin Sensin denetim işi (AŞAMA 9)
 *
 * Kütüphanesiz setTimeout zinciri (scheduler/liveScoresJob deseni). Her 5 dakikada
 * bir YALNIZ-DB denetim: processForecastSettlements bağlı maçları gözler
 * (otomatik sonuçlandırma / sağlayıcı düzeltmesi / inceleme bayrakları).
 * SportScore'a ASLA istek atmaz — skor değişimleri senkron işleri tarafından
 * matches tablosuna yazılır; bu iş yalnızca o tabloyu okur.
 *
 * Senkron turlarının hemen sonrasında da aynı denetim syncFixtures içinde
 * koşar (kanka); bu periyodik süpürme, senkronlar arası beklemede geçen
 * 30 dakikalık sürenin dolmasını yakalar (senkron yokken bile saat ilerler).
 */
const db = require('../db');
const { processForecastSettlements } = require('../services/forecastCore');

const SWEEP_MS = 5 * 60 * 1000; // 5 dakika
let timer = null;
let running = false;

function sweep() {
  if (running) return; // üst üste binme yok
  running = true;
  try {
    const r = processForecastSettlements(db);
    if (r.settled.length || r.corrections.length || r.flagged.length) {
      console.log(`🔮 [forecast-job] settled=${r.settled.length} ` +
        `corrections=${r.corrections.length} flagged=${r.flagged.length} observed=${r.observed}`);
      for (const s of r.settled) {
        console.log(`   ✅ fixture #${s.fixture_id} (maç ${s.match_id}): ${s.score.home}-${s.score.away} → ${s.predictions} tahmine ${s.awarded} puan`);
      }
      for (const c of r.corrections) {
        console.log(`   🔧 fixture #${c.fixture_id} düzeltme: ${c.from.home}-${c.from.away} → ${c.to.home}-${c.to.away}`);
      }
    }
  } catch (e) {
    console.error(`🔮 [forecast-job] süpürme hatası: ${e.message}`);
  } finally {
    running = false;
  }
}

function schedule() {
  timer = setTimeout(() => {
    sweep();
    schedule();
  }, SWEEP_MS);
  if (timer.unref) timer.unref(); // süreç kapanmasını engellemesin
}

function startForecastJob() {
  if (timer) return;
  console.log(`🔮 [forecast-job] Kâhin Sensin denetimi başladı (${SWEEP_MS / 1000} sn aralıkla, yalnız-DB)`);
  sweep(); // açılışta ilk tarama (restart sonrası gecikme olmasın)
  schedule();
}

function stopForecastJob() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function getForecastJobState() {
  return { running: !!timer, interval_ms: SWEEP_MS, sweeping: running };
}

module.exports = { startForecastJob, stopForecastJob, getForecastJobState, sweepOnce: sweep };
