/**
 * Tribün — Hayali Transfer (#/transfer)
 * 100M bütçe, 3 formasyon, 11 slot. Fiyat/güç/doğrulama/PUAN SUNUCUDA;
 * istemci yalnızca gösterim için aynı formülü kullanır.
 */
import { api, isLoggedIn } from '../api.js';
import { loadMe } from '../state.js';
import { openModal, openLoginModal, toast, loadingHtml, copyText } from '../ui.js';
import { icon } from '../icons.js';

const BUDGET = 100;
const POS_LABELS = { KL: '🧤 Kaleci', DF: '🛡️ Defans', OS: '⚙️ Orta Saha', FV: '⚡ Forvet' };

/** Slot sırası: KL → DF'ler → OS'ler → FV'ler (sunucudaki player_ids sırasıyla aynı) */
const FORMATIONS = {
  '4-3-3': ['KL', 'DF', 'DF', 'DF', 'DF', 'OS', 'OS', 'OS', 'FV', 'FV', 'FV'],
  '4-4-2': ['KL', 'DF', 'DF', 'DF', 'DF', 'OS', 'OS', 'OS', 'OS', 'FV', 'FV'],
  '3-5-2': ['KL', 'DF', 'DF', 'DF', 'OS', 'OS', 'OS', 'OS', 'OS', 'FV', 'FV']
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export async function renderTransfer(root) {
  root.innerHTML = `<section class="card">${loadingHtml('Transfer piyasası taranıyor...')}</section>`;

  let data;
  try {
    data = await api.get('/api/transfer/players');
  } catch (e) {
    root.innerHTML = '';
    const box = el('section', 'card');
    box.appendChild(el('div', 'empty', e.message));
    root.appendChild(box);
    return;
  }

  const players = data.players; // id, name, pos, power, price_m, trait
  const byId = new Map(players.map((p) => [p.id, p]));

  // durum
  const state = {
    formation: '4-3-3',
    slots: [] // slot başına: playerId | null
  };

  // kayıtlı kadroyu yükle
  let savedScore = null;
  if (isLoggedIn()) {
    try {
      const d = await api.get('/api/transfer/squad');
      if (d.squad) {
        state.formation = d.squad.formation;
        state.slots = d.squad.players.map((p) => p.id);
        savedScore = d.squad.squad_score;
      }
    } catch { /* kadro yok demektir */ }
  }

  /* ---------- hesaplar ---------- */
  const totals = () => {
    let power = 0, cost = 0, count = 0;
    for (const id of state.slots) {
      if (id == null) continue;
      const p = byId.get(id);
      if (p) { power += p.power; cost += p.price_m; count++; }
    }
    return { power, cost: Number(cost.toFixed(1)), count, left: Number((BUDGET - cost).toFixed(1)) };
  };
  const estScore = (t) => t.power + Math.floor(t.left / 2);

  /* ---------- çizim ---------- */
  function draw() {
    const slots = FORMATIONS[state.formation];
    if (state.slots.length !== slots.length) state.slots = slots.map(() => null);
    const t = totals();

    root.innerHTML = `
      <section class="card" data-acc="transfer">
        <div class="dict-head">
          <h1 style="margin:0"><span class="ico-box" aria-hidden="true">${icon('coins', 22)}</span> Hayali Transfer</h1>
          <div class="row">
            <label class="field" style="margin:0">
              <select class="input" id="formSel">
                ${Object.keys(FORMATIONS).map((f) => `<option value="${f}" ${f === state.formation ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
            </label>
            <button type="button" class="btn yellow" id="saveSquad">${icon('save', 18)} Kadroyu Kaydet</button>
            <button type="button" class="btn ghost" id="shareSquad">${icon('share', 18)} Kadroyu Paylaş</button>
          </div>
        </div>

        <div class="budget-bar">
          <div class="row" style="justify-content:space-between">
            <b id="budgetLeft"></b>
            <span class="muted small" id="budgetPct"></span>
          </div>
          <div class="progress mt"><i id="budgetFill"></i></div>
        </div>

        <div class="pitch-wrap">
          <div class="pitch" id="pitch"></div>
        </div>

        <div class="transfer-summary" id="summary"></div>
        <div id="saveResult"></div>
        <p class="muted tiny">Kadro puanı = toplam güç + kalan bütçenin yarısı. Yıldız topla ya da tutumlu ol — ikisi de puan getirir. Fiyat ve puan denetimi sunucuda.</p>
      </section>`;

    // bütçe
    const pct = Math.min(100, Math.round(t.cost / BUDGET * 100));
    const leftEl = root.querySelector('#budgetLeft');
    leftEl.textContent = `Kasa: ${t.left}M / ${BUDGET}M`;
    leftEl.style.color = t.left < 0 ? 'var(--red)' : 'var(--green)';
    root.querySelector('#budgetPct').textContent = `kullanılan: ${t.cost}M (%${pct})`;
    const fill = root.querySelector('#budgetFill');
    fill.style.width = pct + '%';
    fill.style.background = t.left < 0
      ? 'linear-gradient(90deg, #ff6060, #a32626)'
      : 'linear-gradient(90deg, var(--green), var(--yellow))';

    // saha: her mevkii grubu bir satır (KL / DF'ler / OS'ler / FV'ler), slot sırası korunur
    const pitch = root.querySelector('#pitch');
    const groups = [['KL'], ...splitRows(slots)];
    pitch.innerHTML = '';
    let cursor = 0;
    for (const group of groups) {
      const rowEl = el('div', 'pitch-row');
      for (let g = 0; g < group.length; g++) {
        const idx = cursor + g;
        rowEl.appendChild(slotEl(idx, slots[idx]));
      }
      cursor += group.length;
      pitch.appendChild(rowEl);
    }

    // özet
    const sum = root.querySelector('#summary');
    sum.appendChild(el('span', 'sum-item', `👥 ${t.count}/11 oyuncu`));
    sum.appendChild(el('span', 'sum-item', `💪 Güç: ${t.power}`));
    sum.appendChild(el('span', 'sum-item', `💸 Maliyet: ${t.cost}M`));
    const scoreEl = el('span', 'sum-item gold', `⭐ Tahmini puan: ${estScore(t)}`);
    sum.appendChild(scoreEl);
    if (savedScore != null) sum.appendChild(el('span', 'sum-item muted', `(kayıtlı rekorun: ${savedScore})`));

    // olaylar
    root.querySelector('#formSel').addEventListener('change', (e) => {
      state.formation = e.target.value;
      state.slots = FORMATIONS[state.formation].map(() => null);
      draw();
    });
    root.querySelector('#saveSquad').addEventListener('click', saveSquad);
    root.querySelector('#shareSquad').addEventListener('click', shareSquad);
  }

  // mevkii gruplarına böl: ['KL'], ['DF'x4], ['OS'x3], ['FV'x3]
  function splitRows(slots) {
    const groups = [];
    for (const pos of ['DF', 'OS', 'FV']) {
      groups.push(slots.filter((s) => s === pos).map(() => pos));
    }
    return groups;
  }

  function slotEl(idx, pos) {
    const playerId = state.slots[idx];
    const btn = el('button', 'slot' + (playerId ? ' filled' : ''));
    btn.type = 'button';
    const p = playerId != null ? byId.get(playerId) : null;
    if (p) {
      btn.appendChild(el('span', 'slot-name', p.name));
      btn.appendChild(el('span', 'slot-sub', `${p.power} · ${p.price_m}M`));
    } else {
      btn.appendChild(el('span', 'slot-name', '+'));
      btn.appendChild(el('span', 'slot-sub', pos));
    }
    btn.addEventListener('click', () => openPlayerPicker(idx, pos));
    return btn;
  }

  /* ---------- oyuncu seçme ---------- */
  function openPlayerPicker(slotIdx, pos) {
    if (!isLoggedIn()) return openLoginModal('Transfer yapmak için önce giriş yapmalısın.');
    const t = totals();
    const others = new Set(state.slots.filter((x, i) => x != null && i !== slotIdx));

    openModal((mroot, close) => {
      mroot.innerHTML = `
        <h3></h3>
        <p class="muted tiny">Kasa: <b class="picker-left"></b> · Seçtikten sonra tekrar dokunarak çıkarabilirsin.</p>
        <div class="picker-list" id="pickerList"></div>`;
      mroot.querySelector('h3').textContent = POS_LABELS[pos] + ' seç';
      mroot.querySelector('.picker-left').textContent = t.left + 'M';

      const list = mroot.querySelector('#pickerList');
      const pool = players.filter((p) => p.pos === pos).sort((a, b) => b.power - a.power);

      const redraw = () => {
        list.innerHTML = '';
        const tt = totals();
        mroot.querySelector('.picker-left').textContent = tt.left + 'M';
        for (const p of pool) {
          const usedElsewhere = others.has(p.id);
          const current = state.slots[slotIdx] === p.id;
          const affordable = tt.left + (byId.get(state.slots[slotIdx])?.price_m ?? 0) >= p.price_m;

          const row = el('div', 'picker-row' + (current ? ' current' : ''));
          const info = el('div', 'picker-info');
          info.appendChild(el('b', null, p.name));
          info.appendChild(el('span', 'muted tiny', p.trait || ''));
          info.appendChild(el('span', 'picker-stats', `💪 ${p.power} · 💸 ${p.price_m}M`));
          row.appendChild(info);

          const btn = el('button', 'btn small' + (current ? ' danger' : ''), current ? '➖ Çıkar' : '➕ Seç');
          btn.type = 'button';
          if (!current && (usedElsewhere || !affordable)) {
            btn.disabled = true;
            btn.title = usedElsewhere ? 'Zaten kadronda oynuyor' : 'Bütçe yetmiyor';
          }
          btn.addEventListener('click', () => {
            state.slots[slotIdx] = current ? null : p.id;
            draw();
            redraw();
          });
          row.appendChild(btn);
          list.appendChild(row);
        }
      };
      redraw();
    });
  }

  /* ---------- kaydet ---------- */
  async function saveSquad() {
    if (!isLoggedIn()) return openLoginModal('Kadro kaydetmek için önce giriş yapmalısın.');
    const t = totals();
    if (t.count !== 11) return toast(`11 oyuncu gerekli, şu an ${t.count} tane var.`, true);
    if (t.left < 0) return toast('Bütçe aşıldı! Takım küçült.', true);

    const btn = root.querySelector('#saveSquad');
    btn.disabled = true;
    try {
      const d = await api.post('/api/transfer/squad', {
        formation: state.formation,
        playerIds: state.slots
      });
      savedScore = d.squad_score;
      const box = root.querySelector('#saveResult');
      box.innerHTML = '';
      const res = el('div', 'celebrate');
      res.appendChild(el('b', null, d.first
        ? `İlk kadron kaydedildi! Kadro puanın: ${d.squad_score} ⭐`
        : (d.improved ? `Kadro gelişti! Yeni puan: ${d.squad_score} ⭐` : `Kaydedildi. Puan: ${d.squad_score} (eskisi: ${d.squad_score - (d.points || 0)})`)));
      if (d.points > 0) res.appendChild(el('div', null, `+${d.points} puan kazandın!`));
      (d.newBadges || []).forEach((b) => {
        res.appendChild(el('span', 'chip', `${b.emoji} ${b.name}`));
        setTimeout(() => toast(`🎉 Yeni rozet: ${b.emoji} ${b.name}`), 500);
      });
      box.appendChild(res);
      if (d.points > 0) toast(`+${d.points} puan! ⭐`);
      loadMe();
      draw();
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- paylaş ---------- */
  async function shareSquad() {
    const t = totals();
    if (t.count < 11) return toast('Önce 11 oyuncunu tamamla, sonra övün. 😄', true);
    const stars = state.slots
      .filter((x) => x != null)
      .map((x) => byId.get(x))
      .sort((a, b) => b.power - a.power)
      .slice(0, 3)
      .map((p) => p.name)
      .join(', ');
    const text = `⚽ Tribün'de ${state.formation} kadrom: güç ${t.power}, bütçem ${t.cost}M! Yıldızlarım: ${stars} — kadro puanım ${estScore(t)}.`;
    const ok = await copyText(text);
    toast(ok ? 'Kadron panoya kopyalandı! Hava atmaya hazır. 📋' : 'Kopyalanamadı.', !ok);
  }

  draw();
}
