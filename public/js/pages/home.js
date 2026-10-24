/**
 * Tribün — Ana Sayfa · cila sürümü + Maç Panosu
 * Bugünün Oyunu (kicker + sticker + OYUNA ÖZEL ikon + yıldız fallback),
 * "GÜNÜN MAÇLARI" panosu (AŞAMA 6 — /api/sports/matches okuma ucundan,
 * SportScore verisi SQLite'tan; eski /api/matches widget panosunun yerini aldı)
 * ve kayan marquee bandı.
 * Oyun kartları Oyun Salonu sayfasındadır (#/oyunlar → pages/games.js);
 * Liderlik/Kart kısayolları Hesabım menüsündedir (app.js → updateTopbar).
 * [data-reveal] ögeleri kademeli olarak görünür olur (reduced-motion'da anında).
 *
 * renderHome, maç bölümünün cleanup fonksiyonunu döndürür (app.js router'ı
 * sayfa değişince çalıştırır → 30 sn'lik canlı yenileme zinciri kesilir).
 */
import { esc } from '../ui.js';
import { icon, hasIcon } from '../icons.js';
import { renderMatchesBoard } from '../matchesBoard.js';

// Bugünün Oyunu adayları: 7 oyunun tamamı (tarihe göre günde bir değişir)
// acc: aksan rengi (CSS data-acc eşlemesi), ico: icons.js anahtarı
const FEATURED = [
  { hash: 'penalti', ico: 'goal', acc: 'penalty', name: 'Penaltı Atışları', desc: '6 bölge, 5 atış, bir tane de senin kalen. Kaleci sunucuda oturuyor, şansına güven.' },
  { hash: 'kahin', ico: 'crystal', acc: 'oracle', name: 'Kâhin', desc: 'İki takım ver, kristal küre skoru, kırmızı kartları ve maçın adamını fısıldasın.' },
  { hash: 'test', ico: 'brain', acc: 'quiz', name: 'Taraftar Testi', desc: '10 soruda taraftar tipini bul: sen mi teknik direktör, sen mi tribün şairi?' },
  { hash: 'bingo', ico: 'target', acc: 'bingo', name: 'Maç Günü Bingo', desc: 'Arkadaşlarıyla oda kur, kartını doldur, ilk bingoyu yap. Kazanan 30 puan!' },
  { hash: 'sozluk', ico: 'book', acc: 'dict', name: 'Taraftar Sözlüğü', desc: 'Tribün jargonunu halkın tanımlarıyla topla; oy ver, zirveye çık.' },
  { hash: 'transfer', ico: 'coins', acc: 'transfer', name: 'Hayali Transfer', desc: '100 milyonluk kasa, 50 uydurma yıldız, 11 slot. Teknik direktör sensin!' },
  { hash: 'anilar', ico: 'notebook', acc: 'memory', name: 'Futbol Anı Defteri', desc: 'O efsane maç, o son dakika golü... Tribünün ortak hafızası.' }
];

// Kayan bant içeriği (bir "set" — JS genişliğe göre kopyalar, -50% döngü sorunsuz akar)
const SEP = `<span class="s">${icon('spark', 14)}</span>`;
const MARQUEE_SET = `
  <span>Gol gol gol</span>${SEP}
  <span>Bingo var</span>${SEP}
  <span>100 milyonluk kasa</span>${SEP}
  <span>Tribün ayakta</span>${SEP}
  <span>Kaleci çizgide</span>${SEP}
  <span>Kâhin konuştu</span>${SEP}`;

function todayFeatured() {
  // Gün sayısına göre: günde bir değişir, sabit kalır
  const dayIndex = Math.floor(Date.now() / 86400000);
  return FEATURED[dayIndex % FEATURED.length];
}

function todayLabel() {
  return new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
}

/** Marquee içeriğini şerit en az 2× geniş olana dek kopyala (kesintisiz döngü) */
function fillMarquee(root) {
  const track = root.querySelector('#homeTrack');
  if (!track) return;
  let guard = 0;
  while (track.scrollWidth < root.clientWidth * 2 && guard < 20) {
    track.insertAdjacentHTML('beforeend', MARQUEE_SET);
    guard++;
  }
}

/** [data-reveal] ögelerini kademeli göster; 2sn sonra kalanları zorla */
function reveal(root) {
  const items = root.querySelectorAll('[data-reveal]');
  items.forEach((el, i) => setTimeout(() => el.classList.add('in'), 70 + i * 70));
  setTimeout(() => items.forEach((el) => el.classList.add('in')), 2000);
}

/* Maç panosu (AŞAMA 6) matchesBoard.js modülünde yaşar; burada yalnızca
 * bölümün konumu belirlenir: hero banner'ın HEMEN altı (diğer bölümlerin
 * sırası ve içeriği değişmez). */

export function renderHome(el) {
  const f = todayFeatured();
  // Günün oyununa özel büyük ikon; eşleşme yoksa dönen yıldız fallback
  const heroIcon = hasIcon(f.ico)
    ? `<span class="hero-icon" data-acc="${esc(f.acc)}">${icon(f.ico, 84, esc(f.name))}</span>`
    : `<span class="hero-star spin" aria-hidden="true"><svg viewBox="0 0 100 100" fill="currentColor"><path d="M50 0c4 28 18 42 50 50-32 8-46 22-50 50-4-28-18-42-50-50 32-8 46-22 50-50z"/></svg></span>`;

  el.innerHTML = `
    <section class="card hero-featured" data-reveal>
      <div class="hero-top">
        <span class="kicker">Bugünün Oyunu · ${esc(todayLabel())}</span>
        <div class="stickwrap">
          <span class="sticker o">Bugüne Özel</span>
          <span class="sticker r2">Haftanın Maçı</span>
        </div>
      </div>
      <div class="hero-body">
        <div class="hero-copy">
          <h1>${esc(f.name)}</h1>
          <p class="muted hero-lead">${esc(f.desc)}</p>
          <a class="btn big" href="#/${f.hash}">Hemen Oyna ${icon('ball', 20)}</a>
        </div>
        ${heroIcon}
      </div>
    </section>

    <section class="card sp-board" data-reveal id="gununMaclari" aria-labelledby="gununMaclariTitle">
      <!-- AŞAMA 6: maç bölümü — içerik matchesBoard.js tarafından doldurulur -->
    </section>

    <div class="marquee marquee-home" data-reveal aria-hidden="true">
      <div class="track" id="homeTrack">${MARQUEE_SET}${MARQUEE_SET}</div>
    </div>`;

  fillMarquee(el);
  const cleanupBoard = renderMatchesBoard(el.querySelector('#gununMaclari'));
  reveal(el);
  return cleanupBoard;
}
