/**
 * Tribün — Taraftar Kartı (#/kart)
 * Takma ad, unvan, puan, seri, rozetler. Ekran görüntüsüne uygun tasarım.
 * Veri: GET /api/me + GET /api/badges (tanımlar buradan gelir)
 */
import { api } from '../api.js';
import { loadMe } from '../state.js';
import { esc, toast, loadingHtml, copyText } from '../ui.js';
import { icon } from '../icons.js';

export async function renderCard(el) {
  el.innerHTML = `<section class="card">${loadingHtml('Kartın basılıyor...')}</section>`;

  let me, badgeDefs;
  try {
    [me, badgeDefs] = await Promise.all([
      api.get('/api/me'),
      api.get('/api/badges')
    ]);
  } catch (e) {
    el.innerHTML = `<section class="card"><div class="empty">${esc(e.message)}</div></section>`;
    toast(e.message, true);
    return;
  }

  // Kazanılma tarihlerini tanımlarla birleştir
  const badges = badgeDefs.badges.map((b) => {
    const earned = me.badges.find((x) => x.badge_key === b.key);
    return { ...b, earned_at: earned ? earned.earned_at : null };
  });
  const earnedCount = badges.filter((b) => b.earned).length;

  el.innerHTML = `
    <section class="card fan-card">
      <div class="fan-top">
        <span class="fan-emoji" aria-hidden="true">${icon('card', 24)}</span>
        <span class="pill yellow">TRİBÜN KARTI</span>
      </div>
      <h1 class="fan-nick">${esc(me.user.nickname)}</h1>
      <div class="fan-title">${esc(me.user.fan_title)}</div>

      <div class="fan-stats">
        <div><b>⭐ ${Number(me.user.total_points).toLocaleString('tr-TR')}</b><span>toplam puan</span></div>
        <div><b>🔥 ${me.user.streak}</b><span>günlük seri</span></div>
        <div><b>🏅 ${earnedCount}/${badges.length}</b><span>rozet</span></div>
      </div>

      <div class="badge-grid">
        ${badges.map((b) => `
          <span class="chip${b.earned ? '' : ' locked'}" data-badge="${esc(b.key)}"
                data-name="${esc(b.name)}" data-desc="${esc(b.desc)}" tabindex="0" role="button"
                title="${esc(b.name)} — ${esc(b.desc)}">
            ${b.earned ? b.emoji : '🔒'} ${esc(b.name)}
          </span>`).join('')}
      </div>

      <button type="button" class="btn yellow block" id="shareCard">${icon('share', 18)} Kartı Paylaş</button>
      <p class="muted tiny">Üyelik: ${esc(String(me.user.created_at || '').slice(0, 10))} · Kart, oyun oynadıkça güçlenir</p>
    </section>`;

  // Kilitli rozetler: dokun/tıkla → nasıl kazanılır
  el.querySelectorAll('.chip.locked').forEach((chip) => {
    const show = () => toast(`🔒 ${chip.dataset.name}: ${chip.dataset.desc}`, false);
    chip.addEventListener('click', show);
    chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
  });

  // Paylaş: metin özetini panoya kopyala
  el.querySelector('#shareCard').addEventListener('click', async () => {
    const text = `⚽ Tribün'de "${me.user.fan_title}" unvanına sahibim, ${me.user.total_points} puanım var! 🔥 ${me.user.streak} günlük giriş serim, ${earnedCount} rozetim var. Sen de gel, tribünde yerini al!`;
    const ok = await copyText(text);
    if (ok) toast('Kartın panoya kopyalandı! Yapıştır ve hava at. 📋✨');
    else toast('Kopyalanamadı, metni elle seçip kopyalayabilirsin.', true);
  });

  // Kart açılışında üst barı da tazele (unvan değişmiş olabilir)
  loadMe();
}
