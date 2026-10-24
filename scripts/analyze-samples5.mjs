#!/usr/bin/env node
/** Aşama 1 — örneklerden 11 doğrulanmış ligin logo URL'lerini çıkar (isteksiz) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples');
const files = fs.readdirSync(SAMPLES);

const WANT = [
  'turkish-super-league', 'turkish-first-league', 'english-premier-league', 'spanish-la-liga',
  'italian-serie-a', 'bundesliga', 'french-ligue-1', 'uefa-champions-league',
  'uefa-europa-league', 'national-basketball-association', 'euroleague'
];

for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
    const comps = j?.body?.competitions ?? [];
    for (const c of comps) {
      if (WANT.includes(c.slug) && c.logo !== undefined) {
        console.log(`${c.slug} | ${c.name} | logo: ${c.logo || '(BOS)'}`);
      }
    }
  } catch { /* yoksay */ }
}
