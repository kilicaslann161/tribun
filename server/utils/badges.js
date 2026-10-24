/**
 * Tribün — rozet sistemi
 * Koşullar sağlandığında checkBadges(userId) çağrılır, yeni kazanılan rozetler döner.
 */
const db = require('../db');
const { nowLocal } = require('./helpers');

/**
 * check(user) → true dönerse rozet kazanılır.
 * NOT: Buradaki sorgular hep parametreli; tablo adları kod içinden sabittir.
 */
const BADGES = {
  ilk_gol: {
    name: 'İlk Gol',
    emoji: '⚽',
    desc: 'Penaltı atışlarında ilk golünü attın.',
    check: (u) => db.prepare(
      `SELECT 1 FROM scores WHERE user_id = ? AND game = 'penalty' AND meta LIKE '%"goal":true%' LIMIT 1`
    ).get(u.id)
  },
  kahin_ciragi: {
    name: 'Kâhin Çırağı',
    emoji: '🔮',
    desc: 'Kâhin ile ilk maç tahminini yaptın.',
    check: (u) => db.prepare(
      `SELECT 1 FROM scores WHERE user_id = ? AND game = 'oracle' LIMIT 1`
    ).get(u.id)
  },
  seri_basladi: {
    name: 'Seri Başladı',
    emoji: '🔥',
    desc: '3 gün üst üste giriş yaptın.',
    check: (u) => u.streak >= 3
  },
  sozluk_yazari: {
    name: 'Sözlük Yazarı',
    emoji: '✍️',
    desc: 'Taraftar Sözlüğü’ne ilk terimini ekledin.',
    check: (u) => db.prepare(
      `SELECT 1 FROM dictionary_terms WHERE user_id = ? LIMIT 1`
    ).get(u.id)
  },
  ani_dostu: {
    name: 'Anı Bekçisi',
    emoji: '📖',
    desc: 'Anı Defteri’ne ilk anını yazdın; bekçisi sensin.',
    check: (u) => db.prepare(
      `SELECT 1 FROM memories WHERE user_id = ? LIMIT 1`
    ).get(u.id)
  },
  popul_yazar: {
    name: 'Popüler Yazar',
    emoji: '🌟',
    desc: 'Bir terimin 10 net oy aldı. Sözlüğün yıldızı oldun!',
    check: (u) => db.prepare(
      `SELECT 1
         FROM dictionary_terms t
         LEFT JOIN dictionary_votes v ON v.term_id = t.id
        WHERE t.user_id = ?
        GROUP BY t.id
        HAVING COALESCE(SUM(v.value), 0) >= 10
        LIMIT 1`
    ).get(u.id)
  },
  tribun_beyni: {
    name: 'Tribün Beyni',
    emoji: '🧠',
    desc: 'Taraftar Testi’ni çözerek unvanını aldın.',
    check: (u) => db.prepare(
      `SELECT 1 FROM scores WHERE user_id = ? AND game = 'quiz' LIMIT 1`
    ).get(u.id)
  },
  bingo_bombasi: {
    name: 'Bingo!',
    emoji: '🎯',
    desc: 'Bir bingo kartında ilk bingonu yaptın!',
    check: (u) => db.prepare(
      `SELECT 1 FROM bingo_players WHERE user_id = ? AND bingo_at IS NOT NULL LIMIT 1`
    ).get(u.id)
  },
  oda_kurucusu: {
    name: 'Oda Kurucusu',
    emoji: '🏗️',
    desc: 'İlk bingo odanı kurdun, ev sahibi sensin.',
    check: (u) => db.prepare(
      `SELECT 1 FROM bingo_rooms WHERE owner_id = ? LIMIT 1`
    ).get(u.id)
  },
  salon_sampiyonu: {
    name: 'Salon Şampiyonu',
    emoji: '🎖️',
    desc: '5 kez bingo yaptın. Salon senin adını fısıldıyor.',
    check: (u) => db.prepare(
      `SELECT 1 FROM bingo_players WHERE user_id = ? AND bingo_at IS NOT NULL GROUP BY user_id HAVING COUNT(*) >= 5 LIMIT 1`
    ).get(u.id)
  },
  transfer_direktoru: {
    name: 'Teknik Direktör',
    emoji: '💼',
    desc: 'Hayali Transfer’de ilk kadronu kaydettin.',
    check: (u) => db.prepare(
      `SELECT 1 FROM transfer_squads WHERE user_id = ? LIMIT 1`
    ).get(u.id)
  },
  butce_ustasi: {
    name: 'Bütçe Ustası',
    emoji: '💰',
    desc: 'Bütçenin %95’ini kullanıp 850+ kadro puanına ulaştın.',
    check: (u) => db.prepare(
      `SELECT 1 FROM transfer_squads WHERE user_id = ? AND total_cost >= 95 AND squad_score >= 850 LIMIT 1`
    ).get(u.id)
  },
  gol_krali: {
    name: 'Gol Kralı',
    emoji: '👑',
    desc: 'Toplam 250 puana ulaştın.',
    check: (u) => u.total_points >= 250
  },
  tribun_efsesi: {
    name: 'Tribün Efsanesi',
    emoji: '🏆',
    desc: 'Toplam 1000 puana ulaştın. Tribün seni konuşuyor!',
    check: (u) => u.total_points >= 1000
  }
};

/**
 * Kullanıcı için kazanılmamış rozetleri kontrol et, kazanılanları veritabanına yaz.
 * @returns {Array<{key:string,name:string,emoji:string,desc:string}>} yeni kazanılan rozetler
 */
function checkBadges(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return [];

  const owned = new Set(
    db.prepare('SELECT badge_key FROM badges WHERE user_id = ?').all(userId).map((r) => r.badge_key)
  );

  const fresh = [];
  const insert = db.prepare('INSERT OR IGNORE INTO badges (user_id, badge_key, earned_at) VALUES (?, ?, ?)');

  for (const [key, def] of Object.entries(BADGES)) {
    if (owned.has(key)) continue;
    let ok = false;
    try { ok = !!def.check(user); } catch { ok = false; }
    if (ok) {
      insert.run(userId, key, nowLocal());
      fresh.push({ key, name: def.name, emoji: def.emoji, desc: def.desc });
    }
  }
  return fresh;
}

module.exports = { BADGES, checkBadges };
