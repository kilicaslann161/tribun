#!/usr/bin/env node
/** Aşama 0 — analiz #3: geniş arama listeleri, standings/topscorers şemaları */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples');
const files = fs.readdirSync(SAMPLES).sort();
const load = (f) => JSON.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
const byName = (frag) => files.find((f) => f.includes(frag));
const hr = (t) => console.log('\n' + '='.repeat(12), t, '='.repeat(12));

/* 1) "Premier League" limit=50 — tüm 20 competition'ı listele */
try {
  const b = load(byName('ek-v1-search-premier-league-50')).body;
  hr('SEARCH "Premier League" (limit=50) — tum competitionlar');
  for (const c of b.competitions) console.log(`  "${c.name}" | ${c.slug} | ${c.url}`);
  console.log('teams (ilk 3):', b.teams?.slice(0, 3).map((t) => t.name).join(', '));
} catch (e) { console.log('hata:', e.message); }

/* 2) "Super Lig" ve "NBA" tam listeleri */
for (const frag of ['ek-v1-search-super-lig-en', 'ek-v1-search-nba-50', 'ek-v1-search-tff', 'ek-v1-search-laliga']) {
  try {
    const b = load(byName(frag)).body;
    hr(`SEARCH ${frag}`);
    for (const c of (b.competitions ?? [])) console.log(`  "${c.name}" | ${c.slug} | ${c.url}`);
  } catch (e) { console.log(frag, 'hata:', e.message); }
}

/* 3) Standings şeması — Serie A (tek tablo) ve UCL (gruplu?) */
for (const frag of ['ek-widget-standings-serie-a', 'ek-widget-standings-ucl']) {
  try {
    const b = load(byName(frag)).body;
    hr(`STANDINGS ${frag}`);
    console.log('competition:', b.competition, '| slug:', b.competition_slug, '| tablo sayısı:', (b.tables ?? []).length);
    const t0 = b.tables?.[0];
    if (t0) {
      console.log('tablo anahtarları:', Object.keys(t0).join(', '));
      console.log('tablo adı/etiketi:', JSON.stringify({ name: t0.name, group: t0.group, stage: t0.stage }));
      const rows = t0.rows ?? t0.standings ?? [];
      console.log('satır sayısı:', rows.length);
      if (rows[0]) {
        console.log('satır anahtarları:', Object.keys(rows[0]).join(', '));
        console.log('ilk satır:', JSON.stringify(rows[0]).slice(0, 500));
      }
    }
    if (b.tables?.length > 1) console.log('diğer tablo adları:', b.tables.slice(1, 6).map((t) => t.name ?? t.group).join(' | '));
  } catch (e) { console.log(frag, 'hata:', e.message); }
}

/* 4) Topscorers şeması */
try {
  const b = load(byName('ek-widget-topscorers-serie-a')).body;
  hr('TOPSCORERS Serie A');
  console.log('üst anahtarlar:', Object.keys(b).join(', '));
  const arr = b.players ?? b.topscorers ?? [];
  console.log('oyuncu sayısı:', arr.length);
  if (arr[0]) {
    console.log('oyuncu anahtarları:', Object.keys(arr[0]).join(', '));
    console.log('ilk 3:', JSON.stringify(arr.slice(0, 3)).slice(0, 700));
  }
} catch (e) { console.log('topscorers hata:', e.message); }
