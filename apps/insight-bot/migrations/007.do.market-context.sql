-- IB-036 — stage-2 market context (architecture/insight-bot-web-dashboard.md §10).
--
-- None of these three series is partitioned: they are small and queried across whole years.
-- Fear & Greed is one row per day since 2018 (~3k rows); market_cap_global is 144 rows/day
-- (~53k/year); market_cap_coin is 20 rows/day (~7k/year).
--
-- **This history is forward-only for dominance.** CoinGecko's `/global/market_cap_chart` is paid
-- (401 on the free tier, probed 2026-09-28), so there is no archive to backfill
-- `market_cap_global` from: every day not collected is permanently missing. That is why this
-- table exists before anything reads it.

create table fear_greed (
  day            date primary key,
  value          int  not null check (value between 0 and 100),
  classification text not null,
  fetched_at     timestamptz not null default now()
);

comment on table fear_greed is
  'alternative.me /fng/. Full history since 2018-02-01 is available in one keyless call, so this '
  'one IS backfillable — unlike market_cap_global. One row per UTC day; the venue publishes a '
  'single value per day.';

create table market_cap_global (
  ts         timestamptz primary key,
  total_usd  numeric not null,
  btc_pct    double precision,
  eth_pct    double precision,
  -- The full market_cap_percentage map as sent (btc, eth, usdt, bnb, …), so a later question about
  -- some other coin's dominance can be answered from stored data rather than re-collected — which
  -- for this series is impossible after the fact.
  dominance  jsonb not null,
  fetched_at timestamptz not null default now()
);

comment on table market_cap_global is
  'CoinGecko /api/v3/global, every 10 minutes, FORWARD ONLY: the historical endpoint is paid, so '
  'this series can never be reconstructed. btc_pct and eth_pct are lifted out of `dominance` for '
  'the common query; they are null if the venue omits them, never 0.';

create table market_cap_coin (
  day        date not null,
  coin       text not null,              -- the CoinGecko id, e.g. 'bitcoin' (universe.yaml coingecko_id)
  cap_usd    numeric,
  price_usd  numeric,
  fetched_at timestamptz not null default now(),
  primary key (day, coin)
);

comment on table market_cap_coin is
  'CoinGecko /coins/{id}/market_chart?days=365&interval=daily — 365 days is the free limit '
  '(days=max is paid: 401, error 10012, probed 2026-09-28). That limit is a property of the '
  'source, not a gap in collection. cap_usd is null when the venue returns a price but no cap.';

create index market_cap_coin_coin_idx on market_cap_coin (coin, day);
