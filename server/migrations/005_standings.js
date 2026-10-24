/**
 * Migration 005 — Aşama 7 (puan durumu) şema revizyonu
 *
 * 001'deki standings tablosu DOĞRULANAN widget/standings yanıtına göre
 * yeniden kurulur (mevcut migration DEĞİŞTİRİLMEZ — bu satır tablo ilk
 * kez Aşama 7'de yazılacağı için veri kaybı YOKTUR).
 *
 * Yanıt biçimi (24.10.2026 canlı doğrulandı — futbol 200; basketbol ucu
 * NBA ve EuroLeague için 404 "No standings data" döndürdüğü için bu aşama
 * yalnızca FUTBOL liglerinde çalışır):
 *   { sport, competition, competition_logo, competition_slug,
 *     tables: [ { group: "", rows: [ { pos, team, team_logo, team_slug,
 *       team_url, p, w, d, l, gf, ga, gd, pts, promo_color, promo_name } ] } ] }
 *
 * 001'e göre değişiklikler:
 *   - team_id NULL OLABİLİR: puan durumundaki takım adı, maçlardaki
 *     teams.name_key ile eşleşmeyebilir → eşleşmeyen ad
 *     unmapped_values('team_name')'e yazılır, satır team_id=NULL ile yaşar.
 *     (Puan durumundan YENİ teams satırı AÇILMAZ — sağlayıcıda takım
 *     kimliği güvenilir değil; spec: takım sayfası bu sürümde yok.)
 *   - team_name/team_logo/promo_color/promo_name satırda kendi kolonlarında
 *     (widget'tan birebir; logo okuma API'sinde kullanılır).
 *   - season kolonu kaldırıldı (yanıtta sezon yok); 001'deki win_pct korundu
 *     (futbol yanıtında yok → hep NULL; ileride doğrulanırsa hazır).
 *   - updated_at: satırların yazım zamanı → okuma ucu meta.updated_at
 *     ve "eski veri" (stale) hesabı buradan türetilir.
 *   - row_extra: yanıttaki bilinmeyen ek alanların JSON'u (ileri uyum).
 *
 * Idempotent: DROP+CREATE; tekrar çalıştırmak zararsız (tablo boşalır ama
 * standings verisi her senkronda tümüyle yeniden yazılır).
 */
module.exports = {
  version: 5,
  name: 'standings',
  up(db) {
    db.exec(`
      DROP TABLE IF EXISTS standings;
      CREATE TABLE standings (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        competition_id  INTEGER NOT NULL REFERENCES competitions(id),
        group_name      TEXT    NOT NULL DEFAULT '',
        position        INTEGER NOT NULL,
        team_id         INTEGER REFERENCES teams(id),
        team_name       TEXT    NOT NULL,
        team_logo       TEXT,
        played          INTEGER,
        won             INTEGER,
        drawn           INTEGER,
        lost            INTEGER,
        goals_for       INTEGER,
        goals_against   INTEGER,
        goal_diff       INTEGER,
        points          INTEGER,
        win_pct         REAL,
        promo_color     TEXT,
        promo_name      TEXT,
        row_extra       TEXT,
        updated_at      TEXT    NOT NULL,
        UNIQUE(competition_id, group_name, team_name)
      );
      CREATE INDEX IF NOT EXISTS idx_standings_comp
        ON standings(competition_id, group_name, position);
      CREATE INDEX IF NOT EXISTS idx_standings_team
        ON standings(team_id);
    `);
  }
};
