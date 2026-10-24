/**
 * Tribün — fikstür senkronizasyonu v2 (AŞAMA 3; AŞAMA 5'te PAYLAŞILAN MOTOR)
 *
 * MODEL: her istek TEK bir (lig slug, UTC günü) çiftine atılır:
 *   GET /api/v1/fixtures/?sport=&date=&competition=<slug>
 * (competition parametresi canlı doğrulandı — 23.10.2026: filtreli yanıt
 *  yalnız o ligin maçlarını döndürür; count=0 geçerli "o gün maç yok" yanıtıdır.)
 * Yalnızca is_enabled=1 liglerde çalışır (her koşuda taze okunur).
 *
 * AŞAMA 5 KULLANIMI: syncLive bu motoru opts.pairs (etkin (lig, kickoff UTC
 * günü) çiftleri) + opts.jobName='live_scores' ile çağırır → Aşama 3'ün TÜM
 * upsert koruma kuralları, tek-transaction yazımı, kira kilidi ve sync_runs
 * günlüğü canlı skor turunda AYNEN geçerli olur.
 *
 * AŞAMA 5 EK KORUMASI — DONDURMA (kural 10):
 *   finished + finished_at ≥ 24 saat eski kayıt DONMUŞTUR; hiçbir alanı
 *   güncellenmez (meta.frozenSkipped'a loglanır). minute alanı list
 *   yanıtında bulunmadığından bu motor ASLA yazmaz (yalnız detay — Aşama 8).
 *
 * İSTEK PLANI / GÜNLÜK TAHMİN (L = is_enabled=1 lig sayısı):
 *   canlı pencere (D, D+1) : 8 tur/gün (3 saatte bir)  → 2×L×8 istek
 *   dün (D-1)              : 4 tur/gün (6 saatte bir)  →   L×4 istek
 *   D-2                    : 1 tur/gün                →     L istek
 *   gelecek (D+2..D+7)     : 1 tur/gün                →   6×L istek
 *   TOPLAM = 27×L → L=11 için 2×11×8 + 11×4 + 11 + 6×11 = 297 istek/gün
 *   (günlük bütçe 7000'in ~%4'ü; hesabı estimateDailyRequests() otomatik yapar,
 *    zamanlayıcı açılırken lig sayısıyla birlikte loglanır)
 *
 * UPSERT KORUMA KURALLARI (kural 3):
 *   1. NULL/boş yeni değer, dolu skoru/alanı EZMEZ.
 *   2. Durum geriye dönmez: finished → live/scheduled (ya da unknown) şüphelidir;
 *      meta'ya loglanır ve kayıt ATLANIR.
 *   3. Skor düşüşü şüphelidir; yalnızca ardışık İKİ yanıt aynı düşük değeri
 *      verirse kabul edilir (VAR düzeltmesi senaryosu).
 *   4. Ertelenen maçın yeni kickoff'u güncellenir (futbolda kimlik sabittir;
 *      aynı satır güncellenir).
 *   5. Aynı yanıtta aynı external_id iki kez geçerse İLKİ alınır, ikincisi
 *      meta.duplicates'a loglanır.
 *   6. Başarılı bir (lig, gün) senkronunda dönmeyen ama veritabanında scheduled
 *      görünen maç, art arda İKİ başarılı senkronda yine dönmezse
 *      feed_missing=1 işaretlenir → varsayılan okuma API'sinde gösterilmez;
 *      ASLA silinmez. Feed'e geri dönerse bayrak sıfırlanır.
 *   7. Boş/hatalı yanıt HİÇBİR kaydı değiştirmez; sync_runs'a failed/partial
 *      yazılır. Başarılı ama count=0 yanıt GEÇERLİDİR (o gün maç yok).
 *   8. Yanıttaki count ≥ 100 → yanıt kesilmiş olabilir; sync_runs.meta'ya yazılır.
 *   9. finished_at, durum finished'a İLK geçtiğinde yazılır.
 *  10. finished + 24 saat → kayıt donar; artık hiçbir alan güncellenmez (Aşama 5).
 *
 * Koruma KARARLARI services/matchGuard.js içindeki SAF fonksiyonlardadır;
 * burada yalnızca işlenirler (test edilebilirlik + iki işin tek hafızası).
 *
 * YAZMA (kural 2): tüm yazmalar — takım/maç upsert + feed_missing + unmapped_values
 * + sync_runs + sync_state — TEK transaction içinde.
 * ÇAKIŞMA KİLİDİ (kural 4): sync_state'te KİRA (lease) tabanlı; süreç çökerse
 * kira süresi bitince devam edilir. Bellek içi kilide güvenilmez.
 * İstekler arasında en az 1 saniye beklenir (kural 5: peş peşe yağdırma yok).
 */
const db = require('../db');
const { fetchFixtures, BudgetError, CircuitOpenError } = require('./sportScoreClient');
const { normalizeListMatch } = require('./matchNormalizer');
const { recordUnmapped } = require('./unmappedStore');
const {
  isStatusRollback, isFrozen, checkScoreDrop, shouldSetFinishedAt
} = require('./matchGuard');

const DEFAULT_JOB = 'fixtures';
const LEASE_MS = 10 * 60 * 1000;   // kira süresi: çöken süreçten 10 dk sonra kilit düşer
const REQUEST_GAP_MS = 1000;      // istekler arası zorunlu asgari bekleme (Aşama 5'te de aynı)
const TRUNCATION_COUNT = 100;     // count >= 100 → kesilme şüphesi
const MAX_SPAN_DAYS = 8;          // manuel tetikleme için üst sınır

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Gerçek takvim günü mü? (regex + Date gidiş-dönüşü) */
function isValidDate(s) {
  if (!DATE_RE.test(String(s || ''))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function utcDay(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/* ---------------- günlük istek tahmini (kural 1: kod + README'de hesap) ---------------- */

/**
 * @param {number} leagueCount is_enabled=1 lig sayısı
 * @returns {{leagues:number, formula:string, breakdown:object, total:number}}
 */
function estimateDailyRequests(leagueCount) {
  const L = Math.max(0, Number(leagueCount) || 0);
  return {
    leagues: L,
    formula: '2×L×8 + L×4 + L×1 + 6×L = 27×L',
    breakdown: {
      liveTodayAndTomorrow: 2 * L * 8,   // D, D+1 → günde 8 tur
      yesterday: L * 4,                  // D-1 → günde 4 tur
      historyD2: L * 1,                  // D-2 → günde 1 tur (finished yeniden çekilmez ama tur atılır)
      futureD2toD7: 6 * L                // D+2..D+7 → günde 1 tur
    },
    total: 27 * L
  };
}

/* ---------------- kira kilidi (sync_state; kural 4) — iş adına göre ---------------- */

function acquireLease(jobName) {
  const now = Date.now();
  const row = db.prepare('SELECT locked_until FROM sync_state WHERE job_name = ?').get(jobName);
  if (row && row.locked_until && new Date(row.locked_until).getTime() > now) return false;
  const lockedBy = `pid${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO sync_state (job_name, locked_until, locked_by, last_run_at, consecutive_failures)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(job_name) DO UPDATE SET locked_until = excluded.locked_until,
                                         locked_by  = excluded.locked_by,
                                         last_run_at = excluded.last_run_at
  `).run(jobName, new Date(now + LEASE_MS).toISOString(), lockedBy, nowIso());
  return true;
}

function releaseLease(jobName) {
  db.prepare('UPDATE sync_state SET locked_until = NULL WHERE job_name = ?').run(jobName);
}

/* ---------------- yardımcılar ---------------- */

/** is_enabled=1 ligler (her koşuda taze; kural 1: yalnız bunlar senkron edilir) */
function enabledCompetitions() {
  return db.prepare(
    'SELECT id, slug, sport, name, api_name FROM competitions WHERE is_enabled = 1 ORDER BY sort_order'
  ).all();
}

/* Durum geri dönüşü tespiti için sıralama matchGuard'dadır
 * (scheduled(0) < live/halftime(1) < finished(2)). */

/* Ardışık skor-düşüş onay hafızası: externalId → {home, away} (kural 3).
 * MODÜL düzeyinde TEK harita: fikstür ve canlı skor işleri aynı hafzayı
 * paylaşır → bir işin gördüğü şüpheli düşüş, öbür işin turunda da sayılır. */
const pendingDrop = new Map();

/* Dondurulan (finished ≥ 24 saat) kayıtların log sınırı */
const MAX_META_LIST = 20;

/* ---------------- yazma katmanı (tek transaction) ---------------- */

const upsertTeam = db.prepare(`
  INSERT INTO teams (provider, external_id, sport, name, short_name, logo_url, updated_at)
  VALUES ('sportscore', ?, ?, ?, NULL, ?, ?)
  ON CONFLICT(provider, external_id) DO UPDATE SET
    name       = COALESCE(excluded.name, teams.name),
    logo_url   = COALESCE(excluded.logo_url, teams.logo_url),
    updated_at = excluded.updated_at
`);

const selectMatch = db.prepare(
  'SELECT id, status, home_score, away_score, kickoff_utc, finished_at, miss_streak ' +
  'FROM matches WHERE provider = ? AND external_id = ?'
);

const insertMatch = db.prepare(`
  INSERT INTO matches (provider, external_id, sport, competition_id, season, round_label,
                       home_team_id, away_team_id, kickoff_utc, status, status_raw,
                       period, minute, home_score, away_score, period_scores, venue,
                       url_path, feed_missing, miss_streak,
                       finished_at, fetched_at, created_at, updated_at)
  VALUES ('sportscore', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL,
          ?, 0, 0, ?, ?, ?, ?)
`);

const updateMatch = db.prepare(`
  UPDATE matches SET
    competition_id = COALESCE(?, competition_id),
    home_team_id   = COALESCE(?, home_team_id),
    away_team_id   = COALESCE(?, away_team_id),
    kickoff_utc    = COALESCE(?, kickoff_utc),
    status         = ?,
    status_raw     = COALESCE(?, status_raw),
    period         = CASE WHEN ? IN ('live','halftime') THEN ? ELSE period END,
    home_score     = CASE WHEN ? IS NULL THEN home_score ELSE ? END,
    away_score     = CASE WHEN ? IS NULL THEN away_score ELSE ? END,
    url_path       = COALESCE(?, url_path),
    feed_missing   = 0,
    miss_streak    = 0,
    finished_at    = COALESCE(?, finished_at),
    fetched_at     = ?,
    updated_at     = ?
  WHERE id = ?
`);

const resetMatchFeedFlags = db.prepare(
  "UPDATE matches SET feed_missing = 0, miss_streak = 0 WHERE provider = 'sportscore' AND external_id = ?"
);

const bumpMissStreak = db.prepare(
  'UPDATE matches SET miss_streak = miss_streak + 1 WHERE id = ?'
);
const markFeedMissing = db.prepare(
  'UPDATE matches SET feed_missing = 1, miss_streak = 0 WHERE id = ?'
);

const scheduledOfPair = db.prepare(`
  SELECT id, external_id, miss_streak
    FROM matches
   WHERE competition_id = ? AND substr(kickoff_utc, 1, 10) = ?
     AND status = 'scheduled' AND feed_missing = 0
`);

const insertSyncRun = db.prepare(`
  INSERT INTO sync_runs (job_name, started_at, finished_at, status,
                         requests_made, records_seen, records_upserted, records_skipped,
                         error_message, meta)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const syncRunFailed = db.prepare(`
  INSERT INTO sync_runs (job_name, started_at, finished_at, status,
                         requests_made, records_seen, records_upserted, records_skipped,
                         error_message, meta)
  VALUES (?, ?, ?, 'failed', ?, 0, 0, ?, ?, ?)
`);

const updateSyncStateOk = db.prepare(
  'UPDATE sync_state SET last_success_at = ?, last_error = NULL, consecutive_failures = 0 WHERE job_name = ?'
);
const updateSyncStateFail = db.prepare(
  'UPDATE sync_state SET last_error = ?, consecutive_failures = consecutive_failures + 1 WHERE job_name = ?'
);

/* ---------------- ana senkron ---------------- */

/**
 * Kapsam üç biçimden biriyle verilir:
 *   A) opts.pairs: [{competition: <slug>, date: 'YYYY-MM-DD'}] — AŞAMA 5 canlı
 *      skor turları etkin (lig, kickoff UTC günü) çiftlerini böyle verir.
 *      Kapalı/bilinmeyen lig çiftleri sessizce DÜŞÜRÜLÜR (meta.droppedPairs) —
 *      tek kötü çift tüm turu bozmaz.
 *   B) opts.dates (UTC gün listesi) [+ opts.competition]
 *   C) dateFrom/dateTo (≤ 8 gün)
 * opts.jobName: kira kilidi + sync_runs + sync_state satırunun adı
 *   ('fixtures' varsayılan; canlı skor 'live_scores').
 * opts.phase: 'live' | 'yesterday' | 'history' | 'future' | 'manual' | 'correction' (meta'ya yazılır).
 * opts.priority: fetchFixtures bütçe önceliği (canlı skor 'critical' ister);
 *   verilmezse gün bazlı otomatik öncelik kullanılır.
 *
 * @returns {Promise<{status:'success'|'partial'|'failed'|'skipped', ...}>}
 */
async function syncFixtures(opts = {}) {
  const phase = opts.phase || 'manual';
  const jobName = opts.jobName || DEFAULT_JOB;

  /* ---- kapsam çözümleme + doğrulama ---- */
  const pairs = [];
  const droppedPairs = [];
  let dates = null;   // yalnızca dates/dateFrom kapsamında dolu (istatistik için)
  let comps = null;   // yalnızca dates/dateFrom kapsamında dolu (istatistik için)

  if (Array.isArray(opts.pairs) && opts.pairs.length) {
    const allComps = enabledCompetitions();
    const bySlug = new Map(allComps.map((c) => [c.slug, c]));
    const seen = new Set();
    for (const p of opts.pairs) {
      const slug = String((p && p.competition) || '');
      const date = String((p && p.date) || '');
      if (!isValidDate(date)) throw new Error(`Geçersiz UTC günü (pairs): ${JSON.stringify(p)}`);
      const comp = bySlug.get(slug);
      if (!comp) {
        droppedPairs.push({ competition: slug, date, reason: 'kapalı ya da bilinmeyen lig' });
        continue;
      }
      const key = `${slug}|${date}`;
      if (seen.has(key)) continue; // kopya çiftleri birleştir
      seen.add(key);
      pairs.push({ comp, date });
    }
  } else {
    if (Array.isArray(opts.dates) && opts.dates.length) {
      dates = [...new Set(opts.dates)].sort();
      for (const d of dates) {
        if (!isValidDate(d)) throw new Error(`Geçersiz UTC günü: ${JSON.stringify(d)}`);
      }
    } else {
      const from = opts.dateFrom || utcDay(0);
      const to = opts.dateTo || (opts.dateFrom ? opts.dateFrom : utcDay(1));
      if (!isValidDate(from) || !isValidDate(to)) {
        throw new Error('dateFrom/dateTo YYYY-MM-DD biçiminde gerçek gün olmalı.');
      }
      if (from > to) throw new Error('dateFrom, dateTo’dan sonra olamaz.');
      const span = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
      if (span > MAX_SPAN_DAYS) {
        throw new Error(`En fazla ${MAX_SPAN_DAYS} gün istenebilir (istenen: ${span}).`);
      }
      dates = [];
      for (let t = new Date(from + 'T00:00:00Z').getTime(); t <= new Date(to + 'T00:00:00Z').getTime(); t += 86400000) {
        dates.push(new Date(t).toISOString().slice(0, 10));
      }
    }

    const allComps = enabledCompetitions();
    comps = opts.competition ? allComps.filter((c) => c.slug === opts.competition) : allComps;
    if (opts.competition && !comps.length) {
      throw new Error(`Lig kapalı ya da yok: ${opts.competition}`);
    }
    for (const c of comps) {
      for (const d of dates) pairs.push({ comp: c, date: d });
    }
  }

  const startedAt = nowIso();

  /* ---- kira kilidi (bu İŞE özgü satır; iki iş paralel koşabilir, yazılar
   *     kendi transaction'larında atomiktir) ---- */
  if (!acquireLease(jobName)) {
    if (!opts.quietSkipped) {
      const tx = db.transaction(() => {
        insertSyncRun.run(jobName, startedAt, nowIso(), 'skipped', 0, 0, 0, 0,
          'kilitli (lease) — başka bir senkron koşuyor', JSON.stringify({ phase }));
      });
      tx();
    }
    return { status: 'skipped', phase, requests: 0, seen: 0, upserted: 0, skipped: 0, note: 'lease meşgul' };
  }

  /* ---- 1) ÇEKME FAZI: (lig, gün) çiftleri; istekler arası ≥ 1 sn ---- */
  const pairResults = [];
  let requests = 0;
  for (let i = 0; i < pairs.length; i++) {
    const { comp, date } = pairs[i];
    const r = { competition: comp.slug, sport: comp.sport, date, ok: false,
                count: null, truncated: false, rateMeta: null, error: null, rawMatches: [], comp };
    try {
      const out = await fetchFixtures({ sport: comp.sport, date, competition: comp.slug,
                                       priority: opts.priority });
      requests++;
      r.rateMeta = out.rateMeta || null;
      const json = out.json || {};
      r.count = Number.isFinite(Number(json.count)) ? Number(json.count) : null;
      r.truncated = r.count !== null && r.count >= TRUNCATION_COUNT; // kural 8
      r.rawMatches = Array.isArray(json.matches) ? json.matches : [];
      r.ok = true; // count=0 dahil: geçerli "o gün maç yok" (kural 7)
    } catch (e) {
      r.error = e.message;
      r.budget = e instanceof BudgetError;
      r.circuit = e instanceof CircuitOpenError;
      // Bütçe/devre kesici redleri İSTEK ATMAZ (spend/açık devre reddi);
      // diğer hatalar (zaman aşımı, 5xx, 4xx) gerçek istek denemesidir → sayaçta tut
      if (!r.budget && !r.circuit) requests++;
    }
    pairResults.push(r);
    if (i < pairs.length - 1) await sleep(REQUEST_GAP_MS); // kural 5
  }

  /* ---- 2) YAZMA FAZI: her şey TEK transaction içinde ---- */
  const okPairs = pairResults.filter((r) => r.ok);
  const failPairs = pairResults.filter((r) => !r.ok);

  const runMeta = {
    phase,
    scope: { pairs: pairs.length },
    droppedPairs,
    pairs: pairResults.map(({ competition, date, count, ok, error }) =>
      ({ competition, date, count, ok, ...(error ? { error: String(error).slice(0, 200) } : {}) })),
    truncated: pairResults.filter((r) => r.truncated)
      .map((r) => ({ competition: r.competition, date: r.date, count: r.count })),
    apiNameMismatch: [],   // kural 2: yanıt adı ≠ competitions.api_name (uyarı; veri istenen lige bağlanır)
    duplicates: [],        // kural 5
    statusRollbacks: [],   // kural 3.2
    scoreDropsPending: [],// kural 3.3
    scoreDropsConfirmed: [],
    frozenSkipped: [],     // kural 10 (Aşama 5): ≥24 saat önce biten kayıt donmuş
    feedMissingMarked: [], // kural 6
    invalidRecords: [],
    rateHeaders: pairResults.filter((r) => r.rateMeta)
      .slice(0, 10).map((r) => ({ competition: r.competition, date: r.date, ...r.rateMeta }))
  };

  let seen = 0, upserted = 0, skipped = 0, invalid = 0;

  try {
    const tx = db.transaction(() => {
      const teamCache = new Map();       // nameKey → teams.id (bu koşu için)
      const knownTeams = new Set();     // bu koşuda tabloda VAR SAYDIĞIMIZ nameKey'ler
      const unmappedAll = [];            // normalize'dan + yeni takım adlarından

      /* (a) takım adı: tabloda YOKSA unmapped_values('team_name') (Aşama 2 kuralı:
             yalnız YENİ ad kaydı düşer), sonra upsert */
      const teamIdOf = (t, sport) => {
        if (!t || !t.nameKey) return null;
        if (teamCache.has(t.nameKey)) return teamCache.get(t.nameKey);
        const exists = db.prepare(
          "SELECT id FROM teams WHERE provider = 'sportscore' AND external_id = ?"
        ).get(t.nameKey);
        if (!exists && !knownTeams.has(t.nameKey)) {
          unmappedAll.push({ kind: 'team_name', rawValue: t.name, sport });
          knownTeams.add(t.nameKey);
        }
        upsertTeam.run(t.nameKey, sport, t.name, t.logoUrl, nowIso());
        const row = db.prepare(
          'SELECT id FROM teams WHERE provider = ? AND external_id = ?'
        ).get('sportscore', t.nameKey);
        teamCache.set(t.nameKey, row.id);
        return row.id;
      };

      for (const r of okPairs) {
        const compRow = r.comp;
        const seenIdsThisPair = new Set();
        const returnedIdsThisPair = new Set(); // GEÇERLİ normalize edilenler (feed_missing karşılaştırması)

        for (const raw of r.rawMatches) {
          /* kural 2: yanıt adı ↔ api_name karşılaştırması (farklıysa uyarı; veri yine
             İSTENEN LİGİN kaydına bağlanır) */
          const respName = String(raw && raw.competition ? raw.competition : '').trim();
          if (respName && respName !== String(compRow.api_name || compRow.name)) {
            runMeta.apiNameMismatch.push({ competition: r.competition, date: r.date,
              expected: compRow.api_name || compRow.name, got: respName });
          }

          const norm = normalizeListMatch(raw, compRow.sport, { id: compRow.id, name: compRow.name });
          if (!norm.ok) {
            invalid++;
            if (runMeta.invalidRecords.length < 20) {
              runMeta.invalidRecords.push({ competition: r.competition, date: r.date,
                errors: norm.errors.slice(0, 3) });
            }
            continue;
          }
          if (norm.unmapped.length) {
            unmappedAll.push(...norm.unmapped.map((u) => ({ ...u, sport: compRow.sport })));
          }

          /* kural 5: aynı yanıtta aynı external_id → ilki alınır */
          if (seenIdsThisPair.has(norm.value.externalId)) {
            skipped++;
            if (runMeta.duplicates.length < 20) {
              runMeta.duplicates.push({ competition: r.competition, date: r.date,
                externalId: norm.value.externalId });
            }
            continue;
          }
          seenIdsThisPair.add(norm.value.externalId);
          returnedIdsThisPair.add(norm.value.externalId);
          seen++;

          const m = norm.value;
          const hid = teamIdOf(m.home, m.sport);
          const aid = teamIdOf(m.away, m.sport);

          const existing = selectMatch.get('sportscore', m.externalId);
          if (!existing) {
            const finAt = shouldSetFinishedAt(null, m.status) ? nowIso() : null; // kural 9 (ilk görünüş)
            insertMatch.run(
              m.externalId, m.sport, m.competitionId, hid, aid,
              m.kickoffUtc, m.status, m.statusRaw, m.period,
              m.homeScore, m.awayScore,
              m.urlPath,
              finAt, nowIso(), nowIso(), nowIso()
            );
            upserted++;
            continue;
          }

          /* kural 10 (Aşama 5): finished + finished_at ≥ 24 saat → kayıt DONMUŞ.

           * Durum geri dönüşü/skor değişimi dahil hiçbir alan güncellenmez. */
          if (isFrozen(existing, Date.now())) {
            skipped++;
            if (runMeta.frozenSkipped.length < MAX_META_LIST) {
              runMeta.frozenSkipped.push({ externalId: m.externalId,
                status: existing.status, finishedAt: existing.finished_at });
            }
            continue;
          }

          /* kural 3.2: durum geriye dönüşü → log + atla (karar: matchGuard) */
          if (isStatusRollback(existing.status, m.status)) {
            skipped++;
            if (runMeta.statusRollbacks.length < MAX_META_LIST) {
              runMeta.statusRollbacks.push({ externalId: m.externalId,
                from: existing.status, to: m.status });
            }
            continue;
          }

          /* kural 3.3: skor düşüşü → ardışık İKİ yanıtta aynı düşük değer gerekir
           * (karar: matchGuard.checkScoreDrop; hafıza iki iş arasında PAYLAŞILIR) */
          const drop = checkScoreDrop(pendingDrop, m.externalId,
            { home: m.homeScore, away: m.awayScore },
            { home: existing.home_score, away: existing.away_score });
          if (!drop.proceed) {
            skipped++;
            if (runMeta.scoreDropsPending.length < MAX_META_LIST) {
              runMeta.scoreDropsPending.push({ externalId: m.externalId,
                home: m.homeScore, away: m.awayScore,
                had: { home: existing.home_score, away: existing.away_score } });
            }
            continue; // düşüş bu turda KABUL EDİLMEZ
          }
          if (drop.confirmed && runMeta.scoreDropsConfirmed.length < MAX_META_LIST) {
            runMeta.scoreDropsConfirmed.push({ externalId: m.externalId,
              home: m.homeScore, away: m.awayScore });
          }
          /* kural 3.1 (NULL ezmez) + 3.4 (ertelenen kickoff güncellenir) +
             kural 9 (finished_at ilk geçişte; karar: matchGuard) +
             kural 6 (dönen maç: bayrak sıfır) */
          const finAt = shouldSetFinishedAt(existing, m.status) ? nowIso() : null;
          updateMatch.run(
            m.competitionId, hid, aid, m.kickoffUtc,
            m.status, m.statusRaw,
            m.status, m.period,
            m.homeScore, m.homeScore, m.awayScore, m.awayScore,
            m.urlPath,
            finAt, nowIso(), nowIso(), existing.id
          );
          upserted++;
        }

        /* kural 6: feed_missing — bu başarılı (lig, gün) senkronu için;
           dönmeyen scheduled maçlar streak alır, streak>=2 → feed_missing=1 */
        for (const row of scheduledOfPair.all(compRow.id, r.date)) {
          if (!returnedIdsThisPair.has(row.external_id)) {
            const streak = row.miss_streak + 1;
            if (streak >= 2) {
              markFeedMissing.run(row.id);
              if (runMeta.feedMissingMarked.length < 20) {
                runMeta.feedMissingMarked.push(row.external_id);
              }
            } else {
              bumpMissStreak.run(row.id);
            }
          }
        }
      }

      /* unmapped_values (kural 2: yazma aynı transaction'da; iç içe tx → savepoint) */
      if (unmappedAll.length) recordUnmapped(unmappedAll);

      /* sync_runs satırı (kural 5: her çalıştırma yazılır) */
      const status = failPairs.length === 0 ? 'success' : (okPairs.length ? 'partial' : 'failed');
      const firstErr = failPairs.length ? String(failPairs[0].error).slice(0, 300) : null;
      insertSyncRun.run(
        jobName, startedAt, nowIso(), status,
        requests, seen, upserted, skipped + invalid,
        firstErr, JSON.stringify(runMeta)
      );
      if (status === 'failed') updateSyncStateFail.run(firstErr, jobName);
      else updateSyncStateOk.run(status === 'success' ? nowIso() : null, jobName);
    });
    tx();
  } catch (e) {
    /* Yazma fazında beklenmeyen hata → kiranın düzgün bırakılması + failed kaydı */
    try {
      const tx = db.transaction(() => {
        syncRunFailed.run(jobName, startedAt, nowIso(), requests, seen + skipped + invalid,
          String(e.message).slice(0, 300), JSON.stringify({ phase, note: 'yazma fazı hatası' }));
        updateSyncStateFail.run(String(e.message).slice(0, 300), jobName);
      });
      tx();
    } catch { /* son çare log */ }
    releaseLease(jobName);
    throw e;
  }

  releaseLease(jobName);

  /* AŞAMA 9: senkron turu bitti → bağlı Kâhin Sensin maçlarını denetle
   * (yalnız-DB; otomatik sonuçlandırma/düzeltme/inceleme bayrakları).
   * Hata burada senkron sonucunu BOZMAMALI. */
  try {
    const { processForecastSettlements } = require('./forecastCore');
    const fr = processForecastSettlements(db);
    if (fr.settled.length || fr.corrections.length || fr.flagged.length) {
      console.log(`🔮 [forecast] senkron sonrası: settled=${fr.settled.length} ` +
        `corrections=${fr.corrections.length} flagged=${fr.flagged.length} observed=${fr.observed}`);
    }
  } catch (e) {
    console.error(`🔮 [forecast] denetim hatası (senkron etkilenmedi): ${e.message}`);
  }

  const status = failPairs.length === 0 ? 'success' : (okPairs.length ? 'partial' : 'failed');
  return {
    status, phase, job: jobName,
    days: dates ? dates.length : undefined, competitions: comps ? comps.length : undefined,
    requests,
    seen, upserted, skipped: skipped + invalid,
    failedPairs: failPairs.length,
    droppedPairs: droppedPairs.length,
    frozen: runMeta.frozenSkipped.length,
    feedMissingMarked: runMeta.feedMissingMarked.length
  };
}

module.exports = { syncFixtures, estimateDailyRequests };
