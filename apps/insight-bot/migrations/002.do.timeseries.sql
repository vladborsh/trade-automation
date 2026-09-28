-- architecture/insight-bot-system-design.md §3.3 — the market-data tables, verbatim from that
-- section, plus §3.1's conventions: all times timestamptz taken from the venue payload, prices
-- and quantities numeric, ratios double precision, source in ('ws','rest','archive').
--
-- D7: monthly native RANGE partitions on every time-series table, no TimescaleDB. The partitions
-- themselves are NOT created here — `src/db/partitions.ts` creates the current month plus three
-- ahead before any collector starts, and any month the backfill touches. That is deliberate:
-- **there is no DEFAULT partition**, so a write into a month nobody prepared fails loudly
-- (23514, "no partition of relation ... found for row") instead of landing in a catch-all nobody
-- ever queries. §3.1 calls such a write a boot-time bug, and this is what makes it one.
--
-- Every partitioned table's primary key contains its partition key, because Postgres requires it.

-- ---------------------------------------------------------------------------------------------
-- Candles. D4: only 1m is ingested; 15m/1h/4h/1d are derived into candles_agg by an idempotent job.
-- ---------------------------------------------------------------------------------------------

create table candles_1m (
  venue                  text not null,
  market                 text not null check (market in ('perp','spot')),
  symbol                 text not null,
  open_time              timestamptz not null,
  open                   numeric not null,
  high                   numeric not null,
  low                    numeric not null,
  close                  numeric not null,
  volume                 numeric not null,
  quote_volume           numeric,
  trades                 int,
  taker_buy_volume       numeric,
  taker_buy_quote_volume numeric,
  source                 text not null check (source in ('ws','rest','archive')),
  primary key (venue, market, symbol, open_time)
) partition by range (open_time);

comment on table candles_1m is
  'D4/D12: 1m candles from every venue and market, idempotent on (venue, market, symbol, open_time). '
  'D8: the archive backfill writes this same table, tagged source = ''archive''.';

create table candles_agg (
  venue                  text not null,
  market                 text not null check (market in ('perp','spot')),
  symbol                 text not null,
  tf                     text not null check (tf in ('15m','1h','4h','1d')),
  open_time              timestamptz not null,
  open                   numeric not null,
  high                   numeric not null,
  low                    numeric not null,
  close                  numeric not null,
  volume                 numeric not null,
  quote_volume           numeric,
  trades                 int,
  taker_buy_volume       numeric,
  taker_buy_quote_volume numeric,
  bars                   int not null,        -- 1m rows folded in
  complete               boolean not null,    -- bars = the full count the timeframe expects
  primary key (venue, market, symbol, tf, open_time)
) partition by range (open_time);

comment on column candles_agg.complete is
  'False when the derive job folded a partial window (a gap, or the still-open current bar). '
  'Consumers must treat an incomplete bar as missing, never as a smaller one.';

-- ---------------------------------------------------------------------------------------------
-- Derivatives state.
-- ---------------------------------------------------------------------------------------------

-- D5: the mark/funding stream ticks at 1 s; only the last sample of each minute is stored, plus
-- one row at every settlement (funding_settlements below).
create table mark_funding_1m (
  venue                  text not null,
  symbol                 text not null,
  ts                     timestamptz not null,
  mark_price             numeric,
  index_price            numeric,
  predicted_funding_rate double precision,
  next_funding_time      timestamptz,
  source                 text not null check (source in ('ws','rest','archive')),
  primary key (venue, symbol, ts)
) partition by range (ts);

comment on table mark_funding_1m is
  'D5: one row per venue/symbol/minute, the last sample in that minute. §3.3: Bybit and OKX mark '
  'is sampled per minute only for the signal set; the rest of the universe is settlement-only.';

-- Not partitioned: ~100k rows/year at 30 symbols x 3 venues (§3.3).
create table funding_settlements (
  venue        text not null,
  symbol       text not null,
  funding_time timestamptz not null,
  rate         double precision not null,
  mark_price   numeric,
  source       text not null check (source in ('ws','rest','archive')),
  primary key (venue, symbol, funding_time)
);

create table open_interest_5m (
  venue    text not null,
  symbol   text not null,
  ts       timestamptz not null,
  oi_base  numeric not null,
  oi_quote numeric,
  source   text not null check (source in ('ws','rest','archive')),
  primary key (venue, symbol, ts)
) partition by range (ts);

create table long_short_5m (
  venue       text not null,
  symbol      text not null,
  ts          timestamptz not null,
  kind        text not null check (kind in ('global_account','top_account','top_position','taker')),
  long_ratio  double precision,
  short_ratio double precision,
  ratio       double precision,
  source      text not null check (source in ('ws','rest','archive')),
  primary key (venue, symbol, ts, kind)
) partition by range (ts);

-- ---------------------------------------------------------------------------------------------
-- Liquidations. D6: stored as events, one row each.
-- ---------------------------------------------------------------------------------------------

create table liquidations (
  id           bigserial,
  venue        text not null,
  symbol       text not null,
  ts           timestamptz not null,
  side         text not null check (side in ('long','short')),   -- the side LIQUIDATED
  price        numeric not null,
  qty          numeric not null,
  notional     numeric not null,
  order_status text,
  source       text not null check (source in ('ws','rest','archive')),
  -- Both keys carry ts because a partitioned table's unique indexes must contain the partition
  -- key. `id` stays a stable row identifier; the six-column key is D6's idempotency key, so a
  -- reconnect that replays the same event updates rather than duplicating it.
  primary key (id, ts),
  unique (venue, symbol, ts, side, price, qty)
) partition by range (ts);

comment on table liquidations is
  'D6: one row per liquidation event. **Binance undercounts**: its !forceOrder stream publishes at '
  'most ONE event per second per symbol, so a cascade arrives as a sample, not a census — counts '
  'and sums from this table are lower bounds on Binance, and the feature keys that consume it say '
  'so too (§4.1). Bybit allLiquidation and OKX liquidation-orders do not share that cap, so a '
  'cross-venue comparison of event counts compares different things.';

comment on column liquidations.side is
  'The side that was liquidated, normalised at the mapper: Binance forceOrder S = SELL is a LONG '
  'being liquidated (the engine sells the position), BUY is a short. Bybit and OKX map likewise, '
  'each documented in its own mapper against the venue doc it was checked against (§3.3).';

-- ---------------------------------------------------------------------------------------------
-- Calendar and collector bookkeeping.
-- ---------------------------------------------------------------------------------------------

-- Not partitioned: a few thousand rows a year, and queried by event_time across years.
-- Every revision is kept, as in signal-server's calendar (§3.3).
create table calendar_events (
  id         text not null,
  revision   int  not null,
  source     text not null,
  event_time timestamptz not null,
  currency   text,
  title      text,
  impact     text,
  forecast   text,
  previous   text,
  actual     text,
  fetched_at timestamptz not null default now(),
  primary key (id, revision)
);

create index calendar_events_time_idx on calendar_events (event_time);

create table collector_gaps (
  id          bigserial,
  stream      text not null,
  venue       text not null,
  market      text,
  symbol      text,
  gap_from    timestamptz not null,
  gap_to      timestamptz not null,
  expected    int not null,
  repaired    int not null default 0,
  error       text,
  detected_at timestamptz not null default now(),
  primary key (id, detected_at)
) partition by range (detected_at);

comment on table collector_gaps is
  '§6.2: the daily gap report reads this table, and the stage-0 exit criterion is fourteen '
  'consecutive reports with nothing unrepaired. repaired < expected is an open gap.';

-- The gap report scans one UTC day at a time, per stream.
create index collector_gaps_stream_idx on collector_gaps (stream, detected_at);
