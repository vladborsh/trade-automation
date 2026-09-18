# signal-server

Live market-data ingestion + strategy-engine plug-in slot + REST/WS API. Implements
`architecture/live-signal-server.md` §4 (server modules), §9.1 (SE-1 deliverable).

**No strategy of this project has shipped (`tier: 'live'`).** `example-cross` is a demo used to
prove the plug-in slot works end to end — it is disabled by default and is not a strategy of
this project (see §4.4 and
`src/strategy-engine/strategies/example-cross/example-cross.strategy.ts`). `vwap-band-reversal`
is a real, unvalidated strategy port at `tier: 'research'` — visualization only, disabled by
default, never able to emit a trading signal — see "Strategy plug-in: `vwap-band-reversal`"
below.

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
| `METRIC_POLL_INTERVAL_MS` | Open-interest live poll cadence, aligned to `BarClock`'s 1m tick (default `60000`). See "Open interest ingestion" below. |
| `BYBIT_REST_BASE_URL`, `BYBIT_OI_HISTORY_DAYS` | Bybit V5 public endpoint (no key) for the Bybit open-interest leg of an aggregate, and how far back its resumable Phase 2 crawl walks (default `1095` days, paced 2 req/s; architecture/aggregate-oi.md §5, §7). |
| `CALENDAR_ENABLED` | `true` (default) or `false`. `false` cleanly disables the calendar module: no poll, no notifications, and every `/api/calendar/*` route returns `503 calendar disabled`. See "Economic calendar" below. |
| `CALENDAR_FEED_BASE_URL` | ForexFactory weekly-feed base URL (`.json`/`.xml` appended); default is the live public feed. |
| `CALENDAR_POLL_INTERVAL_MS`, `CALENDAR_POLL_HOT_INTERVAL_MS` | Default (`600000` = 10 min) and hot (`120000` = 2 min) poll cadence. Hot applies within ±20 min of a high-impact event and through the Sunday ET-midnight week-roll window. |
| `CALENDAR_CACHE_LOOKBACK_DAYS` | How much history `CalendarCache` loads into memory at boot (default `400`), so `next-previous` actuals backfill can find prior monthly/quarterly occurrences. |
| `CALENDAR_DIGEST_TIME`, `CALENDAR_DIGEST_TZ` | Daily-digest fire time (default `00:00` `America/New_York` — the feed's own day). |
| `CALENDAR_NOTIFY_MIN_IMPACT`, `CALENDAR_NOTIFY_COUNTRIES` | Notification filters: minimum impact (default `low` = everything) and a comma-separated country allowlist (default empty = all). |
| `CALENDAR_DUE_CATCHUP_MS` | How late an event-due notification can still fire after a restart (default `900000` = 15 min); older than this, the event is marked released silently. |

The instrument universe (`config/instruments.yaml`), strategy enablement
(`config/strategies.yaml`) and chart layouts (`config/layouts.yaml`) are separate files, also
zod-validated at boot.

## Open interest ingestion

`architecture/chart-layouts.md` §4 — open interest is a **metric series** `(instrument,
metric)`, not an instrument: `MetricAdapter` (parallel to `VenueAdapter`), `MetricCache`,
`MetricStore` (file/S3, `metrics/` prefix), and `MetricIngestionService` (boot order: storage →
`openInterestHist` backfill tail → poll loop, mirroring `IngestionService`'s candle boot
order). Which `(instrument, metric)` pairs are ingested is driven entirely by `layouts.yaml`'s
`kind: metric` panels — there is no second place to list "which metrics to ingest". A panel
referencing a metric on a venue with no `MetricAdapter` (e.g. Capital.com — it has no OI) is
logged and left down, not a boot failure.

Only Binance is wired today (`BinanceMetricsAdapter`): history from `GET
/futures/data/openInterestHist` (5m granularity, no API key), live snapshots from `GET
/fapi/v1/openInterest` polled every `METRIC_POLL_INTERVAL_MS` (default 60s) on the existing
`BarClock` tick — not a second timer. **`openInterestHist`'s retention window was confirmed
live against `fapi.binance.com` at SE-4 build time (2026-09-12): a `startTime` more than ~30
days in the past is rejected by the endpoint itself.** The adapter clamps backfill requests to
that window and logs when it does; our own `MetricStore` is the long-term history beyond it.

`GET /api/metrics?instrument&metric&timeframe&from&to&limit` serves bucketed points
(`MetricCache` when in-window, else `MetricStore`); the WS `metrics` topic
(`{ type: 'subscribe'|'unsubscribe', topic: 'metrics', instrument, metric, timeframe }`) pushes
one bucketed point per observation, no throttling needed at ≤1/min. `GET /api/health.metrics`
and `/metrics`' `signal_server_metric_observations_total{instrument,metric}` /
`signal_server_metric_poll_errors_total` report ingestion health.

To exercise this locally without live Binance, `MARKET_DATA_MODE=replay` reads
`test/fixtures/<venue>/<symbol>/<metric>.jsonl` (one `MetricObservation` per line, ascending) —
see `test/fixtures/binance/BTCUSDT/openInterest.jsonl`, a synthetic 5m walk covering the same
window as the bundled candle fixture.

## Economic calendar

`architecture/economic-calendar.md` — a Nest module (`src/calendar/`) that ingests
ForexFactory's public weekly feed (`ff_calendar_thisweek.{json,xml}`), stores every event
forever (an `EventStore` port, file/S3, `calendar/` prefix, mirroring `MetricStore`), and
notifies over the existing WS.

- **Ingestion** (`calendar-ingestion.service.ts`) polls on the existing `BarClock` 1m tick — no
  second timer — at `CALENDAR_POLL_INTERVAL_MS` normally, `CALENDAR_POLL_HOT_INTERVAL_MS` near a
  high-impact event or the Sunday week-roll window, with `If-None-Match` conditional requests
  and exponential backoff (capped at 30 min) on a feed error. Each poll's diff is scoped to the
  snapshot's own ET week (Sun 00:00 → Sat 24:00 `America/New_York`) — a rolled-over week never
  touches a prior week's stored rows, and nothing is ever deleted (a vanished row is marked
  `status: 'removed'`).
- **Identity**: `id = 'ff:<seriesId>:<scheduledDay>'`, the series id read from the XML/CSV `url`;
  a synthetic `ffx:<sha1(...)>` id when a row can't be joined to its XML counterpart (rare —
  logged via `calendar_unjoined_rows_total`).
- **Actuals** (`actuals-backfill.service.ts`): the feed itself never carries a result. The only
  built-in source is `NextPreviousActualsSource` — when a series' next occurrence appears, its
  `previous` becomes the *prior* occurrence's `actual`, tagged `actualSource: 'next-previous'`
  (lag = one release cycle). A real-time provider is a deliberate non-goal here — it needs a key
  and a user decision on which paid provider to use (see `architecture/economic-calendar.md`
  §1.3); the `ActualsSource` port is ready for one to be added as a second adapter with no
  schema change.
- **Notifications** (`notification-scheduler.service.ts`): a daily digest at
  `CALENDAR_DIGEST_TIME`/`CALENDAR_DIGEST_TZ`, and one push per distinct event instant (several
  events at the same timestamp, e.g. FOMC, collapse into a single notification). Both are
  persisted to an append-only ledger before they're emitted, keyed by a deterministic id
  (`digest:<day>`, `due:<scheduledAt>`), so a restart never re-fires one already in the ledger.
- **API**: `GET /api/calendar/{events,week,notifications,status,events/:id}`; WS topic
  `calendar` (`{ type: 'subscribe'|'unsubscribe', topic: 'calendar' }`) pushes `calendarEvent`
  (`created`/`updated`/`removed`/`actual`) and `notification` frames. `GET /api/health` gains a
  `calendar` field (`null` when the module is disabled).
- **Disabling**: `CALENDAR_ENABLED=false` stops the poll loop and the notification scheduler
  entirely at boot (verified: zero feed requests) and every `/api/calendar/*` route responds
  `503 calendar disabled` instead of running a query against an empty/disabled cache.
- **Fixtures**: the real 2026-09-16 feed responses are committed under
  `test/fixtures/calendar/2026-09-16/` (105 events, the mapper's golden test) and are also what
  `FixtureFeedClient` serves when `MARKET_DATA_MODE=replay`.

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
subscribe/unsubscribe/ping-pong contract and forming-bar throttling (incl. `indicator` frame
routing); strategy-runner warm-up gating, tier-stamping, entry-rejection and per-runner error
isolation; `vwap-band-reversal`'s indicators (VWAP band, FVG/iFVG incl. the D-03 asymmetry,
range, ATR, prior-hour) each against a hand-computed case, the entry-window predicate across
the 2025 DST transitions, and the parity test against the Researcher's fixture (currently
skipping loudly — see below).

Per §9 SE-4: open-interest payload mapping against realistic Binance response shapes; file/S3
metric-store upsert idempotency at the `metrics/` prefix; WS `metrics` topic
subscribe/unsubscribe and per-timeframe fan-out; and `MetricIngestionService`'s boot order
(storage → backfill → poll, not just each step in isolation) against fixtures. Bucketing
correctness at every timeframe, including a day boundary, is covered in
`libs/contracts/test/metric.spec.ts`.

Per SE-CAL-1 (`architecture/economic-calendar.md` §10): `mapFeedSnapshot` against the committed
golden 2026-09-16 fixture (105 rows → 105 events, 103 series ids, the doubled `ff:832:…`/
`ff:504:…` ids, the `All`-country row, the Federal Funds Rate UTC instant, the XML/JSON
positional-then-instant join fallback); `eventDayNY`/`eventWeekWindowNY` across both 2026 DST
boundaries (`libs/contracts/test/calendar.spec.ts`); `diffSnapshot`'s create/update/remove
semantics and week-roll isolation (a snapshot from week N+1 never touches week N's stored rows);
file/S3 `EventStore` upsert idempotency; `CalendarIngestionService`'s boot order, hot-window
cadence, 304 handling and exponential backoff on a feed error; `ActualsBackfillService`'s
next-previous rule (incl. never overwriting a `feed`/`provider`-sourced actual); and
`NotificationSchedulerService`'s fake-clock behaviour — daily-digest-once-per-day with boot
catch-up, multi-event-one-notification grouping, the catch-up threshold, and ledger dedupe
across a simulated restart (a second scheduler instance seeded from the same store never
re-fires an already-ledgered notification).

## Strategy plug-in: `vwap-band-reversal` (research tier, disabled by default)

`src/strategy-engine/strategies/vwap-band-reversal/` — an unvalidated, faithful port of
`cmc-bot-main`'s `VWapStrategy` mechanical trigger (`knowledge/vwap-band-reversal-ict.md`),
built per `architecture/vwap-band-reversal-plugin.md`. It ships in `config/strategies.yaml`
with `enabled: false` and is not turned on by anything in this repository.

**Tier.** `tier: 'research'` — a class property, not config. Every `Signal` and
`IndicatorPoint` this plug-in produces is re-stamped `tier: 'research'` by
`StrategyRunnerService`, regardless of what the plug-in itself sets. A research-tier strategy
can never emit `kind: 'entry'`; the runner throws (a per-runner isolated error, not a crash) if
one tries.

**"Signal ≠ order."** This plug-in reproduces only the bot's *mechanical trigger* — the VWAP
band bias, the ATR-ratio regime filter, the proximal-edge iFVG, the 200-bar range, the
prior-hour sweep, and the stop/target the bot would compute. It does **not** reproduce the
bot's order-state layer: the 1-open-order-per-direction cap, the daily 2-loss/1-win caps, the
alive-window force-close, or the breakeven/+1R trailing (`RiskManager`, `Order`). A marker on
the chart means "the mechanic fired here", not "an order would have been placed here" — for
US100, the Researcher's `INVENTORY.md` counts 1,859 mechanical triggers against 895 orders the
bot actually placed over the same 32 months. Every emitted `Signal.meta.caveat` restates this.

Nothing here is validated. `research/cmc-bot-vwap/ARCHITECT-NOTE.md`'s pre-registered Stage 1
test has not run. This plug-in's existence is not evidence for or against the idea — see
`architecture/vwap-band-reversal-plugin.md` §0 for the full reasoning.

**Window semantics (the L-01 choice).** The live, deployed bot has two read-time quirks that
are artifacts of its polling loop, not of the strategy itself: it drops the newest bar so its
gate at bar `T` actually reads `T−1` (Researcher L-02), and its bias request can include the
still-forming candle (L-03). This plug-in does **not** reproduce either. It evaluates the
just-closed bar `T` with a window ending at `T` — the **backtest/parity semantics** the
Researcher's Python reproduction uses and proved bit-exact against the bot's own logged
decisions. This is a deliberate choice: the parity fixture (below) was generated against the
backtest semantics, so matching it is what proves the port correct; reproducing the live bot's
polling artifacts would silently break parity and would also bake a bug born of network/polling
timing into a strategy meant to be evaluated on its merits. If this plug-in is ever promoted to
`live` (see "Promotion" below), the live-read semantics question is re-opened deliberately, with
the Researcher's `PARITY.md` disposition of L-02/L-03 in hand — not inherited silently from this
build.

**Bug-faithful behaviours, pinned by test, not "fixed":** the FVG list's `lastIFVG` is
asymmetric by construction (Researcher D-03: when the bullish iFVG list is empty, `lastIFVG` is
undefined *regardless* of the bearish list's contents — the bot indexes `bearishIFvgArray[-1]`);
the 200-bar range explicitly excludes the current bar (D-06); the 00:00 UTC bar is excluded from
the day's bias window (`add(startOfDay(now), {minutes: 1})`); a main window under 6 bars is
reported as an evaluation error (mirroring the bot's unguarded 6-bar sweep-loop array access);
an empty main or bias window is likewise an error (D-18: `VWAP([])`/`range([], 200)` read past
the end of an empty array in the bot). Each of these has a unit test in
`test/strategy-engine/vwap-band-reversal/` that exists *because* the behaviour looks wrong at
first glance — do not "fix" any of them without an Architect ruling.

**Fixture provenance.** The plug-in's correctness gate is
`test/strategy-engine/vwap-band-reversal.parity.spec.ts`: it loads
`research/cmc-bot-vwap/fixtures/parity/<SYMBOL>/{candles,evals}.jsonl` (one directory per
US100/US500/EURCHF/GBPCHF), feeds the candles through `CandleCache` (the same cache and the
same `window()` the runner uses), and asserts the pure `evaluate()` function's output against
every field of the Researcher's per-bar `engine.py` dump, for 2025-03-05 through 2025-03-12 UTC
(spans the 2025-03-09 US DST switch). **As of this build, that fixture directory does not
exist** — it is exported by the Researcher at Stage-0 close-out
(`architecture/vwap-band-reversal-plugin.md` §5.3, §8.3), a dependency this build does not
block on. Run the test suite and you will see it **skip loudly** with a console warning naming
the missing path, one skip per missing symbol — never a silent pass. Once the fixture lands,
re-run the same test; it will start asserting for real, no code change required.

**Running this live, with your own credentials.** `MARKET_DATA_MODE=live` plus enabling
`vwap-band-reversal` in `config/strategies.yaml` (and flipping `enabled: true` there) requires
Capital.com credentials this build environment does not have (see "Capital.com adapter —
untested against live" above). Real credentials for the four instruments' venue exist on the
user's machine as `cmc-bot-main/.env`, under **different env var names** than this server reads
— map them yourself, do not copy the file:

| `cmc-bot-main/.env` | this server's env var |
|---|---|
| `CAPITAL_COM_CUSTOM_PASS` | `CAPITAL_COM_PASSWORD` |
| (identifier/API-key vars, see `cmc-bot-main`'s own config) | `CAPITAL_COM_IDENTIFIER`, `CAPITAL_COM_API_KEY` |

Doing this for the first time doubles as the Capital.com adapter's first live test and may
surface mapper issues — the adapter has never been run against a live session (see above). Even
running live, this plug-in still only emits `kind: 'info'`; nothing it does can reach
`ExecutionPort`, which stays `NoopExecution` regardless.

**Promotion or kill (`architecture/vwap-band-reversal-plugin.md` §5.4).** If
`research/cmc-bot-vwap`'s Stage 1 pre-registered test passes for an instrument, Integration
Engineer changes `tier` to `'live'` *in code* for that instrument set, switches `kind` to
`'entry'`, implements the order-state layer behind `ExecutionPort`, and resolves the L-02
live-read-semantics question with the Researcher's `PARITY.md` in hand — this is a code change
gated on an Architect ship ruling, never a `strategies.yaml` edit. Signals already persisted at
`research` tier keep that tier forever; the label is per-signal, not per-strategy, so history is
never retroactively relabelled. If Stage 1 kills the idea instead: delete
`strategies/vwap-band-reversal/`, its `strategies.yaml` entry and registry line, and the parity
test, and purge any persisted `data/signals/**` rows with this `strategyId` — one commit. The
contract additions this plug-in needed (`tier`, `minBars`, indicators) are generic and stay
either way.

## What is intentionally not here

- A validated trading strategy, or one running at `tier: 'live'` — see `IDEAS-BACKLOG.md` /
  `RESEARCH-LOG.md` at the repo root. `example-cross` is a demo plug-in only;
  `vwap-band-reversal` is a real but unvalidated port, research-tier and disabled by default.
- Position sizing / order execution — `ExecutionPort` is bound to `NoopExecution`; Integration
  Engineer fills this in once a strategy ships (§9.3).
- The Angular chart client (`apps/chart-client`, SE-2) and its mock server.
- DevOps concerns: hosting, secrets management, CI/CD, alerting (§9.2).
