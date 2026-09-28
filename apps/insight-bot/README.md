# insight-bot

Crypto insight bot: venue collectors → features → playbooks → Telegram.
Design: [`architecture/insight-bot-system-design.md`](../../architecture/insight-bot-system-design.md);
settled product brief: `architecture/crypto-insight-bot-2026-09-28.md`.

IB-003 is the scaffold: env, universe, database, `/health`, `/metrics`, image. The collectors,
the pipeline and the bot itself arrive with the later IB tasks (`tasks/insight-bot.jsonl`).

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

## Endpoints

- `GET /health` → `{ streams: [{ id, venue, lastMessageAgeSec, reconnects24h, gapsOpen }], db: { lagSec }, budget: { binanceWeightUsed1m } }` (§6.1).
  At this stage `streams` is `[]` (no collector registers one yet) and `lagSec` is `null` until
  the time-series tables exist (IB-004).
- `GET /metrics` → prom-client: `ib_stream_last_message_age_seconds{stream}`,
  `ib_rows_written_total{table}`, `ib_gaps_detected_total{stream}`,
  `ib_gaps_unrepaired_total{stream}`, `ib_binance_weight_used_1m`, `ib_ws_reconnects_total{stream}`.

## Tests

```sh
npm test --workspace=@trade-automation/insight-bot
```

Specs are hermetic: `test/setup.ts` sets `IGNORE_ENV_FILE=true` so no spec picks up a
checkout's `.env`, and the network guard fails any spec that opens a non-loopback connection.
