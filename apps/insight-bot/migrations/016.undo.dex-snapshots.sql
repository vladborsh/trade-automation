-- IB-028 — undo. Drops the snapshot history: these are observations of third-party state that
-- cannot be re-collected for a past instant, so this is destructive in the same way dropping
-- `raw_news` is. Nothing else references them.
drop table if exists dex_token_security;
drop table if exists dex_tokens;
drop table if exists dex_pools;
drop table if exists dex_pair_snapshots;
