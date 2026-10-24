/**
 * Tribün — SportScore istemcisi (Aşama 2; tek giriş noktası)
 *
 * Doğrulanmış uçlar (docs/sportscore-discovery.md + Aşama 3 ek keşfi):
 *   GET /api/v1/fixtures/?sport=&date=[&status=upcoming]   — DOĞRULANDI
 *   GET /api/widget/match/?sport=&slug=                     — DOĞRULANDI
 * Doğrulanmayan parametreler (competition/limit/page …) hiçbir yerde kullanılmaz.
 *
 * Özellikler:
 *  - AbortSignal.timeout(SPORTSCORE_TIMEOUT_MS), UA: TribunLocal/1.0
 *  - Yeniden deneme: yalnız ağ hatası + 5xx, en çok 2 (üstel geri çekilme + rastgele sapma);
 *    4xx asla yeniden denenmez
 *  - 429: Retry-After'a uyulur; devre kesici açılır; günlük ETKİN limit o anki
 *    toplamın %80'ine çekilir. 5 ardışık hata → kısa süreli devre kesici (60 sn)
 *  - Yanıt boyutu üst sınırı (5 MB); JSON hataları yakalanır; ham gövde loga/kullanıcıya sızmaz
 *  - Tek-uçuş: aynı URL'nin eşzamanlı çağrıları tek ağ isteğinde birleşir
 *  - Rate-limit header'ları (adında ratelimit/retry-after geçenler) çağırana
 *    { json, rateMeta } olarak döner → çağıran sync_runs.meta'ya yazar
 *  - Bütçe: spend(endpoint, priority) — api_usage'ta UTC gün + uç bazında sayaç.
 *    Kademeler (günlük ETKİN limitin yüzdesi): %70'te 'low' (detay, D+2..D+7) reddedilir,
 *    %90'da yalnız 'critical' (canlı skor + bugün) çalışır, %100'de hepsi durur.
 *
 * AŞAMA 3: fetchFixtures artık (sport, date, competition) üçlüsünü destekler —
 * her istek TEK bir (lig, gün) çiftine atılır (competition parametresi canlı
 * doğrulandı: 23.10.2026, filtreli yanıt yalnız o ligin maçlarını döndürür).
 */
const db = require('../db');

const BASE_URL = process.env.SPORTSCORE_BASE_URL || 'https://sportscore.com';
const DAILY_BUDGET = Number(process.env.SPORTSCORE_DAILY_BUDGET || process.env.SCORESCORE_DAILY_BUDGET) || 7000;
const TIMEOUT_MS = Number(process.env.SPORTSCORE_TIMEOUT_MS || process.env.SCORESCORE_TIMEOUT_MS) || 10000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RETRIES = 2;
const CB_SHORT_MS = 60 * 1000;        // 5 ardışık hata sonrası kısa devre kesici
const UA = 'TribunLocal/1.0';

/* Devre kesici durumu (bellek içi; süreç ömrü boyunca) */
const cb = { openUntil: 0, failures: 0 };
/* Günlük etkin limit (429'da düşürülür; gün değişince sıfırlanır) */
let effectiveLimit = DAILY_BUDGET;
let effDay = null;
/* Tek-uçuş haritası */
const inflight = new Map();

class BudgetError extends Error { constructor(m) { super(m); this.name = 'BudgetError'; } }
class CircuitOpenError extends Error { constructor(m) { super(m); this.name = 'CircuitOpenError'; } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dayUtc = () => new Date().toISOString().slice(0, 10);

function ensureDay() {
  const d = dayUtc();
  if (effDay !== d) { effDay = d; effectiveLimit = DAILY_BUDGET; }
}

function usedToday() {
  return db.prepare('SELECT COALESCE(SUM(count),0) AS c FROM api_usage WHERE day_utc = ?').get(dayUtc()).c;
}

function bumpUsage(endpoint) {
  db.prepare(`
    INSERT INTO api_usage (day_utc, endpoint, count) VALUES (?, ?, 1)
    ON CONFLICT(day_utc, endpoint) DO UPDATE SET count = count + 1
  `).run(dayUtc(), endpoint);
}

/** İstek öncesi bütçe kararı. priority: 'critical' | 'normal' | 'low' */
function spend(endpoint, priority = 'normal') {
  ensureDay();
  const used = usedToday();
  const pct = used / effectiveLimit;
  if (pct >= 1) {
    throw new BudgetError(`Günlük bütçe doldu (${used}/${effectiveLimit}); hiçbir istek yapılmaz.`);
  }
  if (pct >= 0.9 && priority !== 'critical') {
    throw new BudgetError(`Bütçe %90+ (${used}/${effectiveLimit}); yalnız 'critical' isteklere izin var.`);
  }
  if (pct >= 0.7 && priority === 'low') {
    throw new BudgetError(`Bütçe %70+ (${used}/${effectiveLimit}); düşük öncelikli istek reddedildi.`);
  }
  bumpUsage(endpoint);
}

/** Rate-limit ilişkili header'ları süzer */
function pickRateHeaders(res) {
  const out = {};
  for (const [k, v] of res.headers) {
    if (/ratelimit|retry-after/i.test(k)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Düşük seviye istek. Resmi kullanım: fetchFixtures / fetchMatchDetail.
 * Aşama 3'ün canlı-gün kapsaması da buradan yapılır (bkz. syncFixtures).
 * @returns {Promise<{json:any, rateMeta:object|null}>}
 */
async function request(pathname, params = {}, opts = {}) {
  const priority = opts.priority || 'normal';
  const endpoint = pathname;

  if (Date.now() < cb.openUntil) {
    throw new CircuitOpenError(`Devre kesici açık (${Math.ceil((cb.openUntil - Date.now()) / 1000)} sn); istek atılmadı.`);
  }

  spend(endpoint, priority);

  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${pathname}${qs ? '?' + qs : ''}`;

  // Tek-uçuş: aynı URL için bekleyen çağrılar tek ağ isteğinde birleşir
  if (inflight.has(url)) return inflight.get(url);

  const job = (async () => {
    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = Math.pow(2, attempt - 1) * 1000 + Math.floor(Math.random() * 400);
        await sleep(backoff);
      }
      let res, text;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        text = await res.text();
      } catch (e) {
        lastErr = new Error(`ağ/zaman aşımı: ${e.name || e.message}`);
        continue; // ağ hatası → yeniden dene
      }

      if (res.status === 429) {
        const ra = parseFloat(res.headers.get('retry-after')) || 60;
        cb.openUntil = Date.now() + ra * 1000;
        ensureDay();
        effectiveLimit = Math.max(1, Math.round(usedToday() * 0.8));
        const rateMeta = pickRateHeaders(res);
        const err = new BudgetError(`429: ${ra} sn devre kesici; etkin limit ${effectiveLimit}'e çekildi`);
        err.rateMeta = rateMeta;
        throw err; // 429 yeniden denenmez
      }

      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue; // 5xx → yeniden dene
      }

      if (res.status >= 400) {
        cb.failures = 0;
        throw new Error(`HTTP ${res.status} (${endpoint})`); // 4xx → deneme yok
      }

      if (text.length > MAX_BYTES) {
        throw new Error(`Yanıt çok büyük (${(text.length / 1048576).toFixed(1)} MB > 5 MB)`);
      }

      cb.failures = 0;
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('Geçersiz JSON yanıtı'); // ham gövde sızmaz
      }
      return { json, rateMeta: pickRateHeaders(res) };
    }

    cb.failures++;
    if (cb.failures >= 5) {
      cb.openUntil = Date.now() + CB_SHORT_MS;
      cb.failures = 0;
    }
    throw lastErr || new Error('istek başarısız');
  })();

  inflight.set(url, job);
  try {
    return await job;
  } finally {
    inflight.delete(url);
  }
}

/* ---------------- Resmi sarmalayıcılar ---------------- */

/** Tarihe göre öncelik: bugün → critical; yarın ve dün → normal; diğer günler → low */
function optsPriority(date) {
  const today = dayUtc();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (date === today) return 'critical';
  if (date === tomorrow || date === yesterday) return 'normal';
  return 'low';
}

/**
 * Günlük fikstür listesi — Aşama 3'te her çağrı TEK (lig, gün) çiftidir.
 * @param {{sport:'football'|'basketball', date:string, competition?:string, status?:'upcoming',
 *          priority?:'critical'|'normal'|'low'}} q
 *   competition: competitions.slug (allowlist); verilmezse eski davranış (tüm ligler) korunur.
 *   priority: AŞAMA 5 — canlı skor turu 'critical' ister (bütçe %90+'ta yalnız
 *   critical yaşar; gece yarısını aşan canlı maçın tarih çifti "dün"e düşse bile
 *   canlı skor kritiktir). Verilmezse gün bazlı otomatik öncelik kullanılır.
 */
function fetchFixtures({ sport, date, competition, status, priority } = {}) {
  const params = { sport, date };
  if (competition) params.competition = competition;
  if (status) params.status = status;
  return request('/api/v1/fixtures/', params, { priority: priority || optsPriority(date) });
}

/**
 * Maç detayı (futbol).
 * @param {{sport:'football'|'basketball', matchSlug:string}} q
 */
function fetchMatchDetail({ sport, matchSlug } = {}) {
  return request('/api/widget/match/', { sport, slug: matchSlug }, { priority: 'low' });
}

/**
 * Lig puan durumu (AŞAMA 7) — widget ucu, DÜŞÜK öncelik (bütçe %70+'ta red).
 * DOĞRULAMA (24.10.2026): futbol 200 (tables[].rows[]; satırlar pos/team/
 * team_logo/team_slug/team_url/p/w/d/l/gf/ga/gd/pts/promo_color/promo_name);
 * basketbol ucu NBA ve EuroLeague için 404 "No standings data" → çağıran
 * (syncStandings/standingsJob) yalnızca FUTBOL liglerinde kullanır.
 * @param {{sport:'football', competition:string}} q — competition: lig slug'ı
 */
function fetchStandings({ sport, competition } = {}) {
  return request('/api/widget/standings/', { sport, slug: competition }, { priority: 'low' });
}

module.exports = {
  request,
  fetchFixtures,
  fetchMatchDetail,
  fetchStandings,
  usageToday: usedToday,
  budgetLeft: () => { ensureDay(); return Math.max(0, effectiveLimit - usedToday()); },
  effectiveLimit: () => { ensureDay(); return effectiveLimit; },
  DAILY_BUDGET,
  BudgetError,
  CircuitOpenError,
  _internal: { cb, setEffectiveLimit: (v) => { effectiveLimit = v; }, resetDay: () => { effDay = null; ensureDay(); } }
};
