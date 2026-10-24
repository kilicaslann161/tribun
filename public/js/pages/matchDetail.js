/**
 * Tribün — Maç detay sayfası (#/mac/:id) · AŞAMA 8 (yalnızca futbol)
 *
 * Veri kaynağı: GET /api/sports/matches/:id/detail — SportScore'a istek
 * atabilen TEK kullanıcı rotası (sunucu tarafında TTL/tek-uçuş/kimlik
 * denetimi/bütçe tavanı; tarayıcı asla doğrudan sağlayıcıya gitmez).
 *
 * Yerleşim (talimat):
 *  - Üstte skor tahtası: logo + kısa adlar, skor (null → "-"), durum
 *    etiketi, dakika (varsa), devre skoru (varsa), başlama TR saati, lig adı.
 *  - OLAYLAR: dakika sırasına göre iki yana açık zaman çizelgesi; gol,
 *    penaltı golü (ayrı ikon/etiket), sarı kart, oyuncu değişikliği
 *    (giren/çıkan), VAR; bilinmeyen tür genel ikonla. İkonlar inline SVG
 *    (emoji YOK). Aynı dakikadaki olaylar API sırasında kalır (sunucu
 *    kararlı sıralar).
 *  - İSTATİSTİKLER: home_pct/away_pct ile karşılaştırmalı yatay çubuklar;
 *    etiketler sunucudan Türkçe (Aşama 2 sözlüğü), bilinmeyen olduğu gibi.
 *  - KADROLAR: iki takım yan yana (mobilde alt alta); ilk 11 + yedekler;
 *    mevki grupları G/D/M/F → Kaleci/Defans/Orta Saha/Forvet; forma
 *    numarası + kaptan işareti (C). Dizilim başlıkta. Oyuncu PUANI
 *    (rating) GÖSTERİLMEZ; saha dizilim çizimi YOK.
 *  - Verisi olmayan bölüm: "Bu maç için ... verisi sağlanmıyor" notu.
 *
 * Canlı maçta 60 sn'de bir KENDİ detay API'mizden yenilenir (talimat);
 * sekme gizliyken durur, sayfadan çıkınca cleanup her şeyi temizler.
 * "Son güncelleme" ve bayat veri uyarısı her zaman görünür durumdadır.
 * Erişilebilirlik: tüm dinamik metinler textContent (XSS'e kapalı);
 * ikonlar aria-hidden + anlam metinle taşınır; odak halkası global
 * :focus-visible'dan gelir.
 */
import { icon } from '../icons.js';
import { fmtClock, logoNode, STATUS_TR, PERIOD_TR } from '../matchesBoard.js';

const REFRESH_MS = 60000;                 // canlı maçta 60 sn'de bir (talimat)
const LIVE_STATUSES = ['live', 'halftime'];

/* olay türü → ikon adı + Türkçe etiket (ikona eşlik eden metin) */
const EVENT_META = {
  goal: { ico: 'goal', label: 'Gol', cls: 'md-ico-goal' },
  penalty_goal: { ico: 'pen', label: 'Penaltı Golü', cls: 'md-ico-pen' },
  yellow_card: { ico: 'card', label: 'Sarı Kart', cls: 'md-ico-card' },
  substitution: { ico: 'sub', label: 'Oyuncu Değişikliği', cls: 'md-ico-sub' },
  var: { ico: 'var', label: 'VAR', cls: 'md-ico-var' },
  other: { ico: 'event', label: 'Olay', cls: 'md-ico-event' }
};

/* mevki → grup etiketi (sıra önemli; bilinmeyenler sonda) */
const POS_GROUPS = [
  ['G', 'Kaleci'],
  ['D', 'Defans'],
  ['M', 'Orta Saha'],
  ['F', 'Forvet']
];

/* uyarı üçgeni (inline SVG — emoji yok; matchesBoard ile aynı) */
const WARN_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/></svg>';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** durum satırı: CANLI rozeti + periyot + dakika (varsa) */
function statusNodes(m, box) {
  if (LIVE_STATUSES.includes(m.status)) {
    const badge = el('span', 'md-live-badge');
    const dot = el('i', 'sp-dot');
    dot.setAttribute('aria-hidden', 'true');
    badge.append(dot, el('span', '', 'CANLI'));
    box.append(badge);
    const key = String(m.period || '').trim().toUpperCase();
    const p = PERIOD_TR[key] || (key ? key : (m.status === 'halftime' ? 'Devre Arası' : ''));
    if (p) box.append(el('span', 'md-sub', p));
    if (typeof m.minute === 'number') {
      box.append(el('span', 'md-minute', m.minute + "'"));
    }
    return;
  }
  box.append(el('span', '', STATUS_TR[m.status] || 'Bilinmiyor'));
}

/* ---------------- skor tahtası ---------------- */

function drawBoard(root, m) {
  const board = el('section', 'md-board' + (LIVE_STATUSES.includes(m.status) ? ' is-live' : ''));
  board.setAttribute('aria-label', 'Skor tahtası');

  /* lig satırı: AŞAMA 7 lig sayfasına bağlantı */
  const comp = m.competition || {};
  const compLink = el('a', 'md-comp');
  compLink.href = '#/lig/' + encodeURIComponent(comp.slug || '');
  if (comp.logo_url) {
    const img = document.createElement('img');
    img.src = comp.logo_url;
    img.alt = '';
    img.width = 18; img.height = 18;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    compLink.append(img);
  }
  const compName = el('span', '', comp.name || 'Lig');
  compLink.append(compName);
  board.append(compLink);

  /* üç sütun: ev — skor — deplasman */
  const teams = el('div', 'md-teams');

  const homeBox = el('div', 'md-team');
  homeBox.append(logoNode(m.home && m.home.logo_url, (m.home && m.home.display_name) || '?'));
  homeBox.append(el('b', '', (m.home && m.home.display_name) || '?'));

  const awayBox = el('div', 'md-team');
  awayBox.append(logoNode(m.away && m.away.logo_url, (m.away && m.away.display_name) || '?'));
  awayBox.append(el('b', '', (m.away && m.away.display_name) || '?'));

  const center = el('div', 'md-center');
  const h = m.home && m.home.score;
  const a = m.away && m.away.score;
  const scoreTxt = (typeof h === 'number' && typeof a === 'number')
    ? h + ' : ' + a : '-';
  center.append(el('span', 'md-score', scoreTxt));
  const st = el('span', 'md-status');
  statusNodes(m, st);
  center.append(st);
  if (m.ht_home !== null && m.ht_home !== undefined
      && m.ht_away !== null && m.ht_away !== undefined) {
    center.append(el('span', 'md-ht', 'İY ' + m.ht_home + ' - ' + m.ht_away));
  }
  center.append(el('span', 'md-kickoff', 'Başlama ' + fmtClock(m.kickoff_utc) + ' (TR)'));

  teams.append(homeBox, center, awayBox);
  board.append(teams);
  root.append(board);
}

/* ---------------- olaylar ---------------- */

/** Tek olay çipi: ikon + başlık + alt satır (gol skoru / giren-çıkan / tür) */
function eventChip(ev) {
  const meta = EVENT_META[ev.type] || EVENT_META.other;
  const chip = el('span', 'md-chip');

  const icoHtml = icon(meta.ico, 16);
  const wrap = el('span', meta.cls || '');
  wrap.insertAdjacentHTML('beforeend', icoHtml);
  chip.append(wrap);

  const txt = el('span', 'md-chip-txt');
  const isSub = ev.type === 'substitution';
  const head = isSub
    ? (ev.playerIn || ev.playerOut || 'Oyuncu değişikliği')
    : (ev.player || (ev.type !== 'other' ? meta.label : (ev.typeRaw || meta.label)));
  txt.append(el('b', '', head));

  const subParts = [];
  if (isSub) {
    if (ev.playerIn) subParts.push('Giren: ' + ev.playerIn);
    if (ev.playerOut) subParts.push('Çıkan: ' + ev.playerOut);
  } else if (ev.type === 'goal' || ev.type === 'penalty_goal') {
    subParts.push(meta.label);
    if (typeof ev.homeScore === 'number' && typeof ev.awayScore === 'number') {
      subParts.push(ev.homeScore + '-' + ev.awayScore);
    }
  } else if (ev.type === 'other' && ev.player && ev.typeRaw) {
    subParts.push(ev.typeRaw);
  }
  if (subParts.length) txt.append(el('span', '', subParts.join(' · ')));
  chip.append(txt);
  return chip;
}

function drawEvents(body, items) {
  body.innerHTML = '';
  if (!items.length) {
    const empty = el('div', 'sp-empty', 'Bu maç için olay verisi sağlanmıyor.');
    empty.insertAdjacentHTML('afterbegin', icon('event', 30));
    body.append(empty);
    return;
  }
  const list = el('div', 'md-timeline');
  list.setAttribute('role', 'list');
  for (const ev of items) {
    const row = el('div', 'md-ev ' + (ev.side === 'away' ? 'md-ev-away' : 'md-ev-home'));
    row.setAttribute('role', 'listitem');
    /* ev sahibi çipi solda (sağa yaslı), dakika ortada, deplasman sağda */
    const min = el('span', 'md-ev-min',
      (typeof ev.minute === 'number' ? ev.minute + "'" : "·"));
    row.setAttribute('aria-label', (ev.side === 'away' ? 'Deplasman: ' : 'Ev sahibi: ')
      + (ev.type === 'substitution'
        ? 'oyuncu değişikliği'
        : ((EVENT_META[ev.type] || EVENT_META.other).label.toLowerCase()))
      + (typeof ev.minute === 'number' ? ', ' + ev.minute + '. dakika' : ''));
    if (ev.side === 'away') {
      row.append(el('span'), min, eventChip(ev));
    } else {
      row.append(eventChip(ev), min, el('span'));
    }
    list.append(row);
  }
  body.append(list);
}

/* ---------------- istatistikler ---------------- */

/** yüzde alanları yoksa değerlerden türet; ikisi de sayı değilse null */
function pctPair(s) {
  const hp = typeof s.homePct === 'number' ? s.homePct : null;
  const ap = typeof s.awayPct === 'number' ? s.awayPct : null;
  if (hp !== null && ap !== null) return [hp, ap];
  const h = Number(s.home);
  const a = Number(s.away);
  if (Number.isFinite(h) && Number.isFinite(a) && (h + a) > 0) {
    return [Math.round((h / (h + a)) * 100), Math.round((a / (h + a)) * 100)];
  }
  return null;
}

function drawStats(body, items) {
  body.innerHTML = '';
  if (!items.length) {
    const empty = el('div', 'sp-empty', 'Bu maç için istatistik verisi sağlanmıyor.');
    empty.insertAdjacentHTML('afterbegin', icon('fire', 30));
    body.append(empty);
    return;
  }
  const box = el('div', 'md-stats');
  for (const s of items) {
    const stat = el('div', 'md-stat');
    stat.setAttribute('role', 'group');
    stat.setAttribute('aria-label',
      (s.labelTr || s.label || 'İstatistik') + ': ' + s.home + ' - ' + s.away);

    const nums = el('div', 'md-stat-nums');
    const hv = el('b', '', (s.home ?? '-') + (s.suffix || ''));
    const label = el('span', 'md-stat-label', s.labelTr || s.label || 'İstatistik');
    const av = el('b', 'md-aw', (s.away ?? '-') + (s.suffix || ''));
    nums.append(hv, label, av);
    stat.append(nums);

    const bars = el('div', 'md-bars');
    const pct = pctPair(s);
    const [hp, ap] = pct || [50, 50];
    const bh = el('i', 'md-bar md-bar-h');
    const ba = el('i', 'md-bar md-bar-a');
    bh.style.width = Math.max(0, Math.min(100, hp)) + '%';
    ba.style.width = Math.max(0, Math.min(100, ap)) + '%';
    bars.append(bh, ba);
    stat.append(bars);
    box.append(stat);
  }
  body.append(box);
}

/* ---------------- kadrolar ---------------- */

function playerRow(p) {
  const row = el('div', 'md-player');
  row.append(el('span', 'md-num', p.number === null || p.number === undefined ? '-' : String(p.number)));
  row.append(el('span', 'md-name', p.name || '?'));
  if (p.captain) row.append(el('span', 'md-cap', 'C'));
  return row;
}

/** oyuncuları mevkiye göre grupla; bilinmeyen mevki "Diğer" grubuna */
function positionGroups(players) {
  const groups = new Map();
  for (const p of players || []) {
    const pos = String(p.position || '').trim().toUpperCase();
    groups.set(pos, (groups.get(pos) || 0) + 1);
  }
  const out = [];
  for (const [key, label] of POS_GROUPS) {
    if (!groups.has(key)) continue;
    out.push({ label, players: (players || []).filter((p) => String(p.position || '').trim().toUpperCase() === key) });
    groups.delete(key);
  }
  if (groups.size) {
    out.push({
      label: 'Diğer',
      players: (players || []).filter((p) => {
        const pos = String(p.position || '').trim().toUpperCase();
        return !POS_GROUPS.some(([k]) => k === pos);
      })
    });
  }
  return out;
}

function teamLineup(name, formation, xi, subs) {
  const box = el('div', 'md-lu');
  const head = el('div', 'md-lu-head');
  head.append(el('b', '', name || '?'));
  if (formation) head.append(el('span', 'md-lu-form', formation));
  box.append(head);

  box.append(el('div', 'md-lu-part', 'İlk 11'));
  if (xi && xi.length) {
    for (const g of positionGroups(xi)) {
      box.append(el('div', 'md-lu-pos', g.label));
      for (const p of g.players) box.append(playerRow(p));
    }
  } else {
    box.append(el('div', 'md-player', '—'));
  }

  box.append(el('div', 'md-lu-part', 'Yedekler'));
  if (subs && subs.length) {
    for (const g of positionGroups(subs)) {
      box.append(el('div', 'md-lu-pos', g.label));
      for (const p of g.players) box.append(playerRow(p));
    }
  } else {
    box.append(el('div', 'md-player', '—'));
  }
  return box;
}

function drawLineups(body, lu, m) {
  body.innerHTML = '';
  const hasAny = (lu.home_xi && lu.home_xi.length) || (lu.away_xi && lu.away_xi.length);
  if (!lu.available || !hasAny) {
    const empty = el('div', 'sp-empty', 'Bu maç için kadro verisi sağlanmıyor.');
    empty.insertAdjacentHTML('afterbegin', icon('users', 30));
    body.append(empty);
    return;
  }
  const grid = el('div', 'md-lineups');
  grid.append(teamLineup(
    (m.home && m.home.display_name) || 'Ev sahibi',
    lu.home_formation, lu.home_xi, lu.home_subs
  ));
  grid.append(teamLineup(
    (m.away && m.away.display_name) || 'Deplasman',
    lu.away_formation, lu.away_xi, lu.away_subs
  ));
  body.append(grid);
}

/* ---------------- sayfa ---------------- */

export function renderMatchDetail(root, params) {
  const rawId = String((params && params[0]) || '').trim();
  const S = {
    data: null,       // son başarılı detay yanıtı
    failed: false,    // son yükleme/yenileme hatası
    notFound: false,
    destroyed: false,
    timer: null,
    controller: null
  };

  /* geçersiz id: istek atmadan dost sayfa */
  if (!/^\d+$/.test(rawId)) {
    drawNotFound(root, 'Maç adresi geçersiz görünüyor.');
    return cleanup;
  }

  /* statik iskelet */
  root.innerHTML = `
    <div class="md-top">
      <a class="md-back" href="#/">${icon('arrow-left', 16)} Günün Maçları</a>
    </div>
    <div id="mdBoard" class="md-board skeleton-board skeleton"></div>
    <div class="sp-note" id="mdStale" hidden>${WARN_SVG} Veriler gecikmeli olabilir</div>
    <div class="sp-note" id="mdNotice" hidden></div>
    <section class="card md-card" aria-labelledby="mdEvTitle">
      <div class="md-sec-head">
        <h2 class="section-title" id="mdEvTitle">${icon('clock', 22)} OLAYLAR</h2>
        <span class="sp-updated" id="mdUpdated"></span>
      </div>
      <div id="mdEvents">
        <div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
      </div>
    </section>
    <section class="card md-card" aria-labelledby="mdStTitle">
      <div class="md-sec-head">
        <h2 class="section-title" id="mdStTitle">${icon('fire', 22)} İSTATİSTİKLER</h2>
      </div>
      <div id="mdStats">
        <div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>
      </div>
    </section>
    <section class="card md-card" aria-labelledby="mdLuTitle">
      <div class="md-sec-head">
        <h2 class="section-title" id="mdLuTitle">${icon('users', 22)} KADROLAR</h2>
      </div>
      <div id="mdLineups">
        <div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>
      </div>
      <div class="sp-error" id="mdError" hidden>
        ${WARN_SVG}
        <p>Maç detayı şu an yüklenemedi.</p>
        <button type="button" class="btn small ghost" id="mdRetry">${icon('refresh', 16)} Tekrar dene</button>
      </div>
    </section>
    <a class="sp-attribution" href="https://sportscore.com/" rel="dofollow noopener" title="Sports data by SportScore" target="_blank">Powered by SportScore</a>`;

  const $ = (sel) => root.querySelector(sel);
  const boardEl = $('#mdBoard');
  const staleEl = $('#mdStale');
  const noticeEl = $('#mdNotice');
  const eventsEl = $('#mdEvents');
  const statsEl = $('#mdStats');
  const lineupsEl = $('#mdLineups');
  const errorEl = $('#mdError');
  const updatedEl = $('#mdUpdated');

  function drawNotFound(rootEl, msg) {
    rootEl.innerHTML = `
      <section class="card" style="text-align:center">
        <span class="ico-box" style="width:64px;height:64px;margin:12px auto" aria-hidden="true">${icon('ball', 34)}</span>
        <h1 style="margin-top:4px">Böyle bir maç yok</h1>
        <p class="muted">${msg}</p>
        <a class="btn" href="#/">${icon('arrow-left', 18)} Ana Sayfaya Dön</a>
      </section>`;
  }

  /* ---- veri çekme ---- */
  async function load({ silent = false } = {}) {
    if (S.destroyed) return;
    if (S.controller) S.controller.abort();
    const ctrl = new AbortController();
    S.controller = ctrl;
    try {
      const res = await fetch(`/api/sports/matches/${rawId}/detail`, { signal: ctrl.signal });
      if (S.destroyed) return;
      if (res.status === 404) { S.notFound = true; draw(); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      if (S.destroyed || ctrl.signal.aborted) return;
      S.data = d;
      S.failed = false;
      draw();
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (S.destroyed) return;
      /* sessiz yenileme hatasında ESKİ VERİ KORUNUR + bayat uyarısı
       * (talimat: "Backend'i kapatınca son kayıtlı detay stale uyarısıyla
       * gösteriliyor"); ilk yükleme hatasında hata bloğu gösterilir. */
      S.failed = true;
      if (!silent) S.data = null;
      draw();
    } finally {
      if (S.controller === ctrl) S.controller = null;
    }
  }

  /* ---- çizim ---- */
  function draw() {
    const d = S.data;

    if (S.notFound) {
      drawNotFound(root, 'Aradığın maç Tribün listesinde değil ya da kaldırıldı.');
      return;
    }

    /* hata: veri yoksa blok; varsa yalnız bayat şeridi (eski veri korunur) */
    errorEl.hidden = !(S.failed && !d);
    if (S.failed && !d) {
      boardEl.classList.add('skeleton', 'skeleton-board');
      eventsEl.innerHTML = '';
      statsEl.innerHTML = '';
      lineupsEl.innerHTML = '';
      schedule();
      return;
    }

    const m = d.match || {};
    const meta = d.meta || {};

    /* skor tahtası */
    boardEl.classList.remove('skeleton', 'skeleton-board');
    boardEl.innerHTML = '';
    const boardFrag = document.createDocumentFragment();
    drawBoard(boardFrag, m);
    boardEl.append(boardFrag);

    /* available:false → bölüm notları + sunucu mesajı */
    if (!d.available) {
      noticeEl.hidden = false;
      noticeEl.textContent = '';
      noticeEl.insertAdjacentHTML('afterbegin', WARN_SVG + ' ');
      noticeEl.append(document.createTextNode(d.message || 'Bu maç için detay verisi sağlanmıyor.'));
      drawEvents(eventsEl, []);
      drawStats(statsEl, []);
      drawLineups(lineupsEl, { available: false, home_xi: [], away_xi: [], home_subs: [], away_subs: [] }, m);
      updatedEl.textContent = '';
      schedule();
      return;
    }
    noticeEl.hidden = true;

    /* bölümler */
    const sec = d.sections || {};
    drawEvents(eventsEl, (sec.events && sec.events.items) || []);
    drawStats(statsEl, (sec.stats && sec.stats.items) || []);
    drawLineups(lineupsEl, sec.lineups || {}, m);

    /* son güncelleme + bayat veri uyarısı */
    updatedEl.textContent = meta.fetched_at
      ? 'Son güncelleme: ' + fmtClock(meta.fetched_at)
      : '';
    staleEl.hidden = !(meta.stale || S.failed);

    schedule();
  }

  /* ---- canlı yenileme: 60 sn, yalnız canlı maçta ---- */
  function stopAuto() {
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
  }

  function schedule() {
    stopAuto();
    if (S.destroyed || !S.data || !S.data.available) return;
    const st = S.data.match && S.data.match.status;
    if (!LIVE_STATUSES.includes(st)) return;      // bitmiş/başlamamış: yenileme yok
    if (document.hidden) return;                   // sekme gizliyken istek yok
    S.timer = setInterval(() => load({ silent: true }), REFRESH_MS);
  }

  const onVisibility = () => {
    if (S.destroyed) return;
    if (document.hidden) {
      stopAuto();
    } else {
      const st = S.data && S.data.match && S.data.match.status;
      if (S.data && S.data.available && LIVE_STATUSES.includes(st)) {
        load({ silent: true });                    // dönünce anında tazele
        schedule();
      }
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  $('#mdRetry').addEventListener('click', () => {
    S.failed = false;
    errorEl.hidden = true;
    eventsEl.innerHTML = '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>';
    statsEl.innerHTML = '<div class="skeleton skeleton-row"></div>';
    lineupsEl.innerHTML = '<div class="skeleton skeleton-row"></div>';
    load();
  });

  /* ---- başlat ---- */
  load();

  function cleanup() {
    S.destroyed = true;
    stopAuto();
    document.removeEventListener('visibilitychange', onVisibility);
    if (S.controller) S.controller.abort();
  }
  return cleanup;
}
