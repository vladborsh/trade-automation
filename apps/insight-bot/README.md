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

### One-off repair: partitions created before IB-BUG-002 (do this once)

**Every database created before the IB-BUG-002 fix has partitions that are shifted by the
database session's UTC offset**, because the bounds were written as bare date literals and the
partition keys are `timestamptz`. On a US/Pacific session each monthly partition covers
`01-<month> 07:00Z .. 01-<next> 07:00Z`, so **the first 7 hours of every UTC month have no
partition** and any write there fails with:

```
no partition of relation "candles_1m" found for row
```

Nothing breaks until a write lands in that window — the 1st of a month, 00:00–07:00 UTC — so a
database can look healthy right up to the boundary.

**Most slots do not need this repair.** Check before you touch anything, and **do not judge it by
reading the bound in a non-UTC session**: `pg_get_expr` renders a `timestamptz` in the *session's*
timezone, so a **correct** bound also prints with a `-07` suffix (`2026-10-01 00:00:00+00` shows
as `2026-09-30 17:00:00-07`). The instants differ; the suffix does not. An earlier version of this
section said "a bound ending `-07` is skewed" — that is wrong, it false-positives on a healthy
database, and acting on it cost one slot its data. Ask in UTC instead:

```sh
# your own slot's database, and only ever your own — every command below uses it
SLOT_DB=insight_dev<N>

PGTZ=UTC psql -U backtest -d "$SLOT_DB" -c \
  "select relname, pg_get_expr(relpartbound, oid) from pg_class where relname like 'candles_1m_2026%'"
```

A correct October partition then reads `FROM ('2026-10-01 00:00:00+00')`. Better still, test the
behaviour rather than the text — insert a probe row on the boundary and see which partition takes
it:

```sh
psql -U backtest -d "$SLOT_DB" -c "
  insert into candles_1m (venue,market,symbol,open_time,open,high,low,close,volume,source)
    values ('probe','perp','PROBE','2026-10-01 00:00:00+00',1,1,1,1,1,'rest');
  select tableoid::regclass::text from candles_1m where venue='probe';
  delete from candles_1m where venue='probe';"
```

`candles_1m_2026_10` means the database is fine and you should stop here. A failure (`no partition
of relation ... found for row`) or a landing in `candles_1m_2026_09` means it is skewed.

Only then repair. The code fix applies only to partitions created **after** it, so existing ones
must be rebuilt. On a dev slot, whose data is reproducible, drop and recreate — but **stop your
collector first**: a drop landing on a running collector is how one slot lost a run mid-flight.

```sh
# $SLOT_DB is your own slot's database from above, and nothing else. This is a drop: there is no
# undo, and another slot's database is someone else's running work. It stays a variable rather
# than a pasteable literal on purpose — a destructive command in a shared doc must not carry one
# slot's name where another slot can copy it.
psql -U backtest -d postgres -c "drop database if exists $SLOT_DB"
psql -U backtest -d postgres -c "create database $SLOT_DB"
# migrations and correct partitions are recreated on the next boot
```

For a database whose contents matter, rebuild the partitions instead of dropping: create the
correctly bounded partition, move the rows, then swap — do not simply `alter` the bounds, since
Postgres will not let a partition's range change while it holds rows.

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

A socket can accept the handshake and then send nothing. The IB-013 probe saw that from
`fstream.binance.com` and took it for a network block; IB-BUG-012 traced it to the legacy `/stream`
path, which Binance stopped feeding `/market` streams (kline, markPrice, forceOrder) on 2026-04-23 —
the collector now connects to `wss://fstream.binance.com/market/stream`. A mute socket remains a
first-class state, not an error:

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

## The Telegram bot and members (IB-021)

`src/delivery/` (the bot) and `src/users/` (members and invites), design §8.6 and §3.5.
Migration **005** adds `users` and `invites` — 004 was IB-011's `gap_reports`, and migration
numbers here are first-come.

**The bot needs a token that only the user can issue, and it is disabled without one.** No token
means the app still collects, still serves `/health`, and the bot simply does not start; the same
rule IB-011's sender follows. An agent never registers a bot. Set, per slot, in that slot's
`.env`:

| Variable | Meaning |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the slot's **test** bot (there is one production bot) |
| `TELEGRAM_BOT_USERNAME` | shapes the `t.me/<bot>?start=<code>` link |
| `ADMIN_TG_USER_ID` | bootstrapped as admin on every boot, idempotently |
| `TELEGRAM_SERVICE_CHAT_ID` | IB-011's operator chat (watchdog, gap report) |

Long polling (D11), so the instance opens no inbound port.

### Commands

Member: `/start <code>`, `/settings`, `/deposit <n>`, `/risk <pct>`, `/limit <pct>`,
`/lang ru|en`, `/dex on|off`. Admin: `/invite`, `/users`.

Three behaviours that are deliberate rather than incidental:

- **An unknown user gets one line and nothing else** (§8.6) — no command list, no mention that
  invites exist. A stranger who finds the bot learns nothing about it.
- **A wrong, used and expired invite give the same refusal.** Someone trying codes must not be
  able to tell them apart.
- **`/lang en` is confirmed in English.** The reply is the first proof the change took effect.

Texts are pure functions in `delivery/templates/texts.ts`, `ru` and `en` for every message, with
commands, codes and tickers left in English so both languages type the same thing.

### Invites

Single-use `t.me/<bot>?start=<code>` deep links, 7-day expiry (§3.5). Codes are 16 characters of
a 31-symbol alphabet from `crypto.randomBytes` — 80 bits, and the alphabet omits the characters
misread when a link is retyped (`0`/`O`, `1`/`l`/`I`). Consumption is one transaction with a
conditional `UPDATE`, so **two people opening the same link race safely**: exactly one becomes a
member and the other sees the ordinary refusal. There is an integration spec for precisely that.

## The dashboard's auth (IB-029)

`src/web/auth/`, design `architecture/insight-bot-web-dashboard.md` §1 W3 and §4. Migration
**006** adds `web_login_tokens` and `web_sessions`.

The flow: a member sends **`/web`** to the bot → the bot replies with a single-use link
(`WEB_BASE_URL/login?t=…`, ten minutes) → the browser POSTs the token to
`/api/web/auth/exchange` → it comes back with the `ib_session` cookie.

| Route | Auth | Result |
|---|---|---|
| `POST /api/web/auth/exchange` | public | `{token}` → `{user}` + `Set-Cookie`; 401 `TOKEN_INVALID`, 410 `TOKEN_USED` / `TOKEN_EXPIRED` |
| `GET /api/web/auth/me` | cookie | `{user}` |
| `POST /api/web/auth/logout` | public | 204, clears the cookie |

**Only hashes are stored.** Both the login token and the session cookie exist in the database
only as `sha256(token)`, so a dump of either table cannot be replayed into a session. The
plaintext lives in exactly two places: the Telegram message, and the browser.

**The login token is single-use and cannot be replayed.** It is claimed with one conditional
`UPDATE ... where used_at is null and expires_at > now`, so a link that is opened twice, or
forwarded to someone else, is already dead — the second attempt gets 410 `TOKEN_USED`. Expiry is
ten minutes because the link travels through a chat message.

**The guard is module-wide**, registered as an `APP_GUARD` in `web.module.ts` and enforcing on
the `/api/web` prefix: every controller added to `WebModule` later is authenticated by default,
with no decorator to forget. `@Public()` opts a route out (only the exchange and logout),
`@AdminOnly()` adds the role check, `@CurrentUser()` gives the member. The unauthenticated ops
`GET /health` and `/metrics` are outside the prefix and untouched — and
`test/web/web-auth.guard.spec.ts` holds the list of fields that must never appear on the ops
payload, so the two cannot quietly converge.

### Cookie attributes, and why each one

- **HttpOnly** — the dashboard never reads the cookie from JavaScript, so an XSS bug in a chart
  page cannot walk away with the session.
- **SameSite=Lax** — the dashboard makes no cross-site POSTs, so Lax costs nothing and blocks a
  form on another site acting as the member. *Not* `Strict`: the login link is followed from
  Telegram, and a `Strict` cookie is withheld on that first cross-site navigation, which would
  land the person logged out on the one flow this feature exists for.
- **Secure** — `WEB_COOKIE_SECURE`, on by deployment. IB-032 serves the dashboard through a
  Cloudflare Tunnel (HTTPS), where this must be on or the cookie can go out in clear on a
  downgrade. It is a flag only so local `http://localhost` development works.
- Sliding **30 days**, renewed by the guard when the session is over an hour stale — one write
  per hour per active session, not one per request.

A disabled member's session is deleted the moment it is next presented, so revoking access ends
the dashboard session too rather than leaving a 30-day cookie live.

## The historical backfill (IB-012)

`npm run backfill -- --symbols BTCUSDT,ETHUSDT,SOLUSDT [--from 2024-01] [--force]`

Fills the same tables the collectors write, tagged `source='archive'` (D8), from
data.binance.vision plus a REST tail. Per symbol and series it walks **monthly archive files →
daily files for the current month → REST for the hours since**. It boots config + database only,
never the collectors.

- **Idempotent and resumable by month.** Every write is the collectors' own upsert on the natural
  key (D12), and before downloading, the runner reads which months already hold rows and skips
  them (`--force` overrides). A run interrupted at month 40 of 60 costs 20 on retry.
- **Partitions are created as it goes** — a 2020 month has none on a fresh database.
- **≤ 4 parallel downloads; the REST tail is throttled to 600 weight/min** and stops outright
  when Binance's own `X-MBX-USED-WEIGHT-1M` passes 1200 (§5, D15). Steady-state collection is
  ~32/min, so a backfill cannot eat the live collectors' headroom.

### Depth is measured, and absence is not always a gap

This is the part that matters for the 8am report. The venues do not serve everything, and a
backfill that recorded every 404 as a hole would put permanent red lines in front of the operator:

| Series | Depth | Consequence |
|---|---|---|
| 1m candles, perp/spot | from `listed_perp` in `universe.yaml` | — |
| funding, Binance | 2020-01 | — |
| OI + 4× L/S, 5m | **BTCUSDT 2020-09-01, every other symbol 2021-12-01** | earlier months are `unavailable`, never requested |
| funding, Bybit | from listing (BTC 2020-03) | paged back until it reaches stored rows |
| funding, OKX | **≈ 97 days only** | every uncollected day is lost for good |
| liquidations, mark, predicted funding | none | forward only, from the day the collectors start |

`results/coverage.md` reports `missing` (a real hole) separately from `unavailable` (a month the
venue never served). Only the first is a defect.

### Checking the archive against the collectors

```sh
npm run backfill:verify -- --symbol BTCUSDT --day 2026-09-20 [--against archive|rest]
```

Compares the stored bars for one UTC day against the archive's own file, minute by minute, and
**writes nothing**. It has to work that way: `candles_1m`'s conflict key is
`(venue, market, symbol, open_time)` and does *not* include `source`, so importing a day the
collectors already covered replaces their rows — the comparison must happen before the write, not
after. `--against rest` compares with the REST API instead, which is the only option for a day
that has not closed yet (a day gains its archive file only once it is over).

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

## Market context (IB-036)

Three keyless series behind the same `CollectorsModule.register()` gate
(`src/collectors/context/`, design `insight-bot-web-dashboard.md` §10):

| Series | Source | Cadence | Backfill |
|---|---|---|---|
| `fear_greed` | `api.alternative.me/fng/` | daily 00:05 UTC | **yes** — `limit=0` returns the whole history since 2018-02-01 in one call |
| `market_cap_global` | CoinGecko `/api/v3/global` | **every 10 min** | **none possible** |
| `market_cap_coin` | CoinGecko `/coins/{id}/market_chart` | daily 00:10 UTC | 365 days, once per coin |

**`market_cap_global` is forward-only.** CoinGecko's historical endpoint is paid (401 on the free
tier), so **every 10-minute slot not collected is permanently missing** — there is nothing to
backfill from later. That is why a failed poll retries after 60 s instead of waiting out its
ten-minute slot, and why the poll starts before the one-shot backfills finish.

### Request rate, against each source's published limit

| Source | Our rate | Their limit |
|---|---|---|
| alternative.me | 1/day (+1 on first run) | none published |
| CoinGecko `/global` | 144/day = **0.1/min** | ~5–15/min keyless |
| CoinGecko `market_chart` | 20/day (+20 on first run) | same pool |

≈**165 CoinGecko requests/day ≈ 0.11/min**, about 1 % of the keyless allowance.

**A venue's published rate is a claim; the rate measured under sustained load is the fact.** The
~5–15/min above is CoinGecko's published keyless figure, from a one-off probe. Measured here:

- twenty `market_chart` calls back-to-back drew `429` — the daily average was never the
  constraint, the burst was, at ~60/min instantaneously;
- spacing them **6 s** apart (10/min) was *still* too fast: eight probe calls at that spacing
  returned `429, 429, 429, 429, 429, 429, 200, 200`, and a backfill crawled at **27 s/coin**
  because its own 60 s back-off was absorbing the excess.

So the sustainable keyless rate is **~2–3 requests/min**. The per-coin calls are spaced **30 s**
apart: twenty coins take ten minutes, which is free for a once-a-day job, and the job runs at its
stated pace instead of living in back-off. Both one-shot backfills are **skipped when the tables
already hold them**, so a restart does not re-spend the allowance on stored data.

A 429 is retried after 60 s, at most 3 times, and **every retry is logged** — a silent retry is
how a collector reports "normal" while running at a fraction of its pace. A **401 is not
retried**: that is the venue saying the endpoint is paid, not a transient failure.

**No API key is used or needed**, and none was requested. The two endpoints that require one
(`/global/market_cap_chart`, `market_chart?days=max`) are not called.

`config/universe.yaml` carries a `coingecko_id` per symbol. **Those ids were verified by price,
not by ticker** — CoinGecko lists 12 coins with the symbol BTC and 21 with PEPE, and picking the
largest market cap among them is wrong for ONE (it gives `cross-2`, while Binance's ONEUSDT
tracks `harmony`). Re-run that check when the universe is revised; the method is in the file's
header.

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
