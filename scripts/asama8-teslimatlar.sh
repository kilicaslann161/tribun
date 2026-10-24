#!/bin/bash
# AŞAMA 8 — teslimat toplama: test çıktıları + match_details örneği + unmapped + backend kanıtları
set -u
cd /home/z/my-project/tribun
DL=/home/z/my-project/download

echo "=== 1) npm test (tam çıktı) ==="
npm test > /tmp/asama8-npmtest.txt 2>&1
tail -8 /tmp/asama8-npmtest.txt

echo
echo "=== 2) single-flight + AŞAMA 8 test dosyası çıktısı ==="
node --test server/tests/matchDetail.test.js > /tmp/asama8-test.txt 2>&1
rg "✔|✖|pass|fail" /tmp/asama8-test.txt | head -25

echo
echo "=== 3) backend doğrulama (sunucu + API kanıtları) ==="
bash scripts/asama8-backend-check.sh > /tmp/asama8-backend.txt 2>&1
head -50 /tmp/asama8-backend.txt

echo
echo "=== 4) teslimat dosyaları ==="
node -e "
const db = require('./server/db');
const fs = require('fs');

/* match_details örnek kayıt (bitmiş maç 7 — tüm kind'ler) */
const rows = db.prepare('SELECT match_id, kind, schema_version, fetched_at, source_updated, payload FROM match_details WHERE match_id = 7 ORDER BY kind').all()
  .map((r) => {
    let p = null; try { p = JSON.parse(r.payload); } catch {}
    if (p && Array.isArray(p.items) && p.items.length > 3) p = { ...p, items: p.items.slice(0, 3), _not: '... kısaltıldı (tam liste ' + p.items.length + ' madde)' };
    if (p && Array.isArray(p.home_xi) && p.home_xi.length > 3) p = { ...p, home_xi: p.home_xi.slice(0, 3), _not_home_xi: '... (' + p.home_xi.length + ' oyuncu)' };
    if (p && Array.isArray(p.home_subs) && p.home_subs.length > 3) p = { ...p, home_subs: p.home_subs.slice(0, 3), _not_home_subs: '... (' + p.home_subs.length + ' oyuncu)' };
    if (p && Array.isArray(p.away_xi) && p.away_xi.length > 3) p = { ...p, away_xi: p.away_xi.slice(0, 3), _not_away_xi: '... (' + p.away_xi.length + ' oyuncu)' };
    return { ...r, payload: p };
  });
fs.writeFileSync('$DL/asama8-match-details-ornek.json', JSON.stringify({ mac_id: 7, aciklama: 'Bitmiş futbol maçı (Umraniyespor 4-0 Sivasspor) — match_details tablosundan örnek kayıtlar', satirlar: rows }, null, 2));
console.log('✓ asama8-match-details-ornek.json (' + rows.length + ' kind satırı)');

/* unmapped_values: olay türleri + istatistik etiketleri */
const un = db.prepare(\"SELECT kind, raw_value, sport, hits, seen_at FROM unmapped_values WHERE kind IN ('incident_type','stats_label') ORDER BY kind, raw_value\").all();
fs.writeFileSync('$DL/asama8-unmapped-olay-istatistik.json', JSON.stringify({ aciklama: 'Maç detayı normalizasyonunda sözlük dışı kalan değerler (bilinçli olarak eşlenmez — talimat)', adet: un.length, kayitlar: un }, null, 2));
console.log('✓ asama8-unmapped-olay-istatistik.json (' + un.length + ' kayıt)');
for (const u of un) console.log('   ', u.kind, '→', u.raw_value, '(hits: ' + u.hits + ')');

/* günlük detay bütçesi kanıtı */
const usage = db.prepare(\"SELECT day_utc, endpoint, count FROM api_usage WHERE endpoint = '/api/widget/match/' ORDER BY day_utc DESC LIMIT 3\").all();
console.log('✓ api_usage (detay ucu):', JSON.stringify(usage));
db.close();
"

echo
echo "=== 5) teslimat özeti dosyası ==="
{
  echo "TRİBÜN — AŞAMA 8 TESLİMATLARI (MAÇ DETAYI · YALNIZCA FUTBOL)"
  echo "Tarih: $(date '+%Y-%m-%d %H:%M') TZ"
  echo
  echo "──── 1. TESTLER (node:test) ────"
  echo "npm test: $(rg -o 'pass \\d+' /tmp/asama8-npmtest.txt | head -1) / $(rg -o 'fail \\d+' /tmp/asama8-npmtest.txt | head -1) — $(rg -o 'tests \\d+' /tmp/asama8-npmtest.txt | head -1) test"
  echo "AŞAMA 8 dosyası: server/tests/matchDetail.test.js (17 test)"
  echo
  echo "--- single-flight test çıktısı (10 eşzamanlı istek = 1 SportScore çağrısı) ---"
  rg -A 2 "tek-uçuş" /tmp/asama8-test.txt | head -6
  echo
  echo "--- test listesi ---"
  rg "✔" /tmp/asama8-test.txt | head -20
  echo
  echo "──── 2. BACKEND KANITLARI ────"
  cat /tmp/asama8-backend.txt
  echo
  echo "──── 3. TASARIM KARARLARI ────"
  cat <<'NOTLAR'
- TTL: canlı 60 sn (SportScore önbelleğiyle aynı); başlamamış maç HİÇ çekilmez;
  bitmiş maç ilk başarılı çekimden sonra kalıcı + bitiş+30dk'da TEK düzeltme çekiği
  (matchDetailCore.detailTtlDecision — SAF, tablo testli).
- Tek-uçuş match id bazlı (sportScoreClient'ın URL tek-uçuşuna EK): 10 eşzamanlı
  istek tek fetch + tek bütçe harcaması + tek transaction.
- Günlük detay tavanı: api_usage'tan endpoint bazlı sayaç, SPORTSCORE_DETAIL_DAILY_CAP
  (varsayılan 1000) + sportScoreClient 'low' öncelik bütçe kademeleri.
- Kimlik denetimi: tracker.id (yoksa url kimliği) ≠ matches.external_id → kayıt YOK +
  konsol logu; eski veri varsa stale:true ile korunur.
- Skor koruması: detay skoru taraftar bazında listeden düşükse matches'e YAZILMAZ,
  match_details('scoreboard') içinde yaşar (liste/detay önbellek farkı).
- Durum (status) bilinçli yazılmaz: durum geçişleri Aşama 5 korumalarının işi.
- Yazma TEK transaction: 4 match_details kind (scoreboard/events/stats/lineups,
  lineups yalnız veri varsa) + matches.minute/ht_home/ht_away + unmapped_values.
- Ham sağlayıcı yanıtı asla dışarı çıkmaz; yanıtta yalnız normalize edilmiş
  bölümler + has_events/has_stats/has_lineups bayrakları + meta (fetched_at,
  source_updated, stale, stale_reason).
- Hız limiti: IP başına 30/dk (detailLimiter) + mevcut 120/dk sportsLimiter.
- Frontend: #/mac/:id — skor tahtası (lig adı #/lig/:slug'ya bağlantılı), iki yana
  açık olay çizelgesi (inline SVG ikonlar: gol/penaltı/kart/değişiklik/VAR/genel),
  home_pct/away_pct karşılaştırmalı çubuklar, mevki gruplu kadrolar (rating YOK,
  saha çizimi YOK), 60 sn canlı yenileme (sekme gizliyken durur), "Son güncelleme"
  + bayat veri şeridi, Powered by SportScore. Ana sayfada yalnız has_detail'li
  futbol satırları GERÇEK <a>; basketbol satırları linklenmez. Üst menüde yeni
  öğe yok.
NOTLAR
} > "$DL/asama8-teslimatlar.txt"
echo "✓ asama8-teslimatlar.txt"
echo
ls -la "$DL" | rg "asama8"