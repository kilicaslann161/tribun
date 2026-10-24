/**
 * Tribün — inline SVG ikon seti (harici kütüphane YOK)
 * Tek dil: 24x24 viewBox, 2px çizgi, yuvarlak uç/birleşim, currentColor.
 * Dolgu gereken ikonlarda (yıldız, kıvılcım, nokta) path kendi
 * fill="currentColor" stroke="none" değerini taşır.
 *
 * Kullanım:
 *   import { icon } from './icons.js';
 *   icon('trophy')            // 24px, aria-hidden (dekoratif)
 *   icon('trophy', 18)        // 18px
 *   icon('trophy', 18, 'Kupa') // anlamlı → role="img" aria-label
 */

const I = {
  /* kale + penaltı topu */
  goal: '<path d="M4 20V4h16v16"/><circle cx="12" cy="13" r="3.2"/><path d="M4 20h4.5M15.5 20H20"/>',
  /* futbold topu */
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7.6l4.4 3.2-1.7 5.2H9.3l-1.7-5.2z"/><path d="M12 3.2v4.4M20 9.9l-3.6.9M17.3 18.8l-2.6-2.8M6.7 18.8l2.6-2.8M4 9.9l3.6.9"/>',
  /* basketbol topu */
  basketball: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17"/><path d="M6.2 6.2c3 2.4 3 9.2 0 11.6M17.8 6.2c-3 2.4-3 9.2 0 11.6"/>',
  /* sihirbaz küresi: kristal küre + kaide + parıltılar */
  crystal: '<circle cx="12" cy="9.5" r="5.5"/><path d="M9.2 9.2c.2-1.3 1.1-2.2 2.4-2.5"/><path d="M8.9 15.4c.5 1.5 1.7 2.3 3.1 2.3s2.6-.8 3.1-2.3"/><path d="M12 17.7v1.8M8.5 21.5h7"/><path d="M18.5 2.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke="none"/><path d="M4.5 5.5h.01M3.5 9.5h.01"/>',
  /* beyin (taraftar testi) */
  brain: '<path d="M11 4.5a3 3 0 0 0-3 3 3.4 3.4 0 0 0-2.7 3.3c0 1 .5 2 1.3 2.6-.2.4-.3.9-.3 1.3a3.4 3.4 0 0 0 3.4 3.4H11"/><path d="M13 4.5a3 3 0 0 1 3 3 3.4 3.4 0 0 1 2.7 3.3c0 1-.5 2-1.3 2.6.2.4.3.9.3 1.3a3.4 3.4 0 0 1-3.4 3.4H13"/><path d="M12 4.5v17"/>',
  /* hedef / bingo */
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  /* açık kitap (sözlük) */
  book: '<path d="M12 6.5C10 4.9 7.6 4.4 4 4.7v14.2c3.6-.3 6 .2 8 1.8 2-1.6 4.4-2.1 8-1.8V4.7c-3.6-.3-6 .2-8 1.8z"/><path d="M12 6.5v14.2"/>',
  /* madeni paralar (transfer) */
  coins: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M6.3 13.2a5.5 5.5 0 1 0 7.9-7.4"/><path d="M10 8.5h-.01M7.5 8.5h.01"/>',
  /* defter (anılar) */
  notebook: '<rect x="5" y="4" width="14" height="17" rx="1"/><path d="M8.5 4V2.2M12 4V2.2M15.5 4V2.2M8.5 10.5h7M8.5 14h7M8.5 17.5H12"/>',
  /* kupa (liderlik) */
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4c0 3 1.2 4.7 3.4 5.2M17 6h3c0 3-1.2 4.7-3.4 5.2"/><path d="M12 14v4M8 21h8M9.5 18h5"/>',
  /* kimlik kartı */
  card: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M12 8.6l.95 1.9 2.1.3-1.5 1.5.35 2.1L12 13.4l-1.9 1-.35-2.1-1.5-1.5 2.1-.3z" fill="currentColor" stroke="none"/><path d="M6.5 16.5h4"/>',
  /* oklar */
  'arrow-right': '<path d="M4 12h15M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H5M11 18l-6-6 6-6"/>',
  /* yıldız (dolu) */
  star: '<path d="M12 2.6l2.9 5.9 6.5.94-4.7 4.58 1.1 6.47L12 17.44l-5.8 3.05 1.1-6.47L2.6 9.44l6.5-.94z" fill="currentColor" stroke="none"/>',
  /* kıvılcım (ticker ayraç) */
  spark: '<path d="M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z" fill="currentColor" stroke="none"/>',
  /* bayrak (bildir) */
  flag: '<path d="M5 21.5V3.5"/><path d="M5 4.5c4-2 7 2 11 0v9.5c-4 2-7-2-11 0"/>',
  /* kullanıcı */
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  /* kullanıcılar (grup) */
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.9-3 3.4-4.6 6.5-4.6s5.6 1.6 6.5 4.6"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16.5 15.6c2.4.3 4.2 1.7 5 4.4"/>',
  /* ev */
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>',
  /* ızgara (oyunlar) */
  grid: '<rect x="4" y="4" width="7" height="7" rx="0.5"/><rect x="13" y="4" width="7" height="7" rx="0.5"/><rect x="4" y="13" width="7" height="7" rx="0.5"/><rect x="13" y="13" width="7" height="7" rx="0.5"/>',
  /* üç nokta (daha) */
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  /* ekleme / çıkarma / silme */
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M9.5 7V4h5v3"/><path d="M6.5 7l1 14h9l1-14"/><path d="M10 11v6M14 11v6"/>',
  /* kilit (giriş) */
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>',
  /* kopyala / link / paylaş */
  copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="1"/><path d="M5.5 15H4.5a1.5 1.5 0 0 1-1.5-1.5V4.5A1.5 1.5 0 0 1 4.5 3H14a1.5 1.5 0 0 1 1.5 1.5v1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l2.4-2.4a5 5 0 0 0-7.07-7.07l-1.4 1.4"/><path d="M14 11a5 5 0 0 0-7.54-.54l-2.4 2.4a5 5 0 0 0 7.07 7.07l1.4-1.4"/>',
  share: '<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M5 13v5.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V13"/>',
  /* arama / saat / alev / oyun süreçleri */
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flame: '<path d="M12 3.5c3.5 3 5.5 6 5.5 9a5.5 5.5 0 0 1-11 0c0-1.6.6-3.2 1.8-4.7.3 1 .9 1.8 1.7 2.2C10 7.6 10.8 5.4 12 3.5z"/>',
  'thumbs-up': '<path d="M7 10v11"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7v-11l4.55-8.89A3.13 3.13 0 0 1 15 5.88z"/>',
  'thumbs-down': '<path d="M17 14V3"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v11l-4.55 8.89A3.13 3.13 0 0 1 9 18.12z"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  /* yenile / aşağı ok */
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  /* kaydet (disket) */
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><path d="M8 21v-7h8v7"/>',
  /* statlar */
  fire: '<path d="M12 3.5c3.5 3 5.5 6 5.5 9a5.5 5.5 0 0 1-11 0c0-1.6.6-3.2 1.8-4.7.3 1 .9 1.8 1.7 2.2C10 7.6 10.8 5.4 12 3.5z"/>',
  medal: '<circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 10L5.5 3.5h4L12 9l2.5-5.5h4L13.5 10"/><path d="M12 12.4l.7 1.4 1.5.2-1.1 1.05.26 1.5L12 15.8l-1.36.75.26-1.5L9.8 14l1.5-.2z" fill="currentColor" stroke="none"/>',
  /* ---- AŞAMA 8: maç detayı olay ikonları (inline SVG, emoji YOK) ---- */
  /* sarı kart */
  card: '<rect x="7.5" y="4" width="9" height="16" rx="1"/>',
  /* oyuncu değişikliği (çıkış aşağı / giriş yukarı) */
  sub: '<path d="M6.5 4v11"/><path d="M3.5 12l3 3 3-3"/><path d="M17.5 20V9"/><path d="M14.5 12l3-3 3 3"/>',
  /* VAR (monitör) */
  var: '<rect x="3" y="4" width="18" height="12.5" rx="1"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  /* penaltı golü (kale + penaltı noktası) */
  pen: '<path d="M4 20V4h16v16"/><circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none"/><path d="M4 20h4.5M15.5 20H20"/>',
  /* bilinmeyen olay türü (genel işaret) */
  event: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>'
};

/** HTML kaçışı (label parametresi için) */
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * SVG ikon bas.
 * @param {string} name ikon anahtarı (bulunamazsa yıldız fallback)
 * @param {number} [size=24] kenar boyutu (px)
 * @param {string} [label] verilirse anlamlı ikon (aria-label + role=img),
 *                         verilmezse dekoratif (aria-hidden)
 * @returns {string} SVG HTML'i
 */
export function icon(name, size = 24, label = '') {
  const body = I[name] || I.star;
  const acc = label
    ? `role="img" aria-label="${escAttr(label)}"`
    : 'aria-hidden="true"';
  return `<svg class="ic ic-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${acc}>${body}</svg>`;
}

/** İkon adının varlığını sınamak için (fallback kararları) */
export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(I, name);
}
