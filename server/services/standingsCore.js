/**
 * Tribün — puan durumu SAF karar çekirdeği (AŞAMA 7)
 * =====================================================
 * Bu modül db singleton'unu REQUIRE ETMEZ (test edilebilirlik + Node 24
 * better-sqlite3 process-exit çökmesi: bkz. tests/syncLive.test.js başlığı).
 * Yan etkili senkron (istek, kira, transaction) services/syncStandings.js'te;
 * burada yalnız SAF, db-PARAMETRELİ kararlar var:
 *
 *   normalizeStandingsResponse — widget/standings yanıtını doğrular/normalize eder
 *   getStandingsDue(dbConn)    — zamanlayıcı "şimdi senkronlanmalı mı?" kararı
 *
 * Doğrulanmış yanıt biçimi (24.10.2026; kullanıcı örneği + canlı test):
 *   { sport, competition, competition_logo, competition_slug,
 *     tables: [ { group: "", rows: [ { pos, team, team_logo, team_slug,
 *       team_url, p, w, d, l, gf, ga, gd, pts, promo_color, promo_name } ] } ] }
 */

const BASELINE_MS = 8 * 3600 * 1000;              // günde 3 kez taban tur
const FINISHED_COOLDOWN_MS = 15 * 60 * 1000;      // finished tetikleyici hız sınırı

/* ---------------- skalar yardımcılar ---------------- */

/** Sayı ya da null; kesirli geliyorsa tam sayıya yuvarla (geçerlilik) */
function intOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function realOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const KNOWN_ROW_KEYS = new Set([
  'pos', 'team', 'team_logo', 'team_slug', 'team_url',
  'p', 'w', 'd', 'l', 'gf', 'ga', 'gd', 'pts', 'win_pct',
  'promo_color', 'promo_name'
]);

/* ---------------- yanıt doğrulama (SAF) ---------------- */

/**
 * Doğrulanmış widget/standings yanıtını normalize eder.
 * Kurallar: satırda pozitif pos + dolu takım adı ŞART; geçersiz satır yutulur;
 * aynı (grup, takım) kopyası atılır (ilki alınır); bilinmeyen ek alanlar
 * row_extra'ya JSON olarak taşınır; sport ≠ football ve slug uyuşmazlığı
 * UYARI olarak döner (veri yine işlenir — fikstür apiNameMismatch kuralı).
 *
 * @returns {{ok:true, value:{groups, slug, sport, warnings}}
 *          |{ok:false, error:string}}  — groups boşsa HATA (boş puan durumu)
 */
function normalizeStandingsResponse(json) {
  if (!json || typeof json !== 'object') return { ok: false, error: 'yanıt bir JSON nesnesi değil' };
  const warnings = [];
  if (json.sport !== undefined && json.sport !== 'football') {
    warnings.push(`yanıt sport=${JSON.stringify(json.sport)} (futbol bekleniyordu)`);
  }
  if (!Array.isArray(json.tables)) return { ok: false, error: 'tables dizisi yok' };

  const groups = [];
  const seenNames = new Set(); // (group, team-ad) — aynı yanıtta kopyaya izin yok
  const duplicates = [];
  for (const t of json.tables) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.rows)) {
      return { ok: false, error: 'tables[].rows dizisi eksik ya da bozuk' };
    }
    const groupName = String(t.group ?? '').trim();
    const rows = [];
    for (const raw of t.rows) {
      if (!raw || typeof raw !== 'object') continue; // boş satırlar yut
      const team = String(raw.team ?? '').trim();
      const pos = intOrNull(raw.pos);
      if (!team || pos === null || pos < 1) continue; // geçersiz satır yutulur
      const key = groupName + '\u0000' + team.toLocaleLowerCase('tr');
      if (seenNames.has(key)) { duplicates.push({ group: groupName, team }); continue; }
      seenNames.add(key);

      // bilinmeyen ek alanlar row_extra'ya (ileri uyum; okuma ucunda gösterilmez)
      const extra = {};
      for (const k of Object.keys(raw)) {
        if (!KNOWN_ROW_KEYS.has(k)) extra[k] = raw[k];
      }

      rows.push({
        position: pos,
        teamName: team,
        teamLogo: typeof raw.team_logo === 'string' && raw.team_logo ? raw.team_logo : null,
        played: intOrNull(raw.p),
        won: intOrNull(raw.w),
        drawn: intOrNull(raw.d),
        lost: intOrNull(raw.l),
        goalsFor: intOrNull(raw.gf),
        goalsAgainst: intOrNull(raw.ga),
        goalDiff: intOrNull(raw.gd),
        points: intOrNull(raw.pts),
        winPct: realOrNull(raw.win_pct),
        promoColor: typeof raw.promo_color === 'string' ? raw.promo_color.trim() : '',
        promoName: typeof raw.promo_name === 'string' ? raw.promo_name.trim() : '',
        rowExtra: Object.keys(extra).length ? JSON.stringify(extra) : null
      });
    }
    if (rows.length) groups.push({ group: groupName, rows });
  }
  if (duplicates.length) {
    warnings.push(`${duplicates.length} kopya satır atlandı (ilk görülen alındı)`);
  }
  if (!groups.length) return { ok: false, error: 'yanıtta geçerli satır yok (boş puan durumu)' };
  return {
    ok: true,
    value: {
      groups,
      slug: typeof json.competition_slug === 'string' ? json.competition_slug : null,
      sport: typeof json.sport === 'string' ? json.sport : null,
      warnings
    }
  };
}

/* ---------------- due türetimi (SAF; yalnız DB okur) ---------------- */

/**
 * Zamanlayıcının "şimdi senkronlanmalı mı?" kararı — istek YOK, DB'den türetilir:
 *   - hiç senkronlanmadıysa        → due, reason 'first_sync'
 *   - son senkron 8 saat+ eskiyse  → due, reason 'baseline' (günde ~3 kez)
 *   - ligin bir maçı finished'a GEÇTİYSE (MAX(finished_at) > son puan durumu
 *     yazımı) VE son senkron 15 dk+ eskiyse → due, reason 'match_finished'
 * Yalnız is_enabled=1 FUTBOL ligleri listelenir (basketbol ucu doğrulanmadı).
 *
 * @param {object} dbConn better-sqlite3 bağlantısı (test edilebilirlik)
 * @param {number} nowMs
 */
function getStandingsDue(dbConn, nowMs) {
  const comps = dbConn.prepare(
    "SELECT id, slug FROM competitions WHERE is_enabled = 1 AND sport = 'football' ORDER BY sort_order"
  ).all();

  const lastFinishedStmt = dbConn.prepare(
    "SELECT MAX(finished_at) AS f FROM matches WHERE competition_id = ? AND status = 'finished'"
  );
  const lastSyncStmt = dbConn.prepare(
    'SELECT MAX(updated_at) AS s FROM standings WHERE competition_id = ?'
  );

  return {
    comps: comps.map((c) => {
      const fin = lastFinishedStmt.get(c.id).f || null;
      const sync = lastSyncStmt.get(c.id).s || null;
      const syncMs = sync ? Date.parse(sync) : null;

      let due = true;
      let reason = 'first_sync';
      if (syncMs !== null) {
        const sinceSync = nowMs - syncMs;
        if (sinceSync >= BASELINE_MS) { due = true; reason = 'baseline'; }
        else if (fin && Date.parse(fin) > syncMs && sinceSync >= FINISHED_COOLDOWN_MS) {
          due = true; reason = 'match_finished';
        } else { due = false; reason = null; }
      }
      return { slug: c.slug, lastSyncAt: sync, lastFinishedAt: fin, due, reason };
    })
  };
}

module.exports = {
  BASELINE_MS,
  FINISHED_COOLDOWN_MS,
  normalizeStandingsResponse,
  getStandingsDue
};
