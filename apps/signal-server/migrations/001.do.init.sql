-- architecture/backtest-app-system-design.md §3 — initial schema for the manual backtest app.
-- Verbatim from that note: users, invites, auth_sessions, backtest_sessions, orders,
-- order_modifications, screenshots, backtest_ops, plus their indexes, checks and cascades.

create extension if not exists citext;
-- gen_random_uuid() is built into Postgres core since v13 (this repo targets postgres:16-alpine,
-- §4) — no pgcrypto extension needed, matching the schema verbatim from §3.

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique,
  password_hash text   not null,             -- scrypt: "scrypt$N$r$p$salt$hash", base64url
  role          text   not null check (role in ('admin','user')),
  disabled_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table invites (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,           -- sha256(token); the token itself is shown once
  email       citext,                         -- optional pre-fill; not enforced on accept
  created_by  uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,           -- created_at + 7 days
  used_at     timestamptz,
  used_by     uuid references users(id) on delete set null
);

create table auth_sessions (
  id           text primary key,              -- sha256(cookie value)
  user_id      uuid not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,          -- sliding, 30 days
  last_seen_at timestamptz not null default now(),
  user_agent   text
);
create index on auth_sessions (user_id);

create table backtest_sessions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users(id) on delete cascade,
  name                   text not null,
  status                 text not null check (status in ('active','complete')),
  session_currency       text not null,       -- 'USD' | 'CHF' (D11)
  timeframe              text not null,       -- current tf; changes mid-session (decision 12)
  period_from_ms         bigint not null,
  period_to_ms           bigint not null,
  cursor_ms              bigint not null,     -- absolute ms (decision 18); monotonic (decision 37)
  initial_balance        numeric(20,8) not null,
  balance                numeric(20,8) not null,   -- realized, compounding (decision 21)
  default_risk_pct       numeric(8,4)  not null,
  costs_enabled          boolean not null,
  commission_pct         numeric(8,4)  not null,   -- of notional, per side
  spread                 numeric(20,8) not null,   -- full bid-ask width, price units
  skip_weekends          boolean not null default true,
  notional_warn_multiple numeric(8,2)  not null default 5,
  layout                 jsonb not null,      -- owned copy of Layout, candle panels only, <= 4
  -- stored aggregates (decision 38); rewritten inside every closing transaction
  trades_count           integer not null default 0,
  wins_count             integer not null default 0,
  losses_count           integer not null default 0,
  pnl_ccy                numeric(20,8) not null default 0,
  pnl_r                  numeric(12,6) not null default 0,
  profit_factor          numeric(12,6),
  max_drawdown_ccy       numeric(20,8) not null default 0,
  max_drawdown_r         numeric(12,6) not null default 0,
  avg_win_ccy            numeric(20,8), avg_win_r numeric(12,6),
  avg_loss_ccy           numeric(20,8), avg_loss_r numeric(12,6),
  stats_computed_at      timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  completed_at           timestamptz,
  check (period_from_ms < period_to_ms),
  check (cursor_ms between period_from_ms and period_to_ms)
);
create index on backtest_sessions (user_id, created_at desc);

create table orders (                         -- one row = one order's whole life; closed = a trade
  id                     uuid primary key default gen_random_uuid(),
  session_id             uuid not null references backtest_sessions(id) on delete cascade,
  seq                    integer not null,    -- 1-based per session; journal order
  panel_id               text not null,
  instrument             text not null,
  side                   text not null check (side in ('long','short')),
  type                   text not null check (type in ('market','limit')),
  status                 text not null check (status in ('pending','open','closed','cancelled')),
  placed_at_ms           bigint not null,     -- cursor when placed (screenshot #1 moment)
  limit_price            numeric(20,8),       -- limit orders only
  entry_price            numeric(20,8),       -- actual fill incl. spread
  entry_time_ms          bigint,              -- openTime of the 1m candle that filled it
  qty                    numeric(20,8) not null,
  risk_pct               numeric(8,4)  not null,
  risk_amount_ccy        numeric(20,8) not null,   -- 1R in currency, fixed at placement
  sl_initial             numeric(20,8) not null,   -- decision 21: never null
  sl_current             numeric(20,8) not null,
  tp_initial             numeric(20,8),
  tp_current             numeric(20,8),
  exit_price             numeric(20,8),
  exit_time_ms           bigint,
  close_reason           text check (close_reason in ('stop','take-profit','manual','end-of-session')),
  fill_resolution        text check (fill_resolution in ('1m','pessimistic-bar')),  -- decision 4
  sl_tp_same_bar         boolean not null default false,
  commission_ccy         numeric(20,8) not null default 0,
  spread_cost_ccy        numeric(20,8) not null default 0,
  pnl_ccy                numeric(20,8),       -- net of all costs
  pnl_r                  numeric(12,6),       -- pnl_ccy / risk_amount_ccy
  mae_price              numeric(20,8),       -- decision 26; computed at close from the 1m path
  mae_r                  numeric(12,6),
  cancelled_at_ms        bigint,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (session_id, seq)
);
create index on orders (session_id, status);

create table order_modifications (            -- decision 23
  id         bigserial primary key,
  order_id   uuid not null references orders(id) on delete cascade,
  cursor_ms  bigint not null,
  field      text not null check (field in ('sl','tp')),
  old_value  numeric(20,8),
  new_value  numeric(20,8),
  created_at timestamptz not null default now()
);

create table screenshots (                    -- decisions 6, 27, 30b
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references backtest_sessions(id) on delete cascade,
  order_id   uuid not null references orders(id) on delete cascade,
  kind       text not null check (kind in ('entry','exit')),
  store_key  text not null,                   -- §9.2 key; the DB never holds bytes
  width_px   integer not null, height_px integer not null, bytes integer not null,
  captured_at_ms bigint not null,             -- cursor at capture
  created_at timestamptz not null default now(),
  unique (order_id, kind)
);

create table backtest_ops (                   -- D9 idempotency
  session_id uuid not null references backtest_sessions(id) on delete cascade,
  op_id      uuid not null,
  response   jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, op_id)
);
