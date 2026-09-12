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
subscribe/unsubscribe/ping-pong contract and forming-bar throttling (incl. `indicator` frame
routing); strategy-runner warm-up gating, tier-stamping, entry-rejection and per-runner error
isolation; `vwap-band-reversal`'s indicators (VWAP band, FVG/iFVG incl. the D-03 asymmetry,
range, ATR, prior-hour) each against a hand-computed case, the entry-window predicate across
the 2025 DST transitions, and the parity test against the Researcher's fixture (currently
skipping loudly — see below).

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
