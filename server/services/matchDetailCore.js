/**
 * Tribün — maç detayı SAF kararları (AŞAMA 8) — server/services/matchDetailCore.js
 *
 * Bu modül DB AÇMAZ (db singleton'u require etmez), ağa çıkmaz, saat okumaz
 * (now parametre olarak verilir) → node:test bellek-içi sınanabilir.
 * Yan etkili orkestrasyon (tek-uçuş, bütçe tavanı, kimlik denetimi, transaction)
 * services/matchDetail.js'tedir (standingsCore/syncStandings ayrımının aynısı).
 *
 * TTL KURALLARI (talimat):
 *  - Canlı maç (live/halftime): 60 sn TTL (SportScore önbelleği de 60 sn).
 *  - Başlamamış maç (scheduled): SportScore'a HİÇ gitme.
 *  - Bitmiş maç: ilk başarılı çekimden sonra KALICI; bitişten 30 dk sonra
 *    bir kez daha düzeltme kontrolü için çekilir.
 *  - Diğer durumlar (postponed/cancelled/suspended/abandoned/unknown):
 *    çekme yok; eski veri varsa olduğu gibi sunulur.
 *
 * SKOR KORUMASI (talimat): detay skoru yalnız listedeki (matches) değerden
 * DÜŞÜK DEĞİLSE matches'e yazılır; düşükse yalnız match_details('scoreboard')
 * içinde yaşar (liste ve detay önbellek yüzünden farklı olabilir).
 */

const LIVE_TTL_MS = 60 * 1000;        // canlı maç TTL'i (SportScore önbelleğiyle aynı)
const FINISHED_CORRECTION_MS = 30 * 60 * 1000; // bitişten 30 dk sonra düzeltme çekiği
const FETCHABLE_STATUSES = ['live', 'halftime', 'finished'];

/* ---------------- TTL kararı ---------------- */

/**
 * Detay çekme kararı.
 * @param {{status:string, finishedAt:string|null, lastFetchedAt:string|null}} m
 * @param {number} nowMs
 * @returns {{fetch:boolean, reason:string|null}}
 *   reason (fetch=false): 'not_started' | 'no_detail_for_status' | 'ttl_fresh'
 *                          | 'finished_permanent'
 *   reason (fetch=true):  'initial' | 'live_ttl' | 'finished_correction'
 */
function detailTtlDecision(m, nowMs) {
  const { status, finishedAt, lastFetchedAt } = m;

  if (!FETCHABLE_STATUSES.includes(status)) {
    return {
      fetch: false,
      reason: status === 'scheduled' ? 'not_started' : 'no_detail_for_status'
    };
  }

  if (status === 'live' || status === 'halftime') {
    if (!lastFetchedAt) return { fetch: true, reason: 'initial' };
    const age = nowMs - Date.parse(lastFetchedAt);
    if (age >= LIVE_TTL_MS) return { fetch: true, reason: 'live_ttl' };
    return { fetch: false, reason: 'ttl_fresh' };
  }

  /* finished */
  if (!lastFetchedAt) return { fetch: true, reason: 'initial' };
  if (finishedAt) {
    const correctionAt = Date.parse(finishedAt) + FINISHED_CORRECTION_MS;
    if (nowMs >= correctionAt && Date.parse(lastFetchedAt) < correctionAt) {
      return { fetch: true, reason: 'finished_correction' };
    }
  }
  return { fetch: false, reason: 'finished_permanent' };
}

/* ---------------- skor koruması ---------------- */

/**
 * Detay skorunun matches'e yazılıp yazılmayacağı (taraf başına ayrı).
 * Yazma koşulu: detay değeri null DEĞİL ve (listede değer yok ya da detay
 * listeden düşük değil). Null detay değeri listedeki değeri ASLA ezmez.
 *
 * @returns {{home:boolean, away:boolean, newHome:number|null, newAway:number|null}}
 *   newHome/newAway = matches'e yazılması gereken nihai değerler.
 */
function scoreWriteDecision(detail, current) {
  const dh = detail && typeof detail.home === 'number' ? detail.home : null;
  const da = detail && typeof detail.away === 'number' ? detail.away : null;
  const ch = current && typeof current.home === 'number' ? current.home : null;
  const ca = current && typeof current.away === 'number' ? current.away : null;
  const okH = dh !== null && (ch === null || dh >= ch);
  const okA = da !== null && (ca === null || da >= ca);
  return {
    home: okH, away: okA,
    newHome: okH ? dh : ch,
    newAway: okA ? da : ca
  };
}

/* ---------------- olay sıralama ---------------- */

/**
 * Olayları dakikaya göre KARARLI sırala (aynı dakikadakiler API sırasında
 * kalır — talimat); dakikası null olanlar en sonda yine API sırasıyla.
 */
function sortIncidents(items) {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const am = a.it && typeof a.it.minute === 'number' ? a.it.minute : Infinity;
      const bm = b.it && typeof b.it.minute === 'number' ? b.it.minute : Infinity;
      return am === bm ? a.i - b.i : am - bm;
    })
    .map((x) => x.it);
}

/* ---------------- yanıt kurulumu ---------------- */

/** match_details satırlarını (kind → payload) çözümlü biçimde döndürür */
function parseStored(rows) {
  const out = { scoreboard: null, events: null, stats: null, lineups: null,
               lastFetchedAt: null, source_updated: null };
  for (const r of rows || []) {
    let p = null;
    try { p = JSON.parse(r.payload); } catch { p = null; }
    if (!p) continue;
    out[r.kind] = p;
    if (r.fetched_at && (!out.lastFetchedAt || r.fetched_at > out.lastFetchedAt)) {
      out.lastFetchedAt = r.fetched_at;
    }
    if (r.source_updated && (!out.source_updated || r.source_updated > out.source_updated)) {
      out.source_updated = r.source_updated;
    }
  }
  return out;
}

/** Maç satırı (JOIN'li sorgu sonucu) → yanıtın match bloğu */
function buildMatchBlock(row) {
  return {
    id: row.id,
    sport: row.sport,
    competition: {
      slug: row.comp_slug,
      name: row.comp_name,
      country: row.comp_country ?? null,
      logo_url: row.comp_logo ?? null
    },
    home: {
      display_name: row.home_name ?? null,
      logo_url: row.home_logo ?? null,
      score: row.home_score ?? null
    },
    away: {
      display_name: row.away_name ?? null,
      logo_url: row.away_logo ?? null,
      score: row.away_score ?? null
    },
    status: row.status,
    period: row.period ?? null,
    minute: row.minute ?? null,
    kickoff_utc: row.kickoff_utc,
    ht_home: row.ht_home ?? null,
    ht_away: row.ht_away ?? null
  };
}

/** Bölümler: her bölüm boşsa available:false ile döner (talimat) */
function buildSections(stored) {
  const events = stored && Array.isArray(stored.events && stored.events.items)
    ? stored.events.items : [];
  const stats = stored && Array.isArray(stored.stats && stored.stats.items)
    ? stored.stats.items : [];
  const lineups = stored && stored.lineups ? stored.lineups : null;
  const hasLineups = !!(lineups
    && ((lineups.homeXi && lineups.homeXi.length) || (lineups.awayXi && lineups.awayXi.length)));

  return {
    events: { available: events.length > 0, items: events.length ? sortIncidents(events) : [] },
    stats: { available: stats.length > 0, items: stats },
    lineups: lineups
      ? {
          available: hasLineups,
          confirmed: !!lineups.confirmed,
          home_formation: lineups.homeFormation ?? null,
          away_formation: lineups.awayFormation ?? null,
          home_xi: lineups.homeXi || [],
          away_xi: lineups.awayXi || [],
          home_subs: lineups.homeSubs || [],
          away_subs: lineups.awaySubs || []
        }
      : { available: false, confirmed: false, home_formation: null, away_formation: null,
          home_xi: [], away_xi: [], home_subs: [], away_subs: [] }
  };
}

/** Tam (available) yanıt gövdesi */
function buildAvailableResponse(row, stored, { stale, staleReason }) {
  const sections = buildSections(stored);
  return {
    available: true,
    match: buildMatchBlock(row),
    sections,
    has_events: sections.events.available,
    has_stats: sections.stats.available,
    has_lineups: sections.lineups.available,
    meta: {
      fetched_at: stored ? stored.lastFetchedAt : null,
      source_updated: stored ? stored.source_updated : null,
      stale: !!stale,
      stale_reason: staleReason || null
    }
  };
}

/** available:false yanıtı (basketbol / başlamamış / veri hiç yok) */
function buildUnavailableResponse(row, reason, message) {
  return {
    available: false,
    reason,
    message,
    match: buildMatchBlock(row),
    sections: {
      events: { available: false, items: [] },
      stats: { available: false, items: [] },
      lineups: { available: false, confirmed: false, home_formation: null, away_formation: null,
        home_xi: [], away_xi: [], home_subs: [], away_subs: [] }
    },
    has_events: false,
    has_stats: false,
    has_lineups: false,
    meta: { fetched_at: null, source_updated: null, stale: false, stale_reason: null }
  };
}

/** available:false gerekçeleri → Türkçe mesaj (tek sözlük) */
const UNAVAILABLE_MESSAGES = {
  no_detail_for_sport: 'Maç detayı yalnızca futbol maçları için sağlanıyor.',
  not_started: 'Maç başlamadığı için detay verisi bulunmuyor.',
  no_detail_for_status: 'Bu maç için detay verisi sağlanmıyor.',
  no_match_slug: 'Bu maç için detay kaynağı adresi eksik; detay alınamıyor.',
  budget: 'Günlük detay çağrısı sınırına ulaşıldı; veri şu an yenilenemiyor.',
  fetch_failed: 'Detay verisi şu an alınamadı; birazdan tekrar dene.',
  identity_mismatch: 'Detay kaynağı başka bir maç döndü; veri güvenliği için kaydedilmedi.',
  invalid: 'Detay yanıtı doğrulanamadı.'
};

module.exports = {
  LIVE_TTL_MS,
  FINISHED_CORRECTION_MS,
  FETCHABLE_STATUSES,
  detailTtlDecision,
  scoreWriteDecision,
  sortIncidents,
  parseStored,
  buildMatchBlock,
  buildSections,
  buildAvailableResponse,
  buildUnavailableResponse,
  UNAVAILABLE_MESSAGES
};
