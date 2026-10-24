/**
 * Tribün — AŞAMA 9 (Kâhin Sensin entegrasyonu) testleri (node:test, bellek-içi SQLite)
 *
 * Talimat test listesi:
 *  1. Aktarım idempotent: aynı maç ikinci kez aktarılamaz, satır artmaz.
 *  2. Basketbol reddi: mesajıyla reddedilir; futbol aktarılır.
 *  3. Aday listesi: gelecek 7 gün + scheduled + feed_missing=0 + bağsız + açık lig.
 *  4. Otomatik sonuçlandırma: finished + 30 dk + son İKİ senkronda aynı skor.
 *     - tek senkron / 30 dk dolmadan → sonuçlanMAZ
 *     - skor değişirse denge sayacı sıfırlanır
 *  5. Düzeltme senaryosu: sonuçlandıktan sonra sağlayıcı skoru düzeltirse
 *     eski ödül geri alınır, yeni sonuca göre yeniden dağıtılır.
 *  6. feed_missing / postponed / kickoff değişimi → "İnceleme gerekli"
 *     bayrağı; otomatik iptal YOK, kickoff otomatik uygulanmaz.
 *  7. Tahmin doğrulama: başlama saatinden sonra kapalı, mükerrer yok,
 *     puanlar tahmin anında değil sonuçta dağıtılır.
 *  8. Elle sonuç girişi aynı settleFixture'ı kullanır (by='admin').
 *
 * ⚠️ YÜKLEME NOTU: db singleton'u require EDİLMEZ — forecastCore db-parametreli;
 * puan dağıtımı enjekte edilen stub'la sınanır (utils/points db dosya
 * singleton'unu yükler; node:test sürecinde native çökme riski).
 */
const Database = require('better-sqlite3');

const test = require('node:test');
const assert = require('node:assert');

const migration001 = require('../migrations/001_sports_tables');
const migration003 = require('../migrations/003_fixture_sync_columns');
const migration007 = require('../migrations/007_forecast_kahin_sensin');
const forecast = require('../services/forecastCore');

/* ---------------- kurulum ---------------- */

const nowStr = () => new Date().toISOString();

function freshDb(t) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migration001.up(db);
  migration003.up(db);
  migration007.up(db);
  // users + scores: db.js şemasının gerekli kısmı (predictions FK'ı ve ödül
  // geri alma yolu için; ödül stub'ı scores'a yazar)
  db.exec(`
    CREATE TABLE users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname        TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash   TEXT NOT NULL,
      fan_title       TEXT NOT NULL DEFAULT 'Çaylak Taraftar',
      total_points    INTEGER NOT NULL DEFAULT 0,
      streak          INTEGER NOT NULL DEFAULT 0,
      last_login_date TEXT,
      created_at      TEXT NOT NULL
    );
    CREATE TABLE scores (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game       TEXT NOT NULL,
      points     INTEGER NOT NULL,
      meta       TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', 'e1', 'test-lig', 'football', 'Test Lig', 1, 1, ?, ?)`).run(nowStr(), nowStr());
  db.prepare(`INSERT INTO competitions
    (provider, external_id, slug, sport, name, sort_order, is_enabled, created_at, updated_at)
    VALUES ('sportscore', 'e2', 'nba', 'basketball', 'NBA', 2, 1, ?, ?)`).run(nowStr(), nowStr());
  db.prepare(`INSERT INTO teams (provider, external_id, sport, name, updated_at) VALUES
    ('sportscore', 'h',  'football',   'Galatasaray', ?),
    ('sportscore', 'a',  'football',   'Fenerbahçe', ?),
    ('sportscore', 'bh', 'basketball', 'Anadolu Efes', ?),
    ('sportscore', 'ba', 'basketball', 'Fenerbahçe Beko', ?)`)
    .run(nowStr(), nowStr(), nowStr(), nowStr());
  if (t) t.after(() => { try { db.close(); } catch { /* zaten kapalı */ } });
  return db;
}

function addUser(db, nick) {
  const info = db.prepare('INSERT INTO users (nickname, password_hash, created_at) VALUES (?, ?, ?)')
    .run(nick, 'x', nowStr());
  return Number(info.lastInsertRowid);
}

function addMatch(db, o) {
  const info = db.prepare(`INSERT INTO matches
    (provider, external_id, sport, competition_id, home_team_id, away_team_id,
     kickoff_utc, status, home_score, away_score, feed_missing, finished_at, fetched_at, created_at, updated_at)
    VALUES ('sportscore', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.id, o.sport || 'football', o.compId ?? 1, o.homeTeamId ?? 1, o.awayTeamId ?? 2,
      o.kickoff ?? null, o.status, o.home ?? null, o.away ?? null,
      o.feedMissing ?? 0, o.finishedAt ?? null, o.fetchedAt ?? null, nowStr(), nowStr());
  return Number(info.lastInsertRowid);
}

/** Puan dağıtım stub'ı: addPointsIn'in günlük limitsiz hali; küpür olarak
 *  scores satır id'si döner (geri alma yolu bunu sınar). */
function makeAward() {
  const calls = [];
  const award = (db, userId, points, meta) => {
    const info = db.prepare('INSERT INTO scores (user_id, game, points, meta, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'oracle', points, JSON.stringify(meta), nowStr());
    db.prepare('UPDATE users SET total_points = total_points + ? WHERE id = ?').run(points, userId);
    calls.push({ userId, points, meta });
    return { awarded: points, capped: false, dailyLimit: 30, awardedToday: 0, scoresRowId: Number(info.lastInsertRowid) };
  };
  return { award, calls };
}

const KICK = '2026-10-24T18:00:00.000Z';

/* ---------------- 1-2) aktarım + basketbol reddi ---------------- */

test('aktarım: futbol maçı fixture + bağ oluşturur (takım adları, kickoff, lig etiketi)', (t) => {
  const db = freshDb(t);
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });

  const r = forecast.importForecastMatches(db, [mid]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.imported.length, 1);
  assert.strictEqual(r.rejected.length, 0);

  const f = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(r.imported[0].fixture_id);
  assert.strictEqual(f.home_team, 'Galatasaray');
  assert.strictEqual(f.away_team, 'Fenerbahçe');
  assert.strictEqual(f.kickoff_at, KICK);
  assert.strictEqual(f.competition_label, 'Test Lig');
  assert.strictEqual(f.status, 'open');

  const link = db.prepare('SELECT * FROM forecast_match_links WHERE match_id = ?').get(mid);
  assert.ok(link, 'bağ kaydı yazılmalı');
  assert.strictEqual(link.fixture_id, f.id);
});

test('aktarım idempotent: aynı maç ikinci kez aktarılamaz, satır sayısı değişmez', (t) => {
  const db = freshDb(t);
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });

  const r1 = forecast.importForecastMatches(db, [mid]);
  const fixturesBefore = db.prepare('SELECT COUNT(*) AS c FROM fixtures').get().c;
  const linksBefore = db.prepare('SELECT COUNT(*) AS c FROM forecast_match_links').get().c;

  const r2 = forecast.importForecastMatches(db, [mid]);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.imported.length, 0, 'ikinci aktarımda YENİ kayıt olmamalı');
  assert.strictEqual(r2.already.length, 1);
  assert.strictEqual(r2.already[0].fixture_id, r1.imported[0].fixture_id);

  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM fixtures').get().c, fixturesBefore);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM forecast_match_links').get().c, linksBefore);
});

test('basketbol reddi: mesajla reddedilir; futbol aynı çağrıda aktarılır', (t) => {
  const db = freshDb(t);
  const fId = addMatch(db, { id: 'f1', status: 'scheduled', kickoff: KICK });
  const bId = addMatch(db, { id: 'b1', sport: 'basketball', compId: 2, homeTeamId: 3, awayTeamId: 4,
    status: 'scheduled', kickoff: KICK });

  const r = forecast.importForecastMatches(db, [fId, bId]);
  assert.strictEqual(r.imported.length, 1);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.rejected[0].id, bId);
  assert.match(r.rejected[0].reason, /basketbol/i);
  assert.match(r.rejected[0].reason, /futbol/i);
});

test('aktarım doğrulama: olmayan id, boş dizi, kickoffu belli olmayan maç', (t) => {
  const db = freshDb(t);
  assert.strictEqual(forecast.importForecastMatches(db, []).status, 400);
  assert.strictEqual(forecast.importForecastMatches(db, ['x']).status, 400);
  const r = forecast.importForecastMatches(db, [999999]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /bulunamad/i);

  const noKick = addMatch(db, { id: 'nk', status: 'scheduled', kickoff: null });
  const r2 = forecast.importForecastMatches(db, [noKick]);
  assert.strictEqual(r2.rejected.length, 1);
  assert.match(r2.rejected[0].reason, /saati belli değil/i);
});

/* ---------------- 3) aday listesi ---------------- */

test('adaylar: 7 gün içi + scheduled + feed_missing=0 + bağsız + açık lig; filtreler çalışır', (t) => {
  const db = freshDb(t);
  const NOW = '2026-10-24T12:00:00.000Z';
  addMatch(db, { id: 'ok1', status: 'scheduled', kickoff: '2026-10-25T18:00:00.000Z' });
  addMatch(db, { id: 'ok2', status: 'scheduled', kickoff: '2026-10-31T11:59:00.000Z' }); // 7 günün tam sınırı içinde
  addMatch(db, { id: 'old', status: 'scheduled', kickoff: '2026-10-24T10:00:00.000Z' }); // geçmiş
  addMatch(db, { id: 'far', status: 'scheduled', kickoff: '2026-11-05T18:00:00.000Z' }); // >7 gün
  addMatch(db, { id: 'live', status: 'live', kickoff: '2026-10-24T15:00:00.000Z', home: 1, away: 0 });
  addMatch(db, { id: 'miss', status: 'scheduled', kickoff: '2026-10-26T18:00:00.000Z', feedMissing: 1 });
  addMatch(db, { id: 'bask', sport: 'basketball', compId: 2, homeTeamId: 3, awayTeamId: 4,
    status: 'scheduled', kickoff: '2026-10-26T18:00:00.000Z' });
  const linked = addMatch(db, { id: 'lnk', status: 'scheduled', kickoff: '2026-10-27T18:00:00.000Z' });
  forecast.importForecastMatches(db, [linked]);

  const r = forecast.listForecastCandidates(db, { now: NOW });
  const kicks = r.candidates.map((c) => c.kickoff_utc);
  assert.strictEqual(r.count, 2, 'yalnız ok1+ok2 aday olmalı');
  assert.ok(kicks.includes('2026-10-25T18:00:00.000Z') && kicks.includes('2026-10-31T11:59:00.000Z'));
  // geçmiş, >7 gün, canlı, feed_missing, basketbol ve bağlı maç listede YOK
  assert.ok(!kicks.includes('2026-10-24T10:00:00.000Z'));
  assert.ok(!kicks.includes('2026-11-05T18:00:00.000Z'));
  assert.ok(!kicks.includes('2026-10-24T15:00:00.000Z'));
  assert.ok(!kicks.includes('2026-10-26T18:00:00.000Z'));
  assert.ok(!kicks.includes('2026-10-27T18:00:00.000Z'));
  assert.strictEqual(r.window_days, 7);
});

/* ---------------- 7) tahmin doğrulama ---------------- */

test('tahmin: iki tür zorunlu; başlama saatinde kapanır; mükerrer yok; puan tahmin anında 0', (t) => {
  const db = freshDb(t);
  const uid = addUser(db, 'Tahminci');
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: '2026-10-24T18:00:00.000Z' });
  const fx = forecast.importForecastMatches(db, [mid]).imported[0].fixture_id;
  const NOW = '2026-10-24T12:00:00.000Z';

  assert.strictEqual(forecast.submitPrediction(db, uid, fx, { pick1x2: '1' }, { now: NOW }).ok, false);
  assert.strictEqual(forecast.submitPrediction(db, uid, fx, { pick1x2: 'Q', pickBtts: 'yes' }, { now: NOW }).ok, false);

  const ok = forecast.submitPrediction(db, uid, fx, { pick1x2: '1', pickBtts: 'yes' }, { now: NOW });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.value.points_awarded, 0, 'puan tahmin anında DAĞITILMAZ');

  const dup = forecast.submitPrediction(db, uid, fx, { pick1x2: 'X', pickBtts: 'no' }, { now: NOW });
  assert.strictEqual(dup.ok, false);
  assert.match(dup.error, /zaten kayıtl/i);

  const uid2 = addUser(db, 'GeçKalan');
  const late = forecast.submitPrediction(db, uid2, fx, { pick1x2: '1', pickBtts: 'no' },
    { now: '2026-10-24T18:00:01.000Z' });
  assert.strictEqual(late.ok, false);
  assert.match(late.error, /kapandı/i);
});

/* ---------------- 4) otomatik sonuçlandırma: iki senkron + 30 dk ---------------- */

test('iki-senkron kuralı: tek gözlem yetmez; ikinci aynı skor + 30 dk → otomatik sonuç', (t) => {
  const db = freshDb(t);
  const uid = addUser(db, 'Tahminci');
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });
  const fx = forecast.importForecastMatches(db, [mid]).imported[0].fixture_id;
  forecast.submitPrediction(db, uid, fx, { pick1x2: '1', pickBtts: 'yes' }, { now: '2026-10-24T10:00:00.000Z' });

  const { award } = makeAward();
  const FIN = '2026-10-24T19:50:00.000Z'; // maç bitti (ilk kez görüldü)

  // 1. senkron: bitmiş 2-1 görüldü (fetched_at ilerledi)
  db.prepare('UPDATE matches SET status = ?, home_score = 2, away_score = 1, finished_at = ?, fetched_at = ? WHERE id = ?')
    .run('finished', FIN, '2026-10-24T19:51:00.000Z', mid);

  let r = forecast.processForecastSettlements(db, { now: '2026-10-24T20:25:00.000Z', award });
  assert.strictEqual(r.settled.length, 0, 'tek gözlem → sonuçlanMAZ');
  assert.strictEqual(r.observed, 1);

  // 2. senkron aynı skor (fetched_at yeniden ilerledi) + 30 dk doldu
  db.prepare('UPDATE matches SET fetched_at = ? WHERE id = ?').run('2026-10-24T20:22:00.000Z', mid);
  r = forecast.processForecastSettlements(db, { now: '2026-10-24T20:25:00.000Z', award });
  assert.strictEqual(r.settled.length, 1, 'iki kararlı gözlem + 30 dk → sonuçlanır');

  const f = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(fx);
  assert.strictEqual(f.status, 'finished');
  assert.strictEqual(f.home_score, 2);
  assert.strictEqual(f.away_score, 1);
  assert.strictEqual(f.result_1x2, '1');
  assert.strictEqual(f.result_btts, 'yes');
  assert.strictEqual(f.settled_by, 'auto');

  const p = db.prepare('SELECT * FROM predictions WHERE fixture_id = ?').get(fx);
  assert.strictEqual(p.points_awarded, 30); // 15 + 10 + 5 (ikisi de doğru)
  assert.strictEqual(db.prepare('SELECT total_points FROM users WHERE id = ?').get(uid).total_points, 30);
});

test('30 dakika kuralı: skor kararlı ama süre dolmadıysa sonuçlanmaz', (t) => {
  const db = freshDb(t);
  const uid = addUser(db, 'Tahminci');
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });
  const fx = forecast.importForecastMatches(db, [mid]).imported[0].fixture_id;
  forecast.submitPrediction(db, uid, fx, { pick1x2: '1', pickBtts: 'yes' }, { now: '2026-10-24T10:00:00.000Z' });

  const { award } = makeAward();
  const FIN = '2026-10-24T19:50:00.000Z';
  db.prepare("UPDATE matches SET status='finished', home_score=2, away_score=1, finished_at=?, fetched_at=? WHERE id=?")
    .run(FIN, '2026-10-24T19:51:00.000Z', mid);
  forecast.processForecastSettlements(db, { now: '2026-10-24T19:52:00.000Z', award });
  db.prepare('UPDATE matches SET fetched_at=? WHERE id=?').run('2026-10-24T19:55:00.000Z', mid);

  // iki kararlı gözlem VAR ama bitişten yalnız 5 dk geçti
  const r = forecast.processForecastSettlements(db, { now: '2026-10-24T19:55:00.000Z', award });
  assert.strictEqual(r.settled.length, 0, '30 dk dolmadan sonuçlanMAZ');
  assert.strictEqual(db.prepare('SELECT status FROM fixtures WHERE id=?').get(fx).status, 'open');

  // 30 dk dolduğunda (yeni senkron gerekmez — sayacın kendisi yeter)
  const r2 = forecast.processForecastSettlements(db, { now: '2026-10-24T20:20:01.000Z', award });
  assert.strictEqual(r2.settled.length, 1);
});

test('skor değişirse denge sıfırlanır: değişiklikten sonraki İKİ senkron gerekir', (t) => {
  const db = freshDb(t);
  const uid = addUser(db, 'Tahminci');
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });
  const fx = forecast.importForecastMatches(db, [mid]).imported[0].fixture_id;
  forecast.submitPrediction(db, uid, fx, { pick1x2: 'X', pickBtts: 'yes' }, { now: '2026-10-24T10:00:00.000Z' });

  const { award } = makeAward();
  const FIN = '2026-10-24T19:50:00.000Z';
  const upd = (h, a, at) => db.prepare('UPDATE matches SET home_score=?, away_score=?, fetched_at=? WHERE id=?')
    .run(h, a, at, mid);
  db.prepare("UPDATE matches SET status='finished', finished_at=? WHERE id=?").run(FIN, mid);

  upd(2, 1, '2026-10-24T19:51:00.000Z'); // gözlem 1: 2-1
  forecast.processForecastSettlements(db, { now: '2026-10-24T21:00:00.000Z', award });
  upd(1, 1, '2026-10-24T21:02:00.000Z'); // gözlem 2: skor DEĞİŞTİ → denge 1
  let r = forecast.processForecastSettlements(db, { now: '2026-10-24T21:05:00.000Z', award });
  assert.strictEqual(r.settled.length, 0, 'değişen skorun ilk gözlemi yetmez');

  upd(1, 1, '2026-10-24T21:20:00.000Z'); // gözlem 3: aynı 1-1 → denge 2
  r = forecast.processForecastSettlements(db, { now: '2026-10-24T21:25:00.000Z', award });
  assert.strictEqual(r.settled.length, 1);

  const f = db.prepare('SELECT * FROM fixtures WHERE id=?').get(fx);
  assert.strictEqual(f.home_score, 1);
  assert.strictEqual(f.away_score, 1);
  assert.strictEqual(f.result_1x2, 'X', 'son kararlı skor sonuca yazılır');
  assert.strictEqual(f.result_btts, 'yes');
});

test('aynı fetched_at yeniden gözlem SAYILMAZ; skor NULL ise hiç sonuçlanmaz', (t) => {
  const db = freshDb(t);
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });
  forecast.importForecastMatches(db, [mid]);

  const { award } = makeAward();
  db.prepare("UPDATE matches SET status='finished', home_score=2, away_score=1, finished_at=?, fetched_at=? WHERE id=?")
    .run('2026-10-24T19:50:00.000Z', '2026-10-24T19:51:00.000Z', mid);

  forecast.processForecastSettlements(db, { now: '2026-10-24T20:30:00.000Z', award });
  const link = db.prepare('SELECT * FROM forecast_match_links WHERE match_id=?').get(mid);
  assert.strictEqual(link.stable_count, 1);
  assert.strictEqual(link.last_observed_at, '2026-10-24T19:51:00.000Z');

  // fetched_at ilerlemadan bin kez çağrılsa da yeni gözlem yok
  forecast.processForecastSettlements(db, { now: '2026-10-24T21:30:00.000Z', award });
  forecast.processForecastSettlements(db, { now: '2026-10-24T22:30:00.000Z', award });
  assert.strictEqual(
    db.prepare('SELECT stable_count FROM forecast_match_links WHERE match_id=?').get(mid).stable_count, 1,
    'yeni senkron yoksa denge sayacı artMAZ'
  );

  // skor NULL olan bitmiş maç asla otomatik sonuçlanmaz
  const mid2 = addMatch(db, { id: 'm2', status: 'scheduled', kickoff: '2026-10-24T20:00:00.000Z' });
  forecast.importForecastMatches(db, [mid2]);
  db.prepare("UPDATE matches SET status='finished', home_score=NULL, away_score=NULL, finished_at=?, fetched_at=? WHERE id=?")
    .run('2026-10-24T21:50:00.000Z', '2026-10-24T21:51:00.000Z', mid2);
  const r = forecast.processForecastSettlements(db, { now: '2026-10-25T10:00:00.000Z', award });
  assert.strictEqual(r.settled.length, 0);
  assert.strictEqual(r.observed, 0, 'NULL skorlu maç gözlem bile almaz');
});

/* ---------------- 5) düzeltme senaryosu ---------------- */

test('düzeltme: sonuç sonrası sağlayıcı skoru düzeltirse ödüller yeniden dağıtılır', (t) => {
  const db = freshDb(t);
  const u1 = addUser(db, 'Isabetli');   // 1 + yes → 2-1'de 30 puan
  const u2 = addUser(db, 'Yanilan');    // 2 + no  → 2-1'de 0 puan... 2-2'de? 2 doğru değil (X), btts yes doğru değil (no) → 0
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });
  const fx = forecast.importForecastMatches(db, [mid]).imported[0].fixture_id;
  forecast.submitPrediction(db, u1, fx, { pick1x2: '1', pickBtts: 'yes' }, { now: '2026-10-24T10:00:00.000Z' });
  forecast.submitPrediction(db, u2, fx, { pick1x2: 'X', pickBtts: 'no' }, { now: '2026-10-24T10:05:00.000Z' });

  const { award, calls } = makeAward();
  const FIN = '2026-10-24T19:50:00.000Z';
  const upd = (h, a, at) => db.prepare('UPDATE matches SET home_score=?, away_score=?, fetched_at=? WHERE id=?')
    .run(h, a, at, mid);
  db.prepare("UPDATE matches SET status='finished', finished_at=? WHERE id=?").run(FIN, mid);

  // ilk sonuç: 2-1
  upd(2, 1, '2026-10-24T19:51:00.000Z');
  forecast.processForecastSettlements(db, { now: '2026-10-24T20:00:00.000Z', award });
  upd(2, 1, '2026-10-24T20:22:00.000Z');
  forecast.processForecastSettlements(db, { now: '2026-10-24T20:25:00.000Z', award });
  assert.strictEqual(db.prepare('SELECT status FROM fixtures WHERE id=?').get(fx).status, 'finished');
  assert.strictEqual(db.prepare('SELECT total_points FROM users WHERE id=?').get(u1).total_points, 30);
  assert.strictEqual(db.prepare('SELECT total_points FROM users WHERE id=?').get(u2).total_points, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM scores').get().c, 1);

  // sağlayıcı düzeltmesi: 2-2 (Aşama 5 korumasından geçip maç satırına yazıldı varsayılır)
  upd(2, 2, '2026-10-24T22:31:00.000Z');   // gözlem 1 (yeni skor)
  forecast.processForecastSettlements(db, { now: '2026-10-24T22:35:00.000Z', award });
  upd(2, 2, '2026-10-24T22:50:00.000Z');   // gözlem 2 (kararlı)
  const r = forecast.processForecastSettlements(db, { now: '2026-10-24T22:55:00.000Z', award });
  assert.strictEqual(r.corrections.length, 1, 'düzeltme tetiklenmeli');
  assert.strictEqual(r.corrections[0].from.home, 2);
  assert.strictEqual(r.corrections[0].to.away, 2);

  const f = db.prepare('SELECT * FROM fixtures WHERE id=?').get(fx);
  assert.strictEqual(f.home_score, 2);
  assert.strictEqual(f.away_score, 2);
  assert.strictEqual(f.result_1x2, 'X');
  assert.strictEqual(f.result_btts, 'yes');
  assert.strictEqual(f.settled_by, 'correction');

  // u1: 1 yanlış (X oldu) ama KG evet doğru → 10 puan; u2: X doğru ama KG hayır yanlış → 15 puan
  assert.strictEqual(db.prepare('SELECT total_points FROM users WHERE id=?').get(u1).total_points, 10);
  assert.strictEqual(db.prepare('SELECT total_points FROM users WHERE id=?').get(u2).total_points, 15);

  // scores tablosu dürüst: eski satır silindi, yalnız yenileri var
  const scores = db.prepare('SELECT user_id, points FROM scores ORDER BY user_id').all();
  assert.strictEqual(scores.length, 2);
  assert.deepStrictEqual(scores.map((s) => s.points).sort(), [10, 15]);
  // ödül küpürleri güncel
  const p1 = db.prepare('SELECT * FROM predictions WHERE fixture_id=? AND user_id=?').get(fx, u1);
  assert.strictEqual(p1.points_awarded, 10);
  assert.ok(JSON.parse(p1.award_detail).scores_row_id > 0);
});

/* ---------------- 6) inceleme bayrakları ---------------- */

test('feed_missing: bayrak gelir, otomatik iptal YOK', (t) => {
  const db = freshDb(t);
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });
  const fx = forecast.importForecastMatches(db, [mid]).imported[0].fixture_id;

  db.prepare('UPDATE matches SET feed_missing = 1 WHERE id = ?').run(mid);
  const r = forecast.processForecastSettlements(db, { now: '2026-10-24T20:00:00.000Z' });
  assert.strictEqual(r.flagged.length, 1);
  assert.strictEqual(r.flagged[0].reason, 'match_feed_missing');

  const f = db.prepare('SELECT * FROM fixtures WHERE id=?').get(fx);
  assert.strictEqual(f.review_required, 1, 'İnceleme gerekli bayrağı');
  assert.strictEqual(f.status, 'open', 'otomatik iptal YOK');
});

test('ertelenme: postponed + kickoff değişimi → bayrak; fixture saati OTOMATİK DEĞİŞMEZ', (t) => {
  const db = freshDb(t);
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });
  const fx = forecast.importForecastMatches(db, [mid]).imported[0].fixture_id;

  // sağlayıcı erteledi: durum postponed, yeni kickoff yazıldı (Aşama 3 kural 3.4)
  db.prepare("UPDATE matches SET status='postponed', kickoff_utc='2026-10-27T18:00:00.000Z' WHERE id=?").run(mid);
  const r = forecast.processForecastSettlements(db, { now: '2026-10-24T20:00:00.000Z' });
  assert.strictEqual(r.flagged.length, 1);
  assert.strictEqual(r.flagged[0].reason, 'match_postponed');

  const f = db.prepare('SELECT * FROM fixtures WHERE id=?').get(fx);
  assert.strictEqual(f.review_required, 1);
  assert.strictEqual(f.kickoff_at, KICK, 'kickoff otomatik uygulanMAZ');
  assert.strictEqual(f.status, 'open', 'iptal de YOK');

  // admin saat günceller → bayrak kapanır, saat adminin verdiği olur
  const up = forecast.updateFixtureKickoff(db, fx, '2026-10-27 21:00');
  assert.strictEqual(up.ok, true);
  const f2 = db.prepare('SELECT * FROM fixtures WHERE id=?').get(fx);
  assert.strictEqual(f2.kickoff_at, '2026-10-27T18:00:00.000Z'); // 21:00 TR = 18:00 UTC
  assert.strictEqual(f2.review_required, 0);
});

test('kickoff değişimi (erteleme durumu bilinmeden): yalnız bayrak', (t) => {
  const db = freshDb(t);
  const mid = addMatch(db, { id: 'm1', status: 'scheduled', kickoff: KICK });
  const fx = forecast.importForecastMatches(db, [mid]).imported[0].fixture_id;

  db.prepare("UPDATE matches SET kickoff_utc='2026-10-26T18:00:00.000Z' WHERE id=?").run(mid);
  const r = forecast.processForecastSettlements(db, { now: '2026-10-24T20:00:00.000Z' });
  assert.strictEqual(r.flagged[0].reason, 'kickoff_changed');
  assert.strictEqual(db.prepare('SELECT kickoff_at FROM fixtures WHERE id=?').get(fx).kickoff_at, KICK);
});

/* ---------------- 8) settleFixture: puanlama + elle yol ---------------- */

test('settleFixture puanlama: 1/X/2 +15, KG +10, ikisi +5 bonus; yanlış → 0', (t) => {
  const db = freshDb(t);
  const u1 = addUser(db, 'TamIsabet');   // 1 + yes
  const u2 = addUser(db, 'YariIsabet');  // 1 + no
  const u3 = addUser(db, 'Bosan');       // 2 + no
  const fx = forecast.createManualFixture(db, {
    homeTeam: 'Kırmızılar', awayTeam: 'Sarılar', kickoffAt: '2026-10-25 19:00'
  }).value.id;
  const NOW = '2026-10-25T10:00:00.000Z';
  forecast.submitPrediction(db, u1, fx, { pick1x2: '1', pickBtts: 'yes' }, { now: NOW });
  forecast.submitPrediction(db, u2, fx, { pick1x2: '1', pickBtts: 'no' }, { now: NOW });
  forecast.submitPrediction(db, u3, fx, { pick1x2: '2', pickBtts: 'no' }, { now: NOW });

  const { award } = makeAward();
  const r = forecast.settleFixture(db, fx, { homeScore: 2, awayScore: 1 }, { by: 'admin', award });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.by, 'admin'); // elle giriş AYNI fonksiyon
  assert.strictEqual(r.predictions, 3);
  assert.strictEqual(r.awarded, 30 + 15);

  assert.strictEqual(db.prepare('SELECT total_points FROM users WHERE id=?').get(u1).total_points, 30);
  assert.strictEqual(db.prepare('SELECT total_points FROM users WHERE id=?').get(u2).total_points, 15);
  assert.strictEqual(db.prepare('SELECT total_points FROM users WHERE id=?').get(u3).total_points, 0);
  assert.strictEqual(db.prepare('SELECT settled_by FROM fixtures WHERE id=?').get(fx).settled_by, 'admin');
});

test('settleFixture doğrulama + idempotent: aynı skor ikinci çağrı puan vermez', (t) => {
  const db = freshDb(t);
  const uid = addUser(db, 'Tahminci');
  const fx = forecast.createManualFixture(db, { homeTeam: 'A Takımı', awayTeam: 'B Takımı', kickoffAt: '2026-10-25 19:00' }).value.id;
  forecast.submitPrediction(db, uid, fx, { pick1x2: '1', pickBtts: 'no' }, { now: '2026-10-25T10:00:00.000Z' });

  const { award } = makeAward();
  assert.strictEqual(forecast.settleFixture(db, fx, { homeScore: -1, awayScore: 0 }, { award }).ok, false);
  assert.strictEqual(forecast.settleFixture(db, fx, { homeScore: 'a', awayScore: 0 }, { award }).ok, false);
  assert.strictEqual(forecast.settleFixture(db, 999, { homeScore: 1, awayScore: 0 }, { award }).status, 404);

  const r1 = forecast.settleFixture(db, fx, { homeScore: 1, awayScore: 0 }, { award });
  assert.strictEqual(r1.ok, true);
  const r2 = forecast.settleFixture(db, fx, { homeScore: 1, awayScore: 0 }, { award });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.already, true, 'aynı skor → küsuratsız idempotent');
  // tahmin '1' + 'no', skor 1-0 → ikisi de doğru → 30 (15+10+5)
  assert.strictEqual(db.prepare('SELECT total_points FROM users WHERE id=?').get(uid).total_points, 30,
    'ikinci çağrı puan EKLEMEZ');

  // iptal edilmiş maç sonuçlanamaz
  const fx2 = forecast.createManualFixture(db, { homeTeam: 'C Takımı', awayTeam: 'D Takımı', kickoffAt: '2026-10-25 19:00' }).value.id;
  forecast.cancelFixture(db, fx2);
  assert.strictEqual(forecast.settleFixture(db, fx2, { homeScore: 1, awayScore: 1 }, { award }).ok, false);
});

test('elle giriş akışı: createManualFixture doğrulama + parseKickoffInput (TR saati → UTC)', (t) => {
  assert.strictEqual(forecast.parseKickoffInput('2026-10-31 19:00'), '2026-10-31T16:00:00.000Z');
  assert.strictEqual(forecast.parseKickoffInput('2026-10-31T19:30'), '2026-10-31T16:30:00.000Z');
  assert.strictEqual(forecast.parseKickoffInput('2026-10-31T16:00:00Z'), '2026-10-31T16:00:00.000Z');
  assert.strictEqual(forecast.parseKickoffInput('2026-02-30 19:00'), null, 'gerçek olmayan gün reddedilir');
  assert.strictEqual(forecast.parseKickoffInput('31/10/2026'), null);

  const db = freshDb(t);
  assert.strictEqual(forecast.createManualFixture(db, { homeTeam: 'A', awayTeam: 'B', kickoffAt: 'x' }).status, 400);
  assert.strictEqual(forecast.createManualFixture(db, { homeTeam: 'A', awayTeam: 'A', kickoffAt: '2026-10-31 19:00' }).status, 400);
  const r = forecast.createManualFixture(db, { homeTeam: 'Kırmızılar', awayTeam: 'Sarılar',
    kickoffAt: '2026-10-31 19:00', competitionLabel: 'Dostluk Maçı' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.status, 'open');
  assert.strictEqual(r.value.kickoff_at, '2026-10-31T16:00:00.000Z');
  assert.strictEqual(r.value.competition_label, 'Dostluk Maçı');
});

test('kullanıcı listesi: açık + geçmiş ayrımı, can_predict kapanışı, kendi tahmini', (t) => {
  const db = freshDb(t);
  const uid = addUser(db, 'Tahminci');
  const NOW = '2026-10-24T12:00:00.000Z';

  const fx1 = forecast.createManualFixture(db, { homeTeam: 'A Takımı', awayTeam: 'B Takımı', kickoffAt: '2026-10-24 20:00' }).value.id;
  const fx2 = forecast.createManualFixture(db, { homeTeam: 'C Takımı', awayTeam: 'D Takımı', kickoffAt: '2026-10-24 15:00' }).value.id; // sonuçlandı
  const fx3 = forecast.createManualFixture(db, { homeTeam: 'E Takımı', awayTeam: 'F Takımı', kickoffAt: '2026-10-24 13:00' }).value.id; // başladı, hâlâ açık
  forecast.submitPrediction(db, uid, fx1, { pick1x2: '1', pickBtts: 'yes' }, { now: NOW });
  forecast.settleFixture(db, fx2, { homeScore: 1, awayScore: 1 }, { by: 'admin', award: makeAward().award });

  const list = forecast.listForecastForUser(db, uid, { now: NOW });
  assert.strictEqual(list.fixtures.open.length, 2); // fx1 (gelecek) + fx3 (başladı ama açık)
  assert.strictEqual(list.fixtures.recent.length, 1);

  const o1 = list.fixtures.open.find((f) => f.id === fx1);
  assert.strictEqual(o1.can_predict, true);
  assert.strictEqual(o1.my_prediction.pick_1x2, '1');
  assert.strictEqual(o1.prediction_count, 1);

  const o3 = list.fixtures.open.find((f) => f.id === fx3);
  assert.strictEqual(o3.can_predict, false, 'başlama saati geçti → tahmine kapalı');

  const rec = list.fixtures.recent[0];
  assert.strictEqual(rec.status, 'finished');
  assert.strictEqual(rec.result_1x2, 'X');
});
