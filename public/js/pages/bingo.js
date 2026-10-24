/**
 * Tribün — Maç Günü Bingo (#/bingo ve #/bingo/:KOD)
 * 3 saniyelik polling (WebSocket yok). Sekme arka plandayken yavaşlar,
 * geri dönünce anında yenilenir. Sayfa değişince cleanup ile durur.
 * Bingo kararı HEP sunucudan gelir; istemci yalnızca hücre indeksi gönderir.
 */
import { api, isLoggedIn } from '../api.js';
import { loadMe, getUser } from '../state.js';
import { openModal, openLoginModal, toast, loadingHtml, copyText } from '../ui.js';
import { icon } from '../icons.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/* ================= ANA EKRAN ================= */

export function renderBingo(root, params) {
  const code = (params && params[0] ? params[0] : '').toUpperCase();
  if (code) return roomScreen(root, code);
  return mainScreen(root);
}

function mainScreen(root) {
  root.innerHTML = `
    <section class="card" style="text-align:center" data-acc="bingo">
      <span class="ico-box" style="width:64px;height:64px;margin-bottom:12px" aria-hidden="true">${icon('target', 34)}</span>
      <h1 style="margin-top:4px">Maç Günü Bingo</h1>
      <p class="muted">Maçı izlerken kartını doldur, ilk bingoyu yap! Aynı odada herkesin kartı farklı dizilimli — şans ve hız işi.</p>
      <button type="button" class="btn yellow big block" id="createRoom">🏟️ Oda Kur</button>
      <div class="join-row">
        <input class="input" id="joinCode" maxlength="6" placeholder="6 HANELİ KOD" autocomplete="off" autocapitalize="characters">
        <button type="button" class="btn" id="joinBtn">${icon('arrow-right', 18)} Katıl</button>
      </div>
      <p class="muted tiny">Arkadaşından oda kodunu al ya da sen kur, kodu gönder. Kazanan 30 puan, katılanlara 5 puan!</p>
    </section>
    <section class="card" id="myRoomsCard" hidden>
      <h2 style="margin:0 0 8px">🚪 Açık Odalarım</h2>
      <div id="myRoomsList"></div>
    </section>`;

  const codeIn = root.querySelector('#joinCode');
  codeIn.addEventListener('input', () => {
    codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') root.querySelector('#joinBtn').click(); });

  const createBtn = root.querySelector('#createRoom');
  createBtn.addEventListener('click', async () => {
    if (!isLoggedIn()) return openLoginModal('Oda kurmak için önce giriş yapmalısın.');
    createBtn.disabled = true;
    createBtn.textContent = 'Oda kuruluyor...';
    try {
      const d = await api.post('/api/bingo/rooms', {});
      toast(`Oda kuruldu! Kod: ${d.code} 🎉`);
      (d.newBadges || []).forEach((b, i) => setTimeout(() => toast(`🎉 Yeni rozet: ${b.emoji} ${b.name}`), 800 + i * 700));
      location.hash = '#/bingo/' + d.code;
    } catch (e) {
      toast(e.message, true);
      createBtn.disabled = false;
      createBtn.textContent = '🏟️ Oda Kur';
    }
  });

  const joinBtn = root.querySelector('#joinBtn');
  joinBtn.addEventListener('click', () => {
    const code = codeIn.value.trim();
    if (code.length !== 6) return toast('Kod 6 haneli olmalı.', true);
    if (!isLoggedIn()) {
      // giriş sonrası bu odaya otomatik yönlendirilir (pendingRoute)
      openLoginModal('Odaya katılmak için önce giriş yapmalısın.');
      location.hash = '#/bingo/' + code;
      return;
    }
    location.hash = '#/bingo/' + code;
  });

  // Açık odalarım
  if (isLoggedIn()) {
    api.get('/api/bingo/my-rooms').then((d) => {
      if (!d.rooms.length) return;
      root.querySelector('#myRoomsCard').hidden = false;
      const list = root.querySelector('#myRoomsList');
      for (const r of d.rooms) {
        const a = el('a', 'card shortcut room-link');
        a.href = '#/bingo/' + r.code;
        a.appendChild(el('b', null, `🏟️ ${r.code}`));
        a.appendChild(el('span', 'muted', `${r.player_count}/10 oyuncu · ${r.isOwner ? 'kurucusun' : 'üyesin'}`));
        list.appendChild(a);
      }
    }).catch(() => { /* sessiz: ana ekran yine çalışır */ });
  }
}

/* ================= ODA EKRANI ================= */

function roomScreen(root, code) {
  let state = null;          // sunucudan gelen oda durumu (ESAS)
  let pollTimer = null;
  let stopped = false;
  let announcedWinner = false;
  let joinedOnce = false;

  root.innerHTML = `
    <section class="card" id="roomCard">${loadingHtml('Odaya giriliyor...')}</section>`;

  const cardEl = root.querySelector('#roomCard');

  async function refresh() {
    if (stopped) return;
    try {
      const d = await api.get(`/api/bingo/rooms/${code}`);
      state = d;
      hideConnWarn();
      render();

      // Girişli + üye değil + açık oda → otomatik katıl (paylaşılan link akışı)
      if (isLoggedIn() && !state.member && state.canJoin && !joinedOnce) {
        joinedOnce = true;
        await doJoin();
      }
    } catch (e) {
      if (e.status === 404) {
        stopped = true;
        stopPolling();
        cardEl.innerHTML = '';
        const box = el('div', 'empty');
        box.appendChild(el('div', null, '🤷 Oda bulunamadı. Kodu kontrol et ya da yeni bir oda kur.'));
        const btn = el('button', 'btn');
        btn.type = 'button';
        btn.innerHTML = `${icon('home', 18)} Bingo Ana Ekranı`;
        btn.addEventListener('click', () => { location.hash = '#/bingo'; });
        box.appendChild(btn);
        cardEl.appendChild(box);
        return;
      }
      showConnWarn(); // ağ hatası: işaretler kaybolmaz, sunucu esastır
    }
  }

  async function doJoin() {
    try {
      const d = await api.post(`/api/bingo/rooms/${code}/join`, {});
      state = d.room;
      toast('Odaya katıldın! Kartın hazır. 🎯');
      render();
    } catch (e) {
      toast(e.message, true);
    }
  }

  function showConnWarn() {
    const elWarn = cardEl.querySelector('.conn-warn');
    if (elWarn) elWarn.hidden = false;
  }
  function hideConnWarn() {
    const elWarn = cardEl.querySelector('.conn-warn');
    if (elWarn) elWarn.hidden = true;
  }

  /* ---------- çizim ---------- */
  function render() {
    if (!state) return;
    const finished = state.status === 'finished';

    // iskelet (statik metinler)
    cardEl.innerHTML = `
      <div class="room-head">
        <div>
          <span class="pill yellow room-code-pill"></span>
          <span class="room-status"></span>
        </div>
        <div class="row">
          <button type="button" class="btn small ghost" id="copyCode">${icon('copy', 16)} Kodu Kopyala</button>
          <button type="button" class="btn small ghost" id="copyLink">${icon('link', 16)} Linki Kopyala</button>
          ${state.isOwner && !finished ? `<button type="button" class="btn small danger" id="finishRoom">${icon('flag', 16)} Odayı Kapat</button>` : ''}
          <button type="button" class="btn small ghost" id="exitRoom">${icon('arrow-left', 16)} Çık</button>
        </div>
      </div>
      <p class="conn-warn form-error" hidden>⚠️ Bağlantı sorunu, tekrar deneniyor... İşaretlerin yerinde, panik yok.</p>
      <div class="bingo-layout">
        <div class="bingo-card-wrap">
          <div class="bingo-grid" id="bingoGrid"></div>
        </div>
        <aside class="bingo-side">
          <h3 style="margin:0 0 8px">${icon('users', 20)} Oyuncular (<span id="pCount"></span>)</h3>
          <div id="playerList" class="player-list"></div>
        </aside>
      </div>
      <div id="roomFooter"></div>`;

    cardEl.querySelector('.room-code-pill').textContent = `🏟️ ${state.code}`;
    const st = cardEl.querySelector('.room-status');
    st.textContent = finished ? ' · BITTI 🏁' : ' · CANLI';
    st.className = 'room-status ' + (finished ? 'muted' : '');
    cardEl.querySelector('#pCount').textContent = `${state.playerCount}/${state.maxPlayers}`;

    // kopyalama butonları
    cardEl.querySelector('#copyCode').addEventListener('click', async () => {
      const ok = await copyText(state.code);
      toast(ok ? 'Oda kodu panoya kopyalandı! Arkadaşına gönder. 📋' : 'Kopyalanamadı.', !ok);
    });
    cardEl.querySelector('#copyLink').addEventListener('click', async () => {
      const ok = await copyText(`${location.origin}/#/bingo/${state.code}`);
      toast(ok ? 'Oda linki panoya kopyalandı! 🔗' : 'Kopyalanamadı.', !ok);
    });
    cardEl.querySelector('#exitRoom').addEventListener('click', () => { location.hash = '#/bingo'; });
    const finBtn = cardEl.querySelector('#finishRoom');
    if (finBtn) {
      finBtn.addEventListener('click', async () => {
        try {
          const d = await api.post(`/api/bingo/rooms/${code}/finish`, {});
          state = d.room;
          toast('Oda kapatıldı. İyi maçtı!');
          render();
        } catch (e) { toast(e.message, true); }
      });
    }

    // kart
    const grid = cardEl.querySelector('#bingoGrid');
    const card = state.myCard;
    if (!card) {
      grid.appendChild(el('div', 'empty', 'Kartını görmek için odaya katılmalısın.'));
      if (state.canJoin) {
        const jb = el('button', 'btn yellow big');
        jb.type = 'button';
        jb.innerHTML = `${icon('arrow-right', 18)} Odaya Katıl`;
        jb.addEventListener('click', () => {
          if (!isLoggedIn()) return openLoginModal('Odaya katılmak için önce giriş yapmalısın.');
          doJoin();
        });
        grid.appendChild(jb);
      } else if (state.status === 'finished') {
        grid.appendChild(el('p', 'muted', 'Bu oda çoktan bitti.'));
      } else {
        grid.appendChild(el('p', 'muted', 'Oda dolu.'));
      }
    } else {
      const marks = new Set(card.marked);
      card.cells.forEach((cell, idx) => {
        const btn = el('button', 'bingo-cell' + (cell.free ? ' free' : '') + (marks.has(idx) || cell.free ? ' marked' : ''));
        btn.type = 'button';
        btn.textContent = cell.free ? '⚽ BEDAVA' : cell.text;
        btn.setAttribute('aria-label', cell.free ? 'Bedava hücre' : cell.text);
        if (finished) btn.disabled = true;
        else if (cell.free) btn.disabled = true;
        else btn.addEventListener('click', () => toggleMark(idx, btn));
        grid.appendChild(btn);
      });
    }

    // oyuncu listesi (takma adlar textContent ile)
    const plist = cardEl.querySelector('#playerList');
    for (const p of state.players) {
      const row = el('div', 'player-row' + (p.bingo ? ' winner' : ''));
      row.appendChild(el('span', 'p-nick', `${p.bingo ? '🏆 ' : ''}${p.nickname}`));
      row.appendChild(el('span', 'p-count muted', `${p.markedCount}/25`));
      plist.appendChild(row);
    }

    // alt bilgi / bitiş özeti
    const footer = cardEl.querySelector('#roomFooter');
    if (finished) {
      const box = el('div', 'result-hero');
      box.appendChild(el('div', 'result-emoji', state.winner ? '🏆' : '🏁'));
      const h = el('h1', null, state.winner ? `${state.winner} kazandı!` : 'Oda kapandı');
      box.appendChild(h);
      box.appendChild(el('p', 'muted', state.winner ? 'Bingo yapıldı, kartlar kilitlendi. İyi oyundu!' : 'Kurucu odayı kapattı.'));
      const row = el('div', 'row');
      const again = el('button', 'btn yellow');
      again.type = 'button';
      again.innerHTML = `${icon('target', 18)} Yeni Oda Kur`;
      again.addEventListener('click', () => { location.hash = '#/bingo'; setTimeout(() => document.querySelector('#createRoom')?.click(), 60); });
      const home = el('button', 'btn ghost');
      home.type = 'button';
      home.innerHTML = `${icon('home', 18)} Ana Ekran`;
      home.addEventListener('click', () => { location.hash = '#/bingo'; });
      row.append(again, home);
      box.appendChild(row);
      footer.appendChild(box);

      // kazanan bildirimi (bir kez)
      if (state.winner && !announcedWinner) {
        announcedWinner = true;
        const me = getUser();
        const meWin = !!(me && state.players.some((p) => p.bingo && p.nickname === me.nickname));
        if (!meWin) toast(`🎉 ${state.winner} bingo yaptı! Oda bitti.`);
      }
    } else {
      footer.appendChild(el('p', 'muted tiny center', state.myCard
        ? 'Hücreye dokun: işaretle / tekrar dokun: kaldır. Bingo kararı sunucuda — hızlı ama dürüst ol! ⚡'
        : 'Odaya katılmadan kartı göremezsin.'));
    }
  }

  /* ---------- işaretleme (optimistik, sunucu esas) ---------- */
  async function toggleMark(idx, btn) {
    if (!state || !state.myCard || state.status !== 'open') return;

    // iyimser görünüm
    const has = state.myCard.marked.includes(idx);
    btn.classList.toggle('marked', !has);
    state.myCard.marked = has ? state.myCard.marked.filter((x) => x !== idx) : [...state.myCard.marked, idx];

    try {
      const d = await api.post(`/api/bingo/rooms/${code}/mark`, { idx });
      // sunucudaki durum esas alınır
      state = d.room || state;
      render();
      if (d.bingo && d.won) celebrateWin(d);
      else if (d.bingo && !d.won) toast('Bingo yaptın ama biri bir saniye önce davrandı! 🥈', true);
    } catch (e) {
      // geri al
      const wasThere = state.myCard && state.myCard.marked.includes(idx);
      state.myCard.marked = wasThere
        ? state.myCard.marked.filter((x) => x !== idx)
        : [...(state.myCard.marked || []), idx];
      render();
      toast(e.message, true);
    }
  }

  function celebrateWin(d) {
    loadMe(); // üst bar puanı
    openModal((mroot, close) => {
      mroot.innerHTML = `
        <div style="text-align:center">
          <div class="bingo-celebrate">🎉⚽🎉</div>
          <h3>BINGO! Kazandın!</h3>
          <p class="points-line">${d.points > 0 ? `+${d.points} puan kazandın! ⭐` : 'Puanın bugünlük doldu ama zafer zaferdir! 🏆'}</p>
          <div class="chips" id="winBadges"></div>
          <div class="row" style="justify-content:center;margin-top:12px">
            <button type="button" class="btn yellow" id="stayBtn">Odada Kal</button>
            <button type="button" class="btn ghost" id="newRoomBtn">${icon('target', 18)} Yeni Oda</button>
          </div>
        </div>`;
      const badges = mroot.querySelector('#winBadges');
      (d.newBadges || []).forEach((b) => {
        const c = el('span', 'chip', `${b.emoji} ${b.name}`);
        badges.appendChild(c);
        setTimeout(() => toast(`🎉 Yeni rozet: ${b.emoji} ${b.name}`), 600);
      });
      mroot.querySelector('#stayBtn').addEventListener('click', close);
      mroot.querySelector('#newRoomBtn').addEventListener('click', () => { close(); location.hash = '#/bingo'; });
    });
  }

  /* ---------- polling (3sn; arka planda 15sn) ---------- */
  function startPolling(ms) {
    stopPolling();
    pollTimer = setInterval(refresh, ms);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  const onVisibility = () => {
    if (stopped) return;
    if (document.hidden) startPolling(15000);
    else { startPolling(3000); refresh(); }
  };
  document.addEventListener('visibilitychange', onVisibility);

  startPolling(3000);
  refresh();

  // cleanup: sayfa değişince polling DURUR
  return function cleanup() {
    stopped = true;
    stopPolling();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
