-- IB-109 — price vs open-interest divergence alerts (architecture/oi-divergence-design-2026-11-04.md).
-- Four tables and one column. Nothing here is partitioned: the journal is tens of rows a week (V12).

-- V2: the coins alerts are evaluated for. NOT the universe's `symbols` (syncUniverse owns that, and
-- `active` there switches on every collector). The OI poller collects universe ∪ the enabled rows
-- here (V3), re-read every pass, so adding a coin needs no deploy. A member's watchlist later is a
-- subset of this table and needs no change to it.
create table alert_symbols (
  symbol    text primary key check (symbol ~ '^[A-Z0-9]{2,30}$'),   -- Binance USD-M, e.g. TRXUSDT
  base      text not null,
  added_by  integer references users (id) on delete set null,       -- null: seeded here
  added_at  timestamptz not null default now(),
  enabled   boolean not null default true
);
insert into alert_symbols (symbol, base) values
  ('BTCUSDT', 'BTC'), ('ETHUSDT', 'ETH'), ('SOLUSDT', 'SOL'), ('BNBUSDT', 'BNB'), ('TRXUSDT', 'TRX');

-- V13, V17: one row. Both switches OFF: detection and the journal run either way, nothing is sent
-- until the owner has seen the history examples (IB-111) and turned `enabled` on.
create table alert_settings (
  id               smallint primary key default 1 check (id = 1),
  enabled          boolean not null default false,
  members_visible  boolean not null default false,
  params           jsonb not null,
  updated_by       integer references users (id) on delete set null,
  updated_at       timestamptz not null default now()
);
-- V5–V7 defaults, equal to the contracts' OI_DIVERGENCE_DEFAULT_PARAMS (test/db/migration-025.spec.ts)
insert into alert_settings (id, params) values (1,
  '{"perTf":{"15m":{"n":6,"k":3,"w":96},"1h":{"n":6,"k":3,"w":120},"4h":{"n":6,"k":3,"w":90}},"atrMult":0.25,"oiMedianMult":0.5}');

-- V12: the journal. One row per alert, late ones included; a unique key per (symbol, tf, direction,
-- A, B) so a restart or a re-evaluation never journals — or sends — the same alert twice (V8).
create table oi_divergence_alerts (
  id             bigserial primary key,
  symbol         text not null,
  tf             text not null check (tf in ('15m', '1h', '4h')),
  direction      text not null check (direction in ('bullish', 'bearish')),
  a_time         timestamptz not null,
  a_price        numeric not null,
  a_oi_time      timestamptz not null,
  a_oi           numeric not null,
  b_time         timestamptz not null,
  b_price        numeric not null,
  b_oi_time      timestamptz not null,
  b_oi           numeric not null,
  run_of         bigint references oi_divergence_alerts (id),
  run_length     integer not null default 2 check (run_length >= 2),
  params         jsonb not null,                                     -- as used: a hit rate needs them
  confirmed_at   timestamptz not null,
  fired_at       timestamptz,
  late           boolean not null default false,
  recipients     integer not null default 0 check (recipients >= 0),
  price_at_fire  numeric,
  price_4h       numeric,
  price_24h      numeric,
  outcome_at     timestamptz,
  constraint oi_divergence_alerts_once unique (symbol, tf, direction, a_time, b_time),
  constraint oi_divergence_alerts_order check (a_time < b_time)
);
create index oi_divergence_alerts_recent_idx on oi_divergence_alerts (confirmed_at desc);

-- V9: evaluations skipped for a hole in OI that the venue did not cause. Once per (symbol, tf, bar).
create table oi_divergence_skips (
  id         bigserial primary key,
  symbol     text not null,
  tf         text not null check (tf in ('15m', '1h', '4h')),
  bar_time   timestamptz not null,
  reason     text not null check (reason in ('no_oi_data')),
  hole_from  timestamptz not null,
  hole_to    timestamptz not null check (hole_to >= hole_from),
  at         timestamptz not null default now(),
  constraint oi_divergence_skips_once unique (symbol, tf, bar_time, reason)
);
create index oi_divergence_skips_recent_idx on oi_divergence_skips (at desc);

-- V13: who receives alerts. Off for members; on for admins (the owner) from the start.
alter table users add column oi_alerts boolean not null default false;
update users set oi_alerts = true where role = 'admin';
