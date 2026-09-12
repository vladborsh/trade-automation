# signal-server

Live market-data ingestion + strategy-engine plug-in slot + REST/WS API. Implements
`architecture/live-signal-server.md` §4 (server modules), §9.1 (SE-1 deliverable).

**No strategy of this project has shipped.** The only strategy plug-in wired up is
`example-cross`, a demo used to prove the plug-in slot works end to end — it is disabled by
default and is not a strategy of this project (see §4.4 and
`src/strategy-engine/strategies/example-cross/example-cross.strategy.ts`).

## Run locally (no credentials needed)

```bash
# from the repo root
npm install
npm run build --workspace=@trade-automation/contracts
npm run build --workspace=@trade-automation/signal-server

CANDLE_STORE=file \
MARKET_DATA_MODE=replay \
REPLAY_SPEED=realtime \
REPLAY_FIXTURES_DIR=apps/signal-server/test/fixtures \
INSTRUMENTS_FILE=apps/signal-server/config/instruments.yaml \
STRATEGIES_FILE=apps/signal-server/config/strategies.yaml \
node apps/signal-server/dist/main.js
```

Or, from `apps/signal-server/` directly with paths relative to that directory:

```bash
cd apps/signal-server
npm run build
CANDLE_STORE=file MARKET_DATA_MODE=replay REPLAY_SPEED=realtime node dist/main.js
```

Then:

```bash
curl localhost:3000/api/instruments
curl localhost:3000/api/health
curl "localhost:3000/api/candles?instrument=binance:BTCUSDT&timeframe=1m&from=0&to=9999999999999&limit=50"
curl localhost:3000/metrics
```

WebSocket, from any WS client:

```json
{ "type": "subscribe", "topic": "candles", "instrument": "binance:BTCUSDT", "timeframe": "1m" }
```

## Run with Docker

```bash
cd apps/signal-server
docker compose up --build
```

Boots with `CANDLE_STORE=file` and `MARKET_DATA_MODE=replay` against the bundled fixtures — no
venue credentials required. See `docker-compose.yml`.

## Configuration

Env vars are zod-validated at boot (`src/config/env.schema.ts`) — an invalid value is a boot
failure. Key ones:

| Var | Meaning |
|---|---|
| `MARKET_DATA_MODE` | `replay` (default, no credentials) or `live` |
| `CANDLE_STORE` | `file` (default) or `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` | Required when `CANDLE_STORE=s3`. `S3_ENDPOINT` points at a local S3-compatible stand-in (e.g. MinIO) for dev/testing without a real bucket. |
| `BINANCE_REST_BASE_URL`, `BINANCE_WS_BASE_URL` | Binance USD-M futures endpoints; no API key needed for market data. |
| `CAPITAL_COM_BASE_URL`, `CAPITAL_COM_IDENTIFIER`, `CAPITAL_COM_PASSWORD`, `CAPITAL_COM_API_KEY` | Required when `MARKET_DATA_MODE=live` and the universe includes a `capitalcom` instrument. |
| `WS_SHARED_TOKEN` | Optional shared token gate on the WS endpoint (`?token=`). |

The instrument universe (`config/instruments.yaml`) and strategy enablement
(`config/strategies.yaml`) are separate files, also zod-validated at boot.

## Capital.com adapter — untested against live

**No Capital.com credentials exist in this build environment** (per the Architect's routing
note, §9.1(a)). `CapitalComAdapter` and `CapitalComSession` are written against the documented
REST API shape, mirroring `cmc-bot-main`'s `capital-com-client.ts` /
`capital-com-session.ts` (session renewal, 720-bar-per-request pagination, bar-boundary
polling). They compile and are exercised by unit tests against mapped fixture payloads
(`test/market-data/capitalcom.mapper.spec.ts`), but **the adapter itself has never been run
against a live Capital.com session** — do that before relying on it, and expect to adjust
resolution/pagination constants against current venue docs (§9.1(b) — this scaffold does not
invent numbers, but venue limits do change).

To exercise Capital.com locally without those credentials, use
`MARKET_DATA_MODE=replay` with fixtures under `test/fixtures/capitalcom/<symbol>/1m.jsonl`
(bid/ask retained, matching the real payload shape).

## Storage: file vs S3

`CandleStore`/`SignalStore` are ports (§4.3); `FileCandleStore`/`FileSignalStore` and
`S3CandleStore`/`S3SignalStore` are the two implementations, selected by `CANDLE_STORE`. The
file implementation is exercised by round-trip tests against a real temp directory
(`test/storage/file-candle-store.spec.ts`). The S3 implementation is exercised against a
**mocked** `S3Client` (`aws-sdk-client-mock`, `test/storage/s3-candle-store.spec.ts`) — no real
AWS account is used or required. For a closer-to-production check, point `S3_ENDPOINT` at a
local MinIO container; a MinIO service is not included in `docker-compose.yml` (out of scope
for SE-1 — see DevOps Engineer's routing, §9.2) but the client is configured to accept a custom
endpoint for exactly this.

## Tests

```bash
npm test --workspace=@trade-automation/signal-server
npm test --workspace=@trade-automation/contracts
```

Covers (per §9.1 item 8): Binance/Capital.com payload mapping from realistic venue-shaped
fixtures; resampler boundary correctness (a plain 5m close, a UTC day boundary, a gap in the
1m stream); gap-repair fetch-and-order behaviour; file/S3 candle-store upsert idempotency; WS
subscribe/unsubscribe/ping-pong contract and forming-bar throttling; strategy-runner warm-up
gating and per-runner error isolation.

## What is intentionally not here

- Any real trading strategy — see `IDEAS-BACKLOG.md` / `RESEARCH-LOG.md` at the repo root.
  `example-cross` is a demo plug-in only.
- Position sizing / order execution — `ExecutionPort` is bound to `NoopExecution`; Integration
  Engineer fills this in once a strategy ships (§9.3).
- The Angular chart client (`apps/chart-client`, SE-2) and its mock server.
- DevOps concerns: hosting, secrets management, CI/CD, alerting (§9.2).
