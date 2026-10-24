/**
 * Tribün — AŞAMA 4 (okuma API'si) testleri (node:test, bellek-içi SQLite)
 *
 * Kapsam (talimat):
 *  1. TR gün sınırı: 23:30 UTC'deki maç TR'de ERTESİ güne düşer; 00:00-02:59 TR
 *     aralığı doğru güne çıkar (Intl tabanlı hesap; sabit +3 YOK).
 *  2. Gruplama/sıralama: gruplar sort_order, maçlar kickoff sırasıyla.
 *  3. Geçersiz parametre → Türkçe hata ile red.
 *  4. Boş sonuç → groups:[] + meta.
 *  5. NULL skor → null (asla 0 yazılmaz); GERÇEK 0-0 skoru 0 kalır.
 *  6. meta.stale senaryoları: no_data / fixture_sync_old / live_sync_old / taze.
 *  7. feed_missing=1 ASLA dönmez.
 *  8. has_detail / status_text kuralları.
 */
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const migration001 = require('../migrations/001_sports_tables');
const migration002 = require('../migrations/002_unmapped_and_meta');
const migration003 = require('../migrations/003_fixture_sync_columns');
const read = require('../services/sportsRead');

/* ---------------- test DB kurulumu ---------------- */

const now = () => new Date().toISOString();
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  migration001.up(db);
  migration002.up(db);
  migration003.up(db);
  return db;
}

function seedCompetitions(db) {
  const ins = db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, country, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('e1', 'turkish-super-league', 'football', 'Turkish Super League', 'turkey', 1, 1, now(), now());
  ins.run('e2', 'english-premier-league', 'football', 'English Premier League', 'england', 2, 1, now(), now());
  ins.run('e3', 'euroleague', 'basketball', 'EuroLeague', 'world', 3, 1, now(), now());
  // is_enabled=0: /competitions listesine ÇIKMAMALI
  ins.run('e4', 'bir-kapali-lig', 'football', 'Kapalı Lig', 'x', 4, 0, now(), now());
}

function seedTeams(db) {
  const ins = db.prepare(`INSERT INTO teams (provider, external_id, sport, name, updated_at)
    VALUES ('sportscore', ?, ?, ?, ?)`);
  ['Galatasaray', 'Fenerbahce', 'Arsenal', 'Chelsea', 'Olympiakos', 'Panathinaikos'].forEach((n, i) => {
    ins.run(`k${i + 1}`, n.includes('Olymp') || n.includes('Panat') ? 'basketball' : 'football', n, now());
  });
}

/**
 * Kickoff'lar (TR = UTC+3; Intl ile hesaplanır, burada yalnızca beklenen TR günü not edilir):
 *  F1  2026-10-24T20:30Z → TR 24 Eki 23:30  (bitmiş, 2-1)
 *  F2  2026-10-24T23:30Z → TR 25 Eki 02:30  (TALEP SENARYOSU: 23:30 UTC → TR'de ertesi gün; başlamamış, skor NULL)
 *  F3  2026-10-24T21:00Z → TR 25 Eki 00:00  (gün sınırının ilk saniyesi; canlı basketbol Q2)
 *  F4  2026-10-23T21:00Z → TR 24 Eki 00:00  (önceki gün sınırının ilk saniyesi; bitmiş 0-0 — GERÇEK 0)
 *  F5  2026-10-24T18:30Z → TR 24 Eki 21:30  (başlamamış, skor NULL)
 *  F6  2026-10-24T22:00Z → TR 25 Eki 01:00  (feed_missing=1 → ASLA dönmemeli)
 *  F7  2026-10-24T20:00Z → TR 24 Eki 23:00  (canlı HT futbol, 1-1)
 */
function seedMatches(db) {
  const ins = db.prepare(`INSERT INTO matches
    (provider, external_id, sport, competition_id, home_team_id, away_team_id,
     kickoff_utc, status, period, home_score, away_score, feed_missing, created_at, updated_at)
    VALUES ('sportscore', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('f1', 'football', 1, 1, 2, '2026-10-24T20:30:00.000Z', 'finished', null, 2, 1, 0, now(), now());
  ins.run('f2', 'football', 1, 1, 2, '2026-10-24T23:30:00.000Z', 'scheduled', null, null, null, 0, now(), now());
  ins.run('f3', 'basketball', 3, 5, 6, '2026-10-24T21:00:00.000Z', 'live', 'Q2', 41, 48, 0, now(), now());
  ins.run('f4', 'football', 1, 1, 2, '2026-10-23T21:00:00.000Z', 'finished', null, 0, 0, 0, now(), now());
  ins.run('f5', 'football', 2, 3, 4, '2026-10-24T18:30:00.000Z', 'scheduled', null, null, null, 0, now(), now());
  ins.run('f6', 'football', 1, 1, 2, '2026-10-24T22:00:00.000Z', 'scheduled', null, null, null, 1, now(), now());
  ins.run('f7', 'football', 2, 3, 4, '2026-10-24T20:00:00.000Z', 'live', 'HT', 1, 1, 0, now(), now());
  return ins.lastInsertRowid;
}

/** AŞAMA 5: jobName parametresi eklendi — last_live_sync_at artık yalnız
 *  live_scores İŞİNİN koşularından hesaplanır (boşta kontrolü/fikstür 'live'
 *  fazı sayılmaz). Varsayılan 'fixtures' (eski çağrılar değişmez). */
function seedRun(db, phase, status, finishedAgoMs, jobName = 'fixtures') {
  db.prepare(`INSERT INTO sync_runs (job_name, started_at, finished_at, status,
              requests_made, records_seen, records_upserted, records_skipped, meta)
              VALUES (?, ?, ?, ?, 1, 0, 0, 0, ?)`)
    .run(jobName, isoAgo(finishedAgoMs + 1000), isoAgo(finishedAgoMs), status, JSON.stringify({ phase }));
}

/** Tüm sabit veriyle yeni DB (senkron satırı YOK) */
function makeDb(t) {
  const db = freshDb();
  seedCompetitions(db);
  seedTeams(db);
  seedMatches(db);
  // better-sqlite3 destructor'ının process-exit hook'unda çökmesine karşı
  // tanıtıcıyı test biterken DETERMİNİSTİK biçimde kapat
  if (t) t.after(() => { try { db.close(); } catch { /* zaten kapalı */ } });
  return db;
}

const HOUR = 3600 * 1000, MIN = 60 * 1000;

/* ---------------- 1) TR gün sınırı (Intl; sabit +3 YOK) ---------------- */

test('TR gün sınırı: 2026-10-24 günü UTC 21:00Z→21:00Z aralığı (Istanbul +3)', (t) => {
  const r = read.localDayUtcRange('2026-10-24');
  assert.strictEqual(r.startIso, '2026-10-23T21:00:00.000Z');
  assert.strictEqual(r.endIso, '2026-10-24T21:00:00.000Z');
});

test('TR gün sınırı: 23:30 UTC maçı (F2) TR’nin ERTESİ gününe düşer, aynı gün LİSTESİNDE ÇIKMAZ', (t) => {
  const db = makeDb(t);
  const d24 = read.listMatches(db, { date: '2026-10-24', sport: 'football' });
  const ids24 = d24.value.groups.flatMap((g) => g.matches.map((m) => m.id));
  assert.ok(ids24.length > 0, '24 listesi dolu olmalı');
  assert.ok(!ids24.includes(2), 'F2 (23:30 UTC) 24 listesinde OLMAMALI');

  const d25 = read.listMatches(db, { date: '2026-10-25' });
  const ids25 = d25.value.groups.flatMap((g) => g.matches.map((m) => m.id));
  assert.ok(ids25.includes(2), 'F2 (TR 02:30) 25 listesinde OLMALI');
  assert.ok(!ids25.includes(1), 'F1 (TR 23:30, 24. gün) 25 listesinde OLMAMALI');
});

test('TR gün sınırı: 00:00-02:59 TR aralığı doğru güne düşer (F3=F4 kontrolüyle birlikte)', (t) => {
  const db = makeDb(t);
  // F4: TR 24 Ekim 00:00 (UTC 23 Ekim 21:00) → 24 listesinde ilk maç
  const d24 = read.listMatches(db, { date: '2026-10-24' });
  const all24 = d24.value.groups.flatMap((g) => g.matches);
  assert.strictEqual(all24[0].id, 4, 'F4 (TR 00:00) günün İLK maçı olmalı');
  // F3: TR 25 Ekim 00:00 (UTC 24 Ekim 21:00) → 25 listesinde, 24 listesinde değil
  const ids24 = all24.map((m) => m.id);
  const ids25 = read.listMatches(db, { date: '2026-10-25' }).value.groups.flatMap((g) => g.matches.map((m) => m.id));
  assert.ok(ids25.includes(3), 'F3 (TR 00:00) 25 listesinde olmalı');
  assert.ok(!ids24.includes(3), 'F3 24 listesinde olmamalı');
});

test('trToday() YYYY-MM-DD üretir (Europe/Istanbul)', (t) => {
  assert.match(read.trToday(), /^\d{4}-\d{2}-\d{2}$/);
});

/* ---------------- 2) Gruplama / sıralama ---------------- */

test('gruplama: gruplar sort_order (Süper Lig önce), maçlar kickoff sırasıyla', (t) => {
  const db = makeDb(t);
  const r = read.listMatches(db, { date: '2026-10-24' });
  assert.strictEqual(r.value.groups[0].competition.slug, 'turkish-super-league');
  assert.strictEqual(r.value.groups[0].matches[0].id, 4);   // 21:00Z önce
  assert.strictEqual(r.value.groups[0].matches[1].id, 1);   // 20:30Z sonra (aynı TR günü)
  assert.strictEqual(r.value.groups[1].competition.slug, 'english-premier-league');
  assert.deepStrictEqual(r.value.groups[1].matches.map((m) => m.id), [5, 7]);
});

test('sorgu filtreleri: sport, status, competition beyaz listeyle çalışır', (t) => {
  const db = makeDb(t);
  const onlyBball = read.listMatches(db, { date: '2026-10-25', sport: 'basketball' });
  assert.ok(onlyBball.value.groups.every((g) => g.competition.slug === 'euroleague'));
  const onlyLive = read.listMatches(db, { date: '2026-10-24', status: 'live' });
  assert.deepStrictEqual(onlyLive.value.groups.flatMap((g) => g.matches.map((m) => m.id)), [7]);
  const onlyTsl = read.listMatches(db, { date: '2026-10-24', competition: 'turkish-super-league' });
  assert.ok(onlyTsl.value.groups.every((g) => g.competition.slug === 'turkish-super-league'));
});

/* ---------------- 3) Geçersiz parametreler → 400 mesajı ---------------- */

test('doğrulama: geçersiz date/sport/status/competition reddedilir (Türkçe hata)', (t) => {
  const db = makeDb(t);
  const bad = [
    read.listMatches(db, { date: '2026-02-30' }),   // olmayan takvim günü
    read.listMatches(db, { date: '24-10-2026' }),   // yanlış biçim
    read.listMatches(db, { date: '2026-10-24', sport: 'tennis' }),
    read.listMatches(db, { date: '2026-10-24', status: 'playing' }),
    read.listMatches(db, { date: '2026-10-24', competition: 'boyle-bir-lig-yok' })
  ];
  for (const r of bad) {
    assert.strictEqual(r.ok, false);
    assert.ok(typeof r.error === 'string' && r.error.length > 5);
  }
  // TR büyük/küçük harf toleransı: FOOTBALL geçerli
  assert.strictEqual(read.listMatches(db, { date: '2026-10-24', sport: 'FOOTBALL' }).ok, true);
});

/* ---------------- 4) Boş sonuç + 5) NULL skor / gerçek 0 ---------------- */

test('boş sonuç: groups boş + meta yine dolu', (t) => {
  const db = makeDb(t);
  seedRun(db, 'future', 'success', MIN);
  const r = read.listMatches(db, { date: '2030-01-01' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value.groups, []);
  assert.strictEqual(r.value.meta.date, '2030-01-01');
  assert.strictEqual(r.value.meta.timezone, 'Europe/Istanbul');
});

test('NULL skor: başlamamış maçta skor null (asla 0); bitmiş 0-0 gerçek 0 kalır', (t) => {
  const db = makeDb(t);
  const r = read.listMatches(db, { date: '2026-10-24', sport: 'football', status: 'scheduled' });
  const m = r.value.groups[0].matches[0];
  assert.strictEqual(m.home.score, null);
  assert.strictEqual(m.away.score, null);
  assert.strictEqual(m.status_text, 'Başlamadı');

  const fin = read.listMatches(db, { date: '2026-10-24', sport: 'football', status: 'finished' }).value;
  const f1 = fin.groups[0].matches.find((x) => x.id === 1);
  const f4 = fin.groups[0].matches.find((x) => x.id === 4);
  assert.deepStrictEqual([f1.home.score, f1.away.score], [2, 1]);
  assert.deepStrictEqual([f4.home.score, f4.away.score], [0, 0], 'GERÇEK 0-0 skoru 0 kalmalı (null değil)');
});

/* ---------------- 6) meta.stale senaryoları ---------------- */

test('stale: senkron hiç çalışmadıysa no_data', (t) => {
  const db = makeDb(t);
  const meta = read.listMatches(db, { date: '2026-10-24' }).value.meta;
  assert.strictEqual(meta.stale, true);
  assert.strictEqual(meta.stale_reason, 'no_data');
  assert.strictEqual(meta.last_fixture_sync_at, null);
});

test('stale: taze senkron (canlı maç var + taze canlı koşu) → stale=false', (t) => {
  const db = makeDb(t);
  seedRun(db, 'future', 'success', 2 * HOUR);            // fikstür 2 saat önce: 6 saatten yeni
  seedRun(db, 'live', 'success', MIN, 'live_scores');     // canlı İŞİ 1 dk önce: 5 dk'dan yeni (Aşama 5: gerçek canlı senkron)
  const meta = read.listMatches(db, { date: '2026-10-24' }).value.meta; // F7 canlı var
  assert.strictEqual(meta.stale, false);
  assert.strictEqual(meta.stale_reason, null);
  assert.strictEqual(meta.live_count, 1);
});

test('stale: fikstür 6+ saat eski → fixture_sync_old', (t) => {
  const db = makeDb(t);
  seedRun(db, 'future', 'success', 7 * HOUR);
  const meta = read.listMatches(db, { date: '2026-10-25' }).value.meta;
  assert.strictEqual(meta.stale, true);
  assert.strictEqual(meta.stale_reason, 'fixture_sync_old');
});

test('stale: canlı maç varken canlı senkron 5+ dk eski → live_sync_old', (t) => {
  const db = makeDb(t);
  seedRun(db, 'future', 'success', MIN);                 // fikstür taze
  seedRun(db, 'live', 'partial', 10 * MIN, 'live_scores');// canlı İŞİ 10 dk eski
  const meta = read.listMatches(db, { date: '2026-10-24' }).value.meta; // F7 canlı
  assert.strictEqual(meta.stale, true);
  assert.strictEqual(meta.stale_reason, 'live_sync_old');
  // canlı maç OLMAYAN günde canlı senkron esnekliği fark yaratmaz
  const meta25 = read.listMatches(db, { date: '2026-10-25' }).value.meta; // F3 canlı VAR (basketbol)
  assert.strictEqual(meta25.stale_reason, 'live_sync_old');
});

/* ---------------- 7) feed_missing ---------------- */

test('feed_missing: gizli maç listelere ve /matches/:id ucu dahil ASLA çıkmaz (silinmeden)', (t) => {
  const db = makeDb(t);
  const ids = read.listMatches(db, { date: '2026-10-24' }).value.groups.flatMap((g) => g.matches.map((m) => m.id))
    .concat(read.listMatches(db, { date: '2026-10-25' }).value.groups.flatMap((g) => g.matches.map((m) => m.id)));
  assert.ok(!ids.includes(6), 'F6 (feed_missing=1) hiçbir listede olmamalı');
  assert.strictEqual(read.getMatchById(db, 6).status, 404);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM matches WHERE id = 6').get().c, 1, 'satır DB’de duruyor (silinmedi)');
});

/* ---------------- 8) has_detail, status_text, :id, competitions ---------------- */

test('has_detail: yalnız futbol + live/finished', (t) => {
  const db = makeDb(t);
  const f1 = read.getMatchById(db, 1).value;   // futbol, finished → true
  const f5 = read.getMatchById(db, 5).value;   // futbol, scheduled → false
  const f3 = read.getMatchById(db, 3).value;   // basketbol, live → false
  assert.strictEqual(f1.has_detail, true);
  assert.strictEqual(f5.has_detail, false);
  assert.strictEqual(f3.has_detail, false);
  assert.strictEqual(f3.period, 'Q2');
  assert.strictEqual(f3.status_text, 'Canlı');
  assert.strictEqual(f1.minute, null, 'minute genelde null (yalnızca detaydan)');
});

test('matches/:id: hatalı id 400, bilinmeyen id 404', (t) => {
  const db = makeDb(t);
  assert.strictEqual(read.getMatchById(db, 'abc').status, 400);
  assert.strictEqual(read.getMatchById(db, -1).status, 400);
  assert.strictEqual(read.getMatchById(db, 99999).status, 404);
});

test('competitions: yalnız is_enabled=1, sort_order sırasıyla', (t) => {
  const db = makeDb(t);
  const list = read.listCompetitions(db).value.competitions;
  assert.deepStrictEqual(list.map((c) => c.slug), ['turkish-super-league', 'english-premier-league', 'euroleague']);
});

test('live: yalnız canlı/halftime maçlar (F3 + F7)', (t) => {
  const db = makeDb(t);
  const r = read.listLive(db);
  const ids = r.value.groups.flatMap((g) => g.matches.map((m) => m.id)).sort((a, b) => a - b);
  assert.deepStrictEqual(ids, [3, 7]);
  assert.strictEqual(r.value.meta.live_count, 2);
});
