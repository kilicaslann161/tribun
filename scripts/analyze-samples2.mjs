#!/usr/bin/env node
/** Aşama 0 — analiz #2: search competitions + maç detayının stats/lineups/incidents tam içeriği */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples');
const files = fs.readdirSync(SAMPLES).sort();
const load = (f) => JSON.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8'));
const byName = (frag) => files.find((f) => f.includes(frag));
const hr = (t) => console.log('\n' + '='.repeat(12), t, '='.repeat(12));

/* 1) Her search yanıtından competitions + teams dizileri */
const targets = {
  'v1-search-premier-league': 'Premier League', 'v1-search-s-per-lig': 'Süper Lig', 'v1-search-tff-1-lig': 'TFF 1. Lig',
  'v1-search-la-liga': 'La Liga', 'v1-search-serie-a': 'Serie A', 'v1-search-bundesliga': 'Bundesliga',
  'v1-search-ligue-1': 'Ligue 1', 'v1-search-uefa-champions-league': 'UEFA ŞL', 'v1-search-uefa-europa-league': 'UEFA AL',
  'v1-search-nba': 'NBA', 'v1-search-euroleague': 'EuroLeague'
};
const foundLeagues = {};
for (const [frag, label] of Object.entries(targets)) {
  const f = byName(frag);
  if (!f) continue;
  const b = load(f).body;
  const comps = b.competitions ?? [];
  const teams = (b.teams ?? []).slice(0, 2);
  console.log(`\n### ${label} — ${comps.length} competition, ${(b.teams ?? []).length} team, ${(b.players ?? []).length} player`);
  for (const c of comps.slice(0, 4)) console.log('   COMP:', JSON.stringify(c));
  if (!comps.length && teams.length) console.log('   (competition yok; team örneği):', JSON.stringify(teams[0]).slice(0, 200));
  if (comps.length) foundLeagues[label] = comps[0];
}
hr('İLK BAKIŞTA EŞLEŞENLER');
for (const [k, v] of Object.entries(foundLeagues)) console.log(k, '→', JSON.stringify(v));

/* 2) widget/match futbol — stats + lineups + incidents özeti */
try {
  const m = load(byName('widget-match-football')).body.match;
  hr('widget/match futbol — detay alanları');
  console.log('live_minute:', m.live_minute, '| ht:', m.home_ht_score, '-', m.away_ht_score);
  console.log('incidents sayısı:', (m.incidents ?? []).length);
  const types = {};
  (m.incidents ?? []).forEach((i) => { types[i.type] = (types[i.type] || 0) + 1; });
  console.log('incident tipleri:', JSON.stringify(types));
  const goal = (m.incidents ?? []).find((i) => /goal/i.test(i.type));
  console.log('gol örneği:', goal ? JSON.stringify(goal) : 'YOK (bu maçta gol yok)');
  console.log('\nstats:', JSON.stringify(m.stats).slice(0, 900));
  console.log('\nlineups tür:', m.lineups === null ? 'null' : Array.isArray(m.lineups) ? `dizi (${m.lineups.length})` : typeof m.lineups);
  console.log('lineups:', JSON.stringify(m.lineups)?.slice(0, 900));
  console.log('\ntracker:', JSON.stringify(m.tracker));
} catch (e) { console.log('detay hatası:', e.message); }

/* 3) v1/fixtures — sayfa/limit gözlemi + basketbol sporu */
try {
  const m = load(byName('v1-fixtures')).body;
  hr('v1/fixtures gözlem');
  console.log('count:', m.count, 'dönen:', m.matches.length, 'date:', m.date);
  console.log('zaman biçimi örnek:', m.matches[0].time);
} catch (e) { console.log('fixtures hatası:', e.message); }
