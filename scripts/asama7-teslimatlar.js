/**
 * AŞAMA 7 teslimat toplayıcı:
 *  1) standings tablosundan örnek satırlar (Süper Lig tamamı + UCL'den
 *     team_id=NULL örnekleri) → download/asama7-standings-ornek-satirlar.json
 *  2) eşleşmeyen takım adları (standings.team_id NULL; unmapped_values kaydı
 *     kind='team_name') → download/asama7-eslesmeyen-takim-adlari.json
 * Kullanım: node scripts/asama7-teslimatlar.js  (tribun kökünden)
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../server/db');

const OUT = '/home/z/my-project/download';

/* 1) örnek satırlar: Süper Lig'in tamamı + UCL'den 3 NULL örnek */
const sl = db.prepare(`
  SELECT c.slug AS competition, s.group_name, s.position, s.team_id,
         s.team_name, s.played, s.won, s.drawn, s.lost,
         s.goals_for, s.goals_against, s.goal_diff, s.points,
         s.promo_color, s.promo_name, s.updated_at
    FROM standings s JOIN competitions c ON c.id = s.competition_id
   WHERE c.slug = 'turkish-super-league'
   ORDER BY s.group_name, s.position
`).all();

const uclNull = db.prepare(`
  SELECT c.slug AS competition, s.group_name, s.position, s.team_id,
         s.team_name, s.played, s.won, s.drawn, s.lost,
         s.goals_for, s.goals_against, s.goal_diff, s.points,
         s.promo_color, s.promo_name, s.updated_at
    FROM standings s JOIN competitions c ON c.id = s.competition_id
   WHERE c.slug = 'uefa-champions-league' AND s.team_id IS NULL
   ORDER BY s.position LIMIT 3
`).all();

const toplamSatir = db.prepare('SELECT COUNT(*) AS c FROM standings').get().c;
const eslesen = db.prepare('SELECT COUNT(*) AS c FROM standings WHERE team_id IS NOT NULL').get().c;

fs.writeFileSync(path.join(OUT, 'asama7-standings-ornek-satirlar.json'), JSON.stringify({
  aciklama: 'AŞAMA 7 — standings tablosundan örnek satırlar (Süper Lig 18/18 tamamı; team_id, name_key eşleşmesiyle maçlardaki teams tablosundan gelir)',
  istatistik: {
    toplam_standings_satiri: toplamSatir,
    team_id_eslesen: eslesen,
    team_id_eslesmeyen: toplamSatir - eslesen,
    su_super_lig_satiri: sl.length,
    su_super_lig_eslesen: sl.filter((r) => r.team_id).length
  },
  super_lig_tam_tablo: sl,
  uefa_sampiyonlar_ligi_team_id_null_ornek: uclNull
}, null, 2), 'utf8');

/* 2) eşleşmeyen takım adları: standings'ta NULL kalanlar */
const eslesmeyen = db.prepare(`
  SELECT c.slug AS competition, s.team_name AS raw_value, 'team_name' AS kind, c.sport
    FROM standings s JOIN competitions c ON c.id = s.competition_id
   WHERE s.team_id IS NULL ORDER BY c.slug, s.position
`).all();

const unmappedDbKaydi = db.prepare(`
  SELECT raw_value, sport, hits, seen_at
    FROM unmapped_values WHERE kind = 'team_name'
   ORDER BY raw_value
`).all();

fs.writeFileSync(path.join(OUT, 'asama7-eslesmeyen-takim-adlari.json'), JSON.stringify({
  aciklama: [
    'AŞAMA 7 — puan durumunda name_key (matchNormalizer.nameKey) üzerinden teams tablosuna eşleşemeyen adlar.',
    'Kural: puan durumundan YENİ teams satırı açılmaz; eşleşmeyen ad unmapped_values(kind=team_name)\'e yazılır, satır team_id=NULL ile yaşar.',
    'Bu adların takımları fikstür senkronu kapsamına girdiğinde (maç günü D-2..D+7 aralığına düştüğünde) sonraki puan durumu turunda otomatik eşleşir.'
  ],
  not: 'unmapped_values tablosunda ayrıca Aşama 2/3\'ten (fikstür senkronu "ilk görüş" kuralı) gelen 200+ geçmiş kayıt vardır; AŞAMA 7\'nin gerçek eşleşmeyenleri aşağıdaki listedir.',
  eslesmeyen_sayisi: eslesmeyen.length,
  eslesmeyen: eslesmeyen,
  unmapped_values_toplam_kayit: unmappedDbKaydi.length
}, null, 2), 'utf8');

console.log('✅ asama7-standings-ornek-satirlar.json ve asama7-eslesmeyen-takim-adlari.json yazıldı');
console.log(`   standings: ${toplamSatir} satır, ${eslesen} eşleşme, ${toplamSatir - eslesen} eşleşmeyen`);
