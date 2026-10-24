/**
 * Migration 007 — AŞAMA 9 (Kâhin Sensin entegrasyonu)
 *
 *  a) fixtures — Kâhin Sensin maçları. Elle giriş ile senkron aktarım AYNI
 *     şemayı kullanır (talimat: mevcut elle giriş akışı aynen çalışmaya devam
 *     edecek). kickoff_at UTC ISO'dur (matches.kickoff_utc ile karşılaştırılabilir).
 *     review_required/review_reason: ertelenme/iptal/feed_missing durumlarında
 *     admin "İnceleme gerekli" işareti (otomatik iptal YOK — talimat 5).
 *  b) predictions — kullanıcı tahminleri (1/X/2 + karşılıklı gol; futbola göre).
 *     Puan tahmin anında DEĞİL, sonuç kesinleşince dağıtılır (points_awarded).
 *     award_detail: düzeltme senaryosunda eski ödülün geri alınabilmesi için
 *     ödeme küpürü (scores satır id'si + tutar).
 *  c) forecast_match_links — senkron maçı ↔ fixture bağı (talimattaki tablo:
 *     match_id UNIQUE, fixture_id UNIQUE, created_at). Ek gözlem kolonları
 *     otomatik sonuçlandırma kuralının durumunu taşır (talimat 4: "finished
 *     ilk görüldükten 30 dk sonra + son İKİ senkronda skor aynı"):
 *     last_observed_at  → son gözlemde maç satırının fetched_at değeri; yeni
 *                         senkron bunu ilerletmediyse yeni gözlem YOKTUR
 *                         (aynı DB durumunu iki kez sayma hilesi yapılamaz)
 *     last_home/away    → son gözlenen skor
 *     stable_count      → ardışık aynı skor gözlemi sayısı (≥2 → kararlı)
 */
module.exports = {
  version: 7,
  name: 'forecast_kahin_sensin',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fixtures (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        home_team         TEXT    NOT NULL,
        away_team         TEXT    NOT NULL,
        kickoff_at        TEXT    NOT NULL,
        competition_label TEXT,
        status            TEXT    NOT NULL DEFAULT 'open'
                          CHECK(status IN ('open', 'finished', 'cancelled')),
        home_score        INTEGER,
        away_score        INTEGER,
        result_1x2        TEXT    CHECK(result_1x2 IS NULL OR result_1x2 IN ('1', 'X', '2')),
        result_btts       TEXT    CHECK(result_btts IS NULL OR result_btts IN ('yes', 'no')),
        review_required   INTEGER NOT NULL DEFAULT 0,
        review_reason     TEXT,
        settled_at        TEXT,
        settled_by        TEXT,
        created_at        TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fixtures_status_kickoff ON fixtures(status, kickoff_at);

      CREATE TABLE IF NOT EXISTS predictions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        fixture_id     INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pick_1x2       TEXT    NOT NULL CHECK(pick_1x2 IN ('1', 'X', '2')),
        pick_btts      TEXT    NOT NULL CHECK(pick_btts IN ('yes', 'no')),
        points_awarded INTEGER NOT NULL DEFAULT 0,
        award_detail   TEXT,
        created_at     TEXT    NOT NULL,
        UNIQUE(fixture_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id);

      CREATE TABLE IF NOT EXISTS forecast_match_links (
        match_id          INTEGER NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
        fixture_id        INTEGER NOT NULL UNIQUE REFERENCES fixtures(id) ON DELETE CASCADE,
        last_observed_at  TEXT,
        last_home         INTEGER,
        last_away         INTEGER,
        stable_count      INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT    NOT NULL
      );
    `);
  }
};
