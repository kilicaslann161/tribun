#!/bin/bash
# AŞAMA 8 — UI doğrulama 2: CANLI maç sayfası + 60 sn yenileme + TTL bütçe + stale
set -u
cd /home/z/my-project/tribun
DL=/home/z/my-project/download

node server/index.js > /tmp/tribun.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -m 2 -o /dev/null "http://localhost:3000/" && break; sleep 0.5; done
echo "✓ sunucu hazır"

LIVE_ID=$(node -e "
const db=require('./server/db');
const r = db.prepare(\"SELECT id, home_score, away_score, status, period FROM matches WHERE sport='football' AND status IN ('live','halftime' AND id NOT IN (14)) ORDER BY kickoff_utc LIMIT 1\").get() || db.prepare(\"SELECT id FROM matches WHERE sport='football' AND status IN ('live','halftime') LIMIT 1\").get();
console.log(r ? r.id : ''); db.close();")
echo "canlı maç id: $LIVE_ID"
if [ -z "$LIVE_ID" ]; then echo "CANLI MAÇ YOK — test atlandı"; exit 0; fi

agent-browser close > /dev/null 2>&1 || true

echo
echo "=== A) 404 düzeltmesi: olmayan maç → dost sayfa ==="
agent-browser set viewport 1280 900
agent-browser open "http://localhost:3000/#/mac/999999"
agent-browser wait --load networkidle
agent-browser wait 900
agent-browser eval "document.body.innerText.includes('Böyle bir maç yok') ? 'dost 404 sayfası OK' : 'HATA'"

echo
echo "=== B) CANLI MAÇ SAYFASI (masaüstü) ==="
agent-browser open "http://localhost:3000/#/mac/$LIVE_ID"
agent-browser wait --load networkidle
agent-browser wait 2000
agent-browser eval "
(() => {
  const q = (s) => document.querySelector(s);
  return JSON.stringify({
    skor: q('.md-score') ? q('.md-score').textContent.trim() : null,
    canliRozet: !!q('.md-live-badge'),
    durumMetni: q('.md-status') ? q('.md-status').textContent.trim() : null,
    dakika: q('.md-minute') ? q('.md-minute').textContent : 'YOK',
    devreSkoru: q('.md-ht') ? q('.md-ht').textContent : null,
    sonGuncelleme: document.getElementById('mdUpdated') ? document.getElementById('mdUpdated').textContent : null,
    bayatUyarisi: !document.getElementById('mdStale').hidden,
    olaySayisi: document.querySelectorAll('.md-ev').length
  });
})()
"
agent-browser screenshot "$DL/asama8-4-canli-mac-masaustu.png" --full

echo
echo "=== C) TTL: sayfayı 5 kez hızla yenile → api_usage neredeyse ARTMAZ ==="
BEFORE=$(node -e "
const db=require('./server/db');
const r = db.prepare(\"SELECT COALESCE(SUM(count),0) c FROM api_usage WHERE day_utc=STRFTIME('%Y-%m-%d','now') AND endpoint='/api/widget/match/'\").get();
console.log(r.c); db.close();")
echo "istek sayacı (önce): $BEFORE"
for i in 1 2 3 4; do
  agent-browser reload > /dev/null 2>&1
  agent-browser wait --load networkidle > /dev/null 2>&1
  sleep 1
done
AFTER=$(node -e "
const db=require('./server/db');
const r = db.prepare(\"SELECT COALESCE(SUM(count),0) c FROM api_usage WHERE day_utc=STRFTIME('%Y-%m-%d','now') AND endpoint='/api/widget/match/'\").get();
console.log(r.c); db.close();")
echo "istek sayacı (4 yenileme sonrası): $AFTER  →  artış: $((AFTER-BEFORE))"

echo
echo "=== D) 60 sn yenileme: sayfa açıkken tam dağıtımı say ==="
agent-browser open "http://localhost:3000/#/mac/$LIVE_ID" > /dev/null 2>&1
agent-browser wait --load networkidle > /dev/null 2>&1
agent-browser network requests --filter "detail" 2>/dev/null | rg -c "detail" || echo "0"
echo "65 sn bekleniyor (bir yenileme turu)..."
sleep 65
echo "--- son 70 sn'de /detail istekleri ---"
agent-browser network requests --filter "detail" 2>/dev/null | rg "detail" | rg -v "favicon" | tail -5
CNT=$(agent-browser network requests --filter "detail" 2>/dev/null | rg -c "/detail" || echo 0)
echo "toplam /detail isteği: $CNT (ilk yükleme + 1 yenileme ≈ 2 beklenir)"

echo
echo "=== E) STALE: detay API'si engellenince ESKİ VERİ + bayat uyarısı ==="
agent-browser network route "http://localhost:3000/api/sports/matches/*/detail" --abort
echo "rota engellendi; 70 sn bekleniyor (bir sonraki yenileme turu başarısız olacak)..."
sleep 70
agent-browser eval "
(() => {
  const q = (s) => document.querySelector(s);
  return JSON.stringify({
    bayatUyarisi: !document.getElementById('mdStale').hidden,
    bayatMetni: q('#mdStale') ? q('#mdStale').textContent.trim() : null,
    skorHala: q('.md-score') ? q('.md-score').textContent.trim() : null,
    olaylarHala: document.querySelectorAll('.md-ev').length,
    hataBlok: !document.getElementById('mdError').hidden,
    sayfaYasiyor: !!document.querySelector('.md-board')
  });
})()
"
agent-browser screenshot "$DL/asama8-5-canli-stale-uyarisi.png" --full
agent-browser network unroute > /dev/null 2>&1 || true

echo
echo "=== F) CANLI MAÇ — mobil 360 ==="
agent-browser set viewport 360 760
agent-browser reload > /dev/null 2>&1
agent-browser wait --load networkidle > /dev/null 2>&1
agent-browser wait 1500
agent-browser screenshot "$DL/asama8-6-canli-mac-mobil-360.png" --full
agent-browser eval "JSON.stringify({yatayKaydirmaVar: document.documentElement.scrollWidth > document.documentElement.clientWidth, genislik: document.documentElement.scrollWidth})"

echo
echo "--- konsol hataları (tüm oturum) ---"
agent-browser errors
echo "=== bitti ==="
