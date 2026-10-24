/**
 * Tribün — AŞAMA 10 dayanıklılık (resilience) testleri (node:test)
 *
 * Talimattaki 12 senaryo:
 *  1. SportScore erişilemez (ağ/zaman aşımı) → koşu failed, veri sabit, yeniden deneme 2
 *  2. Bozuk JSON → koşu failed, ham gövde sızmaz, yeniden deneme YOK
 *  3. Boş liste (count=0) GEÇERLİ vs hatalı boş yanıt (5xx) FAILED — ikisi karışmaz
 *  4. 429 → Retry-After'a uyulan devre kesici + etkin limit düşürme; sonraki istek atılmaz
 *  5. Şema değişikliği: geçersiz kayıt atlanır, koşu ÇÖKMEZ, geçerli kayıt yazılır
 *  6. Skor: metin '3' → sayı 3; sayıya çevrilemeyen skor → kayıt reddedilir
 *  7. Senkron ortasında süreç çöker → kira süresi bitince tur KENDİNİ KURTARIR;
 *     stop çağrıları timersız da güvenli (düzgün kapanma)
 *  8. Çift koşu/çift süreç: kira kilidi ikinci eşzamanlı senkronu 'skipped' yapar (0 istek)
 *  9. Bütçe kademeleri: %70 → 'low' red, %90 → yalnız 'critical', %100 → hepsi durur
 * 10. Gün sınırı: api_usage UTC güne göre anahtarlanır; dünkü istekler bugüne KARIŞMAZ;
 *     gün değişince etkin limit DAILY_BUDGET'e döner
 * 11. DB kilidi: ikinci bağlantı yazma kilidinde SQLITE_BUSY'yi ZAMAN AŞIMIYLA alır
 *     (busy_timeout; asılı kalmaz), ana bağlantıda busy_timeout=5000
 * 12. Basketbol: aynı gün aynı iki takım → external_id 'slug@gün' çakışması:
 *     İLKİ alınır, ikincisi meta.duplicates'a loglanır (satır sayısı 1 kalır)
 *
 * ⚠️ YÜKLEME NOTU: bu dosya GERÇEK modülleri (db singleton + sportScoreClient +
 * syncFixtures) kullanır; izolasyon TRIBUN_DB_PATH=':memory:' ile sağlanır
 * (AŞAMA 10'da db.js'e eklenen destek). ENV, modüller YÜKLENMEDEN ÖNCE ayarlanır.
 * global.fetch her senaryoda mock'lanır; gerçek ağ istediği ATILMAZ.
 */
process.env.TRIBUN_DB_PATH = ':memory:';
process.env.SPORTSCORE_DAILY_BUDGET = '100'; // kademeler için küçük, net bütçe
process.env.SPORTSCORE_TIMEOUT_MS = '2000';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const test = require('node:test');
const assert = require('node:assert');

/* ---- modüller (ENV sonrası; sıra önemli) ---- */
const db = require('../db');

/* ---- şema ÖNCE: syncFixtures module yüklenirken prepare() çağırır
 *      (tabloların o anda VAR OLMASI gerekir) ---- */
const MIGRATION_MODULES = [
  require('../migrations/001_sports_tables'),
  require('../migrations/002_unmapped_and_meta'),
  require('../migrations/003_fixture_sync_columns'),
  require('../migrations/004_live_scores_columns'),
  require('../migrations/005_standings'),
  require('../migrations/006_match_detail'),
  require('../migrations/007_forecast_kahin_sensin'),
  require('../migrations/008_asama10_monitoring')
].sort((a, b) => a.version - b.version);
for (const m of MIGRATION_MODULES) m.up(db);

// migrate() DEĞİL (yedek üretmez); allowlist ligleri elle upsert et
const { upsertCompetitions } = require('../migrations');
upsertCompetitions(); // 11 gerçek allowlist ligi (is_enabled=1, slug_status='active')

/* ---- şema hazır; artık prepare-at-load modülleri güvenle yüklenebilir ---- */
const client = require('../services/sportScoreClient');
const { syncFixtures } = require('../services/syncFixtures');
const { runRetention } = require('../services/retention');

/* ---------------- yardımcılar ---------------- */

const dayUtc = () => new Date().toISOString().slice(0, 10);
const yesterdayUtc = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const realFetch = global.fetch;

function lastRun() {
  return db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get();
}
function metaOf(run) {
  try { return run && run.meta ? JSON.parse(run.meta) : {}; } catch { return {}; }
}
function matchesCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
}
function usageNow() {
  return db.prepare('SELECT COALESCE(SUM(count),0) AS c FROM api_usage WHERE day_utc = ?').get(dayUtc()).c;
}
function setUsage(n) {
  db.prepare('DELETE FROM api_usage WHERE day_utc = ?').run(dayUtc());
  if (n > 0) {
    db.prepare('INSERT INTO api_usage (day_utc, endpoint, count) VALUES (?, ?, ?)')
      .run(dayUtc(), 'test', n);
  }
}
function cleanState() {
  db.exec('DELETE FROM matches; DELETE FROM teams; DELETE FROM sync_runs; DELETE FROM sync_state; DELETE FROM unmapped_values;');
  setUsage(0);
  client._internal.cb.openUntil = 0;
  client._internal.cb.failures = 0;
  client._internal.resetDay(); // etkin limit → DAILY_BUDGET (100)
}
/** fetch mock: durum kodu + gövde (nesne ya da ham metin) + sayacın kendisi döner */
function mockFetch(handler) {
  let calls = 0;
  global.fetch = async (url, opts) => {
    calls++;
    return handler(url, opts, calls);
  };
  return () => calls;
}
const jsonResponse = (status, body) => ({
  status,
  headers: new Map(),
  ok: status < 400,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
});
function restoreFetch() { global.fetch = realFetch; }

/* senaryoların kullandığı sabit lig/kayıtlar (allowlist'ten gerçek slug'lar) */
const SL = 'turkish-super-league';
const FB_MATCH = {
  home: 'Ankara SK', away: 'Izmir FK',
  home_logo: 'https://img.thesports.com/a.png', away_logo: 'https://img.thesports.com/b.png',
  home_score: '3', away_score: '0',
  status: 'finished', status_text: 'Finished',
  time: '2030-01-01T18:00:00+00:00',
  competition: 'Turkish Super League',
  url: '/football/match/ankara-sk-vs-izmir-fk/abc123xyz/'
};

test.beforeEach(() => { cleanState(); });
test.afterEach(() => { restoreFetch(); });
test.after(() => { db.close(); });

/* ---------------- 1) SportScore erişilemez ---------------- */
test('1) ağ hatası: yeniden deneme (1+2), koşu failed, veri sabit', async () => {
  const calls = mockFetch(() => Promise.reject(new TypeError('fetch failed')));
  const r = await syncFixtures({ jobName: 't1', pairs: [{ competition: SL, date: '2030-01-01' }] });

  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(calls(), 3, 'ağ hatası 2 yeniden deneme → toplam 3 deneme');
  const run = lastRun();
  assert.strictEqual(run.status, 'failed');
  assert.ok(/a[gğ]\/zaman a[sş][iı]m[iı]/.test(run.error_message), 'hata mesajı: ağ/zaman aşımı');
  assert.strictEqual(matchesCount(), 0, 'hiçbir maç yazılmadı');
  const st = db.prepare("SELECT consecutive_failures FROM sync_state WHERE job_name = 't1'").get();
  assert.strictEqual(st.consecutive_failures, 1, 'art arda hata sayacı arttı');
});

/* ---------------- 2) Bozuk JSON ---------------- */
test('2) bozuk JSON: yeniden deneme yok, koşu failed, gövde sızmaz', async () => {
  const calls = mockFetch(() => jsonResponse(200, '<html>bu json degil {{{'));
  const r = await syncFixtures({ jobName: 't2', pairs: [{ competition: SL, date: '2030-01-01' }] });

  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(calls(), 1, 'JSON hatası yeniden denenmez');
  const run = lastRun();
  assert.strictEqual(run.status, 'failed');
  assert.ok(run.error_message.includes('Geçersiz JSON'), 'hata: Geçersiz JSON yanıtı');
  assert.ok(!run.error_message.includes('<html'), 'ham gövde hata mesajına SIzmaz');
  assert.strictEqual(matchesCount(), 0);
});

/* ---------------- 3) Boş liste vs hatalı boş yanıt ---------------- */
test('3a) count=0 GEÇERLİ: success, 0 kayıt (o gün maç yok)', async () => {
  mockFetch(() => jsonResponse(200, { count: 0, matches: [] }));
  const r = await syncFixtures({ jobName: 't3', pairs: [{ competition: SL, date: '2030-01-01' }] });

  assert.strictEqual(r.status, 'success');
  assert.strictEqual(r.seen, 0);
  assert.strictEqual(r.upserted, 0);
  assert.strictEqual(lastRun().status, 'success');
  assert.strictEqual(usageNow(), 1, 'istek bütçeden düştü (1)');
});

test('3b) 5xx boş yanıt FAILED: veri değişmez, success ile KARIŞMAZ', async () => {
  const calls = mockFetch(() => jsonResponse(500, { error: 'upstream' }));
  const r = await syncFixtures({ jobName: 't3b', pairs: [{ competition: SL, date: '2030-01-01' }] });

  assert.strictEqual(r.status, 'failed');
  assert.ok(calls() >= 2, '5xx yeniden denenir');
  assert.strictEqual(lastRun().status, 'failed');
  assert.strictEqual(matchesCount(), 0);
});

/* ---------------- 4) 429 + devre kesici ---------------- */
test('4) 429: Retry-After devre kesici açar; sonraki istek ağa ÇIKMAZ; limit düşer', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    const res = jsonResponse(429, { error: 'rate limited' });
    res.headers = new Map([['retry-after', '30']]);
    return res;
  };

  await assert.rejects(
    () => client.fetchFixtures({ sport: 'football', date: '2030-01-01', competition: SL, priority: 'normal' }),
    (e) => e instanceof client.BudgetError && /429/.test(e.message)
  );
  assert.strictEqual(calls, 1);
  assert.strictEqual(client.effectiveLimit(), 1, 'etkin limit, kullanılanın %80’ine çekildi (1 istek → 1)');

  // Devre kesici açık: ikinci istek CircuitOpenError, fetch çağrılmaz
  await assert.rejects(
    () => client.fetchFixtures({ sport: 'football', date: '2030-01-01', competition: SL, priority: 'critical' }),
    (e) => e instanceof client.CircuitOpenError
  );
  assert.strictEqual(calls, 1, 'devre kesici açıkken ağa istek ATILMADI');
});

/* ---------------- 5) Şema değişikliği ---------------- */
test('5) şema değişikliği: geçersiz kayıt atlanır, koşu çökmez, geçerli kayıt yazılır', async () => {
  mockFetch(() => jsonResponse(200, {
    count: 2,
    matches: [
      FB_MATCH,
      { status: 'finished', time: '2030-01-01T20:00:00+00:00' } // url/takım/skor yok → geçersiz
    ]
  }));
  const r = await syncFixtures({ jobName: 't5', pairs: [{ competition: SL, date: '2030-01-01' }] });

  assert.strictEqual(r.status, 'success', 'geçersiz kayıt tüm koşuyu düşürmez');
  assert.strictEqual(r.seen, 1);
  assert.strictEqual(r.upserted, 1);
  assert.strictEqual(r.skipped, 1);
  const m = metaOf(lastRun());
  assert.ok(Array.isArray(m.invalidRecords) && m.invalidRecords.length === 1,
    'geçersiz kayıt meta.invalidRecords’a loglandı');
  assert.strictEqual(matchesCount(), 1, 'yalnız geçerli kayıt yazıldı');
});

/* ---------------- 6) Skor: metin vs sayı ---------------- */
test('6) skor metni sayıya çevrilir; çevrilemeyen kayıt reddedilir', async () => {
  mockFetch(() => jsonResponse(200, {
    count: 2,
    matches: [
      FB_MATCH, // home_score: '3' (metin) → 3
      { ...FB_MATCH, url: '/football/match/ankara-sk-vs-izmir-fk/bad456/',
        home_score: 'x9', away_score: '1' } // sayı değil → kayıt reddi
    ]
  }));
  const r = await syncFixtures({ jobName: 't6', pairs: [{ competition: SL, date: '2030-01-01' }] });

  assert.strictEqual(r.upserted, 1);
  assert.strictEqual(r.skipped, 1, 'çöp skorlu kayıt reddedildi');
  const row = db.prepare("SELECT home_score, away_score FROM matches WHERE external_id = 'abc123xyz'").get();
  assert.strictEqual(row.home_score, 3, "'3' metni → 3 sayısı");
  assert.strictEqual(row.away_score, 0, "'0' metni → 0 sayısı (gerçek sıfır korunur)");
});

/* ---------------- 7) Kapanma anında çökme → kira düşer, tur kurtulur ---------------- */
test('7) süreç çöktü: kira süresi dolunca aynı iş devam eder; stop çağrıları güvenli', async () => {
  const now = new Date().toISOString();
  // "Başka bir süreç" kirası: 5 dakika sonra düşecek gibi görünür ama...
  db.prepare(`INSERT INTO sync_state (job_name, locked_until, locked_by, last_run_at, consecutive_failures)
              VALUES ('crash-job', ?, 'pid999-eski-surec', ?, 0)`)
    .run(new Date(Date.now() + 5 * 60 * 1000).toISOString(), now);

  mockFetch(() => jsonResponse(200, { count: 0, matches: [] }));
  const busy = await syncFixtures({ jobName: 'crash-job', pairs: [{ competition: SL, date: '2030-01-01' }] });
  assert.strictEqual(busy.status, 'skipped', 'kira eldeyken tur atlanır (0 istek)');
  assert.strictEqual(busy.requests, 0);

  // Süreç 10 dk önce "çöktü" varsayımı: kira süresi dolmuş → tekrar alınabilir
  db.prepare("UPDATE sync_state SET locked_until = ? WHERE job_name = 'crash-job'")
    .run(new Date(Date.now() - 60 * 1000).toISOString());

  const recovered = await syncFixtures({ jobName: 'crash-job', pairs: [{ competition: SL, date: '2030-01-01' }] });
  assert.strictEqual(recovered.status, 'success', 'kira düşünce tur kendini kurtardı');

  // Düzgün kapanma: timersız stop çağrıları da zararsız (SIGINT/SIGTERM yolu)
  const { stopScheduler } = require('../jobs/scheduler');
  const { stopLiveScoresJob } = require('../jobs/liveScoresJob');
  const { stopStandingsJob } = require('../jobs/standingsJob');
  const { stopForecastJob } = require('../jobs/forecastJob');
  const { startRetentionJob, stopRetentionJob, getRetentionJobState } = require('../jobs/retentionJob');
  assert.doesNotThrow(() => { stopScheduler(); stopLiveScoresJob(); stopStandingsJob(); stopForecastJob(); stopRetentionJob(); },
    'başlatılmamış işleri durdurmak hata vermez');
  startRetentionJob();
  assert.ok(getRetentionJobState().next_run_at, 'retention işi sıradaki turu planladı');
  assert.doesNotThrow(() => stopRetentionJob());
  assert.strictEqual(getRetentionJobState().next_run_at, null, 'stop sonrası zamanlayıcı temizlendi');
});

/* ---------------- 8) Çift koşu (kira kilidi) ---------------- */
test('8) eşzamanlı ikinci senkron: kira kilidi → skipped, 0 istek', async () => {
  // İsteyi bilinçli yavaşlat: A turu fetch'i beklerken B başlar
  mockFetch(() => new Promise((r) => setTimeout(() => r(jsonResponse(200, { count: 0, matches: [] })), 250)));

  const pA = syncFixtures({ jobName: 't8', pairs: [{ competition: SL, date: '2030-01-01' }] });
  const pB = syncFixtures({ jobName: 't8', pairs: [{ competition: SL, date: '2030-01-01' }] });
  const [a, b] = await Promise.all([pA, pB]);

  assert.strictEqual(a.status, 'success', 'ilk gelen senkron koşar');
  assert.strictEqual(b.status, 'skipped', 'ikinci eşzamanlı senkron kira yüzünden atlanır');
  assert.strictEqual(b.requests, 0, 'atlanan tur ağa istek ATMADI');
  const skippedRow = db.prepare(
    "SELECT COUNT(*) AS c FROM sync_runs WHERE status = 'skipped' AND job_name = 't8'").get();
  assert.strictEqual(skippedRow.c, 1, 'skipped turu da günlüğe yazıldı (izlenebilirlik)');
});

/* ---------------- 9) Bütçe kademeleri %70 / %90 / %100 ---------------- */
test('9) bütçe: %70 low red · %90 yalnız critical · %100 tam dur', async () => {
  mockFetch(() => jsonResponse(200, { count: 0, matches: [] }));

  // %70: 'low' red, 'normal' geçer
  setUsage(70);
  await assert.rejects(
    () => client.fetchFixtures({ sport: 'football', date: '2030-01-05', competition: SL, priority: 'low' }),
    (e) => e instanceof client.BudgetError && /%70|düşük öncelik/i.test(e.message)
  );
  await client.fetchFixtures({ sport: 'football', date: '2030-01-05', competition: SL, priority: 'normal' });

  // %90: 'normal' red, 'critical' geçer
  setUsage(90);
  await assert.rejects(
    () => client.fetchFixtures({ sport: 'football', date: '2030-01-05', competition: SL, priority: 'normal' }),
    (e) => e instanceof client.BudgetError && /%90|yaln.z 'critical'/i.test(e.message)
  );
  await client.fetchFixtures({ sport: 'football', date: '2030-01-05', competition: SL, priority: 'critical' });

  // %100: hepsi durur
  setUsage(100);
  await assert.rejects(
    () => client.fetchFixtures({ sport: 'football', date: '2030-01-05', competition: SL, priority: 'critical' }),
    (e) => e instanceof client.BudgetError
  );
});

/* ---------------- 10) Gün sınırı: dünkü istekler bugüne karışmaz ---------------- */
test('10) gün sınırı: api_usage UTC güne göre; gün değişince limit yenilenir', async () => {
  // Dün 90 istek + bugün 0
  db.prepare('INSERT INTO api_usage (day_utc, endpoint, count) VALUES (?, ?, ?)')
    .run(yesterdayUtc(), 'dunku', 90);
  assert.strictEqual(usageNow(), 0, 'dünkü 90 istek BUGÜN sayılmaz');
  assert.strictEqual(client.budgetLeft(), 100, 'bugünün bütçesi dolu (gün tazelendi)');

  // 429 sonrası düşürülmüş etkin limit, gün değişince DAILY_BUDGET'e döner
  client._internal.setEffectiveLimit(1);
  client._internal.resetDay(); // gün değişimiyle aynı kod yolu (effDay ≠ bugün → sıfırla)
  assert.strictEqual(client.effectiveLimit(), 100, 'etkin limit günlük bütçeye döndü');

  // Bugün için ayrılan sayaç gerçekten bugünün satırlarından okunur
  setUsage(5);
  assert.strictEqual(usageNow(), 5);
});

/* ---------------- 11) DB kilidi ---------------- */
test('11) DB kilidi: ikinci yazmacı SQLITE_BUSY ile hızlı reddet (asılı kalmaz)', () => {
  assert.strictEqual(db.pragma('busy_timeout', { simple: true }), 5000,
    'ana bağlantıda busy_timeout=5000 (db.js)');

  const tmpPath = path.join(__dirname, '..', '..', 'data', 'resilience-busy-test.db');
  const a = new Database(tmpPath);
  a.pragma('journal_mode = WAL');
  a.exec('CREATE TABLE IF NOT EXISTS kilit_testi (x INTEGER)');
  a.exec('BEGIN IMMEDIATE');            // yazma kilidi
  a.prepare('INSERT INTO kilit_testi VALUES (1)').run();

  const b = new Database(tmpPath);
  b.pragma('busy_timeout = 50');        // test için kısa
  const t0 = Date.now();
  assert.throws(() => b.prepare('INSERT INTO kilit_testi VALUES (2)').run(),
    (e) => e.code === 'SQLITE_BUSY', 'kilitli yazma SQLITE_BUSY fırlatır');
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, `zaman aşımı kısa sürdü (${elapsed} ms) — event loop uzun bloklanmaz`);

  a.exec('ROLLBACK');
  b.close();
  a.close();
  for (const f of [tmpPath, tmpPath + '-wal', tmpPath + '-shm']) fs.rmSync(f, { force: true });
});

/* ---------------- 12) Basketbol: aynı gün aynı takımlar ---------------- */
test('12) basketbol aynı gün aynı iki takım: İLK kayıt kazanır, tekrarı loglanır', async () => {
  const game = (score) => ({
    home: 'Ankara Basket', away: 'Izmir Basket',
    home_score: score, away_score: '69',
    status: 'finished', status_text: 'Finished',
    time: '2030-01-01T18:00:00+00:00',
    competition: 'EuroLeague',
    url: '/basketball/match/ankara-basket-vs-izmir-basket/' // aynı slug → aynı external_id
  });
  mockFetch(() => jsonResponse(200, { count: 2, matches: [game('72'), game('95')] }));

  const r = await syncFixtures({ jobName: 't12', pairs: [{ competition: 'euroleague', date: '2030-01-01' }] });

  assert.strictEqual(r.seen, 1, 'aynı external_id İKİNCİ kez görülmedi sayılır');
  assert.strictEqual(r.upserted, 1);
  assert.strictEqual(r.skipped, 1, 'çift kayıt atlandı');
  const row = db.prepare(
    "SELECT home_score FROM matches WHERE external_id = 'ankara-basket-vs-izmir-basket@2030-01-01'").get();
  assert.ok(row, 'tek satır açıldı (slug@gün kimliği)');
  assert.strictEqual(row.home_score, 72, 'İLK yanıttaki skor yazıldı (95 değil)');
  const m = metaOf(lastRun());
  assert.ok(m.duplicates.length === 1, 'çakışma meta.duplicates’a loglandı');
});

/* ---------------- Bonus: retention politikası (senaryo setini tamamlar) ---------------- */
test('bonus) retention: 30+ gün koşu ve 90+ gün detay silinir; tazeler kalır', async () => {
  const oldRun = new Date(Date.now() - 31 * 86400000).toISOString();
  const freshRun = new Date(Date.now() - 86400000).toISOString();
  db.prepare(`INSERT INTO sync_runs (job_name, started_at, finished_at, status,
              requests_made, records_seen, records_upserted, records_skipped, error_message)
              VALUES ('eski', ?, ?, 'success', 1, 0, 0, 0, NULL),
                     ('taze', ?, ?, 'success', 1, 0, 0, 0, NULL)`).run(oldRun, oldRun, freshRun, freshRun);

  const oldDetail = new Date(Date.now() - 91 * 86400000).toISOString();
  db.prepare(`INSERT INTO matches (provider, external_id, sport, status, created_at, updated_at)
              VALUES ('sportscore', 'ret-1', 'football', 'finished', ?, ?)`).run(oldDetail, oldDetail);
  const mid = db.prepare('SELECT id FROM matches LIMIT 1').get().id;
  db.prepare(`INSERT INTO match_details (match_id, kind, payload, fetched_at)
              VALUES (?, 'events', '[]', ?), (?, 'stats', '[]', ?)`)
    .run(mid, oldDetail, mid, freshRun);

  const r = await runRetention(db);

  assert.strictEqual(r.deleted_sync_runs, 1, '31 günlük koşu silindi');
  assert.strictEqual(r.deleted_match_details, 1, '91 günlük detay silindi');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM sync_runs WHERE job_name = 'taze'").get().c, 1,
    'taze koşu duruyor');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM match_details').get().c, 1,
    'taze detay duruyor');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM matches').get().c, 1,
    'matches tablosuna retention DOKUNMAZ');
});
