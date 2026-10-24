/**
 * AŞAMA 9 canlı kabul zinciri (gerçek DB + gerçek SportScore senkronu)
 *
 *  1. TribunKurdu girişi (JWT) — gerçek tahmin akışı için
 *  2. Yaklaşan maç aktarımı (Samsunspor-Amedspor #3, Napoli-Roma #33)
 *  3. İDEMPOTENT: #3 ikinci kez → already
 *  4. BASKETBOL reddi: Memphis-Utah #110 → reddedilir
 *  5. GERÇEK tahmin: Samsunspor maçı için kullanıcı arayüzünün kullandığı uç
 *  6. Bitmiş gerçek maç aktarımı: Aston Villa 2-1 Man City #14 (45 dk önce bitti)
 *     + 3 demo kullanıcının tahmini (maç başladığı için arayüzden girilemez —
 *       demo verisi olarak yazılır; sonuç zinciri GERÇEK)
 *  7. Denetçi gözlem 1 (admin fixtures GET → processForecastSettlements)
 *  8. EPL bugün senkronu (gerçek istek) → kanka → gözlem 2 → OTOMATİK SONUÇ
 *  9. Doğrulama: fixtures / predictions / scores / users.total_points
 * 10. Ertelenme bayrağı demosu: #3 → postponed → İNCELEME GEREKLİ → restore
 *
 * Kullanım: node scripts/asama9-acceptance.js
 */
const BASE = 'http://localhost:3000';
const ADMIN_KEY = 'tribun-admin-anahtari';

async function api(path, { method = 'GET', body, admin = false, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers['x-admin-key'] = ADMIN_KEY;
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch { /* boş */ }
  return { status: res.status, data };
}

(async () => {
  const log = (...a) => console.log(...a);
  const eq = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
  };

  /* 1) giriş */
  const login = await api('/api/auth/login', { method: 'POST', body: { nickname: 'TribunKurdu', password: 'sifre123' } });
  const token = login.data && login.data.token;
  if (!token) { console.error('Giriş başarısız:', login); process.exit(1); }
  log('1) TribunKurdu girişi OK');

  /* 2) yaklaşan maçları aktar */
  const imp = await api('/api/admin/sports/forecast/import', {
    method: 'POST', admin: true, body: { matchIds: [3, 33] }
  });
  eq('2) aktarım: 2 maç aktarıldı', imp.data.imported.length, 2);
  eq('2) aktarım: ret yok', imp.data.rejected.length, 0);
  const samsunFx = imp.data.imported.find((x) => x.id === 3).fixture_id;
  log('   Samsunspor fixture:', samsunFx, '| Napoli fixture:', imp.data.imported.find((x) => x.id === 33).fixture_id);

  /* 3) idempotent */
  const imp2 = await api('/api/admin/sports/forecast/import', {
    method: 'POST', admin: true, body: { matchIds: [3] }
  });
  eq('3) ikinci aktarım: yeni yok', imp2.data.imported.length, 0);
  eq('3) ikinci aktarım: zaten bağlı', imp2.data.already.length, 1);
  eq('3) ikinci aktarım: fixture aynı', imp2.data.already[0].fixture_id, samsunFx);

  /* 4) basketbol reddi */
  const impB = await api('/api/admin/sports/forecast/import', {
    method: 'POST', admin: true, body: { matchIds: [110] }
  });
  eq('4) basketbol reddedildi', impB.data.rejected.length, 1);
  log('   ret mesajı:', impB.data.rejected[0].reason);

  /* 5) gerçek tahmin (kullanıcı ucu) */
  const pred = await api('/api/games/forecast/predict', {
    method: 'POST', token,
    body: { fixtureId: samsunFx, pick1x2: '1', pickBtts: 'yes' }
  });
  eq('5) tahmin kaydedildi (puan 0)', pred.data.points_awarded, 0);
  const predDup = await api('/api/games/forecast/predict', {
    method: 'POST', token, body: { fixtureId: samsunFx, pick1x2: 'X', pickBtts: 'no' }
  });
  eq('5) mükerrer tahmin reddedildi', predDup.status, 400);

  /* 6) bitmiş gerçek maçı aktar + demo tahminleri */
  const impF = await api('/api/admin/sports/forecast/import', {
    method: 'POST', admin: true, body: { matchIds: [14] }
  });
  eq('6) bitmiş maç aktarıldı', impF.data.imported.length, 1);
  const avFx = impF.data.imported[0].fixture_id;

  const db = require('better-sqlite3')('data/tribun.db');
  const insPred = db.prepare(
    'INSERT INTO predictions (fixture_id, user_id, pick_1x2, pick_btts, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const demoUsers = [
    { id: 18, nick: 'DerbiKahini', picks: ['1', 'yes'] },   // ikisi de doğru → 30
    { id: 19, nick: 'KaleciBaba', picks: ['X', 'yes'] },    // KG doğru → 10
    { id: 20, nick: 'AnaliZeka', picks: ['2', 'no'] }       // ikisi de yanlış → 0
  ];
  for (const u of demoUsers) {
    insPred.run(avFx, u.id, u.picks[0], u.picks[1], new Date().toISOString());
  }
  const totalsBefore = Object.fromEntries(
    demoUsers.map((u) => [u.id, db.prepare('SELECT total_points FROM users WHERE id = ?').get(u.id).total_points])
  );
  log('6) demo tahminleri yazıldı; öncesi puanlar:', JSON.stringify(totalsBefore));

  /* 7) gözlem 1 (admin fixtures GET denetçiyi de koşar) */
  const fx1 = await api('/api/admin/forecast/fixtures', { admin: true });
  const avRow1 = fx1.data.fixtures.find((f) => f.id === avFx);
  eq('7) gözlem 1 sonrası hâlâ AÇIK', avRow1.status, 'open');

  /* 8) EPL bugün senkronu → kanka → gözlem 2 → otomatik sonuç */
  log('8) EPL senkronu tetikleniyor (gerçek SportScore istekleri)...');
  await api('/api/admin/sports/sync/fixtures', {
    method: 'POST', admin: true,
    body: { competition: 'english-premier-league', dateFrom: '2026-10-24', dateTo: '2026-10-24' }
  });
  await new Promise((r) => setTimeout(r, 9000)); // senkron arkada planda: 1 çift ~1-2 sn + yazma

  const fx2 = await api('/api/admin/forecast/fixtures', { admin: true });
  const avRow2 = fx2.data.fixtures.find((f) => f.id === avFx);
  eq('9) otomatik sonuç: SONUÇLANDI', avRow2.status, 'finished');
  eq('9) skor 2-1', [avRow2.home_score, avRow2.away_score], [2, 1]);
  eq('9) sonuç 1 / KG Var', [avRow2.result_1x2, avRow2.result_btts], ['1', 'yes']);
  eq('9) settled_by otomatik', avRow2.settled_by, 'auto');
  eq('9) 3 tahmin işlendi', avRow2.prediction_count, 3);

  /* 9) DB doğrulama */
  const preds = db.prepare('SELECT p.*, u.nickname FROM predictions p JOIN users u ON u.id = p.user_id WHERE p.fixture_id = ? ORDER BY u.id').all(avFx);
  eq('9) DerbiKahini +30', preds.find((p) => p.nickname === 'DerbiKahini').points_awarded, 30);
  eq('9) KaleciBaba +10', preds.find((p) => p.nickname === 'KaleciBaba').points_awarded, 10);
  eq('9) AnaliZeka +0', preds.find((p) => p.nickname === 'AnaliZeka').points_awarded, 0);
  for (const p of preds) {
    const now = db.prepare('SELECT total_points FROM users WHERE id = ?').get(p.user_id).total_points;
    eq(`9) ${p.nickname} total_points ${totalsBefore[p.user_id]}→${now}`, now, totalsBefore[p.user_id] + p.points_awarded);
  }
  const scores = db.prepare("SELECT s.user_id, u.nickname, s.points, s.meta FROM scores s JOIN users u ON u.id = s.user_id WHERE s.game = 'oracle' AND s.meta LIKE ? ORDER BY s.id").all(`%"fixture_id":${avFx}%`);
  eq('9) scores satırları: 2 ödeme', scores.length, 2);
  log('   scores:', JSON.stringify(scores.map((s) => ({ nick: s.nickname, points: s.points }))));

  /* 10) ertelenme bayrağı demosu (geçici elle durum → bayrak → restore) */
  db.prepare("UPDATE matches SET status = 'postponed' WHERE id = 3").run();
  const fx3 = await api('/api/admin/forecast/fixtures', { admin: true });
  const samsunRow = fx3.data.fixtures.find((f) => f.id === samsunFx);
  eq('10) İNCELEME GEREKLİ bayrağı', samsunRow.review_required, 1);
  eq('10) gerekçe: ertelendi', samsunRow.review_reason, 'match_postponed');
  eq('10) otomatik iptal YOK', samsunRow.status, 'open');
  log('   admin görünümü:', samsunRow.status, '| inceleme:', samsunRow.review_required, '|', samsunRow.review_reason);

  // restore: durumu geri al + incelemeyi kapat (admin ucu)
  db.prepare("UPDATE matches SET status = 'scheduled' WHERE id = 3").run();
  await api(`/api/admin/forecast/fixtures/${samsunFx}/resolve`, { method: 'POST', admin: true, body: {} });
  const fx4 = await api('/api/admin/forecast/fixtures', { admin: true });
  const samsunRow2 = fx4.data.fixtures.find((f) => f.id === samsunFx);
  eq('10) restore sonrası bayrak kapalı', samsunRow2.review_required, 0);
  eq('10) maç hâlâ açık', samsunRow2.status, 'open');

  /* kullanıcı listesi (sayfanın verisi) */
  const myList = await api('/api/games/forecast/fixtures', { token });
  log('\n11) kullanıcı görünümü:');
  myList.data.fixtures.open.forEach((f) => {
    log(`   [AÇIK] ${f.home_team} — ${f.away_team} · ${f.kickoff_at} · lig: ${f.competition_label} · tahmin: ${f.prediction_count}${f.my_prediction ? ' (benim: ' + f.my_prediction.pick_1x2 + '/' + f.my_prediction.pick_btts + ')' : ''}`);
  });
  myList.data.fixtures.recent.forEach((f) => {
    log(`   [SONUÇ] ${f.home_team} ${f.home_score}-${f.away_score} ${f.away_team} · ${f.result_1x2}/${f.result_btts} · benim puanım: ${f.my_prediction ? f.my_prediction.points_awarded : '-'}`);
  });

  db.close();
  log('\n=== CANLI KABUL ZİNCİRİ TAMAM ===');
})().catch((e) => { console.error('HATA:', e); process.exit(1); });
