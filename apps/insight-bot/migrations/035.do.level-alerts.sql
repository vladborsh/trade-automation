-- IB-126 — price-level alerts (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4, P1–P7, P10), on IB-122's
-- generic tables (031 already allows type 'level' in all three). Number 035 checked free on every ref before commit
-- (034 is IB-124's); IB-128 stays on 036.

-- §1 Settings: the 'level' row, both switches OFF (merging is not a go-live: IB-127's history run comes first, then the
-- owner decides). Params equal to the contracts' LEVEL_DEFAULT_PARAMS (test/db/migration-035.integration.spec.ts):
-- perCoin empty (a coin missing from it is ON with PDH/PDL off), events empty (every event on), touch band 0.1 %.
insert into alert_type_settings (type, params) values ('level', '{"touchBand":0.001,"events":{},"perCoin":{}}')
on conflict (type) do nothing;

-- §1 Recipients (V13's pattern): off for members, on for the admins existing now. An admin added later starts off.
alter table users add column level_alerts boolean not null default false;
update users set level_alerts = true where role = 'admin';

-- P10: crossunder/crossover state per (source, symbol, level kind, period start), high and low levels only (an open
-- needs none). ≈ coins × 6 rows for the current periods; a period's rows are deleted when the next one's are written.
--   price             the level the state was built against (the period's PWH, …), for audit and the seed
--   last_side         the side of the last non-touch 15m close in the period; null = none yet
--   first_beyond_at   the close moment of the period's first close beyond L (P6's «… закрывалась с {время}»)
--   last_bar_at       the OPEN of the last 15m bar this row has seen: a row behind the bar before the one evaluated
--                     missed bars (downtime) and is re-seeded, never stepped across the gap
create table alert_level_state (
  source           text not null check (source in ('live', 'backfill')),
  symbol           text not null,
  kind             text not null check (kind in ('PWH', 'PWL', 'PMH', 'PML', 'PDH', 'PDL')),
  period_start     timestamptz not null,
  price            double precision not null check (price > 0),
  last_side        text check (last_side in ('above', 'below')),
  first_beyond_at  timestamptz,
  last_bar_at      timestamptz not null,
  updated_at       timestamptz not null default now(),
  primary key (source, symbol, kind, period_start),
  constraint alert_level_state_beyond check (first_beyond_at is null or last_side is not null)
);
