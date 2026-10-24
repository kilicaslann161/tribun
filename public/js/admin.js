/**
 * Tribün — admin paneli (Aşama 3 + 4)
 * İstatistikler (bingo oda/kadro sayaçları dahil), içerik bazlı bekleyen raporlar,
 * son eklenenler ve son 10 bingo odası.
 * - Admin anahtarı YALNIZCA bellekte (localStorage yok)
 * - Tüm kullanıcı metinleri textContent ile basılır (XSS yok)
 */
const $ = (sel) => document.querySelector(sel);
let adminKey = ''; // bellek içi

const GAME_LABELS = {
  penalty: 'Penaltı', oracle: 'Kâhin', quiz: 'Taraftar Testi',
  bingo: 'Bingo', transfer: 'Transfer', dictionary: 'Sözlük',
  memory: 'Anı', bonus: 'Bonus'
};

/** DOM yardımcısı: el('button', 'btn small', 'metin') — metin textContent ile */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function toast(msg, isErr = false) {
  const wrap = $('#toastWrap');
  const t = el('div', 'toast' + (isErr ? ' err' : ''), msg);
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

async function adminApi(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    ...opts
  });
  let data = null;
  try { data = await res.json(); } catch { /* gövde boş olabilir */ }
  if (!res.ok) throw new Error((data && data.error) || 'İstek başarısız oldu.');
  return data;
}

/* ---------------- sekmeler ---------------- */
function switchTab(name) {
  document.querySelectorAll('#adminTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  ['stats', 'reports', 'content', 'rooms', 'matches', 'sports'].forEach((n) => {
    $(`#tab-${n}`).hidden = n !== name;
  });
  if (name === 'reports') loadReports();
  if (name === 'content') loadContent();
  if (name === 'rooms') loadRooms();
  if (name === 'matches') loadMatchesTab();
  if (name === 'sports') loadSportsTab();
}

/* ---------------- istatistikler ---------------- */
async function renderStats() {
  const s = await adminApi('/api/admin/stats');
  const box = $('#stats');
  box.innerHTML = '';
  const items = [
    ['👥', s.users, 'Kullanıcı'],
    ['📚', s.terms, 'Sözlük Terimi'],
    ['📖', s.memories, 'Anı'],
    ['🚩', s.pending_reports, 'Bekleyen Rapor'],
    ['🙈', s.hidden_contents, 'Gizli İçerik'],
    ['🎯', s.scores, 'Skor Kaydı'],
    ['🏟️', s.bingo_open, 'Açık Bingo Odası'],
    ['🏁', s.bingo_finished, 'Biten Bingo Odası'],
    ['💼', s.squads, 'Kayıtlı Kadro'],
    ['⭐', s.total_points, 'Toplam Puan']
  ];
  for (const [emoji, value, label] of items) {
    const item = el('div', 'card stat');
    item.appendChild(el('b', null, `${emoji} ${Number(value ?? 0).toLocaleString('tr-TR')}`));
    item.appendChild(el('span', null, label));
    box.appendChild(item);
  }
  if (s.top_user) {
    const item = el('div', 'card stat');
    item.appendChild(el('b', null, `🥇 ${s.top_user.nickname}`));
    item.appendChild(el('span', null, `Zirvede · ${s.top_user.total_points} puan`));
    box.appendChild(item);
  }
}

/* ---------------- raporlar (içerik bazlı gruplu) ---------------- */
async function loadReports() {
  const box = $('#reports');
  box.innerHTML = '';
  try {
    const d = await adminApi('/api/admin/reports');
    if (!d.reports.length) {
      box.appendChild(el('div', 'empty', 'Temiz! Bekleyen rapor yok. 🎉'));
      return;
    }
    for (const g of d.reports) box.appendChild(reportGroupCard(g));
  } catch (e) {
    box.appendChild(el('div', 'empty', e.message));
  }
}

function reportGroupCard(g) {
  const card = el('article', 'card admin-item');

  const head = el('div', 'row');
  head.appendChild(el('span', 'pill ' + (g.content_type === 'term' ? '' : 'yellow'),
    g.content_type === 'term' ? `Terim #${g.content_id}` : `Anı #${g.content_id}`));
  head.appendChild(el('span', 'pill ' + (g.hidden ? 'red' : ''), g.hidden ? 'GİZLİ' : 'Açık'));
  head.appendChild(el('span', 'pill red', `🚩 ${g.report_count} rapor`));
  card.appendChild(head);

  const content = el('p', 'admin-content');
  content.textContent = g.content ?? '(içerik silinmiş)';
  card.appendChild(content);

  const meta = el('p', 'muted admin-meta');
  meta.textContent = `Yazar: ${g.author ?? '?'} · Bildirenler: ${(g.reporters || []).join(', ')} · Son: ${g.last_at}`;
  card.appendChild(meta);

  const reasons = el('div', 'chips');
  for (const r of g.reasons || []) reasons.appendChild(el('span', 'chip', r));
  card.appendChild(reasons);

  const actions = el('div', 'row mt');
  const mk = (label, cls, fn) => {
    const b = el('button', 'btn small ' + cls, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };

  if (!g.hidden) {
    actions.appendChild(mk('🙈 Gizle', 'danger', () => contentAction(g, 'hide')));
  } else {
    actions.appendChild(mk('↩️ Geri Aç', '', () => contentAction(g, 'unhide')));
  }
  actions.appendChild(mk('✅ Raporları Reddet', 'ghost', async () => {
    // İçerik temiz → o içeriğin tüm raporlarını kapat
    for (const id of g.report_ids || []) {
      await adminApi(`/api/admin/reports/${id}`, { method: 'POST', body: JSON.stringify({ action: 'dismiss' }) });
    }
    toast('Raporlar reddedildi, içerik temiz sayıldı. ✅');
    refreshAll();
  }));
  actions.appendChild(mk('🗑️ İçeriği Sil', 'danger', () => contentAction(g, 'delete')));
  card.appendChild(actions);
  return card;
}

async function contentAction(g, action) {
  try {
    await adminApi(`/api/admin/content/${g.content_type}/${g.content_id}`, {
      method: 'POST',
      body: JSON.stringify({ action })
    });
    toast(action === 'hide' ? 'İçerik gizlendi.' : action === 'unhide' ? 'İçerik geri açıldı.' : 'İçerik silindi.');
    refreshAll();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------- son eklenenler ---------------- */
async function loadContent() {
  try {
    const d = await adminApi('/api/admin/content');
    fillContentList($('#recentTerms'), d.terms, 'term', (r) => r.title + ' — ' + r.body);
    fillContentList($('#recentMemories'), d.memories, 'memory', (r) => `${r.title} (${r.year ?? '?'}) — ${r.body}`);
  } catch (e) {
    $('#recentTerms').appendChild(el('div', 'empty', e.message));
  }
}

function fillContentList(box, rows, type, textOf) {
  box.innerHTML = '';
  if (!rows || !rows.length) {
    box.appendChild(el('div', 'empty', 'Kayıt yok.'));
    return;
  }
  for (const r of rows) {
    const card = el('article', 'card admin-item');
    const head = el('div', 'row');
    if (r.hidden) head.appendChild(el('span', 'pill red', 'GİZLİ'));
    if (r.report_count > 0) head.appendChild(el('span', 'pill yellow', `🚩 ${r.report_count}`));
    card.appendChild(head);

    const content = el('p', 'admin-content');
    content.textContent = textOf(r);
    card.appendChild(content);

    const meta = el('p', 'muted admin-meta');
    meta.textContent = `Yazar: ${r.author} · ${String(r.created_at).slice(0, 16)}`;
    card.appendChild(meta);

    const actions = el('div', 'row');
    const mk = (label, cls, action) => {
      const b = el('button', 'btn small ' + cls, label);
      b.type = 'button';
      b.addEventListener('click', async () => {
        try {
          await adminApi(`/api/admin/content/${type}/${r.id}`, { method: 'POST', body: JSON.stringify({ action }) });
          toast(action === 'hide' ? 'Gizlendi.' : action === 'unhide' ? 'Geri açıldı.' : 'Silindi.');
          refreshAll();
        } catch (e) { toast(e.message, true); }
      });
      return b;
    };
    actions.appendChild(r.hidden ? mk('↩️ Geri Aç', '', 'unhide') : mk('🙈 Gizle', 'danger', 'hide'));
    actions.appendChild(mk('🗑️ Sil', 'danger', 'delete'));
    card.appendChild(actions);
    box.appendChild(card);
  }
}

/* ---------------- son 10 bingo odası ---------------- */
async function loadRooms() {
  const box = $('#roomsBox');
  box.innerHTML = '';
  try {
    const d = await adminApi('/api/admin/bingo-rooms');
    if (!d.rooms.length) {
      box.appendChild(el('div', 'empty', 'Henüz oda kurulmamış. 🎯'));
      return;
    }
    const wrap = el('div', 'table-wrap');
    const table = el('table');
    const thead = el('thead');
    const headRow = el('tr');
    for (const h of ['Kod', 'Durum', 'Kurucu', 'Oyuncu', 'Kazanan', 'Kuruluş']) headRow.appendChild(el('th', null, h));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const r of d.rooms) {
      const row = el('tr');
      row.appendChild(el('td', null, r.code));
      const st = el('td', null, r.status === 'open' ? '🟢 Açık' : '🏁 Bitti');
      row.appendChild(st);
      row.appendChild(el('td', null, r.owner ?? '?'));
      row.appendChild(el('td', null, `${r.player_count}/10`));
      row.appendChild(el('td', null, r.winner ? `🏆 ${r.winner}` : '—'));
      row.appendChild(el('td', null, String(r.created_at ?? '').slice(0, 16)));
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
  } catch (e) {
    box.appendChild(el('div', 'empty', e.message));
  }
}

/* ---------------- Maçlar: Kâhin Sensin (AŞAMA 9) ---------------- */

const KICK_FMT = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul'
});
const fmtKick = (iso) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '?' : KICK_FMT.format(d);
};

const REVIEW_TR = {
  match_postponed: 'Bağlı senkron maçı ertelendi',
  match_cancelled: 'Bağlı senkron maçı iptal edildi',
  match_feed_missing: 'Bağlı senkron maçı veri akışından düştü',
  kickoff_changed: 'Bağlı senkron maçın başlama saati değişti'
};
const MATCH_STATUS_TR = {
  scheduled: 'beklemede', live: 'canlı', halftime: 'devre arası', finished: 'bitti',
  postponed: 'ertelendi', cancelled: 'iptal', suspended: 'durduruldu', abandoned: 'yarıda kaldı', unknown: 'bilinmiyor'
};

async function loadMatchesTab() {
  await Promise.all([loadForecastCandidates(), loadForecastFixtures()]);
}

async function loadForecastCandidates() {
  const box = $('#forecastCandidates');
  box.innerHTML = '';
  try {
    const d = await adminApi('/api/admin/sports/forecast/candidates');
    if (!d.candidates.length) {
      box.appendChild(el('div', 'empty', 'Aktarılabilir yaklaşan futbol maçı yok (gelecek 7 gün, senkron beklenen maçlar).'));
      return;
    }
    const list = el('div');
    for (const c of d.candidates) {
      const row = el('label', 'admin-item');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      row.style.cursor = 'pointer';
      const cb = el('input');
      cb.type = 'checkbox';
      cb.value = String(c.id);
      cb.dataset.cid = String(c.id);
      row.appendChild(cb);
      const txt = el('span', null, `${c.home_team} — ${c.away_team}`);
      txt.style.flex = '1';
      row.appendChild(txt);
      row.appendChild(el('span', 'pill', fmtKick(c.kickoff_utc)));
      if (c.competition) row.appendChild(el('span', 'pill yellow', c.competition));
      list.appendChild(row);
    }
    box.appendChild(list);
    const actions = el('div', 'row mt');
    const btn = el('button', 'btn', 'Seçilenleri Kâhin Sensin\'e Aktar');
    btn.type = 'button';
    btn.addEventListener('click', importSelectedCandidates);
    actions.appendChild(btn);
    const note = el('span', 'muted tiny', `${d.candidates.length} aday · yalnızca futbol`);
    actions.appendChild(note);
    box.appendChild(actions);
  } catch (e) {
    box.appendChild(el('div', 'empty', e.message));
  }
}

async function importSelectedCandidates() {
  const ids = [...document.querySelectorAll('#forecastCandidates input[type=checkbox]:checked')]
    .map((cb) => Number(cb.dataset.cid));
  if (!ids.length) return toast('Önce en az bir maç seç.', true);
  try {
    const r = await adminApi('/api/admin/sports/forecast/import', {
      method: 'POST', body: JSON.stringify({ matchIds: ids })
    });
    const parts = [];
    parts.push(`${r.imported.length} maç aktarıldı`);
    if (r.already.length) parts.push(`${r.already.length} tanesi zaten bağlıydı`);
    if (r.rejected.length) parts.push(`${r.rejected.length} tanesi reddedildi`);
    toast(parts.join(' · '));
    for (const rej of r.rejected) toast(`#${rej.id}: ${rej.reason}`, true);
    await loadMatchesTab();
  } catch (e) {
    toast(e.message, true);
  }
}

async function loadForecastFixtures() {
  const box = $('#forecastFixtures');
  box.innerHTML = '';
  try {
    const d = await adminApi('/api/admin/forecast/fixtures');
    if (!d.fixtures.length) {
      box.appendChild(el('div', 'empty', 'Henüz Kâhin Sensin maçı yok. Yukarıdan senkron maç aktar ya da elle ekle.'));
      return;
    }
    for (const f of d.fixtures) box.appendChild(fixtureAdminCard(f));
  } catch (e) {
    box.appendChild(el('div', 'empty', e.message));
  }
}

function fixtureAdminCard(f) {
  const card = el('article', 'card admin-item');

  const head = el('div', 'row');
  head.appendChild(el('span', 'pill ' + (f.status === 'open' ? '' : f.status === 'finished' ? 'yellow' : 'red'),
    f.status === 'open' ? 'AÇIK' : f.status === 'finished' ? 'SONUÇLANDI' : 'İPTAL'));
  head.appendChild(el('span', 'pill', `#${f.id} · ${f.prediction_count} tahmin`));
  if (f.review_required) {
    head.appendChild(el('span', 'pill red', `İNCELEME GEREKLİ — ${REVIEW_TR[f.review_reason] || f.review_reason}`));
  }
  if (f.match_id) {
    head.appendChild(el('span', 'pill', `senkron: ${MATCH_STATUS_TR[f.match_status] || f.match_status}` +
      (f.feed_missing ? ' · akışta yok' : '')));
  } else {
    head.appendChild(el('span', 'pill', 'elle girildi'));
  }
  card.appendChild(head);

  const title = el('p', 'admin-content');
  title.textContent = `${f.home_team} — ${f.away_team}` +
    (f.status === 'finished' && f.home_score != null ? `  ·  ${f.home_score} - ${f.away_score}` +
      (f.result_1x2 ? `  ·  Sonuç ${f.result_1x2} / KG ${f.result_btts === 'yes' ? 'Var' : 'Yok'}` : '') : '');
  title.style.fontSize = '17px';
  card.appendChild(title);

  const meta = el('p', 'muted admin-meta');
  const bits = [fmtKick(f.kickoff_at)];
  if (f.competition_label) bits.push(f.competition_label);
  if (f.settled_at) bits.push(`sonuç: ${fmtKick(f.settled_at)} (${f.settled_by === 'auto' ? 'otomatik' : f.settled_by === 'correction' ? 'düzeltme' : 'admin'})`);
  meta.textContent = bits.join(' · ');
  card.appendChild(meta);

  /* eylemler: yalnız AÇIK maçlarda */
  if (f.status === 'open') {
    const actions = el('div', 'row mt');

    // elle sonuç girişi
    const hIn = el('input', 'input'); hIn.type = 'number'; hIn.min = '0'; hIn.max = '99';
    hIn.placeholder = 'Ev'; hIn.style.width = '70px';
    const aIn = el('input', 'input'); aIn.type = 'number'; aIn.min = '0'; aIn.max = '99';
    aIn.placeholder = 'Dep'; aIn.style.width = '70px';
    const setBtn = el('button', 'btn small', 'Sonuç Gir');
    setBtn.type = 'button';
    setBtn.addEventListener('click', async () => {
      const h = Number(hIn.value); const a = Number(aIn.value);
      if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
        return toast('İki skor da 0-99 arası sayı olmalı.', true);
      }
      try {
        const r = await adminApi(`/api/admin/forecast/fixtures/${f.id}/settle`, {
          method: 'POST', body: JSON.stringify({ homeScore: h, awayScore: a })
        });
        toast(`Sonuç işlendi: ${r.predictions} tahmine ${r.awarded} puan dağıtıldı.`);
        loadMatchesTab();
      } catch (e) { toast(e.message, true); }
    });
    actions.appendChild(hIn);
    actions.appendChild(aIn);
    actions.appendChild(setBtn);

    // erteleme incelemesi: saat güncelle
    if (f.review_required) {
      const kIn = el('input', 'input');
      kIn.type = 'datetime-local'; kIn.style.width = '200px';
      kIn.title = 'Yeni başlama saati (Türkiye saati)';
      const kBtn = el('button', 'btn small', 'Saati Güncelle');
      kBtn.type = 'button';
      kBtn.addEventListener('click', async () => {
        if (!kIn.value) return toast('Yeni saati seç.', true);
        try {
          await adminApi(`/api/admin/forecast/fixtures/${f.id}/kickoff`, {
            method: 'POST', body: JSON.stringify({ kickoffAt: kIn.value })
          });
          toast('Başlama saati güncellendi, inceleme kapatıldı.');
          loadMatchesTab();
        } catch (e) { toast(e.message, true); }
      });
      actions.appendChild(kBtn);

      const rBtn = el('button', 'btn small ghost', 'İncelemeyi Kapat');
      rBtn.type = 'button';
      rBtn.addEventListener('click', async () => {
        try {
          await adminApi(`/api/admin/forecast/fixtures/${f.id}/resolve`, { method: 'POST', body: '{}' });
          toast('İnceleme bayrağı kapatıldı.');
          loadMatchesTab();
        } catch (e) { toast(e.message, true); }
      });
      actions.appendChild(rBtn);
    }

    const cBtn = el('button', 'btn small danger', 'İptal Et');
    cBtn.type = 'button';
    cBtn.addEventListener('click', async () => {
      try {
        await adminApi(`/api/admin/forecast/fixtures/${f.id}/cancel`, { method: 'POST', body: '{}' });
        toast('Maç iptal edildi (puan dağıtılmadı).');
        loadMatchesTab();
      } catch (e) { toast(e.message, true); }
    });
    actions.appendChild(cBtn);

    card.appendChild(actions);
  }

  return card;
}

/* elle maç ekleme */
async function addManualFixture() {
  const home = $('#mfHome').value.trim();
  const away = $('#mfAway').value.trim();
  const kickoff = $('#mfKickoff').value;
  const label = $('#mfLabel').value.trim();
  if (!home || !away || !kickoff) return toast('Ev sahibi, deplasman ve başlama saati zorunlu.', true);
  try {
    const r = await adminApi('/api/admin/forecast/fixtures', {
      method: 'POST', body: JSON.stringify({ homeTeam: home, awayTeam: away, kickoffAt: kickoff, competitionLabel: label })
    });
    toast(`Maç eklendi: ${r.home_team} — ${r.away_team} (#${r.id})`);
    $('#mfHome').value = ''; $('#mfAway').value = ''; $('#mfKickoff').value = ''; $('#mfLabel').value = '';
    loadForecastFixtures();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------- Spor Verisi (AŞAMA 10) ---------------- */

const JOB_TR = {
  fixtures: '📅 Fikstür', live_scores: '🔴 Canlı Skor', standings: '🥇 Puan Durumu',
  forecast: '🔮 Kâhin Sensin', correction: '🛠️ Düzeltme'
};
const RUN_TR = { success: '✅', partial: '🟡', failed: '❌', skipped: '⏭️' };
const UNMAPPED_TR = {
  status: 'durum', status_text: 'periyot metni', team_name: 'takım adı',
  incident_type: 'olay türü', stats_label: 'istatistik etiketi'
};
const fmtShort = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '—');

async function loadSportsTab() {
  await Promise.all([loadSportsOverview(), loadSyncRuns(), loadUnmapped(), loadCompetitions(), loadTeams('')]);
}

/** Genel tablo üretici: başlıklar + satır dizisi → .table-wrap içinde */
function buildTable(headers, rowsFn) {
  const wrap = el('div', 'table-wrap');
  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of headers) headRow.appendChild(el('th', null, h));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  rowsFn(tbody);
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

async function loadSportsOverview() {
  const box = $('#sportsOverview');
  box.innerHTML = '';
  try {
    const [ov, st] = await Promise.all([
      adminApi('/api/admin/sports/overview'),
      adminApi('/api/admin/sports/status')
    ]);

    /* istatistik kartları */
    const pct = ov.today.budget ? Math.round(100 * ov.today.usedToday / ov.today.budget) : 0;
    const grid = el('div', 'grid');
    const cards = [
      ['💵', `${ov.today.usedToday} / ${ov.today.effectiveLimit}`, `Bugünkü SportScore isteği (bütçe ${ov.today.budget}; ${pct}%)`],
      ['🪙', String(ov.today.remaining), 'Kalan etkin bütçe'],
      ['⚽', String(st.matches.total), `Maç kaydı (${st.matches.feedMissing} akışta yok)`],
      ['🧹', ov.retention.job.last_result
        ? `${ov.retention.job.last_result.deleted_sync_runs}+${ov.retention.job.last_result.deleted_match_details}`
        : 'henüz', `Retention son tur · sıradaki: ${fmtShort(ov.retention.job.next_run_at)}`]
    ];
    for (const [emoji, big, label] of cards) {
      const c = el('div', 'card stat');
      c.appendChild(el('b', null, `${emoji} ${big}`));
      c.appendChild(el('span', null, label));
      grid.appendChild(c);
    }
    box.appendChild(grid);

    /* işler ve kilitler */
    box.appendChild(el('h4', null, '🔒 Senkron İşleri ve Kira Kilitleri'));
    const jobs = ov.sync_state.length ? ov.sync_state : [];
    box.appendChild(buildTable(['İş', 'Kilit', 'Son Başarı', 'Art Arda Hata', 'Son Hata'], (tbody) => {
      if (!jobs.length) return tbody.appendChild(el('tr')).appendChild(el('td', 'empty', 'Kayıt yok'));
      for (const j of jobs) {
        const row = el('tr');
        row.appendChild(el('td', null, JOB_TR[j.job_name] || j.job_name));
        row.appendChild(el('td', null, j.locked ? `🔒 ${j.lock_seconds_left} sn` : 'serbest'));
        row.appendChild(el('td', null, fmtShort(j.last_success_at)));
        const cf = el('td', null, String(j.consecutive_failures ?? 0));
        if ((j.consecutive_failures ?? 0) >= 2) cf.className = 'pill red';
        row.appendChild(cf);
        const err = el('td', null, j.last_error ? String(j.last_error).slice(0, 80) : '—');
        row.appendChild(err);
        tbody.appendChild(row);
      }
    }));

    /* 7 gün döküm + bugün uç bazında */
    const twoCols = el('div', 'row');
    twoCols.style.alignItems = 'flex-start';
    twoCols.style.gap = '18px';
    twoCols.style.flexWrap = 'wrap';

    const usageWrap = el('div');
    usageWrap.style.flex = '1';
    usageWrap.style.minWidth = '240px';
    usageWrap.appendChild(el('h4', null, '📈 Son 7 Gün İstek Dökümü (UTC gün)'));
    usageWrap.appendChild(buildTable(['Gün', 'İstek'], (tbody) => {
      if (!ov.usage_7d.length) return tbody.appendChild(el('tr')).appendChild(el('td', 'empty', 'Kayıt yok'));
      for (const u of ov.usage_7d) {
        const row = el('tr');
        row.appendChild(el('td', null, u.day_utc));
        row.appendChild(el('td', null, String(u.total)));
        tbody.appendChild(row);
      }
    }));
    twoCols.appendChild(usageWrap);

    const epWrap = el('div');
    epWrap.style.flex = '1';
    epWrap.style.minWidth = '240px';
    epWrap.appendChild(el('h4', null, '🎯 Bugün Uç Bazında'));
    const chips = el('div', 'chips');
    if (!st.today.byEndpoint.length) chips.appendChild(el('span', 'chip', 'bugün istek yok'));
    for (const e of st.today.byEndpoint) {
      chips.appendChild(el('span', 'chip', `${e.endpoint}: ${e.count}`));
    }
    epWrap.appendChild(chips);
    epWrap.appendChild(el('p', 'muted tiny', `Retention politikası: sync_runs ${ov.retention.stats.policy.sync_runs_days} gün, match_details ${ov.retention.stats.policy.match_details_days} gün. Tablo: ${ov.retention.stats.sync_runs.c} koşu · ${ov.retention.stats.match_details.c} detay · ${ov.retention.stats.api_usage.c} kullanım satırı.`));
    twoCols.appendChild(epWrap);
    box.appendChild(twoCols);
  } catch (e) {
    box.appendChild(el('div', 'empty', e.message));
  }
}

async function loadSyncRuns() {
  const box = $('#syncRunsBox');
  box.innerHTML = '';
  try {
    const d = await adminApi('/api/admin/sports/status');
    const runs = d.sync_runs || [];
    if (!runs.length) {
      box.appendChild(el('div', 'empty', 'Henüz senkron koşusu yok.'));
      return;
    }
    box.appendChild(buildTable(['Zaman', 'İş', 'Durum', 'İstek', 'Görülen/Yazılan/Atlanan', 'Hata'], (tbody) => {
      for (const r of runs) {
        const row = el('tr');
        row.appendChild(el('td', null, fmtShort(r.started_at)));
        row.appendChild(el('td', null, JOB_TR[r.job_name] || r.job_name));
        row.appendChild(el('td', null, `${RUN_TR[r.status] || ''} ${r.status}`));
        row.appendChild(el('td', null, String(r.requests_made)));
        row.appendChild(el('td', null, `${r.records_seen} / ${r.records_upserted} / ${r.records_skipped}`));
        row.appendChild(el('td', null, r.error_message ? String(r.error_message).slice(0, 60) : '—'));
        tbody.appendChild(row);
      }
    }));
  } catch (e) {
    box.appendChild(el('div', 'empty', e.message));
  }
}

async function loadUnmapped() {
  const box = $('#unmappedBox');
  box.innerHTML = '';
  try {
    const d = await adminApi('/api/admin/sports/status');
    const u = d.unmapped_values || {};
    const summary = u.summary || [];
    const recent = u.recent || [];
    const chips = el('div', 'chips');
    if (!summary.length) {
      chips.appendChild(el('span', 'chip', 'Eşleşmeyen değer yok — temiz! 🎉'));
      box.appendChild(chips);
      return;
    }
    for (const s of summary) {
      chips.appendChild(el('span', 'chip', `${UNMAPPED_TR[s.kind] || s.kind}: ${s.cesit} çeşit / ${s.toplam_hit} hit`));
    }
    box.appendChild(chips);
    if (recent.length) {
      box.appendChild(buildTable(['Tür', 'Değer', 'Branş', 'Hit', 'Son Görülme'], (tbody) => {
        for (const r of recent) {
          const row = el('tr');
          row.appendChild(el('td', null, UNMAPPED_TR[r.kind] || r.kind));
          row.appendChild(el('td', null, String(r.raw_value).slice(0, 50)));
          row.appendChild(el('td', null, r.sport || '—'));
          row.appendChild(el('td', null, String(r.hits)));
          row.appendChild(el('td', null, fmtShort(r.seen_at)));
          tbody.appendChild(row);
        }
      }));
    }
  } catch (e) {
    box.appendChild(el('div', 'empty', e.message));
  }
}

async function loadCompetitions() {
  const box = $('#competitionsBox');
  box.innerHTML = '';
  try {
    const d = await adminApi('/api/admin/sports/competitions');
    const comps = d.competitions || [];
    box.appendChild(buildTable(['Lig', 'Slug', 'Branş', 'Durum', 'Maç', 'Puan Durumu Satırı', 'Son Yazım', 'Eylem'], (tbody) => {
      for (const c of comps) {
        const row = el('tr');
        row.appendChild(el('td', null, c.name));
        row.appendChild(el('td', null, c.slug));
        row.appendChild(el('td', null, c.sport === 'football' ? '⚽' : '🏀'));
        const badges = el('td');
        const b1 = el('span', 'pill ' + (c.is_enabled ? '' : 'red'), c.is_enabled ? 'AÇIK' : 'KAPALI');
        const b2 = el('span', 'pill ' + (c.slug_status === 'candidate' ? 'yellow' : ''),
          c.slug_status === 'candidate' ? 'ADAY' : 'AKTİF');
        badges.appendChild(b1);
        badges.appendChild(document.createTextNode(' '));
        badges.appendChild(b2);
        row.appendChild(badges);
        row.appendChild(el('td', null, String(c.match_count)));
        row.appendChild(el('td', null, String(c.standings_rows)));
        row.appendChild(el('td', null, fmtShort(c.last_match_write)));
        const act = el('td');
        const toggle = el('button', 'btn small ' + (c.is_enabled ? 'ghost' : ''),
          c.is_enabled ? 'Kapat' : 'Aç');
        toggle.type = 'button';
        toggle.addEventListener('click', () => toggleCompetition(c, c.is_enabled ? 0 : 1));
        act.appendChild(toggle);
        if (c.slug_status === 'candidate' && c.is_enabled) {
          const verify = el('button', 'btn small', 'Doğrula');
          verify.type = 'button';
          verify.addEventListener('click', () => verifyCompetition(c));
          act.appendChild(document.createTextNode(' '));
          act.appendChild(verify);
        }
        if (c.slug_status === 'candidate' && !c.match_count) {
          const del = el('button', 'btn small danger', 'Sil');
          del.type = 'button';
          del.addEventListener('click', () => deleteCompetition(c));
          act.appendChild(document.createTextNode(' '));
          act.appendChild(del);
        }
        row.appendChild(act);
        tbody.appendChild(row);
      }
    }));
  } catch (e) {
    box.appendChild(el('div', 'empty', e.message));
  }
}

async function toggleCompetition(c, isEnabled) {
  try {
    await adminApi(`/api/admin/sports/competitions/${c.id}`, {
      method: 'POST', body: JSON.stringify({ is_enabled: isEnabled })
    });
    toast(isEnabled ? `${c.name} açıldı; bir sonraki turda senkronlanacak.` : `${c.name} kapatıldı; artık senkronlanmaz.`);
    loadCompetitions();
  } catch (e) { toast(e.message, true); }
}

async function verifyCompetition(c) {
  try {
    await adminApi(`/api/admin/sports/competitions/${c.id}`, {
      method: 'POST', body: JSON.stringify({ slug_status: 'active' })
    });
    toast(`${c.name} doğrulandı (AKTİF).`);
    loadCompetitions();
  } catch (e) { toast(e.message, true); }
}

async function deleteCompetition(c) {
  try {
    await adminApi(`/api/admin/sports/competitions/${c.id}`, { method: 'DELETE' });
    toast(`Aday lig silindi: ${c.slug}`);
    loadCompetitions();
  } catch (e) { toast(e.message, true); }
}

async function addCandidateLeague() {
  const slug = $('#ncSlug').value.trim();
  const name = $('#ncName').value.trim();
  const sport = $('#ncSport').value;
  if (!slug || !name) return toast('Slug ve görünen ad zorunlu.', true);
  try {
    await adminApi('/api/admin/sports/competitions', {
      method: 'POST', body: JSON.stringify({ slug, sport, name })
    });
    toast(`Aday lig eklendi: ${slug} — KAPALI başladı.`);
    $('#ncSlug').value = ''; $('#ncName').value = '';
    loadCompetitions();
  } catch (e) { toast(e.message, true); }
}

async function loadTeams(q) {
  const box = $('#teamsBox');
  box.innerHTML = '';
  try {
    const d = await adminApi(`/api/admin/sports/teams${q ? `?q=${encodeURIComponent(q)}` : ''}`);

    const umBox = $('#unmappedTeamsBox');
    umBox.innerHTML = '';
    const chips = el('div', 'chips');
    const unmapped = d.unmapped_team_names || [];
    if (unmapped.length) {
      chips.appendChild(el('span', 'muted tiny', 'Feed’de görülen yeni adlar:'));
      for (const u of unmapped.slice(0, 12)) {
        chips.appendChild(el('span', 'chip', `${u.raw_value} (${u.hits}×)`));
      }
    }
    umBox.appendChild(chips);

    const teams = d.teams || [];
    if (!teams.length) {
      box.appendChild(el('div', 'empty', q ? 'Aramayla eşleşen takım yok.' : 'Henüz takım kaydı yok.'));
      return;
    }
    box.appendChild(buildTable(['Feed Adı', 'Görünen Ad', 'Maç', 'Kaydet'], (tbody) => {
      for (const t of teams) {
        const row = el('tr');
        row.appendChild(el('td', null, t.name));
        const inputCell = el('td');
        const input = el('input', 'input');
        input.type = 'text';
        input.maxLength = 40;
        input.value = t.display_name || '';
        input.placeholder = t.name;
        input.style.minWidth = '160px';
        inputCell.appendChild(input);
        row.appendChild(inputCell);
        row.appendChild(el('td', null, String(t.match_count)));
        const act = el('td');
        const save = el('button', 'btn small', 'Kaydet');
        save.type = 'button';
        save.addEventListener('click', async () => {
          try {
            await adminApi(`/api/admin/sports/teams/${t.id}/display-name`, {
              method: 'POST', body: JSON.stringify({ displayName: input.value })
            });
            toast(input.value ? `Görünen ad kaydedildi: ${input.value}` : 'Görünen ad temizlendi (feed adına dönüldü).');
            loadTeams(q);
          } catch (e) { toast(e.message, true); }
        });
        act.appendChild(save);
        row.appendChild(act);
        tbody.appendChild(row);
      }
    }));
  } catch (e) {
    box.appendChild(el('div', 'empty', e.message));
  }
}

async function manualSync(kind) {
  const paths = {
    fixtures: '/api/admin/sports/sync/fixtures',
    live: '/api/admin/sports/sync/live',
    standings: '/api/admin/sports/sync/standings'
  };
  try {
    const r = await adminApi(paths[kind], { method: 'POST', body: '{}' });
    toast(r.note || 'Arka planda başladı.');
    setTimeout(loadSportsTab, 1500);
  } catch (e) { toast(e.message, true); }
}

/* ---------------- yükleme & olaylar ---------------- */
async function refreshAll() {
  try {
    await renderStats();
    if (!$('#tab-reports').hidden) await loadReports();
    if (!$('#tab-content').hidden) await loadContent();
  } catch (e) {
    showKeyCard(e.message);
  }
}

function showKeyCard(err) {
  $('#panel').hidden = true;
  $('#keyCard').hidden = false;
  if (err) toast(err, true);
}

$('#saveKey').addEventListener('click', async () => {
  const v = $('#adminKey').value.trim();
  if (!v) return toast('Önce anahtarı gir.', true);
  adminKey = v; // yalnızca bellekte
  try {
    await renderStats();
    $('#keyCard').hidden = true;
    $('#panel').hidden = false;
    toast('Admin girişi başarılı. Kolları sıva! 🛠️');
  } catch (e) {
    adminKey = '';
    showKeyCard(e.message);
  }
});

$('#adminKey').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#saveKey').click();
});

document.querySelectorAll('#adminTabs .tab').forEach((t) => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});

$('#mfAdd').addEventListener('click', addManualFixture);
['#mfHome', '#mfAway', '#mfKickoff', '#mfLabel'].forEach((sel) => {
  $(sel).addEventListener('keydown', (e) => { if (e.key === 'Enter') addManualFixture(); });
});

/* AŞAMA 10: Spor Verisi olayları */
$('#syncFixturesBtn').addEventListener('click', () => manualSync('fixtures'));
$('#syncLiveBtn').addEventListener('click', () => manualSync('live'));
$('#syncStandingsBtn').addEventListener('click', () => manualSync('standings'));
$('#ncAdd').addEventListener('click', addCandidateLeague);
$('#teamSearchBtn').addEventListener('click', () => loadTeams($('#teamSearch').value.trim()));
$('#teamSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadTeams($('#teamSearch').value.trim());
});
