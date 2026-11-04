-- IB-115 — the OI divergence research journal (architecture/oi-divergence-design-2026-11-04.md §8, V23–V29).
-- Collection only: no page, no text and no hit rate reads these tables (§6, V29); they are read with SQL.
-- Nothing is back-filled over past history (V29): the tables start empty.

-- V27: the build that wrote a row — the image's commit (12 hex), `dev` in a slot. The existing journal
-- rows get 'pre-027', then the column is NOT NULL with NO default: a writer that forgets the build
-- fails at once instead of writing a plausible lie. The check refuses an empty or made-up value too.
alter table oi_divergence_alerts add column build text;
update oi_divergence_alerts set build = 'pre-027';
alter table oi_divergence_alerts alter column build set not null;
alter table oi_divergence_alerts add constraint oi_divergence_alerts_build check (build ~ '^([0-9a-f]{12}|dev|pre-027)$');

-- V25: the control groups, never in the owner's journal.
--   pivot:  every confirmed price pivot whose evaluation produced no alert; direction from its kind
--           (low → bullish, high → bearish); the stop is the pivot's own extreme.
--   random: 2 bar closes per coin, TF and UTC day, chosen by a hash of (symbol, tf, day); no direction,
--           no stop.
-- The once-key carries `direction` beside the design's (symbol, tf, kind, bar_time): one wide bar can
-- be a low pivot AND a high pivot, two controls. NULLS NOT DISTINCT keeps random (direction null) once.
create table oi_divergence_controls (
  id          bigserial primary key,
  symbol      text not null,
  tf          text not null check (tf in ('15m', '1h', '4h')),
  kind        text not null check (kind in ('pivot', 'random')),
  direction   text check (direction in ('bullish', 'bearish')),
  bar_time    timestamptz not null,                 -- the bar's OPEN time (the venue's convention)
  stop_price  numeric,
  params      jsonb not null,
  build       text not null check (build ~ '^([0-9a-f]{12}|dev)$'),
  created_at  timestamptz not null default now(),
  constraint oi_divergence_controls_shape check (
    (kind = 'pivot' and direction is not null and stop_price is not null)
    or (kind = 'random' and direction is null and stop_price is null)),
  constraint oi_divergence_controls_once unique nulls not distinct (symbol, tf, kind, direction, bar_time)
);
create index oi_divergence_controls_recent_idx on oi_divergence_controls (created_at desc);

-- V26: a candidate A–B that failed EXACTLY ONE condition, within a bounded reach; at most one per
-- (symbol, tf, direction, B), and only when B produced no alert. `miss` is in `unit` (rule → unit fixed).
create table oi_divergence_near_misses (
  id            bigserial primary key,
  symbol        text not null,
  tf            text not null check (tf in ('15m', '1h', '4h')),
  direction     text not null check (direction in ('bullish', 'bearish')),
  a_time        timestamptz not null,
  a_price       numeric not null,
  a_oi_time     timestamptz not null,
  a_oi          numeric not null,
  b_time        timestamptz not null,
  b_price       numeric not null,
  b_oi_time     timestamptz not null,
  b_oi          numeric not null,
  rule          text not null check (rule in ('price_delta', 'oi_delta', 'price_line', 'oi_line', 'k', 'w')),
  miss          numeric not null check (miss >= 0),
  unit          text not null,
  params        jsonb not null,
  confirmed_at  timestamptz not null,
  build         text not null check (build ~ '^([0-9a-f]{12}|dev)$'),
  created_at    timestamptz not null default now(),
  constraint oi_divergence_near_misses_unit check (unit = case rule
    when 'price_delta' then 'threshold' when 'oi_delta' then 'threshold'
    when 'price_line' then 'atr14' when 'oi_line' then 'oi_median' else 'bars' end),
  constraint oi_divergence_near_misses_order check (a_time < b_time),
  constraint oi_divergence_near_misses_once unique (symbol, tf, direction, b_time)
);
create index oi_divergence_near_misses_recent_idx on oi_divergence_near_misses (created_at desc);

-- V23–V24: the price path of one subject over one window from t0, from closed 5 m klines. A row is
-- written with its subject (what to measure: t0, ATR14 at the subject's bar, the stop) and measured
-- once the window has closed (`measured_at`). Exactly one subject column is set.
--   t0       = the confirming bar's close + 6 min, rounded UP to 5 m; entry = open of the 5 m kline at t0
--   bars     = 5 m klines the venue had in the window (48 / 288 / 864 when complete)
--   entry_at = t0, unless the venue had no kline at t0 (then the first one after it)
--   high/low and their first bar; stop_at = first bar trading beyond stop_price (null stop: random)
--   fav_*_at = first bar whose excursion in the direction reaches 0.5 / 1 / 2 × atr14 (null direction: random)
--   order_ambiguous = the stop and a threshold fall in the same 5 m bar (5 m cannot order them)
-- `win` is the window ('window' is reserved in SQL). `tried_at`: the last failed fetch, so one coin the
-- venue keeps refusing cannot starve the queue.
create table oi_divergence_paths (
  id               bigserial primary key,
  alert_id         bigint references oi_divergence_alerts (id) on delete cascade,
  control_id       bigint references oi_divergence_controls (id) on delete cascade,
  near_miss_id     bigint references oi_divergence_near_misses (id) on delete cascade,
  win              text not null check (win in ('4h', '24h', '72h')),
  symbol           text not null,
  direction        text check (direction in ('bullish', 'bearish')),
  t0               timestamptz not null check (extract(epoch from t0)::bigint % 300 = 0),
  atr14            numeric not null check (atr14 >= 0),
  stop_price       numeric,
  measured_at      timestamptz,
  tried_at         timestamptz,
  bars             integer check (bars >= 0),
  entry_at         timestamptz,
  entry_price      numeric,
  high             numeric,
  high_at          timestamptz,
  low              numeric,
  low_at           timestamptz,
  stop_at          timestamptz,
  fav_05_at        timestamptz,
  fav_1_at         timestamptz,
  fav_2_at         timestamptz,
  order_ambiguous  boolean,
  constraint oi_divergence_paths_subject check (num_nonnulls(alert_id, control_id, near_miss_id) = 1),
  constraint oi_divergence_paths_measured check ((measured_at is null) = (bars is null)),
  constraint oi_divergence_paths_alert_once unique (alert_id, win),
  constraint oi_divergence_paths_control_once unique (control_id, win),
  constraint oi_divergence_paths_near_miss_once unique (near_miss_id, win)
);
create index oi_divergence_paths_due_idx on oi_divergence_paths (t0) where measured_at is null;
