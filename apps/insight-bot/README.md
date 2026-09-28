# insight-bot

Crypto insight bot: venue collectors → features → playbooks → Telegram.
Design: [`architecture/insight-bot-system-design.md`](../../architecture/insight-bot-system-design.md);
settled product brief: `architecture/crypto-insight-bot-2026-09-28.md`.

IB-003 scaffolded it (env, universe, database, `/health`, `/metrics`, image), IB-004 added the
partitioned time-series schema and the writers, IB-007 the first collector. The rest of the
pipeline and the bot itself arrive with the later IB tasks (`tasks/insight-bot.jsonl`).

## Your slot's port and database

Ports are assigned per slot, never chosen per session (AGENTS.md). Starting on another slot's
port or writing to another slot's database gives someone else your state, or you theirs.

| Slot | Port | Database |
|---|---|---|
| Coordinator / Tech Lead | `:3005` | `insight_coord` |
| dev-1 | `:3015` | `insight_dev1` |
| dev-2 | `:3025` | `insight_dev2` |
| dev-3 | `:3035` | `insight_dev3` |
| Tester | `:3045` | `insight_tester` |

There is **one local Postgres** for the whole repo — the `postgres` service in
`apps/signal-server/docker-compose.yml` — with one database per slot, so a migration run in one
worktree never touches another's (§7). Create yours once:

```sh
docker compose -f apps/signal-server/docker-compose.yml up -d postgres
docker compose -f apps/signal-server/docker-compose.yml exec postgres psql -U backtest -c 'create database insight_dev2'
```

## Running it

```sh
npm install                                   # from the repo root, once
npm run build --workspace=@trade-automation/insight-bot

# with a database: migrations run at boot, then universe.yaml is loaded into `symbols`
PORT=3025 DATABASE_URL=postgresql://backtest:backtest@localhost:5432/insight_dev2 \
  npm start --workspace=@trade-automation/insight-bot

# without one: DATABASE_URL has no default, so DbModule disables itself and the app still boots
PORT=3025 npm start --workspace=@trade-automation/insight-bot

curl -s localhost:3025/health | jq
curl -s localhost:3025/metrics | head
```

`npm run migrate --workspace=@trade-automation/insight-bot` runs the migrations on their own,
without booting Nest, against whatever `DATABASE_URL` is set.

In a container, `docker compose -f apps/insight-bot/docker-compose.yml up` with `INSIGHT_PORT`
and `INSIGHT_DB` set for your slot (see the comments in that file). The image is built for the
production box's architecture with `docker buildx build --platform linux/arm64`.

## Configuration

Env is zod-validated at boot (`src/config/env.schema.ts`); an invalid value is a boot failure,
not a warning. The keys that matter here:

| Key | Default | Notes |
|---|---|---|
| `PORT` | `3005` | your slot's port, above |
| `DATABASE_URL` | **none** | unset ⇒ `DbModule` is disabled and the app boots without a database |
| `DB_MIGRATE_ON_BOOT` | `true` | `false` skips migrations but still loads the universe |
| `UNIVERSE_FILE` | `config/universe.yaml` | §2.3 |
| `LOG_LEVEL` | `info` | pino |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SERVICE_CHAT_ID` | none | supplied by the user; one test bot per slot, one production bot. Never committed |
| `BINANCE_FUTURES_*`, `BINANCE_SPOT_*`, `BINANCE_ARCHIVE_BASE_URL`, `BYBIT_WS_URL`, `OKX_WS_URL` | the public endpoints | overridable for a probe or a stand-in |
| `WATCHDOG_SILENCE_MIN` | `3` | §6.2 |
| `ALERTS_PER_DAY` | `3` | §8.5 |

**Never commit a `.env`**: it holds the slot's Telegram token and its `DATABASE_URL`.

`config/universe.yaml` is the top-30 USD-M perps by 30-day volume, revised by hand monthly, and
is loaded into the `symbols` table on every boot. A symbol dropped from the file is set
`active = false`, never deleted — its collected history still references it.

## The time-series schema (migration 002)

The §3.3 tables are **partitioned monthly by native RANGE** (D7, no TimescaleDB) — all of them
except `funding_settlements` (~100k rows/year) and `calendar_events` (a few thousand), which are
plain tables.

**There is no DEFAULT partition, deliberately.** A write into a month nobody prepared fails with
`no partition of relation "…" found for row` instead of landing in a catch-all nobody queries.
`src/db/partitions.ts` is what keeps that from happening: `DbModule` creates the current month
plus three ahead at boot — after the migrations, before anything writes — and re-runs daily; the
archive backfill calls `ensureRange()` for every month it is about to touch.

Row-count estimate per year, at the 30-symbol universe (§3.3):

| Table | Rows/year | Note |
|---|---|---|
| `candles_1m` | ~31.5 M | perp + spot |
| `candles_agg` | ~3.4 M | 15m/1h/4h/1d, derived (D4) |
| `mark_funding_1m` | ~15.8 M | Binance; Bybit/OKX per-minute **only for the signal set**, the rest settlement-only |
| `open_interest_5m` | ~3.2 M | |
| `long_short_5m` | ~12.6 M | four `kind`s |
| `liquidations` | 1–5 M | event rows (D6) |
| `funding_settlements` | ~0.1 M | unpartitioned |
| **Total** | **≈ 70 M rows/yr** | **≈ 8–10 GB/yr with indexes**, in line with the brief's 50–70 M |

That is what the 50 GB gp3 volume of §7 is sized against: roughly five years of collection
before the disk is the binding constraint.

**`liquidations` undercounts on Binance.** Its `!forceOrder` stream publishes at most one event
per second per symbol, so a cascade arrives as a sample rather than a census; counts and sums
from that table are lower bounds on Binance, and a cross-venue comparison of event counts is
comparing different things. The constraint is written on the table itself (`comment on table`),
so it travels with the schema.

## The Binance USD-M perp collector (IB-005)

`src/collectors/binance-perp/` — one combined-stream socket for the whole universe:
`<sym>@kline_1m` × 30 plus `!markPrice@arr@1s` and `!forceOrder@arr` (§4.1). Closed 1m bars go
through `GapRepair` into `candles_1m` (with IB-002's taker fields); mark price is stored **once
per minute per symbol** (D5) plus one row at each settlement second; `forceOrder` events become
`liquidations` rows with the side normalised to *the side liquidated*.

It registers three streams — `binance-perp:kline_1m`, `:markPrice`, `:forceOrder` — and is
enabled only when `DATABASE_URL` is set (`CollectorsModule.register()`); without one the app
still boots and serves `/health` and `/metrics`.

**REST weight** (§4.5, D15): **≈ 0.1 weight/min** in steady state — gap repair only (5 per
repaired range) plus one `fundingRate` per symbol per 8 h settlement.

### Degraded mode (§16.1)

`fstream.binance.com` accepts the handshake from some networks and then sends nothing (the
IB-013 probe found exactly that from the dev network). The collector treats that as a first-class
state, not an error:

- **no data 30 s after the socket opens**, or **90 s of silence** once it was flowing → `degraded`;
- degraded polling: `klines?limit=2` every **3 s for the signal set**, **15 s for the rest**, and
  one symbol-less `premiumIndex` per minute — **≈ 178 weight/min ≈ 7 % of the 2400 budget**,
  acceptable only while degraded;
- **`!forceOrder` has no REST equivalent**, so liquidations in that window are *lost*: each spell
  is written to `collector_gaps` with `repaired = 0` and an explaining `error`, cut at UTC
  midnight so every daily gap report (§6.2) sees its own row;
- the socket is retried every 5 min; the first message returns the collector to `ws`;
- `/health` shows `mode` and `degradedReason` **per stream**, so a degraded run never looks healthy.

## Binance USD-M OI and long/short, 5 m (IB-007)

Registered by the same `CollectorsModule.register()` as the collector above, so it too is live
only when `DATABASE_URL` is set.

**Binance USD-M OI + long/short, 5 m** (`collectors/binance-perp/oi-ls.poller.ts`, §4.1): polls
each 5-minute boundary **+ 20 s** (the venue publishes on the boundary with a lag), five series
per symbol — `openInterestHist` → `open_interest_5m`, and `topLongShortPositionRatio`,
`topLongShortAccountRatio`, `globalLongShortAccountRatio`, `takerlongshortRatio` →
`long_short_5m` under the four `kind`s.

**Weight: 5 calls × 30 symbols per 5 min = 150 calls per 5 min — §4.5's 30 weight/min averaged
over the interval, 1.25 % of the 2400/min budget** (D15). Measured: a pass takes ~1 minute of
wall clock, so `ib_binance_weight_used_1m` peaks near **150** (6.25 % of budget, comfortably
inside) while a pass runs and decays to 0 between passes. The gauge is read live at scrape time,
so it shows that decay rather than holding the last pass's figure.

On boot it backfills the venue's 30-day window for every symbol whose newest stored slot is
stale, paging **backward** by `endTime`, paced so it does not burst. A 30-day reach-back touches
months the boot partition maintenance has not prepared, so it calls `ensureRange()` for its own
window first (§3.1).

Three things about these endpoints, **measured 2026-09-28**, that differ from what the task text
and the older signal-server adapter assumed:

- **`/futures/data/*` sends no `X-MBX-USED-WEIGHT-1M` header** (`/fapi/*` does). So
  `ib_binance_weight_used_1m` is this app's own trailing-minute count while only this poller is
  running; it switches to the venue's figure as soon as any `/fapi/*` call reports one.
  `BinanceWeightTracker.isEstimate()` says which is in use.
- **The ~30-day retention is enforced on `endTime`, not `startTime`**, and it is a `-1130`
  rejection, which the pager treats as "no more history" rather than an error. A `startTime`
  older than 30 days is now silently accepted and clamped, so it is useless as a stop signal.
- **The publication lag is per-symbol and outlives the +20 s offset**: 169 s past a boundary,
  BTCUSDT was still a slot behind while four other symbols had published. `limit=1` would drop a
  slot for good whenever the lag varies (a poll returning 13:50 then one returning 14:00 never
  fetches 13:55), so each poll takes the last **three** rows — same weight, and re-writing an
  already-stored slot is free because the upsert is idempotent (D12).

The **retention edge is not a gap**: it drifts while a page is in flight, so the oldest slot
requested is routinely one the venue no longer publishes. Gaps are measured from the oldest slot
actually served; a symbol that returns nothing at all is still one gap over the whole window.

## The Bybit collector (IB-008)

`src/collectors/bybit/` — one socket to `wss://stream.bybit.com/v5/public/linear` carrying
`tickers.{symbol}` and `allLiquidation.{symbol}` for every universe symbol that has a
`bybit_linear` mapping (28 of the 30 today; the rest are skipped and simply never register).

Three venue facts this is built on, each checked against the live venue on 2026-09-28 rather than
taken from the task text:

1. **The liquidation topic is `allLiquidation.{symbol}`.** The old `liquidation.{symbol}` is gone:
   subscribing returns `{"success":false,"ret_msg":"error:handler not found,topic:liquidation.BTCUSDT"}`.
   A refused subscription is logged loudly — never swallowed.
2. **`tickers` is snapshot-then-delta.** Deltas carry only the changed fields (the second live
   message had no `markPrice` and no `fundingRate` at all), so `TickerState` merges them onto the
   last snapshot. Reading a mark price off each message would store mostly nulls.
3. **Bybit's liquidation side is the inverse of Binance's.** Bybit's doc for this topic:
   *"When you receive a Buy update, this means that a long position has been liquidated"*, while
   Binance's `!forceOrder` reports the side the engine submits (`SELL` closes a long). Both mappers
   normalise to §3.3's "the side liquidated", and one spec pins the two venues side by side.

**Write rules** (§3.3's volume rule): `mark_funding_1m` **once per minute for the signal set**
(BTC/ETH/SOL) and **once per settlement for every other symbol** — the settlement row carries the
last prediction before the venue rolled `nextFundingTime`. Liquidations are written as they arrive.

**Funding history depth, measured** (`/v5/market/funding/history`, `category=linear`, 200/page):

| Symbol | Rows | Oldest | Pages |
|---|---|---|---|
| BTCUSDT | 7 134 | 2020-03-25 | 36 |
| ETHUSDT | 6 505 | 2020-10-21 | 33 |
| SOLUSDT | 6 112 | 2021-06-29 | 31 |

So the venue serves from listing. The boot backfill pages **backwards until it reaches rows already
stored**, which makes a cold start ~30–36 requests per symbol and a restart exactly one. It runs
**in the background**: the socket opens first, because `allLiquidation` is websocket-only and
anything missed while backfilling is lost for good.

**Rate limits are Bybit's own** — nothing here touches `ib_binance_weight_used_1m`, which is scoped
to the Binance futures budget (§4.5). Steady state is ~0.06 REST requests/minute.

## The watchdog, the daily gap report and the service chat (IB-011)

`src/ops/` — the operator's instruments (§6.2). This is the **stage-0 exit instrument**: fourteen
consecutive clean reports are the acceptance criterion, so everything here is built around one
rule — *a report that cries wolf is worse than no report*. What it refuses to alert on is as
load-bearing as what it does:

- **A degraded stream is not a silent stream.** IB-005 records a message on every answered REST
  poll for exactly this reason; `/health` and the stream's `collector_gaps` row already say it.
- **A poller is judged against its own period, not the flat threshold.** `binance-perp:oi-ls-5m`
  speaks every 5 minutes and the calendar every 10; against the default 3-minute threshold both
  alerted forever on a healthy box (found on the live run, not in a spec). Streams now declare
  `expectedIntervalSec` to `StreamRegistry.register`, and a poller is late only after missing two
  of its own cycles.
- **A stream that has never spoken** gets its window from registration, not from the epoch.
- **A recovery message only follows an alert that was actually sent.**
- **The retention edge and a mid-day start are not gaps** (§16.8, IB-007): `expected` is counted
  from the series' first stored row.

The report is **stored in `gap_reports` before it is sent** — the row is the Tester's evidence and
a Telegram outage must not cost a day of it. Without `TELEGRAM_BOT_TOKEN` /
`TELEGRAM_SERVICE_CHAT_ID` the sender is *disabled, not broken*: it logs each message at warn
level, so a dev slot runs the whole path with no bot. Tokens are the user's to issue.

Re-run a day by hand (it overwrites that day's row):

```sh
npm run report -- --day 2026-09-27
```

The CLI boots config + DB + sender only, never the collectors. Two honest limits: for the current
day it counts only up to *now* (future minutes are not missing minutes), and the Binance weight
peak reads "нет данных", because only the process that ran the day knows it.

## Endpoints

- `GET /health` → `{ streams: [{ id, venue, lastMessageAgeSec, reconnects24h, gapsOpen, mode, degradedReason, expectedIntervalSec }], db: { lagSec }, budget: { binanceWeightUsed1m } }` (§6.1, with IB-005's `mode` and IB-011's `expectedIntervalSec`).
  Streams registered today: `binance-perp:{kline_1m,markPrice,forceOrder,oi-ls-5m}`, `bybit:{tickers,allLiquidation}`.
  `lagSec` is still `null` (IB-004's tables exist, but nothing measures lag yet).
- `GET /metrics` → prom-client: `ib_stream_last_message_age_seconds{stream}`,
  `ib_rows_written_total{table}`, `ib_gaps_detected_total{stream}`,
  `ib_gaps_unrepaired_total{stream}`, `ib_binance_weight_used_1m`, `ib_ws_reconnects_total{stream}`.

## Tests

```sh
npm test --workspace=@trade-automation/insight-bot
```

Specs are hermetic: `test/setup.ts` sets `IGNORE_ENV_FILE=true` so no spec picks up a
checkout's `.env`, and the network guard fails any spec that opens a non-loopback connection.
