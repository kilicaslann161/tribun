/**
 * Tribün — Maç Günü Bingo uç noktaları (router /api/bingo altına mount edilir)
 *
 * POST /api/bingo/rooms             → oda kur (6 haneli kod, 24 olay + BEDAVA), kurucu oyuncu olur
 * POST /api/bingo/rooms/:code/join  → katıl (her oyuncuya ÖZEL karıştırılmış kart)
 * GET  /api/bingo/rooms/:code       → oda durumu + oyuncular (sadece sayılar) + kendi kartın
 * POST /api/bingo/rooms/:code/mark  → hücre işaretle/kaldır; BİNGO kararı SUNUCUDA, atomik
 * POST /api/bingo/rooms/:code/finish→ kurucu odayı kapatır
 * GET  /api/bingo/my-rooms          → kullanıcının açık odaları
 *
 * 24 saatten eski açık odalar sorgu sırasında otomatik "finished" yapılır.
 * İstemci yalnızca hücre indeksi gönderir; bingo/skor kararı hep sunucudadır.
 */
const express = require('express');

const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { addPoints } = require('../utils/points');
const { checkBadges } = require('../utils/badges');
const { nowLocal } = require('../utils/helpers');
const { BINGO_EVENTS } = require('../data/bingo-events');

const router = express.Router();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışabilen O/0, I/1 yok
const MAX_PLAYERS = 10;
const MAX_OPEN_ROOMS_PER_USER = 3;

const WIN_POINTS = 30;   // bingo yapan
const JOIN_POINTS = 5;   // o bittiğinde diğer katılanlar

/* ---------------- yardımcılar ---------------- */

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function genCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

function uniqueCode() {
  for (let i = 0; i < 30; i++) {
    const c = genCode();
    if (!db.prepare('SELECT 1 FROM bingo_rooms WHERE code = ?').get(c)) return c;
  }
  throw new Error('kod-uretilemedi');
}

/** 24 saatten eski açık odaları kapat (ayrı zamanlayıcı yok) */
function closeStaleRooms() {
  db.prepare(
    `UPDATE bingo_rooms SET status = 'finished'
      WHERE status = 'open' AND created_at < datetime('now', 'localtime', '-24 hours')`
  ).run();
}

/** Oda için 25 hücrelik olay seçimi: 24 rastgele olay + ortada (12. indeks) BEDAVA */
function pickRoomCells() {
  const events = shuffle(BINGO_EVENTS).slice(0, 24);
  const cells = events.slice(0, 12).map((text) => ({ free: false, text }));
  cells.push({ free: true, text: 'BEDAVA ⚽' });
  events.slice(12).forEach((text) => cells.push({ free: false, text }));
  return cells;
}

/** Oyuncuya özgü kart: aynı 24 olay, farklı dizilim (bedava hep ortada) */
function makePlayerCard(roomCells) {
  const events = roomCells.filter((c) => !c.free).map((c) => c.text);
  const mixed = shuffle(events);
  const card = mixed.slice(0, 12).map((text) => ({ free: false, text }));
  card.push({ free: true, text: 'BEDAVA ⚽' });
  mixed.slice(12).forEach((text) => card.push({ free: false, text }));
  return card;
}

const parseJson = (s, fallback) => {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

const LINES = (() => {
  const lines = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
})();

/** Bingo koşulu: 5 satır, 5 sütun, 2 çapraz (bedava hücre herkesin) */
function hasBingo(marks) {
  const s = new Set(marks);
  s.add(12);
  return LINES.some((line) => line.every((i) => s.has(i)));
}

function getRoomByCode(code) {
  return db.prepare('SELECT * FROM bingo_rooms WHERE code = ?').get(String(code).toUpperCase());
}

/** GET yanıtı: başkalarının kartı/hücreleri dönmez, yalnızca işaret SAYISI */
function roomState(room, user) {
  const players = db.prepare(
    `SELECT bp.*, u.nickname FROM bingo_players bp
      JOIN users u ON u.id = bp.user_id
     WHERE bp.room_id = ? ORDER BY bp.id`
  ).all(room.id);

  const me = user ? players.find((p) => p.user_id === user.id) : null;
  const winner = players.find((p) => p.bingo_at);

  return {
    code: room.code,
    status: room.status,
    created_at: room.created_at,
    isOwner: !!(user && room.owner_id === user.id),
    member: !!me,
    canJoin: !me && room.status === 'open' && players.length < MAX_PLAYERS,
    playerCount: players.length,
    maxPlayers: MAX_PLAYERS,
    winner: winner ? winner.nickname : null,
    players: players.map((p) => ({
      nickname: p.nickname,
      markedCount: parseJson(p.marked, []).length,
      bingo: !!p.bingo_at
    })),
    myCard: me
      ? {
          cells: me.card ? parseJson(me.card, null) : parseJson(room.cells, []),
          marked: parseJson(me.marked, [])
        }
      : null
  };
}

/* ---------------- odalar ---------------- */

router.post('/rooms', requireAuth, (req, res) => {
  closeStaleRooms();

  const openCount = db.prepare(
    "SELECT COUNT(*) AS c FROM bingo_rooms WHERE owner_id = ? AND status = 'open'"
  ).get(req.user.id).c;
  if (openCount >= MAX_OPEN_ROOMS_PER_USER) {
    return res.status(400).json({ error: `Aynı anda en fazla ${MAX_OPEN_ROOMS_PER_USER} açık odan olabilir. Birini kapat, yenisini kur!` });
  }

  const cells = pickRoomCells();
  const code = uniqueCode();
  const info = db.prepare(
    "INSERT INTO bingo_rooms (code, owner_id, status, cells, created_at) VALUES (?, ?, 'open', ?, ?)"
  ).run(code, req.user.id, JSON.stringify(cells), nowLocal());

  // Kurucu da oyuncu: kendi karışık kartı
  db.prepare('INSERT INTO bingo_players (room_id, user_id, marked, card) VALUES (?, ?, ?, ?)')
    .run(Number(info.lastInsertRowid), req.user.id, JSON.stringify([12]), JSON.stringify(makePlayerCard(cells)));

  const newBadges = checkBadges(req.user.id); // Oda Kurucusu
  res.status(201).json({ code, newBadges, room: roomState(getRoomByCode(code), req.user) });
});

router.post('/rooms/:code/join', requireAuth, (req, res) => {
  closeStaleRooms();
  const room = getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: 'Oda bulunamadı. Kodu kontrol et!' });

  const existing = db.prepare(
    'SELECT * FROM bingo_players WHERE room_id = ? AND user_id = ?'
  ).get(room.id, req.user.id);
  if (existing) return res.json({ alreadyMember: true, room: roomState(room, req.user) });

  if (room.status !== 'open') {
    return res.status(400).json({ error: 'Bu oda çoktan bitti. Yeni bir oda kur!' });
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM bingo_players WHERE room_id = ?').get(room.id).c;
  if (count >= MAX_PLAYERS) {
    return res.status(400).json({ error: `Oda doldu (en fazla ${MAX_PLAYERS} oyuncu).` });
  }

  const roomCells = parseJson(room.cells, []);
  try {
    db.prepare('INSERT INTO bingo_players (room_id, user_id, marked, card) VALUES (?, ?, ?, ?)')
      .run(room.id, req.user.id, JSON.stringify([12]), JSON.stringify(makePlayerCard(roomCells)));
  } catch (e) {
    // Çift tık / yarış: UNIQUE(room_id, user_id) ihlali → zaten üye
    if (String(e.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.json({ alreadyMember: true, room: roomState(room, req.user) });
    }
    throw e;
  }

  res.json({ alreadyMember: false, room: roomState(room, req.user) });
});

router.get('/rooms/:code', optionalAuth, (req, res) => {
  closeStaleRooms();
  const room = getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: 'Oda bulunamadı. Kodu kontrol et!' });
  res.json(roomState(room, req.user || null));
});

/* ---------------- işaretleme + bingo (atomik) ---------------- */

const claimFinish = db.transaction((roomId, userId) => {
  const r = db.prepare("UPDATE bingo_rooms SET status = 'finished' WHERE id = ? AND status = 'open'").run(roomId);
  if (r.changes !== 1) return false; // biri önce davrandı
  db.prepare('UPDATE bingo_players SET bingo_at = ? WHERE room_id = ? AND user_id = ?')
    .run(nowLocal(), roomId, userId);
  return true;
});

router.post('/rooms/:code/mark', requireAuth, (req, res) => {
  closeStaleRooms();
  const idx = Number((req.body || {}).idx);
  if (!Number.isInteger(idx) || idx < 0 || idx > 24) {
    return res.status(400).json({ error: 'Hücre indeksi 0-24 arasında olmalı.' });
  }
  if (idx === 12) return res.status(400).json({ error: 'Bedava hücre zaten senin, dokunma! 😄' });

  const room = getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: 'Oda bulunamadı.' });
  if (room.status !== 'open') {
    return res.status(400).json({ error: 'Oda bitti, kart kilitli.' });
  }

  const player = db.prepare(
    'SELECT * FROM bingo_players WHERE room_id = ? AND user_id = ?'
  ).get(room.id, req.user.id);
  if (!player) return res.status(403).json({ error: 'Önce odaya katılmalısın.' });

  const marks = parseJson(player.marked, []);
  const pos = marks.indexOf(idx);
  if (pos >= 0) marks.splice(pos, 1); else marks.push(idx);

  db.prepare('UPDATE bingo_players SET marked = ? WHERE id = ?').run(JSON.stringify(marks), player.id);

  const bingo = hasBingo(marks);
  let won = false;
  let points = 0;
  let newBadges = [];

  if (bingo) {
    won = claimFinish(room.id, req.user.id); // yalnız ilk gelen kazanır
    if (won) {
      const pi = addPoints(req.user.id, 'bingo', WIN_POINTS, { code: room.code, win: true });
      points = pi.awarded;

      // Katılan diğer herkese katılım puanı (günlük limit addPoints içinde)
      const others = db.prepare(
        'SELECT user_id FROM bingo_players WHERE room_id = ? AND user_id != ?'
      ).all(room.id, req.user.id);
      for (const o of others) {
        addPoints(o.user_id, 'bingo', JOIN_POINTS, { code: room.code, participation: true });
      }

      newBadges = checkBadges(req.user.id); // Bingo! / Salon Şampiyonu
    }
  }

  const fresh = getRoomByCode(room.code);
  res.json({
    ok: true,
    marked: marks,
    bingo,
    won,
    points: won ? points : 0,
    newBadges,
    room: roomState(fresh, req.user)
  });
});

/* ---------------- oda kapatma ---------------- */

router.post('/rooms/:code/finish', requireAuth, (req, res) => {
  closeStaleRooms();
  const room = getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: 'Oda bulunamadı.' });
  if (room.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Odayı yalnızca kurucu kapatabilir.' });
  }
  db.prepare("UPDATE bingo_rooms SET status = 'finished' WHERE id = ? AND status = 'open'").run(room.id);
  res.json({ ok: true, room: roomState(getRoomByCode(room.code), req.user) });
});

/* ---------------- açık odalarım ---------------- */

router.get('/my-rooms', requireAuth, (req, res) => {
  closeStaleRooms();
  const rows = db.prepare(
    `SELECT r.code, r.created_at, r.owner_id,
            (SELECT COUNT(*) FROM bingo_players bp WHERE bp.room_id = r.id) AS player_count
       FROM bingo_rooms r
       JOIN bingo_players bp2 ON bp2.room_id = r.id AND bp2.user_id = ?
      WHERE r.status = 'open'
      GROUP BY r.id
      ORDER BY r.created_at DESC`
  ).all(req.user.id);
  res.json({
    rooms: rows.map((r) => ({
      code: r.code,
      created_at: r.created_at,
      player_count: r.player_count,
      isOwner: r.owner_id === req.user.id
    }))
  });
});

module.exports = router;
