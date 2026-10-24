/**
 * Tribün — SportScore widget servis istemcisi (RapidAPI DIŞI, anahtarsız)
 * Kaynak: https://sportscore.com/api/widget/matches/?sport=football|basketball
 * Kurallar (ortak bağlam):
 *  - Tarayıcı asla doğrudan çağırmaz; yalnızca backend.
 *  - Ham yanıtı dışarı vermeziz; normalize format döneriz.
 *  - Hatalı/boş yanıt geçerli önbelleğin ÜZERİNE YAZMAZ.
 *  - API erişilemezse bellek → disk önbelleğinden son geçerli veri servis edilir.
 *  - Tutum: 120 sn bellek önbelleği + aynı anda tek uçuş (in-flight paylaşımı).
 */
const fs = require('fs');
const path = require('path');

const WIDGET_BASE = 'https://sportscore.com/api/widget/matches/';
const UA = 'Tribun/1.0 (localhost; yerel kisisel proje)';
const CACHE_TTL_MS = 120 * 1000;          // uç 60 sn cache öneriyor; biz 2 dk tutuyoruz
const DISK_CACHE = path.join(__dirname, '..', '..', 'data', 'widget-matches.json');
const SPORTS = ['football', 'basketball'];

const mem = {
  data: null,        // { football: [...], basketball: [...], updated }
  fetchedAt: 0,
  inFlight: null     // aynı anda tek istek; paralel çağrılar aynı promise'i bekler
};

/** Widget maçını kendi normalize formatımıza çevirir */
function normalizeMatch(m, sport) {
  const num = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    sport,
    home: String(m.home ?? ''),
    away: String(m.away ?? ''),
    homeLogo: m.home_logo || null,
    awayLogo: m.away_logo || null,
    homeScore: num(m.home_score),
    awayScore: num(m.away_score),
    statusRaw: String(m.status ?? ''),            // API'nin kendi değeri (finished/upcoming/…)
    statusText: String(m.status_text ?? ''),
    startsAt: m.time || null,                     // ISO 8601 (UTC)
    competition: m.competition || '',
    competitionLogo: m.competition_logo || null,
    matchUrl: m.url ? 'https://sportscore.com' + m.url : null
  };
}

/** Yanıt "geçerli" mi? En az bir maç varsa geçerli; boş/hatalı yanıt cache'i EZMEZ */
function parseWidget(json, sport) {
  if (!json || typeof json !== 'object') return null;
  const list = json.matches;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((m) => normalizeMatch(m, sport));
}

function readDisk() {
  try {
    return JSON.parse(fs.readFileSync(DISK_CACHE, 'utf8'));
  } catch { return null; }
}

function writeDisk(payload) {
  try {
    fs.mkdirSync(path.dirname(DISK_CACHE), { recursive: true });
    fs.writeFileSync(DISK_CACHE, JSON.stringify(payload));
  } catch { /* disk sorunu ölümcül değil */ }
}

/** Sporları sırayla çeker (uç, saniyede 1 istek kuralına doğal uyum) */
async function fetchFresh() {
  const out = { football: [], basketball: [], updated: null };
  for (const sport of SPORTS) {
    const res = await fetch(`${WIDGET_BASE}?sport=${sport}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`widget ${sport}: HTTP ${res.status}`);
    const json = await res.json();
    const norm = parseWidget(json, sport);
    if (!norm) throw new Error(`widget ${sport}: boş/geçersiz yanıt (count=${json?.count})`);
    out[sport] = norm;
    out.updated = out.updated || json.updated || new Date().toISOString();
  }
  return out;
}

/**
 * Önbellekli maç verisi. Hata durumunda (ağ/HTTP/boş yanıt) son geçerli veriye düşer.
 * @returns {{football:Array, basketball:Array, updated:string, stale:boolean}}
 */
async function getMatches() {
  const fresh = Date.now() - mem.fetchedAt < CACHE_TTL_MS;
  if (fresh && mem.data) return { ...mem.data, stale: false };
  if (mem.inFlight) return mem.inFlight;

  mem.inFlight = (async () => {
    try {
      const payload = await fetchFresh();
      mem.data = payload;
      mem.fetchedAt = Date.now();
      writeDisk(payload);
      return { ...payload, stale: false };
    } catch (e) {
      // Kural: hatalı yanıt cache'i ezmez → bellek, yoksa disk, yoksa boş
      if (mem.data) return { ...mem.data, stale: true };
      const disk = readDisk();
      if (disk && (disk.football?.length || disk.basketball?.length)) {
        return { ...disk, stale: true };
      }
      return { football: [], basketball: [], updated: null, stale: false, unavailable: true };
    } finally {
      mem.inFlight = null;
    }
  })();

  return mem.inFlight;
}

module.exports = { getMatches };
