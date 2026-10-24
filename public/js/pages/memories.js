/**
 * Tribün — Futbol Anı Defteri (#/anilar)
 * Zaman çizgisi: yıllara göre gruplu kartlar. Kullanıcı metinleri
 * yalnızca textContent ile basılır (XSS yok).
 */
import { api, apiFetch, isLoggedIn } from '../api.js';
import { loadMe } from '../state.js';
import { openModal, openLoginModal, openReportModal, toast, loadingHtml } from '../ui.js';
import { icon } from '../icons.js';

const LIMIT = 10;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function renderMemories(elRoot) {
  const state = { mine: false, page: 0, rows: [], total: 0, loading: false };

  elRoot.innerHTML = `
    <section class="card" data-acc="memory">
      <div class="dict-head">
        <h1 style="margin:0"><span class="ico-box" aria-hidden="true">${icon('notebook', 22)}</span> Futbol Anı Defteri</h1>
        <button type="button" class="btn small" id="addMemBtn">${icon('plus', 16)} Anı Ekle</button>
      </div>
      <p class="muted small">O efsane maç, o yağmurlu derbi, o son dakika golü... Tribünün ortak hafızası burada.</p>
      <div class="tabs">
        <button type="button" class="tab active" data-mine="0">${icon('clock', 16)} Hepsi</button>
        <button type="button" class="tab" data-mine="1">${icon('card', 16)} Benim Anılarım</button>
      </div>
      <div id="memTimeline">${loadingHtml('Defter açılıyor...')}</div>
      <div class="center mt" id="moreWrap"></div>
      <p class="muted tiny center" id="memCount"></p>
    </section>`;

  const tl = elRoot.querySelector('#memTimeline');
  const moreWrap = elRoot.querySelector('#moreWrap');
  const countEl = elRoot.querySelector('#memCount');

  async function loadMore() {
    if (state.loading) return;
    state.loading = true;
    if (state.page === 0) tl.innerHTML = loadingHtml('Defter açılıyor...');
    try {
      const d = await api.get(`/api/memories?mine=${state.mine ? 1 : 0}&page=${state.page + 1}&limit=${LIMIT}`);
      state.page = d.page;
      state.total = d.total;
      state.rows = state.rows.concat(d.rows);
      renderTimeline();
    } catch (e) {
      tl.innerHTML = '';
      tl.appendChild(el('div', 'empty', e.message));
    } finally {
      state.loading = false;
    }
  }

  function reload() {
    state.page = 0;
    state.rows = [];
    loadMore();
  }

  function renderTimeline() {
    tl.innerHTML = '';
    if (!state.rows.length) {
      tl.appendChild(el('div', 'empty',
        state.mine
          ? 'Henüz anı yazmadın. İlk anın çok özel olacak, hadi! ✍️'
          : 'Defter henüz boş. İlk sayfayı sen aç, o maç hep anlatsın! 📖'));
    } else {
      let currentYear = null;
      for (const row of state.rows) {
        if (row.year !== currentYear) {
          currentYear = row.year;
          const head = el('h2', 'year-head');
          head.appendChild(el('span', null, String(row.year)));
          head.appendChild(el('span', 'year-line'));
          tl.appendChild(head);
        }
        tl.appendChild(makeCard(row));
      }
    }

    moreWrap.innerHTML = '';
    if (state.rows.length < state.total) {
      const btn = el('button', 'btn ghost');
      btn.type = 'button';
      btn.innerHTML = `${icon('chevron-down', 18)} Daha fazla yükle`;
      btn.addEventListener('click', loadMore);
      moreWrap.appendChild(btn);
    }
    countEl.textContent = `${state.rows.length}/${state.total} anı`;
  }

  function makeCard(row) {
    const card = el('article', 'card mem-card');

    const head = el('div', 'term-head');
    head.appendChild(el('h3', 'term-name', row.title));
    if (row.hidden) head.appendChild(el('span', 'pill red', 'gizlendi (yalnız sen görüyorsun)'));
    card.appendChild(head);

    card.appendChild(el('p', 'term-def', row.body));

    const meta = el('div', 'term-meta');
    meta.appendChild(el('span', null, `✍️ ${row.nickname}`));
    meta.appendChild(el('span', null, `· ${String(row.created_at).slice(0, 10)}`));

    if (row.mine) {
      const del = el('button', 'report-link danger-text');
      del.type = 'button';
      del.innerHTML = `${icon('trash', 16)} Sil`;
      del.addEventListener('click', () => confirmDelete(row));
      meta.appendChild(del);
    } else {
      const rep = el('button', 'report-link');
      rep.type = 'button';
      rep.innerHTML = `${icon('flag', 16)} Bildir`;
      rep.addEventListener('click', () => {
        if (!isLoggedIn()) return openLoginModal('Bildirmek için önce giriş yapmalısın.');
        openReportModal('memory', row.id, `Anı: ${row.title}`);
      });
      meta.appendChild(rep);
    }
    card.appendChild(meta);
    return card;
  }

  /* ---------- silme (onaylı) ---------- */
  function confirmDelete(row) {
    openModal((root, close) => {
      root.innerHTML = `
        <h3>${icon('trash', 22)} Anıyı Sil</h3>
        <p class="muted">"<span class="del-title"></span>" anısını silmek istediğine emin misin? Bu işlem geri alınamaz, anı tarihe karışır.</p>
        <div class="row">
          <button type="button" class="btn ghost" id="delNo">Vazgeç</button>
          <button type="button" class="btn danger" id="delYes">Evet, Sil</button>
        </div>`;
      root.querySelector('.del-title').textContent = row.title;
      root.querySelector('#delNo').addEventListener('click', close);
      root.querySelector('#delYes').addEventListener('click', async () => {
        try {
          await apiFetch(`/api/memories/${row.id}`, { method: 'DELETE' });
          close();
          toast('Anı silindi. Ara sıra geri döner umarım. 🕊️');
          state.rows = state.rows.filter((r) => r.id !== row.id);
          state.total = Math.max(0, state.total - 1);
          renderTimeline();
        } catch (e) {
          toast(e.message, true);
        }
      });
    });
  }

  /* ---------- anı ekleme modalı ---------- */
  function openAddModal() {
    if (!isLoggedIn()) return openLoginModal('Anı yazmak için önce giriş yapmalısın.');
    const thisYear = new Date().getFullYear();
    openModal((root, close) => {
      root.innerHTML = `
        <h3>${icon('plus', 22)} Anı Ekle</h3>
        <label class="field"><span>Başlık</span>
          <input class="input" id="mTitle" maxlength="60" placeholder="İlk stadyum maçım" autocomplete="off">
        </label>
        <div class="char-counter"><span id="mTCnt">0/60</span></div>
        <label class="field"><span>Anın</span>
          <textarea class="input" id="mBody" rows="5" maxlength="600" placeholder="Unutamadığın gol, o maç, o gün... Anlat, tribün dinliyor!"></textarea>
        </label>
        <div class="char-counter"><span id="mBCnt">0/600</span></div>
        <label class="field"><span>Yıl</span>
          <input class="input" id="mYear" type="number" min="1950" max="${thisYear}" value="2015" inputmode="numeric">
        </label>
        <p class="muted tiny">Günün ilk anı +5 puan. Gerisi kutsal hâtıra. ✨</p>
        <p class="form-error" id="mErr" hidden></p>
        <button class="btn block" id="mSub">Deftere Yaz</button>`;

      const tIn = root.querySelector('#mTitle');
      const bIn = root.querySelector('#mBody');
      const tCnt = root.querySelector('#mTCnt');
      const bCnt = root.querySelector('#mBCnt');
      tIn.addEventListener('input', () => { tCnt.textContent = `${tIn.value.length}/60`; });
      bIn.addEventListener('input', () => { bCnt.textContent = `${bIn.value.length}/600`; });
      tIn.focus();

      root.querySelector('#mSub').addEventListener('click', async () => {
        const errEl = root.querySelector('#mErr');
        errEl.hidden = true;
        const title = tIn.value.trim();
        const body = bIn.value.trim();
        const year = Number(root.querySelector('#mYear').value);
        if (title.length < 3) { errEl.textContent = 'Başlık en az 3 karakter olmalı.'; errEl.hidden = false; return; }
        if (body.length < 5) { errEl.textContent = 'Anı en az 5 karakter olmalı.'; errEl.hidden = false; return; }
        if (!Number.isInteger(year) || year < 1950 || year > thisYear) {
          errEl.textContent = `Yıl 1950 ile ${thisYear} arasında olmalı.`;
          errEl.hidden = false;
          return;
        }
        try {
          const d = await api.post('/api/memories', { title, body, year });
          close();
          if (d.points > 0) toast(`Anı deftere yazıldı! +${d.points} puan ⭐`);
          else toast('Anı deftere yazıldı! 📖');
          if (d.limitMessage) setTimeout(() => toast(d.limitMessage), 900);
          (d.newBadges || []).forEach((b, i) => setTimeout(() => toast(`🎉 Yeni rozet: ${b.emoji} ${b.name}`), 1400 + i * 700));
          loadMe();
          reload();
        } catch (e) {
          errEl.textContent = e.message;
          errEl.hidden = false;
        }
      });
    });
  }

  /* ---------- olaylar ---------- */
  elRoot.querySelector('#addMemBtn').addEventListener('click', openAddModal);
  elRoot.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const wantMine = tab.dataset.mine === '1';
      if (state.mine === wantMine) return;
      if (wantMine && !isLoggedIn()) return openLoginModal('Kendi anılarını görmek için giriş yapmalısın.');
      state.mine = wantMine;
      elRoot.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      reload();
    });
  });

  loadMore();
}
