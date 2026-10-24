/**
 * Tribün — maç detayı servisi (AŞAMA 8) — server/services/matchDetail.js
 *
 * GET /api/sports/matches/:id/detail gövdesi. SportScore'a istek atabilen
 * TEK kullanıcı rotasının servis katmanıdır. Kurallar (talimat):
 *
 *  - Yalnızca futbol. Basketbol → 200 + {available:false,
 *    reason:'no_detail_for_sport'} (404 DEĞİL).
 *  - Önce match_details'e bakılır; TTL: canlı 60 sn / başlamamış HİÇ ÇEKMEZ /
 *    bitmiş ilk başarılı çekimden sonra kalıcı (+bitişten 30 dk sonra bir
 *    kez düzeltme çekiği). Kararlar matchDetailCore.detailTtlDecision'da.
 *  - TTL dolmuşsa aynı maç için eşzamanlı istekler TEK ağ çağrısında birleşir
 *    (tek-uçuş; maç id'si bazında — sportScoreClient'ın URL bazlı tek-uçuşuna
 *    ek olarak bütçe sayacını da tek tutar).
 *  - Bütçe: sportScoreClient.spend 'low' öncelik üzerinden + günlük detay
 *    çağrısı ayrı tavanı (SPORTSCORE_DETAIL_DAILY_CAP, varsayılan 1000).
 *    Tavan doluysa ya da API hatalıysa SON VERİ stale:true ile döner;
 *    hiç veri yoksa 200 + available:false + Türkçe mesaj.
 *  - Kimlik denetimi ŞART: yanıttaki tracker.id (yoksa url'deki kimlik)
 *    matches.external_id ile eşleşmezse detay KAYDEDİLMEZ ve loglanır
 *    (aynı iki takımın başka bir maçı gelmiş olabilir).
 *  - Yazma TEK transaction'da: match_details (scoreboard/events/stats/
 *    lineups) + matches.minute/ht_home/ht_away + KORUMALI skor +
 *    unmapped_values('incident_type'/'stats_label'). Ham yanıt dışarı ÇIKMAZ.
 *
 * TEST EDİLEBİLİRLİK: db bağlantısı PARAMETRE olarak alınır (sportsRead
 * deseni); fetcher/detailCap/now enjekte edilebilir → tests/matchDetail.test.js
 * bellek-içi db ile sınar (tek-uçuş, TTL, kimlik, bütçe davranışları).
 */
const { fetchMatchDetail, BudgetError, CircuitOpenError } = require('./sportScoreClient');
const { normalizeDetail, toUtcIso } = require('./matchNormalizer');
const { recordUnmapped } = require('./unmappedStore');
const {
  detailTtlDecision,
  scoreWriteDecision,
  sortIncidents,
  parseStored,
  buildAvailableResponse,
  buildUnavailableResponse,
  UNAVAILABLE_MESSAGES
} = require('./matchDetailCore');

const DEFAULT_DETAIL_CAP = Number(process.env.SPORTSCORE_DETAIL_DAILY_CAP) || 1000;
const DETAIL_ENDPOINT = '/api/widget/match/';

/* Tek-uçuş haritası: maç id'si → yürüyen promise (süreç içi) */
const inflightDetail = new Map();

const nowIso = () => new Date().toISOString();
const dayUtc = () => new Date().toISOString().slice(0, 10);

/* ---------------- DB okumaları ---------------- */

const MATCH_ROW_SQL = `
  SELECT m.id, m.external_id, m.sport, m.status, m.period, m.minute,
         m.home_score, m.away_score, m.kickoff_utc, m.finished_at,
         m.match_slug, m.ht_home, m.ht_away, m.updated_at,
         c.slug AS comp_slug, c.name AS comp_name, c.country AS comp_country,
         c.logo_url AS comp_logo,
         th.name AS home_name, th.logo_url AS home_logo,
         ta.name AS away_name, ta.logo_url AS away_logo
    FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    LEFT JOIN teams th ON th.id = m.home_team_id
    LEFT JOIN teams ta ON ta.id = m.away_team_id
   WHERE m.feed_missing = 0 AND m.id = ?
   LIMIT 1`;

function loadMatchRow(db, id) {
  return db.prepare(MATCH_ROW_SQL).get(id);
}

function loadStored(db, matchId) {
  const rows = db.prepare(
    'SELECT kind, payload, fetched_at, source_updated FROM match_details WHERE match_id = ?'
  ).all(matchId);
  return parseStored(rows);
}

/** Bugünün (UTC gün) detay çağrı sayısı — api_usage'tan */
function detailCallsToday(db) {
  const r = db.prepare(
    "SELECT COALESCE(SUM(count), 0) AS c FROM api_usage WHERE day_utc = ? AND endpoint = ?"
  ).get(dayUtc(), DETAIL_ENDPOINT);
  return r ? r.c : 0;
}

/* ---------------- çekme + kaydetme (tek-uçuşlu) ---------------- */

/**
 * Kimlik denetimi: tracker.id (birincil) ya da url'den çıkan kimlik
 * matches.external_id ile eşleşmeli.
 * @returns {{ok:true} | {ok:false, code:string, message:string}}
 */
function verifyIdentity(payloadJson, externalId) {
  const m = payloadJson && payloadJson.match;
  if (!m || typeof m !== 'object') {
    return { ok: false, code: 'invalid', message: UNAVAILABLE_MESSAGES.invalid };
  }
  const want = String(externalId);
  const trackerId = m.tracker && m.tracker.id != null ? String(m.tracker.id) : null;
  if (trackerId !== null) {
    if (trackerId !== want) {
      return { ok: false, code: 'identity_mismatch', message: UNAVAILABLE_MESSAGES.identity_mismatch };
    }
    return { ok: true };
  }
  /* tracker yoksa: url'deki kimlik şart */
  const norm = normalizeDetail(m, 'football');
  if (!norm.ok || !norm.value.externalId) {
    return { ok: false, code: 'invalid', message: UNAVAILABLE_MESSAGES.invalid };
  }
  if (String(norm.value.externalId) !== want) {
    return { ok: false, code: 'identity_mismatch', message: UNAVAILABLE_MESSAGES.identity_mismatch };
  }
  return { ok: true };
}

/**
 * Tek bir maç için detay çek + (kimlik geçerse) TEK transaction'da yaz.
 * Aynı maç için eşzamanlı çağrılar bu fonksiyonun TEK yürütülmesinde birleşir.
 * @returns {Promise<{ok:true, fetchedAt:string} |
 *                   {ok:false, code:string, message:string}>}
 */
async function fetchAndStoreDetail(db, row, opts) {
  const key = row.id;
  if (inflightDetail.has(key)) return inflightDetail.get(key);

  const job = (async () => {
    /* günlük detay tavanı (talimat: 1.000) */
    const cap = opts.detailCap != null ? opts.detailCap : DEFAULT_DETAIL_CAP;
    const used = detailCallsToday(db);
    if (used >= cap) {
      return { ok: false, code: 'budget', message: UNAVAILABLE_MESSAGES.budget };
    }

    /* SportScore widget detayı — DÜŞÜK öncelik (bütçe %70+'ta istek atılmaz) */
    let payload;
    const fetcher = opts.fetcher || fetchMatchDetail;
    try {
      payload = await fetcher({ sport: 'football', matchSlug: row.match_slug });
    } catch (e) {
      if (e instanceof BudgetError || e instanceof CircuitOpenError) {
        return { ok: false, code: 'budget', message: String(e.message).slice(0, 160) };
      }
      return { ok: false, code: 'fetch_failed', message: String(e.message || 'istek başarısız').slice(0, 160) };
    }

    const json = payload && payload.json;
    const idCheck = verifyIdentity(json, row.external_id);
    if (!idCheck.ok) {
      console.error(
        `[maç detayı] kimlik uyuşmazlığı: maç #${row.id} (external_id=${row.external_id});` +
        ` detay KAYDEDİLMEDİ — ${idCheck.code}`
      );
      return idCheck;
    }

    const norm = normalizeDetail(json.match, 'football');
    if (!norm.ok) {
      return { ok: false, code: 'invalid', message: UNAVAILABLE_MESSAGES.invalid };
    }
    const v = norm.value;

    /* API'nin updated değeri (yanıtın tepesinde) → source_updated */
    const sourceUpdated = toUtcIso(json.updated) || null;
    /* testler için enjekte edilebilir saat; üretimde gerçek zaman */
    const stamp = new Date(opts.now != null ? opts.now : Date.now()).toISOString();
    const sorted = sortIncidents(v.incidents);

    /* skor koruması: detay yalnız listeden düşük değilse matches'e yazılır */
    const guard = scoreWriteDecision(
      { home: v.homeScore, away: v.awayScore },
      { home: row.home_score, away: row.away_score }
    );

    /* TEK transaction: tüm match_details satırları + matches güncellemesi +
     * unmapped_values. Başarısızlıkta hiçbiri yazılmaz (eski veri korunur). */
    const write = db.transaction(() => {
      const upsert = db.prepare(`
        INSERT INTO match_details (match_id, kind, payload, schema_version, fetched_at, source_updated)
        VALUES (?, ?, ?, 2, ?, ?)
        ON CONFLICT(match_id, kind) DO UPDATE SET
          payload = excluded.payload,
          schema_version = excluded.schema_version,
          fetched_at = excluded.fetched_at,
          source_updated = excluded.source_updated
      `);

      upsert.run(row.id, 'scoreboard', JSON.stringify({
        status: v.status,
        status_raw: v.statusRaw,
        period: v.period,
        live_minute: v.liveMinute,
        home_score: v.homeScore,
        away_score: v.awayScore,
        ht_home: v.homeHtScore,
        ht_away: v.awayHtScore,
        kickoff_utc: v.kickoffUtc,
        url_path: v.urlPath
      }), stamp, sourceUpdated);

      upsert.run(row.id, 'events', JSON.stringify({ items: sorted }), stamp, sourceUpdated);
      upsert.run(row.id, 'stats', JSON.stringify({ items: v.stats }), stamp, sourceUpdated);
      if (v.lineups) {
        upsert.run(row.id, 'lineups', JSON.stringify(v.lineups), stamp, sourceUpdated);
      }

      /* matches: dakika + devre skoru + KORUMALI skor (duruma DOKUNULMAZ —
       * durum geçişleri fikstür/canlı işinin korumalarıyla yönetilir) */
      db.prepare(`
        UPDATE matches
           SET minute = ?, ht_home = ?, ht_away = ?,
               home_score = ?, away_score = ?, updated_at = ?
         WHERE id = ?
      `).run(
        v.liveMinute,
        v.homeHtScore,
        v.awayHtScore,
        guard.newHome,
        guard.newAway,
        stamp,
        row.id
      );

      /* bilinmeyen olay türleri / istatistik etiketleri → unmapped_values
       * (sport MADDE içinde taşınır: UNIQUE(kind, raw_value, sport) NULL'ları
       * farklı sayar → spor verilmezse aynı değer ikinci kez satır açar) */
      if (norm.unmapped.length) {
        recordUnmapped(norm.unmapped.map((u) => ({ ...u, sport: 'football' })), 'football', db);
      }
    });
    write();

    return { ok: true, fetchedAt: stamp };
  })();

  inflightDetail.set(key, job);
  try {
    return await job;
  } finally {
    inflightDetail.delete(key);
  }
}

/* ---------------- uç nokta gövdesi ---------------- */

/**
 * GET /api/sports/matches/:id/detail
 * @param {object} db better-sqlite3 bağlantısı (rota: singleton; test: bellek-içi)
 * @param {string|number} id
 * @param {{fetcher?:Function, detailCap?:number, now?:number}} [opts]
 * @returns {Promise<{ok:true, value:object}|{ok:false, status:number, error:string}>}
 */
async function getMatchDetail(db, id, opts = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, status: 400, error: 'Maç id pozitif bir tam sayı olmalı.' };
  }
  let row = loadMatchRow(db, n);
  if (!row) return { ok: false, status: 404, error: 'Maç bulunamadı.' };

  /* basketbol: 404 DEĞİL — available:false + reason (talimat) */
  if (row.sport !== 'football') {
    return {
      ok: true,
      value: buildUnavailableResponse(row, 'no_detail_for_sport',
        UNAVAILABLE_MESSAGES.no_detail_for_sport)
    };
  }

  let stored = loadStored(db, n);
  const nowMs = opts.now != null ? opts.now : Date.now();
  const decision = detailTtlDecision(
    { status: row.status, finishedAt: row.finished_at, lastFetchedAt: stored.lastFetchedAt },
    nowMs
  );

  let staleReason = null;
  if (decision.fetch) {
    if (!row.match_slug) {
      /* url_path yoksa kaynak adresi bilinmiyor → çekme yapılamaz */
      staleReason = 'no_match_slug';
    } else {
      const r = await fetchAndStoreDetail(db, row, opts);
      if (r.ok) {
        /* yazma sonrası satır TAZEDEN okunur: dakika/İY/skor yanıta
         * güncel değerlerle girsin (ilk çekimde row öncesi kalıyordu) */
        row = loadMatchRow(db, n);
        stored = loadStored(db, n);
      } else {
        staleReason = r.code;
      }
    }
  }

  /* veri hiç yok → 200 + available:false + Türkçe mesaj (talimat) */
  if (!stored.lastFetchedAt) {
    const reason = staleReason || decision.reason;
    const message = UNAVAILABLE_MESSAGES[reason] || UNAVAILABLE_MESSAGES.no_detail_for_status;
    return { ok: true, value: buildUnavailableResponse(row, reason, message) };
  }

  /* veri var: yenileme başarısızsa stale:true ile SON VERİ döner (talimat) */
  return {
    ok: true,
    value: buildAvailableResponse(row, stored, {
      stale: !!staleReason,
      staleReason
    })
  };
}

module.exports = {
  getMatchDetail,
  detailCallsToday,
  DETAIL_ENDPOINT,
  DEFAULT_DETAIL_CAP,
  _internal: { fetchAndStoreDetail, verifyIdentity }
};
