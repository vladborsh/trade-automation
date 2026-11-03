-- WD-006 — drop the 17 tables the wind-down retired (tasks/wind-down.jsonl, last revision
-- 2026-11-03; storage ruling S1/S8). THIS DROPS DATA, on every database, at the next boot
-- (DB_MIGRATE_ON_BOOT defaults to true). The box takes a fresh backup first (RUNBOOK §6).
--
-- Why each family goes, and the proof that nothing reads it: the WD-006 report gives a SQL-shaped
-- `git grep` count over apps/insight-bot/src per table: 0 at this commit, against 45 on 5857ca6
-- (positive control), and 13 for the kept `liquidations`.
--   * the candle/funding tape — candles_1m, candles_agg, mark_funding_1m, funding_settlements: no
--     collector writes them since WD-010; charts and funding are read from the venue on demand (S1);
--     news reactions read Binance klines on demand since IB-097;
--   * gap_reports: its only writer, the daily gap report, was deleted in WD-011;
--   * market context — fear_greed, market_cap_coin, market_cap_global: read on demand (WD-008);
--   * features and playbooks — feature_frames, feature_frame_versions, feature_value_conflicts,
--     playbook_frame_pins, playbook_config, playbook_evaluations, playbook_state, signals, cooldowns,
--     and their enum playbook_source_mode: the pipeline was removed in the wind-down.
--
-- KEPT (the row and the owner): liquidations, collector_gaps, collector_heartbeats, symbols,
-- open_interest_5m, long_short_5m, calendar_*, users/invites/web_*, web_push_*, raw_news and every
-- news_* table (S8, permanent), news_reactions. pg_trgm stays: raw_news uses it.
--
-- No CASCADE: no foreign key touches these tables (checked in pg_constraint on a database migrated
-- to 023), and anything unexpected that depends on one should make this fail, not vanish with it.
-- Partitions of the six partitioned parents go with their parent. Indexes go with their tables.
-- The 016/017 `do $$` blocks were anonymous; no stored function was ever created.
drop table candles_1m;
drop table candles_agg;
drop table mark_funding_1m;
drop table funding_settlements;
drop table gap_reports;
drop table fear_greed;
drop table market_cap_coin;
drop table market_cap_global;
drop table feature_value_conflicts;
drop table feature_frame_versions;
drop table feature_frames;
drop table playbook_frame_pins;
drop table playbook_evaluations;
drop table playbook_state;
drop table playbook_config;
drop table signals;
drop table cooldowns;
drop type playbook_source_mode;
