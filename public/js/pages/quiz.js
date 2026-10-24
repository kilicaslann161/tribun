/**
 * Tribün — Taraftar Testi (#/test)
 * Sorular public/js/data/quiz-questions.js dosyasından gösterilir.
 * Puanlama ve tip hesabı SUNUCUDA yapılır (POST /api/games/quiz/submit).
 * Gönderilen cevap formatı: {answers: [seçenek indeksi x10]}
 * (Sunucudaki server/data/quiz-questions.js seçenek sırasıyla birebir aynıdır.)
 */
import { api } from '../api.js';
import { loadMe } from '../state.js';
import { esc, toast } from '../ui.js';
import { icon } from '../icons.js';
import { QUIZ } from '../data/quiz-questions.js';

export function renderQuiz(el) {
  let answers = [];
  let idx = 0;
  drawIntro();
  loadMe(); // üst bar tazeliği

  function drawIntro() {
    el.innerHTML = `
      <section class="card" style="text-align:center" data-acc="quiz">
        <span class="ico-box" style="width:64px;height:64px;margin-bottom:12px" aria-hidden="true">${icon('brain', 34)}</span>
        <h1 style="margin-top:4px">Taraftar Testi</h1>
        <p class="muted">10 soru, 5 taraftar tipi: Sabırsız Teknik Direktör, Tribün Şairi, Sessiz Analizci, Bayrak Taşıyıcı, Şanslı Çorap Sahibi.</p>
        <p class="muted small">İçtenlikle cevap ver; sonuç unvanına işlenecek, puan kazanacaksın. Geri dönüş yok, tribünde pişmanlık olmaz!</p>
        <button type="button" class="btn yellow big" id="startQuiz">Başla! ${icon('ball', 18)}</button>
      </section>`;
    el.querySelector('#startQuiz').addEventListener('click', () => {
      answers = [];
      idx = 0;
      drawQuestion();
    });
  }

  function drawQuestion() {
    const q = QUIZ[idx];
    el.innerHTML = `
      <section class="card">
        <div class="quiz-progress-wrap">
          <div class="quiz-progress-label"><span>Soru ${idx + 1}/${QUIZ.length}</span><span>❤️ Geri dönüş yok</span></div>
          <div class="progress"><i style="width:${Math.round(idx / QUIZ.length * 100)}%"></i></div>
        </div>
        <h3>${esc(q.q)}</h3>
        <div id="optBox">
          ${q.options.map((o, i) => `
            <button type="button" class="option-btn" data-i="${i}">${esc(o)}</button>`).join('')}
        </div>
      </section>`;

    el.querySelectorAll('.option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        answers.push(Number(btn.dataset.i));
        // Kısa geri bildirim: seçilen işaretlenir, diğerleri soluklaşır
        el.querySelectorAll('.option-btn').forEach((b) => { b.disabled = true; });
        btn.style.borderColor = 'var(--green)';
        setTimeout(() => {
          idx += 1;
          if (idx < QUIZ.length) drawQuestion();
          else submit();
        }, 280);
      });
    });
  }

  async function submit() {
    el.innerHTML = `
      <section class="card">
        <div class="loading"><div class="spinner"></div>Cevaplar puanlanıyor...</div>
      </section>`;
    try {
      const d = await api.post('/api/games/quiz/submit', { answers });
      drawResult(d);
      loadMe(); // üst barda puan + unvan tazelensin
    } catch (e) {
      toast(e.message, true);
      el.innerHTML = `
        <section class="card" style="text-align:center">
          <p>${esc(e.message)}</p>
          <button type="button" class="btn" id="retrySub">Tekrar Dene</button>
        </section>`;
      el.querySelector('#retrySub').addEventListener('click', submit);
    }
  }

  function drawResult(d) {
    const maxCount = Math.max(1, ...Object.values(d.counts));
    el.innerHTML = `
      <section class="card" style="text-align:center">
        <div class="quiz-result-emoji">${d.emoji}</div>
        <p class="muted" style="margin:2px 0">Sen bir...</p>
        <h1 class="type-name">${esc(d.name)}</h1>
        <p style="max-width:520px;margin:8px auto">${esc(d.description)}</p>

        <p class="points-line">${d.points > 0 ? `+${d.points} puan kazandın! ⭐` : (d.limitMessage ? esc(d.limitMessage) : '')}</p>
        <p><span class="pill">${icon('check', 14)} Unvanın kartına işlendi</span></p>

        <div class="count-rows" style="max-width:460px;margin:14px auto;text-align:left">
          ${Object.entries(d.counts).map(([name, c]) => `
            <div class="count-row">
              <b title="${esc(name)}">${esc(name)}</b>
              <div class="progress"><i style="width:${Math.round(c / maxCount * 100)}%"></i></div>
              <span>${c}</span>
            </div>`).join('')}
        </div>

        ${d.newBadges && d.newBadges.length ? `
          <div class="celebrate">
            🎉 <b>Yeni rozet kazandın!</b>
            <div class="chips">${d.newBadges.map((b) => `<span class="chip">${b.emoji} ${esc(b.name)}</span>`).join('')}</div>
          </div>` : ''}

        <div class="row" style="justify-content:center;margin-top:12px">
          <a class="btn yellow" href="#/kart">${icon('card', 18)} Kartımı Gör</a>
          <button type="button" class="btn ghost" id="retake">${icon('refresh', 18)} Testi Tekrarla</button>
        </div>
      </section>`;
    el.querySelector('#retake').addEventListener('click', drawIntro);
  }
}
