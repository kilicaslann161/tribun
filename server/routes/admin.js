/**
 * Tribün — admin/debug uç noktaları (router /api/admin altına mount edilir)
 * Tümü x-admin-key header'ı ile korunur (ADMIN_KEY, .env).
 *
 * GET  /api/admin/stats                     → sayaçlar (bekleyen rapor dahil)
 * GET  /api/admin/reports                   → raporlar İÇERİK BAZINDA gruplu
 * POST /api/admin/reports/:id {action}      → hide | unhide | dismiss (raporu sil)
 * GET  /api/admin/recent                    → son 20 skor kaydı
 * GET  /api/admin/content                   → son 20 terim + son 20 anı (gizli/bilgi ile)
 * POST /api/admin/content/:type/:id {action} → hide | unhide | delete
 */
const express = require('express');

const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

const CONTENT_TABLES = { term: 'dictionary_terms', memory: 'memories' };

/* ---------------- İstatistikler ---------------- */
router.get('/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users)                                    AS users,
      (SELECT COUNT(*) FROM scores)                                   AS scores,
      (SELECT COUNT(*) FROM dictionary_terms)                         AS terms,
      (SELECT COUNT(*) FROM memories)                                 AS memories,
      (SELECT COUNT(*) FROM reports)                                  AS reports,
      (SELECT COUNT(*) FROM reports r WHERE r.content_type = 'term'
         AND r.content_id IN (SELECT id FROM dictionary_terms WHERE hidden = 0))
        + (SELECT COUNT(*) FROM reports r WHERE r.content_type = 'memory'
         AND r.content_id IN (SELECT id FROM memories WHERE hidden = 0)) AS pending_reports,
      (SELECT COUNT(*) FROM dictionary_terms WHERE hidden = 1)
        + (SELECT COUNT(*) FROM memories WHERE hidden = 1)            AS hidden_contents,
      (SELECT COUNT(*) FROM bingo_rooms WHERE status = 'open')       AS bingo_open,
      (SELECT COUNT(*) FROM bingo_rooms WHERE status = 'finished')   AS bingo_finished,
      (SELECT COUNT(*) FROM transfer_squads)                         AS squads,
      (SELECT COUNT(*) FROM bingo_rooms)                              AS bingo_rooms,
      (SELECT COALESCE(SUM(total_points), 0) FROM users)              AS total_points
  `).get();
  stats.top_user = db.prepare(
    'SELECT nickname, total_points FROM users ORDER BY total_points DESC LIMIT 1'
  ).get() || null;
  res.json(stats);
});

/* ---------------- Raporlar (içerik bazında gruplu) ---------------- */
router.get('/reports', (req, res) => {
  const reportRows = db.prepare(`
    SELECT r.id, r.content_type, r.content_id, r.reason, r.created_at, u.nickname AS reporter
      FROM reports r
      JOIN users u ON u.id = r.user_id
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 200
  `).all();

  const groups = new Map();
  for (const r of reportRows) {
    const key = `${r.content_type}:${r.content_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        content_type: r.content_type,
        content_id: r.content_id,
        report_ids: [],
        reasons: [],
        reporters: [],
        last_at: r.created_at
      });
    }
    const g = groups.get(key);
    g.report_ids.push(r.id);
    if (!g.reasons.includes(r.reason)) g.reasons.push(r.reason);
    g.reporters.push(r.reporter);
  }

  const out = [];
  for (const g of groups.values()) {
    const table = CONTENT_TABLES[g.content_type];
    let content = null;
    let author = null;
    let hidden = null;
    if (g.content_type === 'term') {
      const row = db.prepare(
        `SELECT t.term || ' — ' || t.definition AS c, u.nickname AS a, t.hidden AS h
           FROM dictionary_terms t JOIN users u ON u.id = t.user_id WHERE t.id = ?`
      ).get(g.content_id);
      if (row) { content = row.c; author = row.a; hidden = !!row.h; }
    } else {
      const row = db.prepare(
        `SELECT m.title || ' — ' || m.body AS c, u.nickname AS a, m.hidden AS h
           FROM memories m JOIN users u ON u.id = m.user_id WHERE m.id = ?`
      ).get(g.content_id);
      if (row) { content = row.c; author = row.a; hidden = !!row.h; }
    }
    out.push({
      ...g,
      content,       // içerik silinmişse null
      author,
      hidden,
      report_count: g.report_ids.length
    });
  }

  res.json({ reports: out });
});

/* ---------------- Rapor aksiyonu ---------------- */
router.post('/reports/:id', (req, res) => {
  const id = Number(req.params.id);
  const { action } = req.body || {};
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz rapor id.' });
  if (!['hide', 'unhide', 'dismiss'].includes(action)) {
    return res.status(400).json({ error: 'action alanı "hide", "unhide" ya da "dismiss" olmalı.' });
  }

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!report) return res.status(404).json({ error: 'Rapor bulunamadı.' });

  if (action === 'dismiss') {
    // Raporu reddet/kapat → rapor satırı silinir, içerik dokunulmaz
    db.prepare('DELETE FROM reports WHERE id = ?').run(id);
    return res.json({ ok: true, action });
  }

  const table = CONTENT_TABLES[report.content_type];
  if (!table) return res.status(400).json({ error: 'Bilinmeyen içerik türü.' });
  db.prepare(`UPDATE ${table} SET hidden = ? WHERE id = ?`).run(action === 'hide' ? 1 : 0, report.content_id);
  res.json({ ok: true, action, content_type: report.content_type, content_id: report.content_id });
});

/* ---------------- Son skorlar ---------------- */
router.get('/recent', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, u.nickname, s.game, s.points, s.created_at
      FROM scores s JOIN users u ON u.id = s.user_id
     ORDER BY s.id DESC LIMIT 20
  `).all();
  res.json({ rows });
});

/* ---------------- Son içerikler ---------------- */
function contentList(type) {
  if (type === 'term') {
    return db.prepare(`
      SELECT t.id, t.term AS title, t.definition AS body, u.nickname AS author, t.hidden, t.created_at,
             (SELECT COUNT(*) FROM reports r WHERE r.content_type = 'term' AND r.content_id = t.id) AS report_count
        FROM dictionary_terms t JOIN users u ON u.id = t.user_id
       ORDER BY t.id DESC LIMIT 20
    `).all();
  }
  return db.prepare(`
    SELECT m.id, m.title, m.body, u.nickname AS author, m.hidden, m.created_at, m.year,
           (SELECT COUNT(*) FROM reports r WHERE r.content_type = 'memory' AND r.content_id = m.id) AS report_count
      FROM memories m JOIN users u ON u.id = m.user_id
     ORDER BY m.id DESC LIMIT 20
  `).all();
}

router.get('/content', (req, res) => {
  res.json({ terms: contentList('term'), memories: contentList('memory') });
});

/* ---------------- İçerik aksiyonu ---------------- */
router.post('/content/:type/:id', (req, res) => {
  const type = req.params.type;
  const id = Number(req.params.id);
  const { action } = req.body || {};

  const table = CONTENT_TABLES[type];
  if (!table) return res.status(400).json({ error: 'type "term" ya da "memory" olmalı.' });
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz içerik id.' });
  if (!['hide', 'unhide', 'delete'].includes(action)) {
    return res.status(400).json({ error: 'action alanı "hide", "unhide" ya da "delete" olmalı.' });
  }

  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'İçerik bulunamadı.' });

  if (action === 'delete') {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    db.prepare('DELETE FROM reports WHERE content_type = ? AND content_id = ?').run(type, id); // yetim rapor kalmasın
    return res.json({ ok: true, action });
  }
  db.prepare(`UPDATE ${table} SET hidden = ? WHERE id = ?`).run(action === 'hide' ? 1 : 0, id);
  res.json({ ok: true, action });
});

/* ---------------- Son 10 bingo odası ---------------- */
router.get('/bingo-rooms', (req, res) => {
  const rooms = db.prepare(`
    SELECT r.code, r.status, r.created_at, u.nickname AS owner,
           (SELECT COUNT(*) FROM bingo_players bp WHERE bp.room_id = r.id) AS player_count,
           (SELECT u2.nickname FROM bingo_players bp2 JOIN users u2 ON u2.id = bp2.user_id
             WHERE bp2.room_id = r.id AND bp2.bingo_at IS NOT NULL LIMIT 1) AS winner
      FROM bingo_rooms r
      JOIN users u ON u.id = r.owner_id
     ORDER BY r.id DESC
     LIMIT 10
  `).all();
  res.json({ rooms });
});

/* ---------------- Spor senkronu (AŞAMA 3) ---------------- */
const { syncFixtures, estimateDailyRequests } = require('../services/syncFixtures');
const { budgetLeft, effectiveLimit, DAILY_BUDGET } = require('../services/sportScoreClient');
const { getLiveWindow, syncLiveRound } = require('../services/syncLive');
const { getLiveJobState } = require('../jobs/liveScoresJob');
const { getStandingsJobState, runOnceNow: runStandingsOnce } = require('../jobs/standingsJob');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,99}$/;

/** Gerçek takvim günü mü? (regex + Date gidiş-dönüşü) */
function validDate(s) {
  if (!DATE_RE.test(String(s || ''))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * POST /api/admin/sports/sync/fixtures
 * Gövde (hepsi isteğe bağlı): {competition?: <slug>, dateFrom?: YYYY-MM-DD, dateTo?: YYYY-MM-DD}
 * Kural: en fazla 8 gün. Senkron ARKA PLANDA başlatılır (kira kilidi çift koşuyu
 * engeller); sonucu GET /api/admin/sports/status üzerinden izleyebilirsin.
 */
router.post('/sports/sync/fixtures', async (req, res) => {
  try {
    const { competition, dateFrom, dateTo } = req.body || {};

    /* ---- girdi doğrulama ---- */
    if (competition !== undefined) {
      const slug = String(competition);
      if (!SLUG_RE.test(slug)) {
        return res.status(400).json({ error: 'competition geçersiz: yalnız a-z, 0-9 ve tire.' });
      }
      const row = db.prepare('SELECT id, is_enabled FROM competitions WHERE slug = ?').get(slug);
      if (!row) return res.status(404).json({ error: `Böyle bir lig yok: ${slug}` });
      if (!row.is_enabled) {
        return res.status(400).json({ error: `Lig kapalı (is_enabled=0): ${slug}` });
      }
    }
    if (dateFrom !== undefined && !validDate(dateFrom)) {
      return res.status(400).json({ error: 'dateFrom YYYY-MM-DD biçiminde gerçek bir gün olmalı.' });
    }
    if (dateTo !== undefined && !validDate(dateTo)) {
      return res.status(400).json({ error: 'dateTo YYYY-MM-DD biçiminde gerçek bir gün olmalı.' });
    }

    // Varsayılanlar: hiç gün verilmediyse canlı pencere (bugün+yarın);
    // tek uç verilirse öbür uç ona eşitlenir.
    const from = dateFrom || dateTo || new Date().toISOString().slice(0, 10);
    const to = dateTo || dateFrom || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (from > to) return res.status(400).json({ error: 'dateFrom, dateTo’dan sonra olamaz.' });
    const span = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    if (span > 8) {
      return res.status(400).json({ error: `En fazla 8 gün istenebilir (istenen: ${span}).` });
    }

    const leagues = competition ? 1
      : db.prepare('SELECT COUNT(*) AS c FROM competitions WHERE is_enabled = 1').get().c;
    const estimated = span * leagues;

    // Bilgi amaçlı mevcut kilit durumu (garanti değil; syncFixtures kendi lease'ini alır)
    const lockRow = db.prepare("SELECT locked_until FROM sync_state WHERE job_name = 'fixtures'").get();
    const busy = !!(lockRow && lockRow.locked_until && new Date(lockRow.locked_until) > new Date());

    // Arka planda başlat: HTTP isteği uzun süre bekletilmez
    syncFixtures({ phase: 'manual', competition: competition || undefined, dateFrom: from, dateTo: to })
      .then((r) => console.log(`🛠️  manuel senkron (${competition || 'tüm ligler'}, ${from}..${to}): ${JSON.stringify(r)}`))
      .catch((e) => console.error(`🛠️  manuel senkron hatası: ${e.message}`));

    res.json({
      ok: true, started: !busy,
      note: busy
        ? 'Başka bir senkron koşuyor; bu istek kira kilidi yüzünden skipped olacaktır. Durumu /api/admin/sports/status ile izle.'
        : 'Senkron arka planda başladı. Durumu /api/admin/sports/status ile izle.',
      scope: { competition: competition || 'tümü (is_enabled=1)', dateFrom: from, dateTo: to, days: span, ligler: leagues, tahminiIstek: estimated }
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/admin/sports/sync/live (AŞAMA 5) — tek seferlik canlı skor turu.
 * Gövde isteğe bağlı: {competition?: <slug>} → etkin çiftleri tek lige daralt.
 * Kurallar işin kendisinde: kira kilidi, etkin pencere kapısı (kapalıysa istek
 * atılmaz, yanıt nedenle döner), tüm upsert korumaları.
 */
router.post('/sports/sync/live', async (req, res) => {
  try {
    const { competition } = req.body || {};
    let compFilter = null;
    if (competition !== undefined) {
      const slug = String(competition);
      if (!SLUG_RE.test(slug)) {
        return res.status(400).json({ error: 'competition geçersiz: yalnız a-z, 0-9 ve tire.' });
      }
      const row = db.prepare('SELECT id, is_enabled FROM competitions WHERE slug = ?').get(slug);
      if (!row) return res.status(404).json({ error: `Böyle bir lig yok: ${slug}` });
      if (!row.is_enabled) {
        return res.status(400).json({ error: `Lig kapalı (is_enabled=0): ${slug}` });
      }
      compFilter = slug;
    }

    const win = getLiveWindow(db, Date.now());
    const pairs = compFilter ? win.pairs.filter((p) => p.competition === compFilter) : win.pairs;

    if (!win.active || pairs.length === 0) {
      return res.json({
        ok: true, status: 'idle', requests: 0,
        window: win,
        note: "Etkin pencere kapalı (canlı/penceredeki maç yok) — SportScore'a istek ATILMADI, yalnızca veritabanı kontrol edildi."
      });
    }

    // Arka planda tek tur — kira kilidi çift koşuyu zaten engeller.
    // Filtre verildiyse yalnız o ligim etkin çiftleri; yoksa işin kendi kapısı.
    const runPromise = compFilter
      ? syncFixtures({
          jobName: 'live_scores', phase: 'live',
          pairs: pairs.map((p) => ({ competition: p.competition, date: p.date })),
          priority: 'critical'
        })
      : syncLiveRound({ quietSkipped: false });
    runPromise
      .then((r) => console.log(`🔴 manuel canlı tur: ${JSON.stringify({ status: r.status, requests: r.requests })}`))
      .catch((e) => console.error(`🔴 manuel canlı tur hatası: ${e.message}`));

    res.json({
      ok: true, status: 'started',
      window: { ...win, pairs },
      note: 'Canlı skor turu arka planda başladı; sonucu GET /api/admin/sports/status ile izle.'
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/admin/sports/sync/standings (AŞAMA 7) — tek seferlik puan durumu
 * turu. Gövde isteğe bağlı: {competition?: <slug>} → tek futbol ligi; yoksa
 * tüm futbol ligleri (basketbol ucu doğrulanmadı → futbol dışı lig reddedilir).
 * Due kuralları BEKLENMEZ (manuel tetikleme); kira kilidi çift koşuyu engeller.
 */
router.post('/sports/sync/standings', async (req, res) => {
  try {
    const { competition } = req.body || {};
    if (competition !== undefined) {
      const slug = String(competition);
      if (!SLUG_RE.test(slug)) {
        return res.status(400).json({ error: 'competition geçersiz: yalnız a-z, 0-9 ve tire.' });
      }
      const row = db.prepare('SELECT id, is_enabled, sport FROM competitions WHERE slug = ?').get(slug);
      if (!row) return res.status(404).json({ error: `Böyle bir lig yok: ${slug}` });
      if (!row.is_enabled) return res.status(400).json({ error: `Lig kapalı (is_enabled=0): ${slug}` });
      if (row.sport !== 'football') {
        return res.status(400).json({ error: `Puan durumu yalnızca futbol liglerinde çalışır (istenen: ${slug}, branş: ${row.sport}).` });
      }
    }

    const lockRow = db.prepare("SELECT locked_until FROM sync_state WHERE job_name = 'standings'").get();
    const busy = !!(lockRow && lockRow.locked_until && new Date(lockRow.locked_until) > new Date());

    runStandingsOnce(competition)
      .then((r) => console.log(`🥇 manuel puan durumu turu (${competition || 'tüm futbol ligleri'}): ${JSON.stringify({ status: r.status, requests: r.requests, updated: r.updated })}`))
      .catch((e) => console.error(`🥇 manuel puan durumu turu hatası: ${e.message}`));

    res.json({
      ok: true, started: !busy,
      note: busy
        ? 'Başka bir puan durumu turu koşuyor; bu istek kira kilidi yüzünden skipped olacaktır. Durumu /api/admin/sports/status ile izle.'
        : 'Puan durumu senkronu arka planda başladı. Durumu /api/admin/sports/status ile izle.',
      scope: { competition: competition || 'tümü (is_enabled=1 futbol ligleri)' }
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/admin/sports/status — Aşama 3 durumu:
 * son sync_runs (meta çözülmüş), sync_state, bugünkü api_usage + etkin günlük
 * sınır, unmapped_values özeti, matches özeti ve günlük istek tahmini.
 * AŞAMA 5: live bloğu — canlı iş durumu, sıradaki koşu, etkin pencere ve
 * etkin (lig, gün) çiftleri, bütçe seviyesi, düzeltme one-shot'ları.
 */
router.get('/sports/status', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const runs = db.prepare(
    `SELECT id, job_name, started_at, finished_at, status, requests_made,
            records_seen, records_upserted, records_skipped, error_message, meta
       FROM sync_runs ORDER BY id DESC LIMIT 10`
  ).all().map((r) => {
    let meta = r.meta;
    try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* ham bırak */ }
    return { ...r, meta };
  });

  const state = db.prepare('SELECT * FROM sync_state').all();

  const usage = db.prepare(
    'SELECT endpoint, count FROM api_usage WHERE day_utc = ? ORDER BY count DESC'
  ).all(today);
  const usageTotal = usage.reduce((a, u) => a + u.count, 0);

  const unmappedSummary = db.prepare(
    'SELECT kind, COUNT(*) AS cesit, SUM(hits) AS toplam_hit FROM unmapped_values GROUP BY kind ORDER BY kind'
  ).all();
  const unmappedRecent = db.prepare(
    'SELECT kind, raw_value, sport, hits, seen_at FROM unmapped_values ORDER BY seen_at DESC, id DESC LIMIT 15'
  ).all();

  const matchesByStatus = db.prepare(
    'SELECT status, COUNT(*) AS c FROM matches GROUP BY status ORDER BY c DESC'
  ).all();
  const matchesByCompetition = db.prepare(`
    SELECT c.slug AS competition, c.sport, COUNT(m.id) AS mac,
           SUM(CASE WHEN m.feed_missing = 1 THEN 1 ELSE 0 END) AS feed_missing
      FROM matches m JOIN competitions c ON c.id = m.competition_id
     GROUP BY c.id ORDER BY mac DESC
  `).all();

  const leagues = db.prepare('SELECT COUNT(*) AS c FROM competitions WHERE is_enabled = 1').get().c;
  const est = estimateDailyRequests(leagues);

  /* AŞAMA 5: canlı skor işi durumu (running, sıradaki koşu, etkin pencere,
   * etkin çiftler, bütçe seviyesi, düzeltme planları) */
  const live = getLiveJobState();

  /* AŞAMA 7: puan durumu işi durumu + lig bazlı satır sayıları */
  const standingsJob = getStandingsJobState();
  const standingsByCompetition = db.prepare(`
    SELECT c.slug AS competition, c.sport, COUNT(s.id) AS rows,
           MIN(s.updated_at) AS first_written, MAX(s.updated_at) AS last_written
      FROM competitions c
      LEFT JOIN standings s ON s.competition_id = c.id
     WHERE c.is_enabled = 1
     GROUP BY c.id ORDER BY c.sort_order
  `).all();

  /* Son 10 koşu arasında işe göre filtre de kolayca yapılabilsin diye ham bırakılır;
   * live bloğunun kendi son koşuları aşağıda. */
  const liveRuns = db.prepare(
    `SELECT id, status, started_at, finished_at, requests_made,
            records_seen, records_upserted, records_skipped, error_message
       FROM sync_runs WHERE job_name = 'live_scores' ORDER BY id DESC LIMIT 5`
  ).all();

  res.json({
    today: {
      date: today,
      requests: usageTotal,
      budget: DAILY_BUDGET,
      effectiveLimit: effectiveLimit(),
      remaining: budgetLeft(),
      byEndpoint: usage
    },
    estimate: est,
    live: { ...live, recent_runs: liveRuns },
    standings: { ...standingsJob, by_competition: standingsByCompetition },
    sync_state: state,
    sync_runs: runs,
    unmapped_values: { summary: unmappedSummary, recent: unmappedRecent },
    matches: {
      total: matchesByStatus.reduce((a, s) => a + s.c, 0),
      byStatus: matchesByStatus,
      feedMissing: db.prepare('SELECT COUNT(*) AS c FROM matches WHERE feed_missing = 1').get().c,
      byCompetition: matchesByCompetition
    }
  });
});

/* ---------------- Kâhin Sensin (AŞAMA 9) ---------------- */
const forecast = require('../services/forecastCore');

/**
 * GET /api/admin/sports/forecast/candidates — gelecek 7 günün aktarılabilir
 * maçları: futbol + status=scheduled + feed_missing=0 + açık lig + henüz
 * bağlanmamış. Basketbol listeye zaten girmez (talimat 2: yalnız futbol).
 */
router.get('/sports/forecast/candidates', (req, res) => {
  res.json(forecast.listForecastCandidates(db));
});

/**
 * POST /api/admin/sports/forecast/import {matchIds:[...]}
 * Senkron maçları tek tıkla Kâhin Sensin'e aktar: takım adları, kickoff ve
 * lig adı etiketiyle fixtures kaydı + bağ kaydı. TEK transaction, idempotent
 * (aynı maç ikinci kez aktarılamaz → "already" olarak döner, hata değil).
 */
router.post('/sports/forecast/import', (req, res) => {
  const r = forecast.importForecastMatches(db, (req.body || {}).matchIds);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  console.log(`🔮 [forecast] aktarım: ${r.imported.length} yeni, ${r.already.length} zaten bağlı, ${r.rejected.length} reddedildi`);
  res.json(r);
});

/**
 * GET /api/admin/forecast/fixtures — Kâhin Sensin maç listesi (bağ durumu,
 * tahmin sayıları, inceleme bayraklarıyla). Liste ÖNCESİnde yalnız-DB sonuç
 * denetimi koşulur → admin paneli her açılışta taze durum görür (istek ATMAZ).
 */
router.get('/forecast/fixtures', (req, res) => {
  try {
    const pass = forecast.processForecastSettlements(db);
    if (pass.settled.length || pass.corrections.length || pass.flagged.length) {
      console.log(`🔮 [forecast] panel tazeleme: settled=${pass.settled.length} corrections=${pass.corrections.length} flagged=${pass.flagged.length}`);
    }
  } catch (e) {
    console.error(`🔮 [forecast] panel denetimi hatası: ${e.message}`);
  }
  res.json({ fixtures: forecast.listAdminFixtures(db) });
});

/** POST /api/admin/forecast/fixtures — ELLE maç girişi (mevcut akış, aynen kalır) */
router.post('/forecast/fixtures', (req, res) => {
  const r = forecast.createManualFixture(db, req.body || {});
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  console.log(`🔮 [forecast] elle maç eklendi #${r.value.id}: ${r.value.home_team} - ${r.value.away_team}`);
  res.json(r.value);
});

/** POST /api/admin/forecast/fixtures/:id/settle — elle sonuç girişi (settleFixture'in AYNI yolu) */
router.post('/forecast/fixtures/:id/settle', (req, res) => {
  const id = Number(req.params.id);
  const { homeScore, awayScore } = req.body || {};
  const r = forecast.settleFixture(db, id, { homeScore: Number(homeScore), awayScore: Number(awayScore) }, { by: 'admin' });
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  console.log(`🔮 [forecast] elle sonuç #${id}: ${homeScore}-${awayScore} → ${r.predictions} tahmine ${r.awarded} puan`);
  res.json(r);
});

/** POST /api/admin/forecast/fixtures/:id/cancel — iptal (otomatik puan dağıtımı YOK) */
router.post('/forecast/fixtures/:id/cancel', (req, res) => {
  const r = forecast.cancelFixture(db, Number(req.params.id));
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

/** POST /api/admin/forecast/fixtures/:id/kickoff — saat güncelle (erteleme incelemesi kararı) */
router.post('/forecast/fixtures/:id/kickoff', (req, res) => {
  const r = forecast.updateFixtureKickoff(db, Number(req.params.id), (req.body || {}).kickoffAt);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json(r.value);
});

/** POST /api/admin/forecast/fixtures/:id/resolve — "İnceleme gerekli" bayrağını kapat */
router.post('/forecast/fixtures/:id/resolve', (req, res) => {
  const r = forecast.resolveFixtureReview(db, Number(req.params.id));
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

module.exports = router;
