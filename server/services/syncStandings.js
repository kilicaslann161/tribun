/**
 * Tribün — puan durumu senkronu (AŞAMA 7) — server/services/syncStandings.js
 *
 * MODEL: her istek TEK bir lig içindir:
 *   GET /api/widget/standings/?sport=football&slug=<lig slug'ı>
 * (futbol 200; basketbol 404 "No standings data" → yalnızca futbol ligleri).
 * Bütçe: DÜŞÜK öncelik — sportScoreClient.spend %70+ red yoluyla; bütçe
 * %70'i aştıysa istek ATILMAZ (api_usage artmaz).
 *
 * KORUMA KURALLARI (talimat):
 *   1. Boş yanıt (tables yok / satır 0) → güncelleme RED, eski veri KORUNUR.
 *   2. Yeni satır sayısı < önceki satır sayısının %50'si → RED, eski veri
 *      korunur (yarım yanıt / kesilme şüphesi).
 *   3. Bir ligin satırları TEK transaction'da değiştirilir (DELETE+INSERT);
 *      doğrulama hatası transaction'ı hiç açmaz.
 *   4. Takım adları name_key (matchNormalizer.nameKey — maç senkronuyla AYNI
 *      kural) üzerinden teams'e eşleştirilir; eşleşmeyen ad
 *      unmapped_values('team_name')'e yazılır, team_id NULL kalır.
 *      Puan durumundan YENİ teams satırı AÇILMAZ (spec: takım sayfası yok).
 *   5. Yanıt competition_slug'ı istenen slug'dan farklıysa meta'ya UYARI
 *      yazılır (fikstür apiNameMismatch kuralıyla aynı yaklaşım).
 *   6. Kira kilidi (sync_state, job_name='standings') + sync_runs günlüğü;
 *      istekler arasında ≥ 1 sn (peş peşe yağdırma yok).
 *   7. Bütçe redleri (BudgetError, istek atılmadan) 'skipped' sayılır —
 *      devre kesici (429 sonrası) ve ağ hatası gerçek istek denemesidir.
 *
 * TEST EDİLEBİLİRLİK: SAF kararlar (yanıt doğrulama + due türetimi)
 * services/standingsCore.js'tedir (db singleton'u YOK — bellek-içi testler
 * orayı sınar; bkz. tests/syncStandings.test.js). Bu dosya db singleton'u
 * kullanan YAN ETKİLİ orkestratördür (syncFixtures ile aynı ayrım) —
 * gerçek yazma yolu canlı doğrulamayla (admin tetikleme + API yanıtları)
 * kanıtlanır.
 */
const db = require('../db');
const { fetchStandings, BudgetError, CircuitOpenError } = require('./sportScoreClient');
const { nameKey } = require('./matchNormalizer');
const { recordUnmapped } = require('./unmappedStore');
const {
  BASELINE_MS,
  FINISHED_COOLDOWN_MS,
  normalizeStandingsResponse
} = require('./standingsCore');

const JOB = 'standings';
const LEASE_MS = 10 * 60 * 1000;      // çöken süreçten 10 dk sonra kira düşer
const REQUEST_GAP_MS = 1000;          // istekler arası asgari bekleme

const nowIso = () => new Date().toISOString();

/* ---------------- kira kilidi (sync_state) ---------------- */

function acquireLease(jobName) {
  const now = Date.now();
  const row = db.prepare('SELECT locked_until FROM sync_state WHERE job_name = ?').get(jobName);
  if (row && row.locked_until && new Date(row.locked_until).getTime() > now) return false;
  const lockedBy = `pid${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO sync_state (job_name, locked_until, locked_by, last_run_at, consecutive_failures)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(job_name) DO UPDATE SET locked_until = excluded.locked_until,
                                         locked_by  = excluded.locked_by,
                                         last_run_at = excluded.last_run_at
  `).run(jobName, new Date(now + LEASE_MS).toISOString(), lockedBy, nowIso());
  return true;
}

function releaseLease(jobName) {
  db.prepare('UPDATE sync_state SET locked_until = NULL WHERE job_name = ?').run(jobName);
}

/* ---------------- takım eşleştirme (name_key; transaction içi) ---------------- */

/** teams satırı VARSA id'si; yoksa null + unmapped kaydı (txState'e toplanır) */
function matchTeamId(txState, teamName, sport) {
  const key = nameKey(teamName);
  if (!key) return null;
  if (txState.teamCache.has(key)) return txState.teamCache.get(key);
  const row = db.prepare(
    "SELECT id FROM teams WHERE provider = 'sportscore' AND external_id = ? AND sport = ?"
  ).get(key, sport);
  if (row) {
    txState.teamCache.set(key, row.id);
    return row.id;
  }
  // eşleşmeyen ad: aynı koşu içinde bir kez unmapped'e yazılır
  if (!txState.unmatchedNames.has(key)) {
    txState.unmatchedNames.add(key);
    txState.unmapped.push({ kind: 'team_name', rawValue: teamName, sport });
  }
  txState.teamCache.set(key, null); // olumsuz sonuç da önbelleklenir
  return null;
}

/* ---------------- sync_runs / sync_state yazıcıları ---------------- */

const insertRunStmt = db.prepare(`
  INSERT INTO sync_runs (job_name, started_at, finished_at, status,
                         requests_made, records_seen, records_upserted, records_skipped,
                         error_message, meta)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stateOk = db.prepare(
  'UPDATE sync_state SET last_success_at = ?, last_error = NULL, consecutive_failures = 0 WHERE job_name = ?'
);
const stateFail = db.prepare(
  'UPDATE sync_state SET last_error = ?, consecutive_failures = consecutive_failures + 1 WHERE job_name = ?'
);

function insertRunRow(status, requests, seen, written, error, meta, startedAt) {
  insertRunStmt.run(JOB, startedAt, nowIso(), status, requests, seen, written,
    Math.max(0, seen - written), error, JSON.stringify(meta));
}

/* ---------------- tek lig senkronu ---------------- */

/**
 * Tek ligin puan durumunu çeker ve (korumalar geçerse) yazar.
 * Yazma TEK transaction'da: DELETE (o lig) + INSERT (yeni satırlar) +
 * unmapped_values + sync_runs satırı (status koşullu).
 *
 * @returns {Promise<{slug, result, requests, seen, written, prev, reason}>}
 *   result: 'updated' | 'rejected_empty' | 'rejected_shrink' | 'invalid' |
 *           'error' | 'budget' | 'circuit'
 */
async function syncCompetitionStandings(comp, opts) {
  const fetcher = opts.fetcher || fetchStandings;
  const out = {
    slug: comp.slug, result: 'error', requests: 0,
    seen: 0, written: 0, prev: 0, reason: null
  };

  /* mevcut satır sayısı (%50 kuralı için; transaction DIŞINDA okunur) */
  out.prev = db.prepare(
    'SELECT COUNT(*) AS c FROM standings WHERE competition_id = ?'
  ).get(comp.id).c;

  let payload;
  try {
    const res = await fetcher({ sport: comp.sport, competition: comp.slug });
    out.requests = 1;
    payload = res;
  } catch (e) {
    if (e instanceof BudgetError) { out.result = 'budget'; out.reason = e.message; return out; }
    if (e instanceof CircuitOpenError) { out.result = 'circuit'; out.reason = e.message; return out; }
    out.requests = 1; // ağ/zaman aşımı/HTTP — gerçek deneme
    out.reason = String(e.message).slice(0, 200);
    return out;
  }

  const norm = normalizeStandingsResponse(payload && payload.json);
  if (!norm.ok) { out.result = 'invalid'; out.reason = norm.error; return out; }
  const data = norm.value;

  const totalRows = data.groups.reduce((n, g) => n + g.rows.length, 0);
  out.seen = totalRows;

  /* kural 1: boş yanıt → RED (normalize zaten yakalar; savunma) */
  if (totalRows === 0) { out.result = 'rejected_empty'; out.reason = 'boş yanıt'; return out; }

  /* kural 2: %50 altına düşüş → RED, eski veri korunur */
  if (out.prev > 0 && totalRows < out.prev * 0.5) {
    out.result = 'rejected_shrink';
    out.reason = `satır ${out.prev} → ${totalRows} (%50 eşiği altı); eski veri korundu`;
    return out;
  }

  const startedAt = nowIso();
  const warnings = [...data.warnings];
  if (data.slug && data.slug !== comp.slug) {
    warnings.push(`yanıt competition_slug=${data.slug} ≠ istenen ${comp.slug}`);
  }

  /* kural 3: TEK transaction */
  try {
    const tx = db.transaction(() => {
      const txState = { teamCache: new Map(), unmatchedNames: new Set(), unmapped: [] };
      db.prepare('DELETE FROM standings WHERE competition_id = ?').run(comp.id);
      const ins = db.prepare(`
        INSERT INTO standings
          (competition_id, group_name, position, team_id, team_name, team_logo,
           played, won, drawn, lost, goals_for, goals_against, goal_diff,
           points, win_pct, promo_color, promo_name, row_extra, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const stamp = nowIso();
      for (const g of data.groups) {
        for (const r of g.rows) {
          const teamId = matchTeamId(txState, r.teamName, comp.sport);
          ins.run(
            comp.id, g.group, r.position, teamId, r.teamName, r.teamLogo,
            r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.goalDiff,
            r.points, r.winPct, r.promoColor, r.promoName, r.rowExtra, stamp
          );
          out.written++;
        }
      }
      if (txState.unmapped.length) recordUnmapped(txState.unmapped, comp.sport);
      insertRunRow('success', out.requests, out.seen, out.written, null, {
        phase: 'single', competition: comp.slug, prev: out.prev,
        groups: data.groups.length, unmatched: txState.unmapped.length,
        warnings
      }, startedAt);
    });
    tx();
    out.result = 'updated';
  } catch (e) {
    try {
      insertRunRow('failed', out.requests, out.seen, 0, String(e.message).slice(0, 300),
        { phase: 'single', competition: comp.slug, note: 'yazma fazı hatası; eski veri korunur' }, startedAt);
    } catch { /* son çare */ }
    out.reason = String(e.message).slice(0, 200);
    out.result = 'error';
  }
  return out;
}

/* ---------------- tur (tümü ya da seçili ligler) ---------------- */

/**
 * Puan durumu turu.
 * @param {{competitions?:string[], fetcher?:Function, phase?:string,
 *          quietSkipped?:boolean}} opts
 *   competitions: verilirse yalnız bu lig slug'ları (admin tetikleme);
 *   fetcher: test enjeksiyonu; phase: meta'ya yazılır ('timer'|'manual').
 * @returns {Promise<{status:'success'|'partial'|'failed'|'skipped',
 *   requests:number, updated:number, comps:object[]}>}
 */
async function syncStandingsRound(opts = {}) {
  const phase = opts.phase || 'manual';
  const startedAt = nowIso();

  /* futbol ligleri taze okunur (basketbol puan durumu DOĞRULANMADI) */
  let comps = db.prepare(
    "SELECT id, slug, sport, name FROM competitions WHERE is_enabled = 1 AND sport = 'football' ORDER BY sort_order"
  ).all();
  if (Array.isArray(opts.competitions) && opts.competitions.length) {
    const want = new Set(opts.competitions);
    comps = comps.filter((c) => want.has(c.slug));
    if (!comps.length) {
      return { status: 'failed', requests: 0, updated: 0, comps: [],
               error: 'Seçili lig(ler) bulunamadı ya da futbol değil' };
    }
  }

  if (!comps.length) {
    return { status: 'skipped', requests: 0, updated: 0, comps: [], reason: 'futbol ligi yok' };
  }

  /* kira kilidi: tur boyunca (tek iş — paralel tur yok) */
  if (!acquireLease(JOB)) {
    if (!opts.quietSkipped) {
      insertRunRow('skipped', 0, 0, 0, 'kilitli (lease) — başka bir puan durumu turu koşuyor',
        { phase }, startedAt);
    }
    return { status: 'skipped', requests: 0, updated: 0, comps: [], reason: 'lease meşgul' };
  }

  const results = [];
  let requests = 0;
  try {
    for (let i = 0; i < comps.length; i++) {
      const r = await syncCompetitionStandings(comps[i], opts);
      requests += r.requests;
      results.push(r);
      if (i < comps.length - 1) {
        await new Promise((res) => setTimeout(res, REQUEST_GAP_MS)); // kural 6
      }
    }
  } finally {
    releaseLease(JOB);
  }

  const updated = results.filter((r) => r.result === 'updated');
  const hardErrors = results.filter((r) => r.result === 'error' || r.result === 'invalid');
  const budgetStops = results.filter((r) => r.result === 'budget' || r.result === 'circuit');
  const rejected = results.filter((r) => r.result.startsWith('rejected'));

  let status;
  if (updated.length && updated.length === results.length) status = 'success';
  else if (updated.length) status = 'partial';
  else if (hardErrors.length) status = 'failed';
  else status = 'skipped'; // tamamen bütçe/devre/koruma redleri

  const firstReason = (hardErrors[0] || budgetStops[0] || rejected[0] || {}).reason || null;
  const meta = {
    phase,
    comps: results.map(({ slug, result, seen, written, prev, reason }) =>
      ({ slug, result, seen, written, prev, ...(reason ? { reason: String(reason).slice(0, 160) } : {}) })),
    note: budgetStops.length
      ? 'bütçe düşük öncelik reddi: istek ATILMADI (api_usage artmaz)' : undefined
  };
  insertRunRow(status, requests,
    results.reduce((n, r) => n + r.seen, 0),
    results.reduce((n, r) => n + r.written, 0),
    status === 'failed' ? firstReason : null, meta, startedAt);

  if (updated.length) stateOk.run(nowIso(), JOB);
  else if (status === 'failed') stateFail.run(firstReason, JOB);

  return { status, requests, updated: updated.length, comps: results };
}

module.exports = {
  JOB,
  BASELINE_MS,
  FINISHED_COOLDOWN_MS,
  syncStandingsRound,
  // çekirdekten yeniden ihraç: iş/admin çağıranları tek modülden alsın
  getStandingsDue: require('./standingsCore').getStandingsDue,
  normalizeStandingsResponse
};
