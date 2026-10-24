#!/usr/bin/env node
/**
 * AŞAMA 0 — SportScore keşif betiği (salt okunur, RapidAPI DIŞI sürüm)
 * Hedef: sportscore.com'un DOĞRUDAN uçları (anahtarsız widget + /api/v1/)
 * Kurallar:
 *  - İstekler arası ≥1.1 sn (saniyede en çok 1 istek)
 *  - Toplam üst sınır: --max N (varsayılan 40; kullanıcının ~80 kuralının altında)
 *  - User-Agent: TribunLocal-Discovery/1.0
 *  - Her yanıt gövdesi + önemli header'lar data/samples/ altına JSON olarak yazılır
 *  - 429 → anında dur; 3 art arda ağ/5xx → dur
 *  - Mevcut koda ve data/tribun.db'ye DOKUNULMAZ
 *
 * Kullanım:  node scripts/discover-sportscore.mjs [--max 40]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'data', 'samples');
fs.mkdirSync(SAMPLES, { recursive: true });

const UA = 'TribunLocal-Discovery/1.0';
const BASE = 'https://sportscore.com';

const argv = process.argv.slice(2);
const maxIdx = argv.indexOf('--max');
const MAX = maxIdx >= 0 ? Number(argv[maxIdx + 1]) || 40 : 40;
const GAP = 1100;
let used = 0, seq = 0, lastAt = 0, errStreak = 0, aborted = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

const INTERESTING = [
  'content-type', 'cache-control', 'retry-after',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'ratelimit-limit', 'ratelimit-remaining',
  'cf-cache-status', 'server', 'date', 'www-authenticate', 'authorization'
];

async function hit(name, url, opts = {}) {
  if (aborted) return null;
  if (used >= MAX) { console.log(`SKIP (bütçe): ${name}`); return null; }
  const wait = lastAt + GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now(); used++; seq++;

  const sentHeaders = { 'User-Agent': UA, Accept: 'application/json,text/yaml,*/*', ...(opts.headers || {}) };
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(url, { method: opts.method || 'GET', headers: sentHeaders, body: opts.body });
    text = await res.text();
  } catch (e) {
    errStreak++;
    fs.writeFileSync(path.join(SAMPLES, `${pad(seq)}-${name}.json`),
      JSON.stringify({ name, url, error: String(e) }, null, 2));
    console.log(`✗ ${name} — ağ hatası: ${e.message}`);
    if (errStreak >= 3) { aborted = true; console.log('!! 3 art arda hata — keşif durduruldu.'); }
    return null;
  }

  const ms = Date.now() - t0;
  const headers = {};
  for (const h of INTERESTING) { const v = res.headers.get(h); if (v) headers[h] = v; }
  let body = text;
  try { body = JSON.parse(text); } catch { /* yaml/html düz metin kalır */ }

  fs.writeFileSync(path.join(SAMPLES, `${pad(seq)}-${name}.json`),
    JSON.stringify({ name, url, method: opts.method || 'GET', status: res.status, ms, sentHeaders, headers, body }, null, 2));

  console.log(`${res.status === 200 ? '✓' : '·'} ${name} → ${res.status} (${ms}ms)${headers['cache-control'] ? ' | cache: ' + headers['cache-control'] : ''}`);

  if (res.status === 429) { aborted = true; console.log('!! 429 — keşif DURDURULDU.'); return { status: 429, body }; }
  if (res.status >= 500) { errStreak++; if (errStreak >= 3) { aborted = true; console.log('!! 3 art arda 5xx — dur.'); } }
  else errStreak = 0;
  return { status: res.status, body };
}

/* /football/match/<slug>/<id>/ → { slug, id } */
function parseMatchUrl(u) {
  const parts = String(u || '').split('/').filter(Boolean); // [sport, 'match', slug, id?]
  return { slug: parts[2] ?? null, id: parts[3] ?? null };
}

/* Yanıt metninden competition/team linklerini çıkar */
function scanLinks(meta) {
  const s = JSON.stringify(meta?.body ?? '');
  const comps = [...new Set([...s.matchAll(/\/(football|basketball)\/competition\/([^"\\]+)/g)].map((m) => m[0]))];
  const teams = [...new Set([...s.matchAll(/\/(football|basketball)\/team\/([^"\\]+)/g)].map((m) => m[0]))];
  return { comps: comps.slice(0, 4), teams: teams.slice(0, 4) };
}

const TARGET_LEAGUES = [
  { label: 'Süper Lig', q: 'Süper Lig', sport: 'football' },
  { label: 'TFF 1. Lig', q: 'TFF 1. Lig', sport: 'football' },
  { label: 'Premier League', q: 'Premier League', sport: 'football' },
  { label: 'La Liga', q: 'La Liga', sport: 'football' },
  { label: 'Serie A', q: 'Serie A', sport: 'football' },
  { label: 'Bundesliga', q: 'Bundesliga', sport: 'football' },
  { label: 'Ligue 1', q: 'Ligue 1', sport: 'football' },
  { label: 'UEFA Şampiyonlar Ligi', q: 'UEFA Champions League', sport: 'football' },
  { label: 'UEFA Avrupa Ligi', q: 'UEFA Europa League', sport: 'football' },
  { label: 'NBA', q: 'NBA', sport: 'basketball' },
  { label: 'EuroLeague', q: 'Euroleague', sport: 'basketball' }
];

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\nSportScore doğrudan keşif — UTC ${today} | bütçe: ${MAX} istek\n`);

  /* 1) OpenAPI şeması */
  await hit('openapi-yaml', `${BASE}/developers/openapi.yaml`, { headers: { Accept: 'text/yaml,*/*' } });

  /* 2) widget/matches */
  const fbw = await hit('com-widget-matches-football', `${BASE}/api/widget/matches/?sport=football`);
  const bbw = await hit('com-widget-matches-basketball', `${BASE}/api/widget/matches/?sport=basketball`);
  const statuses = new Set();
  for (const m of (fbw?.body?.matches ?? [])) statuses.add(m.status);
  for (const m of (bbw?.body?.matches ?? [])) statuses.add(m.status);
  console.log('   statü değerleri:', [...statuses].join(', '));

  const f = fbw?.body?.matches?.[0];
  const b = bbw?.body?.matches?.[0];
  const fUrl = parseMatchUrl(f?.url);
  const bUrl = parseMatchUrl(b?.url);
  console.log(`   futbol maç url: ${f?.url} → slug=${fUrl.slug} id=${fUrl.id}`);
  console.log(`   basketbol maç url: ${b?.url} → slug=${bUrl.slug} id=${bUrl.id}`);

  /* 3) /api/v1/ — anahtar ister mi, ücretsiz katman? */
  await hit('com-v1-matches', `${BASE}/api/v1/matches/?sport=football&limit=2`);
  await hit('com-v1-fixtures', `${BASE}/api/v1/fixtures/?sport=football&date=${today}`);

  /* 4) widget/match (Slug query parametresiyle) */
  const fm = await hit('com-widget-match-football', `${BASE}/api/widget/match/?sport=football&slug=${encodeURIComponent(fUrl.slug ?? '')}`);
  await hit('com-widget-match-basketball', `${BASE}/api/widget/match/?sport=basketball&slug=${encodeURIComponent(bUrl.slug ?? '')}`);

  /* detay gövdesinden lig/takım bağlantıları */
  const links = scanLinks(fm);
  console.log('   maç detayındaki competition linkleri:', links.comps.join(' | ') || 'YOK');
  console.log('   maç detayındaki team linkleri:', links.teams.join(' | ') || 'YOK');

  /* 5) standings / team / topscorers */
  // competition url'si '/football/competition/<a>/<b>/<id>/' biçiminde olabilir; slug parçalarını dene
  const compParts = (links.comps[0] || '').split('/').filter(Boolean); // [sport, 'competition', a, b?, id?]
  const compCandidates = [];
  if (compParts.length >= 4) compCandidates.push(compParts.slice(-2)[0]);   // id'den önceki parça
  if (compParts.length >= 5) compCandidates.push(compParts.slice(-3, -1).join('/'));
  const teamParts = (links.teams[0] || '').split('/').filter(Boolean);
  const teamSlug = teamParts[3] ?? null;

  let standingsOk = null;
  for (const cand of [...new Set(compCandidates)]) {
    if (!cand || used >= MAX) continue;
    const r = await hit(`com-widget-standings-${cand.replace(/\//g, '_')}`, `${BASE}/api/widget/standings/?sport=football&slug=${encodeURIComponent(cand)}`);
    if (r?.status === 200) { standingsOk = cand; break; }
  }
  if (teamSlug) {
    await hit('com-widget-team', `${BASE}/api/widget/team/?sport=football&slug=${encodeURIComponent(teamSlug)}&limit=5`);
  }
  if (standingsOk) {
    await hit('com-widget-topscorers', `${BASE}/api/widget/topscorers/?sport=football&slug=${encodeURIComponent(standingsOk)}&stat=goals`);
  }

  /* 6) v1/search ile hedef ligler — önce tek deneme, çalışırsa kalanlar */
  const s1 = await hit('com-v1-search-premier-league',
    `${BASE}/api/v1/search/?q=${encodeURIComponent('Premier League')}&sport=football&limit=5`);
  const searchWorks = s1?.status === 200 && s1?.body && JSON.stringify(s1.body).length > 20;
  if (searchWorks) {
    for (const t of TARGET_LEAGUES) {
      if (aborted || used >= MAX) break;
      if (t.label === 'Premier League') continue; // zaten denendi
      await hit(`com-v1-search-${t.q.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`,
        `${BASE}/api/v1/search/?q=${encodeURIComponent(t.q)}&sport=${t.sport}&limit=5`);
    }
  } else {
    console.log('   v1/search çalışmıyor gibi — kalan hedef ligler için arama yapılmayacak.');
  }

  console.log(`\n========== KEŞİF ÖZETİ ==========`);
  console.log(`Kullanılan istek: ${used}/${MAX}`);
  console.log(`data/samples dosya sayısı: ${fs.readdirSync(SAMPLES).length}`);
  if (aborted) console.log('!! Keşif erken durduruldu (429 / hata serisi / bütçe).');
})();
