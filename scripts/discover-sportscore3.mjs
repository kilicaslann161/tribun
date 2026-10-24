#!/usr/bin/env node
/** Aşama 0 — son mini keşif: ülke-önekli ad kalıplarıyla eksik hedef ligler */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples');
const UA = 'TribunLocal-Discovery/1.0';
const BASE = 'https://sportscore.com';
const MAX = 8, GAP = 1100;
let used = 0, seq = 200, lastAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hit(name, url) {
  if (used >= MAX) return null;
  const w = lastAt + GAP - Date.now();
  if (w > 0) await sleep(w);
  lastAt = Date.now(); used++; seq++;
  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { }
  fs.writeFileSync(path.join(SAMPLES, `2${String(seq).slice(1)}-${name}.json`),
    JSON.stringify({ name, url, status: res.status, ms: Date.now() - t0, headers: {}, body }, null, 2));
  const comps = body?.competitions ?? [];
  console.log(`${res.status === 200 ? '✓' : '·'} ${name} → ${res.status} | ${comps.length} comp`);
  for (const c of comps.slice(0, 5)) console.log(`    "${c.name}" | ${c.slug} | ${c.url}`);
  return body;
}

(async () => {
  await hit('son-search-english-premier', `${BASE}/api/v1/search/?q=${encodeURIComponent('English Premier')}&sport=football&limit=10`);
  await hit('son-search-turkish-super', `${BASE}/api/v1/search/?q=${encodeURIComponent('Turkish Super')}&sport=football&limit=10`);
  await hit('son-search-1-lig', `${BASE}/api/v1/search/?q=${encodeURIComponent('1. Lig')}&sport=football&limit=10`);
  await hit('son-search-spanish-laliga', `${BASE}/api/v1/search/?q=${encodeURIComponent('Spanish LaLiga')}&sport=football&limit=10`);
  await hit('son-search-national-basketball', `${BASE}/api/v1/search/?q=${encodeURIComponent('National Basketball')}&sport=basketball&limit=10`);
  await hit('son-search-nba-tam-ad', `${BASE}/api/v1/search/?q=${encodeURIComponent('National Basketball Association')}&sport=basketball&limit=10`);
  await hit('son-search-spanish-la-liga', `${BASE}/api/v1/search/?q=${encodeURIComponent('Spanish La Liga')}&sport=football&limit=10`);
  console.log(`\nson mini: ${used}/${MAX} | toplam örnek: ${fs.readdirSync(SAMPLES).length}`);
})();
