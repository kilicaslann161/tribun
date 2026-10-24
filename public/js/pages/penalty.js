/**
 * Tribün — Penaltı Atışları (#/penalti)
 * Sonuçlar TAMAMEN sunucudan gelir (POST /api/games/penalty/play).
 * Bu dosya yalnızca sunucunun döndürdüğü gol/kurtarış/auta sonucunu görselleştirir.
 */
import { api } from '../api.js';
import { loadMe } from '../state.js';
import { esc, toast, loadingHtml } from '../ui.js';
import { icon } from '../icons.js';

const ZONE_NAMES = ['üst sol', 'üst orta', 'üst sağ', 'alt sol', 'alt orta', 'alt sağ'];
const OUTCOME_TEXT = {
  goal: { label: 'GOOOL! 🎉', cls: 'goal' },
  save: { label: 'KURTARIŞ! 🧤', cls: 'save' },
  out: { label: 'AUTA! 😱', cls: 'out' }
};
const DOT_ICON = { goal: '✅', save: '❌', out: '❌' };

const keeperSvg = `
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="12" r="8" fill="#e9c98f"/>
    <rect x="19" y="21" width="26" height="24" rx="6" fill="#23b862"/>
    <rect x="7" y="23" width="11" height="20" rx="5" fill="#159a4c"/>
    <rect x="46" y="23" width="11" height="20" rx="5" fill="#159a4c"/>
    <circle cx="10" cy="45" r="5" fill="#ffd83d"/>
    <circle cx="54" cy="45" r="5" fill="#ffd83d"/>
    <rect x="21" y="46" width="9" height="14" rx="4" fill="#122b1b"/>
    <rect x="34" y="46" width="9" height="14" rx="4" fill="#122b1b"/>
  </svg>`;

export async function renderPenalty(el) {
  el.innerHTML = `<section class="card">${loadingHtml('Saha hazırlanıyor...')}</section>`;

  let me = null;
  let state = { active: false, shots: [] };
  try {
    [me] = await Promise.all([
      api.get('/api/me').catch(() => null),
      api.get('/api/games/penalty/state').then((s) => { state = s; }).catch(() => {})
    ]);
  } catch { /* tek tek yakalandı */ }

  let daily = me ? me.daily.penalty : { earned: 0, limit: 150 };
  draw(el, state.shots || [], daily);

  function draw(root, series, dailyInfo) {
    const goals = series.filter((s) => s.outcome === 'goal').length;
    const played = series.length;
    const left = 5 - played;

    root.innerHTML = `
      <section class="card" data-acc="penalty">
        <h1 style="margin-top:0"><span class="ico-box" aria-hidden="true">${icon('goal', 22)}</span> Penaltı Atışları</h1>
        <div class="penalty-head">
          <div class="shot-dots" id="shotDots">
            ${[0, 1, 2, 3, 4].map((i) => {
              const s = series[i];
              if (!s) return '<span class="dot">⚪</span>';
              return `<span class="dot ${s.outcome === 'goal' ? 'goal' : 'miss'}">${DOT_ICON[s.outcome] || '⚪'}</span>`;
            }).join('')}
          </div>
          <div class="penalty-score">${icon('ball', 18)} <b id="goalCount">${goals}</b> gol</div>
          <div class="penalty-left" id="shotLeft">${left > 0 ? `${left} atış kaldı` : 'Seri tamam!'}</div>
        </div>

        <div class="daily-line">
          Bugünlük penaltı puanı: <b>${dailyInfo.earned}/${dailyInfo.limit}</b>
          <div class="progress"><i style="width:${Math.min(100, Math.round(dailyInfo.earned / dailyInfo.limit * 100))}%"></i></div>
        </div>

        <div class="penalty-stage" id="penStage">
          <div class="goal">
            <div class="zone-grid">
              ${[1, 2, 3, 4, 5, 6].map((z) => `
                <button type="button" class="zone-btn" data-zone="${z}" aria-label="${ZONE_NAMES[z - 1]} bölgeye vur">${z}</button>`).join('')}
            </div>
            <div class="keeper" id="keeper">${keeperSvg}</div>
            <div class="ball" id="ball" aria-hidden="true">${icon('ball', 44)}</div>
          </div>
        </div>
        <p class="penalty-status" id="pStatus">${played > 0 && left > 0 ? 'Seri kaldığı yerden devam ediyor! Bir bölge seç.' : 'Bir bölge seç ve topu gönder! 🥅'}</p>
      </section>`;

    const status = root.querySelector('#pStatus');
    const stage = root.querySelector('#penStage');
    const goalBox = stage.querySelector('.goal');
    const ball = root.querySelector('#ball');
    const keeper = root.querySelector('#keeper');
    const zoneEls = {};
    root.querySelectorAll('.zone-btn').forEach((b) => { zoneEls[Number(b.dataset.zone)] = b; });

    let busy = false;
    let uiSeries = series.slice();

    function setLocked(lock) {
      Object.values(zoneEls).forEach((b) => { b.disabled = lock; });
    }

    function updateHead() {
      const g = uiSeries.filter((s) => s.outcome === 'goal').length;
      root.querySelector('#goalCount').textContent = g;
      root.querySelectorAll('#shotDots .dot').forEach((d, i) => {
        const s = uiSeries[i];
        d.className = 'dot' + (s ? (s.outcome === 'goal' ? ' goal' : ' miss') : '');
        d.textContent = s ? DOT_ICON[s.outcome] : '⚪';
      });
      const l = 5 - uiSeries.length;
      root.querySelector('#shotLeft').textContent = l > 0 ? `${l} atış kaldı` : 'Seri tamam!';
    }

    // Konum hesapları: hedef elementin merkezi − sahnenin sol üstü
    function centerOf(elm) {
      const s = stage.getBoundingClientRect();
      const r = elm.getBoundingClientRect();
      return { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top };
    }

    function animate(zone, keeperZone) {
      const from = centerOf(ball);
      const to = centerOf(zoneEls[zone]);
      ball.classList.remove('noanim');
      keeper.classList.remove('noanim');
      ball.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(.45) rotate(340deg)`;

      const kf = centerOf(keeper);
      const kt = centerOf(zoneEls[keeperZone]);
      const dir = kt.x > kf.x + 6 ? 42 : (kt.x < kf.x - 6 ? -42 : 0);
      keeper.style.transform = `translate(${kt.x - kf.x}px, ${kt.y - kf.y}px) rotate(${dir}deg) scale(.92)`;
    }

    function resetActors() {
      ball.classList.add('noanim');
      keeper.classList.add('noanim');
      ball.style.transform = '';
      keeper.style.transform = '';
      void ball.offsetWidth; // reflow: geçişsiz sıfırla
      void keeper.offsetWidth;
    }

    function flash(outcome) {
      const o = OUTCOME_TEXT[outcome] || OUTCOME_TEXT.save;
      const f = document.createElement('div');
      f.className = `outcome-flash ${o.cls}`;
      f.textContent = o.label;
      goalBox.appendChild(f);
      setTimeout(() => f.remove(), 1300);
    }

    async function shoot(btn) {
      if (busy) return; // çift tıklama kilidi
      busy = true;
      setLocked(true);
      status.textContent = 'Top havada...';

      const zone = Number(btn.dataset.zone);
      try {
        const d = await api.post('/api/games/penalty/play', { zone });

        animate(d.zone, d.keeper);
        setTimeout(() => flash(d.outcome), 780);
        uiSeries = d.series;
        setTimeout(() => updateHead(), 800);

        if (!d.finished) {
          setTimeout(() => {
            resetActors();
            busy = false;
            setLocked(false);
            status.textContent = `${d.shotNumber}. atış ${d.outcome === 'goal' ? 'gol! Devam!' : 'geçti, toparlan!'} Sıradaki bölgeyi seç.`;
          }, 1650);
        } else {
          setTimeout(() => {
            resetActors();
            showResult(d);
          }, 1800);
        }
      } catch (e) {
        // Ağ hatası: seri bozulmaz (sunucu durumunu korur), tekrar denenebilir
        toast(e.message, true);
        status.textContent = 'Bir aksilik oldu! Aynı atışı tekrar dene. 🔁';
        busy = false;
        setLocked(false);
      }
    }

    function showResult(d) {
      const sec = root.querySelector('section.card');
      sec.innerHTML = `
        <div class="result-hero">
          <div class="result-emoji">${d.goals >= 4 ? '🏆' : d.goals >= 2 ? '⚽' : '😬'}</div>
          <h1>${d.goals}/5 gol</h1>
          <p class="points-line">${d.points > 0 ? `+${d.points} puan kazandın! ⭐` : 'Bu sefer puan kısmadı. 🎭'}</p>
          <p class="muted">Kişisel rekorun: <b>${d.best} gol</b></p>
          ${d.limitMessage ? `<p class="form-error" style="text-align:center">${esc(d.limitMessage)}</p>` : ''}
          ${badgeHtml(d.newBadges)}
          <div class="row" style="justify-content:center;margin-top:14px">
            <button type="button" class="btn" id="againBtn">${icon('refresh', 18)} Tekrar Oyna</button>
            <a class="btn ghost" href="#/siralama">${icon('trophy', 18)} Liderlik Tablosu</a>
          </div>
        </div>`;
      sec.querySelector('#againBtn').addEventListener('click', () => renderPenalty(el));

      // Üst bar puanını + günlük çizgiyi tazele
      loadMe();
      if (d.pointsInfo) {
        daily = { earned: d.pointsInfo.awardedToday ?? daily.earned, limit: d.pointsInfo.dailyLimit ?? daily.limit };
      }
    }

    Object.values(zoneEls).forEach((b) => b.addEventListener('click', () => shoot(b)));
  }
}

function badgeHtml(newBadges) {
  if (!newBadges || !newBadges.length) return '';
  return `
    <div class="celebrate">
      🎉 <b>Yeni rozet kazandın!</b>
      <div class="chips">
        ${newBadges.map((b) => `<span class="chip">${b.emoji} ${esc(b.name)}</span>`).join('')}
      </div>
    </div>`;
}
