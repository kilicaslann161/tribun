/**
 * Tribün — AŞAMA 8 (maç detayı; yalnız futbol) testleri (node:test, bellek-içi)
 *
 * ⚠️ YÜKLEME NOTU (önceki aşamaların kuralı): db singleton'u require EDİLMEZ.
 * matchDetail.getMatchDetail(db, id, {fetcher, detailCap, now}) imzası sayesinde
 * tüm davranışlar bellek-içi db + sahte fetcher ile sınanır:
 *
 * Talimat test listesi:
 *  1. Tek-uçuş: 10 eşzamanlı istek = 1 SportScore çağrısı (mock ile).
 *  2. TTL: canlı 60 sn (taze → çekme yok; dolunca → çekme); başlamamış maç
 *     HİÇ çekmez; bitmiş maç ilk çekimden sonra kalıcı, +30 dk'da bir kez
 *     düzeltme çekiği.
 *  3. Kimlik uyuşmazlığında KAYDETME (tracker.id ≠ external_id).
 *  4. Bütçe dolu senaryosu (günlük detay tavanı): istek ATILMAZ; eski veri
 *     stale:true ile döner; veri yoksa available:false.
 *  5. available:false yanıtı (başlamamış maç) + Türkçe mesaj.
 *  6. Basketbolda detay reddi ({available:false, reason:'no_detail_for_sport'},
 *     404 değil; fetcher HİÇ çağrılmaz).
 *  Ek: skor koruması (düşük detay skoru matches'e yazılmaz, scoreboard'da
 *  yaşar; yüksek/eşit skor yazılır), dakika/devre skoru yazımı, olayların
 *  dakika sıralaması (aynı dakika API sırasında), unmapped_values'a olay türü
 *  ve istatistik etiketi düşmesi, source_updated taşınması.
 */
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const migration001 = require('../migrations/001_sports_tables');
const migration002 = require('../migrations/002_unmapped_and_meta');
const migration003 = require('../migrations/003_fixture_sync_columns');
const migration006 = require('../migrations/006_match_detail');
const core = require('../services/matchDetailCore');
const { getMatchDetail } = require('../services/matchDetail');

const MIN = 60 * 1000;
const nowStr = () => new Date().toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();

/* ---------------- kurulum ---------------- */

function freshDb(t) {
  const db = new Database(':memory:');
  migration001.up(db);
  migration002.up(db);
  migration003.up(db);
  migration006.up(db);
  db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, country, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', 'c1', 'super-lig', 'football', 'Süper Lig', 'turkey', 1, 1, ?, ?)`).run(nowStr(), nowStr());
  db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, country, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', 'c2', 'basket-lig', 'basketball', 'Basket Lig', 'world', 2, 1, ?, ?)`).run(nowStr(), nowStr());
  if (t) t.after(() => { try { db.close(); } catch { /* zaten kapalı */ } });
  return db;
}

function addTeam(db, key, name, sport = 'football') {
  return Number(db.prepare(
    "INSERT INTO teams (provider, external_id, sport, name, updated_at) VALUES ('sportscore', ?, ?, ?, ?)"
  ).run(key, sport, name, nowStr()).lastInsertRowid);
}

/** Futbol maçı ekle. o: {id, externalId, slug, status, kickoff, finishedAt, home, away, ht} */
function addMatch(db, compId, o) {
  const hid = addTeam(db, 'h-' + (o.id || 'x'), o.homeName || 'Evspor');
  const aid = addTeam(db, 'a-' + (o.id || 'x'), o.awayName || 'Depor');
  db.prepare(`INSERT INTO matches
    (provider, external_id, sport, competition_id, home_team_id, away_team_id,
     kickoff_utc, status, home_score, away_score, finished_at, match_slug, feed_missing, created_at, updated_at)
    VALUES ('sportscore', ?, 'football', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(o.externalId, compId, hid, aid, o.kickoff ?? ago(2 * 3600 * 1000),
      o.status ?? 'live', o.home ?? null, o.away ?? null,
      o.finishedAt ?? null, o.slug ?? 'evspor-vs-depor', nowStr(), nowStr());
  return Number(db.prepare('SELECT id FROM matches ORDER BY id DESC LIMIT 1').get().id);
}

function addBasketMatch(db, compId) {
  db.prepare(`INSERT INTO matches
    (provider, external_id, sport, competition_id, kickoff_utc, status, match_slug, feed_missing, created_at, updated_at)
    VALUES ('sportscore', 'bb-1', 'basketball', ?, ?, 'live', 'ev-vs-de', 0, ?, ?)`)
    .run(compId, ago(MIN), nowStr(), nowStr());
  return Number(db.prepare('SELECT id FROM matches ORDER BY id DESC LIMIT 1').get().id);
}

/** Sahte SportScore widget/match yanıtı üretici (gerçek doğrulanmış biçim) */
function fakePayload(o = {}) {
  return {
    json: {
      sport: 'football',
      updated: o.updated || '2026-10-24T13:11:20.559702+00:00',
      match: {
        home: o.homeName || 'Evspor',
        away: o.awayName || 'Depor',
        home_score: o.homeScore ?? '1',
        away_score: o.awayScore ?? '0',
        status: o.status || 'live',
        status_text: o.statusText || '2nd half',
        time: o.time || ago(70 * MIN),
        competition: 'Süper Lig',
        url: o.url || '/football/match/evspor-vs-depor/ext-1/',
        live_minute: o.liveMinute ?? '67',
        home_ht_score: o.htHome ?? 0,
        away_ht_score: o.htAway ?? 0,
        tracker: { id: o.trackerId || 'ext-1', profile: 'p1', sport: 'football' },
        incidents: o.incidents ?? [
          { time: 27, type: 'Goal', type_id: 1, side: 'home', player: 'A Golcü', is_goal: true, home_score: 1, away_score: 0 },
          { time: 6, type: 'VAR', type_id: 28, side: 'away', player: 'B Oyuncu' },
          { time: 27, type: 'Red card', type_id: 4, side: 'away', player: 'C Oyuncu', is_card: true },
          { time: 60, type: 'Substitution', type_id: 9, side: 'home', player: '', is_sub: true, player_in: 'Y Giren', player_out: 'Z Çıkan' }
        ],
        stats: o.stats ?? [
          { label: 'Ball Possession', home: 62, away: 38, home_pct: 62, away_pct: 38, suffix: '%' },
          { label: 'Shots on Target', home: 6, away: 1, home_pct: 86, away_pct: 14, suffix: '' },
          { label: 'Bilinmeyen Metrik', home: 3, away: 4, home_pct: 43, away_pct: 57, suffix: '' }
        ],
        lineups: o.lineups ?? {
          confirmed: true,
          home_formation: '4-3-3',
          away_formation: '4-4-2',
          home_coach: null,
          away_coach: null,
          home_xi: [
            { name: 'Kaleci K', number: 1, position: 'G', captain: true, rating: '7.0' },
            { name: 'Defans D', number: 4, position: 'D', captain: false, rating: '6.5' }
          ],
          away_xi: [{ name: 'Forvet F', number: 9, position: 'F', captain: false, rating: '6.0' }],
          home_subs: [{ name: 'Yedek Y', number: 12, position: 'M', captain: false, rating: '0.0' }],
          away_subs: []
        }
      }
    }
  };
}

/** fetcher sayaçlı sarmalayıcı */
function counted(fetchImpl) {
  const fn = (...a) => { fn.calls++; return fetchImpl(...a); };
  fn.calls = 0;
  return fn;
}

/* ================= 1) tek-uçuş ================= */

test('tek-uçuş: 10 eşzamanlı istek = 1 SportScore çağrısı (mock)', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  const fetcher = counted(() => new Promise((r) => setTimeout(() => r(fakePayload()), 30)));

  const results = await Promise.all(
    Array.from({ length: 10 }, () => getMatchDetail(db, id, { fetcher }))
  );

  assert.equal(fetcher.calls, 1, '10 eşzamanlı istek TEK sağlayıcı çağrısına birleşmeli');
  for (const r of results) {
    assert.ok(r.ok);
    assert.equal(r.value.available, true);
    assert.equal(r.value.has_events, true);
  }
  /* match_details'te her kind yalnız TEK satır (upsert) */
  const kinds = db.prepare('SELECT kind, COUNT(*) c FROM match_details WHERE match_id = ? GROUP BY kind').all(id);
  for (const k of kinds) assert.equal(k.c, 1);
});

/* ================= 2) TTL davranışı ================= */

test('TTL: canlı maçta taze veri (<60 sn) yeniden çekilmez', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  const fetcher = counted(() => fakePayload());

  await getMatchDetail(db, id, { fetcher });           // ilk çekim
  const r2 = await getMatchDetail(db, id, { fetcher }); // TTL dolmadı → çekme yok
  assert.equal(fetcher.calls, 1, '60 sn içinde ikinci istek sağlayıcıya GITMEMELI');
  assert.equal(r2.value.meta.stale, false);

  /* fetched_at'i 61 sn öncesine çek → TTL doldu → yeniden çek */
  db.prepare('UPDATE match_details SET fetched_at = ? WHERE match_id = ?')
    .run(ago(61 * 1000), id);
  await getMatchDetail(db, id, { fetcher });
  assert.equal(fetcher.calls, 2, 'TTL dolduğunda yeniden çekilmeli');
});

test('TTL: başlamamış maç için SportScore\'a HİÇ gitilmez', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'scheduled', kickoff: ahead(3 * 3600 * 1000) });
  const fetcher = counted(() => fakePayload());

  const r = await getMatchDetail(db, id, { fetcher });
  assert.equal(fetcher.calls, 0, 'başlamamış maç → 0 sağlayıcı çağrısı');
  assert.equal(r.value.available, false);
  assert.equal(r.value.reason, 'not_started');
  assert.ok(r.value.message.length > 5, 'Türkçe mesaj dolu olmalı');
});

test('TTL: bitmiş maç ilk çekimden sonra kalıcı; +30 dk\'da bir kez düzeltme', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, {
    externalId: 'ext-1', status: 'finished',
    finishedAt: ago(10 * MIN), kickoff: ago(3 * 3600 * 1000) // bitiş+30 dk → 20 dk sonra
  });
  const fetcher = counted(() => fakePayload({ status: 'finished', statusText: 'Finished', liveMinute: null }));

  await getMatchDetail(db, id, { fetcher });            // düzeltme penceresi ÖNCESİ ilk çekim
  await getMatchDetail(db, id, { fetcher });            // kalıcı → çekme yok
  assert.equal(fetcher.calls, 1, 'bitmiş maç ilk çekimden sonra kalıcı');

  /* düzeltme penceresi: bitişten 30 dk geçti ama son çekim ondan önceydi */
  const r3 = await getMatchDetail(db, id, { fetcher, now: Date.now() + 25 * MIN });
  assert.equal(fetcher.calls, 2, 'bitiş+30dk sonrasında bir kez düzeltme çekiği');
  assert.ok(r3.value.available);

  /* düzeltme çekildikten sonra tekrar kalıcı */
  await getMatchDetail(db, id, { fetcher, now: Date.now() + 40 * MIN });
  assert.equal(fetcher.calls, 2, 'düzeltme çekiğinden sonra artık kalıcı');
});

test('TTL kararı (SAF): tablo — canlı 60 sn / başlamamış yok / bitmiş kalıcı', () => {
  const now = Date.now();
  const d = (m) => core.detailTtlDecision(m, now);

  assert.deepEqual(
    d({ status: 'scheduled', finishedAt: null, lastFetchedAt: null }),
    { fetch: false, reason: 'not_started' });
  assert.deepEqual(
    d({ status: 'live', finishedAt: null, lastFetchedAt: null }),
    { fetch: true, reason: 'initial' });
  /* saat bağımsız kesin zamanlar (yaş = now − lastFetched) */
  const at = (ageMs) => new Date(now - ageMs).toISOString();
  assert.equal(d({ status: 'live', finishedAt: null, lastFetchedAt: at(30 * 1000) }).fetch, false);
  assert.equal(d({ status: 'live', finishedAt: null, lastFetchedAt: at(60 * 1000) }).fetch, true);
  assert.equal(d({ status: 'halftime', finishedAt: null, lastFetchedAt: at(90 * 1000) }).fetch, true);
  /* bitiş +30 dk: son çekim pencereden ÖNCEYSE bir kez daha çek */
  assert.deepEqual(
    d({ status: 'finished', finishedAt: ago(40 * MIN), lastFetchedAt: ago(50 * MIN) }),
    { fetch: true, reason: 'finished_correction' });
  /* son çekim pencereden SONRAYSA kalıcı */
  assert.deepEqual(
    d({ status: 'finished', finishedAt: ago(40 * MIN), lastFetchedAt: ago(10 * MIN) }),
    { fetch: false, reason: 'finished_permanent' });
  /* ertelenen maç → çekme yok */
  assert.deepEqual(
    d({ status: 'postponed', finishedAt: null, lastFetchedAt: null }),
    { fetch: false, reason: 'no_detail_for_status' });
});

/* ================= 3) kimlik uyuşmazlığı ================= */

test('kimlik: tracker.id ≠ external_id → detay KAYDEDİLMEZ + loglanır', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  /* yanıt BAŞKA bir maçın kimliğiyle geliyor (aynı iki takımın başka maçı olabilir) */
  const fetcher = counted(() => fakePayload({ trackerId: 'baska-mac-999' }));

  const r = await getMatchDetail(db, id, { fetcher });
  assert.equal(fetcher.calls, 1);
  assert.equal(r.value.available, false, 'veri yok + kimlik hatası → available:false');
  assert.equal(r.value.reason, 'identity_mismatch');
  const rows = db.prepare('SELECT COUNT(*) c FROM match_details WHERE match_id = ?').get(id);
  assert.equal(rows.c, 0, 'kimlik uyuşmazlığında match_details\'e YAZILMAMALI');

  /* veri VARken kimlik hatası → eski veri korunur, stale:true */
  const fetcherOk = counted(() => fakePayload());       // önce doğru çekim
  await getMatchDetail(db, id, { fetcher: fetcherOk });
  const r2 = await getMatchDetail(db, id, {
    fetcher: counted(() => fakePayload({ trackerId: 'baska-mac-999', liveMinute: '70' })),
    now: Date.now() + 2 * MIN                            // TTL dolmuş
  });
  assert.equal(r2.value.available, true, 'eski veri dönmeli');
  assert.equal(r2.value.meta.stale, true, 'yenilenemedi → stale');
  assert.equal(r2.value.meta.stale_reason, 'identity_mismatch');
  assert.equal(r2.value.match.minute, 67, 'kötü yanıt matches.minute\'ı bozmamalı');
});

test('kimlik: tracker yoksa url\'deki kimlik kullanılır', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  /* tracker alanı yok; url'deki kimlik yanlış → red */
  const bad = fakePayload({ url: '/football/match/evspor-vs-depor/YANLIS-ID/' });
  delete bad.json.match.tracker;
  const fetcher = counted(() => bad);
  const r = await getMatchDetail(db, id, { fetcher });
  assert.equal(r.value.reason, 'identity_mismatch');
  /* url kimliği doğru → kabul */
  const good = fakePayload({ url: '/football/match/evspor-vs-depor/ext-1/' });
  delete good.json.match.tracker;
  const fetcher2 = counted(() => good);
  const r2 = await getMatchDetail(db, id, { fetcher: fetcher2 });
  assert.equal(r2.value.available, true);
});

/* ================= 4) bütçe ================= */

test('bütçe: günlük detay tavanı dolu → istek ATILMAZ, eski veri stale:true', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  const fetcher = counted(() => fakePayload());

  /* önce sağlıklı çekim */
  await getMatchDetail(db, id, { fetcher, detailCap: 1000 });

  /* api_usage'ı tavana doldur (endpoint bazlı sayaç) */
  db.prepare("INSERT INTO api_usage (day_utc, endpoint, count) VALUES (?, '/api/widget/match/', 1000)")
    .run(new Date().toISOString().slice(0, 10));

  db.prepare('UPDATE match_details SET fetched_at = ? WHERE match_id = ?').run(ago(5 * MIN), id);
  const r = await getMatchDetail(db, id, { fetcher, detailCap: 1000, now: Date.now() + 6 * MIN });
  assert.equal(fetcher.calls, 1, 'tavan doluyken sağlayıcı çağrılmamalı');
  assert.equal(r.value.available, true);
  assert.equal(r.value.meta.stale, true);
  assert.equal(r.value.meta.stale_reason, 'budget');
});

test('bütçe: tavan dolu + hiç veri yok → 200 + available:false + Türkçe mesaj', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  db.prepare("INSERT INTO api_usage (day_utc, endpoint, count) VALUES (?, '/api/widget/match/', 1000)")
    .run(new Date().toISOString().slice(0, 10));
  const fetcher = counted(() => fakePayload());

  const r = await getMatchDetail(db, id, { fetcher, detailCap: 1000 });
  assert.equal(fetcher.calls, 0);
  assert.equal(r.value.available, false);
  assert.equal(r.value.reason, 'budget');
  assert.ok(r.value.message.length > 5);
});

/* ================= 5) available:false ================= */

test('available:false: ağ hatası + hiç veri yok → 200 + mesaj', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  const fetcher = counted(() => Promise.reject(new Error('ağ/zaman aşımı: TimeoutError')));

  const r = await getMatchDetail(db, id, { fetcher });
  assert.equal(r.value.available, false);
  assert.equal(r.value.reason, 'fetch_failed');
  assert.ok(r.value.message.length > 5);
  /* bölüm bayrakları hep geliyor (şekil kararlılığı) */
  assert.equal(r.value.has_events, false);
  assert.equal(r.value.has_stats, false);
  assert.equal(r.value.has_lineups, false);
});

/* ================= 6) basketbol reddi ================= */

test('basketbol: 404 yerine {available:false, reason:"no_detail_for_sport"}', async () => {
  const db = freshDb();
  const id = addBasketMatch(db, 2);
  const fetcher = counted(() => fakePayload());

  const r = await getMatchDetail(db, id, { fetcher });
  assert.ok(r.ok, 'basketbol da 200 döner (404 değil)');
  assert.equal(fetcher.calls, 0, 'basketbol için sağlayıcı HİÇ çağrılmaz');
  assert.equal(r.value.available, false);
  assert.equal(r.value.reason, 'no_detail_for_sport');
  assert.equal(r.value.match.sport, 'basketball');
});

/* ================= ek: yazma kuralları ================= */

test('skor koruması: detay skoru listeden DÜŞÜKSE matches\'e yazılmaz', async () => {
  const db = freshDb();
  /* listede 3-1 var; detay önbellekten 2-1 dönüyor (daha düşük) */
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live', home: 3, away: 1 });
  const fetcher = counted(() => fakePayload({ homeScore: '2', awayScore: '1' }));

  const r = await getMatchDetail(db, id, { fetcher });
  assert.ok(r.value.available);
  const m = db.prepare('SELECT home_score, away_score FROM matches WHERE id = ?').get(id);
  assert.equal(m.home_score, 3, 'düşük detay skoru listedeki skoru EZMEMELI');
  assert.equal(m.away_score, 1);
  /* düşük skor yalnız match_details('scoreboard') içinde yaşar */
  const sb = JSON.parse(db.prepare(
    "SELECT payload FROM match_details WHERE match_id = ? AND kind = 'scoreboard'").get(id).payload);
  assert.equal(sb.home_score, 2);
  assert.equal(sb.away_score, 1);
});

test('skor koruması: detay skoru yüksekse/eşitse matches güncellenir', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live', home: 1, away: 0 });
  const fetcher = counted(() => fakePayload({ homeScore: '2', awayScore: '0' }));
  await getMatchDetail(db, id, { fetcher });
  const m = db.prepare('SELECT home_score, away_score, minute, ht_home, ht_away FROM matches WHERE id = ?').get(id);
  assert.equal(m.home_score, 2, 'yükselen skor matches\'e yazılmalı');
  assert.equal(m.minute, 67, 'live_minute → matches.minute');
  assert.equal(m.ht_home, 0, 'devre skoru yazılmalı');
  assert.equal(m.ht_away, 0);
});

test('olaylar: dakika sırasına göre; aynı dakika API sırasında kalır', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  await getMatchDetail(db, id, { fetcher: () => fakePayload() });

  const r = await getMatchDetail(db, id, { fetcher: () => fakePayload() });
  const items = r.value.sections.events.items;
  assert.equal(r.value.match.minute, 67, 'ilk çekimden sonra yanit dakikayi guncel gostermeli (satir yeniden okunur)');
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((i) => i.minute), [6, 27, 27, 60], 'dakika sıralı olmalı');
  /* 27. dakikadaki iki olay API sırasında: Goal (listedebaşta) → Red card */
  assert.equal(items[1].type, 'goal');
  assert.equal(items[2].type, 'other');
  assert.equal(items[2].typeRaw, 'Red card');
  /* bayraklar */
  assert.equal(r.value.has_events, true);
  assert.equal(r.value.has_stats, true);
  assert.equal(r.value.has_lineups, true);
  /* source_updated API'nin updated değeri olmalı (ms hassasiyetine iner) */
  assert.equal(r.value.meta.source_updated, '2026-10-24T13:11:20.559Z');
});

test('unmapped_values: bilinmeyen olay türü + istatistik etiketi düşer (sport dolu, tek satır)', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  /* iki AYNI bilinmeyen tür + bir bilinmeyen etiket: UNIQUE sayesinde tek satır */
  const incidents = [
    { time: 10, type: 'Red card', type_id: 4, side: 'home', player: 'A' },
    { time: 50, type: 'Red card', type_id: 4, side: 'away', player: 'B' }
  ];
  await getMatchDetail(db, id, { fetcher: () => fakePayload({ incidents }) });

  const rows = db.prepare('SELECT kind, raw_value, sport, hits FROM unmapped_values').all();
  const kinds = rows.map((r) => r.kind);
  assert.ok(kinds.includes('incident_type'), 'bilinmeyen olay türü unmapped_values\'a yazılmalı');
  assert.ok(kinds.includes('stats_label'), 'bilinmeyen istatistik etiketi unmapped_values\'a yazılmalı');
  const red = rows.find((r) => r.raw_value.includes('Red card'));
  assert.ok(red, 'Red card (type_id=4) unmapped kaydında olmalı');
  assert.equal(red.sport, 'football', 'sport dolu gelmeli (NULL unique tuzağı)');
  assert.equal(red.hits, 2, 'aynı değer ikinci görülüşte hits artmalı (ayrı satır DEĞİL)');
  const unknownStat = rows.find((r) => r.raw_value === 'Bilinmeyen Metrik');
  assert.ok(unknownStat);
});

test('kadrolar: rating DÜŞMEZ; yedekler ve mevki alanları taşınır', async () => {
  const db = freshDb();
  const id = addMatch(db, 1, { externalId: 'ext-1', status: 'live' });
  const r = await getMatchDetail(db, id, { fetcher: () => fakePayload() });
  const lu = r.value.sections.lineups;
  assert.equal(lu.available, true);
  assert.equal(lu.home_formation, '4-3-3');
  const raw = JSON.stringify(lu);
  assert.ok(!/rating/.test(raw), 'rating yanıtta OLMAMALI');
  assert.equal(lu.home_subs.length, 1);
  assert.equal(lu.home_subs[0].name, 'Yedek Y');
  assert.equal(lu.home_xi[0].captain, true);
});

test('hata durumları: geçersiz id 400; olmayan maç 404', async () => {
  const db = freshDb();
  const r1 = await getMatchDetail(db, 'abc');
  assert.equal(r1.status, 400);
  const r2 = await getMatchDetail(db, 99999);
  assert.equal(r2.status, 404);
});
