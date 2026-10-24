#!/usr/bin/env node
/** Aşama 0 — örnek yanıt analizi (salt okunur, istek YOK) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples');
const files = fs.readdirSync(SAMPLES).sort();
const load = (f) => JSON.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
const byName = (frag) => files.find((f) => f.includes(frag));
const hr = (t) => console.log('\n' + '='.repeat(12), t, '='.repeat(12));
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o) : String(o));

/* 1) OpenAPI: parametre $ref'leri + şema isimleri + enum'lar */
try {
  const y = load(byName('openapi')).body;
  const text = typeof y === 'string' ? y : JSON.stringify(y);
  hr('OPENAPI components/parameters');
  const prm = text.match(/  parameters:\s*\n((?:    [^\n]*\n)+)/);
  if (prm) console.log(prm[1]);
  const refs = [...new Set([...text.matchAll(/\$ref: "#\/components\/parameters\/(\w+)"/g)].map((m) => m[1]))];
  console.log('parametre $ref isimleri:', refs.join(', '));
  for (const r of refs) {
    const re = new RegExp(`    ${r}:\\s*\\n((?:      [^\\n]*\\n)+)`);
    const m = text.match(re);
    if (m) console.log(`  ${r}:`, m[1].trim().replace(/\n\s+/g, ' | '));
  }
  const schemas = [...new Set([...text.matchAll(/^    (\w+):\s*$/gm)].map((m) => m[1]))];
  hr('OPENAPI şema isimleri');
  console.log(schemas.join(', '));
  const enums = [...text.matchAll(/enum: \[[^\]]*\]/g)].map((m) => m[0]);
  hr('OPENAPI enum değerleri');
  console.log([...new Set(enums)].join('\n') || '(enum yok)');
} catch (e) { console.log('openapi analiz hatası:', e.message); }

/* 2) v1/matches şeması */
try {
  const m = load(byName('v1-matches')).body;
  hr('/api/v1/matches/ şeması');
  console.log('üst anahtarlar:', keysOf(m).join(', '));
  const arr = m.matches ?? m.data ?? m.items;
  if (Array.isArray(arr)) {
    console.log('maç sayısı:', arr.length);
    console.log('maç anahtarları:', keysOf(arr[0]).join(', '));
    console.log('ilk maç:', JSON.stringify(arr[0]).slice(0, 800));
    const st = {}; arr.forEach((x) => { st[x.status] = (st[x.status] || 0) + 1; });
    console.log('statü dağılımı:', JSON.stringify(st));
  } else console.log('gövde:', JSON.stringify(m).slice(0, 500));
} catch (e) { console.log('v1-matches hatası:', e.message); }

/* 3) v1/fixtures şeması */
try {
  const m = load(byName('v1-fixtures')).body;
  hr('/api/v1/fixtures/ şeması');
  console.log('üst anahtarlar:', keysOf(m).join(', '));
  const arr = m.fixtures ?? m.data ?? m.matches;
  if (Array.isArray(arr)) {
    console.log('maç sayısı:', arr.length);
    console.log('maç anahtarları:', keysOf(arr[0]).join(', '));
    console.log('ilk maç:', JSON.stringify(arr[0]).slice(0, 800));
    const st = {}; arr.forEach((x) => { st[x.status] = (st[x.status] || 0) + 1; });
    console.log('statü dağılımı:', JSON.stringify(st));
  } else console.log('gövde:', JSON.stringify(m).slice(0, 500));
} catch (e) { console.log('v1-fixtures hatası:', e.message); }

/* 4) widget/match şeması (futbol + basketbol farkları) */
for (const frag of ['widget-match-football', 'widget-match-basketball']) {
  try {
    const m = load(byName(frag)).body;
    hr(`/api/widget/match/ — ${frag}`);
    console.log('üst anahtarlar:', keysOf(m).join(', '));
    const deep = (m.match ?? m.data ?? m);
    console.log('iç anahtarlar:', keysOf(deep).join(', '));
    console.log('gövde (ilk 1200):', JSON.stringify(deep).slice(0, 1200));
  } catch (e) { console.log(frag, 'hatası:', e.message); }
}

/* 5) v1/search sonuçları — hedef lig eşleşmeleri */
try {
  hr('/api/v1/search/ — yanıt yapısı ve hedef ligler');
  const first = load(byName('v1-search-premier-league')).body;
  console.log('üst anahtarlar:', keysOf(first).join(', '));
  const arr = first.results ?? first.data ?? first.items;
  if (Array.isArray(arr) && arr.length) {
    console.log('sonuç anahtarları:', keysOf(arr[0]).join(', '));
    console.log('örnek sonuç:', JSON.stringify(arr[0]).slice(0, 400));
  } else {
    console.log('gövde:', JSON.stringify(first).slice(0, 400));
  }
  const targets = {
    'premier-league': 'Premier League', 's-per-lig': 'Süper Lig', 'tff-1-lig': 'TFF 1. Lig',
    'la-liga': 'La Liga', 'serie-a': 'Serie A', 'bundesliga': 'Bundesliga', 'ligue-1': 'Ligue 1',
    'uefa-champions-league': 'UEFA ŞL', 'uefa-europa-league': 'UEFA AL', 'nba': 'NBA', 'euroleague': 'EuroLeague'
  };
  for (const [frag, label] of Object.entries(targets)) {
    const f = byName(`v1-search-${frag}`);
    if (!f) { console.log(`✗ ${label}: dosya yok`); continue; }
    const b = load(f).body;
    const arr2 = b.results ?? b.data ?? b.items ?? [];
    const comp = arr2.filter((x) => JSON.stringify(x).match(/competition|league|tournament/i));
    console.log(`\n${label} (${arr2.length} sonuç):`);
    for (const c of arr2.slice(0, 3)) console.log('   ', JSON.stringify(c).slice(0, 260));
  }
} catch (e) { console.log('search analiz hatası:', e.message); }

/* 6) widget matches — statü/alan gözden geçirme (bugünkü) */
try {
  const w = load(byName('widget-matches-football')).body;
  hr('widget/matches football (taze)');
  console.log('count:', w.count, '| maç sayısı:', w.matches.length, '| updated:', w.updated);
  console.log('statüler:', [...new Set(w.matches.map((m) => m.status))].join(', '));
  console.log('tarih örnekleri:', w.matches.slice(0, 3).map((m) => `${m.time} (${m.status})`).join(' | '));
} catch (e) { console.log('widget analiz hatası:', e.message); }
