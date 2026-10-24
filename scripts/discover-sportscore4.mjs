/** Aşama 0 — TFF 1. Lig doğrulama: "Turkish First" araması */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples');
const url = 'https://sportscore.com/api/v1/search/?q=' + encodeURIComponent('Turkish First') + '&sport=football&limit=10';

const res = await fetch(url, { headers: { 'User-Agent': 'TribunLocal-Discovery/1.0', Accept: 'application/json' } });
const body = await res.json();
fs.writeFileSync(path.join(SAMPLES, '208-son-search-turkish-first.json'),
  JSON.stringify({ name: 'son-search-turkish-first', url, status: res.status, headers: {}, body }, null, 2));
console.log('HTTP', res.status, '|', (body.competitions ?? []).length, 'competition');
for (const c of body.competitions ?? []) console.log(`  "${c.name}" | ${c.slug} | ${c.url}`);
