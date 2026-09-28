-- architecture/insight-bot-system-design.md §3.2 — reference and configuration tables.
-- Verbatim from that section: symbols (loaded from config/universe.yaml on boot) and
-- playbook_config. The market-data tables of §3.3 are partitioned and land in IB-004.

create table symbols (
  id            text primary key,             -- the Binance USD-M symbol, e.g. BTCUSDT
  base          text not null,
  quote         text not null,
  binance_perp  text not null,
  binance_spot  text,                         -- §2.3: null = no spot CVD for this symbol, never a silent zero
  bybit_linear  text,
  okx_swap      text,
  listed_perp   date not null,                -- first bar in the data.binance.vision archive; drives the backfill start (§5)
  in_signal_set boolean not null default false,
  active        boolean not null default true,
  added_at      timestamptz not null default now()
);

-- The collectors subscribe per market, so both lookups are by the venue's own symbol.
create index symbols_binance_spot_idx on symbols (binance_spot) where binance_spot is not null;
create index symbols_bybit_linear_idx on symbols (bybit_linear) where bybit_linear is not null;
create index symbols_okx_swap_idx     on symbols (okx_swap)     where okx_swap     is not null;
-- §2.3 — stage-1 playbooks evaluate only the signal set, so that filter is worth an index.
create index symbols_signal_set_idx on symbols (id) where in_signal_set and active;

create table playbook_config (
  playbook     text not null,
  version      int  not null,
  params       jsonb not null,                 -- the playbook's thresholds
  status       text not null check (status in ('live','shadow','off')),
  context_gate jsonb,                          -- null or exactly one {observable, op, threshold} (§8.3)
  created_at   timestamptz not null default now(),
  created_by   text not null,
  primary key (playbook, version)
);

-- §3.2 — "a parameter change is a new version (never an update in place), and stats are keyed
-- by version". Nothing enforces one row per status here on purpose: a playbook may have one
-- live and one shadow arm at once (§8.4, the twin-arm runner).
create index playbook_config_status_idx on playbook_config (playbook, status);
