#!/bin/bash
# Tribün — AŞAMA 8 tek-oturum backend doğrulaması
# (sandbox süreçleri oturum sonunda temizlediği için sunucu + testler
#  TEK bash çağrısında koşar)
set -u
cd /home/z/my-project/tribun

echo "=== sunucu başlatılıyor ==="
node server/index.js > /tmp/tribun.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT

# hazır olana dek bekle (en çok 15 sn)
for i in $(seq 1 30); do
  if curl -s -m 2 -o /dev/null "http://localhost:3000/api/sports/competitions"; then break; fi
  sleep 0.5
done
echo "sunucu ayakta (pid $SRV)"

echo
echo "=== 1) BİTMİŞ maç detayı (id 7 — Sivasspor) ==="
curl -s -m 20 "http://localhost:3000/api/sports/matches/7/detail" -o /tmp/d7.json -w "HTTP %{http_code}\n"
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/d7.json','utf8'));
console.log('available:', d.available, '| flags:', 'E:'+d.has_events, 'S:'+d.has_stats, 'L:'+d.has_lineups);
console.log('maç:', d.match.home.display_name, d.match.home.score, '-', d.match.away.score, d.match.away.display_name, '| durum:', d.match.status, '| İY:', d.match.ht_home+'-'+d.match.ht_away, '| lig:', d.match.competition.name);
console.log('olay:', d.sections.events.items.length, '| ist:', d.sections.stats.items.length, '| ilk11:', d.sections.lineups.home_xi.length, '| yedek:', d.sections.lineups.home_subs.length);
console.log('meta:', JSON.stringify(d.meta));
console.log('olay türleri:', [...new Set(d.sections.events.items.map(i=>i.type))].join(','));
console.log('istatistikler:', d.sections.stats.items.map(s=>s.labelTr+' '+s.home+s.suffix+'/'+s.away+s.suffix).join(' | '));
console.log('dakikalar:', d.sections.events.items.map(i=>i.minute).join(','));
"

echo
 echo "=== 2) TTL/bütçe: aynı bitmiş maça 10 üst üste istek → api_usage ARTMAZ ==="
node -e "
const db=require('./server/db');
const before = db.prepare(\"SELECT COALESCE(SUM(count),0) c FROM api_usage WHERE day_utc=STRFTIME('%Y-%m-%d','now') AND endpoint='/api/widget/match/'\").get().c;
console.log('detay çağrısı (önce):', before);
db.close();"
for i in $(seq 1 10); do curl -s -o /dev/null "http://localhost:3000/api/sports/matches/7/detail"; done
node -e "
const db=require('./server/db');
const after = db.prepare(\"SELECT COALESCE(SUM(count),0) c FROM api_usage WHERE day_utc=STRFTIME('%Y-%m-%d','now') AND endpoint='/api/widget/match/'\").get().c;
console.log('detay çağrısı (10 istek sonrası):', after);
db.close();"

echo
echo "=== 3) CANLI maç detayı (dakika + skor tahtası) ==="
LIVE_ID=$(node -e "
const db=require('./server/db');
const r = db.prepare(\"SELECT id FROM matches WHERE sport='football' AND status IN ('live','halftime') ORDER BY kickoff_utc LIMIT 1\").get();
console.log(r ? r.id : ''); db.close();")
echo "canlı maç id: $LIVE_ID"
if [ -n "$LIVE_ID" ]; then
  curl -s -m 20 "http://localhost:3000/api/sports/matches/$LIVE_ID/detail" -o /tmp/dl.json -w "HTTP %{http_code}\n"
  node -e "
  const d = JSON.parse(require('fs').readFileSync('/tmp/dl.json','utf8'));
  console.log('available:', d.available, '| dakika:', d.match.minute, '| skor:', d.match.home.score+'-'+d.match.away.score, '| durum:', d.match.status, d.match.period);
  console.log('meta:', JSON.stringify(d.meta));
  "
  echo "--- 60 sn TTL: hemen ikinci istek (bütçe artmaz) + fetched_at gösterimi ---"
  node -e "
  const db=require('./server/db');
  const b = db.prepare(\"SELECT COALESCE(SUM(count),0) c FROM api_usage WHERE day_utc=STRFTIME('%Y-%m-%d','now') AND endpoint='/api/widget/match/'\").get().c;
  console.log('istek (önce):', b); db.close();"
  curl -s -o /dev/null "http://localhost:3000/api/sports/matches/$LIVE_ID/detail"
  node -e "
  const db=require('./server/db');
  const a = db.prepare(\"SELECT COALESCE(SUM(count),0) c FROM api_usage WHERE day_utc=STRFTIME('%Y-%m-%d','now') AND endpoint='/api/widget/match/'\").get().c;
  console.log('istek (sonra):', a, '(TTL taze → artış 0 olmalı)'); db.close();"
fi

echo
echo "=== 4) BASKETBOL reddi ==="
BB_ID=$(node -e "
const db=require('./server/db');
const r = db.prepare(\"SELECT id FROM matches WHERE sport='basketball' LIMIT 1\").get();
console.log(r ? r.id : ''); db.close();")
echo "basketbol maç id: $BB_ID"
curl -s -m 10 "http://localhost:3000/api/sports/matches/$BB_ID/detail" | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);console.log('HTTP gövde:', JSON.stringify({available:d.available, reason:d.reason, message:d.message}));})"

echo
echo "=== 5) hata durumları ==="
curl -s -o /dev/null -w "harf id → HTTP %{http_code}\n" "http://localhost:3000/api/sports/matches/abc/detail"
curl -s -o /dev/null -w "olmayan id → HTTP %{http_code}\n" "http://localhost:3000/api/sports/matches/999999/detail"
SCHED_ID=$(node -e "
const db=require('./server/db');
const r = db.prepare(\"SELECT id FROM matches WHERE sport='football' AND status='scheduled' LIMIT 1\").get();
console.log(r ? r.id : ''); db.close();")
curl -s "http://localhost:3000/api/sports/matches/$SCHED_ID/detail" | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);console.log('başlamamış maç →', JSON.stringify({available:d.available, reason:d.reason}));})"

echo
echo "=== 6) hız limiti: 35 hızlı istek → 429 beklenir (30/dk) ==="
HIT429=0
for i in $(seq 1 35); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/sports/matches/7/detail")
  if [ "$CODE" = "429" ]; then HIT429=$((HIT429+1)); fi
done
echo "429 sayısı: $HIT429 (≥1 olmalı; kalan istekler 200)"

echo
echo "=== 7) match_details örnek kayıt + unmapped_values ==="
node -e "
const db=require('./server/db');
const rows = db.prepare('SELECT kind, payload, fetched_at, source_updated FROM match_details WHERE match_id = 7 ORDER BY kind').all();
for (const r of rows) {
  const p = JSON.parse(r.payload);
  console.log('--- kind:', r.kind, '| fetched_at:', r.fetched_at, '| source_updated:', r.source_updated);
  if (r.kind === 'events') console.log('    olay[0]:', JSON.stringify(p.items[0]));
  if (r.kind === 'stats') console.log('    ist[0]:', JSON.stringify(p.items[0]));
  if (r.kind === 'scoreboard') console.log('    ', JSON.stringify(p));
  if (r.kind === 'lineups') console.log('    dizilim:', p.homeFormation, '| ilk11:', p.homeXi.length, '| yedek:', p.homeSubs.length);
}
const un = db.prepare(\"SELECT kind, raw_value, hits FROM unmapped_values WHERE kind IN ('incident_type','stats_label') ORDER BY kind, raw_value\").all();
console.log('--- unmapped_values (olay türü + istatistik etiketi):');
for (const u of un) console.log('   ', u.kind, '→', u.raw_value, '(hits:', u.hits + ')');
db.close();
"

echo
echo "=== bitti ==="
