/**
 * Tribün — AŞAMA 5 (canlı skorlar) testleri (node:test, bellek-içi SQLite)
 *
 * Talimat test listesi:
 *  1. Etkin pencere kararı: (a) live/halftime maç → etkin; (b) kickoff'u
 *     [şimdi−3,5 sa, şimdi+15 dk] penceresinde olan scheduled → etkin;
 *     pencere dışı scheduled / yalnız finished / boş DB → etkin DEĞİL.
 *  2. Gece yarısını aşan maçın tarih çifti: 23:30Z'de başlayan maç 01:00Z'de
 *     KENDİ başlangıç günüyle sorgulanır ("bugün" değil).
 *  3. Bütçe seviyesine göre aralık: %70 altı → taban (120 sn), %70 → 240,
 *     %90 → 600; ardışık başarısızlıkta aralık büyür (çarpan).
 *  4. Upsert koruma kuralları: skor düşüşü (ardışık İKİ onay), durum geri dönüşü.
 *  5. finished sonrası: +30 dk düzeltme türetimi/işaretleme, 24 saat sonra dondurma.
 *  6. meta.last_live_sync_at yalnız GERÇEK canlı senkronu yansıtır (live_scores
 *     success/partial); boşta kontrolü ('skipped') ve fikstür işinin 'live'
 *     fazı SAYMAZ.
 *  7. Boşta turu: sync_runs'a 'skipped' + 0 istek yazar; api_usage'a dokunmaz.
 */
/**
 * ⚠️ YÜKLEME NOTU: bu dosya db singleton'unu require ETMEZ — tüm sınanan
 * kararlar services/liveWindow.js (saf, db-parametreli) ve matchGuard.js'de;
 * bellek-içi SQLite gerçekleştirmeleriyle sınanır. (Node 24 + better-sqlite3
 * process-exit çökmesi: test sürecinde db DOSYA singleton'unun yüklenmesi ya
 * da node:test'ten sonra yüklenmesi native abort tetikler — burada ikisi de YOK.)
 */
const Database = require('better-sqlite3');

const test = require('node:test');
const assert = require('node:assert');

const migration001 = require('../migrations/001_sports_tables');
const migration002 = require('../migrations/002_unmapped_and_meta');
const migration003 = require('../migrations/003_fixture_sync_columns');
const migration004 = require('../migrations/004_live_scores_columns');
const migration008 = require('../migrations/008_asama10_monitoring'); // display_name (okuma sorguları)
const {
  intervalForBudget, getLiveWindow, getCorrectionDue, markCorrectionsSynced,
  writeIdleRun, estimateLiveRequests, CORRECTION_DELAY_MS
} = require('../services/liveWindow');
const {
  isStatusRollback, isFrozen, checkScoreDrop
} = require('../services/matchGuard');
const { buildMeta } = require('../services/sportsRead');

/* ---------------- kurulum ---------------- */

const nowStr = () => new Date().toISOString();

function freshDb(t) {
  const db = new Database(':memory:');
  migration001.up(db);
  migration002.up(db);
  migration003.up(db);
  migration004.up(db);
  migration008.up(db);
  db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', 'e1', 'test-lig', 'football', 'Test Lig', 1, 1, ?, ?)`).run(nowStr(), nowStr());
  db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', 'e2', 'kapali-lig', 'football', 'Kapalı Lig', 2, 0, ?, ?)`).run(nowStr(), nowStr());
  db.prepare(`INSERT INTO teams (provider, external_id, sport, name, updated_at)
    VALUES ('sportscore', 'h', 'football', 'Ev Sahibi', ?),
           ('sportscore', 'a', 'football', 'Deplasman', ?)`).run(nowStr(), nowStr());
  if (t) t.after(() => { try { db.close(); } catch { /* zaten kapalı */ } });
  return db;
}

function addMatch(db, o) {
  db.prepare(`INSERT INTO matches
    (provider, external_id, sport, competition_id, home_team_id, away_team_id,
     kickoff_utc, status, home_score, away_score, feed_missing, finished_at,
     correction_synced_at, created_at, updated_at)
    VALUES ('sportscore', ?, 'football', ?, 1, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.id, o.compId ?? 1, o.kickoff ?? null, o.status, o.home ?? null, o.away ?? null,
      o.feedMissing ?? 0, o.finishedAt ?? null, o.correctionAt ?? null, nowStr(), nowStr());
}

/* ---------------- 1) etkin pencere kararı ---------------- */

test('pencere: live/halftime maç → etkin; (lig, kickoff GÜNÜ) çifti üretilir', (t) => {
  const db = freshDb(t);
  addMatch(db, { id: 'm1', kickoff: '2026-10-24T18:00:00.000Z', status: 'live', home: 1, away: 0 });
  const w = getLiveWindow(db, Date.UTC(2026, 9, 24, 20, 0, 0));
  assert.strictEqual(w.active, true);
  assert.strictEqual(w.liveCount, 1);
  assert.strictEqual(w.pairs.length, 1);
  assert.strictEqual(w.pairs[0].competition, 'test-lig');
  assert.strictEqual(w.pairs[0].date, '2026-10-24');
});

test('pencere: kickoff [şimdi−3,5 sa, şimdi+15 dk] içindeki scheduled → etkin', (t) => {
  const db = freshDb(t);
  const NOW = Date.UTC(2026, 9, 24, 20, 0, 0);
  // sınırların içinde: 16:30 (−3,5 sa tam sınır) ve 20:15 (+15 dk tam sınır)
  addMatch(db, { id: 's1', kickoff: '2026-10-24T16:30:00.000Z', status: 'scheduled' });
  addMatch(db, { id: 's2', kickoff: '2026-10-24T20:15:00.000Z', status: 'scheduled' });
  const w = getLiveWindow(db, NOW);
  assert.strictEqual(w.active, true);
  assert.strictEqual(w.upcomingCount, 2);
  assert.strictEqual(w.pairs[0].date, '2026-10-24');
});

test('pencere: pencere DIŞINDA scheduled (+20 dk ileri; −4 sa geri) → etkin DEĞİL', (t) => {
  const db = freshDb(t);
  const NOW = Date.UTC(2026, 9, 24, 20, 0, 0);
  addMatch(db, { id: 's1', kickoff: '2026-10-24T20:20:00.000Z', status: 'scheduled' }); // +20 dk
  addMatch(db, { id: 's2', kickoff: '2026-10-24T16:00:00.000Z', status: 'scheduled' }); // −4 sa
  const w = getLiveWindow(db, NOW);
  assert.strictEqual(w.active, false);
  assert.strictEqual(w.pairs.length, 0);
});

test('pencere: yalnız finished maç → etkin DEĞİL (istek gitmez)', (t) => {
  const db = freshDb(t);
  addMatch(db, { id: 'f1', kickoff: '2026-10-24T18:00:00.000Z', status: 'finished',
    home: 2, away: 1, finishedAt: '2026-10-24T19:50:00.000Z' });
  const w = getLiveWindow(db, Date.UTC(2026, 9, 24, 20, 0, 0));
  assert.strictEqual(w.active, false);
});

test('pencere: feed_missing=1 maç ve is_enabled=0 lig çift üretemez', (t) => {
  const db = freshDb(t);
  const NOW = Date.UTC(2026, 9, 24, 20, 0, 0);
  addMatch(db, { id: 'g1', kickoff: '2026-10-24T19:00:00.000Z', status: 'live', feedMissing: 1 });
  addMatch(db, { id: 'g2', compId: 2, kickoff: '2026-10-24T19:00:00.000Z', status: 'live' }); // kapalı lig
  const w = getLiveWindow(db, NOW);
  assert.strictEqual(w.active, false);
  assert.strictEqual(w.liveCount, 0); // her ikisi de süzüldü
});

test('pencere: kickoff 12 saatten eski "live" çöp kayıt → pencereyi yakmaz', (t) => {
  const db = freshDb(t);
  addMatch(db, { id: 'r1', kickoff: '2026-10-24T02:00:00.000Z', status: 'live', home: 0, away: 0 });
  const w = getLiveWindow(db, Date.UTC(2026, 9, 24, 20, 0, 0)); // kickoff 18 sa önce
  assert.strictEqual(w.active, false);
});

test('pencere: aynı (lig, gün) çiftindeki çok maç TEK çifte birleşir', (t) => {
  const db = freshDb(t);
  addMatch(db, { id: 'a', kickoff: '2026-10-24T18:00:00.000Z', status: 'live' });
  addMatch(db, { id: 'b', kickoff: '2026-10-24T19:30:00.000Z', status: 'scheduled' });
  addMatch(db, { id: 'c', kickoff: '2026-10-24T20:10:00.000Z', status: 'scheduled' });
  const w = getLiveWindow(db, Date.UTC(2026, 9, 24, 20, 0, 0));
  assert.strictEqual(w.active, true);
  assert.strictEqual(w.pairs.length, 1);
  assert.strictEqual(w.pairs[0].matchCount, 3);
});

/* ---------------- 2) gece yarısını aşan maç ---------------- */

test('gece yarısı aşımı: 23:30Z başlayan canlı maç ertesi gün 01:00Z\'de KENDİ günüyle sorgulanır', (t) => {
  const db = freshDb(t);
  addMatch(db, { id: 'x1', kickoff: '2026-10-23T23:30:00.000Z', status: 'live', home: 1, away: 1 });
  // şimdi: 2026-10-24 01:00Z — "bugün" 2026-10-24 olurdu; DOĞRU çift 2026-10-23
  const w = getLiveWindow(db, Date.UTC(2026, 9, 24, 1, 0, 0));
  assert.strictEqual(w.active, true);
  assert.strictEqual(w.pairs.length, 1);
  assert.strictEqual(w.pairs[0].date, '2026-10-23', 'maçın başlangıç günü kullanılmalı');
});

test('gece yarısı aşımı: +15 dk penceresi de geçmiş güne bakar', (t) => {
  const db = freshDb(t);
  addMatch(db, { id: 'x2', kickoff: '2026-10-23T23:55:00.000Z', status: 'scheduled' });
  const w = getLiveWindow(db, Date.UTC(2026, 9, 24, 0, 5, 0)); // şimdi 00:05Z
  assert.strictEqual(w.active, true);
  assert.strictEqual(w.pairs[0].date, '2026-10-23');
});

/* ---------------- 3) bütçe kademeli aralık + hata çarpanı ---------------- */

test('aralık: bütçe kademeleri — %70 altı taban, %70 → 240 sn, %90 → 600 sn', () => {
  assert.strictEqual(intervalForBudget(0.0), 120);
  assert.strictEqual(intervalForBudget(0.699), 120);
  assert.strictEqual(intervalForBudget(0.7), 240);
  assert.strictEqual(intervalForBudget(0.899), 240);
  assert.strictEqual(intervalForBudget(0.9), 600);
  assert.strictEqual(intervalForBudget(0.99), 600);
});

test('aralık: taban .env ile küçültülebilir ama 30 sn altına inmez; kademeler sabit', () => {
  assert.strictEqual(intervalForBudget(0.5, 60), 60);
  assert.strictEqual(intervalForBudget(0.5, 10), 30);   // asgari koruma
  assert.strictEqual(intervalForBudget(0.71, 60), 240); // %70+ kademeleri tabandan bağımsız
  assert.strictEqual(intervalForBudget(0.91, 60), 600);
});

test('tahmin: etkin çift başına saatte 3600/120 = 30 istek; formül README ile aynı', () => {
  const e1 = estimateLiveRequests(1, 120);
  assert.strictEqual(e1.perPairPerHour, 30);
  assert.strictEqual(e1.totalPerHour, 30);
  const e5 = estimateLiveRequests(5, 120);
  assert.strictEqual(e5.totalPerHour, 150);
  const eSlow = estimateLiveRequests(2, 600); // %90 kademesi
  assert.strictEqual(eSlow.totalPerHour, 12);
});

/* ---------------- 4) upsert koruma kuralları ---------------- */

test('koruma: skor DÜŞÜŞÜ ilk görülüşte RED — ardışık İKİNCİ aynı değerde onaylanır', () => {
  const mem = new Map();
  const existing = { home: 3, away: 2 };
  const r1 = checkScoreDrop(mem, 'm1', { home: 2, away: 2 }, existing); // 3→2 düşüş
  assert.strictEqual(r1.proceed, false);   // bu turda KABUL EDİLMEZ
  assert.strictEqual(r1.firstSeen, true);
  assert.ok(mem.has('m1'), 'şüphe hafızaya yazılmalı');

  const r2 = checkScoreDrop(mem, 'm1', { home: 2, away: 2 }, existing); // ikinci aynı değer
  assert.strictEqual(r2.proceed, true);
  assert.strictEqual(r2.confirmed, true);
  assert.ok(!mem.has('m1'), 'onaydan sonra hafıza temizlenir');
});

test('koruma: düşüş FARKLI ikinci değerde onaylanmaz, yeni şüphe olarak bekler', () => {
  const mem = new Map();
  const existing = { home: 3, away: 2 };
  checkScoreDrop(mem, 'm1', { home: 2, away: 2 }, existing);   // ilk şüphe
  const r = checkScoreDrop(mem, 'm1', { home: 1, away: 2 }, existing); // başka düşüş
  assert.strictEqual(r.proceed, false);
  assert.deepStrictEqual(mem.get('m1'), { home: 1, away: 2 }, 'yeni değer beklemeye alınır');
});

test('koruma: düşüş OLMAYAN yanıt bekleyen şüpheyi temizler (skor artışı/aynı kalma normal)', () => {
  const mem = new Map();
  const existing = { home: 3, away: 2 };
  checkScoreDrop(mem, 'm1', { home: 2, away: 2 }, existing);
  const r = checkScoreDrop(mem, 'm1', { home: 4, away: 2 }, existing); // artış: normal
  assert.strictEqual(r.proceed, true);
  assert.ok(!mem.has('m1'));
});

test('koruma: yalnız İKİ değer de doluysa düşüş sayılır (NULL yeni değer ezmez)', () => {
  const mem = new Map();
  // ev 3 → NULL (boş yanıt), deplasman 2 → 3: artan; düşüş YOK → kabul
  const r = checkScoreDrop(mem, 'm1', { home: null, away: 3 }, { home: 3, away: 2 });
  assert.strictEqual(r.proceed, true, 'NULL gelen taraf düşüş sayılmaz (R1)');
  assert.ok(!mem.has('m1'));
});

test('koruma: durum geri dönüşü — finished→live, finished→scheduled, finished→unknown, live→scheduled RED', () => {
  assert.strictEqual(isStatusRollback('finished', 'live'), true);
  assert.strictEqual(isStatusRollback('finished', 'scheduled'), true);
  assert.strictEqual(isStatusRollback('finished', 'unknown'), true);
  assert.strictEqual(isStatusRollback('live', 'scheduled'), true);
  assert.strictEqual(isStatusRollback('halftime', 'live'), false); // aynı sıra (devre arası)
  assert.strictEqual(isStatusRollback('scheduled', 'live'), false); // ileri gidiş serbest
  assert.strictEqual(isStatusRollback('finished', 'finished'), false);
});

/* ---------------- 5) finished sonrası: düzeltme + dondurma ---------------- */

test('düzeltme: finished + 30 dk kontrolü DB\'den türetilir; işaretlenenler bir daha çıkmaz', (t) => {
  const db = freshDb(t);
  const NOW = Date.UTC(2026, 9, 24, 20, 0, 0);
  addMatch(db, { id: 'd1', kickoff: '2026-10-24T18:00:00.000Z', status: 'finished',
    finishedAt: new Date(NOW - 20 * 60 * 1000).toISOString() }); // +30 dk daha gelmedi
  addMatch(db, { id: 'd2', kickoff: '2026-10-24T15:00:00.000Z', status: 'finished',
    finishedAt: new Date(NOW - 40 * 60 * 1000).toISOString() }); // vakti geldi (ateşlensin)
  addMatch(db, { id: 'd3', kickoff: '2026-10-24T15:00:00.000Z', status: 'finished',
    finishedAt: new Date(NOW - 50 * 60 * 1000).toISOString(), correctionAt: '2026-10-24T19:40:00.000Z' }); // zaten yapıldı

  let due = getCorrectionDue(db, NOW);
  assert.strictEqual(due.length, 1, 'd2 bekler; d1 daha erken, d3 işaretli');
  assert.strictEqual(due[0].date, '2026-10-24');
  assert.ok(due[0].fireAtMs >= NOW + 60 * 1000, 'geç kalmış düzeltme en erken şimdi+60 sn');

  // d2 senkronu başarıyla bitti → kendi +30 dk'sı gelmiş maçlar işaretlenir
  const marked = markCorrectionsSynced(db, due[0].competitionId, due[0].date, NOW);
  assert.strictEqual(marked, 1, 'yalnız d2 (kendi 30 dk\'sı geçmiş)');
  const d1 = db.prepare('SELECT correction_synced_at FROM matches WHERE external_id=?').get('d1');
  assert.strictEqual(d1.correction_synced_at, null, 'd1\'in kendi düzeltme hakkı korunur');
  due = getCorrectionDue(db, NOW);
  assert.strictEqual(due.length, 1, 'd1 hâlâ bekler');
  assert.strictEqual(due[0].matches, 1);
});

test('düzeltme: 2 saat içinde bitmemiş eski maç türetilmez (bakış penceresi)', (t) => {
  const db = freshDb(t);
  const NOW = Date.UTC(2026, 9, 24, 20, 0, 0);
  addMatch(db, { id: 'old', kickoff: '2026-10-24T10:00:00.000Z', status: 'finished',
    finishedAt: new Date(NOW - 3 * 3600 * 1000).toISOString() });
  assert.strictEqual(getCorrectionDue(db, NOW).length, 0);
});

test('dondurma: finished + 24 saat → kayıt donar; 24 saatten az → donmaz', (t) => {
  const NOW = Date.now();
  // isFrozen DB satırı okur: alan adı finished_at (yılan-örnek) olmalı
  const mk = (hAgo) => ({ status: 'finished', finished_at: new Date(NOW - hAgo * 3600 * 1000).toISOString() });
  assert.strictEqual(isFrozen(mk(25), NOW), true);
  assert.strictEqual(isFrozen(mk(24.1), NOW), true);
  assert.strictEqual(isFrozen(mk(23.9), NOW), false, '24 saatten az: düzeltme penceresi kapandı, kayıt taze');
  assert.strictEqual(isFrozen({ status: 'live', finished_at: null }, NOW), false);
  assert.strictEqual(isFrozen({ status: 'finished', finished_at: null }, NOW), false, 'finished_at yok → donma kararı verilemez');
});

test('dondurma eşiği matchGuard.FREEZE_AFTER_MS = 24 saattir', () => {
  const { FREEZE_AFTER_MS } = require('../services/matchGuard');
  assert.strictEqual(FREEZE_AFTER_MS, 24 * 3600 * 1000);
  assert.strictEqual(CORRECTION_DELAY_MS, 30 * 60 * 1000);
});

/* ---------------- 6) meta.last_live_sync_at yalnız gerçek canlı senkron ---------------- */

test('meta: live_scores success/partial turu last_live_sync_at\'i günceller; boşta kontrolü ve fikstürün \'live\' fazı SAYMAZ', (t) => {
  const db = freshDb(t);
  const ins = db.prepare(`INSERT INTO sync_runs (job_name, started_at, finished_at, status,
      requests_made, records_seen, records_upserted, records_skipped, meta)
      VALUES (?, ?, ?, ?, 1, 0, 0, 0, ?)`);
  const ts = (hAgo) => new Date(Date.now() - hAgo * 3600 * 1000).toISOString();

  // 1) Aşama 3 fikstür işinin 'live' fazlı koşusu — ESKİ anlamda sayılırdı, YENİDEN sayılmaz
  ins.run('fixtures', ts(5), ts(5), 'success', JSON.stringify({ phase: 'live' }));
  let meta = buildMeta(db, { date: '2026-10-24', liveCount: 1 });
  assert.strictEqual(meta.last_live_sync_at, null, "fikstür 'live' fazı artık canlı senkron DEĞİL");

  // 2) gerçek live_scores turu (success)
  const liveAt = ts(0.02); // ~1 dk önce
  ins.run('live_scores', liveAt, liveAt, 'success', JSON.stringify({ phase: 'live' }));
  meta = buildMeta(db, { date: '2026-10-24', liveCount: 1 });
  assert.strictEqual(meta.last_live_sync_at, liveAt);
  assert.strictEqual(meta.stale, false, 'canlı maç varken taze canlı senkron → stale değil');

  // 3) ardından boşta kontrolü ('skipped', istek 0) — alanı GİÇBİRLİKTE geri çekmez
  const idleAt = ts(0.01);
  ins.run('live_scores', idleAt, idleAt, 'skipped', JSON.stringify({ phase: 'live', idle: true }));
  meta = buildMeta(db, { date: '2026-10-24', liveCount: 1 });
  assert.strictEqual(meta.last_live_sync_at, liveAt, 'boşta kontrolü gerçek senkron sayılmaz');

  // 4) 5 dakikadan eski canlı senkron + canlı maç → live_sync_old
  const oldLive = ts(0.2); // 12 dk önce
  db.prepare('DELETE FROM sync_runs').run();
  ins.run('live_scores', oldLive, oldLive, 'success', JSON.stringify({ phase: 'live' }));
  ins.run('fixtures', ts(0.1), ts(0.1), 'success', JSON.stringify({ phase: 'live' }));
  meta = buildMeta(db, { date: '2026-10-24', liveCount: 1 });
  assert.strictEqual(meta.stale_reason, 'live_sync_old');
});

/* ---------------- 7) boşta tur kaydı ---------------- */

test('boşta: sync_runs\'a \'skipped\' + 0 istek yazar; sync_state.last_run_at dokunur; api_usage\'a DOKUNMAZ', (t) => {
  const db = freshDb(t);
  const win = getLiveWindow(db, Date.now()); // boş DB → inactive
  assert.strictEqual(win.active, false);
  writeIdleRun(db, win);

  const run = db.prepare("SELECT * FROM sync_runs WHERE job_name='live_scores'").get();
  assert.strictEqual(run.status, 'skipped');
  assert.strictEqual(run.requests_made, 0);
  const meta = JSON.parse(run.meta);
  assert.strictEqual(meta.idle, true);
  assert.strictEqual(meta.phase, 'live');

  const st = db.prepare("SELECT last_run_at FROM sync_state WHERE job_name='live_scores'").get();
  assert.ok(st && st.last_run_at, 'boşta kontrolü last_run_at\'i günceller');

  const usage = db.prepare('SELECT COUNT(*) AS c FROM api_usage').get();
  assert.strictEqual(usage.c, 0, 'hiç istek sayacı artmaz');
});
