/**
 * Tribün — Lig sayfası (#/lig/:slug) · AŞAMA 7
 *
 * Veri kaynakları (ikisi de Aşama 4 kurallarıyla: SQLite okur, bütçe HARCANMAZ):
 *   GET /api/sports/competitions/:slug/standings → gruplu puan durumu + meta
 *   GET /api/sports/competitions/:slug           → lig bilgisi + bugün + yaklaşan maçlar
 *
 * Yerleşim (talimat):
 *  - Lig başlığı (logo + ad + ülke) + puan durumu bölümü; altında lig maçları.
 *  - Grup yapısı varsa HER GRUP AYRI tablo (grup adı alt başlıkla).
 *  - Yanıtta olmayan sütun gösterilmez: kolon listesi API'nin columns alanından
 *    gelir; istemci yalnızca bilinen kolonlara Türkçe kısa etiket eşler.
 *  - Mobilde tablo KENDİ KUTUSUNDA yatay kayar (sayfa gövdesi değil) ve ilk
 *    iki sütun (sıra + takım) sabit kalır (position:sticky).
 *
 * Durumlar: yükleme iskeleti / veri yok / hata + Tekrar dene / bayat veri
 * uyarısı / "Son güncelleme" — hepsi bölüm bazında; sayfa altında
 * "Powered by SportScore" bağlantısı (JS'e bağlı olmayan footer'da da var).
 *
 * Erişilebilirlik: th scope=col + aria-label; kolon anlamı yalnız renk/boyut
 * değil METİNLE taşınır; tüm dinamik metin textContent ile basılır (XSS kapalı).
 * Otomatik yenileme YOK (talimat istemedi; canlı akış ana sayfa panosundadır).
 */
import { esc } from '../ui.js';
import { icon } from '../icons.js';
import { rowNode, logoNode, fmtClock, trDayStr } from '../matchesBoard.js';

const TZ = 'Europe/Istanbul';

/* Kolon anahtarı → kısa etiket + açıklama (tam ad th aria-label/title'da) */
const COLUMN_LABELS = [
  ['played', 'O', 'Oynadığı maç'],
  ['won', 'G', 'Galibiyet'],
  ['drawn', 'B', 'Beraberlik'],
  ['lost', 'M', 'Mağlubiyet'],
  ['goals_for', 'A', 'Attığı gol'],
  ['goals_against', 'Y', 'Yediği gol'],
  ['goal_diff', 'AV', 'Gol averajı'],
  ['points', 'P', 'Puan'],
  ['win_pct', 'KAZ', 'Kazanma oranı']
];

/** warn üçgeni (matchesBoard ile aynı inline SVG — emoji yok) */
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

/** Maç senkron zamanlarının en yenisi (matchesBoard.lastSyncIso ile aynı kural) */
function lastMatchSyncIso(meta) {
  if (!meta) return null;
  const c = [meta.last_fixture_sync_at, meta.last_live_sync_at].filter(Boolean);
  return c.length ? c.sort().pop() : null;
}

/** TR takvim günü etiketi: bugün/yarın ya da "26 Ekim Pazartesi" */
function dayLabel(dateStr) {
  const today = trDayStr(0);
  const tomorrow = trDayStr(1);
  if (dateStr === today) return 'BUGÜN · ' + shortDate(dateStr);
  if (dateStr === tomorrow) return 'YARIN · ' + shortDate(dateStr);
  return shortDate(dateStr, true);
}

function shortDate(dateStr, weekday = false) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('tr-TR', weekday
    ? { day: 'numeric', month: 'long', weekday: 'long' }
    : { day: 'numeric', month: 'long' }
  ).toLocaleUpperCase('tr-TR');
}

/* ---------------- puan durumu tablosu ---------------- */

function standingsTable(group, columns, legend) {
  const wrap = el('div', 'lg-table-wrap');
  const table = el('table', 'lg-table');
  table.setAttribute('role', 'table');

  /* başlık satırı: sıra + takım + yanıttaki kolonlar */
  const thead = el('thead');
  const htr = el('tr');
  const thPos = el('th', 'lg-th-pos', '#');
  thPos.setAttribute('scope', 'col');
  thPos.setAttribute('aria-label', 'Sıra');
  const thTeam = el('th', 'lg-th-team', 'TAKIM');
  thTeam.setAttribute('scope', 'col');
  htr.append(thPos, thTeam);
  for (const key of columns) {
    const meta = COLUMN_LABELS.find((c) => c[0] === key) || [key, key.toUpperCase(), key];
    const th = el('th', 'lg-th-num' + (key === 'points' ? ' lg-th-pts' : ''), meta[1]);
    th.setAttribute('scope', 'col');
    th.setAttribute('aria-label', meta[2]);
    th.title = meta[2];
    htr.append(th);
  }
  thead.append(htr);
  table.append(thead);

  const tbody = el('tbody');
  for (const r of group.rows) {
    const tr = el('tr', 'lg-tr');

    /* sıra hücresi: yükselme/düşme göstergesi (renk VERİDEN — icat edilmez) */
    const posTd = el('td', 'lg-td-pos');
    if (r.promo_color) {
      const dot = el('span', 'lg-promo');
      dot.style.background = r.promo_color;
      if (r.promo_name) dot.title = r.promo_name;
      posTd.append(dot);
      const key = r.promo_name + '|' + r.promo_color;
      if (!legend.has(key)) {
        legend.set(key, { color: r.promo_color, name: r.promo_name });
      }
    }
    posTd.append(document.createTextNode(String(r.position)));
    tr.append(posTd);

    /* takım hücresi: logo (hata olursa baş harf) + ad */
    const teamTd = el('td', 'lg-td-team');
    const teamBox = el('span', 'lg-team');
    teamBox.append(logoNode(r.team_logo, r.team_name));
    teamBox.append(el('b', '', r.team_name));
    teamTd.append(teamBox);
    tr.append(teamTd);

    /* sayı kolonları: null → '-' (asla 0 yazılmaz); points vurgulu */
    for (const key of columns) {
      const v = r[key];
      const td = el('td', 'lg-td-num' + (key === 'points' ? ' lg-td-pts' : ''),
        (v === null || v === undefined) ? '-' : String(v));
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

/* ---------------- bölüm çizicileri ---------------- */

export function renderLeague(root, params) {
  const slug = String((params && params[0]) || '').toLowerCase().trim();

  const S = {
    std: null,        // standings yanıtı
    stdError: false,
    comp: null,       // lig detay yanıtı
    compError: false,
    notFound: false,
    destroyed: false
  };

  /* ---- statik iskelet ---- */
  root.innerHTML = `
    <div id="lgHead" class="lg-head skeleton skeleton-head"></div>
    <div class="sp-note" id="lgStale" hidden>${WARN_SVG} Veriler gecikmeli olabilir</div>
    <section class="card lg-card" aria-labelledby="lgStdTitle">
      <div class="lg-sec-head">
        <h2 class="section-title" id="lgStdTitle">${icon('trophy', 22)} PUAN DURUMU</h2>
        <span class="sp-updated" id="lgStdUpdated"></span>
      </div>
      <div id="lgStdBody">
        <div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>
        <div class="skeleton skeleton-row"></div>
      </div>
      <div class="sp-error" id="lgStdError" hidden>
        ${WARN_SVG}
        <p>Puan durumu şu an yüklenemedi.</p>
        <button type="button" class="btn small ghost" id="lgStdRetry">${icon('refresh', 16)} Tekrar dene</button>
      </div>
    </section>
    <section class="card lg-card" aria-labelledby="lgMatchesTitle">
      <div class="lg-sec-head">
        <h2 class="section-title" id="lgMatchesTitle">${icon('ball', 22)} LİG MAÇLARI</h2>
        <span class="sp-updated" id="lgMatchesUpdated"></span>
      </div>
      <div id="lgMatchesBody">
        <div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>
      </div>
      <div class="sp-error" id="lgMatchesError" hidden>
        ${WARN_SVG}
        <p>Maçlar şu an yüklenemedi.</p>
        <button type="button" class="btn small ghost" id="lgMatchesRetry">${icon('refresh', 16)} Tekrar dene</button>
      </div>
    </section>
    <a class="sp-attribution" href="https://sportscore.com/" rel="dofollow noopener" title="Sports data by SportScore" target="_blank">Powered by SportScore</a>`;

  const $ = (sel) => root.querySelector(sel);
  const headEl = $('#lgHead');
  const staleEl = $('#lgStale');
  const stdBody = $('#lgStdBody');
  const stdErrEl = $('#lgStdError');
  const matchesBody = $('#lgMatchesBody');
  const matchesErrEl = $('#lgMatchesError');

  /* ---- geçersiz slug: istek bile atmadan dost 404 sayfası ---- */
  if (!/^[a-z0-9][a-z0-9-]{0,98}$/.test(slug)) {
    drawNotFound('Lig adresi geçersiz görünüyor.');
    return cleanup;
  }

  function drawNotFound(msg) {
    root.innerHTML = `
      <section class="card" style="text-align:center">
        <span class="ico-box" style="width:64px;height:64px;margin:12px auto" aria-hidden="true">${icon('trophy', 34)}</span>
        <h1 style="margin-top:4px">Böyle bir lig yok</h1>
        <p class="muted">${esc(msg || 'Aradığın lig Tribün listesinde değil.')}</p>
        <p class="muted small">Ana sayfadaki "Günün Maçları" bölümünden liglere gidebilirsin.</p>
        <a class="btn" href="#/">${icon('arrow-left', 18)} Ana Sayfaya Dön</a>
      </section>`;
  }

  /* ---- lig başlığı ---- */
  function drawHead(comp) {
    headEl.classList.remove('skeleton', 'skeleton-head');
    headEl.innerHTML = '';
    const logo = comp.logo_url
      ? el('img', 'lg-logo')
      : null;
    if (logo) {
      logo.src = comp.logo_url;
      logo.alt = '';
      logo.width = 40;
      logo.height = 40;
      logo.loading = 'lazy';
      logo.referrerPolicy = 'no-referrer';
      logo.addEventListener('error', () => logo.remove(), { once: true });
      headEl.append(logo);
    }
    const titleBox = el('div', 'lg-title-box');
    titleBox.append(el('h1', 'lg-title', comp.name || 'Lig'));
    if (comp.country) titleBox.append(el('span', 'lg-country', comp.country));
    headEl.append(titleBox);
  }

  /* ---- bayatlık şeridi (iki bölümden herhangi biri bayatsa) ---- */
  function refreshStale() {
    const stdStale = !!(S.std && S.std.meta && S.std.meta.stale);
    const matchStale = !!(S.comp && S.comp.meta && S.comp.meta.stale);
    staleEl.hidden = !(stdStale || matchStale);
  }

  /* ---- puan durumu ---- */
  function drawStandings() {
    $('#lgStdUpdated').textContent = '';
    if (S.std && S.std.meta && S.std.meta.updated_at) {
      $('#lgStdUpdated').textContent = 'Son güncelleme: ' + fmtClock(S.std.meta.updated_at);
    }

    if (S.stdError) {
      stdBody.innerHTML = '';
      stdErrEl.hidden = false;
      refreshStale();
      return;
    }
    stdErrEl.hidden = true;

    const groups = (S.std && S.std.groups) || [];
    const columns = (S.std && S.std.columns) || [];

    if (!groups.length) {
      stdBody.innerHTML = '';
      const empty = el('div', 'sp-empty', 'Bu ligin puan durumu henüz hazırlanmadı');
      empty.insertAdjacentHTML('afterbegin', icon('trophy', 30));
      const note = el('p', 'muted small lg-empty-note',
        'Puan durumları futbol ligleri için otomatik hazırlanır; veri ilk senkronla burada görünür.');
      empty.append(note);
      stdBody.append(empty);
      refreshStale();
      return;
    }

    stdBody.innerHTML = '';
    const legend = new Map();
    for (const g of groups) {
      if (g.group) {
        stdBody.append(el('h3', 'lg-group-title', 'Grup ' + g.group));
      }
      stdBody.append(standingsTable(g, columns, legend));
    }
    /* yükselme/düşme açıklama satırı (renkler yanıttan gelir; icat edilmez) */
    if (legend.size) {
      const legendRow = el('div', 'lg-legend');
      for (const { color, name } of legend.values()) {
        const chip = el('span', 'lg-legend-chip');
        const dot = el('i', 'lg-promo');
        dot.style.background = color;
        chip.append(dot, el('span', '', name || '—'));
        legendRow.append(chip);
      }
      stdBody.append(legendRow);
    }
    refreshStale();
  }

  /* ---- lig maçları ---- */
  function drawMatches() {
    $('#lgMatchesUpdated').textContent = '';
    if (S.comp && S.comp.meta) {
      const iso = lastMatchSyncIso(S.comp.meta);
      if (iso) $('#lgMatchesUpdated').textContent = 'Son güncelleme: ' + fmtClock(iso);
    }

    if (S.compError) {
      matchesBody.innerHTML = '';
      matchesErrEl.hidden = false;
      refreshStale();
      return;
    }
    matchesErrEl.hidden = true;

    const comp = (S.comp && S.comp.competition) || null;
    const matches = (S.comp && S.comp.matches) || { today: [], upcoming: [] };
    const today = matches.today || [];
    const upcoming = matches.upcoming || [];

    if (!today.length && !upcoming.length) {
      matchesBody.innerHTML = '';
      const empty = el('div', 'sp-empty', 'Bu ligin yaklaşan maçı bulunamadı');
      empty.insertAdjacentHTML('afterbegin', icon('ball', 30));
      matchesBody.append(empty);
      refreshStale();
      return;
    }

    matchesBody.innerHTML = '';

    /* bugün */
    if (today.length) {
      const g = el('div', 'lg-date-group');
      g.append(el('h3', 'lg-date-title', dayLabel(trDayStr(0))));
      const box = el('div', 'lg-match-list');
      today.forEach((m) => box.append(rowNode(m)));
      g.append(box);
      matchesBody.append(g);
    }
    /* yaklaşan günler (API zaten TR günü bazında gruplar) */
    for (const day of upcoming) {
      const g = el('div', 'lg-date-group');
      g.append(el('h3', 'lg-date-title', dayLabel(day.date)));
      const box = el('div', 'lg-match-list');
      day.matches.forEach((m) => box.append(rowNode(m)));
      g.append(box);
      matchesBody.append(g);
    }
    void comp; /* lig adı başlıkta zaten var — satırlar kendi durumunu taşır */
    refreshStale();
  }

  /* ---- veri çekme ---- */
  async function loadStandings() {
    try {
      const res = await fetch(`/api/sports/competitions/${encodeURIComponent(slug)}/standings`);
      if (S.destroyed) return;
      if (res.status === 404) { S.notFound = true; return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      S.std = await res.json();
      S.stdError = false;
    } catch {
      if (!S.destroyed) S.stdError = true;
    }
    if (!S.destroyed) drawStandings();
  }
  async function loadCompetition() {
    try {
      const res = await fetch(`/api/sports/competitions/${encodeURIComponent(slug)}`);
      if (S.destroyed) return;
      if (res.status === 404) { S.notFound = true; return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      S.comp = await res.json();
      S.compError = false;
      drawHead(S.comp.competition);
    } catch {
      if (!S.destroyed) S.compError = true;
    }
    if (!S.destroyed && !S.notFound) drawMatches();
  }

  /* 404 → iki istek de sonuçlandığında ve lig yoksa: tüm sayfa 'lig yok'
   * görünümüne döner (tek seferlik çizim). */
  Promise.allSettled([loadStandings(), loadCompetition()]).then(() => {
    if (!S.destroyed && S.notFound) {
      drawNotFound('Aradığın lig Tribün listesinde değil ya da şu an kapalı.');
    }
  });

  $('#lgStdRetry').addEventListener('click', () => {
    S.stdError = false;
    stdErrEl.hidden = true;
    stdBody.innerHTML = '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>';
    loadStandings();
  });
  $('#lgMatchesRetry').addEventListener('click', () => {
    S.compError = false;
    matchesErrEl.hidden = true;
    matchesBody.innerHTML = '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>';
    loadCompetition();
  });

  function cleanup() {
    S.destroyed = true;
  }
  return cleanup;
}
