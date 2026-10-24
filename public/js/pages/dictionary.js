/**
 * Tribün — Taraftar Sözlüğü (#/sozluk)
 * Okuma herkese açık; ekleme/oy/bildirme için giriş modalı açılır.
 * Kullanıcı metinleri yalnızca textContent ile basılır (XSS yok).
 */
import { api, isLoggedIn } from '../api.js';
import { loadMe } from '../state.js';
import { openModal, openLoginModal, openReportModal, toast, loadingHtml } from '../ui.js';
import { icon } from '../icons.js';

const LIMIT = 20;

/** küçük DOM yardımcısı */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function renderDictionary(root) {
  // Not: parametre adı root — modül düzeyindeki el() DOM yardımcısını gölgelemesin
  // (hata yolunda el(...) çağrısı parametreyi vuruyordu: "el is not a function").
  const state = { sort: 'new', query: '', page: 0, rows: [], total: 0, loading: false };

  root.innerHTML = `
    <section class="card" data-acc="dict">
      <div class="dict-head">
        <h1 style="margin:0"><span class="ico-box" aria-hidden="true">${icon('book', 22)}</span> Taraftar Sözlüğü</h1>
        <button type="button" class="btn small" id="addTermBtn">${icon('plus', 16)} Terim Ekle</button>
      </div>
      <p class="muted small">Tribünün jargonu, halkın tanımlarıyla. Oy ver, en iyi tanımlar zirveye çıksın!</p>
      <div class="tabs">
        <button type="button" class="tab active" data-sort="new">${icon('clock', 16)} En Yeniler</button>
        <button type="button" class="tab" data-sort="top">${icon('flame', 16)} En Beğenilenler</button>
      </div>
      <input class="input" id="dictSearch" type="search" placeholder="🔍 Terim ya da tanım içinde ara (ör. panenka)" autocomplete="off">
      <div id="dictList">${loadingHtml('Sözlük açılıyor...')}</div>
      <div class="center mt" id="moreWrap"></div>
      <p class="muted tiny center" id="dictCount"></p>
    </section>`;

  const listEl = root.querySelector('#dictList');
  const moreWrap = root.querySelector('#moreWrap');
  const countEl = root.querySelector('#dictCount');

  /* ---------- veri ---------- */
  async function loadMore() {
    if (state.loading) return;
    state.loading = true;
    if (state.page === 0) listEl.innerHTML = loadingHtml('Sözlük açılıyor...');
    try {
      const d = await api.get(`/api/dictionary?sort=${state.sort}&page=${state.page + 1}&limit=${LIMIT}`);
      state.page = d.page;
      state.total = d.total;
      state.rows = state.rows.concat(d.rows);
      renderList();
    } catch (e) {
      listEl.innerHTML = '';
      listEl.appendChild(el('div', 'empty', e.message));
    } finally {
      state.loading = false;
    }
  }

  async function reload() {
    state.page = 0;
    state.rows = [];
    await loadMore();
  }

  /* ---------- görüntüleme ---------- */
  function visibleRows() {
    const q = state.query.toLocaleLowerCase('tr').trim();
    if (!q) return state.rows;
    return state.rows.filter((r) =>
      r.term.toLocaleLowerCase('tr').includes(q) || r.definition.toLocaleLowerCase('tr').includes(q)
    );
  }

  function renderList() {
    const rows = visibleRows();
    listEl.innerHTML = '';
    if (!rows.length) {
      listEl.appendChild(el('div', 'empty',
        state.total === 0 && !state.query
          ? 'Henüz terim yok, ilk sözlük yazarı sen ol! ✍️'
          : 'Aramayla eşleşen terim yok. Farklı bir şey dene!'));
    } else {
      rows.forEach((row) => listEl.appendChild(makeCard(row)));
    }

    // Daha fazla yükle
    moreWrap.innerHTML = '';
    const hasMore = state.rows.length < state.total && !state.query;
    if (hasMore) {
      const btn = el('button', 'btn ghost');
      btn.type = 'button';
      btn.innerHTML = `${icon('chevron-down', 18)} Daha fazla yükle`;
      btn.addEventListener('click', loadMore);
      moreWrap.appendChild(btn);
    }
    countEl.textContent = state.query
      ? `${rows.length} sonuç (toplam ${state.total} terim içinde)`
      : `${state.rows.length}/${state.total} terim yüklendi`;
  }

  function makeCard(row) {
    const card = el('article', 'card term-card');

    const head = el('div', 'term-head');
    head.appendChild(el('h3', 'term-name', row.term));

    const vote = el('div', 'vote-row');
    const scoreEl = el('span', 'pill', `👍 ${row.up} · 👎 ${row.down}`);

    const upBtn = el('button', 'vote-btn');
    const downBtn = el('button', 'vote-btn');
    upBtn.type = 'button';
    downBtn.type = 'button';
    upBtn.title = 'Beğen';
    downBtn.title = 'Beğenme';
    upBtn.setAttribute('aria-label', 'Beğen');
    downBtn.setAttribute('aria-label', 'Beğenme');
    upBtn.innerHTML = icon('thumbs-up', 20);
    downBtn.innerHTML = icon('thumbs-down', 20);

    const syncActive = () => {
      upBtn.classList.toggle('active', row.my_vote === 1);
      downBtn.classList.toggle('active', row.my_vote === -1);
    };
    syncActive();

    const doVote = (value) => vote(row, value, { scoreEl, syncActive });
    upBtn.addEventListener('click', () => doVote(1));
    downBtn.addEventListener('click', () => doVote(-1));

    vote.append(upBtn, downBtn, scoreEl);
    head.appendChild(vote);
    card.appendChild(head);

    card.appendChild(el('p', 'term-def', row.definition));

    const meta = el('div', 'term-meta');
    meta.appendChild(el('span', null, `✍️ ${row.nickname}`));
    meta.appendChild(el('span', null, `· ${String(row.created_at).slice(0, 10)}`));
    if (row.mine) {
      meta.appendChild(el('span', 'pill', 'senin terimin'));
    } else {
      const rep = el('button', 'report-link');
      rep.type = 'button';
      rep.innerHTML = `${icon('flag', 16)} Bildir`;
      rep.addEventListener('click', () => {
        if (!isLoggedIn()) return openLoginModal('Bildirmek için önce giriş yapmalısın.');
        openReportModal('term', row.id, `Terim: ${row.term}`);
      });
      meta.appendChild(rep);
    }
    card.appendChild(meta);
    return card;
  }

  /* ---------- oylama (iyimser güncelleme, hatada geri al) ---------- */
  async function vote(row, value, ui) {
    if (!isLoggedIn()) return openLoginModal('Oy vermek için önce giriş yapmalısın.');
    if (row.mine) return toast('Kendi terimine oy veremezsin. 😄', true);

    const before = { up: row.up, down: row.down, my_vote: row.my_vote };

    // İyimser hesap: aynı oy → geri çek, farklı oy → değiştir
    if (row.my_vote === value) {
      row.my_vote = 0;
      if (value === 1) row.up--; else row.down--;
    } else {
      if (row.my_vote === 1) row.up--;
      if (row.my_vote === -1) row.down--;
      row.my_vote = value;
      if (value === 1) row.up++; else row.down++;
    }
    ui.scoreEl.textContent = `👍 ${row.up} · 👎 ${row.down}`;
    ui.syncActive();

    try {
      const d = await api.post(`/api/dictionary/${row.id}/vote`, { value });
      row.up = d.up; row.down = d.down; row.my_vote = d.my_vote;
      if (d.authorBadge) {
        toast(`🌟 Yazara "${d.authorBadge.name}" rozetini kazandırdın!`);
      }
    } catch (e) {
      row.up = before.up; row.down = before.down; row.my_vote = before.my_vote;
      toast(e.message, true);
    }
    ui.scoreEl.textContent = `👍 ${row.up} · 👎 ${row.down}`;
    ui.syncActive();
  }

  /* ---------- terim ekleme modalı ---------- */
  function openAddModal() {
    if (!isLoggedIn()) return openLoginModal('Sözlüğe terim eklemek için önce giriş yapmalısın.');
    openModal((root, close) => {
      root.innerHTML = `
        <h3>${icon('plus', 22)} Terim Ekle</h3>
        <label class="field"><span>Terim</span>
          <input class="input" id="tIn" maxlength="40" placeholder="ör. Panenka" autocomplete="off">
        </label>
        <div class="char-counter"><span id="tCnt">0/40</span></div>
        <label class="field"><span>Tanım</span>
          <textarea class="input" id="dIn" rows="4" maxlength="300" placeholder="Eğlenceli, tribün kokan bir tanım yaz..."></textarea>
        </label>
        <div class="char-counter"><span id="dCnt">0/300</span></div>
        <p class="muted tiny">Günde ilk 2 terim +5'er puan. Küfür ve spam filtrede takılır, temiz yaz! ✨</p>
        <p class="form-error" id="tErr" hidden></p>
        <button class="btn block" id="tSub">Sözlüğe Ekle</button>`;

      const tIn = root.querySelector('#tIn');
      const dIn = root.querySelector('#dIn');
      const tCnt = root.querySelector('#tCnt');
      const dCnt = root.querySelector('#dCnt');
      tIn.addEventListener('input', () => { tCnt.textContent = `${tIn.value.length}/40`; });
      dIn.addEventListener('input', () => { dCnt.textContent = `${dIn.value.length}/300`; });
      tIn.focus();

      root.querySelector('#tSub').addEventListener('click', async () => {
        const errEl = root.querySelector('#tErr');
        errEl.hidden = true;
        const term = tIn.value.trim();
        const definition = dIn.value.trim();
        if (term.length < 2) { errEl.textContent = 'Terim en az 2 karakter olmalı.'; errEl.hidden = false; return; }
        if (definition.length < 5) { errEl.textContent = 'Tanım en az 5 karakter olmalı.'; errEl.hidden = false; return; }

        try {
          const d = await api.post('/api/dictionary', { term, definition });
          close();
          if (d.points > 0) toast(`Terim eklendi! +${d.points} puan ⭐`);
          else toast('Terim eklendi! Yayında. 📚');
          if (d.limitMessage) setTimeout(() => toast(d.limitMessage), 900);
          (d.newBadges || []).forEach((b, i) => setTimeout(() => toast(`🎉 Yeni rozet: ${b.emoji} ${b.name}`), 1400 + i * 700));
          loadMe();
          reload();
        } catch (e) {
          errEl.textContent = e.message; // 409: "zaten var", 400: filtre vb.
          errEl.hidden = false;
        }
      });
    });
  }

  /* ---------- olaylar ---------- */
  root.querySelector('#addTermBtn').addEventListener('click', openAddModal);
  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (state.sort === tab.dataset.sort) return;
      state.sort = tab.dataset.sort;
      root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      reload();
    });
  });
  root.querySelector('#dictSearch').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderList();
  });

  reload();
}
