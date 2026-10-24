#!/bin/bash
# AŞAMA 8 — UI doğrulama 1: bitmiş maç sayfası + ana sayfa satır linkleri + basketbol
set -u
cd /home/z/my-project/tribun
DL=/home/z/my-project/download

node server/index.js > /tmp/tribun.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -m 2 -o /dev/null "http://localhost:3000/" && break; sleep 0.5; done
echo "✓ sunucu hazır (pid $SRV)"

# temiz durum
agent-browser close > /dev/null 2>&1 || true

echo
echo "=== A) BİTMİŞ MAÇ SAYFASI (#/mac/7 — masaüstü 1280x900) ==="
agent-browser set viewport 1280 900
agent-browser open "http://localhost:3000/#/mac/7"
agent-browser wait --load networkidle
agent-browser wait 1800
agent-browser screenshot "$DL/asama8-1-bitmis-mac-masaustu.png" --full

agent-browser eval "
(() => {
  const q = (s) => document.querySelector(s);
  const score = q('.md-score');
  const evs = document.querySelectorAll('.md-ev').length;
  const stats = document.querySelectorAll('.md-stat').length;
  const players = document.querySelectorAll('.md-player').length;
  const comp = q('.md-comp span');
  const ht = q('.md-ht');
  const kickoff = q('.md-kickoff');
  const updated = document.getElementById('mdUpdated');
  const icons = {};
  document.querySelectorAll('.md-chip svg').forEach((s) => {
    const c = [...s.classList].find((x) => x.startsWith('ic-')) || '?';
    icons[c] = (icons[c] || 0) + 1;
  });
  return JSON.stringify({
    skor: score ? score.textContent.trim() : null,
    lig: comp ? comp.textContent : null,
    durum: q('.md-status') ? q('.md-status').textContent.trim() : null,
    devreSkoru: ht ? ht.textContent : null,
    baslama: kickoff ? kickoff.textContent : null,
    sonGuncelleme: updated ? updated.textContent : null,
    olaySayisi: evs, istatistikSayisi: stats, oyuncuSatiri: players,
    ikonDagilimi: icons,
   PoweredBy: !!q('a.sp-attribution'),
    yatayKaydirma: document.documentElement.scrollWidth > document.documentElement.clientWidth
  });
})()
"
echo "--- konsol hataları ---"
agent-browser errors

echo
echo "=== B) BİTMİŞ MAÇ — mobil 360px (yatay kaydırma YOK olmalı) ==="
agent-browser set viewport 360 760
agent-browser reload
agent-browser wait --load networkidle
agent-browser wait 1500
agent-browser screenshot "$DL/asama8-2-bitmis-mac-mobil-360.png" --full
agent-browser eval "JSON.stringify({sayfaGenisligi: document.documentElement.scrollWidth, istemciGenisligi: document.documentElement.clientWidth, yatayKaydirmaVar: document.documentElement.scrollWidth > document.documentElement.clientWidth, kadroTekSutun: getComputedStyle(document.querySelector('.md-lineups')).gridTemplateColumns.split(' ').length === 1})"

echo
echo "=== C) ANA SAYFA: futbol satırları <a>, basketbol satırları DEĞİL ==="
agent-browser set viewport 1280 900
agent-browser open "http://localhost:3000/#/"
agent-browser wait --load networkidle
agent-browser wait 2000
agent-browser eval "
(async () => {
  // futbol (varsayılan): has_detail satırları link olmalı
  await new Promise(r => setTimeout(r, 400));
  const footballRows = [...document.querySelectorAll('.sp-row')];
  const linked = footballRows.filter(r => r.tagName === 'A');
  const notLinked = footballRows.filter(r => r.tagName !== 'A');
  const statuses = linked.map(a => a.className.includes('st-live') || a.className.includes('st-finished'));
  // basketbol sekmesi
  document.querySelector('[data-sport=\"basketball\"]').click();
  await new Promise(r => setTimeout(r, 1200));
  const bbRows = [...document.querySelectorAll('.sp-row')];
  const bbLinked = bbRows.filter(r => r.tagName === 'A');
  return JSON.stringify({
    futbolSatir: footballRows.length,
    futbolLinkli: linked.length,
    futbolLinksiz: notLinked.length,
    linksizlerHangiDurum: notLinked.map(r => r.className.match(/st-([a-z]+)/)[1]).filter((v,i,arr)=>arr.indexOf(v)===i),
    linkOrnek: linked[0] ? linked[0].getAttribute('href') : null,
    basketbolSatir: bbRows.length,
    basketbolLinkli: bbLinked.length
  });
})()
"
agent-browser screenshot "$DL/asama8-3-ana-sayfa-satirlar.png"

echo
echo "=== D) BASKETBOL MAÇ SAYFASI (detay yok — sayfa ÇÖKMEMELİ) ==="
BB_ID=$(node -e "
const db=require('./server/db');
const r = db.prepare(\"SELECT id FROM matches WHERE sport='basketball' LIMIT 1\").get();
console.log(r ? r.id : ''); db.close();")
echo "basketbol maç: $BB_ID"
agent-browser open "http://localhost:3000/#/mac/$BB_ID"
agent-browser wait --load networkidle
agent-browser wait 1200
agent-browser eval "
(() => {
  const notice = document.getElementById('mdNotice');
  const empties = [...document.querySelectorAll('.sp-empty')].map(e => e.textContent.trim());
  return JSON.stringify({
    mesaj: notice && !notice.hidden ? notice.textContent.trim() : null,
    bolumNotlari: empties,
    skorTahtasiVar: !!document.querySelector('.md-teams'),
    sayfaYasiyor: !!document.querySelector('.md-board')
  });
})()
"
echo "--- konsol hataları ---"
agent-browser errors

echo
echo "=== E) GEÇERSİZ id / olmayan maç ==="
agent-browser open "http://localhost:3000/#/mac/999999"
agent-browser wait --load networkidle
agent-browser wait 800
agent-browser eval "document.body.innerText.includes('Böyle bir maç yok') ? 'dost 404 sayfası OK' : 'HATA: 404 sayfası görünmedi'"

echo
echo "=== bitti ==="
