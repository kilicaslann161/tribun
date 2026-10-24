/**
 * Tribün — uygulama başlangıcı ve hash router
 *
 * Site iskeleti (modern uygulama düzeni):
 *  - Masaüstü: üst barda yatay ana menü (aktif bağlantı vurgulu, aria-current)
 *    + sağ üstte Hesabım açılır menüsü (hover ile açılır, tıkla aç/kapa)
 *  - Mobil: alt sekme çubuğu (Ana · Salon · Sıralama · Sözlük · Daha)
 *  - Sayfa değişiminde yumuşak geçiş animasyonu
 *
 * Rotalar:
 * #/                 → ana sayfa   #/kart    → Taraftar Kartı (giriş gerekli)
 * #/oyunlar          → Oyun Salonu (oyun kartları)
 * #/penalti #/kahin #/test        #/sozluk  → Taraftar Sözlüğü
 * #/bingo #/bingo/:KOD            #/anilar  → Anı Defteri
 * #/transfer                       #/siralama → Liderlik Tablosu
 *
 * Sayfalar opsiyonel olarak bir "cleanup" fonksiyonu döndürebilir
 * (zamanlayıcı/polling temizliği için); rota değişince otomatik çalıştırılır.
 */
import { getUser, setUser, loadMe, onChange } from './state.js';
import { isLoggedIn } from './api.js';
import { esc, toast, openLoginModal, openModal } from './ui.js';
import { icon } from './icons.js';

import { renderHome } from './pages/home.js';
import { renderGames } from './pages/games.js';
import { renderPenalty } from './pages/penalty.js';
import { renderOracle } from './pages/oracle.js';
import { renderForecast } from './pages/forecast.js';
import { renderQuiz } from './pages/quiz.js';
import { renderLeaderboard } from './pages/leaderboard.js';
import { renderCard } from './pages/card.js';
import { renderDictionary } from './pages/dictionary.js';
import { renderMemories } from './pages/memories.js';
import { renderBingo } from './pages/bingo.js';
import { renderTransfer } from './pages/transfer.js';
import { renderLeague } from './pages/league.js';
import { renderMatchDetail } from './pages/matchDetail.js';

const app = document.getElementById('app');

const ROUTES = {
  '': { render: renderHome, auth: false },
  oyunlar: { render: renderGames, auth: false },
  penalti: { render: renderPenalty, auth: true },
  kahin: { render: renderOracle, auth: true },
  'kahin-sensin': { render: renderForecast, auth: true },
  test: { render: renderQuiz, auth: true },
  siralama: { render: renderLeaderboard, auth: false },
  kart: { render: renderCard, auth: true },
  sozluk: { render: renderDictionary, auth: false },
  anilar: { render: renderMemories, auth: false },
  bingo: { render: renderBingo, auth: false },
  transfer: { render: renderTransfer, auth: false },
  lig: { render: renderLeague, auth: false },
  mac: { render: renderMatchDetail, auth: false }
};

// Hangi rota hangi menü öğesini vurgular (oyun sayfaları → Oyun Salonu)
const NAV_BY_ROUTE = {
  '': 'home',
  oyunlar: 'oyunlar',
  penalti: 'oyunlar', kahin: 'oyunlar', test: 'oyunlar',
  'kahin-sensin': 'oyunlar',
  bingo: 'oyunlar', transfer: 'oyunlar',
  siralama: 'siralama',
  sozluk: 'sozluk',
  anilar: 'anilar',
  kart: 'kart',
  lig: 'home' /* AŞAMA 7: üst menüde yeni öğe YOK — ana sayfa vurgusu */,
  mac: 'home' /* AŞAMA 8: maç detayı — üst menüde yeni öğe YOK */
};

let pendingRoute = null; // giriş sonrası dönülecek yol (parametreli de olabilir)
let pageCleanup = null;  // önceki sayfanın temizlik fonksiyonu

function parseHash() {
  return location.hash.replace(/^#\/?/, '').split('?')[0].trim();
}

/* ---------------- Navigasyon ---------------- */
function updateNav(base) {
  const active = NAV_BY_ROUTE[base] ?? 'home';
  document.querySelectorAll('[data-nav]').forEach((n) => {
    const on = n.dataset.nav === active;
    n.classList.toggle('active', on);
    // erişilebilirlik: ekran okuyucular için geçerli sayfa işareti
    if (on) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
}

/** Mobil "Daha" sayfası: az kullanılan bağlantılar */
function openMore() {
  openModal((root, close) => {
    root.innerHTML = `
      <h3>${icon('more', 22)} Daha</h3>
      <div class="more-list">
        <a href="#/kart"><span class="ix">01</span>${icon('card', 20)} Taraftar Kartım</a>
        <a href="#/anilar"><span class="ix">02</span>${icon('notebook', 20)} Anı Defteri</a>
        <a href="#/transfer"><span class="ix">03</span>${icon('coins', 20)} Hayali Transfer</a>
        <a href="#/bingo"><span class="ix">04</span>${icon('target', 20)} Maç Günü Bingo</a>
      </div>
      <div id="moreUser" class="mt"></div>`;
    root.querySelectorAll('.more-list a').forEach((a) => a.addEventListener('click', close));
    const box = root.querySelector('#moreUser');
    const u = getUser();
    if (u) {
      box.innerHTML = `<span class="pill yellow">${icon('star', 14)} ${Number(u.total_points).toLocaleString('tr-TR')} · ${esc(u.nickname)}</span>`;
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn block';
      b.innerHTML = `${icon('lock', 18)} Giriş Yap`;
      b.addEventListener('click', () => { close(); openLoginModal(); });
      box.appendChild(b);
    }
  });
}

function bindNavigation() {
  document.getElementById('bbMore').addEventListener('click', openMore);

  // alt çubuk: her sekme kendi yoluna gider (oyunlar → #/oyunlar)
  document.querySelectorAll('[data-bb]').forEach((btn) => {
    const go = btn.dataset.bb;
    btn.addEventListener('click', () => {
      if (go === 'home') location.hash = '#/';
      else location.hash = '#/' + go;
    });
  });
}

/** Sayfa geçiş animasyonunu yeniden başlat */
function pageTransition() {
  app.classList.remove('page-in');
  void app.offsetWidth; // animasyonu resetle
  app.classList.add('page-in');
}

/* ---------------- Üst bar + Hesabım menüsü ---------------- */

/** Hesabım açılır menüsünü aç/kapat (buton + aria durumunu birlikte yönetir) */
function setUserMenu(open) {
  const menu = document.getElementById('userMenu');
  const chip = document.getElementById('userChip');
  if (!menu || !chip) return;
  menu.classList.toggle('open', open);
  chip.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function updateTopbar(next, prev) {
  const user = next || getUser();
  const area = document.getElementById('userArea');
  if (!user) {
    area.innerHTML = `<button type="button" class="btn small" id="btnLogin">${icon('lock', 18)} Giriş Yap</button>`;
    area.querySelector('#btnLogin').addEventListener('click', () => openLoginModal());
    return;
  }
  // Kullanıcı çipi artık "Hesabım" açılır menüsünün tetikleyicisi:
  // hover ile açılır (masaüstü CSS'i), tıklayınca açılıp kapanır (dokunmatik).
  area.innerHTML = `
    <div class="user-menu" id="userMenu">
      <button type="button" class="user-chip" id="userChip" aria-haspopup="menu" aria-expanded="false" title="Hesabım">
        <span class="user-nick">${esc(user.nickname)}</span>
        <span class="pill yellow" id="pointsPill">${icon('star', 14)} ${Number(user.total_points).toLocaleString('tr-TR')}</span>
        ${icon('chevron-down', 16)}
      </button>
      <div class="user-drop" role="menu" aria-label="Hesabım">
        <span class="user-drop-head">${icon('user', 16)} Hesabım</span>
        <a role="menuitem" href="#/siralama">${icon('trophy', 18)} Liderlik Tablosu</a>
        <a role="menuitem" href="#/kart">${icon('card', 18)} Taraftar Kartım</a>
      </div>
    </div>`;

  const menu = area.querySelector('#userMenu');
  const chip = area.querySelector('#userChip');
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    setUserMenu(!menu.classList.contains('open'));
  });
  // menü linkine gidince menü kapansın
  menu.querySelectorAll('.user-drop a').forEach((a) => a.addEventListener('click', () => setUserMenu(false)));

  // Puan arttıysa saya kısa animasyonla seksin
  if (prev && Number(prev.total_points) < Number(user.total_points)) {
    const pill = area.querySelector('#pointsPill');
    if (pill) {
      pill.classList.add('bump');
      setTimeout(() => pill.classList.remove('bump'), 750);
    }
  }
}

/* ---------------- Yönlendirme ---------------- */
function route() {
  // Önceki sayfanın polling/zamanlayıcılarını temizle (bellek sızıntısı yok)
  if (typeof pageCleanup === 'function') {
    try { pageCleanup(); } catch { /* temizlik hatası yut */ }
    pageCleanup = null;
  }

  const parts = parseHash().split('/').filter(Boolean);
  const base = parts[0] ?? '';
  const params = parts.slice(1);
  const r = ROUTES[base] || ROUTES[''];

  updateNav(base);
  pageTransition();
  setUserMenu(false); // sayfa değişince Hesabım menüsü kapansın

  if (r.auth && !isLoggedIn()) {
    pendingRoute = parseHash();
    renderHome(app); // ana sayfayı göster, oyun kilidini modal ile belirt
    openLoginModal('Bu bölümü oynamak için önce giriş yapmalısın. ⚽');
    return;
  }
  pendingRoute = null;
  window.scrollTo(0, 0);
  const maybeCleanup = r.render(app, params);
  if (typeof maybeCleanup === 'function') pageCleanup = maybeCleanup;
}

/* ---------------- Olaylar ---------------- */
// Token süresi doldu / geçersiz → sessizce giriş penceresi
window.addEventListener('tribun:401', () => {
  setUser(null);
  toast('Oturumun süresi doldu, tekrar giriş yap.', true);
  openLoginModal('Oturumun süresi doldu. Tekrar giriş yap, kaldığın yerden devam et.');
});

// Giriş/kayıt başarılı → bekleyen yola (veya bulunduğun sayfaya) dön
window.addEventListener('tribun:authed', async () => {
  await loadMe();
  if (pendingRoute) {
    const h = '#/' + pendingRoute;
    pendingRoute = null;
    if (location.hash === h) route();
    else location.hash = h;
  } else {
    route();
  }
});

window.addEventListener('hashchange', route);

/* ---------------- Başlat ---------------- */
(async function init() {
  onChange(updateTopbar);
  bindNavigation();
  updateTopbar(null, null);
  await loadMe(); // kullanıcı varsa üst bar dolar (setUser → updateTopbar)
  route();

  // Hesabım menüsü: dışarı tıklama ve Esc ile kapanır (tek seferlik bağlanır)
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) setUserMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setUserMenu(false);
  });
})();
