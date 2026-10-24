#!/usr/bin/env node
/**
 * AŞAMA 0 — ek keşif #2: eksik hedef ligler (limit=50 + yazım varyantları),
 * standings/team/topscorers uçları, widget limit=50 teyidi.
 * Kurallar ana betikle aynı: ≥1.1s aralık, --max üst sınırı, 429/hata serisi → dur.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'data', 'samples');
const UA = 'TribunLocal-Discovery/1.0';
const BASE = 'https://sportscore.com';

const argv = process.argv.slice(2);
const maxIdx = argv.indexOf('--max');
const MAX = maxIdx >= 0 ? Number(argv[maxIdx + 1]) || 12 : 12;
const GAP = 1100;
let used = 0, seq = 100, lastAt = 0, errStreak = 0, aborted = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INTERESTING = ['content-type', 'cache-control', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining'];

async function hit(name, url) {
  if (aborted || used >= MAX) { console.log(`SKIP: ${name}`); return null; }
  const wait = lastAt + GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now(); used++; seq++;
  const t0 = Date.now();
  let res, text;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    text = await res.text();
  } catch (e) {
    errStreak++;
    console.log(`✗ ${name} — ${e.message}`);
    if (errStreak >= 3) aborted = true;
    return null;
  }
  const ms = Date.now() - t0;
  const headers = {};
  for (const h of INTERESTING) { const v = res.headers.get(h); if (v) headers[h] = v; }
  let body = text;
  try { body = JSON.parse(text); } catch { }
  fs.writeFileSync(path.join(SAMPLES, `1${String(seq).slice(1)}-${name}.json`),
    JSON.stringify({ name, url, status: res.status, ms, headers, body }, null, 2));
  console.log(`${res.status === 200 ? '✓' : '·'} ${name} → ${res.status} (${ms}ms)`);
  if (res.status === 429) { aborted = true; console.log('!! 429 — dur.'); }
  if (res.status >= 500) { errStreak++; if (errStreak >= 3) aborted = true; } else errStreak = 0;
  return { status: res.status, body };
}

const search = (q, sport, limit = 50) =>
  `${BASE}/api/v1/search/?q=${encodeURIComponent(q)}&sport=${sport}&limit=${limit}`;

(async () => {
  console.log(`Ek keşif — bütçe ${MAX}\n`);

  /* Eksik hedef ligler — daha geniş limit / yazım varyantı */
  const queries = [
    ['premier-league-50', search('Premier League', 'football')],
    ['super-lig-en', search('Super Lig', 'football')],
    ['tff', search('TFF', 'football')],
    ['laliga', search('LaLiga', 'football')],
    ['nba-50', search('NBA', 'basketball')]
  ];
  const searchResults = {};
  for (const [name, url] of queries) {
    const r = await hit(`ek-v1-search-${name}`, url);
    if (r?.status === 200) searchResults[name] = r.body;
  }
  // özet: her aramada ilgisiz ilk 3 + "istenen" adla eşleşen
  const wanted = {
    'premier-league-50': /(^|\b)(premier league)$/i,
    'super-lig-en': /(turkey|turkish|super lig)/i,
    'tff': /tff|1\. lig/i,
    'laliga': /spain|laliga|la liga/i,
    'nba-50': /^(nba)$/i
  };
  for (const [k, re] of Object.entries(wanted)) {
    const comps = searchResults[k]?.competitions ?? [];
    const hit0 = comps.find((c) => re.test(c.name) || re.test(c.slug));
    console.log(`   ${k}: ${comps.length} comp | eşleşme: ${hit0 ? hit0.name + ' | ' + hit0.slug + ' | ' + hit0.url : 'YOK'}`);
  }

  /* widget/matches limit=50 (50 sınırı teyidi) */
  const lim = await hit('ek-widget-matches-limit50', `${BASE}/api/widget/matches/?sport=football&limit=50`);
  console.log('   limit=50 → count:', lim?.body?.count, 'dönen:', lim?.body?.matches?.length);

  /* standings: Serie A (tek grup, temiz tablo beklenir) + UCL (grup yapısı) */
  const st1 = await hit('ek-widget-standings-serie-a', `${BASE}/api/widget/standings/?sport=football&slug=italian-serie-a`);
  if (st1?.status === 200) console.log('   standings üst anahtarlar:', Object.keys(st1.body).join(','));
  await hit('ek-widget-standings-ucl', `${BASE}/api/widget/standings/?sport=football&slug=uefa-champions-league`);

  /* team: search teams'ten gerçek bir takım slug'ı */
  const teamsArr = searchResults['premier-league-50']?.teams ?? [];
  const teamSlug = teamsArr[0]?.slug;
  console.log('   team slug kaynağı:', teamsArr[0]?.name, '→', teamSlug);
  if (teamSlug) await hit('ek-widget-team', `${BASE}/api/widget/team/?sport=football&slug=${encodeURIComponent(teamSlug)}&limit=5`);

  /* topscorers: Serie A goals */
  await hit('ek-widget-topscorers-serie-a', `${BASE}/api/widget/topscorers/?sport=football&slug=italian-serie-a&stat=goals`);

  console.log(`\nEk keşif bitti: ${used}/${MAX} istek | toplam örnek: ${fs.readdirSync(SAMPLES).length}`);
})();
