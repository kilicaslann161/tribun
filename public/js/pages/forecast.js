/**
 * Tribün — Kâhin Sensin sayfası (#/kahin-sensin) — AŞAMA 9
 * Gerçek maçlara 1/X/2 + karşılıklı gol tahmini. Tahminler başlama saatine
 * kadar açıktır; puanlar maç sonuçlandığında (otomatik ya da admin) dağıtılır.
 * Kristal küre "Kâhin" (#/kahin) oyunundan ayrıdır, ona dokunulmaz.
 * - Tüm dinamik metinler textContent (XSS yok); ikonlar inline SVG (emoji yok)
 * - fetch hata/boş durumları; cleanup gerektirmeyen tek seferlik yükleme
 */
import { api } from '../api.js';
import { loadMe } from '../state.js';
import { toast } from '../ui.js';
import { icon } from '../icons.js';

const TIME_FMT = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul'
});

const OUTCOME_TR = { '1': 'Ev Sahibi', 'X': 'Beraberlik', '2': 'Deplasman' };

function fmtKickoff(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : TIME_FMT.format(d);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/* ---------------- açık maç kartı ---------------- */

function buildFixtureCard(f, onSubmit) {
  const card = el('article', 'fc-fixture' + (f.my_prediction ? ' is-locked' : ''));

  // üst satır: lig etiketi + saat
  const top = el('div', 'fc-top');
  if (f.competition_label) top.appendChild(el('span', 'fc-league', f.competition_label));
  const time = el('span', 'fc-time');
  time.innerHTML = icon('clock', 14);
  time.appendChild(document.createTextNode(fmtKickoff(f.kickoff_at)));
  top.appendChild(time);
  card.appendChild(top);

  // takımlar
  const teams = el('div', 'fc-teams');
  teams.appendChild(el('span', 'fc-team', f.home_team));
  const score = el('span', 'fc-score is-null', '-');
  teams.appendChild(score);
  teams.appendChild(el('span', 'fc-team away', f.away_team));
  card.appendChild(teams);

  const my = f.my_prediction;

  if (my) {
    // kilitli tahmin: sonuç bekleniyor ya da kesinleşti
    const locked = el('div', 'fc-locked');
    locked.appendChild(el('span', null, 'Tahminin kayıtlı:'));
    const v1 = el('span', 'fc-val', OUTCOME_TR[my.pick_1x2]);
    locked.appendChild(v1);
    locked.appendChild(el('span', null, '·'));
    const v2 = el('span', 'fc-val', `Karşılıklı gol: ${my.pick_btts === 'yes' ? 'Evet' : 'Hayır'}`);
    locked.appendChild(v2);

    if (f.status === 'finished') {
      const pts = el('span', 'fc-points' + (my.points_awarded > 0 ? '' : ' zero'));
      pts.innerHTML = icon('star', 14);
      pts.appendChild(document.createTextNode(
        my.points_awarded > 0 ? `+${my.points_awarded} puan` : 'puan yok'));
      locked.appendChild(pts);
    } else {
      const note = el('span', 'fc-note wait');
      note.innerHTML = icon('clock', 14);
      note.appendChild(document.createTextNode('Sonuç bekleniyor'));
      locked.appendChild(note);
    }
    card.appendChild(locked);
    return card;
  }

  if (!f.can_predict) {
    const note = el('div', 'fc-note wait');
    note.innerHTML = icon('clock', 14);
    note.appendChild(document.createTextNode('Başlama saati geçti — bu maçın tahminleri kapandı.'));
    card.appendChild(note);
    return card;
  }

  // tahmin kontrolleri
  const row = el('div', 'fc-pick-row');

  const mkSeg = (label, options) => {
    const wrap = el('div');
    wrap.appendChild(el('span', 'fc-pick-label', label));
    const seg = el('div', 'fc-seg' + (options.length === 2 ? ' two' : ''));
    let chosen = null;
    for (const [val, name, sub] of options) {
      const b = el('button', 'fc-seg-btn');
      b.type = 'button';
      b.dataset.val = val;
      b.appendChild(el('span', null, name));
      if (sub) b.appendChild(el('small', null, sub));
      b.addEventListener('click', () => {
        chosen = b;
        seg.querySelectorAll('.fc-seg-btn').forEach((x) => x.classList.toggle('selected', x === chosen));
      });
      seg.appendChild(b);
    }
    wrap.appendChild(seg);
    wrap.getVal = () => (chosen ? chosen.dataset.val : null);
    return wrap;
  };

  const seg1 = mkSeg('Maç Sonucu', [
    ['1', '1', 'Ev Sahibi'],
    ['X', 'X', 'Beraberlik'],
    ['2', '2', 'Deplasman']
  ]);
  const segB = mkSeg('Karşılıklı Gol', [
    ['yes', 'Evet', 'İki takım da atar'],
    ['no', 'Hayır', 'En az biri vuramayacak']
  ]);

  row.appendChild(seg1);
  row.appendChild(segB);
  card.appendChild(row);

  const submit = el('button', 'fc-submit', 'Tahminimi Gönder');
  submit.type = 'button';
  submit.disabled = true;
  submit.insertAdjacentHTML('afterbegin', icon('crystal', 16) + ' ');

  // seçim değiştikçe gönder düğmesini aç/kapa (tıklamalar karta köpürür)
  card.addEventListener('click', () => {
    submit.disabled = !(seg1.getVal() && segB.getVal());
  });

  submit.addEventListener('click', async () => {
    const p1 = seg1.getVal();
    const pB = segB.getVal();
    if (!p1 || !pB) return;
    submit.disabled = true;
    submit.textContent = 'Gönderiliyor...';
    try {
      await api.post('/api/games/forecast/predict', {
        fixtureId: f.id, pick1x2: p1, pickBtts: pB
      });
      toast('Tahminin kaydedildi! Sonuç kesinleşince puanın hesaplanacak.');
      loadMe();
      if (onSubmit) onSubmit();
    } catch (err) {
      toast(err.message, true);
      submit.disabled = false;
      submit.textContent = 'Tahminimi Gönder';
    }
  });

  card.appendChild(submit);

  return card;
}

/* ---------------- sonuç kartı ---------------- */

function buildResultCard(f) {
  const card = el('article', 'fc-result');

  card.appendChild(el('span', 'fc-team', f.home_team));

  const mid = el('div', 'fc-result-mid');
  const score = el('span', 'fc-score', `${f.home_score} - ${f.away_score}`);
  mid.appendChild(score);

  const chips = el('div', 'fc-result-chips');
  const my = f.my_prediction;
  if (f.status === 'finished' && f.result_1x2) {
    const c1 = el('span', 'fc-res-chip', `Sonuç: ${f.result_1x2}`);
    if (my) c1.classList.add(my.pick_1x2 === f.result_1x2 ? 'hit' : 'miss');
    chips.appendChild(c1);
    const cb = el('span', 'fc-res-chip', `KG: ${f.result_btts === 'yes' ? 'Var' : 'Yok'}`);
    if (my) cb.classList.add(my.pick_btts === f.result_btts ? 'hit' : 'miss');
    chips.appendChild(cb);
  }
  if (my) {
    const pts = el('span', 'fc-points' + (my.points_awarded > 0 ? '' : ' zero'));
    pts.innerHTML = icon('star', 13);
    pts.appendChild(document.createTextNode(
      my.points_awarded > 0 ? `+${my.points_awarded}` : '0 puan'));
    chips.appendChild(pts);
  } else {
    chips.appendChild(el('span', 'fc-res-chip', 'Tahmin yapmadın'));
  }
  mid.appendChild(chips);
  card.appendChild(mid);

  card.appendChild(el('span', 'fc-team away', f.away_team));

  if (f.status === 'cancelled') {
    card.appendChild(el('span', 'fc-cancel-note', 'Maç iptal edildi — puan dağıtılmadı.'));
  }

  return card;
}

/* ---------------- sayfa ---------------- */

export async function renderForecast(root) {
  // Not: parametre adı 'root' — modül düzeyindeki el() DOM yardımcısını GÖLGEMESİN
  // (Aşama 7'de aynı tuzak: renderLeague(el) → el() yardımcısı gölgelenmişti).
  root.innerHTML = `
    <div class="fc-wrap">
      <section class="card">
        <div class="fc-head">
          <span class="ico-box" aria-hidden="true">${icon('crystal', 24)}</span>
          <h1>Kâhin Sensin</h1>
        </div>
        <p class="fc-rule">Gerçek maçlara tahmin yap: <b>maç sonucu (1 / X / 2)</b> ve <b>karşılıklı gol</b>.
        Doğru sonuç <b>+15</b>, doğru karşılıklı gol <b>+10</b>, ikisi birden <b>+5 bonus</b>.
        Tahminler başlama saatine kadar açık; puanlar maç kesinleşince hesabına yazılır.</p>
        <div id="fcBody"><div class="empty">Yükleniyor…</div></div>
      </section>
    </div>`;

  const body = root.querySelector('#fcBody');

  const load = async () => {
    body.innerHTML = '<div class="empty">Yükleniyor…</div>';
    let data;
    try {
      data = await api.get('/api/games/forecast/fixtures');
    } catch (err) {
      body.innerHTML = '';
      const box = el('div', 'fc-error');
      box.innerHTML = icon('x', 18);
      box.appendChild(el('span', null, err.message));
      const retry = el('button', 'btn small', 'Tekrar dene');
      retry.type = 'button';
      retry.addEventListener('click', load);
      box.appendChild(retry);
      body.appendChild(box);
      return;
    }

    try {
      body.innerHTML = '';
      const open = (data.fixtures && data.fixtures.open) || [];
      const recent = (data.fixtures && data.fixtures.recent) || [];

      // açık maçlar
      const sec1 = el('h2', 'fc-sec');
      sec1.appendChild(el('span', null, 'Tahmine Açık Maçlar'));
      sec1.appendChild(el('span', 'count', String(open.length)));
      body.appendChild(sec1);

      if (!open.length) {
        const e = el('div', 'empty');
        e.innerHTML = icon('ball', 26);
        e.appendChild(el('div', null, 'Şu an tahmine açık maç yok. Admin yeni maçlar eklediğinde burada görünecek.'));
        body.appendChild(e);
      } else {
        for (const f of open) body.appendChild(buildFixtureCard(f, load));
      }

      // son sonuçlar
      const sec2 = el('h2', 'fc-sec');
      sec2.appendChild(el('span', null, 'Son Sonuçlar'));
      sec2.appendChild(el('span', 'count', String(recent.length)));
      body.appendChild(sec2);

      if (!recent.length) {
        const e = el('div', 'empty');
        e.innerHTML = icon('trophy', 26);
        e.appendChild(el('div', null, 'Henüz sonuçlanan maç yok. Tahminlerin sonuçlanınca puanların buraya düşer.'));
        body.appendChild(e);
      } else {
        for (const f of recent) body.appendChild(buildResultCard(f));
      }
    } catch (err) {
      // beklenmeden render hatası: hata kutusu göster (sessiz boş sayfa YOK)
      body.innerHTML = '';
      const box = el('div', 'fc-error');
      box.innerHTML = icon('x', 18);
      box.appendChild(el('span', null, 'Liste gösterilirken bir sorun oluştu: ' + err.message));
      body.appendChild(box);
    }
  };

  await load();
}
