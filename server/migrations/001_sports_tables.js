/**
 * Migration 001 — spor veri tabloları (SportScore normalize şeması)
 * Alanlar docs/sportscore-discovery.md'de doğrulanan gerçek API alanlarına göredir.
 * Mevcut Tribün tablolarına (users, scores, ...) DOKUNULMAZ.
 * Tamamı IF NOT EXISTS → tekrar çalıştırma zararsız (idempotent).
 */
module.exports = {
  version: 1,
  name: 'sports_tables',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS competitions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        provider    TEXT    NOT NULL DEFAULT 'sportscore',
        external_id TEXT    NOT NULL,
        slug        TEXT    NOT NULL,
        sport       TEXT    NOT NULL CHECK(sport IN ('football', 'basketball')),
        name        TEXT    NOT NULL,
        country     TEXT,
        logo_url    TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 100,
        is_enabled  INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL,
        UNIQUE(provider, external_id)
      );

      CREATE TABLE IF NOT EXISTS teams (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        provider    TEXT    NOT NULL DEFAULT 'sportscore',
        external_id TEXT    NOT NULL,
        sport       TEXT    NOT NULL CHECK(sport IN ('football', 'basketball')),
        name        TEXT    NOT NULL,
        short_name  TEXT,
        logo_url    TEXT,
        updated_at  TEXT    NOT NULL,
        UNIQUE(provider, external_id)
      );

      CREATE TABLE IF NOT EXISTS matches (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        provider       TEXT    NOT NULL DEFAULT 'sportscore',
        external_id    TEXT    NOT NULL,
        sport          TEXT    NOT NULL CHECK(sport IN ('football', 'basketball')),
        competition_id INTEGER REFERENCES competitions(id),
        season         TEXT,
        round_label    TEXT,
        home_team_id   INTEGER REFERENCES teams(id),
        away_team_id   INTEGER REFERENCES teams(id),
        kickoff_utc    TEXT,
        status         TEXT    NOT NULL DEFAULT 'unknown' CHECK(status IN
                       ('scheduled', 'live', 'halftime', 'finished', 'postponed',
                        'cancelled', 'suspended', 'abandoned', 'unknown')),
        status_raw     TEXT,
        period         TEXT    CHECK(period IN ('H1','H2','HT','ET','PEN','Q1','Q2','Q3','Q4','OT','BREAK')),
        minute         INTEGER,
        home_score     INTEGER,
        away_score     INTEGER,
        period_scores  TEXT,
        venue          TEXT,
        finished_at    TEXT,
        fetched_at     TEXT,
        created_at     TEXT    NOT NULL,
        updated_at     TEXT    NOT NULL,
        raw_json       TEXT,
        UNIQUE(provider, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_matches_kickoff      ON matches(kickoff_utc);
      CREATE INDEX IF NOT EXISTS idx_matches_sport_kickoff ON matches(sport, kickoff_utc);
      CREATE INDEX IF NOT EXISTS idx_matches_status_kickoff ON matches(status, kickoff_utc);
      CREATE INDEX IF NOT EXISTS idx_matches_comp_kickoff ON matches(competition_id, kickoff_utc);
      CREATE INDEX IF NOT EXISTS idx_matches_home         ON matches(home_team_id);
      CREATE INDEX IF NOT EXISTS idx_matches_away         ON matches(away_team_id);

      CREATE TABLE IF NOT EXISTS standings (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        competition_id INTEGER NOT NULL REFERENCES competitions(id),
        season         TEXT    NOT NULL DEFAULT '',
        group_name     TEXT    NOT NULL DEFAULT '',
        position       INTEGER NOT NULL,
        team_id        INTEGER NOT NULL REFERENCES teams(id),
        played         INTEGER,
        won            INTEGER,
        drawn          INTEGER,
        lost           INTEGER,
        goals_for      INTEGER,
        goals_against  INTEGER,
        goal_diff      INTEGER,
        points         INTEGER,
        win_pct        REAL,
        extra          TEXT,
        fetched_at     TEXT,
        UNIQUE(competition_id, season, group_name, team_id)
      );

      CREATE TABLE IF NOT EXISTS match_details (
        match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        kind           TEXT    NOT NULL CHECK(kind IN ('events', 'lineups', 'stats', 'periods', 'players')),
        payload        TEXT    NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        fetched_at     TEXT,
        PRIMARY KEY(match_id, kind)
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        job_name            TEXT PRIMARY KEY,
        locked_until        TEXT,
        locked_by           TEXT,
        last_run_at         TEXT,
        last_success_at     TEXT,
        last_error          TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        job_name         TEXT    NOT NULL,
        started_at       TEXT    NOT NULL,
        finished_at      TEXT,
        status           TEXT    NOT NULL CHECK(status IN ('success', 'partial', 'failed', 'skipped')),
        requests_made    INTEGER NOT NULL DEFAULT 0,
        records_seen     INTEGER NOT NULL DEFAULT 0,
        records_upserted INTEGER NOT NULL DEFAULT 0,
        records_skipped  INTEGER NOT NULL DEFAULT 0,
        error_message    TEXT
      );

      CREATE TABLE IF NOT EXISTS api_usage (
        day_utc  TEXT    NOT NULL,
        endpoint TEXT    NOT NULL,
        count    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(day_utc, endpoint)
      );
    `);
  }
};
