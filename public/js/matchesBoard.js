/**
 * Tribün — "GÜNÜN MAÇLARI" ana sayfa bölümü (AŞAMA 6)
 *
 * Veri kaynağı: GET /api/sports/matches?date=YYYY-MM-DD&sport=football|basketball
 * (Aşama 4/5 okuma ucu — SQLite'tan okur, SportScore bütçesi HARCANMAZ;
 *  tarayıcı asla doğrudan sağlayıcıya gitmez.)
 *
 * Davranış:
 *  - Dün / Bugün / Yarın sekmeleri (varsayılan Bugün; tarih hesabı
 *    Europe/Istanbul takvim gününe göre Intl ile yapılır)
 *  - Futbol / Basketbol seçimi; seçim değişince API yeniden çağrılır
 *  - "Canlı (n)" filtre çipi: yalnız canlı maçları gösterir (n = meta.live_count)
 *  - Lig grupları API'nin verdiği sıradadır (Süper Lig üstte); grup başlığı
 *    AŞAMA 7'den beri #/lig/:slug LİNKİDİR (daraltma AYRI butonda: gerçek
 *    <button> + aria-expanded; durumu otomatik yenilemede korunur).
 *  - Durum etiketleri: Başlamadı / CANLI + periyot / Bitti / Ertelendi /
 *    İptal / Durduruldu / Yarıda Kaldı. Skor null ise "-", sayıysa sayı
 *    (0-0 asla "-"ye karışmaz). Dakika listede gösterilmez.
 *  - Yüklemede iskelet; veri yoksa "Bu gün için maç bulunamadı";
 *    API hatasında "Maçlar şu an yüklenemedi" + "Tekrar dene"
 *    (arka plan yenilemesi başarısızsa eski veri korunur, şerit + tekrar dene)
 *  - meta.stale=true → "Veriler gecikmeli olabilir" uyarı şeridi
 *  - "Son güncelleme: HH:mm" (TR saati) her zaman görünür
 *  - Otomatik yenileme: 30 sn'lik hızlı tur YALNIZCA Bugün seçiliyken VE canlı
 *    maç varken kurulur; canlı yokken Bugün'de 120 sn'lik yavaş keşif yoklaması
 *    (sayfa açıkken başlayan maçı fark eder), Dün/Yarın'da hiç yoklama yoktur.
 *    Sekme gizliyken durur, görününce sürer;
 *    sayfa değişince döndürülen cleanup her şeyi temizler.
 *
 * Erişilebilirlik: tüm kontroller gerçek <button>; odak halkası global
 * :focus-visible'dan gelir; durum yalnızca renkle değil metinle verilir;
 * TÜM dinamik metinler textContent ile basılır (XSS'e kapalı);
 * ekran okuyucular için görsel olarak gizli aria-live duyuru bölgesi var.
 */
import { icon } from './icons.js';

/* ---------------- sabitler ---------------- */

const TZ = 'Europe/Istanbul';
const REFRESH_MS = 30000;          // canlı yenileme aralığı (yalnız Bugün + canlı varken)
const DISCOVER_MS = 120000;        // keşif yoklaması: Bugün + canlı YOKKEN (başlangıç fark etme)
const LIVE_STATUSES = ['live', 'halftime'];

/* periyot → Türkçe etiket (talimat eşlemesi) — AŞAMA 8: maç detayı sayfası
 * da kullanır → EXPORT */
export const PERIOD_TR = {
  H1: '1. Yarı', H2: '2. Yarı', HT: 'Devre Arası',
  ET: 'Uzatma', PEN: 'Penaltılar',
  Q1: '1. Periyot', Q2: '2. Periyot', Q3: '3. Periyot', Q4: '4. Periyot',
  OT: 'Uzatma'
};

/* durum → Türkçe etiket (canlı/halftime ayrı ele alınır) — AŞAMA 8: EXPORT */
export const STATUS_TR = {
  scheduled: 'Başlamadı',
  finished: 'Bitti',
  postponed: 'Ertelendi',
  cancelled: 'İptal',
  suspended: 'Durduruldu',
  abandoned: 'Yarıda Kaldı'
};

/* uyarı üçgeni (inline SVG — emoji yok) */
const WARN_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/></svg>';

/* ---------------- yardımcılar (AŞAMA 7: lig sayfası da kullanır → EXPORT) ---------------- */

/** Europe/Istanbul bugünü (± gün) YYYY-MM-DD olarak döndür */
export function trDayStr(offsetDays = 0) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  if (!offsetDays) return today;
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + offsetDays * 86400000)
    .toISOString().slice(0, 10);
}

/** UTC ISO → Europe/Istanbul "HH:mm" */
export function fmtClock(iso) {
  if (!iso) return '--:--';
  try {
    return new Date(iso).toLocaleTimeString('tr-TR', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit'
    });
  } catch { return '--:--'; }
}

/** Takım adının baş harfleri ("Gaziantep FK" → "GF", "Eyupspor" → "E") */
function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
}

/** Canlı periyot metni; boş/bilinmeyen → nötr davranış */
function periodText(m) {
  const key = String(m.period || '').trim().toUpperCase();
  if (PERIOD_TR[key]) return PERIOD_TR[key];
  if (key) return m.status_text || key;                 // tanınmayan periyot → status_text
  if (m.status === 'halftime') return 'Devre Arası';
  return null;                                          // canlı + periyot boş → yalnız CANLI rozeti
}

/** Skor metni: null → "-", sayıysa "h : a" */
function scoreText(m) {
  const h = m.home && m.home.score;
  const a = m.away && m.away.score;
  if (typeof h !== 'number' || typeof a !== 'number') return '-';
  return h + ' : ' + a;
}

const isLive = (m) => LIVE_STATUSES.includes(m.status);

/* ---------------- DOM üreticileri (dinamik metin = textContent) ---------------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** 28px takım logosu; yoksa/hata olursa baş harf yer tutucusu.
 *  Logo hatası sayfayı bozamaz: onerror → yer tutucuyla değiştir. */
export function logoNode(src, name) {
  if (!src) return initialsNode(name);
  const img = document.createElement('img');
  img.className = 'sp-logo';
  img.src = src;
  img.alt = '';
  img.width = 28;
  img.height = 28;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    img.replaceWith(initialsNode(name));
  }, { once: true });
  return img;
}

function initialsNode(name) {
  const s = el('span', 'sp-logo sp-logo-fb', initials(name));
  s.setAttribute('aria-hidden', 'true');
  return s;
}

/** Takım hücresi. side: 'home' → [logo, ad] · 'away' → [ad, logo] (aynalı) */
function teamNode(t, side) {
  const wrap = el('span', 'sp-team');
  const name = el('b', '', (t && t.display_name) || '?');
  const logo = logoNode(t && t.logo_url, (t && t.display_name) || '?');
  if (side === 'away') { wrap.append(name, logo); wrap.classList.add('sp-away'); }
  else { wrap.append(logo, name); }
  return wrap;
}

/** Durum etiketi (skorun altında): metin her zaman taşınır */
function statusNode(m) {
  const st = el('span', 'sp-status');
  if (isLive(m)) {
    const badge = el('span', 'sp-live-badge');
    const dot = el('i', 'sp-dot');
    dot.setAttribute('aria-hidden', 'true');
    badge.append(dot, el('span', '', 'CANLI'));
    st.append(badge);
    const p = periodText(m);
    if (p) st.append(el('span', 'sp-period', p));
    return st;
  }
  st.append(el('span', '', STATUS_TR[m.status] || m.status_text || 'Bilinmiyor'));
  return st;
}

/** Tek maç satırı. AŞAMA 8: has_detail true olan FUTBOL maçları gerçek
 *  <a href="#/mac/:id"> ile sarılır (bitmiş + canlı futbol; basketbol
 *  satırları LINKLENMEZ — talimat). Lig sayfası da aynı satırı kullanır. */
export function rowNode(m) {
  const linkable = !!m.has_detail;
  const row = linkable ? el('a', 'sp-row st-' + (m.status || 'unknown'))
    : el('div', 'sp-row st-' + (m.status || 'unknown'));
  if (linkable) {
    row.href = '#/mac/' + encodeURIComponent(String(m.id));
  }
  const mid = el('span', 'sp-mid');
  mid.append(el('span', 'sp-score', scoreText(m)), statusNode(m));
  row.append(
    el('span', 'sp-time', fmtClock(m.kickoff_utc)),
    teamNode(m.home, 'home'),
    mid,
    teamNode(m.away, 'away')
  );
  return row;
}

/** Lig grubu: AŞAMA 7'den beri başlık LİG SAYFASINA LİNK (#/lig/:slug);
 *  daraltma AYRI butonda (button içine a konulmaz — iki gerçek kontrol:
 *  erişilebilirlik + bağımsız odak). Daraltma durumu yenilemede korunur. */
function groupNode(g, collapsedSet) {
  const comp = g.competition || {};
  const bodyId = 'spg-' + (comp.id ?? Math.random().toString(36).slice(2));

  /* başlık satırı: link (logo + ad + ülke) + maç sayısı + daraltma butonu */
  const head = el('div', 'sp-group-head');

  const link = el('a', 'sp-group-link');
  link.href = '#/lig/' + encodeURIComponent(comp.slug || '');
  if (comp.logo_url) {
    const img = document.createElement('img');
    img.className = 'sp-group-logo';
    img.src = comp.logo_url;
    img.alt = '';
    img.width = 20;
    img.height = 20;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true }); // logo hatası sayfayı bozmaz
    link.append(img);
  }
  link.append(el('span', 'sp-group-name', comp.name || 'Lig'));
  if (comp.country) link.append(el('span', 'sp-group-country', comp.country));

  const toggle = el('button', 'sp-group-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', bodyId);
  toggle.setAttribute('aria-label', (comp.name || 'Lig') + ' maçlarını daralt');
  toggle.insertAdjacentHTML('beforeend', icon('chevron-down', 16));

  head.append(link, el('span', 'sp-group-count', (g.matches || []).length + ' maç'), toggle);

  const body = el('div', 'sp-group-body');
  body.id = bodyId;
  (g.matches || []).forEach((m) => body.append(rowNode(m)));

  if (collapsedSet.has(comp.slug)) {
    toggle.setAttribute('aria-expanded', 'false');
    body.hidden = true;
  }

  toggle.addEventListener('click', () => {
    const collapse = !body.hidden;
    body.hidden = collapse;
    toggle.setAttribute('aria-expanded', collapse ? 'false' : 'true');
    toggle.setAttribute('aria-label',
      (comp.name || 'Lig') + (collapse ? ' maçlarını genişlet' : ' maçlarını daralt'));
    if (collapse) collapsedSet.add(comp.slug);
    else collapsedSet.delete(comp.slug);
  });

  const wrap = el('div', 'sp-group');
  wrap.append(head, body);
  return wrap;
}

/** En son veriye dokunan senkron zamanı (ISO) */
function lastSyncIso(meta) {
  if (!meta) return null;
  const c = [meta.last_fixture_sync_at, meta.last_live_sync_at].filter(Boolean);
  return c.length ? c.sort().pop() : null;
}

/* ---------------- bölüm ---------------- */

/**
 * Maç bölümünü verilen <section> kabuğuna kurar.
 * @param {HTMLElement} section home.js'in sağladığı boş section kabuğu
 * @returns {Function} cleanup — zamanlayıcı/dinleyici/istek temizliği
 */
export function renderMatchesBoard(section) {
  if (!section) return () => {};

  /* bölüm başına durum (her mount taze kapanır) */
  const S = {
    day: 0,                 // -1 dün · 0 bugün · 1 yarın
    sport: 'football',
    liveOnly: false,
    data: null,             // son başarılı API yanıtı
    failed: false,          // son yükleme/yenileme hatası
    collapsed: new Set(),   // daraltılmış lig slug'ları (yenilemede korunur)
    timer: null,
    controller: null,
    destroyed: false
  };

  /* ---------- statik iskelet ---------- */
  section.innerHTML = `
    <div class="sp-head">
      <h2 class="section-title" id="gununMaclariTitle">${icon('ball', 24)} GÜNÜN MAÇLARI</h2>
      <span class="sp-updated" id="spUpdated">Son güncelleme: --:--</span>
    </div>
    <div class="sp-controls">
      <div class="sp-seg sp-seg-days" role="group" aria-label="Gün seçimi">
        <button type="button" class="sp-seg-btn" data-day="-1">Dün</button>
        <button type="button" class="sp-seg-btn is-active" data-day="0" aria-pressed="true">Bugün</button>
        <button type="button" class="sp-seg-btn" data-day="1">Yarın</button>
      </div>
      <div class="sp-seg" role="group" aria-label="Branş seçimi">
        <button type="button" class="sp-seg-btn is-active" data-sport="football" aria-pressed="true">${icon('ball', 16)} Futbol</button>
        <button type="button" class="sp-seg-btn" data-sport="basketball" aria-pressed="false">${icon('basketball', 16)} Basketbol</button>
      </div>
      <button type="button" class="sp-live-chip" id="spLiveChip" aria-pressed="false" disabled>
        <i class="sp-dot" aria-hidden="true"></i><span id="spLiveCount">Canlı (0)</span>
      </button>
    </div>
    <div class="sp-note" id="spStale" hidden>${WARN_SVG} Veriler gecikmeli olabilir</div>
    <div class="sp-error" id="spError" hidden>
      ${WARN_SVG}
      <p>Maçlar şu an yüklenemedi.</p>
      <button type="button" class="btn small ghost" id="spRetry">${icon('refresh', 16)} Tekrar dene</button>
    </div>
    <div class="sp-body" id="spBody"></div>
    <p class="sp-sr" id="spSr" aria-live="polite"></p>
    <a class="sp-attribution" href="https://sportscore.com/" rel="dofollow noopener" title="Sports data by SportScore" target="_blank">Powered by SportScore</a>`;

  const $ = (sel) => section.querySelector(sel);
  const body = $('#spBody');
  const updatedEl = $('#spUpdated');
  const staleEl = $('#spStale');
  const errorEl = $('#spError');
  const liveChip = $('#spLiveChip');
  const liveCountEl = $('#spLiveCount');
  const srEl = $('#spSr');

  const skeleton = () => {
    body.innerHTML = Array.from({ length: 6 }, () =>
      '<div class="skeleton skeleton-row"></div>').join('');
  };

  /* ---------- veri çekme ---------- */
  async function load({ silent = false } = {}) {
    if (S.destroyed) return;
    if (S.controller) S.controller.abort();
    const ctrl = new AbortController();
    S.controller = ctrl;

    if (!silent) {
      S.failed = false;
      paintError(false);
      skeleton();
    }
    try {
      const url = `/api/sports/matches?date=${trDayStr(S.day)}&sport=${S.sport}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      if (S.destroyed || ctrl.signal.aborted) return;
      S.data = d;
      S.failed = false;
      draw();
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // daha yeni bir istek devraldı
      if (S.destroyed) return;
      /* Kullanıcının yeni seçimi başarısızsa eski seçimin verisi gösterilmez
       * (yalnız hata bloğu); sessiz yenileme hatasında eski veri KORUNUR. */
      if (!silent) S.data = null;
      S.failed = true;
      draw();
    } finally {
      if (S.controller === ctrl) S.controller = null;
    }
  }

  /* ---------- çizim ---------- */
  function draw() {
    const d = S.data;
    const meta = d && d.meta;

    /* son güncelleme: her zaman görünür */
    const syncIso = lastSyncIso(meta);
    updatedEl.textContent = 'Son güncelleme: ' + (syncIso ? fmtClock(syncIso) : '--:--');

    /* stale şeridi */
    staleEl.hidden = !(meta && meta.stale);

    /* hata: veri VARSA içerik korunur (yalnız şerit), yoksa blok gösterilir */
    paintError(S.failed);

    /* canlı çipi: n = bu yanıtın canlı sayısı */
    const liveCount = meta ? Number(meta.live_count) || 0 : 0;
    liveCountEl.textContent = 'Canlı (' + liveCount + ')';
    if (liveCount === 0) {
      S.liveOnly = false;                       // canlı maç kalmadıysa filtre kapanır
      liveChip.disabled = true;
    } else {
      liveChip.disabled = false;
    }
    liveChip.classList.toggle('is-active', S.liveOnly);
    liveChip.setAttribute('aria-pressed', S.liveOnly ? 'true' : 'false');

    /* gruplar (canlı filtresi istemci tarafında uygulanır) */
    let groups = (d && d.groups) || [];
    if (S.liveOnly) {
      groups = groups
        .map((g) => ({ ...g, matches: (g.matches || []).filter(isLive) }))
        .filter((g) => g.matches.length);
    }

    if (!groups.length && !S.failed) {
      body.innerHTML = '';
      const empty = el('div', 'sp-empty', 'Bu gün için maç bulunamadı');
      empty.insertAdjacentHTML('afterbegin', icon('ball', 30));
      body.append(empty);
    } else if (groups.length) {
      body.innerHTML = '';
      groups.forEach((g) => body.append(groupNode(g, S.collapsed)));
    }

    /* ekran okuyucu özeti (görsel gizli, aria-live) */
    const total = groups.reduce((n, g) => n + g.matches.length, 0);
    const liveShown = groups.reduce((n, g) => n + g.matches.filter(isLive).length, 0);
    srEl.textContent = total
      ? total + ' maç gösteriliyor' + (liveShown ? (', ' + liveShown + ' canlı') : '')
      : 'Maç bulunamadı';

    scheduleAutoRefresh();
  }

  function paintError(show) {
    errorEl.hidden = !show;
    /* veri yokken hata bloğu içeriği tamamen değiştirir; veri varken
       yalnız şerit olarak body'nin üstünde durur (eski veri korunur) */
    if (show && !S.data) body.innerHTML = '';
  }

  /* ---------- otomatik yenileme ----------
   * 30 sn'lik hızlı yenileme YALNIZ Bugün + canlı maç varken kurulur (talimat).
   * Bugün + canlı YOKKEN 120 sn'lik yavaş "keşif" yoklaması çalışır: sayfa
   * açıkken başlayan maçı fark edip hızlı moda geçer. Dün/Yarın'da hiçbir
   * yoklama yoktur; sekme gizliyken her ikisi de durur. */
  const wantAuto = () => S.day === 0
    && S.data && S.data.meta
    && !S.destroyed;

  function stopAuto() {
    if (S.timer) { clearInterval(S.timer); S.timer = null; }
  }

  function scheduleAutoRefresh() {
    stopAuto();
    if (!wantAuto() || document.hidden) return;
    const live = Number(S.data.meta.live_count) || 0;
    const ms = live > 0 ? REFRESH_MS : DISCOVER_MS;
    S.timer = setInterval(() => load({ silent: true }), ms);
  }

  const onVisibility = () => {
    if (S.destroyed) return;
    if (document.hidden) {
      stopAuto();                                   // sekme gizliyken istek yok
    } else if (wantAuto()) {
      load({ silent: true });                       // dönünce anında tazele
      scheduleAutoRefresh();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  /* ---------- kontroller ---------- */
  function segState() {
    section.querySelectorAll('[data-day]').forEach((b) => {
      const on = Number(b.dataset.day) === S.day;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    section.querySelectorAll('[data-sport]').forEach((b) => {
      const on = b.dataset.sport === S.sport;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  section.querySelectorAll('[data-day]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.day);
      if (v === S.day) return;
      S.day = v;
      segState();
      load();
    });
  });

  section.querySelectorAll('[data-sport]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset.sport;
      if (v === S.sport) return;
      S.sport = v;
      segState();
      load();
    });
  });

  liveChip.addEventListener('click', () => {
    if (liveChip.disabled) return;
    S.liveOnly = !S.liveOnly;
    draw();                                          // filtre istemci tarafı: API çağrısı gerekmez
  });

  $('#spRetry').addEventListener('click', () => load());

  /* ---------- başlat ---------- */
  load();

  /* ---------- cleanup: sayfa değişince her şeyi temizle ---------- */
  return function cleanup() {
    S.destroyed = true;
    stopAuto();
    document.removeEventListener('visibilitychange', onVisibility);
    if (S.controller) S.controller.abort();
  };
}
