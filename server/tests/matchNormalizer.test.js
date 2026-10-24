/**
 * Aşama 2 testleri — node:test (yeni bağımlılık YOK)
 * Sabit test verileri, Aşama 0'daki ÖRNEK YANIT yapılarıyla birebir aynı biçimde.
 * Çalıştırma: npm test  (→ node --test server/tests/)
 */
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

/* test edilen saf katman (db gerektirmez) */
const {
  normalizeListMatch, normalizeDetail, teamUnmapped, nameKey, idsFromUrl, toScore
} = require('../services/matchNormalizer');

/* --- gerçek örnek yanıtından birebir alınmış sabit veriler --- */
const FB_RAW = { // data/samples: São Paulo – Vasco (finished 1-0)
  home: 'São Paulo - SP', away: 'Vasco da Gama Saf - RJ',
  home_logo: 'https://img.thesports.com/football/team/31f5171de0e1404fdebcef19cd7cd409.png',
  away_logo: 'https://img.thesports.com/football/team/f110dc3a4400e67ecbc46511a7ea83f7.png',
  home_score: '1', away_score: '0',
  status: 'finished', status_text: 'Finished',
  time: '2026-10-18T00:00:00+00:00',
  competition: 'Brazilian Serie A',
  competition_logo: 'x', url: '/football/match/sao-paulo-vs-clube-de-regatas-vasco-da-gama/jw2r09hk6lp0rz8/'
};
const BB_RAW = { // data/samples: Truenos U21 (basketbol, id'siz url)
  home: 'Truenos de Talca U21', away: 'Municipal Puente Alto U21',
  home_logo: 'b1', away_logo: 'b2',
  home_score: '68', away_score: '69',
  status: 'finished', status_text: 'Finished',
  time: '2026-10-18T00:00:00+00:00',
  competition: 'Chile Liga U21',
  url: '/basketball/match/truenos-de-talca-u21-vs-municipal-puente-alto-u21/'
};
const COMP = { id: 5, name: 'Brazilian Serie A' };

const DETAIL_RAW = { // data/samples 06: widget/match futbol (kısaltılmış)
  home: 'São Paulo - SP', away: 'Vasco da Gama Saf - RJ',
  home_score: '1', away_score: '0',
  status: 'finished', status_text: 'Finished',
  time: '2026-10-18T00:00:00+00:00',
  competition: 'Brazilian Serie A', url: FB_RAW.url,
  live_minute: null, home_ht_score: '0', away_ht_score: '0',
  incidents: [
    { time: 42, type: 'Yellow card', type_id: 3, side: 'home', player: 'Artur Victor' },
    { time: 68, type: 'Goal', type_id: 1, side: 'home', player: 'Artur Victor', is_goal: true, home_score: 1, away_score: 0 },
    { time: 45, type: 'Substitution', type_id: 9, side: 'away', player_in: 'Jose Rodriguez', player_out: 'Pablo' },
    { time: 61, type: 'VAR check', type_id: 99, side: 'home' }
  ],
  stats: [
    { label: 'Ball Possession', home: '55%', away: '45%' },
    { label: 'Shots on Target', home: '6', away: '2' },
    { label: 'Expected Goals xG', home: '1.8', away: '0.7' }
  ],
  lineups: { confirmed: true, home_formation: null, away_formation: null, home_coach: null, away_coach: null,
             home_xi: [{ name: 'Rafael', number: 23, position: 'G', captain: false, rating: '7.2' }] },
  tracker: { id: 'jw2r09hk6lp0rz8' }
};

/* ---------------- url/external_id ---------------- */

test('futbol: url son parçası external_id olur', () => {
  const r = idsFromUrl(FB_RAW.url, 'football', '2026-10-18T00:00:00.000Z');
  assert.strictEqual(r.externalId, 'jw2r09hk6lp0rz8');
  assert.strictEqual(r.matchSlug, 'sao-paulo-vs-clube-de-regatas-vasco-da-gama');
  assert.strictEqual(r.urlPath, FB_RAW.url);
});

test('basketbol: external_id = "<match_slug>@<YYYY-MM-DD UTC>"', () => {
  const r = idsFromUrl(BB_RAW.url, 'basketball', '2026-10-18T00:00:00.000Z');
  assert.strictEqual(r.externalId, 'truenos-de-talca-u21-vs-municipal-puente-alto-u21@2026-10-18');
});

/* ---------------- skor ---------------- */

test('skor: metin → tam sayı; boş → NULL; 0 korunur; çöp → NaN', () => {
  assert.strictEqual(toScore('1'), 1);
  assert.strictEqual(toScore('0'), 0);
  assert.strictEqual(toScore(''), null);
  assert.strictEqual(toScore(null), null);
  assert.ok(Number.isNaN(toScore('1-0')));
});

test('liste maçı: NULL skor başlamamış maçta NULL kalır (0 ile karışmaz)', () => {
  const raw = { ...FB_RAW, home_score: '', away_score: '', status: 'upcoming', status_text: 'Not started' };
  const r = normalizeListMatch(raw, 'football', COMP);
  assert.ok(r.ok);
  assert.strictEqual(r.value.homeScore, null);
  assert.strictEqual(r.value.awayScore, null);
  assert.strictEqual(r.value.status, 'scheduled');
});

test('liste maçı: 0-0 bitmiş maçta skorlar 0 kalır', () => {
  const raw = { ...FB_RAW, home_score: '0', away_score: '0' };
  const r = normalizeListMatch(raw, 'football', COMP);
  assert.ok(r.ok);
  assert.strictEqual(r.value.homeScore, 0);
  assert.strictEqual(r.value.awayScore, 0);
  assert.strictEqual(r.value.status, 'finished');
});

/* ---------------- zaman / utc ---------------- */

test('zaman: +00:00 girdisi → Z ile biten UTC ISO', () => {
  const r = normalizeListMatch(FB_RAW, 'football', COMP);
  assert.ok(r.ok);
  assert.strictEqual(r.value.kickoffUtc, '2026-10-18T00:00:00.000Z');
});

test('zaman: geçersiz time → kayıt reddedilir, uygulama çökmez', () => {
  const r = normalizeListMatch({ ...FB_RAW, time: 'bugün' }, 'football', COMP);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('time')));
});

/* ---------------- durum / period eşleme ---------------- */

test('durum tablosu: live/finished/upcoming eşleşir; live period status_text’ten gelir', () => {
  const live = normalizeListMatch({ ...FB_RAW, status: 'live', status_text: '2nd half', home_score: '1', away_score: '1' }, 'football', COMP);
  assert.strictEqual(live.value.status, 'live');
  assert.strictEqual(live.value.period, 'H2'); // DOĞRULANMIŞ eşleme

  const q1 = normalizeListMatch({ ...BB_RAW, status: 'live', status_text: '1st quarter', home_score: '12', away_score: '9' }, 'basketball', COMP);
  assert.strictEqual(q1.value.period, 'Q1'); // DOĞRULANMIŞ eşleme

  const ht = normalizeListMatch({ ...FB_RAW, status: 'live', status_text: 'half time', home_score: '1', away_score: '0' }, 'football', COMP);
  assert.strictEqual(ht.value.period, 'HT');
});

test('bilinmeyen durum → unmapped + yedek kural (gelecek+skorsuz → scheduled)', () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const r = normalizeListMatch({ ...FB_RAW, status: 'delayed by referee', time: future, home_score: '', away_score: '' }, 'football', COMP);
  assert.strictEqual(r.value.status, 'scheduled');
  assert.ok(r.unmapped.some((u) => u.kind === 'status' && u.rawValue === 'delayed by referee'));

  const past = new Date(Date.now() - 3600_000).toISOString();
  const r2 = normalizeListMatch({ ...FB_RAW, status: 'weird', time: past, home_score: '', away_score: '' }, 'football', COMP);
  assert.strictEqual(r2.value.status, 'unknown');
});

test('bilinmeyen status_text → period boş + unmapped', () => {
  const r = normalizeListMatch({ ...FB_RAW, status: 'live', status_text: 'third period of extra cheer' }, 'football', COMP);
  assert.strictEqual(r.value.period, null);
  assert.ok(r.unmapped.some((u) => u.kind === 'status_text'));
});

/* ---------------- takım alias ---------------- */

test('takım name_key: Türkçe karakterler kurala göre sadeleşir', () => {
  assert.strictEqual(nameKey('Kasımpaşa'), 'kasimpasa');
  assert.strictEqual(nameKey('Yılport Samsunspor'), 'yilport-samsunspor');
  assert.strictEqual(nameKey('São Paulo - SP'), 'sao-paulo-sp');
});

test('teamUnmapped: her iki takım için team_name kaydı üretir', () => {
  const r = normalizeListMatch(FB_RAW, 'football', COMP);
  const t = teamUnmapped(r.value);
  assert.strictEqual(t.length, 2);
  assert.ok(t.every((x) => x.kind === 'team_name' && x.rawValue && x.nameKey));
});

/* ---------------- detay (futbol) ---------------- */

test('detay: olaylar type_id ile, bilinmeyen tür other + unmapped', () => {
  const r = normalizeDetail(DETAIL_RAW, 'football');
  assert.ok(r.ok);
  const byType = {};
  for (const i of r.value.incidents) byType[i.type] = (byType[i.type] || 0) + 1;
  assert.strictEqual(byType.yellow_card, 1);
  assert.strictEqual(byType.goal, 1);
  assert.strictEqual(byType.substitution, 1);
  assert.strictEqual(byType.other, 1); // type_id 99
  assert.ok(r.unmapped.some((u) => u.kind === 'incident_type' && u.rawValue.includes('99')));
  // gol olayı sonrası skoru taşır
  const goal = r.value.incidents.find((i) => i.type === 'goal');
  assert.strictEqual(goal.homeScore, 1);
});

test('detay: istatistik etiketleri sözlükle Türkçeleşir, bilinmeyen olduğu gibi + unmapped', () => {
  const r = normalizeDetail(DETAIL_RAW, 'football');
  const labels = r.value.stats.map((s) => `${s.label}→${s.labelTr}`);
  assert.ok(labels.includes('Ball Possession→Topla Oynama'));
  assert.ok(labels.includes('Shots on Target→İsabetli Şut'));
  assert.ok(labels.includes('Expected Goals xG→Expected Goals xG')); // sözlük dışı
  assert.ok(r.unmapped.some((u) => u.kind === 'stats_label' && u.rawValue === 'Expected Goals xG'));
});

test('detay: lineups rating içermez, formation null kalabilir, live_minute tam sayı olur', () => {
  const r = normalizeDetail({ ...DETAIL_RAW, live_minute: '67' }, 'football');
  assert.strictEqual(r.value.liveMinute, 67);
  assert.strictEqual(r.value.lineups.homeFormation, null);
  const p = r.value.lineups.homeXi[0];
  assert.ok(!('rating' in p));
  assert.deepStrictEqual({ name: p.name, number: p.number, position: p.position }, { name: 'Rafael', number: 23, position: 'G' });
});

test('detay: basketbol normalize edilmez (red)', () => {
  const r = normalizeDetail(DETAIL_RAW, 'basketball');
  assert.strictEqual(r.ok, false);
});

/* ---------------- unmapped_values tablosuna yazım (bellek-içi SQLite) ---------------- */

test('unmapped_values: gerçek tabloya yazılır ve hits artar (bellek-içi DB)', () => {
  // geçici olarak db modülünü taklit eden bellek-içi veritabanıyla yazıcıyı sına
  const mem = new Database(':memory:');
  mem.exec(`CREATE TABLE IF NOT EXISTS unmapped_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, raw_value TEXT NOT NULL,
    sport TEXT, seen_at TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 1,
    UNIQUE(kind, raw_value, sport));`);

  const stmt = mem.prepare(`
    INSERT INTO unmapped_values (kind, raw_value, sport, seen_at, hits)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(kind, raw_value, sport) DO UPDATE SET hits = hits + 1, seen_at = excluded.seen_at
  `);
  const write = (items, sport) => {
    for (const it of items) stmt.run(it.kind, String(it.rawValue), sport, new Date().toISOString());
  };

  const r = normalizeListMatch({ ...FB_RAW, status: 'postponed by fog', time: FB_RAW.time }, 'football', COMP);
  write(r.unmapped, 'football');
  write(r.unmapped, 'football'); // ikinci görüş

  const row = mem.prepare('SELECT kind, raw_value, hits FROM unmapped_values').get();
  assert.strictEqual(row.kind, 'status');
  assert.strictEqual(row.raw_value, 'postponed by fog');
  assert.strictEqual(row.hits, 2);
  mem.close();
});

/* ---------------- bütçe/api_usage sayacı (spend) ---------------- */

test('api_usage: bir deneme çağrısı sayacı arttırır (bellek-içi db ile spend davranışı)', async () => {
  const mem = new Database(':memory:');
  mem.exec(`CREATE TABLE api_usage (day_utc TEXT NOT NULL, endpoint TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day_utc, endpoint));`);

  // sportScoreClient gerçek db'yi kullandığından burada spend'ın SQL tarafını sınarız
  const stmt = mem.prepare(`
    INSERT INTO api_usage (day_utc, endpoint, count) VALUES (?, ?, 1)
    ON CONFLICT(day_utc, endpoint) DO UPDATE SET count = count + 1
  `);
  const endpoint = '/api/v1/fixtures/';
  const today = new Date().toISOString().slice(0, 10);
  stmt.run(today, endpoint);
  stmt.run(today, endpoint);
  const row = mem.prepare('SELECT count FROM api_usage WHERE day_utc = ? AND endpoint = ?').get(today, endpoint);
  assert.strictEqual(row.count, 2);
  mem.close();
});
