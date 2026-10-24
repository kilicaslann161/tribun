/**
 * Tribün — Kâhin (#/kahin)
 * Tahmin tamamen sunucuda üretilir (POST /api/games/oracle/predict).
 * Şablonlar sunucudaki server/data/oracle-templates.js dosyasındadır (tek kaynak).
 */
import { api } from '../api.js';
import { loadMe } from '../state.js';
import { esc, toast, copyText } from '../ui.js';
import { icon } from '../icons.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function renderOracle(el) {
  el.innerHTML = `<section class="card">${esc('Küre cilalanıyor...')}</section>`;

  let me = null;
  try { me = await api.get('/api/me'); } catch { /* router giriş garantisi verir */ }
  const daily = me ? me.daily.oracle : { earned: 0, limit: 30 };

  el.innerHTML = `
    <section class="card oracle-wrap" data-acc="oracle">
      <div class="crystal-wrap"><div class="crystal" id="crystal" aria-hidden="true">${icon('crystal', 64)}</div></div>
      <h1>Kâhin</h1>
      <p class="muted">İki takım ver, kristal küre maçın kaderini fısıldasın. Aynı maç, aynı gün → aynı tahmin. Kâhin kararsız değildir.</p>

      <form id="oracleForm" novalidate>
        <div class="row">
          <label class="field"><span>Ev Sahibi Takım</span>
            <input class="input" id="homeIn" maxlength="24" placeholder="Kırmızılar" required>
          </label>
          <label class="field"><span>Rakip Takım</span>
            <input class="input" id="awayIn" maxlength="24" placeholder="Sarılar" required>
          </label>
        </div>
        <button class="btn yellow block big" type="submit" id="askBtn">${icon('crystal', 18)} Kâhine Danış</button>
      </form>

      <p class="muted tiny" id="dailyLine"></p>
      <div id="oracleResult" aria-live="polite"></div>
    </section>`;

  const form = el.querySelector('#oracleForm');
  const btn = el.querySelector('#askBtn');
  const crystal = el.querySelector('#crystal');
  const resultBox = el.querySelector('#oracleResult');
  const dailyLine = el.querySelector('#dailyLine');

  function drawDaily(d) {
    dailyLine.textContent = d.earned >= d.limit
      ? 'Bugünlük kâhin puanı doldu. Tahmin etmeye devam edebilirsin!'
      : `Bugünlük kâhin puanı: ${d.earned}/${d.limit} ⭐ (günün ilk tahmini +10)`;
  }
  drawDaily(daily);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const home = el.querySelector('#homeIn').value.trim();
    const away = el.querySelector('#awayIn').value.trim();

    if (home.length < 2 || away.length < 2) {
      toast('İki takım adı da en az 2 karakter olmalı.', true);
      return;
    }

    btn.disabled = true;
    crystal.classList.add('thinking');
    resultBox.innerHTML = `<p class="thinking-line">${icon('crystal', 18)} Kâhin düşünüyor<span class="dots"></span></p>`;

    try {
      // En az 1,5 saniyelik "düşünme" efekti
      const [d] = await Promise.all([
        api.post('/api/games/oracle/predict', { home, away }),
        delay(1500)
      ]);

      resultBox.innerHTML = '';
      crystal.classList.remove('thinking');
      showPrediction(d);

      if (d.pointsInfo) drawDaily({ earned: d.pointsInfo.awardedToday ?? daily.earned, limit: d.pointsInfo.dailyLimit ?? daily.limit });
      loadMe(); // üst bar puanını tazele
    } catch (err) {
      crystal.classList.remove('thinking');
      resultBox.innerHTML = '';
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  function showPrediction(d) {
    const p = d.prediction;
    const wrap = document.createElement('div');
    wrap.className = 'card prediction-card';
    wrap.innerHTML = `
      <div class="pred-head">${icon('crystal', 20)} KÂHİN SÖYLÜYOR</div>
      <div class="pred-score">
        <span>${esc(p.home)}</span>
        <span class="score-big">${esc(p.score)}</span>
        <span>${esc(p.away)}</span>
      </div>
      <ul class="pred-list">
        <li>🟥 Kırmızı kart: <b>${p.redCards === 0 ? 'çıkmaz, temiz maç!' : p.redCards}</b></li>
        <li>⚖️ Tartışma anı: <b>${esc(p.controversy)}</b></li>
        <li>⭐ Maçın adamı: <b>${esc(p.motm)}</b></li>
      </ul>
      <p class="pred-comment">"${esc(p.comment)}"</p>
      <p class="points-note">${d.points > 0 ? `+${d.points} puan kazandın! ⭐` : (d.limitMessage ? esc(d.limitMessage) : 'Bugünlük puan kısmet değil.')}</p>
      <button type="button" class="btn block mt" id="sharePred">${icon('copy', 18)} Tahmini Paylaş</button>`;

    resultBox.appendChild(wrap);

    if (d.newBadges && d.newBadges.length) {
      const c = document.createElement('div');
      c.className = 'celebrate';
      c.innerHTML = `🎉 <b>Yeni rozet kazandın!</b>
        <div class="chips">${d.newBadges.map((b) => `<span class="chip">${b.emoji} ${esc(b.name)}</span>`).join('')}</div>`;
      resultBox.appendChild(c);
    }

    wrap.querySelector('#sharePred').addEventListener('click', async () => {
      const text = `🔮 Kâhin dedi ki:\n${p.home} ${p.score} ${p.away}\n🟥 ${p.redCards === 0 ? 'temiz maç' : p.redCards + ' kırmızı'} · ⚖️ ${p.controversy}\n⭐ Maçın adamı: ${p.motm}\n"${p.comment}"\n— Tribün'de kahinle sen de görüş!`;
      const ok = await copyText(text);
      if (ok) toast('Tahmin panoya kopyalandı! Gruba at, kahraman ol. 📋');
      else toast('Kopyalanamadı, bir daha dene.', true);
    });
  }
}
