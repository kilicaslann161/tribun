/**
 * Tribün — fikstür işleri / faz pencereleri (AŞAMA 3)
 *
 * Türkiye gününün kapsadığı UTC günleri ve sıklıkları (talimat matrisi):
 *  • CANLI (UTC D ve D+1) : günde 8 tur (3 saatte bir)
 *    — TR bugünün akşam saatleri UTC D'e, TR yarının ilk saatleri UTC D+1'e düşer
 *  • DÜN (UTC D-1)         : günde 4 tur (6 saatte bir) — sonuçlar otursun
 *  • D-2                   : günde 1 tur — TR'deki "dün" listesinin son saatleri
 *    D-2'ye düşer; finished maçlar yeniden çekilmez ama tur yine de bir kez atılır
 *  • GELECEK (UTC D+2..D+7): günde 1 tur — fikstür günler önceden dolsun
 *
 * İSTEK MATEMATİĞİ (L = is_enabled=1 lig sayısı; kod + README'de):
 *   2×L×8 + L×4 + L×1 + 6×L = 27×L
 *   L=11 → 176 + 44 + 11 + 66 = 297 istek/gün (günlük bütçe 7000 ≈ %4'ü)
 * Bu hesabı estimateDailyRequests() otomatik yapar; zamanlayıcı açılırken
 * gerçek lig sayısıyla birlikte loglanır (lig sayısı değişirse tahmin de değişir).
 */
const { syncFixtures } = require('../services/syncFixtures');

function utcDay(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** CANLI pencere: UTC bugün (D) + yarın (D+1) → 3 saatte bir, 8 tur/gün */
/** quiet: zamanlayıcının açılış catch-up denemeleri için (lease-skipped sync_runs'a yazmaz) */
function runLiveWindow(quiet) {
  return syncFixtures({ phase: 'live', dates: [utcDay(0), utcDay(1)], quietSkipped: !!quiet });
}

/** DÜN pencere: UTC D-1 → 6 saatte bir, 4 tur/gün */
function runYesterdayWindow(quiet) {
  return syncFixtures({ phase: 'yesterday', dates: [utcDay(-1)], quietSkipped: !!quiet });
}

/** D-2 pencere: TR "dün"ünün kuyruğu → günde 1 tur */
function runHistoryWindow(quiet) {
  return syncFixtures({ phase: 'history', dates: [utcDay(-2)], quietSkipped: !!quiet });
}

/** GELECEK pencere: UTC D+2..D+7 → günde 1 tur */
function runFutureWindow(quiet) {
  return syncFixtures({ phase: 'future', dates: [0, 1, 2, 3, 4, 5].map((i) => utcDay(2 + i)), quietSkipped: !!quiet });
}

module.exports = { runLiveWindow, runYesterdayWindow, runHistoryWindow, runFutureWindow };
