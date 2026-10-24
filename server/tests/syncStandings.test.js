/**
 * Tribün — AŞAMA 7 (puan durumu + lig sayfası) testleri (node:test, bellek-içi)
 *
 * ⚠️ YÜKLEME NOTU (syncLive.test.js ile aynı kural): bu dosya db singleton'unu
 * require ETMEZ — sınanan kararlar services/standingsCore.js (SAF, db-PARAMETRELİ)
 * ve services/sportsRead.js (db singleton'suz) modüllerinde. Yan etkili senkron
 * (syncStandings.js: istek + kira + transaction) syncFixtures gibi CANLI
 * doğrulamayla kanıtlanır (admin tetikleme + API yanıtları).
 *
 * Talimat test listesi:
 *  1. Yanıt doğrulama: geçerli örnekle normalize; boş yanıt HATA; kopya satır
 *     atılır; bilinmeyen alan row_extra'ya; sport≠futbol uyarı verir.
 *  2. Due türetimi: ilk senkron / 8 saat taban tur / finished tetikleyici +
 *     15 dk hız sınırı / bitiş senkrondan ÖNCEYSE tetiklemez / basketbol HARİÇ.
 *  3. Okuma: gruplama (çok grup), kolon türetimi (yanıtta olmayan kolon
 *     LİSTEDE ÇIKMAZ), meta.updated_at + stale (no_data / standings_old /
 *     taze), bilinmeyen+kapalı lig 404.
 *  4. Lig detayı: bugün + yaklaşan gün grupları; 404.
 */
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const migration001 = require('../migrations/001_sports_tables');
const migration002 = require('../migrations/002_unmapped_and_meta');
const migration003 = require('../migrations/003_fixture_sync_columns');
const migration005 = require('../migrations/005_standings');
const core = require('../services/standingsCore');
const read = require('../services/sportsRead');

const HOUR = 3600 * 1000;
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
  migration005.up(db);
  db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, country, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', 'e1', 'super-lig', 'football', 'Süper Lig', 'turkey', 1, 1, ?, ?)`).run(nowStr(), nowStr());
  db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, country, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', 'e2', 'basket-lig', 'basketball', 'Basket Lig', 'world', 2, 1, ?, ?)`).run(nowStr(), nowStr());
  db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, country, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', 'e3', 'kapali-lig', 'football', 'Kapalı Lig', 'x', 3, 0, ?, ?)`).run(nowStr(), nowStr());
  if (t) t.after(() => { try { db.close(); } catch { /* zaten kapalı */ } });
  return db;
}

/** takım ekle — external_id = nameKey (maç senkronunun kuralı) */
function addTeam(db, nameKey, name, sport = 'football') {
  return Number(db.prepare(
    "INSERT INTO teams (provider, external_id, sport, name, updated_at) VALUES ('sportscore', ?, ?, ?, ?)"
  ).run(nameKey, sport, name, nowStr()).lastInsertRowid);
}

function addMatch(db, compId, o) {
  db.prepare(`INSERT INTO matches
    (provider, external_id, sport, competition_id, home_team_id, away_team_id,
     kickoff_utc, status, finished_at, feed_missing, created_at, updated_at)
    VALUES ('sportscore', ?, 'football', ?, NULL, NULL, ?, ?, ?, 0, ?, ?)`)
    .run(o.id, compId, o.kickoff ?? null, o.status ?? 'scheduled', o.finishedAt ?? null, nowStr(), nowStr());
}

function addStanding(db, compId, o) {
  db.prepare(`INSERT INTO standings
    (competition_id, group_name, position, team_id, team_name, team_logo,
     played, won, drawn, lost, goals_for, goals_against, goal_diff, points,
     promo_color, promo_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(compId, o.group ?? '', o.pos, o.teamId ?? null, o.team ?? ('Takım ' + o.pos),
      o.logo ?? null, o.played ?? null, o.won ?? null, o.drawn ?? null, o.lost ?? null,
      o.gf ?? null, o.ga ?? null, o.gd ?? null, o.pts ?? null,
      o.promoColor ?? '', o.promoName ?? '', o.updatedAt ?? nowStr());
}

/* Kullanıcının doğruladığı örnek yanıtın (Süper Lig) küçük bir kopyası */
const SAMPLE = {
  sport: 'football',
  competition: 'Turkish Super League',
  competition_slug: 'turkish-super-league',
  tables: [{
    group: '',
    rows: [
      { pos: 1, team: 'Galatasaray', team_logo: 'https://img.thesports.com/x/1.png', team_slug: 'galatasaray', team_url: '/football/team/galatasaray/', p: 8, w: 6, d: 1, l: 1, gf: 17, ga: 11, gd: 6, pts: 19, promo_color: '#fa8072', promo_name: 'Champions League league stage' },
      { pos: 10, team: 'Başakşehir Futbol Kulübü', team_slug: 'basaksehir-futbol-kulubu', team_url: '/football/team/basaksehir-futbol-kulubu/', p: 8, w: 3, d: 2, l: 3, gf: 12, ga: 12, gd: 0, pts: 11, promo_color: '', promo_name: '' },
      { pos: 16, team: 'Konyaspor', team_slug: 'konyaspor', team_url: '/football/team/konyaspor/', p: 8, w: 1, d: 2, l: 5, gf: 4, ga: 9, gd: -5, pts: 5, promo_color: '#B1A7A7', promo_name: 'Relegation' }
    ]
  }]
};

/* ================= 1) yanıt doğrulama ================= */

test('normalize: kullanıcı örneği aynen doğrulanır (grup/satır/alan sayıları)', () => {
  const r = core.normalizeStandingsResponse(SAMPLE);
  assert.ok(r.ok, 'ok olmalı: ' + (r.error || ''));
  assert.equal(r.value.groups.length, 1);
  assert.equal(r.value.groups[0].group, '');
  assert.equal(r.value.groups[0].rows.length, 3);
  assert.equal(r.value.slug, 'turkish-super-league');
  const gs = r.value.groups[0].rows[0];
  assert.equal(gs.teamName, 'Galatasaray');
  assert.equal(gs.played, 8);
  assert.equal(gs.points, 19);
  assert.equal(gs.promoColor, '#fa8072');
  assert.deepEqual(r.value.warnings, []);
});

test('normalize: negatif averaj korunur (gd -5), logo/boş promo düzgün işlenir', () => {
  const r = core.normalizeStandingsResponse(SAMPLE);
  const kon = r.value.groups[0].rows[2];
  assert.equal(kon.goalDiff, -5);
  const bas = r.value.groups[0].rows[1];
  assert.equal(bas.promoColor, '');
  assert.ok(!bas.teamLogo, 'logo alanı yoksa null olmalı');
});

test('normalize: tables yok → HATA (boş/bozuk yanıt kabul edilmez)', () => {
  assert.ok(!core.normalizeStandingsResponse({ sport: 'football' }).ok);
  assert.ok(!core.normalizeStandingsResponse(null).ok);
  assert.ok(!core.normalizeStandingsResponse({ tables: 'değil-dizi' }).ok);
});

test('normalize: rows boş ya da hepsi geçersiz → HATA (red: eski veri korunur)', () => {
  assert.ok(!core.normalizeStandingsResponse({ sport: 'football', tables: [{ group: '', rows: [] }] }).ok);
  assert.ok(!core.normalizeStandingsResponse({
    sport: 'football',
    tables: [{ group: '', rows: [{ pos: 0, team: 'X' }, { pos: 2, team: '' }] }]
  }).ok);
});

test('normalize: aynı grupta kopya takım → İLKİ alınır, uyarı üretilir', () => {
  const r = core.normalizeStandingsResponse({
    sport: 'football', competition_slug: 's',
    tables: [{ group: '', rows: [
      { pos: 1, team: 'Takım A', p: 2, pts: 6 },
      { pos: 2, team: 'takım a', p: 2, pts: 3 }  // aynı ad (TR küçük harf)
    ] }]
  });
  assert.ok(r.ok);
  assert.equal(r.value.groups[0].rows.length, 1, 'kopya atlanmalı');
  assert.equal(r.value.groups[0].rows[0].points, 6, 'ilk görülen değer korunmalı');
  assert.ok(r.value.warnings.length === 1, 'kopya uyarısı beklenir');
});

test('normalize: sport=basketball → ok ama UYARI (yalnız futbol işlenir; kural katmanda)', () => {
  const r = core.normalizeStandingsResponse({
    sport: 'basketball', tables: [{ group: '', rows: [{ pos: 1, team: 'A Takımı', p: 1, w: 1, pts: 2 }] }]
  });
  assert.ok(r.ok);
  assert.ok(r.value.warnings.some((w) => w.includes('basketball')));
});

test('normalize: bilinmeyen ek alan row_extra JSON\'ına taşınır', () => {
  const r = core.normalizeStandingsResponse({
    sport: 'football', tables: [{ group: '', rows: [
      { pos: 1, team: 'A', p: 1, yeni_alan: 'deneme', bir_sayi: 7 }
    ] }]
  });
  assert.ok(r.ok);
  const extra = JSON.parse(r.value.groups[0].rows[0].rowExtra);
  assert.equal(extra.yeni_alan, 'deneme');
  assert.equal(extra.bir_sayi, 7);
});

test('normalize: eksik sayı sütunları null kalır (futbolda d dolu; basketbolda d yok senaryosu)', () => {
  const r = core.normalizeStandingsResponse({
    sport: 'football', tables: [{ group: '', rows: [{ pos: 1, team: 'A', w: 5, pts: 15 }] }]
  });
  assert.ok(r.ok);
  const row = r.value.groups[0].rows[0];
  assert.equal(row.won, 5);
  assert.equal(row.drawn, null, 'yanıtta olmayan kolon null olmalı (0 DEĞİL)');
  assert.equal(row.played, null);
});

/* ================= 2) due türetimi ================= */

test('due: hiç senkronlanmamış futbol ligi → first_sync', () => {
  const db = freshDb();
  const d = core.getStandingsDue(db, Date.now());
  assert.equal(d.comps.length, 1, 'yalnız futbol ligi listelenmeli (basketbol hariç)');
  assert.equal(d.comps[0].slug, 'super-lig');
  assert.ok(d.comps[0].due);
  assert.equal(d.comps[0].reason, 'first_sync');
});

test('due: 7 saat önce senkron + yeni bitiş YOK → beklemede (due değil)', () => {
  const db = freshDb();
  addStanding(db, 1, { pos: 1, updatedAt: ago(7 * HOUR) });
  const d = core.getStandingsDue(db, Date.now());
  assert.ok(!d.comps[0].due);
});

test('due: 9 saat önce senkron → baseline (günde 3 kez)', () => {
  const db = freshDb();
  addStanding(db, 1, { pos: 1, updatedAt: ago(9 * HOUR) });
  const d = core.getStandingsDue(db, Date.now());
  assert.ok(d.comps[0].due);
  assert.equal(d.comps[0].reason, 'baseline');
});

test('due: maç senkrondan SONRA bitmiş + 15 dk geçmiş → match_finished', () => {
  const db = freshDb();
  addStanding(db, 1, { pos: 1, updatedAt: ago(30 * MIN) });
  addMatch(db, 1, { id: 'm1', status: 'finished', finishedAt: ago(10 * MIN) });
  const d = core.getStandingsDue(db, Date.now());
  assert.ok(d.comps[0].due);
  assert.equal(d.comps[0].reason, 'match_finished');
});

test('due: maç bitmiş ama son senkron 15 dk\'dan yeni → hız sınırı (due değil)', () => {
  const db = freshDb();
  addStanding(db, 1, { pos: 1, updatedAt: ago(5 * MIN) });
  addMatch(db, 1, { id: 'm1', status: 'finished', finishedAt: ago(10 * MIN) });
  const d = core.getStandingsDue(db, Date.now());
  assert.ok(!d.comps[0].due);
});

test('due: bitiş senkrondan ÖNCEYSE tetiklemez (eski bitiş sayılmaz)', () => {
  const db = freshDb();
  addStanding(db, 1, { pos: 1, updatedAt: ago(30 * MIN) });
  addMatch(db, 1, { id: 'm1', status: 'finished', finishedAt: ago(2 * HOUR) });
  const d = core.getStandingsDue(db, Date.now());
  assert.ok(!d.comps[0].due);
});

test('due: scheduled/live maçlar tetiklemez (yalnız finished)', () => {
  const db = freshDb();
  addStanding(db, 1, { pos: 1, updatedAt: ago(30 * MIN) });
  addMatch(db, 1, { id: 'm1', status: 'live', finishedAt: null });
  addMatch(db, 1, { id: 'm2', status: 'scheduled', finishedAt: null });
  const d = core.getStandingsDue(db, Date.now());
  assert.ok(!d.comps[0].due);
});

/* ================= 3) okuma: getStandings ================= */

test('okuma: tek grup + tam kolon seti + meta taze → stale=false', () => {
  const db = freshDb();
  const tid = addTeam(db, 'galatasaray', 'Galatasaray');
  addStanding(db, 1, { pos: 1, teamId: tid, team: 'Galatasaray', played: 8, won: 6, drawn: 1, lost: 1, gf: 17, ga: 11, gd: 6, pts: 19, promoColor: '#fa8072', promoName: 'Champions League league stage' });
  addStanding(db, 1, { pos: 2, team: 'Amedspor', played: 8, won: 5, drawn: 2, lost: 1, gf: 18, ga: 9, gd: 9, pts: 17 });
  const r = read.getStandings(db, 'super-lig');
  assert.ok(r.ok);
  const v = r.value;
  assert.equal(v.groups.length, 1);
  assert.equal(v.groups[0].rows.length, 2);
  assert.equal(v.groups[0].rows[0].team_id, tid, 'name_key eşleşen takım team_id almalı');
  assert.equal(v.groups[0].rows[1].team_id, null, 'eşleşmeyen takım team_id=NULL kalmalı');
  assert.ok(v.columns.includes('drawn'));
  assert.ok(!v.columns.includes('win_pct'), 'win_pct yanıtta yoksa kolon listede OLMAMALI');
  assert.equal(v.competition.slug, 'super-lig');
  assert.ok(v.meta.updated_at);
  assert.ok(!v.meta.stale);
});

test('okuma: yanıtta olmayan kolon (drawn hepsi null) LİSTEDE ÇIKMAZ', () => {
  const db = freshDb();
  addStanding(db, 1, { pos: 1, played: 8, won: 6, drawn: null, lost: 1, pts: 19 });
  addStanding(db, 1, { pos: 2, played: 8, won: 5, drawn: null, lost: 1, pts: 16 });
  const r = read.getStandings(db, 'super-lig');
  assert.ok(r.ok);
  assert.ok(!r.value.columns.includes('drawn'), 'tüm satırlarda null olan kolon gösterilmez');
  assert.ok(r.value.columns.includes('played'));
});

test('okuma: çok grup sağlayıcı sırasıyla ve group adlarıyla döner', () => {
  const db = freshDb();
  addStanding(db, 1, { group: 'A', pos: 1, pts: 9 });
  addStanding(db, 1, { group: 'A', pos: 2, pts: 6 });
  addStanding(db, 1, { group: 'B', pos: 1, pts: 3 });
  const r = read.getStandings(db, 'super-lig');
  assert.deepEqual(r.value.groups.map((g) => g.group), ['A', 'B'], 'grup sırası = yazım (sağlayıcı) sırası');
  assert.equal(r.value.groups[0].rows.length, 2);
  assert.equal(r.value.groups[1].rows[0].points, 3);
});

test('okuma: veri yok → 200 + boş gruplar + stale no_data', () => {
  const db = freshDb();
  const r = read.getStandings(db, 'super-lig');
  assert.ok(r.ok);
  assert.deepEqual(r.value.groups, []);
  assert.deepEqual(r.value.columns, []);
  assert.equal(r.value.meta.updated_at, null);
  assert.ok(r.value.meta.stale);
  assert.equal(r.value.meta.stale_reason, 'no_data');
});

test('okuma: satır 12+ saat eski → stale standings_old', () => {
  const db = freshDb();
  addStanding(db, 1, { pos: 1, updatedAt: ago(13 * HOUR) });
  const r = read.getStandings(db, 'super-lig');
  assert.ok(r.value.meta.stale);
  assert.equal(r.value.meta.stale_reason, 'standings_old');
});

test('okuma: bilinmeyen ve KAPALI lig 404 (Türkçe hata)', () => {
  const db = freshDb();
  assert.equal(read.getStandings(db, 'yok-boyle-lig').status, 404);
  const kapali = read.getStandings(db, 'kapali-lig');
  assert.equal(kapali.status, 404);
  const detay = read.getCompetitionBySlug(db, 'yok-boyle-lig');
  assert.equal(detay.status, 404);
});

/* ================= 4) okuma: getCompetitionBySlug ================= */

test('lig detayı: bugün + yaklaşan günler TR takvim gününe göre gruplanır', () => {
  const db = freshDb();
  const today = read.trToday();
  const rToday = read.localDayUtcRange(today);

  const mk = (range, hour = 15) =>
    new Date(Date.parse(range.startIso) + hour * HOUR).toISOString();

  addMatch(db, 1, { id: 't1', status: 'scheduled', kickoff: mk(rToday, 9) });       // bugün 09:00 TR
  addMatch(db, 1, { id: 't2', status: 'live', kickoff: mk(rToday, 12) });          // bugün 12:00 TR
  const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  addMatch(db, 1, { id: 'u1', status: 'scheduled', kickoff: mk(read.localDayUtcRange(tomorrow), 11) });
  const dayAfter = new Date(Date.parse(today + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10);
  addMatch(db, 1, { id: 'u2', status: 'scheduled', kickoff: mk(read.localDayUtcRange(dayAfter), 20) });

  const r = read.getCompetitionBySlug(db, 'super-lig');
  assert.ok(r.ok);
  assert.equal(r.value.matches.today.length, 2, 'bugünün maçları');
  assert.equal(r.value.matches.upcoming.length, 2, 'iki ayrı yaklaşan gün');
  assert.equal(r.value.matches.upcoming[0].date, tomorrow);
  assert.equal(r.value.matches.upcoming[0].matches.length, 1);
  assert.equal(r.value.matches.upcoming[1].date, dayAfter);
  assert.equal(r.value.meta.live_count, 1, 'bugünkü canlı maç sayısı');
  assert.equal(r.value.competition.slug, 'super-lig');
});

test('lig detayı: maç yoksa boş listeler döner (hata değil)', () => {
  const db = freshDb();
  const r = read.getCompetitionBySlug(db, 'super-lig');
  assert.ok(r.ok);
  assert.deepEqual(r.value.matches.today, []);
  assert.deepEqual(r.value.matches.upcoming, []);
});

test('lig detayı: başka ligin maçı bu ligin detayına KARIŞMAZ', () => {
  const db = freshDb();
  const today = read.trToday();
  const kick = new Date(Date.parse(read.localDayUtcRange(today).startIso) + 10 * HOUR).toISOString();
  addMatch(db, 1, { id: 'benim', kickoff: kick });          // super-lig
  addMatch(db, 2, { id: 'onlar', kickoff: kick, status: 'live' }); // basket-lig
  const r = read.getCompetitionBySlug(db, 'super-lig');
  assert.equal(r.value.matches.today.length, 1);
  assert.equal(r.value.matches.today[0].id !== undefined, true);
  assert.equal(r.value.meta.live_count, 0, 'başka ligin canlısı sayılmamalı');
});

test('lig detayı: yaklaşılan 9 günlük pencere dışındaki maçlar listeye GİRMEZ', () => {
  const db = freshDb();
  const far = ahead(12 * 24 * HOUR);
  addMatch(db, 1, { id: 'cok-uzak', kickoff: far });
  const r = read.getCompetitionBySlug(db, 'super-lig');
  assert.equal(r.value.matches.upcoming.length, 0);
});
