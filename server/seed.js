/**
 * Tribün — örnek veri (seed)
 * Kullanım:
 *   npm run seed                → veritabanı boşsa ekler
 *   node server/seed.js --force → mevcut veriyi silip yeniden ekler
 *
 * Örnek kullanıcıların şifresi: sifre123  (README'de de yazıyor)
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { checkBadges } = require('./utils/badges');
const { nowLocal, todayLocal } = require('./utils/helpers');

const force = process.argv.includes('--force');

const TABLES = ['reports', 'bingo_players', 'bingo_rooms', 'transfer_squads', 'memories',
  'dictionary_votes', 'dictionary_terms', 'badges', 'scores', 'users'];

if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) {
  if (!force) {
    console.log('ℹ️  Veritabanında zaten veri var. Yeniden basmak için: npm run seed -- --force');
    process.exit(0);
  }
  db.pragma('foreign_keys = OFF');
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  db.pragma('foreign_keys = ON');
  console.log('🧹 Mevcut veriler silindi (--force).');
}

const PASS = 'sifre123';
const hash = bcrypt.hashSync(PASS, 10);

// ---- Kullanıcılar -------------------------------------------------------
const insertUser = db.prepare(
  `INSERT INTO users (nickname, password_hash, fan_title, total_points, streak, last_login_date, created_at)
   VALUES (?, ?, ?, 0, ?, ?, ?)`
);
const users = [
  // [nick, unvan, streak, son giriş (bugün/dün/2 gün önce), kayıt günleri önce]
  ['TribunKurdu', 'Tribün Şairi', 4, 0, 40],
  ['DerbiKahini', 'Sessiz Analizci', 2, 1, 30],
  ['KaleciBaba', 'Bayrak Taşıyıcı', 1, 0, 25],
  ['AnaliZeka', 'Sessiz Analizci', 1, 2, 12],
  ['CaylakCihan', 'Çaylak Taraftar', 1, 0, 1]
];
const userIds = {};
for (const [nick, title, streak, lastAgo, createdAgo] of users) {
  const last = new Date(); last.setDate(last.getDate() - lastAgo);
  const created = new Date(); created.setDate(created.getDate() - createdAgo);
  const fmt = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const info = insertUser.run(nick, hash, title, streak, fmt(last), nowLocal(createdAgo) /* tam zaman */);
  userIds[nick] = Number(info.lastInsertRowid);
}

// ---- Skorlar ------------------------------------------------------------
const insertScore = db.prepare(
  'INSERT INTO scores (user_id, game, points, meta, created_at) VALUES (?, ?, ?, ?, ?)'
);
const scores = [
  ['TribunKurdu', 'penalty', 25, { goal: true, shots: 5, series: 4 }, 0],
  ['TribunKurdu', 'penalty', 15, { goal: false, shots: 5, series: 3 }, 1],
  ['TribunKurdu', 'oracle', 10, { home: 'Kırmızılar', away: 'Sarılar' }, 1],
  ['TribunKurdu', 'quiz', 30, { type: 'Tribün Şairi' }, 3],
  ['DerbiKahini', 'quiz', 30, { type: 'Sessiz Analizci' }, 2],
  ['DerbiKahini', 'bingo', 40, { code: 'ORNEK1' }, 3],
  ['DerbiKahini', 'oracle', 10, { home: 'Maviler', away: 'Yeşiller' }, 4],
  ['KaleciBaba', 'transfer', 35, { budget_used: 97 }, 1],
  ['KaleciBaba', 'penalty', 20, { goal: true, shots: 5, series: 3 }, 4],
  ['AnaliZeka', 'oracle', 5, { home: 'Beyazlar', away: 'Siyahlar' }, 2],
  ['AnaliZeka', 'quiz', 15, { type: 'Sessiz Analizci' }, 5],
  ['TribunKurdu', 'transfer', 25, { formation: '4-3-3', squad_score: 803 }, 1],
  ['DerbiKahini', 'transfer', 25, { formation: '4-4-2', squad_score: 805 }, 1],
  ['KaleciBaba', 'transfer', 25, { formation: '3-5-2', squad_score: 803 }, 1],
  ['DerbiKahini', 'bingo', 30, { code: 'FINSH1', win: true }, 2],
  ['TribunKurdu', 'bingo', 5, { code: 'FINSH1', participation: true }, 2],
  ['AnaliZeka', 'bingo', 5, { code: 'FINSH1', participation: true }, 2]
];
for (const [nick, game, points, meta, ago] of scores) {
  insertScore.run(userIds[nick], game, points, JSON.stringify(meta), nowLocal(ago));
}
// total_points'i skorlarla eşitle
db.prepare(
  'UPDATE users SET total_points = (SELECT COALESCE(SUM(points), 0) FROM scores WHERE user_id = users.id)'
).run();

// ---- Sözlük terimleri ---------------------------------------------------
const insertTerm = db.prepare(
  'INSERT INTO dictionary_terms (user_id, term, definition, created_at, hidden) VALUES (?, ?, ?, ?, 0)'
);
const terms = [
  ['Panenka', 'Kalenin tam ortasına yavaşça bırakılan penaltı. Ya tribünün kahramanı olursun ya da ertesi hafta kamera karşısına çıkmaya yüzün olmaz.'],
  ['Kontra atak', 'Rakip bütün ordusuyla gelirken topu kapıp üç pasla kaleye koşmak. Tribünün “şimdiii!” diye koptuğu an.'],
  ['Ara topu', 'Savunma arasına bırakılan, kilidi tek pasla açan top. İyi atılırsa stat ayakta, kötü atılırsa top auta.'],
  ['Park etmiş savunma', 'Kale önüne otobüs durdurup rakibe “buyur, gir bakalım” deme cesareti. Sinir bozucu ama itiraf edelim, işe yarıyor.'],
  ['Duran top', 'Herkesin bir şey olacağını hissettiği, kalecinin duvara adam dizdiği, tribunun nefesini tuttuğu an.'],
  ['Deplasman golü kuralı', 'Eski usul hesap: beraberlikte deplasmanda atılan gol bir tık daha değerli sayılır. Kafalar karışır, hesap makineleri çıkar.'],
  ['Uzatma dakikaları', 'Maçın 90+4’te hâlâ oynandığı, kalecinin bile forvete çıktığı kaos bölgesi.'],
  ['Taç kaosu', 'Taç atışında herkesin birbirine “sen at” dediği, sonunda topun yine taça gittiği komik an.'],
  ['Kaleci konseri', 'Kalecinin üst üste üç müthiş kurtarış yapıp tribüne “bende yeminli var” dedirttiği performans.'],
  ['Devre arası çayı', 'Maçın en kritik taktik molası: 15 dakikada hem çay içilir hem “ikinci yarı şunu yapalım” nutku çekilir.']
];
const termIds = [];
terms.forEach(([t, def], i) => {
  const nick = users[i % users.length][0];
  const info = insertTerm.run(userIds[nick], t, def, nowLocal(6 - (i % 6)));
  termIds.push(Number(info.lastInsertRowid));
});

// ---- Oylar --------------------------------------------------------------
const insertVote = db.prepare(
  'INSERT OR IGNORE INTO dictionary_votes (term_id, user_id, value) VALUES (?, ?, ?)'
);
const votes = [
  [0, 'DerbiKahini', 1], [0, 'KaleciBaba', 1], [0, 'AnaliZeka', 1], [0, 'CaylakCihan', 1],
  [1, 'TribunKurdu', 1], [1, 'KaleciBaba', 1],
  [2, 'DerbiKahini', 1], [2, 'TribunKurdu', -1],
  [3, 'AnaliZeka', 1], [4, 'TribunKurdu', 1],
  [5, 'CaylakCihan', 1], [6, 'KaleciBaba', 1],
  [7, 'DerbiKahini', 1], [8, 'TribunKurdu', 1], [9, 'AnaliZeka', 1]
];
for (const [ti, nick, v] of votes) insertVote.run(termIds[ti], userIds[nick], v);

// ---- Anılar -------------------------------------------------------------
const insertMemory = db.prepare(
  'INSERT INTO memories (user_id, title, body, year, created_at, hidden) VALUES (?, ?, ?, ?, ?, 0)'
);
const memories = [
  ['Yağmurlu derbi gecesi', 'Kırmızılar ile Maviler 90+3’te bulduğu golle maçı çevirdi. Islak formayla eve dönerken “buna değdi” diye bağırdık, komşular ışığı açtı.', 2019],
  ['Efsane kurtarış', 'Babamla ilk maça gittiğimde kaleci iki penaltı kurtardı. O gün yemin ettik: “Bir daha asla maçın bitimine 5 dk kala çıkmayız.”', 2008],
  ['Tribün korosu', 'Karşı tribün hep bir ağızdan marş söylerken bizimkiler tezahürat yarışına girdi; o kadar coştu ki golü kaçırdık ama komşu bloklar alkışladı.', 2015],
  ['Son dakika frikiği', 'Okul dönüşü koşa koşa maça yetiştik; tam kapıdan girer girmez golü gördük. Bilet bize yıllarca pahalıya geldi ama değdi.', 2021],
  ['Radyo devri', 'Televizyon bozulmuştu, maçı radyodan dinledik. Anlatıcı sesi kesilince komşunun balkonundan tepki seslerini dinleyerek maçı “izledik”.', 1998]
];
const memoryIds = [];
memories.forEach(([t, b, y], i) => {
  const info = insertMemory.run(userIds[users[i % users.length][0]], t, b, y, nowLocal(4 - (i % 4)));
  memoryIds.push(Number(info.lastInsertRowid));
});

// ---- Bingo odaları (biri açık, biri bitmiş kazananlı) --------------------
const { BINGO_EVENTS } = require('./data/bingo-events');
const shuffleArr = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function makeRoomCells() {
  const ev = shuffleArr(BINGO_EVENTS).slice(0, 24);
  const cells = ev.slice(0, 12).map((t) => ({ free: false, text: t }));
  cells.push({ free: true, text: 'BEDAVA ⚽' });
  ev.slice(12).forEach((t) => cells.push({ free: false, text: t }));
  return cells;
}
function makeCard(cells) {
  const ev = cells.filter((c) => !c.free).map((c) => c.text);
  const m = shuffleArr(ev);
  const card = m.slice(0, 12).map((t) => ({ free: false, text: t }));
  card.push({ free: true, text: 'BEDAVA ⚽' });
  m.slice(12).forEach((t) => card.push({ free: false, text: t }));
  return card;
}
const insertRoom = db.prepare(
  'INSERT INTO bingo_rooms (code, owner_id, status, cells, created_at) VALUES (?, ?, ?, ?, ?)'
);
const insertBPlayer = db.prepare(
  'INSERT INTO bingo_players (room_id, user_id, marked, card, bingo_at) VALUES (?, ?, ?, ?, ?)'
);

// Oda 1: açık, 3 oyuncu
const cells1 = makeRoomCells();
const r1 = Number(insertRoom.run('ORNEK1', userIds['TribunKurdu'], 'open', JSON.stringify(cells1), nowLocal(0)).lastInsertRowid);
insertBPlayer.run(r1, userIds['TribunKurdu'], JSON.stringify([12, 0, 5]), JSON.stringify(makeCard(cells1)), null);
insertBPlayer.run(r1, userIds['DerbiKahini'], JSON.stringify([12, 2]), JSON.stringify(makeCard(cells1)), null);
insertBPlayer.run(r1, userIds['KaleciBaba'], JSON.stringify([12]), JSON.stringify(makeCard(cells1)), null);

// Oda 2: bitmiş, kazanan DerbiKahini
const cells2 = makeRoomCells();
const r2 = Number(insertRoom.run('FINSH1', userIds['DerbiKahini'], 'finished', JSON.stringify(cells2), nowLocal(3)).lastInsertRowid);
insertBPlayer.run(r2, userIds['DerbiKahini'], JSON.stringify([12, 1, 2, 3, 4, 5, 6, 10, 11, 15, 16]), JSON.stringify(makeCard(cells2)), nowLocal(2)); // kazanan
insertBPlayer.run(r2, userIds['TribunKurdu'], JSON.stringify([12, 0, 6, 7]), JSON.stringify(makeCard(cells2)), null);
insertBPlayer.run(r2, userIds['AnaliZeka'], JSON.stringify([12, 8, 9]), JSON.stringify(makeCard(cells2)), null);

// ---- Transfer kadroları --------------------------------------------------
const BUDGET = 100;
const tpRows = db.prepare('SELECT id, pos, power, price_m FROM transfer_players').all();
const byId = Object.fromEntries(tpRows.map((p) => [p.id, p]));
const FORM_POS = { '4-3-3': ['KL', 'DF', 'DF', 'DF', 'DF', 'OS', 'OS', 'OS', 'FV', 'FV', 'FV'], '4-4-2': ['KL', 'DF', 'DF', 'DF', 'DF', 'OS', 'OS', 'OS', 'OS', 'FV', 'FV'], '3-5-2': ['KL', 'DF', 'DF', 'DF', 'OS', 'OS', 'OS', 'OS', 'OS', 'FV', 'FV'] };
const SQUADS = [
  ['TribunKurdu', '4-3-3', [5, 10, 11, 12, 19, 27, 28, 34, 40, 48, 49]],
  ['DerbiKahini', '4-4-2', [5, 8, 10, 12, 18, 25, 28, 30, 35, 47, 48]],
  ['KaleciBaba', '3-5-2', [4, 11, 15, 20, 24, 27, 28, 32, 34, 45, 47]]
];
const insertSquad = db.prepare(
  `INSERT INTO transfer_squads (user_id, formation, player_ids, total_power, total_cost, squad_score, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
for (const [nick, formation, ids] of SQUADS) {
  const players = ids.map((id) => byId[id]).filter(Boolean);
  if (players.length !== 11) throw new Error('Seed kadrosunda eksik oyuncu: ' + nick);
  // mevki sırası formasyonla uyumlu mu?
  const posOk = players.every((p, i) => p.pos === FORM_POS[formation][i]);
  if (!posOk) throw new Error('Seed kadrosu formasyona uymuyor: ' + nick);
  const power = players.reduce((s, p) => s + p.power, 0);
  const cost = Number(players.reduce((s, p) => s + p.price_m, 0).toFixed(1));
  if (cost > BUDGET) throw new Error('Seed kadrosu bütçeyi aşıyor: ' + nick);
  const score = power + Math.floor((BUDGET - cost) / 2);
  insertSquad.run(userIds[nick], formation, JSON.stringify(ids), power, cost, score, nowLocal(2), nowLocal(1));
}

// ---- Raporlar (biri gizleme eşiğine yakın: 2 farklı kullanıcı) ----------
const insertReport = db.prepare(
  'INSERT INTO reports (content_type, content_id, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?)'
);
insertReport.run('term', termIds[0], userIds['DerbiKahini'], 'Spam', nowLocal(2));
insertReport.run('term', termIds[0], userIds['KaleciBaba'], 'Spam', nowLocal(1));
insertReport.run('memory', memoryIds[2], userIds['CaylakCihan'], 'Diğer', nowLocal(1));

// ---- Rozetleri kontrol et ----------------------------------------------
let badgeCount = 0;
for (const id of Object.values(userIds)) badgeCount += checkBadges(id).length;

console.log('🌱 Seed tamam!');
console.log(`   Kullanıcı: ${users.length}, Skor: ${scores.length}, Terim: ${terms.length}, Anı: ${memories.length}, Rapor: 3`);
console.log('   Bingo: ORNEK1 (açık, 3 oyuncu) + FINSH1 (bitmiş, kazanan: DerbiKahini)');
console.log(`   Transfer: ${tpRows.length} oyuncu havuzu, ${SQUADS.length} örnek kadro`);
console.log(`   Yeni rozet: ${badgeCount}`);
console.log(`   Örnek giriş → takma ad: TribunKurdu, şifre: ${PASS} (tüm örnek kullanıcılar aynı şifre)`);
