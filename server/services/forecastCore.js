/**
 * Tribün — Kâhin Sensin çekirdek mantığı (AŞAMA 9)
 *
 * Bu modül db singleton'unu require ETMEZ (sportsRead/liveWindow/standingsCore
 * deseni): tüm fonksiyonlar db parametresi alır → bellek-içi SQLite ile
 * test edilir. Puan dağıtımı enjekte edilir (opts.award); üretimde varsayılan
 * uygulama utils/points.js addPointsIn'i TEMBEL yükler (test sürecinde db
 * dosya singleton'unun yüklenmesi node:test + better-sqlite3 native çökmesi
 * tetiklediğinden).
 *
 * AKIŞLAR
 *  Elle giriş  : createManualFixture → (maç bitince admin) settleFixture(by='admin')
 *  Senkron     : importForecastMatches → matches senkronu → processForecastSettlements
 *                → settleFixture(by='auto') → (sağlayıcı düzeltirse) yeniden
 *                settleFixture(by='correction')
 *
 * PUANLAMA (sonuç kesinleşince; tahmin anında puan YOK):
 *   1/X/2 doğru  +15 · Karşılıklı Gol doğru +10 · ikisi birden +5 bonus (top 30)
 *   Puanlar 'oracle' oyunu üzerinden dağıtılır → Kâhin günlük limiti (30) ve
 *   mevcut puan sistemi AYNEN geçerli (addPointsIn).
 *
 * OTOMATİK SONUÇLANDIRMA (talimat 4): bağlı maç finished + iki skor dolu +
 * finished_at'tan (ilk görülen bitiş) 30 dk geçmiş + son İKİ senkronda skor
 * aynı → settleFixture. "Son iki senkron" dürüstçe sayılır: yeni gözlem yalnız
 * matches.fetched_at ilerlediyse yapılır (aynı DB durumu iki kez sayılamaz).
 *
 * BAYRAKLAR (talimat 5): bağlı maç postponed/cancelled/feed_missing olursa ya
 * da kickoff'u değişirse fixture'a "İnceleme gerekli" işareti; otomatik iptal
 * YOK, kickoff otomatik uygulanmaz — admin karar verir.
 */
const nowIso = () => new Date().toISOString();

/* Bitişten sonra sonuç kesinleştirme bekleme süresi (Aşama 5 düzeltme penceresiyle aynı) */
const SETTLE_DELAY_MS = 30 * 60 * 1000;

/* Puan tablosu (talimat 6: kullanıcıya dönük kurallar) */
const FORECAST_POINTS = { pick1x2: 15, pickBtts: 10, bothBonus: 5 };

/* Aday listesi penceresi: bugünden itibaren 7 gün (talimat 3) */
const CANDIDATE_WINDOW_DAYS = 7;

/* ---------------- saf yardımcılar ---------------- */

/** Skordan 1/X/2 ve karşılıklı gol sonuçları */
function computeResults(homeScore, awayScore) {
  return {
    r1x2: homeScore > awayScore ? '1' : (homeScore === awayScore ? 'X' : '2'),
    rBtts: homeScore > 0 && awayScore > 0 ? 'yes' : 'no'
  };
}

/**
 * Admin girişi için başlama saati ayrıştırıcı.
 * Kabul: 'YYYY-MM-DDTHH:MM' | 'YYYY-MM-DD HH:MM' (Türkiye saati, kalıcı UTC+03)
 * ya da ofsetli/Z'li tam ISO. Geçersiz → null. Gerçek takvim günü gidiş-dönüşle doğrulanır.
 */
function parseKickoffInput(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  // Türkiye 2016'dan beri yaz saati uygulamıyor: kalıcı +03:00
  const d = new Date(`${t.replace(' ', 'T')}:00+03:00`);
  if (isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return iso.slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? iso : null;
}

/* ---------------- varsayılan puan/rozet enjeksiyonları (tembel require) ---------------- */

function defaultAward(db, userId, points, meta) {
  // Test sürecinde çağrılmaz (enjekte edilen stub kullanılır); üretimde yüklenir.
  const { addPointsIn } = require('../utils/points');
  return addPointsIn(db, userId, 'oracle', points, meta);
}

function defaultBadges(userId) {
  const { checkBadges } = require('../utils/badges');
  return checkBadges(userId);
}

/* ---------------- sonuçlandırma (tek yol — elle de otomatik de burası) ---------------- */

/**
 * Ödülleri geri al (düzeltme senaryosu): predictions.award_detail küpüründeki
 * scores satırını siler, users.total_points'ten düşer, tahmini sıfırlar.
 * Yalnızca settleFixture içinde, aynı transaction'da çağrılır.
 */
function reverseAwards(db, fixtureId) {
  const rows = db.prepare(
    'SELECT id, user_id, points_awarded, award_detail FROM predictions WHERE fixture_id = ? AND points_awarded > 0'
  ).all(fixtureId);
  for (const p of rows) {
    let scoresRowId = null;
    try {
      const d = p.award_detail ? JSON.parse(p.award_detail) : {};
      scoresRowId = Number(d.scores_row_id) || null;
    } catch { /* bozuk küpür → satır id'si yok */ }
    if (scoresRowId) db.prepare('DELETE FROM scores WHERE id = ?').run(scoresRowId);
    db.prepare('UPDATE users SET total_points = MAX(0, total_points - ?) WHERE id = ?')
      .run(p.points_awarded, p.user_id);
  }
  db.prepare('UPDATE predictions SET points_awarded = 0, award_detail = NULL WHERE fixture_id = ?')
    .run(fixtureId);
}

/**
 * Sonucu kesinleştir: fixture'a skoru + 1/X/2 + KG sonuçlarını yazar ve tahmin
 * başına puanı dağıtır. ELLE sonuç girişi ile otomatik sonuçlandırma AYNI
 * fonksiyonu çağırır (kopya yok).
 *
 * @param {object} opts {by:'admin'|'auto'|'correction', now, award, badges}
 * @returns {{ok:boolean, status?:number, error?:string, ...özet}}
 */
function settleFixture(db, fixtureId, scores, opts = {}) {
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return { ok: false, status: 400, error: 'Geçersiz maç id.' };
  }
  const home = scores ? scores.homeScore : null;
  const away = scores ? scores.awayScore : null;
  if (!Number.isInteger(home) || home < 0 || !Number.isInteger(away) || away < 0) {
    return { ok: false, status: 400, error: 'Skorlar 0 ya da daha büyük tam sayı olmalı.' };
  }

  const f = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(fixtureId);
  if (!f) return { ok: false, status: 404, error: 'Maç bulunamadı.' };
  if (f.status === 'cancelled') {
    return { ok: false, status: 400, error: 'İptal edilmiş bir maç sonuçlanamaz.' };
  }
  if (f.status === 'finished' && f.home_score === home && f.away_score === away) {
    return { ok: true, already: true, fixture_id: fixtureId, by: opts.by || 'admin',
             results: { r1x2: f.result_1x2, rBtts: f.result_btts }, predictions: 0, awarded: 0 };
  }

  const by = opts.by || 'admin';
  const now = opts.now || nowIso();
  const isCorrection = f.status === 'finished';
  const award = opts.award || defaultAward;
  // Rozet varsayılanı yalnız ÜRETİM enjeksiyonu yoksa (award enjekte edildiyse
  // test ortamındayız; utils/badges db dosya singleton'unu yükler — node:test
  // sürecinde native çökme riski, bu yüzden kapalı kalır).
  const badges = opts.badges !== undefined
    ? opts.badges
    : (opts.award ? null : defaultBadges);
  const { r1x2, rBtts } = computeResults(home, away);

  let predictionCount = 0;
  let awardedTotal = 0;
  const touchedUsers = [];

  const tx = db.transaction(() => {
    if (isCorrection) reverseAwards(db, fixtureId);

    db.prepare(`
      UPDATE fixtures SET status = 'finished', home_score = ?, away_score = ?,
                          result_1x2 = ?, result_btts = ?,
                          review_required = 0, review_reason = NULL,
                          settled_at = ?, settled_by = ?
       WHERE id = ?
    `).run(home, away, r1x2, rBtts, now, by, fixtureId);

    const preds = db.prepare('SELECT * FROM predictions WHERE fixture_id = ?').all(fixtureId);
    for (const p of preds) {
      predictionCount++;
      const c1 = p.pick_1x2 === r1x2;
      const cB = p.pick_btts === rBtts;
      let points = 0;
      if (c1) points += FORECAST_POINTS.pick1x2;
      if (cB) points += FORECAST_POINTS.pickBtts;
      if (c1 && cB) points += FORECAST_POINTS.bothBonus;

      if (points > 0) {
        const r = award(db, p.user_id, points, { fixture_id: fixtureId, pick_1x2: c1, pick_btts: cB });
        db.prepare('UPDATE predictions SET points_awarded = ?, award_detail = ? WHERE id = ?')
          .run(r.awarded, JSON.stringify({
            scores_row_id: r.scoresRowId ?? null,
            points: r.awarded, by, at: now, correct: { pick_1x2: c1, pick_btts: cB }
          }), p.id);
        awardedTotal += r.awarded;
        touchedUsers.push(p.user_id);
      } else {
        db.prepare('UPDATE predictions SET points_awarded = 0, award_detail = ? WHERE id = ?')
          .run(JSON.stringify({ points: 0, by, at: now, correct: { pick_1x2: false, pick_btts: false } }), p.id);
      }
    }
  });
  tx();

  // Rozet koşulları puan artışıyla değişmiş olabilir (tx DIŞINDA — küçük tut)
  if (typeof badges === 'function') {
    for (const uid of new Set(touchedUsers)) {
      try { badges(uid); } catch { /* rozet hatası sonuçlandırmayı bozmaz */ }
    }
  }

  return {
    ok: true, already: false, fixture_id: fixtureId, by,
    correction: isCorrection,
    results: { r1x2, rBtts },
    predictions: predictionCount,
    awarded: awardedTotal
  };
}

/* ---------------- otomatik sonuçlandırma denetçisi (yalnız-DB) ---------------- */

/**
 * Her senkron turundan sonra ve forecastJob'ın periyodik süpürmesinde çağrılır.
 * SportScore'a istek ATMAZ; yalnızca mevcut matches/fixtures durumunu işler.
 *
 * @returns {{settled:Array, corrections:Array, flagged:Array, observed:number}}
 */
function processForecastSettlements(db, opts = {}) {
  const now = opts.now || nowIso();
  const nowMs = Date.parse(now);
  const award = opts.award;
  const badges = opts.badges; // undefined → üretim varsayılanı (award enjekte edilmişse null)
  const settleOpts = (by) => {
    const o = { by, now };
    if (award) o.award = award;
    if (badges !== undefined) o.badges = badges;
    return o;
  };
  const out = { settled: [], corrections: [], flagged: [], observed: 0 };

  const rows = db.prepare(`
    SELECT l.match_id, l.fixture_id, l.last_observed_at, l.last_home, l.last_away, l.stable_count,
           f.status AS fixture_status, f.home_score AS fx_home, f.away_score AS fx_away,
           f.kickoff_at AS fx_kickoff, f.review_required, f.review_reason,
           m.status AS match_status, m.home_score, m.away_score, m.kickoff_utc,
           m.finished_at, m.fetched_at, m.feed_missing
      FROM forecast_match_links l
      JOIN matches m ON m.id = l.match_id
      JOIN fixtures f ON f.id = l.fixture_id
     ORDER BY l.fixture_id ASC
  `).all();

  const flagStmt = db.prepare(
    'UPDATE fixtures SET review_required = 1, review_reason = ? WHERE id = ?'
  );
  const observeStmt = db.prepare(`
    UPDATE forecast_match_links
       SET last_observed_at = ?, last_home = ?, last_away = ?, stable_count = ?
     WHERE match_id = ?
  `);

  for (const r of rows) {
    /* --- 5) bağ durumu bayrakları: yalnız AÇIK maçlarda; iptal/otomatik kickoff YOK --- */
    if (r.fixture_status === 'open') {
      let reason = null;
      if (r.match_status === 'postponed') reason = 'match_postponed';
      else if (r.match_status === 'cancelled') reason = 'match_cancelled';
      else if (r.feed_missing === 1) reason = 'match_feed_missing';
      else if (r.kickoff_utc && r.fx_kickoff && r.kickoff_utc !== r.fx_kickoff) reason = 'kickoff_changed';
      if (reason && !(r.review_required === 1 && r.review_reason === reason)) {
        flagStmt.run(reason, r.fixture_id);
        out.flagged.push({ fixture_id: r.fixture_id, match_id: r.match_id, reason });
      }
    }

    /* --- yeni senkron gözlemi var mı? (fetched_at ilerlemediyse sayılamaz) --- */
    const hasNewFetch = !!r.fetched_at && (!r.last_observed_at || r.fetched_at > r.last_observed_at);
    const scoresOk = r.match_status === 'finished'
      && Number.isInteger(r.home_score) && Number.isInteger(r.away_score);
    let stableCount = r.stable_count;
    if (scoresOk && hasNewFetch) {
      if (r.last_home === r.home_score && r.last_away === r.away_score) stableCount += 1;
      else stableCount = 1;
      observeStmt.run(r.fetched_at, r.home_score, r.away_score, stableCount, r.match_id);
      out.observed++;
    }

    /* --- 4) otomatik sonuçlandırma: 30 dk + skor son iki senkronda aynı --- */
    if (r.fixture_status === 'open' && scoresOk && r.finished_at
        && nowMs - Date.parse(r.finished_at) >= SETTLE_DELAY_MS
        && stableCount >= 2) {
      const res = settleFixture(db, r.fixture_id,
        { homeScore: r.home_score, awayScore: r.away_score }, settleOpts('auto'));
      if (res.ok && !res.already) {
        out.settled.push({
          fixture_id: r.fixture_id, match_id: r.match_id,
          score: { home: r.home_score, away: r.away_score },
          predictions: res.predictions, awarded: res.awarded
        });
      }
    }

    /* --- düzeltme: sonuçlanmış maçın skoru sağlayıcıca düzeltildiyse ---
     * (maç satırı zaten Aşama 5 korumalarından — skor düşüşünde ardışık İKİ
     *  onay — geçerek güncellendi; burada yeni skorun da İKİ senkronda kararlı
     *  olması beklenir, sonra AYNI settleFixture yeniden çağrılır) */
    else if (r.fixture_status === 'finished' && scoresOk && hasNewFetch
        && (r.home_score !== r.fx_home || r.away_score !== r.fx_away)
        && stableCount >= 2) {
      const res = settleFixture(db, r.fixture_id,
        { homeScore: r.home_score, awayScore: r.away_score }, settleOpts('correction'));
      if (res.ok && !res.already) {
        out.corrections.push({
          fixture_id: r.fixture_id, match_id: r.match_id,
          from: { home: r.fx_home, away: r.fx_away },
          to: { home: r.home_score, away: r.away_score },
          predictions: res.predictions, awarded: res.awarded
        });
      }
    }
  }

  return out;
}

/* ---------------- senkron adayları + aktarım (talimat 2-3) ---------------- */

/** Gelecek 7 günün aktarılabilir futbol maçları (scheduled, feed_missing=0, açık lig, bağsız) */
function listForecastCandidates(db, opts = {}) {
  const now = opts.now || nowIso();
  const until = new Date(Date.parse(now) + CANDIDATE_WINDOW_DAYS * 86400000).toISOString();
  const rows = db.prepare(`
    SELECT m.id, m.kickoff_utc, th.name AS home_team, ta.name AS away_team,
           c.name AS competition, c.slug AS competition_slug
      FROM matches m
      JOIN competitions c ON c.id = m.competition_id
      LEFT JOIN teams th ON th.id = m.home_team_id
      LEFT JOIN teams ta ON ta.id = m.away_team_id
     WHERE m.sport = 'football' AND m.status = 'scheduled' AND m.feed_missing = 0
       AND m.kickoff_utc IS NOT NULL AND m.kickoff_utc > ? AND m.kickoff_utc <= ?
       AND c.is_enabled = 1
       AND NOT EXISTS (SELECT 1 FROM forecast_match_links l WHERE l.match_id = m.id)
     ORDER BY m.kickoff_utc ASC, m.id ASC
     LIMIT 200
  `).all(now, until);
  return { now, window_days: CANDIDATE_WINDOW_DAYS, count: rows.length, candidates: rows };
}

/**
 * Senkron maçları Kâhin Sensin'e aktar (talimat 3).
 * Yalnızca futbol; basketbol ve diğer branşlar mesajıyla reddedilir (talimat 2).
 * TEK transaction + idempotent: aynı maç ikinci kez aktarılamaz (önce kontrol,
 * arka kolda UNIQUE kısıtları).
 *
 * @returns {{imported:Array, already:Array, rejected:Array}}
 */
function importForecastMatches(db, matchIds, opts = {}) {
  if (!Array.isArray(matchIds) || matchIds.length === 0) {
    return { ok: false, status: 400, error: 'matchIds en az bir maç id içermeli.' };
  }
  if (matchIds.length > 100) {
    return { ok: false, status: 400, error: 'Tek seferde en fazla 100 maç aktarılabilir.' };
  }
  const ids = [];
  for (const v of matchIds) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, status: 400, error: 'matchIds yalnızca pozitif tam sayı maç id\'leri içermeli.' };
    }
    if (!ids.includes(n)) ids.push(n);
  }

  const now = opts.now || nowIso();
  const result = { imported: [], already: [], rejected: [] };

  const selMatch = db.prepare(`
    SELECT m.id, m.sport, m.status, m.kickoff_utc, m.feed_missing,
           c.name AS competition,
           th.name AS home_team, ta.name AS away_team
      FROM matches m
      LEFT JOIN competitions c ON c.id = m.competition_id
      LEFT JOIN teams th ON th.id = m.home_team_id
      LEFT JOIN teams ta ON ta.id = m.away_team_id
     WHERE m.id = ?
  `);
  const selLink = db.prepare('SELECT fixture_id FROM forecast_match_links WHERE match_id = ?');
  const insFixture = db.prepare(`
    INSERT INTO fixtures (home_team, away_team, kickoff_at, competition_label, status, created_at)
    VALUES (?, ?, ?, ?, 'open', ?)
  `);
  const insLink = db.prepare(
    'INSERT INTO forecast_match_links (match_id, fixture_id, created_at) VALUES (?, ?, ?)'
  );

  const tx = db.transaction(() => {
    for (const id of ids) {
      const m = selMatch.get(id);
      if (!m) {
        result.rejected.push({ id, reason: 'Maç bulunamadı.' });
        continue;
      }
      if (m.sport !== 'football') {
        result.rejected.push({
          id,
          reason: `Yalnızca futbol maçları Kâhin Sensin'e aktarılabilir (bu maçın branşı: ${m.sport === 'basketball' ? 'basketbol' : m.sport}; tahmin türleri 1/X/2 ve karşılıklı gol futbola göre tasarlı).`
        });
        continue;
      }
      if (!m.kickoff_utc) {
        result.rejected.push({ id, reason: 'Maçın başlama saati belli değil; aktarılamaz.' });
        continue;
      }
      const linked = selLink.get(id);
      if (linked) {
        result.already.push({ id, fixture_id: linked.fixture_id });
        continue;
      }
      const info = insFixture.run(
        m.home_team ?? 'Ev Sahibi', m.away_team ?? 'Deplasman',
        m.kickoff_utc, m.competition ?? null, now
      );
      const fixtureId = Number(info.lastInsertRowid);
      insLink.run(id, fixtureId, now);
      result.imported.push({
        id, fixture_id: fixtureId,
        home_team: m.home_team ?? 'Ev Sahibi', away_team: m.away_team ?? 'Deplasman',
        kickoff_at: m.kickoff_utc, competition: m.competition ?? null
      });
    }
  });
  tx();

  return { ok: true, ...result };
}

/* ---------------- kullanıcı tarafı: liste + tahmin ---------------- */

function shapeFixture(f, mine, now) {
  return {
    id: f.id,
    home_team: f.home_team,
    away_team: f.away_team,
    kickoff_at: f.kickoff_at,
    competition_label: f.competition_label,
    status: f.status,
    can_predict: f.status === 'open' && f.kickoff_at > now,
    home_score: f.home_score,
    away_score: f.away_score,
    result_1x2: f.result_1x2,
    result_btts: f.result_btts,
    prediction_count: f.prediction_count,
    my_prediction: mine
      ? { pick_1x2: mine.pick_1x2, pick_btts: mine.pick_btts, points_awarded: mine.points_awarded }
      : null
  };
}

/** Kullanıcının Kâhin Sensin listesi: tahmine açık maçlar + son sonuçlananlar */
function listForecastForUser(db, userId, opts = {}) {
  const now = opts.now || nowIso();
  const showSince = new Date(Date.parse(now) - 6 * 3600000).toISOString();

  const open = db.prepare(`
    SELECT f.*, (SELECT COUNT(*) FROM predictions p WHERE p.fixture_id = f.id) AS prediction_count
      FROM fixtures f
     WHERE f.status = 'open' AND f.kickoff_at >= ?
     ORDER BY f.kickoff_at ASC
     LIMIT 30
  `).all(showSince);

  const recent = db.prepare(`
    SELECT f.*, (SELECT COUNT(*) FROM predictions p WHERE p.fixture_id = f.id) AS prediction_count
      FROM fixtures f
     WHERE f.status IN ('finished', 'cancelled')
     ORDER BY COALESCE(f.settled_at, f.created_at) DESC
     LIMIT 10
  `).all();

  const mine = new Map(
    db.prepare('SELECT fixture_id, pick_1x2, pick_btts, points_awarded FROM predictions WHERE user_id = ?')
      .all(userId).map((p) => [p.fixture_id, p])
  );

  return {
    now,
    points_rule: `1/X/2 doğru +${FORECAST_POINTS.pick1x2} · Karşılıklı gol doğru +${FORECAST_POINTS.pickBtts} · ikisi birden +${FORECAST_POINTS.pick1x2 + FORECAST_POINTS.pickBtts + FORECAST_POINTS.bothBonus}`,
    fixtures: {
      open: open.map((f) => shapeFixture(f, mine.get(f.id), now)),
      recent: recent.map((f) => shapeFixture(f, mine.get(f.id), now))
    }
  };
}

/** Tahmin gönder: her iki tür de zorunlu; maç başlama saatinde kapanır */
function submitPrediction(db, userId, fixtureId, picks, opts = {}) {
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return { ok: false, status: 400, error: 'Geçersiz maç id.' };
  }
  if (!['1', 'X', '2'].includes(picks.pick1x2)) {
    return { ok: false, status: 400, error: 'Maç sonucu tahmini 1, X ya da 2 olmalı.' };
  }
  if (!['yes', 'no'].includes(picks.pickBtts)) {
    return { ok: false, status: 400, error: 'Karşılıklı gol tahmini Evet ya da Hayır olmalı.' };
  }

  const f = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(fixtureId);
  if (!f) return { ok: false, status: 404, error: 'Maç bulunamadı.' };
  if (f.status !== 'open') {
    return { ok: false, status: 400, error: 'Bu maç tahmine kapalı (sonuçlanmış ya da iptal edilmiş).' };
  }
  const now = opts.now || nowIso();
  if (f.kickoff_at <= now) {
    return { ok: false, status: 400, error: 'Bu maçın başlama saati geçti — tahminler kapandı.' };
  }
  const existing = db.prepare('SELECT id FROM predictions WHERE fixture_id = ? AND user_id = ?')
    .get(fixtureId, userId);
  if (existing) {
    return { ok: false, status: 400, error: 'Bu maç için tahminin zaten kayıtlı. Sonuç kesinleşince puanın hesaplanacak.' };
  }

  const info = db.prepare(
    'INSERT INTO predictions (fixture_id, user_id, pick_1x2, pick_btts, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(fixtureId, userId, picks.pick1x2, picks.pickBtts, now);

  return {
    ok: true,
    value: {
      id: Number(info.lastInsertRowid), fixture_id: fixtureId,
      pick_1x2: picks.pick1x2, pick_btts: picks.pickBtts,
      points_awarded: 0, created_at: now
    }
  };
}

/* ---------------- admin tarafı: elle giriş + yönetim ---------------- */

/** Elle maç ekle (mevcut elle giriş akışı — senkron aktarımdan bağımsız yaşar) */
function createManualFixture(db, input) {
  const home = typeof input.homeTeam === 'string' ? input.homeTeam.trim() : '';
  const away = typeof input.awayTeam === 'string' ? input.awayTeam.trim() : '';
  const label = typeof input.competitionLabel === 'string' ? input.competitionLabel.trim() : '';

  if (home.length < 2 || home.length > 40 || away.length < 2 || away.length > 40) {
    return { ok: false, status: 400, error: 'Takım adları 2-40 karakter olmalı.' };
  }
  if (home.toLocaleLowerCase('tr') === away.toLocaleLowerCase('tr')) {
    return { ok: false, status: 400, error: 'İki farklı takım adı gerekli.' };
  }
  if (label.length > 40) {
    return { ok: false, status: 400, error: 'Lig etiketi en fazla 40 karakter olabilir.' };
  }
  const kickoffUtc = parseKickoffInput(input.kickoffAt);
  if (!kickoffUtc) {
    return { ok: false, status: 400, error: 'Başlama saati geçersiz. Örnek: 2026-10-31 19:00 (Türkiye saati).' };
  }

  const now = nowIso();
  const info = db.prepare(`
    INSERT INTO fixtures (home_team, away_team, kickoff_at, competition_label, status, created_at)
    VALUES (?, ?, ?, ?, 'open', ?)
  `).run(home, away, kickoffUtc, label || null, now);

  return {
    ok: true,
    value: {
      id: Number(info.lastInsertRowid), home_team: home, away_team: away,
      kickoff_at: kickoffUtc, competition_label: label || null, status: 'open', created_at: now
    }
  };
}

/** Admin Kâhin Sensin maç listesi (bağ durumu + inceleme bayraklarıyla) */
function listAdminFixtures(db) {
  return db.prepare(`
    SELECT f.id, f.home_team, f.away_team, f.kickoff_at, f.competition_label, f.status,
           f.home_score, f.away_score, f.result_1x2, f.result_btts,
           f.review_required, f.review_reason, f.settled_at, f.settled_by, f.created_at,
           (SELECT COUNT(*) FROM predictions p WHERE p.fixture_id = f.id) AS prediction_count,
           l.match_id,
           m.status AS match_status, m.feed_missing, m.kickoff_utc AS match_kickoff,
           m.finished_at AS match_finished_at, m.external_id AS match_external_id
      FROM fixtures f
      LEFT JOIN forecast_match_links l ON l.fixture_id = f.id
      LEFT JOIN matches m ON m.id = l.match_id
     ORDER BY f.id DESC
     LIMIT 50
  `).all();
}

/** Elle saat güncelle (erteleme incelemesi sonrası admin kararı) */
function updateFixtureKickoff(db, fixtureId, kickoffInput) {
  const f = db.prepare('SELECT id, status FROM fixtures WHERE id = ?').get(fixtureId);
  if (!f) return { ok: false, status: 404, error: 'Maç bulunamadı.' };
  if (f.status !== 'open') return { ok: false, status: 400, error: 'Yalnızca açık maçların saati güncellenebilir.' };
  const kickoffUtc = parseKickoffInput(kickoffInput);
  if (!kickoffUtc) {
    return { ok: false, status: 400, error: 'Başlama saati geçersiz. Örnek: 2026-10-31 19:00 (Türkiye saati).' };
  }
  db.prepare('UPDATE fixtures SET kickoff_at = ?, review_required = 0, review_reason = NULL WHERE id = ?')
    .run(kickoffUtc, fixtureId);
  return { ok: true, value: { id: fixtureId, kickoff_at: kickoffUtc } };
}

/** Maçı iptal et (otomatik puan DAĞITILMAZ; tahminler puan kazanmadan kapanır) */
function cancelFixture(db, fixtureId) {
  const f = db.prepare('SELECT id, status FROM fixtures WHERE id = ?').get(fixtureId);
  if (!f) return { ok: false, status: 404, error: 'Maç bulunamadı.' };
  if (f.status === 'finished') return { ok: false, status: 400, error: 'Sonuçlanmış maç iptal edilemez.' };
  if (f.status === 'cancelled') return { ok: true, already: true, id: fixtureId };
  db.prepare("UPDATE fixtures SET status = 'cancelled' WHERE id = ?").run(fixtureId);
  return { ok: true, id: fixtureId };
}

/** "İnceleme gerekli" bayrağını kapat (admin incelemesi tamamlandı) */
function resolveFixtureReview(db, fixtureId) {
  const f = db.prepare('SELECT id, review_required FROM fixtures WHERE id = ?').get(fixtureId);
  if (!f) return { ok: false, status: 404, error: 'Maç bulunamadı.' };
  db.prepare('UPDATE fixtures SET review_required = 0, review_reason = NULL WHERE id = ?').run(fixtureId);
  return { ok: true, id: fixtureId, had_flag: f.review_required === 1 };
}

module.exports = {
  FORECAST_POINTS,
  SETTLE_DELAY_MS,
  CANDIDATE_WINDOW_DAYS,
  computeResults,
  parseKickoffInput,
  settleFixture,
  processForecastSettlements,
  listForecastCandidates,
  importForecastMatches,
  listForecastForUser,
  submitPrediction,
  createManualFixture,
  listAdminFixtures,
  updateFixtureKickoff,
  cancelFixture,
  resolveFixtureReview
};
