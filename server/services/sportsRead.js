/**
 * Tribün — spor okuma servisi (AŞAMA 4)
 *
 * Bu modül HİÇBİR KOŞULDA SportScore'a istek atmaz; yalnızca SQLite'tan okur.
 * (Uç noktalar: GET /api/sports/matches, /matches/:id, /competitions, /live)
 *
 * ZAMAN DÜZENİ (talimat): date, Europe/Istanbul TAKVİM GÜNÜ olarak yorumlanır
 * (00:00-24:00 TR saati). UTC sınırları Intl.DateTimeFormat ile IANA saat
 * diliminden hesaplanır — sabit +3 YAZILMAZ (DST/yasal saat değişikliklerine
 * karşı dayanıklı). TR'deki 00:00-02:59 arası maçlar (UTC 21:00-23:59+önceki
 * gün) doğru TR gününe düşer.
 *
 * STALE KURALI:
 *  - Fikstür senkronu 6 saatten eski → stale=true ('fixture_sync_old')
 *  - O gün canlı maç VARSA ve canlı senkron 5 dakikadan eski → stale=true
 *    ('live_sync_old')
 *  - Senkron hiç çalışmadıysa → stale=true ('no_data')  (yanıt yine 200'dür)
 *
 * AŞAMA 5: "canlı senkron" = live_scores İŞİNİN (job_name='live_scores')
 * gerçek senkrondur — success/partial satırları. Boşta kontrolleri
 * (status='skipped', istek 0) ve Aşama 3'ün 3 saatlik canlı-pencere
 * fikstür koşuları last_live_sync_at'I DEĞİŞTİRMEZ: alan GERÇEK canlı
 * senkron zamanını yansıtır.
 *
 * SKOR: NULL → null döner (asla 0 yazılmaz); alan her zaman sayı veya null.
 * feed_missing=1 olan maçlar ASLA dönmez (silinmez, yalnızca gizlenir).
 *
 * NOT: Bu modül kendi başına DB AÇMAZ (db singleton'ı require etmez):
 * tüm fonksiyonlar ilk parametre olarak better-sqlite3 bağlantısı alır —
 * rota gerçek db'yi, testler bellek-içi db'yi geçirir.
 */

const TIME_ZONE = 'Europe/Istanbul';
const SPORTS = ['football', 'basketball'];
const STATUSES = ['scheduled', 'live', 'halftime', 'finished',
  'postponed', 'cancelled', 'suspended', 'abandoned', 'unknown'];
const LIVE_STATUSES = ['live', 'halftime'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* Türkçe insan-okur metni (maç.status_raw sağlayıcı numaralandırması; metin
 * saklanmadığı için okuma katmanında statüden üretilir). */
const STATUS_TEXT_TR = {
  scheduled: 'Başlamadı',
  live: 'Canlı',
  halftime: 'Devre arası',
  finished: 'Bitti',
  postponed: 'Ertelendi',
  cancelled: 'İptal edildi',
  suspended: 'Askıya alındı',
  abandoned: 'Terk edildi',
  unknown: 'Bilinmiyor'
};

/* ---------------- Intl tabanlı zaman düzeni ---------------- */

/** Verilen UTC anında saat diliminin ofseti (ms) — UTC + ofset = yerel duvar saati */
function tzOffsetMs(utcMs, timeZone = TIME_ZONE) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t) => Number((parts.find((p) => p.type === t) || {}).value);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'));
  return asUTC - utcMs;
}

/** Yerel "naive" ms değerinden gerçek UTC anı (iki geçişle DST güvenliği) */
function localWallToUtcMs(naiveMs, timeZone) {
  let guess = naiveMs - tzOffsetMs(naiveMs, timeZone);
  guess = naiveMs - tzOffsetMs(guess, timeZone); // ikinci geçiş: DST sınırı denk gelirse
  return guess;
}

/**
 * Yerel takvim gününün UTC sınırları: [start, end)
 * @returns {{startIso:string, endIso:string}} — kickoff_utc ile dizgi karşılaştırmasına uygun
 */
function localDayUtcRange(dateStr, timeZone = TIME_ZONE) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayStartNaive = Date.UTC(y, m - 1, d, 0, 0, 0);
  const nextDayNaive = dayStartNaive + 86400000;
  return {
    startIso: new Date(localWallToUtcMs(dayStartNaive, timeZone)).toISOString(),
    endIso: new Date(localWallToUtcMs(nextDayNaive, timeZone)).toISOString()
  };
}

/** Türkiye'deki bugünün takvim günü (YYYY-MM-DD) */
function trToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

/** Gerçek takvim günü mü? (regex + Date gidiş-dönüşü) */
function isValidDate(s) {
  if (!DATE_RE.test(String(s || ''))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/* ---------------- doğrulama (beyaz liste) ---------------- */

/**
 * GET /api/sports/matches sorgu parametrelerini doğrular.
 * @returns {{ok:true, value:{date:string, sport:string|null, competition:string|null,
 *            status:string|null}} | {ok:false, error:string}}
 */
function validateListParams(query) {
  const q = query || {};
  const date = q.date === undefined || q.date === '' ? trToday() : String(q.date);
  if (!isValidDate(date)) {
    return { ok: false, error: 'date YYYY-MM-DD biçiminde gerçek bir takvim günü olmalı (örn. 2026-10-24).' };
  }
  if (q.sport !== undefined && q.sport !== '') {
    const s = String(q.sport).toLowerCase();
    if (!SPORTS.includes(s)) {
      return { ok: false, error: 'sport yalnız "football" ya da "basketball" olabilir.' };
    }
  }
  if (q.status !== undefined && q.status !== '') {
    const st = String(q.status).toLowerCase();
    if (!STATUSES.includes(st)) {
      return { ok: false, error: `status şu değerlerden biri olmalı: ${STATUSES.join(', ')}.` };
    }
  }
  return {
    ok: true,
    value: {
      date,
      sport: q.sport ? String(q.sport).toLowerCase() : null,
      competition: q.competition ? String(q.competition) : null,
      status: q.status ? String(q.status).toLowerCase() : null
    }
  };
}

/* ---------------- yardımcılar ---------------- */

/** Lig adı slah doğrulaması (db'de var mı?) — hata mesajı Türkçe */
function validateCompetitionSlug(db, slug) {
  const row = db.prepare('SELECT id, is_enabled FROM competitions WHERE slug = ?').get(slug);
  if (!row) return { ok: false, error: `Böyle bir lig yok: ${slug}` };
  return { ok: true };
}

/** Maç satırı → API alanları (skor: sayı veya null; asla 0 yazılmaz) */
function buildMatch(row) {
  return {
    id: row.id,
    sport: row.sport,
    competition: {
      id: row.competition_id,
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
    minute: row.minute ?? null, // genelde null; yalnızca detaydan bilinirse (Aşama 8)
    status_text: STATUS_TEXT_TR[row.status] || 'Bilinmiyor',
    kickoff_utc: row.kickoff_utc,
    has_detail: row.sport === 'football' && (row.status === 'live' || row.status === 'finished'),
    updated_at: row.updated_at
  };
}

/** Satırları lige göre grupla; gruplar sort_order, maçlar kickoff sırasıyla */
function groupRows(rows) {
  const groups = [];
  let cur = null;
  for (const row of rows) { // sorgu zaten sıralı geliyor
    if (!cur || cur.competition.id !== row.competition_id) {
      cur = {
        competition: {
          id: row.competition_id,
          slug: row.comp_slug,
          name: row.comp_name,
          country: row.comp_country ?? null,
          logo_url: row.comp_logo ?? null
        },
        matches: []
      };
      groups.push(cur);
    }
    cur.matches.push(buildMatch(row));
  }
  return groups;
}

/** Ortak sorgu: beyaz liste dışına çıkmayan, tümü parametreli SQL */
const MATCH_SELECT = `
  SELECT m.id, m.sport, m.competition_id, m.status, m.period, m.minute,
         m.home_score, m.away_score, m.kickoff_utc, m.updated_at,
         c.slug AS comp_slug, c.name AS comp_name, c.country AS comp_country,
         c.logo_url AS comp_logo, c.sort_order AS comp_sort,
         th.name AS home_name, th.logo_url AS home_logo,
         ta.name AS away_name, ta.logo_url AS away_logo
    FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    LEFT JOIN teams th ON th.id = m.home_team_id
    LEFT JOIN teams ta ON ta.id = m.away_team_id
   WHERE m.feed_missing = 0`;

function queryMatches(db, { rangeStart, rangeEnd, sport, competition, statuses }) {
  const where = [];
  const args = [];
  if (rangeStart && rangeEnd) {
    where.push('m.kickoff_utc >= ?');
    where.push('m.kickoff_utc < ?');
    args.push(rangeStart, rangeEnd);
  }
  if (sport) { where.push('m.sport = ?'); args.push(sport); }
  if (competition) { where.push('c.slug = ?'); args.push(competition); }
  if (statuses && statuses.length) {
    where.push(`m.status IN (${statuses.map(() => '?').join(', ')})`);
    args.push(...statuses);
  }
  const sql = `${MATCH_SELECT}${where.length ? ' AND ' + where.join(' AND ') : ''}
   ORDER BY c.sort_order ASC, m.kickoff_utc ASC, m.id ASC`;
  return db.prepare(sql).all(...args);
}

/* ---------------- meta + stale ---------------- */

/**
 * meta bloğu. last_fixture_sync_at: son başarılı/kısmi koşu (herhangi bir iş).
 * last_live_sync_at (AŞAMA 5): live_scores İŞİNİN son success/partial turu —
 * boşta kontrolleri ('skipped', istek 0) sayılmaz → alan GERÇEK canlı senkron
 * zamanını yansıtır. stale kuralları dosya başlığında.
 */
function buildMeta(db, { date, liveCount }) {
  const lastFixture = db.prepare(
    "SELECT finished_at FROM sync_runs WHERE status IN ('success','partial') ORDER BY id DESC LIMIT 1"
  ).get();
  const lastLive = db.prepare(
    `SELECT finished_at FROM sync_runs
      WHERE job_name = 'live_scores' AND status IN ('success','partial')
      ORDER BY id DESC LIMIT 1`
  ).get();

  const lastFixtureAt = lastFixture ? lastFixture.finished_at : null;
  const lastLiveAt = lastLive ? lastLive.finished_at : null;
  const now = Date.now();

  let stale = false;
  let stale_reason = null;
  if (!lastFixtureAt) {
    stale = true; stale_reason = 'no_data';
  } else if (now - Date.parse(lastFixtureAt) > 6 * 3600 * 1000) {
    stale = true; stale_reason = 'fixture_sync_old';
  } else if (liveCount > 0
      && (!lastLiveAt || now - Date.parse(lastLiveAt) > 5 * 60 * 1000)) {
    stale = true; stale_reason = 'live_sync_old';
  }

  return {
    date,
    timezone: TIME_ZONE,
    last_fixture_sync_at: lastFixtureAt,
    last_live_sync_at: lastLiveAt,
    stale,
    stale_reason,
    live_count: liveCount
  };
}

/* ---------------- uç nokta gövdeleri ---------------- */

/**
 * GET /api/sports/matches — TR takvim gününe göre lige gruplu maç listesi.
 * @param {object} db better-sqlite3 (test edilebilirlik için parametre)
 * @param {{date?:string, sport?:string, competition?:string, status?:string}} params
 */
function listMatches(db, params = {}) {
  const v = validateListParams(params);
  if (!v.ok) return v;
  const p = v.value;
  if (p.competition) {
    const c = validateCompetitionSlug(db, p.competition);
    if (!c.ok) return c;
  }

  const range = localDayUtcRange(p.date);
  const rows = queryMatches(db, {
    rangeStart: range.startIso,
    rangeEnd: range.endIso,
    sport: p.sport,
    competition: p.competition,
    statuses: p.status ? [p.status] : null
  });

  const liveCount = rows.filter((r) => LIVE_STATUSES.includes(r.status)).length;
  return { ok: true, value: { groups: groupRows(rows), meta: buildMeta(db, { date: p.date, liveCount }) } };
}

/** GET /api/sports/matches/:id — temel bilgiler (detay Aşama 8'de).
 *  MATCH_SELECT feed_missing=0 süzer → gizli maç id'si 404 döner. */
function getMatchById(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, status: 400, error: 'Maç id pozitif bir tam sayı olmalı.' };
  }
  const row = db.prepare(`${MATCH_SELECT} AND m.id = ? LIMIT 1`).get(n);
  if (!row) return { ok: false, status: 404, error: 'Maç bulunamadı.' };
  return { ok: true, value: buildMatch(row) };
}

/** GET /api/sports/competitions — is_enabled=1, sort_order sırasıyla */
function listCompetitions(db) {
  const rows = db.prepare(
    `SELECT id, slug, name, sport, country, logo_url
       FROM competitions WHERE is_enabled = 1 ORDER BY sort_order ASC`
  ).all();
  return { ok: true, value: { competitions: rows } };
}

/** GET /api/sports/live — şu an live/halftime olan maçlar */
function listLive(db) {
  const rows = queryMatches(db, { statuses: LIVE_STATUSES });
  const liveCount = rows.length;
  return {
    ok: true,
    value: { groups: groupRows(rows), meta: buildMeta(db, { date: trToday(), liveCount }) }
  };
}

/* ---------------- AŞAMA 7: puan durumu + lig detayı ---------------- */

/*
 * Kolon modeli: standings satırları sabit kolonlarda saklanır; sağlayıcıda
 * OLMAYAN kolon null kalır. Okuma ucunda "kolon var mı?" kararı = o ligin
 * satırlarında EN AZ BİR null olmayan değer var mı (spec: yanıtta olmayan
 * sütunu gösterme). Kolon sırası canonical'dır; istemci etiketi kendinde tutar.
 */
const STANDINGS_COLUMN_KEYS = [
  'played', 'won', 'drawn', 'lost',
  'goals_for', 'goals_against', 'goal_diff', 'points', 'win_pct'
];
const STANDINGS_STALE_MS = 12 * 3600 * 1000; // taban tur 8 saat; 12 saat = 1+ tur kaçmış

const standingsRowSelect = `
  SELECT group_name, position, team_id, team_name, team_logo,
         played, won, drawn, lost, goals_for, goals_against, goal_diff,
         points, win_pct, promo_color, promo_name, updated_at
    FROM standings
   WHERE competition_id = ?
   ORDER BY id
`;

/**
 * GET /api/sports/competitions/:slug/standings — gruplu puan durumu.
 * Lig bulunamazsa 404; veri hiç senkronlanmadıysa 200 + groups:[] + stale.
 * Grup sırası = sağlayıcı sırası (id = yazım sırası); satırlar position ile.
 */
function getStandings(db, slug) {
  const comp = db.prepare(
    'SELECT id, slug, name, sport, country, logo_url, is_enabled FROM competitions WHERE slug = ?'
  ).get(slug);
  if (!comp) return { ok: false, status: 404, error: `Böyle bir lig yok: ${slug}` };
  if (!comp.is_enabled) return { ok: false, status: 404, error: `Lig kapalı: ${slug}` };

  const rows = db.prepare(standingsRowSelect).all(comp.id);

  /* gruplar ilk görülme sırasıyla (sağlayıcı düzeni korunur) */
  const groupIndex = new Map();
  const groups = [];
  const columnSeen = Object.fromEntries(STANDINGS_COLUMN_KEYS.map((k) => [k, false]));
  for (const r of rows) {
    if (!groupIndex.has(r.group_name)) {
      groupIndex.set(r.group_name, groups.length);
      groups.push({ group: r.group_name, rows: [] });
    }
    for (const k of STANDINGS_COLUMN_KEYS) {
      if (r[k] !== null && r[k] !== undefined) columnSeen[k] = true;
    }
    groups[groupIndex.get(r.group_name)].rows.push({
      position: r.position,
      team_id: r.team_id ?? null,
      team_name: r.team_name,
      team_logo: r.team_logo ?? null,
      played: r.played ?? null,
      won: r.won ?? null,
      drawn: r.drawn ?? null,
      lost: r.lost ?? null,
      goals_for: r.goals_for ?? null,
      goals_against: r.goals_against ?? null,
      goal_diff: r.goal_diff ?? null,
      points: r.points ?? null,
      win_pct: r.win_pct ?? null,
      promo_color: r.promo_color || '',
      promo_name: r.promo_name || ''
    });
  }

  const updatedAt = rows.length
    ? rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), rows[0].updated_at)
    : null;

  let stale = true;
  let stale_reason = 'no_data';
  if (updatedAt) {
    const ageMs = Date.now() - Date.parse(updatedAt);
    if (ageMs > STANDINGS_STALE_MS) { stale = true; stale_reason = 'standings_old'; }
    else { stale = false; stale_reason = null; }
  }

  return {
    ok: true,
    value: {
      competition: {
        id: comp.id, slug: comp.slug, name: comp.name,
        sport: comp.sport, country: comp.country ?? null, logo_url: comp.logo_url ?? null
      },
      groups,
      columns: STANDINGS_COLUMN_KEYS.filter((k) => columnSeen[k]),
      meta: { updated_at: updatedAt, stale, stale_reason }
    }
  };
}

/**
 * GET /api/sports/competitions/:slug — lig bilgisi + bugünkü ve yaklaşan
 * maçları (yalnızca DB; yaklaşan = TR yarınından itibaren 9 gün).
 */
function getCompetitionBySlug(db, slug) {
  const comp = db.prepare(
    'SELECT id, slug, name, sport, country, logo_url, is_enabled FROM competitions WHERE slug = ?'
  ).get(slug);
  if (!comp) return { ok: false, status: 404, error: `Böyle bir lig yok: ${slug}` };
  if (!comp.is_enabled) return { ok: false, status: 404, error: `Lig kapalı: ${slug}` };

  const today = trToday();
  const todayRange = localDayUtcRange(today);
  const [y, m, d] = today.split('-').map(Number);
  const tomorrowStartNaive = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  const upcomingRange = {
    startIso: new Date(localWallToUtcMs(tomorrowStartNaive, TIME_ZONE)).toISOString(),
    endIso: new Date(localWallToUtcMs(tomorrowStartNaive + 9 * 86400000, TIME_ZONE)).toISOString()
  };

  const todayRows = queryMatches(db, {
    rangeStart: todayRange.startIso, rangeEnd: todayRange.endIso,
    competition: comp.slug
  });
  const upcomingRows = queryMatches(db, {
    rangeStart: upcomingRange.startIso, rangeEnd: upcomingRange.endIso,
    competition: comp.slug
  });

  /* yaklaşanlar TR takvim gününe göre tarih gruplarına ayrılır */
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const byDate = new Map();
  for (const r of upcomingRows) {
    const day = dayFmt.format(new Date(r.kickoff_utc));
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day).push(r);
  }
  const upcoming = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rs]) => ({ date, matches: rs.map(buildMatch) }));

  const liveCount = todayRows.filter((r) => LIVE_STATUSES.includes(r.status)).length;

  return {
    ok: true,
    value: {
      competition: {
        id: comp.id, slug: comp.slug, name: comp.name,
        sport: comp.sport, country: comp.country ?? null, logo_url: comp.logo_url ?? null
      },
      matches: {
        today: todayRows.map(buildMatch),
        upcoming
      },
      meta: buildMeta(db, { date: today, liveCount })
    }
  };
}

module.exports = {
  TIME_ZONE, SPORTS, STATUSES, LIVE_STATUSES, STATUS_TEXT_TR,
  tzOffsetMs, localDayUtcRange, trToday, isValidDate,
  validateListParams, validateCompetitionSlug,
  listMatches, getMatchById, listCompetitions, listLive,
  buildMeta, buildMatch, groupRows,
  getStandings, getCompetitionBySlug,
  STANDINGS_COLUMN_KEYS
};
