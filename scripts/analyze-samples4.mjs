#!/usr/bin/env node
/** Aşama 0 — analiz #4: fixtures'taki gerçek lig adları (search terimi üretmek için) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples');
const files = fs.readdirSync(SAMPLES).sort();
const load = (f) => JSON.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
const byName = (frag) => files.find((f) => f.includes(frag));

const fx = load(byName('v1-fixtures')).body;
const comps = {};
for (const m of fx.matches) comps[m.competition] = (comps[m.competition] || 0) + 1;
console.log('bugünkü', fx.matches.length, 'maçta geçen ligler:');
for (const [name, n] of Object.entries(comps).sort((a, b) => b[1] - a[1])) console.log(`  ${name} (${n})`);

const wm = load(byName('ek-widget-matches-limit50')).body;
const comps2 = {};
for (const m of wm.matches) comps2[m.competition] = (comps2[m.competition] || 0) + 1;
console.log('\nwidget limit=50 yanıtındaki ligler:');
for (const [name, n] of Object.entries(comps2).sort((a, b) => b[1] - a[1])) console.log(`  ${name} (${n})`);
