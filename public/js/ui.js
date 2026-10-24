/**
 * Tribün — UI yardımcıları: toast, modal, yükleme, escape, panoya kopyalama
 */
import { api, setToken } from './api.js';
import { loadMe } from './state.js';
import { icon } from './icons.js';

/** XSS'e karşı HTML kaçışı — sunucudan gelen HER metin bununla basılır */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function toast(msg, isError = false) {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

/**
 * Modal açar. setup(root, close) kökünü doldurur; kapatma fonksiyonu döner.
 * ESC ve arka plan tıklaması kapatır.
 */
export function openModal(setup) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const modal = document.createElement('div');
  modal.className = 'modal';
  back.appendChild(modal);
  document.getElementById('modalRoot').appendChild(back);

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    back.remove();
  };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });

  setup(modal, close);
  return close;
}

export const loadingHtml = (label = 'Yükleniyor...') =>
  `<div class="loading"><div class="spinner" aria-hidden="true"></div>${esc(label)}</div>`;

export const skeletonRows = (n = 4) =>
  Array.from({ length: n }, () => '<div class="skeleton skeleton-row"></div>').join('');

/** Metni panoya kopyala (clipboard API + eski yöntem yedeği) */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ---------------- Giriş / Kayıt penceresi ---------------- */

/**
 * Giriş-kayıt modalı. Başarıda:
 *  - token kaydedilir, /api/me çekilir, 'tribun:authed' olayı yayınlanır
 */
export function openLoginModal(note = '') {
  openModal((root, close) => {
    root.innerHTML = `
      <h3>${icon('lock', 22)} Tribün'e Giriş</h3>
      ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
      <div class="tabs" role="tablist">
        <button type="button" class="tab active" data-mode="login">Giriş Yap</button>
        <button type="button" class="tab" data-mode="register">Kayıt Ol</button>
      </div>
      <form id="authForm" novalidate>
        <label class="field">
          <span>Takma Ad</span>
          <input class="input" name="nickname" maxlength="20" autocomplete="username" placeholder="ör. TribunKurdu" required>
        </label>
        <label class="field">
          <span>Şifre</span>
          <input class="input" name="password" type="password" minlength="6" autocomplete="current-password" placeholder="en az 6 karakter" required>
        </label>
        <p class="form-error" id="authErr" hidden></p>
        <button class="btn block" type="submit" id="authSubmit">Giriş Yap</button>
      </form>
      <p class="muted tiny" style="margin-top:10px">E-posta yok, telefon yok; sadece takma ad ve şifre. Kolay gelsin! ⚽</p>`;

    let mode = 'login';
    const form = root.querySelector('#authForm');
    const errEl = root.querySelector('#authErr');
    const submitBtn = root.querySelector('#authSubmit');
    const passInput = form.elements.password;
    passInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';

    root.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        mode = tab.dataset.mode;
        root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        submitBtn.textContent = mode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur';
        passInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
        errEl.hidden = true;
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.hidden = true;
      const nickname = form.elements.nickname.value.trim();
      const password = form.elements.password.value;

      if (nickname.length < 3) { errEl.textContent = 'Takma ad en az 3 karakter olmalı.'; errEl.hidden = false; return; }
      if (password.length < 6) { errEl.textContent = 'Şifre en az 6 karakter olmalı.'; errEl.hidden = false; return; }

      submitBtn.disabled = true;
      submitBtn.textContent = mode === 'login' ? 'Giriliyor...' : 'Hesap açılıyor...';
      try {
        const d = await api.post(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { nickname, password });
        setToken(d.token);
        await loadMe();
        toast(`Hoş geldin ${d.user.nickname}! Tribün seni bekliyordu. 🎉`);
        close();
        window.dispatchEvent(new CustomEvent('tribun:authed'));
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur';
      }
    });
  });
}

/* ---------------- Ortak Bildirme modalı ---------------- */

const REPORT_REASONS = ['Küfür/hakaret', 'Spam', 'Uygunsuz içerik', 'Diğer'];

/**
 * İçerik bildirme penceresi.
 * @param {'term'|'memory'} contentType
 * @param {number} contentId
 * @param {string} label içeriğin kısa adı (ör. terimin kendisi) — textContent ile basılır
 */
export function openReportModal(contentType, contentId, label = '') {
  openModal((root, close) => {
    root.innerHTML = `
      <h3>${icon('flag', 22)} Bildir</h3>
      <p class="muted small">İçeriği neden bildiriyorsun? Moderasyon ekibimiz (yani biz, üç kişi ve bir fincan çay) inceleyecek.</p>
      ${label ? '<p class="rep-label tiny" style="font-weight:700"></p>' : ''}
      <label class="field">
        <span>Sebep</span>
        <select class="input" id="repReason">
          ${REPORT_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span>Not (isteğe bağlı)</span>
        <textarea class="input" id="repNote" rows="2" maxlength="200" placeholder="Kısaca ne sorunlu?"></textarea>
      </label>
      <div class="char-counter"><span id="repCnt">0/200</span></div>
      <p class="form-error" id="repErr" hidden></p>
      <button class="btn danger block" id="repSend">${icon('flag', 18)} Bildirimi Gönder</button>`;

    if (label) root.querySelector('.rep-label').textContent = label;

    const note = root.querySelector('#repNote');
    const cnt = root.querySelector('#repCnt');
    note.addEventListener('input', () => { cnt.textContent = `${note.value.length}/200`; });
    const first = root.querySelector('#repReason');
    if (first) first.focus();

    root.querySelector('#repSend').addEventListener('click', async () => {
      const errEl = root.querySelector('#repErr');
      errEl.hidden = true;
      try {
        const d = await api.post('/api/report', {
          content_type: contentType,
          content_id: contentId,
          reason: root.querySelector('#repReason').value,
          note: note.value.trim()
        });
        close();
        toast('Bildirimin alındı! İnceleyeceğiz. 🚩');
        if (d.autoHidden) {
          setTimeout(() => toast('Bu içerik 3 farklı bildiri alınca otomatik gizlendi. 🙈'), 900);
        }
      } catch (e) {
        errEl.textContent = e.message; // "Bunu zaten bildirdin..." vb.
        errEl.hidden = false;
      }
    });
  });
}
