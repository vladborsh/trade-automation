-- IB-122 — the generic market-alert journal, per-type settings and the large-liquidation recipients
-- (architecture/alerts-liq-funding-levels-design-2026-11-05.md §1 C1–C5, §2 L1–L8).
-- One journal, one controls table and one settings row per type for liquidations, funding and levels;
-- the OI divergence tables stay as they are (the paths table gets two more subject columns).

-- §1 Settings: one row per type. Both switches OFF by default: detection and the journal run either way,
-- nothing is sent until the owner has seen the history run (C4) and turned `enabled` on.
-- `params` is validated by the type's zod schema in contracts (LiqParamsSchema for 'liq').
create table alert_type_settings (
  type             text primary key check (type in ('liq', 'funding', 'level')),
  enabled          boolean not null default false,
  members_visible  boolean not null default false,
  params           jsonb not null,
  updated_by       integer references users (id) on delete set null,
  updated_at       timestamptz not null default now()
);
-- L4 defaults, equal to the contracts' LIQ_DEFAULT_PARAMS (test/db/migration-031.integration.spec.ts).
-- A coin missing from perCoin is OFF until a threshold is entered.
insert into alert_type_settings (type, params) values ('liq',
  '{"perCoin":{"BTCUSDT":{"enabled":true,"thresholdUsd":5000000},"ETHUSDT":{"enabled":true,"thresholdUsd":3000000},"SOLUSDT":{"enabled":true,"thresholdUsd":1000000},"BNBUSDT":{"enabled":true,"thresholdUsd":300000},"TRXUSDT":{"enabled":true,"thresholdUsd":300000}}}');

-- C1: the journal for the three types. `at` is the event's own moment (the link's `at`); `details` is
-- validated per type and event by contracts. «Once» is a constraint: each type defines its dedupe_key
-- (liq: L2), and the key carries `source` (V30) so a history run never collides with the live loop.
-- `source` and `build` have NO default: a writer that forgets them fails at once.
create table market_alerts (
  id            bigserial primary key,
  type          text not null check (type in ('liq', 'funding', 'level')),
  event         text not null,
  symbol        text not null,
  direction     text check (direction in ('bullish', 'bearish')),
  at            timestamptz not null,
  tf            text not null,
  details       jsonb not null,
  params        jsonb not null,
  source        text not null check (source in ('live', 'backfill')),
  build         text not null check (build ~ '^([0-9a-f]{12}|dev)$'),
  confirmed_at  timestamptz not null,
  fired_at      timestamptz,
  late          boolean not null default false,
  recipients    integer not null default 0 check (recipients >= 0),
  dedupe_key    text not null,
  created_at    timestamptz not null default now(),
  constraint market_alerts_once unique (source, type, dedupe_key),
  constraint market_alerts_backfill_unsent check (source <> 'backfill' or (fired_at is null and recipients = 0 and not late))
);
create index market_alerts_type_symbol_at_idx on market_alerts (type, symbol, at desc);
create index market_alerts_recent_idx on market_alerts (created_at desc);
comment on column market_alerts.source is
  'live = the alert loop as it ran; backfill = a history run (C4), never sent, never late. Report the two separately, never pooled (V32).';

-- L8 / F8 / P7: controls and near-misses, never in the journal. Direction-free for liquidations
-- (direction null; the liquidated side is in details). Once per (source, type, dedupe_key).
create table market_alert_controls (
  id          bigserial primary key,
  type        text not null check (type in ('liq', 'funding', 'level')),
  kind        text not null check (kind in ('random', 'near_miss', 'touch')),
  symbol      text not null,
  at          timestamptz not null,
  direction   text check (direction in ('bullish', 'bearish')),
  details     jsonb not null,
  params      jsonb not null,
  source      text not null check (source in ('live', 'backfill')),
  build       text not null check (build ~ '^([0-9a-f]{12}|dev)$'),
  dedupe_key  text not null,
  created_at  timestamptz not null default now(),
  constraint market_alert_controls_once unique (source, type, dedupe_key)
);
create index market_alert_controls_recent_idx on market_alert_controls (created_at desc);

-- §1 Recipients (V13's pattern): off for members, on for the admins existing now. V13's known limit
-- applies: an admin added later starts off.
alter table users add column liq_alerts boolean not null default false;
update users set liq_alerts = true where role = 'admin';

-- §1 Price paths: the IB-115 measurer, unchanged in meaning; two more subjects, exactly one set.
alter table oi_divergence_paths add column market_alert_id bigint references market_alerts (id) on delete cascade;
alter table oi_divergence_paths add column market_control_id bigint references market_alert_controls (id) on delete cascade;
alter table oi_divergence_paths drop constraint oi_divergence_paths_subject;
alter table oi_divergence_paths add constraint oi_divergence_paths_subject
  check (num_nonnulls(alert_id, control_id, near_miss_id, market_alert_id, market_control_id) = 1);
alter table oi_divergence_paths add constraint oi_divergence_paths_market_alert_once unique (market_alert_id, win);
alter table oi_divergence_paths add constraint oi_divergence_paths_market_control_once unique (market_control_id, win);

-- L5: which coins the Bybit and OKX liquidation collectors track, and since when — written by the
-- collectors (universe ∪ enabled alert_symbols, re-read every 5 min), read by the alert loop to name a
-- venue that has not collected a coin for 5 min yet. Current state: a removed coin's row is deleted.
-- Binance has no rows: its `!forceOrder@arr` carries every USDT-M symbol (judged by its heartbeat).
create table liquidation_tracked (
  venue   text not null check (venue in ('bybit', 'okx')),
  symbol  text not null,
  since   timestamptz not null,
  primary key (venue, symbol)
);
-- The universe coins were collected before this table existed: they are tracked since the stream was
-- first seen alive (its heartbeat), so the first deploy does not name Bybit and OKX "not collected" for
-- five minutes on every universe coin. Coins only on alert_symbols (TRX) start when the collector adds them.
insert into liquidation_tracked (venue, symbol, since)
select 'bybit', s.bybit_linear, coalesce((select first_seen_at from collector_heartbeats where stream = 'bybit:allLiquidation'), now())
  from symbols s where s.active and s.bybit_linear is not null
union
select 'okx', s.okx_swap, coalesce((select first_seen_at from collector_heartbeats where stream = 'okx:liquidation-orders'), now())
  from symbols s where s.active and s.okx_swap is not null
on conflict do nothing;
