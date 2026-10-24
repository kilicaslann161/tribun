/**
 * Tribün — Oyun Salonu sayfası (#/oyunlar)
 * Ana sayfadan taşınan oyun kartları gridi. Kart markup'ı ana sayfadaki
 * haliyle birebir aynı (data-acc aksanları, ikon kutuları, "YENİ" çıkartmaları).
 */
import { esc } from '../ui.js';
import { icon } from '../icons.js';

const GAMES = [
  { hash: 'penalti', ico: 'goal', acc: 'penalty', name: 'Penaltı Atışları', desc: 'Bölge seç, topu gönder, kaleciye acıma' },
  { hash: 'kahin-sensin', ico: 'crystal', acc: 'oracle', name: 'Kâhin Sensin', desc: 'Gerçek maçlar: 1/X/2 + karşılıklı gol tahmini', sticker: 'YENİ' },
  { hash: 'kahin', ico: 'crystal', acc: 'oracle', name: 'Kâhin', desc: 'Kristal küreden espirili maç tahminleri' },
  { hash: 'test', ico: 'brain', acc: 'quiz', name: 'Taraftar Testi', desc: '10 soru, 5 tip. Hangisi sen?' },
  { hash: 'bingo', ico: 'target', acc: 'bingo', name: 'Maç Günü Bingo', desc: 'Arkadaşlarla oda kur, ilk bingoyu yap', sticker: 'YENİ' },
  { hash: 'sozluk', ico: 'book', acc: 'dict', name: 'Taraftar Sözlüğü', desc: 'Tribün jargonu, halkın tanımlarıyla' },
  { hash: 'transfer', ico: 'coins', acc: 'transfer', name: 'Hayali Transfer', desc: '100 milyonla kadro kur, direktör sensin', sticker: 'YENİ' },
  { hash: 'anilar', ico: 'notebook', acc: 'memory', name: 'Futbol Anı Defteri', desc: 'Efsane maçların yaşayan hafızası' }
];

/** [data-reveal] ögelerini kademeli göster; 2sn sonra kalanları zorla */
function reveal(root) {
  const items = root.querySelectorAll('[data-reveal]');
  items.forEach((el, i) => setTimeout(() => el.classList.add('in'), 70 + i * 70));
  setTimeout(() => items.forEach((el) => el.classList.add('in')), 2000);
}

export function renderGames(el) {
  el.innerHTML = `
    <section class="card">
      <h1 style="margin-top:0"><span class="ico-box" aria-hidden="true">${icon('grid', 22)}</span> Oyun Salonu</h1>
      <div class="game-grid">
        ${GAMES.map((g) => `
          <a class="game-card" href="#/${g.hash}" data-name="${esc(g.name)}" data-acc="${esc(g.acc)}" data-reveal>
            ${g.sticker ? `<span class="g-sticker">${esc(g.sticker)}</span>` : ''}
            <span class="g-emoji" aria-hidden="true">${icon(g.ico, 26)}</span>
            <span class="g-name">${esc(g.name)}</span>
            <span class="g-desc">${esc(g.desc)}</span>
            <span class="g-play" aria-hidden="true">Oyna ${icon('arrow-right', 16)}</span>
          </a>`).join('')}
      </div>
    </section>`;

  reveal(el);
}
