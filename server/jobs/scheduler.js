/**
 * Tribün — spor senkron zamanlayıcısı (AŞAMA 3)
 *
 * Kütüphane YOK: setTimeout zinciri + hafif rastgele sapma (jitter).
 * DÖRT ayrı faz, her biri kendi penceresiyle (server/jobs/fixturesJob.js):
 *   canlı (D,D+1) → 3 saatte bir   (günde 8 tur)
 *   dün (D-1)      → 6 saatte bir   (günde 4 tur)
 *   D-2            → 24 saatte bir  (günde 1 tur)
 *   gelecek (D+2..D+7) → 24 saatte bir (günde 1 tur)
 *
 * Günlük istek tahmini (L = is_enabled=1 lig): 2×L×8 + L×4 + L + 6×L = 27×L
 * → L=11 için ~297 istek/gün. Hesap estimateDailyRequests() ile otomatik;
 * zamanlayıcı açılırken gerçek lig sayısıyla birlikte loglanır.
 *
 * Güvenlik:
 *  • SPORTS_SYNC_ENABLED=true ise server/index.js içinde başlatılır (aksi halde hiç istek atılmaz)
 *  • SIGINT/SIGTERM'de stopScheduler() ile düzgün kapanış
 *  • nodemon restart'larında sync_state'teki kira kilidi (locked_until) çift koşuyu engeller
 *  • Her çalıştırma sync_runs'a yazılır (syncFixtures içinde, tek transaction'da)
 *  • Fazlar başlangıçta KADEMELİ ilk koşuyla tetiklenir (canlı önce; kira kilidi
 *    eşzamanlı ikinci koşuyu zaten reddeder — sıra yalnızca öncelik içindir)
 */
const {
  runLiveWindow, runYesterdayWindow, runHistoryWindow, runFutureWindow
} = require('./fixturesJob');
const { estimateDailyRequests } = require('../services/syncFixtures');
const db = require('../db');

let timers = [];
let stopped = false;

const jitter = (baseMs) => baseMs + Math.floor(Math.random() * 5 * 60 * 1000); // +0..5 dk sapma

/** Tek işi güvenli sarar: hata yutulur (loglanır), zincir ASLA kırılmaz.
 *  Sonuç NESNESİ döner (null: hata) — açılış catch-up'ı buna göre karar verir. */
async function safeRun(label, fn, quiet) {
  if (stopped) return null;
  try {
    const r = await fn(quiet);
    if (!(r && r.status === 'skipped' && quiet)) console.log(`🔄 [${label}] tamam: ${JSON.stringify(r)}`);
    return r || null;
  } catch (e) {
    console.error(`🔄 [${label}] hata: ${e.message}`);
    return null;
  }
}

/**
 * fn ilk koşuyu (quiet=false) firstDelayMs sonrasında yapar.
 * AÇILIŞ CATCH-UP: ilk koşu kira kilidi yüzünden 'skipped' dönerse (örn. restart
 * anında önceki sürecin kirası hâlâ düşmemişse) kira düşene dek 90 sn'de bir
 * sessizce (quiet=true → sync_runs'a skipped satırı YAZMAZ) yeniden denenir;
 * en fazla 8 deneme (~12 dk > kira süresi 10 dk). Normal koşudan sonra zincir
 * intervalMs+jitter ile devam eder. unref() → süreci bekletmez.
 */
function loop(label, fn, intervalMs, firstDelayMs) {
  const schedule = () => {
    if (stopped) return;
    const t = setTimeout(async () => {
      await safeRun(label, fn, false);
      schedule();
    }, jitter(intervalMs));
    t.unref();
    timers.push(t);
  };
  const firstAttempt = async (attempt) => {
    if (stopped) return;
    const r = await safeRun(label, fn, attempt > 0);
    const blocked = (r && r.status === 'skipped');
    if (attempt === 0 && !blocked) { schedule(); return; }   // temiz açılış → normal zincir
    if (blocked && attempt < 8) {                            // kilit düşene dek yakala
      const t = setTimeout(() => firstAttempt(attempt + 1), 90 * 1000);
      t.unref(); timers.push(t);
      return;
    }
    schedule(); // deneme tükendi ya da ilk koşu hata verdi → normal zincire geç
  };
  const first = setTimeout(() => firstAttempt(0), firstDelayMs);
  first.unref();
  timers.push(first);
}

function startScheduler() {
  stopped = false;

  // Başlangıçta kademeli ilk koşular (kira kilidi tek koşuyu garanti eder):
  // canlı pencere hemen (en kritik), diğerleri küçük gecikmelerle tetiklenir.
  loop('canlı-pencere (D,D+1)', runLiveWindow, 3 * 60 * 60 * 1000, 3000);
  loop('dün (D-1)', runYesterdayWindow, 6 * 60 * 60 * 1000, 45000);
  loop('D-2', runHistoryWindow, 24 * 60 * 60 * 1000, 80000);
  loop('gelecek-hafta (D+2..D+7)', runFutureWindow, 24 * 60 * 60 * 1000, 120000);

  // Günlük istek tahmini — lig sayısı değişirse otomatik güncellenir (kural 1)
  const leagues = db.prepare('SELECT COUNT(*) AS c FROM competitions WHERE is_enabled = 1').get().c;
  const est = estimateDailyRequests(leagues);
  console.log(`⏱️  Spor senkron zamanlayıcısı başladı (${est.leagues} lig).`);
  console.log(`   Günlük tahmin: ${est.formula.replace(/L/g, est.leagues)} = ~${est.total} istek/gün`);
  console.log('   Fazlar: canlı 3sa · dün 6sa · D-2 24sa · gelecek 24sa (jitter +0-5dk)');
}

function stopScheduler() {
  stopped = true;
  for (const t of timers) clearTimeout(t);
  timers = [];
}

module.exports = { startScheduler, stopScheduler };
