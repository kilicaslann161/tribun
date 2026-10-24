/**
 * Tribün — admin/debug uç noktaları (router /api/admin altına mount edilir)
 * Tümü x-admin-key header'ı ile korunur (ADMIN_KEY, .env; timing-safe karşılaştırma).
 * /api/admin'i ayrıca adminLimiter korur (AŞAMA 10: anahtar deneme/yordamayı yavaşlat).
 *
 * GET  /api/admin/stats                     → sayaçlar (bekleyen rapor dahil)
 * GET  /api/admin/reports                   → raporlar İÇERİK BAZINDA gruplu
 * POST /api/admin/reports/:id {action}      → hide | unhide | dismiss (raporu sil)
 * GET  /api/admin/recent                    → son 20 skor kaydı
 * GET  /api/admin/content                   → son 20 terim + son 20 anı (gizli/bilgi ile)
 * POST /api/admin/content/:type/:id {action} → hide | unhide | delete
 * GET  /api/admin/bingo-rooms              → son 10 bingo odası
 *
 * Spor (AŞAMA 3-9): status, sync/fixtures|live|standings, forecast/* uçları.
 * AŞAMA 10 izleme/yönetim:
 * GET  /api/admin/sports/overview          → bütçe + 7 gün döküm + kilitler + retention
 * GET  /api/admin/sports/competitions      → ligler (is_enabled, slug_status, sayaçlar)
 * POST /api/admin/sports/competitions      → aday lig ekle (slug_status='candidate')
 * POST /api/admin/sports/competitions/:id → {is_enabled?, slug_status?}
 * GET  /api/admin/sports/teams            → takım listesi + eşleşmemiş feed adları
 * POST /api/admin/sports/teams/:id/display-name → görünen ad ata/temizle
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

/* ---------------- İzleme + Lig/Takım Yönetimi (AŞAMA 10) ---------------- */
const { retentionStats } = require('../services/retention');
const { getRetentionJobState } = require('../jobs/retentionJob');

/**
 * GET /api/admin/sports/overview — "Spor Verisi" sekmesinin izleme kartları:
 *  - bugünkü bütçe (status ucundakiyle aynı kaynak; tek yerden okunur)
 *  - son 7 günün api_usage dökümü (gün bazlı toplam + uç bazında bugün)
 *  - sync_state satırları KİLİT DURUMU HESAPLANMIŞ hâlde (locked: evet/hayır, kalan sn)
 *  - retention: tablo sayaçları + iş durumu + son tur özeti
 */
router.get('/sports/overview', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  /* Son 7 gün: gün toplamları (TR günü değil, UTC — api_usage UTC güne göre yazılır) */
  const usage7d = db.prepare(`
    SELECT day_utc, SUM(count) AS total
      FROM api_usage
     WHERE day_utc >= date('now', '-6 days')
     GROUP BY day_utc
     ORDER BY day_utc DESC
  `).all();

  const state = db.prepare('SELECT * FROM sync_state').all().map((row) => {
    const until = row.locked_until ? Date.parse(row.locked_until) : 0;
    const locked = until > Date.now();
    return {
      ...row,
      locked,
      lock_seconds_left: locked ? Math.round((until - Date.now()) / 1000) : 0
    };
  });

  res.json({
    today: {
      date: today,
      budget: DAILY_BUDGET,
      effectiveLimit: effectiveLimit(),
      remaining: budgetLeft(),
      usedToday: db.prepare('SELECT COALESCE(SUM(count),0) AS c FROM api_usage WHERE day_utc = ?').get(today).c
    },
    usage_7d: usage7d,
    sync_state: state,
    retention: { stats: retentionStats(db), job: getRetentionJobState() }
  });
});

/**
 * GET /api/admin/sports/competitions — lig listesi (izleme anahtarı + aday durumu):
 * is_enabled, slug_status, maç/puan-durumu satır sayıları, son veri yazım zamanları.
 */
router.get('/sports/competitions', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.slug, c.name, c.sport, c.country, c.sort_order,
           c.is_enabled, c.slug_status, c.api_name, c.updated_at,
           (SELECT COUNT(*) FROM matches m WHERE m.competition_id = c.id) AS match_count,
           (SELECT COUNT(*) FROM standings s WHERE s.competition_id = c.id) AS standings_rows,
           (SELECT MAX(m.updated_at) FROM matches m WHERE m.competition_id = c.id) AS last_match_write
      FROM competitions c
     ORDER BY c.sort_order, c.slug
  `).all();
  res.json({ competitions: rows });
});

const SPORTS_RE = /^(football|basketball)$/;
const NAME_MAX = 60;
const DISPLAY_NAME_MAX = 40;

function cleanName(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * POST /api/admin/sports/competitions — YENİ lig ekle (slug_status='candidate').
 * Gövde: {slug, sport, name}. ADAY ligler is_enabled=0 ile başlar: önce elle senkron
 * tetikleyip verinin gerçekten geldiğini gör, sonra aç ve 'active' işaretle.
 * external_id 'admin:<slug>' sentetiktir (UNIQUE kısıtı için); sağlayıcı id'si bilinmez.
 */
router.post('/sports/competitions', (req, res) => {
  const { slug, sport, name } = req.body || {};
  if (!SLUG_RE.test(String(slug || ''))) {
    return res.status(400).json({ error: 'slug geçersiz: yalnız a-z, 0-9 ve tire (2-100 karakter).' });
  }
  if (!SPORTS_RE.test(String(sport || ''))) {
    return res.status(400).json({ error: 'sport "football" ya da "basketball" olmalı.' });
  }
  const clean = cleanName(name);
  if (clean.length < 2 || clean.length > NAME_MAX) {
    return res.status(400).json({ error: `name 2-${NAME_MAX} karakter olmalı.` });
  }
  if (db.prepare('SELECT 1 FROM competitions WHERE slug = ?').get(slug)) {
    return res.status(409).json({ error: `Bu slug zaten var: ${slug}` });
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO competitions
      (provider, external_id, slug, sport, name, api_name, sort_order,
       is_enabled, slug_status, created_at, updated_at)
    VALUES ('sportscore', ?, ?, ?, ?, ?, 500, 0, 'candidate', ?, ?)
  `).run(`admin:${slug}`, slug, sport, clean, clean, now, now);
  console.log(`📡 [admin] aday lig eklendi: ${slug} (${sport}) — is_enabled=0, slug_status='candidate'`);
  res.status(201).json({ ok: true, slug, sport, name: clean, slug_status: 'candidate', is_enabled: 0 });
});

/**
 * POST /api/admin/sports/competitions/:id — lig anahtarı/durum güncelle.
 * Gövde (her biri isteğe bağlı): {is_enabled?: 0|1, slug_status?: 'active'|'candidate'}
 * Kural: kapatılan lig (is_enabled=0) senkronlanmaz; ADAY ligi AÇMAK serbesttir ama
 * veri gelmezse sorumluluk adminde (panelde 'ADAY' etiketi görünür kalır).
 */
router.post('/sports/competitions/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz lig id.' });
  const row = db.prepare('SELECT id, slug FROM competitions WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Lig bulunamadı.' });

  const { is_enabled, slug_status } = req.body || {};
  const updates = [];

  if (is_enabled !== undefined) {
    const v = Number(is_enabled);
    if (v !== 0 && v !== 1) return res.status(400).json({ error: 'is_enabled yalnız 0 ya da 1 olabilir.' });
    updates.push(['is_enabled', v]);
  }
  if (slug_status !== undefined) {
    if (!['active', 'candidate'].includes(String(slug_status))) {
      return res.status(400).json({ error: "slug_status 'active' ya da 'candidate' olmalı." });
    }
    updates.push(['slug_status', String(slug_status)]);
  }
  if (!updates.length) return res.status(400).json({ error: 'Güncellenecek alan yok (is_enabled ve/veya slug_status ver).' });

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const [col, val] of updates) {
      db.prepare(`UPDATE competitions SET ${col} = ?, updated_at = ? WHERE id = ?`).run(val, now, id);
    }
  });
  tx();
  console.log(`📡 [admin] lig güncellendi #${id} (${row.slug}): ${updates.map(([c, v]) => `${c}=${v}`).join(', ')}`);
  res.json({ ok: true, id, slug: row.slug, updates: Object.fromEntries(updates) });
});

/**
 * DELETE /api/admin/sports/competitions/:id — ADAY ligi sil.
 * Kural: yalnız slug_status='candidate' VE hiç maçı olmayan lig silinebilir
 * (yanlış slug denemelerini geri almak için). Allowlist ligleri ('active')
 * config'in mülkiyetindedir — silinemez; kapatmak istersen is_enabled=0 yap.
 */
router.delete('/sports/competitions/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz lig id.' });
  const row = db.prepare('SELECT id, slug, slug_status FROM competitions WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Lig bulunamadı.' });
  if (row.slug_status !== 'candidate') {
    return res.status(400).json({ error: 'Yalnız ADAY (candidate) ligler silinebilir; allowlist ligleri kapatılır, silinmez.' });
  }
  const matchCount = db.prepare('SELECT COUNT(*) AS c FROM matches WHERE competition_id = ?').get(id).c;
  if (matchCount > 0) {
    return res.status(400).json({ error: `Bu aday ligin ${matchCount} maç kaydı var; önce kapat (is_enabled=0) ve kayıtları incele.` });
  }
  const standingsCount = db.prepare('SELECT COUNT(*) AS c FROM standings WHERE competition_id = ?').get(id).c;
  db.prepare('DELETE FROM standings WHERE competition_id = ?').run(id); // adayın deneme satırları (varsa)
  db.prepare('DELETE FROM competitions WHERE id = ?').run(id);
  console.log(`📡 [admin] aday lig silindi #${id} (${row.slug}) — maç: ${matchCount}, puan durumu: ${standingsCount}`);
  res.json({ ok: true, id, slug: row.slug });
});

/**
 * GET /api/admin/sports/teams?q=arama — takım adları ve GÖRÜNEN ad atama tablosu.
 * Yanıt: takım listesi (isim, display_name, maç sayısı) + unmapped_values'tan
 * son eşleşmemiş feed takım adları (aynı formu doldurmak için bağlam).
 */
router.get('/sports/teams', (req, res) => {
  const q = cleanName(req.query.q).slice(0, 60);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const teams = db.prepare(`
    SELECT t.id, t.name, t.display_name, t.sport,
           (SELECT COUNT(*) FROM matches m WHERE m.home_team_id = t.id OR m.away_team_id = t.id) AS match_count,
           t.updated_at
      FROM teams t
     ${q ? 'WHERE t.name LIKE ? OR t.display_name LIKE ?' : ''}
     ORDER BY match_count DESC, t.name ASC
     LIMIT 100
  `).all(...(q ? [like, like] : []));

  const unmappedTeams = db.prepare(
    "SELECT raw_value, sport, hits, seen_at FROM unmapped_values WHERE kind = 'team_name' ORDER BY hits DESC, seen_at DESC LIMIT 30"
  ).all();

  res.json({ teams, unmapped_team_names: unmappedTeams });
});

/**
 * POST /api/admin/sports/teams/:id/display-name — takıma GÖRÜNEN ad ata.
 * Gövde: {displayName?: string} — boş dizi/null → temizle (feed adına dön).
 * Kurallar: 1-40 karakter, tırnak/etiket yok (textContent her yerde zorunlu);
 * atanan ad yalnızca OKUMA API'lerinde görünür — senkron yazımları feed adını korur.
 */
router.post('/sports/teams/:id/display-name', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz takım id.' });
  const team = db.prepare('SELECT id, name, display_name FROM teams WHERE id = ?').get(id);
  if (!team) return res.status(404).json({ error: 'Takım bulunamadı.' });

  const raw = req.body ? req.body.displayName : undefined;
  let value;
  if (raw === undefined) {
    return res.status(400).json({ error: 'displayName alanı zorunlu (boş verip göndererek temizlenir).' });
  }
  if (raw === null || String(raw).trim() === '') {
    value = null; // temizle → feed adı gösterilir
  } else {
    value = String(raw).trim().replace(/\s+/g, ' ');
    if (value.length < 1 || value.length > DISPLAY_NAME_MAX) {
      return res.status(400).json({ error: `Görünen ad en fazla ${DISPLAY_NAME_MAX} karakter olabilir.` });
    }
  }

  db.prepare('UPDATE teams SET display_name = ?, updated_at = ? WHERE id = ?')
    .run(value, new Date().toISOString(), id);
  console.log(`📡 [admin] takım #${id} (${team.name}) görünen ad: ${value ?? '(temizlendi)'}`);
  res.json({ ok: true, id, name: team.name, display_name: value });
});



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
