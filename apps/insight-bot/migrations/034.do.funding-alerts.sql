-- IB-124 — funding alerts (architecture/alerts-liq-funding-levels-design-2026-11-05.md §3, F1–F8), on IB-122's
-- generic tables (031 already allows type 'funding' in all three). Number 034 checked free on every ref before commit
-- (033 is IB-144's); IB-126 / 128 stay on 035 / 036.

-- §1 Settings: the 'funding' row, both switches OFF (merging is not a go-live: IB-125's history run comes first, then
-- the owner decides). F5's bounds as params, equal to the contracts' FUNDING_DEFAULT_PARAMS
-- (test/db/migration-034.integration.spec.ts). perCoin starts empty: a coin missing from it is ON at the shared floor
-- (FUNDING_FLOOR_PER_8H in insights/thresholds.ts, IB-135); the floor itself is not stored, so there is one constant.
insert into alert_type_settings (type, params) values ('funding', '{"minEpisodeHours":24,"flipWithinHours":72,"perCoin":{}}')
on conflict (type) do nothing;

-- §1 Recipients (V13's pattern): off for members, on for the admins existing now. An admin added later starts off.
alter table users add column funding_alerts boolean not null default false;
update users set funding_alerts = true where role = 'admin';

-- F6: the state per coin and extreme side. Predicted funding has no history anywhere, so in-memory state would be lost
-- with nothing to rebuild it from. One row per (source, symbol, side): ≤ 2 rows a coin a source.
--   zone / since      normal or extreme, and since when (while extreme: the episode's start, F4)
--   out_checks / out_since   F4's re-arming streak while extreme: checks in a row outside, and the first of them
--   episode_start / episode_end   the last COMPLETED episode (end = the first check outside, F5's «end»)
--   opp_checks / opp_since   F5: checks in a row whose sign is the opposite of the side, after that episode
--   flip_sent         F5: one flip per episode (reset when a new episode completes)
--   last_check_at     the last check that moved this row; a gap longer than FUNDING_LATE_SEC breaks the streaks (F7)
create table alert_funding_state (
  source         text not null check (source in ('live', 'backfill')),
  symbol         text not null,
  side           text not null check (side in ('high', 'low')),
  zone           text not null check (zone in ('normal', 'extreme')),
  since          timestamptz not null,
  out_checks     integer not null default 0 check (out_checks >= 0),
  out_since      timestamptz,
  episode_start  timestamptz,
  episode_end    timestamptz,
  opp_checks     integer not null default 0 check (opp_checks >= 0),
  opp_since      timestamptz,
  flip_sent      boolean not null default false,
  last_check_at  timestamptz not null,
  updated_at     timestamptz not null default now(),
  primary key (source, symbol, side),
  constraint alert_funding_state_episode check ((episode_start is null) = (episode_end is null) and (episode_end is null or episode_end >= episode_start)),
  constraint alert_funding_state_out check ((out_checks = 0) = (out_since is null)),
  constraint alert_funding_state_opp check ((opp_checks = 0) = (opp_since is null))
);
