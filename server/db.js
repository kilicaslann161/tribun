/**
 * Tribün — SQLite bağlantısı ve tablo oluşturma
 * İlk çalıştırmada tüm tablolar otomatik oluşturulur.
 * "node server/db.js --reset" komutu veritabanını siler (db:reset scripti).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
// AŞAMA 10: TRIBUN_DB_PATH ile DB konumu geçersiz kılınabilir (bellek-içi testler
// için ':memory:'). Üretimde verilmez → her zaman data/tribun.db.
const DB_PATH = process.env.TRIBUN_DB_PATH || path.join(DATA_DIR, 'tribun.db');

// Sıfırlama modu: db:reset scripti ile çağrılır
if (process.argv.includes('--reset')) {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    fs.rmSync(f, { force: true });
  }
  console.log('🗑️  Veritabanı silindi (' + DB_PATH + ')');
  console.log('   Yeni tablolar sunucu/seed bir sonraki çalıştığında oluşturulur.');
  process.exit(0);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000'); // kilit bekleme toleransı (migration/senkron işler için)

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  fan_title       TEXT NOT NULL DEFAULT 'Çaylak Taraftar',
  total_points    INTEGER NOT NULL DEFAULT 0,
  streak          INTEGER NOT NULL DEFAULT 0,
  last_login_date TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_points ON users(total_points DESC);

CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game       TEXT NOT NULL,
  points     INTEGER NOT NULL,
  meta       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_user_game ON scores(user_id, game);
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game);

CREATE TABLE IF NOT EXISTS badges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  UNIQUE(user_id, badge_key)
);

CREATE TABLE IF NOT EXISTS dictionary_terms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term       TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_terms_hidden ON dictionary_terms(hidden, id);

CREATE TABLE IF NOT EXISTS dictionary_votes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id INTEGER NOT NULL REFERENCES dictionary_terms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value   INTEGER NOT NULL CHECK(value IN (-1, 1)),
  UNIQUE(term_id, user_id)
);

CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  year       INTEGER,
  created_at TEXT NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_hidden ON memories(hidden, id);

CREATE TABLE IF NOT EXISTS bingo_rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'finished')),
  cells      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bingo_players (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id  INTEGER NOT NULL REFERENCES bingo_rooms(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marked   TEXT NOT NULL DEFAULT '[]',
  card     TEXT,
  bingo_at TEXT,
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS transfer_players (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  pos     TEXT NOT NULL CHECK(pos IN ('KL', 'DF', 'OS', 'FV')),
  power   INTEGER NOT NULL CHECK(power BETWEEN 60 AND 95),
  price_m REAL NOT NULL CHECK(price_m > 0),
  trait   TEXT
);
CREATE INDEX IF NOT EXISTS idx_transfer_pos ON transfer_players(pos, power DESC);

CREATE TABLE IF NOT EXISTS transfer_squads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  formation    TEXT NOT NULL,
  player_ids   TEXT NOT NULL,
  total_power  INTEGER NOT NULL,
  total_cost   REAL NOT NULL,
  squad_score  INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL CHECK(content_type IN ('term', 'memory')),
  content_id   INTEGER NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_content ON reports(content_type, content_id);
`);

// ---- Geçiş (migration): eski DB'lerde bingo_players.card sütunu ----
const bpCols = db.prepare('PRAGMA table_info(bingo_players)').all().map((c) => c.name);
if (!bpCols.includes('card')) {
  db.exec('ALTER TABLE bingo_players ADD COLUMN card TEXT');
  console.log('📦 Geçiş uygulandı: bingo_players.card sütunu eklendi');
}

// ---- Transfer oyuncu havuzu boşsa otomatik doldur (ilk çalıştırmada/boş DB'de) ----
const { TRANSFER_PLAYERS } = require('./data/transfer-players');
if (db.prepare('SELECT COUNT(*) AS c FROM transfer_players').get().c === 0) {
  const ins = db.prepare('INSERT INTO transfer_players (name, pos, power, price_m, trait) VALUES (?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const p of TRANSFER_PLAYERS) ins.run(p.name, p.pos, p.power, p.price, p.trait);
  });
  tx();
  console.log(`⚽ Transfer havuzu dolduruldu: ${TRANSFER_PLAYERS.length} uydurma oyuncu`);
}

module.exports = db;
