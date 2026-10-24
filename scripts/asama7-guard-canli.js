/**
 * AŞAMA 7 canlı kanıt betiği — %50 / boş yanıt koruma kuralları
 *
 * Gerçek DB (data/tribun.db) üzerinde syncStandingsRound'u ENJEKTE fetcher
 * ile çağırır: SportScore'a istek ATILMAZ, bütçe HARCANMAZ.
 * Kanıt hedefleri (talimat kabul kriteri: "Boş yanıtta eski veri korunuyor"):
 *   A) Boş yanıt (rows: [])  → red; Süper Lig satır sayısı DEĞİŞMEZ
 *   B) Yarıdan az yanıt (18 → 5 satır) → red (rejected_shrink); satırlar DEĞİŞMEZ
 *
 * Kullanım: node scripts/asama7-guard-canli.js   (tribun kökünden)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../server/db');
const { syncStandingsRound } = require('../server/services/syncStandings');

const compId = db.prepare("SELECT id FROM competitions WHERE slug = 'turkish-super-league'").get().id;
const rowCount = () =>
  db.prepare('SELECT COUNT(*) AS c FROM standings WHERE competition_id = ?').get(compId).c;

const BASLANGIC = rowCount();
console.log(`[başlangıç] Süper Lig standings satırı: ${BASLANGIC}`);

/* A) BOŞ YANIT */
const emptyFetcher = async () => ({ json: { sport: 'football', competition_slug: 'turkish-super-league', tables: [{ group: '', rows: [] }] } });

/* B) %50'NİN ALTINDA KÜÇÜLMÜŞ YANIT (18 → 5) */
const rows5 = Array.from({ length: 5 }, (_, i) => ({
  pos: i + 1, team: `Küçük Takım ${i + 1}`, p: 1, w: 1, d: 0, l: 0, gf: 1, ga: 0, gd: 1, pts: 3
}));
const shrinkFetcher = async () => ({ json: { sport: 'football', competition_slug: 'turkish-super-league', tables: [{ group: '', rows: rows5 }] } });

(async () => {
  const rA = await syncStandingsRound({ competitions: ['turkish-super-league'], fetcher: emptyFetcher, phase: 'manual-test-empty' });
  const afterA = rowCount();
  const cA = rA.comps[0];
  console.log(`[A] boş yanıt → result=${cA.result}, gerekçe: "${cA.reason}"; satır sayısı: ${BASLANGIC} → ${afterA} ${afterA === BASLANGIC ? '✅ ESKİ VERİ KORUNDU' : '❌ DEĞİŞTİ'}`);

  const rB = await syncStandingsRound({ competitions: ['turkish-super-league'], fetcher: shrinkFetcher, phase: 'manual-test-shrink' });
  const afterB = rowCount();
  const cB = rB.comps[0];
  console.log(`[B] küçük yanıt (5 < ${Math.ceil(BASLANGIC * 0.5)}) → result=${cB.result}, gerekçe: "${cB.reason}"; satır sayısı: ${BASLANGIC} → ${afterB} ${afterB === BASLANGIC ? '✅ ESKİ VERİ KORUNDU' : '❌ DEĞİŞTİ'}`);

  process.exit((afterA === BASLANGIC && afterB === BASLANGIC) ? 0 : 1);
})();
