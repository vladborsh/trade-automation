# Crypto Insight Bot — system design

**Author:** Architect · **Date:** 2026-09-28 · **Status:** design, decomposed
into `tasks/insight-bot.jsonl` (IB-001 … IB-028) for the Tech Lead. Input: the
settled brief `architecture/crypto-insight-bot-2026-09-28.md` (25 user
decisions; binding, not re-opened here) and the user's draft v0.1 (kept out of
the repo; used only where the brief is silent). Repository facts checked
first-hand: `apps/signal-server/src/market-data/{binance,metrics,gap-repair.ts}`,
`src/calendar/`, `src/db/`, `src/config/env.schema.ts`, `Dockerfile`,
`docker-compose.yml`, `libs/contracts/src/{candle,metric}.ts`,
`research/{deriv-positioning,funding-rate-signals,hedged-carry}/` fetch scripts,
`research/_surveys/2026-09-lightgbm-role.md` §3.2, `IDEAS-BACKLOG.md`
"Spot–perp basis" entry.

Sections: 0 summary · 1 decisions · 2 components · 3 data model · 4 collectors
· 5 historical backfill · 6 operations and the stage-0 exit criterion · 7
hosting · 8 stage-1 pipeline · 9 playbooks as coded · 10 stages 2–4 outline ·
11 repository layout · 12 risks · 13 interpretations of the brief · 14
sequencing.

---

## 0. What is being built, in one paragraph

A second NestJS app, `apps/insight-bot`, with its own Postgres database
`insight`, that (stage 0) collects from Binance USD-M perps, Binance spot,
Bybit and OKX the series that cannot be recovered later — liquidations,
predicted funding, mark price — plus 1m candles with taker-buy volume (spot and
perp), settled funding, open interest and long/short ratios at 5 m, and the
ForexFactory calendar, for a static top-30 universe, on one EC2 instance in
Tokyo; and (stage 1) computes a fixed feature frame at every 15m and 4h close,
runs pure-function playbooks through a state machine, passes fired setups
through a deterministic gate (vetoes, dedupe, cooldown, budget, per-user
sizing), delivers template messages to each member's private Telegram chat,
and scores every signal automatically. AI (stage 2) is bolted on at the edges
later and is never in the decision path. The whole thing reuses the
signal-server's Binance client, gap repair and calendar-feed logic by lifting
them into `libs/`; signal-server keeps running its own ingestion unchanged.

---

## 1. Decisions at a glance

| # | Decision | Where |
|---|---|---|
| D1 | `apps/insight-bot` is a **separate NestJS 10 app** with the same skeleton conventions as signal-server (zod env, pino, prom-client, postgrator, `DATABASE_URL` with no default). Not a module inside signal-server. | §2 |
| D2 | **Three new libs**, all mechanical lifts except the archive downloader: `libs/binance-client` (REST klines, combined-stream WS manager, mappers, `data.binance.vision` archive reader), `libs/market-data-core` (`GapRepair`), `libs/calendar-core` (ForexFactory feed client, mapper, diff). signal-server imports them and deletes its copies; behaviour unchanged. | §2.2 |
| D3 | One contract change in `libs/contracts`: `Candle` gains optional `quoteVolume`, `trades`, `takerBuyVolume`, `takerBuyQuoteVolume`. Additive; signal-server ignores them. | §2.2 |
| D4 | **Only 1m candles are ingested**; 15m/1h/4h/1d are derived by an idempotent job into `candles_agg` (not resampled on every read). | §3, §8.1 |
| D5 | Mark price and predicted funding are stored **once per minute per symbol** (last sample in the minute) plus one row at every funding settlement, not at the 1 s stream rate. | §4.1 |
| D6 | Liquidations are stored **as events**, one row each, with the Binance ≤ 1 event/s/symbol undercount documented on the table and in the feature keys that consume it. | §3, §4 |
| D7 | Monthly **native range partitions** on every time-series table; a partition-maintenance job keeps three months ahead. No TimescaleDB. | §3.1 |
| D8 | **Live and archive share one schema**: the historical backfill writes the same tables the collectors write, tagged by `source`. | §5 |
| D9 | Regime axes are computed and stored as **context**. The only way context enters a decision is (a) the global `EVENT_RISK` veto or (b) at most **one declared `context_gate` per playbook**, and every gated playbook is evaluated in **two arms**, `gated` (may go live) and `unconditional` (always shadow), both logged and tracked. This is how the 2026-09 no-standalone-regime-classifier ruling is honoured in code. | §8.3 |
| D10 | Vetoed and shadow signals are **logged and tracked exactly like live ones**; only delivery differs. The value of a veto is therefore measurable. | §8.4 |
| D11 | Telegram via grammY **long polling** — the instance opens no inbound port. | §7, §8.6 |
| D12 | Idempotency by natural keys everywhere: candles `(venue, market, symbol, open_time)`, signals `(playbook, symbol, trigger_ts, arm)`. Restart = gap repair from the last stored row, never a duplicate. | §3, §4.4 |
| D13 | Universe = `config/universe.yaml`, a static top-30 list with per-venue symbol mapping, hand-revised monthly. Stage-1 signal set BTC/ETH/SOL is a config flag, not code. | §2.3 |
| D14 | Hosting: EC2 `t4g.small` (arm64) in `ap-northeast-1`, docker compose (Postgres 16 + insight-bot), daily `pg_dump` to S3, secrets from SSM Parameter Store, no SSH keys (Session Manager). The **first** thing DevOps does on the box is a connectivity probe of all three venues' public WS. | §7 |
| D15 | Binance REST weight budget for the whole app in steady state: **≈ 32 weight/min ≈ 1.3 % of 2400** (§4.5). Backfill is throttled to ≤ 600/min and reads the used-weight header. | §4.5, §5 |
| D16 | Stage-2/3/4 consumers are described here but **not decomposed**; their tasks are written when stage 1 is confirmed. Stage-2 **collection** (news, DEX pools) is decomposed now because it is ungated. | §10, §14 |

---

## 2. Component breakdown

### 2.1 `apps/insight-bot` modules

```
config/        env (zod), universe.yaml, playbook defaults
db/            DATABASE_URL → PgDatabase, postgrator migrations, partition maintenance
collectors/    one Nest module per venue + calendar + archive backfill
  binance-perp/   kline_1m (all symbols), !markPrice@arr@1s, !forceOrder@arr, funding REST, OI/LS REST 5m
  binance-spot/   kline_1m (mapped spot symbols)
  bybit/          allLiquidation.*, tickers.* (mark, predicted funding), funding history REST
  okx/            liquidation-orders (SWAP), funding-rate, mark-price, funding history REST
  calendar/       ForexFactory feed → calendar_events (SQL, every revision kept)
  archive/        data.binance.vision klines / fundingRate / metrics → the same tables
  writers/        batched upserts per table (pure SQL builders + specs)
  health/         StreamRegistry: last message per stream, gaps, reconnects → /health, prom, watchdog
derive/        candles_agg job (15m/1h/4h/1d from 1m), runs on 1m close and over history
features/      FeatureFrame keys, pure calculators, feature_frames writer          (stage 1)
regime/        context axes (trend, vol, leverage, event_window)                  (stage 1)
playbooks/     Playbook port, state machine, twin-arm runner, P3/P4/P5 (P1/P2 after gate)
gate/          status, vetoes, dedupe, cooldown, correlation collapse, budget, sizing
delivery/      grammY bot: commands, invites, buttons, templates ru/en, service chat
tracker/       outcomes, R / MFE / MAE / fees, auto-SHADOW, stats
users/         users, invites, per-user settings, user_actions
ops/           /health, /metrics, watchdog alerts, daily gap report
```

Later stages add `news/`, `ai/`, `dex/`, `execution/` (§10).

### 2.2 What moves into `libs/` (mechanical), and the one additive contract change

| New package | Lifted from signal-server | Notes |
|---|---|---|
| `@trade-automation/binance-client` | `market-data/binance/binance.adapter.ts` (REST paginator, WS with backoff and the 30 s silent-socket fallback), `binance.mapper.ts` | Generalise the WS to **combined streams** (`/stream?streams=a/b/c`, ≤ 1024 streams per socket, 24 h server-side disconnect handled as an ordinary reconnect) and to a spot base URL. The Nest `Logger` becomes an injected `{ log, warn }` interface; signal-server passes its Nest logger. **New, not lifted:** `archive/` — monthly/daily zip reader for `spot|futures/um` klines, `fundingRate`, `metrics`, with the per-file ms/µs detection rule from `research/hedged-carry/fetch_data.py` (spot files from 2025-01 carry 16-digit times). |
| `@trade-automation/market-data-core` | `market-data/gap-repair.ts` (`GapRepair`) | Already pure. Room for the stream watchdog later if signal-server wants it. |
| `@trade-automation/calendar-core` | `calendar/feed/{ff-feed.client,ff-feed.mapper}.ts`, the pure part of `calendar-diff.service.ts` | The File/S3 `EventStore` and the notification scheduler stay in signal-server; insight-bot stores events in SQL. |

Contract change (`libs/contracts/src/candle.ts`): `quoteVolume?`, `trades?`,
`takerBuyVolume?`, `takerBuyQuoteVolume?` — all optional, populated by the
Binance mappers from REST columns 7–10 and WS fields `q`, `n`, `V`, `Q`.
signal-server's stores and wire types are untouched (they ignore unknown
optional fields; `CandleSchema` is extended, not replaced). This is the
taker-buy-volume field the inventory found unmapped.

Rule for every lift: same commit moves code and its specs, changes no
behaviour, and signal-server's full jest suite is green (`AGENTS.md`
"mechanical moves stay mechanical").

### 2.3 Universe (`apps/insight-bot/config/universe.yaml`)

```yaml
# Top-30 USD-M perps by 30-day volume, revised by hand monthly (brief §3). Static on purpose.
signal_set: [BTCUSDT, ETHUSDT, SOLUSDT]        # stage-1 playbooks evaluate only these
symbols:
  - id: BTCUSDT
    binance_perp: BTCUSDT
    binance_spot: BTCUSDT
    bybit_linear: BTCUSDT
    okx_swap: BTC-USDT-SWAP
    listed_perp: 2019-09-08           # first archive month; drives the backfill start
  - id: ETHUSDT
    ...
```

**Universe rule (ratified 2026-09-28, §16.4):** rank USD-M perps by 30-day
quote volume over the last 30 closed UTC days; a perp **qualifies only if its
base asset has a Binance spot USDT market**. This excludes Binance's tokenised
equity and commodity perps (`XAUUSDT`, `CLUSDT`, `MSTRUSDT`, `NVDAUSDT`, …),
which now sit inside the raw top 30: they follow US-session hours and their
own underlying's regime, carry none of the crypto mechanics the playbooks
read, and have no spot CVD. A newly listed perp with a short history **stays
in** if it ranks (its backfill starts at listing and its 30-day percentile
features are `null` until the window exists); it is flagged in the yaml. A
venue mapping the venue does not list is `null`, never a guessed symbol.
`listed_perp` is the **first bar in the `data.binance.vision` USD-M archive**
(the backfill start, §5), which for the oldest perps is 2020-01-01 — the
`2019-09-08` in the example above is the listing date and is superseded by
this rule. A symbol that leaves the list is set `active = false`, never
deleted: its history references it. Otherwise a symbol with no `binance_spot`
simply has no spot CVD; features that need it are `null`, never silently
zero.

---

## 3. Data model (PostgreSQL 16, database `insight`)

### 3.1 Conventions

- All times `timestamptz`, values from the venue payload, never the local
  clock (the same rule as `Candle.openTime`).
- Prices/quantities `numeric`; ratios `double precision`.
- Time-series tables are `PARTITION BY RANGE (<time col>)`, **one partition
  per calendar month**, created by `db/partitions.ts` for the current month
  plus three ahead on boot and daily; a write into a month with no partition
  is a boot-time bug, so the maintenance job runs before collectors start.
  Backfill creates partitions for every month it touches.
- Every write is an `INSERT … ON CONFLICT (natural key) DO UPDATE` unless
  stated; `liquidations` is `DO NOTHING` (§16.6). Batched (≤ 500 rows per
  statement) by the writers module.
- On a partitioned table every unique index, the primary key included, must
  contain the partition column, so surrogate-keyed tables use a composite
  primary key `(id, <time col>)` beside their natural unique key.
- `source` columns take `'ws' | 'rest' | 'archive'`.

### 3.2 Reference and configuration

```sql
symbols(id text PK, base text, quote text, binance_perp text, binance_spot text,
        bybit_linear text, okx_swap text, listed_perp date, in_signal_set bool,
        active bool, added_at timestamptz)           -- loaded from universe.yaml on boot
playbook_config(playbook text, version int, params jsonb, status text CHECK IN ('live','shadow','off'),
        context_gate jsonb NULL, created_at timestamptz, created_by text, PK (playbook, version))
```

`params` are the playbook's thresholds; a parameter change is a **new
version** (never an update in place), and stats are keyed by version (brief
§1 admin surface). `context_gate` is `null` or exactly one
`{observable, op, threshold}` (§8.3).

### 3.3 Market data (partitioned monthly)

```sql
candles_1m(venue, market CHECK IN ('perp','spot'), symbol, open_time,
        open, high, low, close, volume, quote_volume, trades int,
        taker_buy_volume, taker_buy_quote_volume, source,
        PK (venue, market, symbol, open_time))
candles_agg(venue, market, symbol, tf CHECK IN ('15m','1h','4h','1d'), open_time,
        open, high, low, close, volume, quote_volume, trades, taker_buy_volume,
        taker_buy_quote_volume, bars int, complete bool,           -- bars = 1m rows folded in
        PK (venue, market, symbol, tf, open_time))
mark_funding_1m(venue, symbol, ts, mark_price, index_price, predicted_funding_rate,
        next_funding_time, source, PK (venue, symbol, ts))         -- D5: last sample per minute
funding_settlements(venue, symbol, funding_time, rate, mark_price NULL, source,
        PK (venue, symbol, funding_time))                          -- not partitioned (~100k rows/yr)
open_interest_5m(venue, symbol, ts, oi_base, oi_quote NULL, source, PK (venue, symbol, ts))
long_short_5m(venue, symbol, ts, kind CHECK IN ('global_account','top_account','top_position','taker'),
        long_ratio, short_ratio, ratio, source, PK (venue, symbol, ts, kind))
liquidations(id bigserial, venue, symbol, ts, side CHECK IN ('long','short'),   -- the side liquidated
        price, qty, notional, order_status text NULL, source,
        PK (id, ts),                                               -- partition key must be in every unique index
        UNIQUE (venue, symbol, ts, side, price, qty))              -- D6; Binance undercount documented here
        -- write rule: INSERT … ON CONFLICT DO NOTHING (events are immutable; first writer's `source` stands)
calendar_events(id text, revision int, source, series_id text, event_time, currency, title, impact,
        status text NOT NULL DEFAULT 'scheduled',                  -- scheduled | cancelled (§16.7)
        forecast, previous, actual, actual_source text NULL, fetched_at,
        PK (id, revision), INDEX (impact, currency, event_time))   -- every revision kept, as in signal-server
collector_gaps(id bigserial, stream text, venue, market NULL, symbol NULL, gap_from, gap_to,
        expected int, repaired int, error text NULL, detected_at,
        PK (id, detected_at))                                      -- feeds §6.2's report
```

`liquidations.side` is normalised at the mapper: Binance `forceOrder` with
`S = SELL` is a **long** being liquidated (the engine sells the position),
`BUY` a short; Bybit and OKX map likewise, each documented in its mapper with
the doc excerpt it was checked against.

Row-count estimate per year at 30 symbols: candles 1m spot+perp 31.5 M;
`candles_agg` 3.4 M; `mark_funding_1m` 15.8 M (Binance) + up to 31.6 M if
Bybit/OKX mark is also sampled per minute — **Bybit/OKX mark is sampled per
minute only for the signal set** (3 symbols), the rest at settlement only;
OI 3.2 M; L/S 12.6 M; liquidations 1–5 M. Total ≈ 70 M rows/yr, in line with
the brief's 50–70 M; ≈ 8–10 GB/yr with indexes.

### 3.4 Stage 1 — features, context, playbooks, signals

```sql
feature_frames(symbol, tf CHECK IN ('15m','4h'), close_time, frame jsonb, complete bool,
        PK (symbol, tf, close_time))                               -- partitioned; keys in §8.2
regime_context(scope CHECK IN ('symbol','market'), symbol NULL, ts, trend, vol, leverage, event_window,
        detail jsonb, PK (scope, symbol, ts))
playbook_state(playbook, symbol, arm, state CHECK IN ('IDLE','ARMED','TRIGGERED','CLOSED'),
        version int, setup jsonb, armed_at, expires_at, updated_at, PK (playbook, symbol, arm))
signals(id uuid PK, playbook, version, arm CHECK IN ('gated','unconditional'), symbol, direction,
        trigger_ts, tf, setup jsonb, feature_snapshot jsonb, regime jsonb, score real,
        vetoes text[], status_at_signal text,                      -- live|shadow|off at the time
        delivered bool, created_at, expires_at,
        UNIQUE (playbook, symbol, trigger_ts, arm))                -- D12 idempotency key
outcomes(signal_id uuid PK, triggered_at, exit_at, exit_reason CHECK IN
        ('stop','t1','t2','timeout','not_triggered','invalidated'),
        r_multiple, mfe_r, mae_r, fees_r, evaluated_at)
deliveries(signal_id, user_id, chat_id bigint, message_id bigint, sent_at, rendering CHECK IN ('template','ai'),
        PK (signal_id, user_id))
user_actions(signal_id, user_id, action CHECK IN ('taken','skipped'), ts, fill_price NULL, PK (signal_id, user_id))
cooldowns(playbook, symbol, until, PK (playbook, symbol))
alert_budget(day date, sent int, PK (day))                         -- global budget (brief §1 p.4)
```

`playbook_stats` is a query (view) over `signals ⋈ outcomes` grouped by
`(playbook, version, arm)`, with the rolling last-20 expectancy computed in
the tracker at every outcome (§8.7). It is not a stored table until it needs
to be.

### 3.5 Users

```sql
users(id serial PK, tg_user_id bigint UNIQUE, chat_id bigint, role CHECK IN ('admin','member'),
      lang text DEFAULT 'ru', deposit numeric NULL, risk_pct real DEFAULT 1.0,
      daily_loss_limit_pct real NULL, dex_alerts bool DEFAULT false,
      invited_by int NULL, disabled bool DEFAULT false, created_at)
invites(code text PK, created_by int, created_at, expires_at, used_by int NULL, used_at NULL)
```

The admin is bootstrapped from env (`ADMIN_TG_USER_ID`), the same pattern as
signal-server's env admin. Invites are single-use deep links
`t.me/<bot>?start=<code>`; the approach is the backtest app's, the tables are
this app's own (brief §1).

---

## 4. Collectors (stage 0)

### 4.1 Binance USD-M perp (`collectors/binance-perp`)

One combined-stream socket to `wss://fstream.binance.com/stream?streams=…`
carrying, for the whole universe:

- `<sym>@kline_1m` × 30 — mapped by the lifted mapper (now with taker fields),
  written on `x = true` to `candles_1m`; the forming bar is kept in memory
  for `/health` only.
- `!markPrice@arr@1s` — one stream for all symbols. Per symbol the collector
  keeps the last message; on each minute boundary it writes that sample to
  `mark_funding_1m` (D5). When `next_funding_time` rolls over, the settled
  rate is fetched by REST (`/fapi/v1/fundingRate?symbol&limit=1`, weight 1,
  30 calls per 8 h) into `funding_settlements`, and the pre-settlement
  predicted rate is written as an extra `mark_funding_1m` row at the exact
  settlement second so the last prediction before settlement is never lost.
- `!forceOrder@arr` — one stream; each event → `liquidations`. Binance emits
  at most one event per second per symbol (the venue's own documented
  snapshot rule); the undercount is stated on the table and in `/health`.

Gap repair: `GapRepair` per `(perp, symbol)` on every closed 1m; missing bars
via `/fapi/v1/klines` (weight 5 per ≤ 1500 bars), inserted in order, logged
to `collector_gaps`. On boot, the last stored `open_time` per symbol seeds it
and the interval to now is fetched before the socket is opened, so a restart
never leaves a hole.

Heartbeat: Binance pings every 3 min and expects a pong (the `ws` library
answers automatically); the collector additionally treats **no message for
90 s** on the combined socket as dead and reconnects (kline_1m alone
guarantees ≥ 30 messages/min). The 24-hour server-side disconnect is an
ordinary close → reconnect with backoff.

OI and L/S at 5 m (`collectors/binance-perp/oi-ls.poller.ts`), aligned to the
5-minute boundary + 20 s (the venue publishes on the boundary with a lag):
`/futures/data/openInterestHist?period=5m&limit=1` and the four ratio
endpoints `topLongShortPositionRatio`, `topLongShortAccountRatio`,
`globalLongShortAccountRatio`, `takerlongshortRatio` — 5 calls × 30 symbols
per 5 min = **30 weight/min**. On boot, the poller backfills the venue's
30-day window (500 rows per page, paginating **backward** by `endTime` as the
signal-server adapter learned the hard way) for every symbol whose last
stored row is older than 5 minutes.

### 4.2 Binance spot (`collectors/binance-spot`)

Same collector skeleton with `wss://stream.binance.com:9443/stream?streams=…`
and `/api/v3/klines` for repair, `market = 'spot'`. Spot has its own REST
budget (6000 weight/min on `api.binance.com`); repair is the only REST use.

### 4.3 Bybit and OKX (`collectors/bybit`, `collectors/okx`)

Both deliver two things the brief needs from a second and third venue:
**liquidations** and **funding** (settled + predicted/mark). Neither's candles
or OI are ingested in stage 0 (Binance is the price reference; adding them is
a later additive task if a playbook needs them).

| | Bybit v5 | OKX v5 |
|---|---|---|
| WS | `wss://stream.bybit.com/v5/public/linear` | `wss://ws.okx.com:8443/ws/v5/public` |
| liquidations | `allLiquidation.<symbol>` (per symbol; the older `liquidation.<symbol>` is deprecated) | `liquidation-orders` with `instType: SWAP` (one channel, all instruments; filter to the universe) |
| mark / predicted funding | `tickers.<symbol>` (`markPrice`, `fundingRate`, `nextFundingTime`) — sampled per minute for the signal set, at settlement for the rest (§3.3) | `mark-price` + `funding-rate` per `instId` |
| settled funding | REST `/v5/market/funding/history` (200/page) | REST `/api/v5/public/funding-rate-history` (100/page) |
| heartbeat | client `{"op":"ping"}` every 20 s | client `ping` text every 25 s |

Topic names and payload fields are to be **confirmed against the venues'
current docs at build time and recorded in each mapper's header comment**
(the repo convention for measured facts); the table above is the design's
expectation, not a guarantee. Bybit and OKX both name the liquidated side
differently from Binance; the mapper normalises to `long|short`.

### 4.4 Restart and idempotency

Every collector, on boot: read last stored key per stream → REST-fill the
interval to now where the venue can serve it (candles, funding, OI/LS) →
open the socket. Streams with no REST history (liquidations, predicted
funding) simply resume; the hole is recorded in `collector_gaps` with
`repaired = 0` so the daily report shows it honestly.

### 4.5 REST weight, steady state (Binance USD-M, budget 2400/min)

| Loop | Weight/min |
|---|---|
| OI + 4 × L/S, 30 symbols per 5 min | 30 |
| funding settlement fetch, 30 per 8 h | ≈ 0.06 |
| gap repair | 0 in steady state; 5 per repaired ≤ 1500-bar range |
| markPrice, forceOrder, klines | 0 (WS) |
| **total** | **≈ 32 ≈ 1.3 %** |

Spot REST: repair only, against spot's own 6000/min budget, reported on
`ib_binance_spot_weight_used_1m` (never added to the futures gauge). Bybit/OKX
REST: funding history poll once per settlement per symbol (≈ 0.1 calls/min
each).

---

## 5. Historical backfill (`collectors/archive`, run as a CLI job, resumable)

Same tables, `source = 'archive'`:

| Series | Source | Depth |
|---|---|---|
| 1m candles perp | `data/futures/um/monthly/klines/<S>/1m/`, daily for the current month, REST for the tail | from `listed_perp` (BTC 2019-09) |
| 1m candles spot | `data/spot/monthly/klines/<S>/1m/` (+ daily, + REST tail); µs time unit per file from 2025-01 | spot listing (earlier than perp) |
| settled funding, Binance | `data/futures/um/monthly/fundingRate/<S>/` (verified 0 missing slots on 8 symbols in `research/funding-rate-signals`) + REST tail | 2020-01 |
| OI, 4 × L/S at 5 m, Binance | `data/futures/um/daily/metrics/<S>/` (monthly prefix does not exist — measured in `research/deriv-positioning/fetch_metrics.py`) + `openInterestHist` for the last 30 days | **BTCUSDT 2020-09-01; every other symbol 2021-12-01** (measured in `research/squeeze-full-form/`, 404 before that) |
| settled funding, Bybit / OKX | REST history pages, as far back as each venue serves; depth **measured** in `research/squeeze-full-form/results/venue_depth.csv` | **Bybit full from listing (BTC 2020-03); OKX ≈ 97 days only** — every day OKX is not collected is lost |
| liquidations, predicted funding, mark | none — **forward only from the day the collectors start** | — |

Throttle: ≤ 600 Binance weight/min, reading `X-MBX-USED-WEIGHT-1M` and
sleeping when > 1200; archive downloads ≤ 4 in parallel. Output: a coverage
report (`results/coverage.md`, per symbol × series: first row, last row,
missing months) committed with the job's first full run. The job is
idempotent and resumable by month.

---

## 6. Operations and the stage-0 exit criterion

### 6.1 Health and metrics

- `GET /health` → `{ streams: [{ id, venue, lastMessageAgeSec, reconnects24h, gapsOpen }], db: { lagSec }, budget: { binanceWeightUsed1m } }`.
- `GET /metrics` (prom-client): `ib_stream_last_message_age_seconds{stream}`,
  `ib_rows_written_total{table}`, `ib_gaps_detected_total{stream}`,
  `ib_gaps_unrepaired_total{stream}`, `ib_binance_weight_used_1m` (USD-M
  futures, ceiling 2400/min), `ib_binance_spot_weight_used_1m` (spot, its own
  6000/min ceiling — a separate gauge so each is comparable with its own
  budget; §4.2), `ib_ws_reconnects_total{stream}`.

### 6.2 Watchdog and the daily gap report

A `StreamRegistry` records every stream's last message time. The watchdog
(every 30 s) sends **one** alert to the service Telegram chat when a stream
has been silent for more than `WATCHDOG_SILENCE_MIN` (default 3) and one
recovery message when it returns; alerts per stream are rate-limited to one
per 30 min. At 00:10 UTC a **gap report** is posted: for every `(venue,
market, symbol)` the number of expected vs present 1m bars for the previous
UTC day, OI/LS 5m slots present, liquidation and mark-stream uptime derived
from `collector_gaps`, and the Binance weight high-water mark.

**Stage-0 exit criterion, operationalised (brief §3):** 14 consecutive daily
gap reports with **0 missing 1m bars on every symbol and market**, 0 missing
5m OI/LS slots, and mark/liquidation streams with no unrepaired silence
longer than 3 minutes. The Tester reads the fourteen reports; the Architect
confirms the cluster on that evidence.

---

## 7. Hosting — requirements handed to DevOps (IB-013)

What the design needs; service choices inside these constraints are the
DevOps Engineer's (`agents/roles/devops-engineer.md`).

- **Region `ap-northeast-1`**, one **EC2 `t4g.small`** (2 vCPU arm64, 2 GB),
  gp3 EBS 50 GB, Amazon Linux 2023 or Ubuntu 24.04 arm64. The image must be
  built for **linux/arm64** (the existing Dockerfile pattern works on
  `node:22-slim` arm64).
- **docker compose** with two services: `postgres:16-alpine` (data on the EBS
  volume, `shared_buffers=512MB`, `max_connections=50`) and `insight-bot`.
  `restart: unless-stopped`; the daemon starts on boot.
- **Secrets** (Telegram tokens, `DATABASE_URL`, later Anthropic key) in SSM
  Parameter Store `SecureString`, rendered into a root-only `.env` on the
  host by the deploy step. Never in the image, never in the repo.
- **No inbound ports.** Access via SSM Session Manager; grammY long polling
  and all venue connections are outbound.
- **Daily `pg_dump -Fc`** at 01:00 UTC to an S3 bucket with versioning and a
  35-day lifecycle; a documented restore drill run once before the cluster is
  accepted.
- **Deploy path**: GitHub Actions builds and pushes the arm64 image to ECR,
  then `ssm send-command` runs `docker compose pull && up -d` on the box.
  IaC (Terraform or CDK, DevOps's choice) under `infra/insight-bot/`.
- **First action on the fresh instance: a connectivity probe** — open each
  venue's public WS from the box and confirm messages arrive within 30 s
  (`fstream.binance.com` was observed accepting the handshake and sending
  nothing from a blocked region; Bybit restricts some jurisdictions). If any
  venue is mute from Tokyo, that is a design escalation, not something to
  work around.
- **Runbook in plain Russian** (`infra/insight-bot/RUNBOOK.md`): deploy,
  restore, rotate a token, read `/health`, what a watchdog alert means.
- Cost ceiling to design to: instance + 50 GB gp3 + S3 ≈ 20–25 USD/month.

Local development stays on the existing single Postgres from
`apps/signal-server/docker-compose.yml`, with databases `insight_coord`,
`insight_dev1..3`, `insight_tester` (one server, one database per slot, as
`AGENTS.md` prescribes). Ports `:3005/:3015/:3025/:3035/:3045`.

---

## 8. Stage-1 pipeline

### 8.1 Clocks

- `BarClock` ticks at every UTC minute + 5 s grace. `derive/` folds the closed
  1m into `candles_agg` for every tf whose bar just closed.
- The **feature pass** runs at every 15m close and every 4h close (+ 15 s
  grace for the last 1m and the 5m OI slot to land). If the closing 1m bar
  or the OI slot is missing, the frame is computed with `complete = false`
  and **no playbook may arm or trigger on an incomplete frame**; the next
  complete frame re-evaluates.
- Timeframe is per playbook (brief §5): P3 runs on 15m frames, P1/P2/P6 on
  4h frames, P4 is a feature, P5 a global veto.

### 8.2 Feature frame (`features/feature-keys.ts`, all pure, all spec'd)

Fixed key set, versioned as `frame_version`. Windows are fixed here and are
**not tuned**; a change is a new `frame_version`.

| Key | Definition |
|---|---|
| `funding.binance.rate`, `.bybit.rate`, `.okx.rate` | last settled rate per venue |
| `funding.<venue>.pct30d` | percentile of the last settled rate among the venue's last 90 settlements (`min_periods` 45), the project's positioning convention |
| `funding.extreme_hi_venues`, `funding.extreme_lo_venues` | count of venues with `pct30d ≥ 0.90 ∧ rate ≥ +0.0003` / `≤ 0.10 ∧ ≤ −0.0003` (the funding-family definition) |
| `funding.predicted.binance` | last `predicted_funding_rate` |
| `oi.binance.now`, `oi.d24h_pct`, `oi.d4h_pct`, `oi.at_7d_high` | OI at frame close; % change over 24 h / 4 h; `now ≥ max(7 d)` |
| `ls.top_position`, `ls.global_account`, `ls.taker`, each with `.pct30d` | latest 5m value and its 30-day percentile |
| `cvd.spot.4h`, `cvd.spot.24h`, `cvd.perp.4h`, `cvd.perp.24h` | Σ (2·takerBuyVolume − volume) over the window, base units, from `candles_1m` |
| `cvd.spot.slope_4h`, `cvd.perp.slope_4h` | sign of the 4 h CVD change over the last 4 h vs the previous 4 h |
| `atr.1h.14`, `atr.4h.14`, `atr.1d.14` | Wilder ATR(14) on `candles_agg` |
| `structure.swing_high_12h`, `.swing_low_12h`, `.failed_highs_24h` | pivot-based (3-bar) swing extremes over 12 h of 15m bars; failed highs = pivots within 0.5·ATR(1h) below the 24 h high that did not close above it |
| `structure.impulse_low_15m` | the low of the last 15m impulse leg (last swing low before the current high) |
| `liq.long.15m`, `.long.60m`, `.short.15m`, `.short.60m` | Σ notional liquidated per side over the window |
| `liq.long.z60m`, `liq.short.z60m` | (60 m Σ − mean) / sd over the symbol's own trailing 30 days of 60 m sums, log1p-transformed; `null` until 14 days of liquidation history exist (the P3 sigma the draft warned would be rough at first) |
| `px.ret_24h`, `px.ret_4h`, `px.drawdown_from_24h_high` | price context |
| `label.p4` | `SPOT_LED | PERP_LED | ABSORPTION | DISTRIBUTION | NONE` from §9.2's table |

Percentile windows are the project's 30-day convention; nothing here is
optimised against outcomes — that is what makes the frame admissible as a
point-in-time snapshot later.

### 8.3 Regime context and the ruling (`regime/`, D9)

Computed and stored per frame, shown in messages, never a classifier:

- `trend`: `UP | DOWN | RANGE` from EMA50 slope on 4h and price vs EMA200 1d
  (the draft's rule, kept as description);
- `vol`: `LOW | NORMAL | HIGH` by ATR(14) 4h percentile over 90 days
  (< 30 / 30–80 / > 80);
- `leverage`: `LEVERED | NEUTRAL | DELEVERED` by `oi.binance.now` percentile
  over 90 days combined with the 3-day mean funding sign;
- `event_window`: `CLEAR | EVENT_RISK` — inside ±60 min of a `high`-impact
  USD calendar event (§9.4).

**How context may enter a decision, and only how:**

1. `EVENT_RISK` is a **global veto** applied by the gate (§8.4). It is one
   pre-registered rule on one mechanistic observable (the calendar), and it
   is measured: vetoed signals are tracked (D10), so the veto's own
   expectancy delta is a query.
2. A playbook may declare **one** `context_gate` in `playbook_config`
   (`{observable: 'regime.trend', op: 'in', value: ['UP','RANGE']}` or any
   single feature key with `<, ≤, ≥, >, in`). The runner then evaluates the
   playbook in **two arms** with identical thresholds: `gated` (gate
   applied; the arm that may be `live`) and `unconditional` (always
   `shadow`). Both arms produce signals, both are tracked, and `/stats`
   shows them side by side. A gate that does not beat the unconditional arm
   is removed by a new config version. No playbook may declare two gates, and
   no code path may read `regime_context` inside `evaluate()` except through
   the declared gate.

That is the ruling of `research/_surveys/2026-09-lightgbm-role.md` §3.2
turned into a structural constraint rather than a guideline.

### 8.4 Playbook engine and state machine (`playbooks/`)

```ts
export interface Playbook {
  readonly id: PlaybookId;              // 'P1' … 'P10'
  readonly tf: '15m' | '4h';
  evaluate(input: PlaybookInput): PlaybookOutput;   // pure: no IO, no clock, no randomness
}
export interface PlaybookInput {
  symbol: string; tf: Tf; closeTime: number;
  frame: FeatureFrame;                  // §8.2, complete === true
  prev: SetupState;                     // IDLE | ARMED | TRIGGERED | CLOSED, with the stored setup
  params: PlaybookParams;               // playbook_config.params of the active version
}
export interface PlaybookOutput {
  state: SetupState;
  setup?: Setup;                        // present when ARMED or TRIGGERED
  transitions: Array<'armed' | 'triggered' | 'invalidated' | 'expired' | 'closed'>;
  conditions: Array<{ key: string; value: number | string | null; threshold: number | string; pass: boolean }>;
}
```

`Setup` is the draft's contract, kept: `direction`, `trigger {type, level,
tf}`, `stop`, `targets[]`, `invalidation[]` (machine-readable), `rr`,
`expiresAt`, plus `armId`. The runner (`playbooks/runner.ts`) loads state,
calls `evaluate` for each `(playbook, symbol in signal_set, arm)`, persists
state and emits a `signal` row on `triggered` (idempotent on D12's key).
Because `evaluate` is pure and fed from stored frames, the stage-3 backtest
runner is the same function over historical frames — the draft's "same code
in live and backtest" principle survives as a type signature.

Transitions: `ARMED` expires after `params.armed_ttl_bars` closes without a
trigger; `TRIGGERED` → `CLOSED` when the tracker records an outcome; a new
`ARMED` on the same symbol is blocked by the cooldown until then.

### 8.5 Gate (`gate/`), in order, all deterministic

1. `playbook_config.status`: `off` → drop; `shadow` → log, track, do not
   deliver; `live` → continue. `arm = unconditional` is always shadow.
2. Vetoes (recorded on the signal, the signal continues to logging and
   tracking): `EVENT_RISK`; stage 2 adds `NEWS_TIER1_AGAINST`,
   `NEWS_TIER1_WINDOW` (mandatory for P3).
3. Dedupe: D12 key.
4. Cooldown: 12 h per `(playbook, symbol)` after `CLOSED`.
5. Correlation collapse: `TRIGGERED` signals on BTC/ETH/SOL in the same
   direction within 4 h → one message, the highest score, the others named
   in a line (brief §1 p.4).
6. Budget: ≤ `ALERTS_PER_DAY` (default 3) delivered `TRIGGERED` alerts per
   UTC day, highest score first; `ARMED` notices are quiet and do not count.
7. Per user: not disabled; daily loss limit not hit (sum of `r_multiple ×
   risk_pct` of the user's `taken` signals today); size = `deposit ×
   risk_pct / |entry − stop|` in base units, rounded to the venue step
   (`knowledge/venue-contract-specs.md`).

Score (draft §9.2, kept as a **display and ordering** number, never a
threshold): `40·conditions_passed_share + 30·norm(expectancy last 50) +
20·context_match + 0·confirmations(P4)`; `n < 20` prints "мало данных". The
P4 term is **0** since the spot-lead kill (§16.3); the slot stays so a future
confirmation observable can be registered into it.

### 8.6 Delivery (`delivery/`, grammY)

- Long polling (D11); one production bot, one test bot per slot from the
  slot's `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_SERVICE_CHAT_ID`).
- Commands: member `/start <code>`, `/settings`, `/deposit`, `/risk`, `/lang`,
  `/limit`, `/dex on|off`, `/mystats`; admin `/invite`, `/users`, `/playbook
  <P#> shadow|live|off`, `/playbook <P#> set <key>=<value>` (creates a new
  version), `/stats`, `/health`. Commands, codes and tickers in English;
  message text in the user's `lang` (`ru` default), templates as pure
  functions with specs (`delivery/templates/*.ts`), no AI in stage 1.
- Buttons: `[Взял] [Пропустил] [Подробнее]` → `user_actions`; `Подробнее`
  edits the message to append the conditions table and the frame values.
- The service chat receives watchdog alerts, gap reports, auto-SHADOW
  notices and (stage 2) AI budget alerts.

### 8.7 Tracker (`tracker/`)

On every closed Binance perp 1m bar for a symbol with open signals:

- `ARMED` setups: trigger rule evaluated on the playbook's tf close (the
  runner does this; the tracker only times out `expiresAt` →
  `not_triggered`, counted separately, not in win rate).
- `TRIGGERED`: entry = the trigger bar's close; then per 1m bar, in order:
  stop touched (bar low ≤ stop for longs) → `stop`; T2 touched → `t2`; T1
  touched → `t1` unless the setup says "run to T2 after T1" (P3 takes half
  at T1, the outcome uses the blended R); **stop and target in the same
  bar → stop** (conservative); `expiresAt` → `timeout` at that bar's
  close; the setup's `invalidation[]` rules → `invalidated`.
- `r_multiple = (exit − entry)/(entry − stop) × side − fees_r`, `fees_r =
  2 × 0.0005 × entry / |entry − stop|` (taker both sides, project standard);
  `mfe_r`/`mae_r` from bar extremes.
- **Auto-SHADOW** (brief §1 p.3): after each outcome, for `(playbook,
  version, arm = gated)`, if the last 20 outcomes exist and mean `r_multiple
  < 0` → `status = shadow`, service-chat notice; back to `live` only by
  `/playbook … live`.
- Stats view: n, win rate, mean R, expectancy, profit factor, max drawdown
  in R, share `not_triggered`, mean hold, per `(playbook, version, arm)` and
  per user (`taken` only).

---

## 9. Playbooks as coded in stage 1

Thresholds below are **v1 config values**, recorded in `playbook_config`,
changed only by a new version. They are the draft's numbers restated; none is
evidence of anything yet.

### 9.1 P3 — post-cascade reversal (15m, entry, starts in `shadow`)

ARMED when all of: `liq.long.z60m ≥ 3` (or `liq.short.z60m` for the mirror);
`oi.d4h_pct ≤ −8` (BTC; `≤ −12` for ETH/SOL); `funding.predicted.binance ≤
0.0001`; `px.drawdown_from_24h_high ≥ 2.5 × atr.1h.14 / price`. Trigger
(long): 15m close above the cascade bar's midpoint, or close ≥ cascade low +
0.5·ATR(1h). (The draft's extra clause `cvd.spot.slope_4h > 0` was dropped on
2026-09-28, §16.3: its prior is gone and P3 is rare enough that a filter with
no prior only costs sample; the value is still in the snapshot for a later
read.) Stop: cascade low − 0.1·ATR(1h).
T1 50 % of the cascade range (half off), T2 the cascade's origin. Invalidation:
new low after trigger; `oi.d4h_pct` rising while price falls. `armed_ttl_bars
= 8` (2 h). Until 14 days of liquidation history exist `liq.*.z60m` is null
and P3 cannot arm — by design. Mandatory news veto attaches in stage 2.

### 9.2 P4 — spot-vs-perp label (feature `label.p4`)

Over the 4 h window: price direction from `px.ret_4h` (|ret| ≥ 0.25·ATR(4h)/price,
else `→`), spot CVD sign from `cvd.spot.4h`, perp from `cvd.perp.4h`:

| price | spot | perp | label |
|---|---|---|---|
| ↑ | ↑ | any | `SPOT_LED` |
| ↑ | →/↓ | ↑ | `PERP_LED` |
| ↓ | ↑ | ↓ | `ABSORPTION` |
| → | ↓ | ↑ | `DISTRIBUTION` |
| otherwise | | | `NONE` |

**Tested and killed 2026-09-28** (`research/spot-lead/REPORT.md`, Запись
36; §16.3): the label carries no information beyond the advance itself.
Consumers now: the morning plan line and the message context **only**. It is
still computed and logged in every feature snapshot (cheap, and the record is
what would justify any future registration), but its score weight is 0, it
may not be a `context_gate`, and P3's trigger no longer references it. P1/P2's
"spot CVD not confirming" condition is a *different* observable (the raw spot
CVD sign over 4 h inside a funding/OI-conditioned setup) and is being tested
by the squeeze pass on its own merits.

### 9.3 P5 — macro event veto

`EVENT_RISK` from `calendar_events` with `impact = high`, `currency = USD`,
`status = 'scheduled'` on the latest revision, ±60 min, read through one
shared windowed query (`calendar/events-in-window.ts`) that the veto, the
T−60 notice and the morning plan all use. Members get one quiet notice at
T−60 ("новых сигналов до HH:MM не будет"). The trading half of P5 is not built (brief §2, §5).

### 9.4 P1 / P2 — long / short squeeze: **gate failed, CLOSED (2026-09-28)**

Not built. `research/squeeze-full-form/` (Запись 37; §16.5): the full form
co-occurs ~never (P1 zero times, P2 six times in 66,678 decision instants
over 8 perps), every rung of the ablation ladder with power is zero or
negative, the well-powered P1 shadow is −0.188R, and two-venue extreme
funding never occurred in the holdout year. The user's gate ("build only if
the extra filters demonstrably rescue the shape") is not met; the squeeze
family is treated as closed for this bot. No `playbooks/p1.ts`, `p2.ts`. The
frame keys introduced for them (`structure.failed_highs_24h`,
`structure.impulse_low_15m`, `oi.at_7d_high`) **stay in `frame_version` 1**
as context: they are cheap, and the snapshot record is what any future
registration would need. Stage 1 therefore has **one entry playbook, P3**.

### 9.5 Later playbooks

P6 unlocks, P7 stablecoin bias, P8 Hyperliquid, P9 DEX survivors, P10 news
shock — stage 2/3 per the brief; each arrives as a `Playbook` implementation
plus its collector, decomposed when stage 1 is confirmed (§10, §14).

---

## 10. Stages 2–4, outline (not decomposed, except stage-2 collection)

- **Stage-2 collection, ungated (decomposed now: IB-027, IB-028).** `news/`
  ingest: exchange announcement feeds, SEC/CFTC RSS, CoinDesk, CryptoPanic,
  The Block, Decrypt, Cointelegraph, Blockworks → `raw_news` with exact
  dedupe (normalised URL / title hash) and `pg_trgm` title similarity
  clustering (brief §7: no embedding provider); a dictionary prefilter
  assigns candidate tickers; `news_reactions` records the affected symbols'
  15m/1h/4h returns for the later AI-1 calibration. `dex/` snapshots:
  GeckoTerminal `new_pools`/`trending_pools` on Solana, Base, BSC, Ethereum
  every 10 min, DexScreener pair details, GoPlus security at first sight →
  `dex_pools`; rate limits stated per call in the task.
- **Stage-2 consumers, gated** (≥ 1 playbook passed history and 4+ weeks of
  `SHADOW` agreeing in sign): `ai/` with Anthropic only — AI-1 classifier
  (`claude-haiku-4-5-20251001`) producing the draft's structured JSON; AI-2
  composer + validator (`claude-sonnet-5`) with the numbers-must-match and
  stop-list rules, one retry then template fallback; AI-4 morning plan
  (`claude-sonnet-5`) replacing the stage-1 template plan; budget cap
  0.7 USD/day tracked in `ai_usage` with a service-chat alert; P10 veto,
  P7 bias, P6, P9 opt-in alerts. Redis/BullMQ only if the AI call queue
  needs it.
- **Stage 3**: AI-5 chat agent and AI-6 weekly review (`claude-opus-5-5`,
  read-only tools over the tables, cannot place orders); the backtest
  runner over stored frames with the live `Playbook` code; Coinbase premium;
  P8; paid sources if earned.
- **Stage 4**: `execution/` for the admin account only — button → Binance
  order with SL/TP, later auto for playbooks with n ≥ 50 and positive
  expectancy after costs; risk limits and kill-switch inside the service;
  trade keys IP-whitelisted, no withdrawal permission.

---

## 11. Repository layout of the new code

```
libs/binance-client/         src/{rest,ws,mappers,archive}/, specs           (IB-001, IB-012)
libs/market-data-core/       src/gap-repair.ts                               (IB-001)
libs/calendar-core/          src/{ff-feed.client,ff-feed.mapper,diff}.ts     (IB-010)
libs/contracts/src/candle.ts + optional taker fields                         (IB-002)
apps/insight-bot/
  config/universe.yaml, config/playbooks.yaml (v1 params seed)
  migrations/001…                                                            (IB-003, IB-004, …)
  src/{config,db,collectors,derive,features,regime,playbooks,gate,delivery,tracker,users,ops}/
  Dockerfile (arm64-capable), docker-compose.yml (local: same Postgres, DB insight_<slot>)
infra/insight-bot/           IaC + RUNBOOK.md (Russian)                      (IB-013)
tasks/insight-bot.jsonl
```

Root `package.json` build order: contracts → indicators → replay-core →
binance-client → market-data-core → calendar-core → signal-server →
insight-bot → chart-client.

---

## 12. Risks and the sharpest trade-offs

1. **Venue reachability from Tokyo.** Binance is the reason for the region;
   Bybit's and OKX's public streams from an AWS Tokyo IP are unverified.
   Mitigation: the connectivity probe is the first DevOps step; a mute venue
   is escalated, not patched around.
2. **Liquidation undercount** (Binance ≤ 1/s/symbol). Accepted by the brief;
   consequence: `liq.*` features measure *visible* liquidations, and the
   30-day own-history z-score makes P3 relative to that same undercount.
   Cross-venue sums are not comparable in absolute terms and are not summed
   across venues in v1 features.
3. **Per-minute mark sampling loses sub-minute funding spikes.** Predicted
   funding is a smoothed venue estimate anyway; the settlement-second row
   keeps the value that mattered.
4. **t4g.small memory.** Postgres + Node + the backfill job at once may swap.
   Backfill runs before collectors on first deploy, or from a laptop against
   the box's database via SSM port-forward. The runbook says which.
5. **Partition maintenance is a single point of failure**: a missing month
   partition rejects writes. Boot order (partitions first) and a daily job
   with an alert cover it; the Tester verifies a simulated month rollover.
6. **Two apps ingesting Binance twice** doubles WS connections, not REST
   weight; accepted by the brief.
7. **The twin-arm mechanism doubles playbook rows.** ~2× signals and
   outcomes for gated playbooks — trivial volume, and it is the price of
   measurable gates.
8. **grammY long polling and a restart** can redeliver a callback; handlers
   are idempotent on `(signal_id, user_id)`.

---

## 13. Interpretations of the brief (visible, not silent)

1. "Bybit, OKX liquidations and predicted funding" → Bybit/OKX candles and
   OI are **not** ingested in stage 0. Additive later if needed.
2. "Mark price + predicted funding stream" → stored per minute (D5), not per
   second; the settlement-second row preserves the last prediction.
3. "Template messages without AI" in stage 1 includes a **template morning
   plan** (IB-025), since the brief's §1 makes the morning plan the one
   unconditional message; AI-4 later replaces the wording, not the schedule.
4. DEX networks: the draft left them open; IB-028 snapshots all four
   (Solana, Base, BSC, Ethereum). Collection only; nothing is alerted.
5. "Alert budget" is global (the bot's attention budget), the daily loss
   limit is per user.
6. The draft's `regime` gating language is replaced by §8.3; the draft's
   "P1 disabled in strong UP + spot-led" becomes, if wanted, P1's one
   declared `context_gate`, tested as an arm.

## 14. Conflicts found

None between the brief and the repository. One between the draft and the
2026-09 ruling (regime classifier as a gate) — resolved by the brief in the
ruling's favour and implemented as §8.3.

---

## 15. Sequencing summary (the task graph is in `tasks/insight-bot.jsonl`)

**Cluster A — stage 0, collectors + hosting (ranks above any new backtest-app
work):** IB-001 libs lift → IB-002 taker fields; IB-003 scaffold → IB-004
tables/partitions/writers → IB-005 Binance perp → IB-006 spot, IB-007 OI/LS,
IB-008 Bybit, IB-009 OKX, IB-010 calendar, IB-011 watchdog + service chat,
IB-012 archive backfill; IB-013 EC2 (after IB-003 produces an image). Exit:
§6.2's fourteen clean reports.

**Cluster B — stage 1 core:** IB-014 derive → IB-015 features → IB-016
context, IB-017 engine + twin arms → IB-018 P3, IB-019 P4/P5 wiring, IB-020
gate; IB-021 bot + users → IB-022 delivery → IB-023 tracker → IB-024 admin
commands, IB-025 morning template.

**Cluster C — stage-2 collection, ungated:** IB-027 news, IB-028 DEX
snapshots. Schedulable any time after IB-004; the Tech Lead slots them behind
A and B.

**Research contour, in parallel:** `research/squeeze-full-form/` (P1/P2 gate)
and `research/spot-lead/` (P4 arm (b)); their verdicts add or close the P1/P2
build task.

---

## 16. Rulings after dispatch

### 16.1 Binance USD-M WS mute from the local network (IB-013 probe, 2026-09-28)

**Finding** (`reports/dev3-IB-013-probe-escalation.md`): from the developers'
local network `fstream.binance.com` accepts the WS handshake and sends nothing
(three URL forms, 30 s), while Binance spot WS, Bybit, OKX and Binance futures
REST all work. This is the symptom D14 anticipated, one hop earlier than
expected. It says nothing about `ap-northeast-1`; the box probe stays the
deciding test for all three venues.

**Ruling — option (a) with a real degraded mode, not a paper exemption:**

1. **The Binance perp collector gets a `degraded` mode that is a production
   feature**, not a test shim: when the combined socket is mute (no data 30 s
   after open, or 90 s of silence later — the *later* case is the one
   signal-server's fallback does not cover, see 16.2), the collector switches
   per stream to REST polling: klines via `/fapi/v1/klines?limit=2` per
   symbol every 3 s only for the signal set and every 15 s for the rest
   (weight ≈ 3 × 20 + 27 × 4 ≈ 170/min — stated in the module header;
   acceptable only in degraded mode), mark/predicted funding via
   `/fapi/v1/premiumIndex` with no symbol (all symbols, weight 10) once per
   minute, **forceOrder has no REST equivalent and is simply missing** in
   degraded mode; the gap is recorded in `collector_gaps` with
   `repaired = 0` and `/health` shows `mode: degraded` per stream. The socket
   is retried every 5 min; recovery returns to WS. §4.1 and D14 are amended
   by this paragraph.
2. **Local acceptance of IB-005** = recorded-fixture specs for every mapper
   and the sampling/rollover logic **plus** a ≥ 30 min live run *in degraded
   mode* (klines and mark rows present every minute, liquidations absent and
   declared). **WS-path live acceptance of the perp streams happens on the
   Tokyo box**, as the first step of IB-026 (Tester), after the user's AWS
   go-ahead. IB-005's and IB-026's descriptions in `tasks/insight-bot.jsonl`
   are updated accordingly.
3. IB-008 / IB-009 (Bybit, OKX) are **not** affected locally and keep their
   done-lines; their Tokyo reachability is still unverified and is confirmed
   by the same IB-026 step.
4. No other task changes. The Tech Lead may dispatch IB-005 now.

### 16.2 Consequence for signal-server (backtest stream, for its own queue)

The coordinator's live `/api/health` shows Binance candles ~25 h stale. In
`binance.adapter.ts` the REST fallback arms only when the socket has **never**
delivered a message (`sawMessage === false`); a socket that goes mute *after*
delivering reconnects only on `close`, which a silently blocked socket never
emits. That is a signal-server bug, not an insight-bot one; I recommend the
Tech Lead files it as `BUG-` in the backtest stream: "REST fallback / reconnect
on N seconds of silence after open, not only before the first message".
`libs/binance-client` (IB-001) must lift the code **as is**; the fix lands in
the lib afterwards as its own task so both apps get it.

### 16.3 P4 spot-lead research gate — KILL ratified (2026-09-28)

`research/spot-lead/` (Researcher, Запись 36): all four registered arms fail
the fit screen; holdout unread. The hypothesis contrast — spot-led vs
perp-led advances over 1–5 days — is +0.005R [−0.041, +0.051] on 9,265 vs
3,318 trades; as a filter the label changes the mean by +0.0001R while
keeping 84 % of advances; `SPOT_LED` is 69 % of all advances and lasts one
bar. The package is admissible: DESIGN before any R, screen committed before
the holdout, 40/40 wiring checks, price-shadow control, decomposition on every
row. **Ratified as a kill.** Consequences applied in this design: §8.5 score
term → 0; §9.2 label is context only, never a `context_gate`; §9.1 P3 loses
the spot-slope trigger clause; IB-018 and IB-019 descriptions updated. The
Researcher's process flag stands for future registrations: a matched-time
placebo must draw through the same one-position rule as the arm (it was
~+0.03R anti-conservative here; it decided nothing). Arm (a) of the backlog
entry (basis-extreme convergence) stays parked.

### 16.4 Universe composition — dev-2's IB-003 calls ratified (2026-09-28)

`reports/dev-2-IB-003.md`. (1) Tokenised equity/commodity perps are excluded
by the objective spot-USDT-pair rule — ratified, and written into §2.3; this
is a product ruling in the brief's spirit ("crypto derivatives"), not an
engineering convenience, so it stands until the user says otherwise. (2)
`MARSCOINUSDT` stays on 27 days of history: the brief says top-30 by volume,
the universe is meant to be measured, and the feature layer already treats
missing history as `null`. (3) `null` venue mappings and `listed_perp` = first
archive bar — ratified. The monthly hand-revision keeps the same rule.

### 16.5 P1/P2 full-form squeeze gate — UNDERPOWERED, family CLOSED (2026-09-28)

`research/squeeze-full-form/` (Researcher, Запись 37). Formal verdict on all
four arms: UNDERPOWERED (fit n = 0 / 0 / 0 / 6 against a floor of 60);
holdout unread. Ruling: **closed for this bot, no build** — the gate required
a demonstrated rescue and none is possible when the form does not fire;
every rung with power on the ablation ladder is zero or negative (second
venue removes 30–35 % of setups and improves nothing; "OI at a 7-day high"
removes 97 %); the P1-M shadow (−0.188R, CI [−0.343, −0.028]) is the third
independent negative reading of "short the first break after a rally" on
this tape. The STAGE-0 audit's holdout *frequency* count (two-venue extreme
never occurred) is a count of arming conditions with no outcome read; I rule
it does **not** spend the holdout, and it is declared in the α ledger. The
package is admissible (DESIGN before R, 8/8 checks, gated holdout runner that
refused to run). Consequences: §9.4 closed; frame keys kept; §5 depth table
corrected (OKX funding ≈ 97 days over REST, Binance OI archive 2021-12 for
non-BTC). Draft P1's structural T1 ("VWAP of the rise") is geometrically on
the stop side of the trigger — recorded so no future squeeze draft repeats it.

**Consequence the user should see:** stage 1 now has one entry playbook,
**P3**, which has no history and lives in `SHADOW`; the brief's stage-2 gate
for AI consumers ("≥ 1 playbook passed history and 4+ weeks SHADOW agreeing
in sign") cannot be met by P3's history until months of liquidation data
exist. The gate stands as the user set it; the timeline behind it just got
longer, and P6 (unlocks, stage 2) becomes the next candidate with testable
history.

### 16.6 IB-004 schema — composite primary keys and the liquidations write rule (2026-09-28)

`reports/dev-2-IB-004.md`. Ratified: `liquidations` PK `(id, ts)` and
`collector_gaps` PK `(id, detected_at)` (Postgres requires the partition key
in every unique index; the six-column natural unique key is unchanged);
`liquidations` written with `ON CONFLICT DO NOTHING` — the rows are immutable
venue events, no archive source exists for them (§5), so a duplicate can only
be the same event seen twice and the first writer's `source` is the true
provenance. §3.1 and §3.3 updated.

### 16.7 IB-010 calendar_events — additive migration 003 ratified (2026-09-28)

`reports/dev-1-IB-010-escalation.md`. The §3.3 row omitted three things the
lifted ForexFactory logic produces and needs: `status` (a cancelled or
rescheduled event must not fire the §9.3 veto, and a reschedule mints a new
id, so the old row must be marked, not left live), `series_id` (the
next-occurrence actuals rule is keyed on the series) and `actual_source`
(guarding "never overwrite a feed/provider actual"). Ratified as dev-1's
additive migration 003 with the `(impact, currency, event_time)` index; §3.3
corrected. §9.3 governs the window: ±60 min and a T−60 notice; the "next
24 h" in IB-010's done-line was a smoke query, not a spec, and the shared
windowed query dev-1 ships is the right shape.

Two further calls from `reports/dev-1-IB-010.md`, ratified so they are not
re-litigated: (a) **hot poll cadence is ±20 min** around a high-impact event,
as signal-server and `economic-calendar.md` §3.2 have it — IB-010's "within
2 h" was my transcription error; (b) **`status` values are `scheduled` and
`cancelled` only.** A released event stays `scheduled` (the ±60 min window
still covers the hour after the print, so a released row must remain inside
the veto's positive filter); ForexFactory's `removed` maps to `cancelled`;
`rescheduled` is never written because the feed expresses a move as a new id
plus a removal with nothing linking them. §3.3's comment is corrected.
