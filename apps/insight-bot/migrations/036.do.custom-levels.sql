-- IB-128 — the owner's custom price levels (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4 P9), on
-- IB-126's level alerts (035). Number 036 checked free on every ref before commit (035 is IB-126's).
--
-- A level is added on /admin/alerts or with `/level BTC 72000 [note]`, and deleted SOFTLY (`deleted_at`): its journal
-- rows keep naming a level that still exists, and a deleted level never fires again (the loop reads
-- `deleted_at is null`). No FK to alert_symbols: a coin can be removed from the list, which only pauses its levels.
--   price    the level itself
--   note     the owner's own words for it («range high»), shown in admin and in the message
--   events   the level's event switches, the exceptions only ({"sweep_above": false}); absent = on
create table alert_custom_levels (
  id          bigserial primary key,
  symbol      text not null check (symbol ~ '^[A-Z0-9]{2,30}$'),
  price       double precision not null check (price > 0 and price < 'Infinity'::double precision),
  note        text check (note is null or length(note) between 1 and 200),
  events      jsonb not null default '{}'::jsonb check (jsonb_typeof(events) = 'object'),
  created_by  integer references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  integer references users (id) on delete set null
);
-- the loop's read: a coin's active levels
create index alert_custom_levels_active on alert_custom_levels (symbol) where deleted_at is null;
