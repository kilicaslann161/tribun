/**
 * Tribün — Liderlik Tablosu (#/siralama)
 * Sekmeler: Toplam Puan / Penaltı / Bingo / Transfer. İlk 3 madalya, kendi satırın vurgulu.
 */
import { api } from '../api.js';
import { getUser } from '../state.js';
import { esc, toast, loadingHtml } from '../ui.js';
import { icon } from '../icons.js';

const TABS = [
  { key: 'total', ico: 'star', label: 'Toplam Puan' },
  { key: 'penalty', ico: 'goal', label: 'Penaltı' },
  { key: 'bingo', ico: 'target', label: 'Bingo' },
  { key: 'transfer', ico: 'coins', label: 'Transfer' }
];

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function renderLeaderboard(el) {
  let active = 'total';

  el.innerHTML = `
    <section class="card" data-acc="bingo">
      <h1 style="margin-top:0"><span class="ico-box" aria-hidden="true">${icon('trophy', 22)}</span> Liderlik Tablosu</h1>
      <div class="tabs">
        ${TABS.map((t) => `<button type="button" class="tab${t.key === active ? ' active' : ''}" data-tab="${t.key}">${icon(t.ico, 16)} ${t.label}</button>`).join('')}
      </div>
      <div id="lbBody">${loadingHtml('Sıralama geliyor...')}</div>
      <p class="muted tiny">Her oyunda günlük puan sınırı var; hile yok, efor var. 💪</p>
    </section>`;

  const body = el.querySelector('#lbBody');

  async function load(tab) {
    body.innerHTML = loadingHtml('Sıralama geliyor...');
    try {
      const d = await api.get(`/api/leaderboard?game=${tab}`);
      if (!d.rows.length) {
        body.innerHTML = '<div class="empty">Henüz kimse yok, ilk sen ol! 🦁</div>';
        return;
      }
      const me = getUser();
      body.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Takma Ad</th><th>Unvan</th><th>Puan</th></tr></thead>
            <tbody>
              ${d.rows.map((r) => `
                <tr${me && me.id === r.id ? ' class="me"' : ''}>
                  <td>${MEDALS[r.rank] ?? r.rank}</td>
                  <td>${esc(r.nickname)}${me && me.id === r.id ? ' <span class="pill">sen</span>' : ''}</td>
                  <td class="muted">${esc(r.fan_title)}</td>
                  <td><b>${Number(r.points).toLocaleString('tr-TR')}</b></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (e) {
      body.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      toast(e.message, true);
    }
  }

  el.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      active = tab.dataset.tab;
      el.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      load(active);
    });
  });

  load(active);
}
