/**
 * Tribün — maç normalizasyonu (Aşama 2; SAF fonksiyonlar, DB'ye yazmaz)
 *
 * Girdi: Aşama 0'da doğrulanan gerçek yanıt alanları:
 *   Liste maçı: { home, away, home_logo, away_logo, home_score, away_score,
 *                status, status_text, time, competition, competition_logo, url }
 *   Detay (futbol): widget/match yanıtındaki `match` nesnesi
 *
 * Çıktı: { ok, value, errors, unmapped } — unmapped: [{kind, rawValue}]
 *         yazımı ÇAĞIRAN yapar (unmappedStore.record → unmapped_values tablosu).
 * Geçersiz kayıt atlanır ({ok:false}); tüm yanıt asla düşürülmez.
 */

/* ---------------- durum eşleme (DOĞRULANAN tablo) ----------------
 * status: 'live' → live (period status_text'ten)   [openapi enum]
 *         'finished' → finished                     [DOĞRULANDI]
 *         'upcoming' (status_text 'Not started') → scheduled [DOĞRULANDI]
 * Ertelendi/iptal vb. sağlayıcı değeri GÖRÜLMEDİ → eşlenmez:
 * yedek kural + unmapped_values('status').
 */
const STATUS_MAP = {
  live: 'live',
  finished: 'finished',
  upcoming: 'scheduled'
};

/* status_text → period. Yalnız '2nd half', '1st quarter', 'Finished' DOĞRULANDI;
 * kalanı talimat sözlüğü; eşleşmeyen → period NULL + unmapped_values('status_text'). */
const PERIOD_MAP = [
  { re: /^1st half$/i, v: 'H1' },
  { re: /^2nd half$/i, v: 'H2' },
  { re: /^half[ -]?time$/i, v: 'HT' },
  { re: /^extra time$/i, v: 'ET' },
  { re: /^penalt(y shootout|ies)$/i, v: 'PEN' },
  { re: /^1st quarter$/i, v: 'Q1' },
  { re: /^2nd quarter$/i, v: 'Q2' },
  { re: /^3rd quarter$/i, v: 'Q3' },
  { re: /^4th quarter$/i, v: 'Q4' },
  { re: /^overtime$/i, v: 'OT' }
];

/* incidents type_id → iç tür (goal=1, penalty_goal=8, yellow_card=3,
 * substitution=9, var=28 DOĞRULANDI/verildi; diğerleri 'other' + unmapped).
 * AŞAMA 8: typeRaw = sağlayıcının kendi tür metni ('Red card' gibi bilinmeyen
 * türlerde arayüzde gösterilir; eşleme TABLODISI olduğu için icat edilmez). */
const INCIDENT_TYPE = { 1: 'goal', 8: 'penalty_goal', 3: 'yellow_card', 9: 'substitution', 28: 'var' };

/* stats label → Türkçe (yalnız verilen sözlük; bilinmeyen olduğu gibi + unmapped) */
const STATS_TR = {
  'Ball Possession': 'Topla Oynama',
  'Shots on Target': 'İsabetli Şut',
  'Shots off Target': 'İsabetsiz Şut',
  'Attacks': 'Ataklar',
  'Dangerous Attacks': 'Tehlikeli Ataklar'
};

/* ---------------- yardımcılar ---------------- */

/** "1"/"0"/"" → 1/0/null; çevrilemeyen → NaN (kayıt reddi) */
function toScore(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return NaN;
  return parseInt(s, 10);
}

/** time → UTC ISO (Z'li). Geçersiz/eksik → null (kayıt reddi) */
function toUtcIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** takım adı → name_key (Aşama 1 slugify kuralının aynısı) */
function nameKey(name) {
  return String(name || '')
    .toLocaleLowerCase('tr')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || null;
}

/** maç url'si → { externalId, urlPath, matchSlug }
 *  futbol:   /football/match/<slug>/<kimlik>/  → kimlik = SON parça
 *  basketbol: /basketball/match/<slug>/        → external_id = "<slug>@<YYYY-MM-DD UTC>" */
function idsFromUrl(url, sport, kickoffUtc) {
  const raw = String(url || '');
  const parts = raw.split('/').filter(Boolean); // [sport, 'match', ...]
  const urlPath = '/' + parts.join('/') + (raw.endsWith('/') ? '/' : '');
  if (sport === 'football') {
    const id = parts[parts.length - 1] || null;
    const slug = parts[parts.length - 2] || null;
    return { externalId: id, urlPath, matchSlug: slug };
  }
  const slug = parts[parts.length - 1] || null;
  const day = kickoffUtc ? kickoffUtc.slice(0, 10) : '';
  return { externalId: slug && day ? `${slug}@${day}` : null, urlPath, matchSlug: slug };
}

function periodFromText(statusText, unmapped) {
  const t = String(statusText || '').trim();
  if (!t || /^finished$/i.test(t)) return null; // bitmiş maçta period yok
  for (const { re, v } of PERIOD_MAP) {
    if (re.test(t)) return v;
  }
  unmapped.push({ kind: 'status_text', rawValue: t });
  return null;
}

/* ---------------- liste maçı ---------------- */

/**
 * @param {object} raw liste yanıtı maç nesnesi
 * @param {string} sport 'football'|'basketball'
 * @param {{id:number,name:string}|null} competitionRow competitions satırı (allowlist eşleşmesi)
 */
function normalizeListMatch(raw, sport, competitionRow) {
  const errors = [];
  const unmapped = [];
  if (!raw || typeof raw !== 'object') return { ok: false, value: null, errors: ['raw nesne değil'], unmapped };

  const homeScore = toScore(raw.home_score);
  const awayScore = toScore(raw.away_score);
  if (Number.isNaN(homeScore)) errors.push('home_score sayıya çevrilemedi');
  if (Number.isNaN(awayScore)) errors.push('away_score sayıya çevrilemedi');

  const kickoffUtc = toUtcIso(raw.time);
  if (kickoffUtc === null) errors.push('time geçersiz/eksik');

  const ids = idsFromUrl(raw.url, sport, kickoffUtc);
  if (!ids.externalId) errors.push('url’den external_id çıkarılamadı');

  if (!raw.home || !raw.away) errors.push('takım adı eksik');
  if (!competitionRow) errors.push('lig allowlist dışı');

  if (errors.length) return { ok: false, value: null, errors, unmapped };

  // durum eşleme
  const rawStatus = String(raw.status ?? '');
  let status = STATUS_MAP[rawStatus] || null;
  if (!status) {
    unmapped.push({ kind: 'status', rawValue: rawStatus });
    // yedek kural: skorlar NULL ve zaman gelecekteyse scheduled, aksi halde unknown
    const future = new Date(kickoffUtc).getTime() > Date.now();
    status = (homeScore === null && awayScore === null && future) ? 'scheduled' : 'unknown';
  }

  // period: yalnız canlıda anlamı var
  let period = null;
  if (status === 'live') period = periodFromText(raw.status_text, unmapped);

  const homeKey = nameKey(raw.home);
  const awayKey = nameKey(raw.away);

  return {
    ok: true,
    unmapped,
    value: {
      externalId: ids.externalId,
      urlPath: ids.urlPath,
      sport,
      competitionId: competitionRow.id,
      competitionName: competitionRow.name,
      status,
      statusRaw: rawStatus || null,
      statusText: raw.status_text || null,
      period,
      kickoffUtc,
      homeScore,
      awayScore,
      home: { name: raw.home, nameKey: homeKey, logoUrl: raw.home_logo || null },
      away: { name: raw.away, nameKey: awayKey, logoUrl: raw.away_logo || null }
    },
    errors: []
  };
}

/* ---------------- maç detayı (YALNIZ FUTBOL) ---------------- */

function normalizeIncident(inc, unmapped) {
  const type = INCIDENT_TYPE[inc.type_id] || null;
  if (!type) unmapped.push({ kind: 'incident_type', rawValue: `type_id=${inc.type_id} (${inc.type})` });
  const minute = toScore(inc.time);
  return {
    type: type || 'other',
    typeRaw: inc.type || null,
    minute: Number.isNaN(minute) ? null : minute,
    side: inc.side === 'home' ? 'home' : (inc.side === 'away' ? 'away' : null),
    player: inc.player || null,
    playerIn: inc.player_in || null,
    playerOut: inc.player_out || null,
    homeScore: Number.isNaN(toScore(inc.home_score)) ? null : toScore(inc.home_score),
    awayScore: Number.isNaN(toScore(inc.away_score)) ? null : toScore(inc.away_score)
  };
}

/** ""/null → null; sayıya çevrilebilen → sayı ( yüzde çubukları için ) */
function toPct(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatRow(row, unmapped) {
  const label = String(row.label ?? row.name ?? '');
  const tr = STATS_TR[label] || null;
  if (!tr && label) unmapped.push({ kind: 'stats_label', rawValue: label });
  return {
    label,
    labelTr: tr || label,
    home: row.home ?? row.value_home ?? null,
    away: row.away ?? row.value_away ?? null,
    /* AŞAMA 8: karşılaştırmalı çubuklar doğrudan yüzde alanlarından */
    homePct: toPct(row.home_pct),
    awayPct: toPct(row.away_pct),
    suffix: typeof row.suffix === 'string' ? row.suffix : ''
  };
}

/**
 * @param {object} raw widget/match yanıtının `match` nesnesi (futbol)
 * @param {'football'} sport — basketbol detayı normalize EDİLMEZ
 */
function normalizeDetail(raw, sport) {
  if (sport !== 'football') {
    return { ok: false, value: null, errors: ['basketbol detayı normalize edilmez'], unmapped: [] };
  }
  const errors = [];
  const unmapped = [];
  if (!raw || typeof raw !== 'object') return { ok: false, value: null, errors: ['detay nesnesi yok'], unmapped };

  const liveMinuteRaw = raw.live_minute;
  let liveMinute = null;
  if (liveMinuteRaw !== null && liveMinuteRaw !== undefined && liveMinuteRaw !== '') {
    const m = toScore(liveMinuteRaw);
    liveMinute = Number.isNaN(m) ? null : m;
  }

  const kickoffUtc = toUtcIso(raw.time);
  if (kickoffUtc === null) errors.push('time geçersiz');
  const ids = idsFromUrl(raw.url, 'football', kickoffUtc);
  if (!ids.externalId) errors.push('url’den external_id çıkarılamadı');
  if (errors.length) return { ok: false, value: null, errors, unmapped };

  const homeScore = toScore(raw.home_score);
  const awayScore = toScore(raw.away_score);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
    return { ok: false, value: null, errors: ['skor sayıya çevrilemedi'], unmapped };
  }

  const rawStatus = String(raw.status ?? '');
  let status = STATUS_MAP[rawStatus] || null;
  if (!status) {
    unmapped.push({ kind: 'status', rawValue: rawStatus });
    status = 'unknown';
  }
  let period = null;
  if (status === 'live') period = periodFromText(raw.status_text, unmapped);

  const incidents = Array.isArray(raw.incidents)
    ? raw.incidents.map((i) => normalizeIncident(i, unmapped))
    : [];
  const stats = Array.isArray(raw.stats)
    ? raw.stats.map((s) => normalizeStatRow(s, unmapped))
    : [];

  /* AŞAMA 8: oyuncu satırı eşlemesi (rating bilinçli ATILIR — talimat) */
  const normPlayer = (p) => ({
    name: p.name,
    number: p.number ?? null,
    position: p.position || null,
    captain: !!p.captain
  });
  let lineups = null;
  if (raw.lineups && typeof raw.lineups === 'object' && !Array.isArray(raw.lineups)) {
    lineups = {
      confirmed: !!raw.lineups.confirmed,
      homeFormation: raw.lineups.home_formation || null,
      awayFormation: raw.lineups.away_formation || null,
      homeCoach: raw.lineups.home_coach || null,
      awayCoach: raw.lineups.away_coach || null,
      homeXi: Array.isArray(raw.lineups.home_xi) ? raw.lineups.home_xi.map(normPlayer) : [],
      awayXi: Array.isArray(raw.lineups.away_xi) ? raw.lineups.away_xi.map(normPlayer) : [],
      /* AŞAMA 8: yedekler (home_subs/away_subs doğrulandı — 26.10 canlı çekim) */
      homeSubs: Array.isArray(raw.lineups.home_subs) ? raw.lineups.home_subs.map(normPlayer) : [],
      awaySubs: Array.isArray(raw.lineups.away_subs) ? raw.lineups.away_subs.map(normPlayer) : []
    }; // rating bilinçli ATILDI (talimat)
  }

  const homeHt = toScore(raw.home_ht_score);
  const awayHt = toScore(raw.away_ht_score);

  return {
    ok: true,
    unmapped,
    value: {
      externalId: ids.externalId,
      urlPath: ids.urlPath,
      status,
      statusRaw: rawStatus || null,
      statusText: raw.status_text || null,
      period,
      liveMinute,
      kickoffUtc,
      homeScore,
      awayScore,
      homeHtScore: Number.isNaN(homeHt) ? null : homeHt,
      awayHtScore: Number.isNaN(awayHt) ? null : awayHt,
      incidents,
      stats,
      lineups,
      competition: raw.competition || null
    },
    errors: []
  };
}

/* Yeni/alanmamış takım adı: çağıran, value.home.nameKey veritabanında yoksa
 * unmapped_values('team_name') yazar — sağlayıcı fonksiyon: */
function teamUnmapped(value) {
  if (!value) return [];
  const out = [];
  if (value.home) out.push({ kind: 'team_name', rawValue: value.home.name, nameKey: value.home.nameKey });
  if (value.away) out.push({ kind: 'team_name', rawValue: value.away.name, nameKey: value.away.nameKey });
  return out;
}

module.exports = {
  normalizeListMatch,
  normalizeDetail,
  teamUnmapped,
  STATUS_MAP,
  PERIOD_MAP,
  INCIDENT_TYPE,
  STATS_TR,
  nameKey,
  toScore,
  toPct,
  toUtcIso,
  idsFromUrl
};
