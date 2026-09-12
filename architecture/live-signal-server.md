# Architecture note — live signal server + chart terminal

**Author:** Architect · **Date:** 2026-09-12 · **Status:** system design,
routing to Software Engineer (scaffold), DevOps Engineer (storage pin +
hosting), Integration Engineer (deferred until a strategy ships).

This is role-to-role technical material, not user-facing (see
`PROJECT.md` → "Communicating with the user").

Inputs read for this note: `PROJECT.md`; `agents/roles/{architect,
software-engineer,integration-engineer,devops-engineer}.md`;
`IDEAS-BACKLOG.md`; `research/cmc-bot-smart-money/ARCHITECT-NOTE.md`;
`research/cmc-bot-vwap/ARCHITECT-NOTE.md`; `knowledge/smart-money-ict.md`;
`knowledge/vwap-band-reversal-ict.md`; and, in `cmc-bot-main/` (the user's
separate prior project, referenced only): `src/interfaces/exchange-client.interface.ts`,
`src/interfaces/charts/candlestick-chart-data.ts`,
`src/core/services/{binance-client,capital-com-client,capital-com-session,
dynamo-db-client,config-client}.ts`, `src/core/services/configs/capital-com.helpers.ts`,
`src/core/scheduler/scheduler.ts`, `src/strategy/{strategy-runner,strategy-template}.ts`,
`src/backtesting/chart-visualizer/`, `Dockerfile`, `.github/workflows/deploy-app.yml`,
`package.json`.

---

## 0. What this is, and what it is not

The user asked for the project's first piece of **live infrastructure**:

1. a **server** that continuously pulls market data from venues and runs
   signal-generation logic against it (a running service, not a batch
   backtest), on **NestJS**;
2. a **terminal-style chart client** on **Angular** — chart, instrument
   switching, no drawing tools now, but built so signal information can be
   overlaid on the chart later;
3. **candle persistence for backup**, on AWS, technology open (the user's
   own tentative idea: "maybe just S3, then unpack into a stream of candles").

**No strategy has shipped.** Every idea in `IDEAS-BACKLOG.md` is killed,
paused, or mid-pre-registration; the two nearest to shipping are the two
`cmc-bot` strategies (smart-money ICT, Запись 19; VWAP band reversal, in
Stage 0 now). So this server is **reusable plumbing** that a future shipped
strategy plugs into — it is designed *toward* those two as first consumers
(their data needs are the concrete requirements in §3), but it hardcodes
neither.

**Explicitly out of scope of this note** (Integration Engineer's charter,
engaged only once a strategy passes its pre-registered test): any
strategy's live trading rules, position sizing, order execution, broker
order routing. The server has a slot for those (§4.4) and the slot is empty.

**What this note decides vs. what it defers:**

| Decided here (Architect) | Deferred, and to whom |
|---|---|
| Component boundaries, module list, ports/interfaces, data model, API contract, push mechanism, charting library, monorepo layout, what to reuse from `cmc-bot-main` | — |
| **What the server needs from storage** (write/read pattern, retention, backup semantics) and a **recommendation** (S3) with tradeoffs | **DevOps Engineer** pins the storage technology, provisions it, and owns hosting/compute/secrets/CI (§6, §9.2) |
| That the strategy slot is a pure `onCandle → Signal[]` function with an empty execution port | **Integration Engineer** fills the slot for a shipped strategy: live rules, sizing, execution, live-ops hardening (§9.3) |
| That a replay adapter must let a strategy be driven over historical candles deterministically | **Backtesting** uses it once there is a strategy to backtest (§9.4) |

---

## 1. Decision 1 — relationship to `cmc-bot-main`: port the pattern, not the code

`cmc-bot-main` is the user's own separate project, out of this team's
ownership. I read its data clients and runner as prior art. Verdict: **the
new server is an independent codebase that ports specific patterns; it does
not import, wrap, or vendor `cmc-bot-main` modules.** Reasons, from the code:

- **Runtime/toolchain mismatch.** Node 16.14, `aws-sdk` v2 (in maintenance
  mode), `inversify` DI, `express`, webpack 4. NestJS wants Node ≥ 20, AWS SDK
  v3, its own DI. Wrapping would drag a second DI container and a deprecated
  SDK into a fresh service.
- **The Capital.com stream is dead code.** `CapitalComClient.start()` builds a
  bar-boundary timer whose `emitCandleData` body is `const candles = [];` and
  nothing else — it never emits. The bot actually works by *polling*:
  `StrategyRunner.execute()` is fired once a minute by `TimerScheduler` and
  calls `getCandles(symbol, tf, now-12h, now)` fresh each time. That is a
  legitimate, simple pattern for a REST-only venue and §3.2 keeps it, but
  there is nothing to reuse as a stream.
- **The Binance stream mis-stamps time.** `mapCandle` sets
  `openTime: Date.now() - interval` instead of the exchange's kline
  `startTime`. Good enough for a Telegram alert bot; not good enough for a
  server whose candles are the backup of record and are joined to signals by
  timestamp.
- **Mid-price only for CFDs.** `mapMarketDataToChartData` collapses
  Capital.com's bid/ask OHLC to `(ask+bid)/2`, discarding the spread. Both
  `cmc-bot` Architect notes flag "no honest cost model for a CFD broker" as an
  open problem; the fix starts with *keeping* bid and ask (§3.3).
- **Host-timezone bug class.** Both knowledge files document that the bot's
  session and VWAP resets are correct only on a UTC host. The new server
  pins `TZ=UTC` and asserts it at boot (§4.6) rather than inheriting the
  caveat.

**What is ported (as patterns, rewritten in Nest):**

| From `cmc-bot-main` | Becomes |
|---|---|
| `IExchangeClient { getCandles, getCandlesStream }` | `VenueAdapter` port (§4.1) — same two-method shape, sharpened contract |
| `CapitalComSession` (session renewal, 9-min lifetime; 720-bar page chunking in `getCandles`) | `CapitalComAdapter` internals |
| `BinanceClient` kline mapping, `ws.candles` with `isFinal` gate | `BinanceAdapter` internals, with exchange-stamped `openTime` |
| `TimerScheduler` (bar-boundary timer) | `BarClock` (§4.6) |
| `StrategyRunner.execute()` per-strategy loop with per-strategy try/catch | `StrategyRunner` (§4.4), one isolated runner per (strategy, instrument) |
| `interfaces/charts/{ray-line,plot-rectangle,horizontal-plot-line,...}` | The **overlay primitive** vocabulary in `Signal.overlay` (§3.4) — this is the one piece whose *shape* the client is designed around from day one |
| `ConfigClient` (S3-backed dynamic config) | Not now. Config is static (env + file) in the scaffold; an S3-backed dynamic config is a later, small addition and is noted in §4.7 |
| `DynamoDBClient` (`USER_STATE_TABLE_NAME` / `ORDER_TABLE_NAME`) | Not ported. It stores Telegram user state and orders; neither exists here yet. It is *precedent* that DynamoDB is already in the account — weighed in §6 |

**Not ported now, deliberately:** every indicator and strategy file. Those
are the subject of the two in-flight research packages (Python, bug-faithful
reproduction, Stage 0/1). The TypeScript port into *this* server happens only
after a REAL EDGE verdict, by Integration Engineer against the validated
Python — not by copying the bot's TS, which the research is explicitly
auditing for bugs (`smart-money-ict.md` §1.3, §5).

---

## 2. System overview

```
                 ┌────────────────────────────────────────────────────────────────┐
                 │  signal-server (NestJS, one long-running process, TZ=UTC)     │
                 │                                                                │
 Binance WS/REST ─┤► market-data ──► CandleCache ──► Resampler ──┐               │
 Capital.com REST─┤   (VenueAdapter   (hot window,   (M1 → M5/    │               │
                 │    per venue)      per instr×tf)   M15/H1)     ▼               │
                 │        │                              strategy-engine          │
                 │        │ closed candles                (StrategyRunner per     │
                 │        ▼                                strategy×instrument;   │
                 │   storage ◄──────────────────────────  SignalStrategy plug-ins)│
                 │   (CandleStore / SignalStore ports;          │ Signal[]        │
                 │    S3 impl recommended, File impl for dev)   ▼                 │
                 │                                       ExecutionPort (EMPTY —   │
                 │                                       Integration Engineer)    │
                 │        ▲ history                 events ▼                      │
                 │   api: REST (history, catalog)  +  WebSocket gateway (live)   │
                 └───────────┬─────────────────────────────────┬────────────────┘
                             │ HTTPS                            │ WSS
                 ┌───────────▼─────────────────────────────────▼────────────────┐
                 │  chart-client (Angular, static bundle)                        │
                 │  instrument switcher · timeframe picker · lightweight-charts  │
                 │  candle series · OverlayLayer (signals; markers now, more     │
                 │  primitives later) · connection status                        │
                 └───────────────────────────────────────────────────────────────┘
```

Single process, single writer to storage, in-memory hot state. That is the
right size for the first months: the whole live universe today is a handful
of instruments (4 Binance perps + 4 Capital.com CFDs/forex if both `cmc-bot`
strategies eventually ship) at one-minute resolution. Scaling out is a
later problem and §8 lists the seams.

---

## 3. Shared data model (`libs/contracts`)

One TypeScript package shared verbatim by server and client, so the
API/WS contract cannot drift between them. Everything below is in it.

### 3.1 Instrument

```ts
type Venue = 'binance' | 'capitalcom';          // extend by adding a literal
type InstrumentId = `${Venue}:${string}`;        // 'binance:BTCUSDT', 'capitalcom:US100'

interface Instrument {
  id: InstrumentId;
  venue: Venue;
  symbol: string;              // venue-native symbol / epic
  assetClass: 'crypto-perp' | 'index-cfd' | 'forex-cfd' | 'equity';
  displayName: string;
  pricePrecision: number;
  quoteCurrency: string;
  sessionTimezone: string;     // 'UTC' for crypto, 'America/New_York' for US indices
}
```

The instrument list is **configuration** (§4.7), not code. Adding an
instrument = adding a config entry, provided its venue adapter exists.

### 3.2 Timeframe

`type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'`.
**`1m` is the only timeframe ingested live from venues.** Everything coarser
is derived by the `Resampler` (§4.2) — one definition of "an H1 bar" for the
whole system, identical to how the research packages resample 1m → 5m/1h
(`cmc-bot-smart-money/ARCHITECT-NOTE.md` §5). Venue-native coarse bars are
fetched only as a **backfill accelerator** at boot when the M1 history in
storage is shallower than a strategy's warm-up needs (§4.1), and are marked
`source: 'venue-native'` so a mismatch with resampled bars is diagnosable.

### 3.3 Candle

```ts
interface Candle {
  instrument: InstrumentId;
  timeframe: Timeframe;
  openTime: number;            // ms since epoch, UTC, exchange-stamped bar start
  open: number; high: number; low: number; close: number;
  volume: number;              // 0 when the venue does not publish one (Capital.com CFDs: lastTradedVolume, often 0)
  closed: boolean;             // false = still-forming bar (chart only; never fed to strategies)
  source: 'venue-stream' | 'venue-rest' | 'venue-native' | 'resampled' | 'storage';
  bid?: { open: number; high: number; low: number; close: number };   // CFD venues only
  ask?: { open: number; high: number; low: number; close: number };   // CFD venues only
}
```

Rules:
- `open/high/low/close` for Capital.com is the **mid** (matches the bot and
  the research reproduction), but `bid` and `ask` are **retained and
  persisted**. Spread is the only cost information a CFD venue gives; the
  VWAP note's open problem ("no honest cost model") cannot be solved later if
  we throw it away now.
- `openTime` always comes from the venue payload (`kline.startTime` /
  `snapshotTime`), never from the local clock.
- Identity is `(instrument, timeframe, openTime)`. Storage writes are
  upserts on that key (§6.1).

### 3.4 Signal and overlay primitives

```ts
type SignalKind = 'entry' | 'exit' | 'info';
type Direction = 'long' | 'short' | 'flat';

interface Signal {
  id: string;                  // uuid
  strategyId: string;          // e.g. 'example-cross', later 'cmc-smart-money'
  instrument: InstrumentId;
  timeframe: Timeframe;        // the strategy's evaluation timeframe
  time: number;                // openTime of the bar that produced it
  kind: SignalKind;
  direction: Direction;
  levels?: { entry?: number; stop?: number; target?: number };
  confidence?: number;         // optional, 0..1; absent means "not scored"
  overlay: OverlayPrimitive[]; // what to draw for this signal
  meta: Record<string, string | number | boolean>;  // strategy-specific analytics, flat
}

type OverlayPrimitive =
  | { type: 'marker';     time: number; position: 'above' | 'below'; shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'; color?: string; text?: string }
  | { type: 'priceLine';  price: number; from?: number; to?: number; style?: 'solid' | 'dashed'; color?: string; label?: string }
  | { type: 'ray';        time: number; price: number; color?: string; label?: string }     // horizontal ray from (time, price) rightwards — the bot's true-open levels
  | { type: 'rect';       from: number; to: number; top: number; bottom: number; color?: string; label?: string }   // FVG / iFVG boxes, ranges
  | { type: 'line';       points: Array<{ time: number; price: number }>; color?: string; label?: string };        // VWAP, bands
```

This vocabulary is lifted from what the two candidate strategies actually
need to *show* (`smart-money-ict.md` §2 true-open rays, §1 FVG rectangles,
§3 range; `vwap-band-reversal-ict.md` §1 VWAP and bands). The client's
`OverlayLayer` (§5.3) is written against this union from day one, but the
scaffold only *renders* `marker` and `priceLine`; the other three are
type-complete and render as no-ops with a console warning until a strategy
needs them. That is the "leave room for a later signal overlay" requirement
made concrete: the data model is complete now, the renderers are added
per primitive when first needed.

Strategies may also emit **non-signal overlays** (an indicator someone wants
to see without a signal) via `kind: 'info', direction: 'flat'`.

### 3.5 Wire contract

REST (all JSON, all times ms-epoch UTC):

| Method / path | Returns |
|---|---|
| `GET /api/instruments` | `Instrument[]` (the configured universe, with `venueStatus: 'up' \| 'degraded' \| 'down'`) |
| `GET /api/candles?instrument&timeframe&from&to&limit` | `Candle[]` ascending; served from `CandleCache` when in-window, else from `CandleStore`; `limit` default 1500, max 5000 |
| `GET /api/signals?instrument&from&to&strategyId?` | `Signal[]` ascending |
| `GET /api/strategies` | `{ id, enabled, instruments, timeframe, warmupBars, status: 'warming' \| 'live' \| 'error' }[]` |
| `GET /api/health` | liveness + per-instrument `lastClosedCandleAge`, `gapCount24h`, `feedLag` |

WebSocket (one connection per client, JSON frames, `type` discriminated):

| Client → server | Server → client |
|---|---|
| `{ type: 'subscribe',   topic: 'candles', instrument, timeframe }` | `{ type: 'candle', candle: Candle }` — forming bars (`closed:false`) and closed bars |
| `{ type: 'unsubscribe', topic: 'candles', instrument, timeframe }` | `{ type: 'signal', signal: Signal }` — for every subscribed instrument |
| `{ type: 'subscribe',   topic: 'signals', instrument }` | `{ type: 'status', instrument, venueStatus, lastClosedCandleTime }` |
| `{ type: 'ping' }` | `{ type: 'pong', serverTime }` |

Forming-bar frames are throttled server-side to at most ~4/s per topic; the
chart does not need every Binance kline tick.

---

## 4. Server (NestJS) — modules and ports

Nest module per bounded context; every cross-module dependency is an
**injection token bound to an interface** ("port"), so a module can be
swapped (S3 ↔ file, live ↔ replay) without touching its consumers.

```
apps/signal-server/src/
  main.ts                       # asserts TZ=UTC, boots AppModule
  app.module.ts
  config/                       # ConfigModule: env + instruments.yaml + strategies.yaml (zod-validated)
  market-data/                  # MarketDataModule
    venue-adapter.port.ts       #   VENUE_ADAPTER token; interface below
    binance/binance.adapter.ts
    capitalcom/capitalcom.adapter.ts + capitalcom.session.ts
    replay/replay.adapter.ts    #   feeds candles from CandleStore/files at chosen speed (dev, tests, Backtesting)
    candle-cache.service.ts
    resampler.service.ts
    gap-repair.service.ts
    bar-clock.service.ts
    market-data.events.ts       #   CandleClosed, CandleForming, GapRepaired, VenueStatusChanged
  storage/                      # StorageModule
    candle-store.port.ts        #   CANDLE_STORE token
    signal-store.port.ts        #   SIGNAL_STORE token
    file/…  s3/…                #   two implementations each; selected by config
    write-buffer.service.ts
  strategy-engine/              # StrategyEngineModule
    signal-strategy.port.ts     #   the plug-in interface
    strategy-registry.service.ts
    strategy-runner.service.ts
    execution.port.ts           #   EXECUTION_PORT token — NoopExecution bound in scaffold
    strategies/example-cross/   #   demo plug-in, disabled by default (§4.4)
  api/                          # ApiModule
    rest/*.controller.ts
    ws/live.gateway.ts
  observability/                # pino logger, /metrics (prom-client), health indicators
```

### 4.1 `market-data` — ingestion

```ts
interface VenueAdapter {
  readonly venue: Venue;
  fetchCandles(instrument: Instrument, tf: Timeframe, from: number, to: number): Promise<Candle[]>;   // REST, paginated internally, ascending, closed bars only
  streamCandles(instrument: Instrument): Observable<Candle>;   // 1m only; emits forming (closed:false) and closed (closed:true) bars
  health(): Observable<VenueStatus>;
}
```

- **`BinanceAdapter`** — USD-M perpetuals (matches the smart-money package's
  symbol set: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT). Live via the kline
  WebSocket stream (`<symbol>@kline_1m`): every tick is a forming bar, the
  `x`/`isFinal` flag flips it to closed. History via REST `klines`
  (1500/page). Market-data endpoints need **no API key**; keys are only
  needed later for execution, which is not in this note. Reconnect with
  exponential backoff; on reconnect, hand the gap to `GapRepair`.
- **`CapitalComAdapter`** — CFDs/forex (VWAP package: US100, US500, EURCHF,
  GBPCHF). Requires session auth (`identifier` + password + `X-CAP-API-KEY`,
  session tokens valid ~10 min → renew on a timer, as the bot does).
  History via `GET /api/v1/prices/{epic}` paginated at 720 bars — port the
  bot's chunking. **Live via polling on the bar boundary** (§4.6
  `BarClock`): at `HH:MM:00 + jitter` fetch the last 2 bars, emit the
  previous one as `closed:true`, the current one as `closed:false`. Capital.com
  does have a streaming endpoint (`wss://api-streaming-capital…`) — the
  scaffold does not use it; upgrading the adapter to it is an internal
  change behind the port and is a listed follow-up, not a blocker.
  Retain `bid`/`ask` OHLC (§3.3). Respect Capital.com's market hours: outside
  the instrument's trading session the adapter emits `VenueStatus:
  'closed'`, not gaps.
- **`ReplayAdapter`** — reads candles from a `CandleStore` (or a local JSONL
  fixture) and replays them as a stream at ×1, ×N or "as fast as possible",
  with the same forming/closed semantics. Used by unit tests, local dev
  without credentials, and — later — by Backtesting to drive a real
  `SignalStrategy` over history deterministically. **This adapter is in the
  scaffold scope**, not a nice-to-have: it is how the pipeline is testable
  without live venues.
- **`CandleCache`** — in-memory ring buffer per `(instrument, timeframe)`.
  Depth is configured per timeframe (default: 1m → 3 days, 5m → 10 days,
  1h → 45 days). Sized from the strategies' declared `warmupBars` (§4.4) at
  boot — the cache must hold `max(warmupBars)` + margin. Serves the REST
  history endpoint for in-window requests and the strategy runner for
  every evaluation.
- **`Resampler`** — subscribes to closed 1m candles, maintains forming
  coarse bars, emits closed 5m/15m/1h/… bars on boundary. Bar boundaries
  are UTC-aligned (00:00 UTC anchored), which is also what the research
  packages use. The session-aware constructs the strategies need (New York
  wall-clock windows, true-open levels) are the strategy's own business,
  computed inside the strategy from UTC candles + `Instrument.sessionTimezone`
  — the resampler stays session-agnostic.
- **`GapRepair`** — for every `(instrument, 1m)` tracks the last closed
  `openTime`; on each closed candle, if `openTime − last ≠ 60_000` and the
  venue reports the market open, fetches the missing range via
  `fetchCandles`, inserts it in order, emits `GapRepaired{instrument, from,
  to, count}`, and forwards the repaired bars to Resampler/strategies in
  order. Runs also at boot ("warm-up"): storage → venue REST for the tail →
  live stream, in that order, so a restart never leaves a hole.

### 4.2 Event flow, and the closed-bar rule

`market-data` publishes on Nest's in-process event bus
(`@nestjs/event-emitter`): `CandleForming`, `CandleClosed`, `GapRepaired`,
`VenueStatusChanged`. Consumers: `Resampler` (closed 1m), `StorageModule`
(closed any-tf), `StrategyEngine` (closed only), `ApiModule`'s gateway
(forming + closed + signals).

**Strategies are evaluated on closed bars only.** Both candidate strategies
are defined as "one evaluation per M1 close" (`smart-money-ict.md` §4.1,
`vwap-band-reversal-ict.md` §2), the research reproductions are
close-only, and evaluating on forming bars would make live behaviour
untestable against them. The chart gets forming bars; strategies do not.

### 4.3 `storage` — ports

```ts
interface CandleStore {
  upsert(candles: Candle[]): Promise<void>;                                    // idempotent on (instrument, timeframe, openTime); closed bars only
  query(instrument: InstrumentId, tf: Timeframe, from: number, to: number): Promise<Candle[]>;   // ascending
  latestOpenTime(instrument: InstrumentId, tf: Timeframe): Promise<number | null>;
  stream(instrument: InstrumentId, tf: Timeframe, from: number, to?: number): AsyncIterable<Candle>;   // ordered replay — "unpack into a stream of candles"
}
interface SignalStore {
  append(signals: Signal[]): Promise<void>;
  query(instrument: InstrumentId, from: number, to: number, strategyId?: string): Promise<Signal[]>;
}
```

`WriteBuffer` sits in front of `CandleStore.upsert`: batches closed candles
per `(instrument, tf)` and flushes on whichever comes first — N bars, T
seconds (default 60 s), a UTC-day boundary, or `SIGTERM`. Which timeframes
are persisted is config; **default: persist `1m` (the backup of record) and
the derived timeframes actually consumed by an enabled strategy.** Coarse
bars are always rebuildable from 1m, so persisting them is a read-side
convenience, not a durability requirement.

Two implementations in the scaffold: **`FileCandleStore`** (local JSONL,
`data/candles/<venue>/<symbol>/<tf>/<YYYY-MM-DD>.jsonl`) and
**`S3CandleStore`** (same layout as object keys, §6.4). Same for signals.
The S3 one is the Architect's recommendation; whether it is what runs in
production is DevOps Engineer's pin (§6).

### 4.4 `strategy-engine` — the plug-in slot

```ts
interface StrategyRequirements {
  instruments: InstrumentId[];                 // which instruments this strategy runs on
  timeframe: Timeframe;                        // evaluation timeframe (bar close that triggers onCandle)
  auxTimeframes?: Timeframe[];                 // extra windows it wants in ctx (e.g. '1h' for a bias)
  warmupBars: Partial<Record<Timeframe, number>>;   // e.g. { '1m': 720, '1h': 720 } — smart-money's 12h M1 + 30d H1
}

interface StrategyContext {
  instrument: Instrument;
  now: number;                                 // openTime of the bar that just closed
  window(tf: Timeframe): readonly Candle[];    // closed bars, ascending, at least warmupBars[tf] long once 'live'
  state: StrategyState;                        // strategy-private, per-instrument, persisted via SignalStore meta (small)
  clock: { toZoned(ms: number, tz: string): ZonedTime };   // DST-correct helper; no Date-local anywhere
}

interface SignalStrategy {
  readonly id: string;
  readonly requirements: StrategyRequirements;
  onCandle(ctx: StrategyContext): Signal[];    // pure: no I/O, no timers, deterministic given ctx
}
```

- A strategy is a Nest provider registered under a multi-provider token
  (`SIGNAL_STRATEGIES`). "Plugging in" a shipped strategy = adding one Nest
  module exporting one `SignalStrategy` provider, plus a config line enabling
  it for its instruments. No change in `market-data`, `storage`, or `api`.
- **`StrategyRunner`**: one instance per `(strategy, instrument)`. Subscribes
  to `CandleClosed` on the strategy's `timeframe`, refuses to evaluate until
  every `warmupBars` requirement is met (`status: 'warming'`), then calls
  `onCandle`, persists the returned signals, publishes `SignalEmitted`, and
  hands them to `ExecutionPort`. A throw inside one runner is caught, logged
  with the strategy id and instrument, and counted — it never takes down
  ingestion or other runners (this is the bot's per-strategy `try/catch`,
  kept).
- **Determinism is a hard requirement**: `onCandle` gets everything through
  `ctx` and returns data. That is what lets the same class run under
  `ReplayAdapter` for Backtesting and under live feeds for Integration
  Engineer, and what lets a live signal be re-derived offline when a
  discrepancy is suspected.
- **`ExecutionPort`** — `onSignal(signal): Promise<void>`. Bound to
  `NoopExecution` in the scaffold. This is exactly where Integration
  Engineer's position sizing / order logic attaches later; nothing about it
  is designed here.
- **`ExampleCrossStrategy`** — the scaffold ships **one demo plug-in** so
  the pipeline can be exercised end to end (a signal appears on the chart):
  something trivially computable like "1m close crosses the 20-bar SMA →
  `info` signal with a marker". It is **disabled by default**, labelled
  `example-` in its id, and must never be described anywhere as a strategy of
  this project. Its only job is to prove the slot works.

### 4.5 `api`

- **REST** via Nest controllers, DTOs validated with `class-validator` or zod.
  History serving prefers `CandleCache`; cache-miss falls through to
  `CandleStore.query`.
- **Push: WebSocket, not SSE.** Justification: the client *switches
  instruments* — it must subscribe/unsubscribe topics on one connection
  without reconnecting, which is a bidirectional need. SSE would require one
  connection per subscription or a reconnect per switch, and offers no
  client→server frame for it. Forming-bar updates also arrive several times
  a second, which is fine on either transport but the topic-routing need
  decides it. Implemented with `@nestjs/websockets` on the native `ws`
  adapter (plain JSON frames, no socket.io protocol — keeps the client free
  of a socket.io dependency and the contract inspectable with any WS tool).
  **Infra implication for DevOps:** the load balancer/proxy must support
  WebSocket upgrade and an idle timeout longer than the client's ping
  interval (client pings every 20 s; server drops after 60 s silence).
- Auth: none in the scaffold (single-user, private). The gateway reads an
  optional shared token from a query param so DevOps can put a cheap gate in
  front without a code change. Real auth is out of scope until there is a
  second user.

### 4.6 Clock and time

- `main.ts` sets `process.env.TZ = 'UTC'` **before** anything else and
  asserts `new Date().getTimezoneOffset() === 0`; a non-UTC host fails fast.
  This is the systemic fix for the host-timezone caveat both knowledge files
  carry.
- `BarClock` emits ticks at every 1m boundary (+ a small configurable
  offset for REST venues to allow the bar to settle). Used by
  `CapitalComAdapter` polling and by the health checker ("a closed 1m candle
  is late if none arrived within 15 s of the boundary while the venue is
  open").
- All wall-clock/session logic lives *inside* strategies via
  `ctx.clock.toZoned` (date-fns-tz, as the bot uses), never in shared
  infrastructure.

### 4.7 Configuration

`instruments.yaml` (the universe), `strategies.yaml` (enablement +
per-strategy params keyed by instrument), env for secrets and storage
selection (`CANDLE_STORE=file|s3`, `S3_BUCKET`, venue credentials). Validated
at boot with zod; an invalid config is a boot failure, not a warning.

Dynamic (runtime-editable) config, the S3 `dynamic_config.json` pattern from
the bot: **not in the scaffold.** When a shipped strategy needs live-tunable
windows, add a `ConfigSource` port with an S3 implementation; the shape is
obvious and the need is not yet real.

### 4.8 Observability

Structured JSON logs (pino via `nestjs-pino`), one line per event with
`instrument`, `strategyId`, `event` fields — CloudWatch-friendly, and the
same "typed log message" discipline the bot's `LogMessageType` enum
encodes. `/metrics` (Prometheus format) with: candles received/closed per
instrument, feed lag, gap count and repaired-bar count, strategy evaluation
duration and error count, WS clients and frames sent, storage flush latency.
`/api/health` for the load balancer. OpenTelemetry tracing (the bot has it)
is not in the scaffold — add when there is a second service to trace across.

---

## 5. Client (Angular) — chart terminal

### 5.1 Stack decisions

- **Angular 20+, standalone components, Signals for state, no NgModules,
  no NgRx.** The state is small (selected instrument/timeframe, connection
  status, a candle series, a signal list); Angular Signals + a few
  `@Injectable` stores are enough. RxJS stays at the WS boundary only.
- **Charting library: TradingView Lightweight Charts (`lightweight-charts`,
  Apache-2.0).** Justification:
  - Purpose-built for financial candles; canvas-rendered, handles thousands
    of bars and per-tick `update()` without jank; ~45 KB.
  - Has exactly the overlay surface §3.4 needs: series **markers**
    (arrows/circles at a bar), **price lines**, additional **line series**
    (VWAP, bands), and — since v4 — the **series primitives / plugin API**
    for custom-drawn shapes (rectangles for FVGs, rays for true-open levels).
    So the overlay layer grows by adding a primitive renderer, not by
    switching libraries.
  - **No drawing tools**, which matches the requirement exactly; the full
    TradingView *Charting Library* (drawing tools, indicators UI) is a
    separate, licence-gated product — rejected now, and its datafeed shape is
    close enough to our REST/WS contract that moving to it later is a client
    change only.
  - Alternatives considered and rejected for now: ECharts/Plotly (general
    plotting, weaker for live candle streams and finance overlays); Chart.js
    + financial plugin (immature candlesticks); hand-rolled canvas (what
    `cmc-bot-main/src/backtesting/chart-visualizer` does — fine for a debug
    tool, not for a terminal that must grow overlays).
- "Terminal-style": dark theme, monospace UI font, dense layout, keyboard
  shortcuts (e.g. `/` to focus the instrument switcher, `[`/`]` to cycle
  timeframes). Visual details are Software Engineer's; the *structure* below
  is the design.

### 5.2 Structure

```
apps/chart-client/src/app/
  core/
    api/rest.client.ts            # typed fetchers for /api/* (contracts types)
    api/live.socket.ts            # one WS connection; subscribe/unsubscribe; reconnect w/ backoff; exposes Observables per topic
    state/instruments.store.ts    # Instrument[] + selected InstrumentId (signal)
    state/timeframe.store.ts
    state/connection.store.ts     # 'connecting' | 'live' | 'reconnecting' | 'offline' + venueStatus per instrument
    state/candles.store.ts        # current series for (instrument, tf): history load + live merge (forming bar replaces, closed bar appends)
    state/signals.store.ts        # Signal[] for current instrument; history + live
  features/
    terminal/terminal-shell.component.ts     # layout: top bar + chart pane + (future) side panel slot
    instrument-switcher/…                    # searchable dropdown over instruments.store; emits selection
    timeframe-picker/…
    status-bar/…                             # connection + venue status + last candle age
    chart/
      chart.component.ts                     # owns the lightweight-charts instance; inputs: candles(), overlays()
      chart-data.adapter.ts                  # Candle → CandlestickData (time in seconds, UTC)
      overlay/overlay-layer.ts               # interface OverlayRenderer { supports(type); attach(chart, series); render(primitives[]); clear() }
      overlay/marker.renderer.ts             # implemented in scaffold
      overlay/price-line.renderer.ts         # implemented in scaffold
      overlay/rect.renderer.ts, ray.renderer.ts, line.renderer.ts   # stubs: type-complete, warn-and-skip until needed
      overlay/signal-to-overlays.ts          # Signal[] → OverlayPrimitive[] (flattens signal.overlay, adds a default marker if a signal has none)
```

### 5.3 Behaviour

1. Boot: `GET /api/instruments` → populate switcher; restore last selection
   from `localStorage`; open WS.
2. Select `(instrument, tf)`: `GET /api/candles?…&limit=1500` → `setData`;
   `GET /api/signals?…` → overlay store; WS `subscribe candles` +
   `subscribe signals`; unsubscribe the previous pair. Switching is
   subscription churn on one socket, never a reconnect.
3. Live: `candle` frames → `candles.store` merges (same `openTime` →
   replace, newer → append) → `chart.update()`. `signal` frames → append →
   `OverlayLayer.render`.
4. Scrolling left past loaded history → `GET /api/candles` for the earlier
   range, prepend (lightweight-charts' `subscribeVisibleLogicalRangeChange`).
5. Reconnect: on WS drop, backoff-reconnect, then re-subscribe and re-fetch
   candles from the last known `openTime` to heal any hole — the client
   never trusts that it missed nothing.

The **side panel slot** in the shell and the **`OverlayLayer`** are the two
explicit extension points for "later show signal information": a signal
list/detail panel goes in the slot; richer drawings go into new renderers.
Nothing else needs to change.

### 5.4 Hosting shape (for DevOps)

Static bundle. Either served by the Nest server itself (`ServeStaticModule`,
simplest — one deployable) or from S3 + CloudFront with the API/WS origin
behind the same domain. Runtime config (API base URL, WS URL) via a
`config.json` fetched at boot, so one bundle serves all environments.

---

## 6. Candle storage / backup — requirements and recommendation

### 6.1 What the server needs from storage (the spec DevOps pins against)

| Aspect | Requirement |
|---|---|
| **Write pattern** | Append-mostly, batched (§4.3 `WriteBuffer`), **single writer** (the server). Idempotent **upsert** on `(instrument, timeframe, openTime)` — restarts and gap repairs re-write bars that may already exist. Volume is tiny: 1 row/min/instrument for 1m, i.e. ~1,440/day/instrument, ~15k/day for a 10-instrument universe; ≤ ~100 bytes/row. |
| **Read pattern** | (a) **Boot warm-up**: contiguous range scan of the last *N* days per `(instrument, tf)` (N from `warmupBars`; up to ~45 days of 1m for a 30-day H1 bias). (b) **Chart history**: contiguous range for an arbitrary window, typically ≤ 5,000 bars. (c) **Latest `openTime`** per `(instrument, tf)` to know where the venue backfill must start. (d) **Ordered replay as a stream** (`CandleStore.stream`) for `ReplayAdapter`, Backtesting, and research export. No point lookups, no secondary-attribute queries, no joins. |
| **Retention** | **1m: indefinite** — that is the backup. Derived timeframes: rebuildable, may be dropped/expired freely. Signals: indefinite (small). |
| **Backup semantics** | Durable beyond the life of the server process/host; survives a re-deploy and a region-local host loss; **versioned or immutable** so a bad flush cannot silently overwrite good history; **exportable in bulk** to the research side (Python: CSV/Parquet) without a bespoke ETL. |
| **Consistency** | Eventual is fine — the hot path reads `CandleCache`, not storage. A flush lag of a minute is acceptable; loss of ≤ one buffer on crash is acceptable *because* `GapRepair` re-fetches the tail from the venue at boot (venues keep months of 1m history). |
| **Concurrency** | One writer, few readers. No multi-writer coordination needed now. |
| **Latency** | Not on the signal path. Boot warm-up of ~45 days × 10 instruments should complete in well under a minute; chart history requests in < 1 s. |

### 6.2 Options evaluated

**S3 — raw dump, replay to stream (the user's tentative idea).**
- Fits every row of §6.1: durable, versioned (bucket versioning), lifecycle
  rules for the derived timeframes, one object per `(instrument, tf, day)`
  keeps upserts trivial (rewrite the day object from the buffer), range
  reads are a `ListObjects` + sequential `GetObject` over day keys, and
  "unpack into a stream of candles" is literally `CandleStore.stream`. Bulk
  export for research = `aws s3 sync`. With Hive-style keys (§6.4) Athena
  can query it in place later for free-form analysis.
- Costs: storage is a rounding error at this volume; requests are ~1 PUT per
  `(instrument, tf, day)` per flush — a few thousand a day at most.
- Tradeoffs: no point queries and no in-place appends — the day-object
  rewrite is the "database" work, done by `WriteBuffer`; a partial day is
  re-flushed whole. Reading "the last 3 days" is 3 gets, not a query.
  Operationally: nothing to run.
- Read-side caveat: latency per object (tens of ms) × number of day objects;
  for boot this is fine; for arbitrary chart scrolls the cache absorbs it.

**DynamoDB — precedent in the account (`USER_STATE_TABLE_NAME`, `ORDER_TABLE_NAME`).**
- Honest assessment: at *this* volume it is **not** a poor fit as a hot
  store — `PK = instrument#tf`, `SK = openTime` gives exactly the range
  query in §6.1 and native upsert. Where it *is* a poor fit is as the
  **backup of record** and for the **bulk/replay** reads: exporting years
  of 1m history means paginated `Query`/`Scan` at read-capacity cost,
  point-in-time recovery is a paid feature rather than the default, there is
  no "versioned immutable object" semantic, and research-side export needs
  code, not `aws s3 sync`. It also carries a per-request cost model and a
  400 KB item limit that make bulk backfill of history (months × instruments
  at once) the wrong shape.
- Verdict: a reasonable *future* hot store if the in-memory cache ever
  stops being enough (multi-instance, or ad-hoc queries the cache cannot
  serve). Not the backup. Not needed now.

**Amazon Timestream.**
- Time-series native, SQL, tiered memory/magnetic storage — on paper the
  best query-pattern fit. Two problems: (1) **availability** — AWS closed
  Timestream *for LiveAnalytics* to new customers in mid-2025 (DevOps must
  verify current status for this account at provisioning time; do not plan
  on it), leaving **Timestream for InfluxDB**, which is a managed
  always-on InfluxDB instance with an hourly instance cost floor and its own
  operational surface (retention policies, backups you configure, an
  instance to size); (2) the server does not need a query engine on the hot
  path — the cache is the hot path. Paying an always-on database for a
  backup role is the wrong trade at this scale.
- Verdict: no, unless DevOps finds the InfluxDB variant cheap enough and
  wants a queryable store for other reasons — then it sits *beside* S3, not
  instead of it.

**Postgres (RDS/Aurora) with a partitioned candles table** — noted for
completeness: a fine general-purpose hot store, but an always-on instance
for a workload the cache already serves. Same verdict as DynamoDB: a later
hot store, not the backup.

### 6.3 Recommendation

**S3 as the system of record and backup, the in-process `CandleCache` as the
hot store, no database now.** The user's instinct is the right one, with two
refinements: (1) write **one object per `(venue, symbol, tf, UTC day)`**,
gzip-compressed JSONL (CSV or Parquet later if research wants it) so a day
is one immutable-after-close unit; (2) turn on **bucket versioning** and a
lifecycle rule that expires old versions after ~30 days and expires derived
timeframes (everything except `1m`) after ~90 days.

**This is a recommendation, not a pin.** The technology choice is DevOps
Engineer's per their charter; §6.1 is the spec they pin against, and the
`CandleStore` port (§4.3) means their choice does not change the server's
code outside `storage/`. If they choose differently they owe a
`StorageModule` implementation and a sentence on why.

### 6.4 Layout (if S3)

```
s3://<bucket>/candles/venue=binance/symbol=BTCUSDT/tf=1m/date=2026-09-12.jsonl.gz
s3://<bucket>/candles/venue=capitalcom/symbol=US100/tf=1m/date=2026-09-12.jsonl.gz
s3://<bucket>/signals/venue=binance/symbol=BTCUSDT/date=2026-09-12.jsonl.gz
```

Hive-style `key=value` path segments so Athena/Glue can partition it without
a copy. `FileCandleStore` uses the identical relative layout on disk, so a
local `data/` directory is a byte-compatible mirror of the bucket.

---

## 7. Repository layout

```
apps/
  signal-server/        # NestJS
  chart-client/         # Angular
libs/
  contracts/            # shared types + zod schemas (§3); published to both apps via workspace
architecture/
  live-signal-server.md # this note
```

npm workspaces at the repo root (`package.json` with `"workspaces":
["apps/*","libs/*"]`); TypeScript project references; one `tsconfig.base.json`.
Node 22 LTS. Nx is *not* required — two apps and one lib do not justify it;
Software Engineer may propose it if the plain workspace hurts.

`cmc-bot-main/` and `research/` are untouched by this layout. The Python
research side and the TypeScript live side share **data files and the
storage layout** (§6.4), not code.

---

## 8. Scaling seams (not built now, but not designed away)

- **Multi-instance**: `CandleCache` is per-process. If two server instances
  are ever needed, the seam is `market-data.events` → an external bus
  (SNS/SQS or Kinesis) and a shared hot store (§6.2 DynamoDB). Nothing in the
  API or strategy engine assumes a single process except the cache.
- **Ingestion as its own service**: `MarketDataModule` + `StorageModule` can
  be split out unchanged; `StrategyEngine` would then subscribe to the bus.
- **Execution**: `ExecutionPort` is the only seam Integration Engineer needs.
- **More venues**: a new `VenueAdapter` + a `Venue` literal + config.
- **Auth/multi-user**: a Nest guard on REST and a token check on WS upgrade.

---

## 9. Routing plan

I am **not** self-dispatching Software Engineer here. The direct-dispatch
path in `agents/roles/architect.md` is for trivial, fully-specified units;
this is a multi-module scaffold with implementation judgment in it and the
coordinator asked to review before build. Dispatch is the coordinator's.

### 9.1 Software Engineer — first, now (scaffold)

Two units that can run **in parallel** as separate SE workers, because the
contract they share (§3, §3.5) is fixed in this note:

**SE-1 — `libs/contracts` + `apps/signal-server`.**
Deliverables, in build order:
1. Workspace + `libs/contracts` (types + zod schemas from §3; a tiny
   published test that the schemas round-trip).
2. `MarketDataModule`: `VenueAdapter` port; **`ReplayAdapter` first** (so
   everything downstream is testable from fixtures), then `BinanceAdapter`
   (live 1m kline WS + REST backfill, exchange-stamped `openTime`), then
   `CapitalComAdapter` (session renewal, paginated REST, bar-boundary
   polling, bid/ask retained). `CandleCache`, `Resampler`, `GapRepair`,
   `BarClock`, event bus. `TZ=UTC` assertion in `main.ts`.
3. `StorageModule`: `CandleStore`/`SignalStore` ports, `WriteBuffer`,
   `FileCandleStore` and `S3CandleStore` (AWS SDK v3, §6.4 layout), selected
   by env. Round-trip tests against the file impl; S3 impl tested against a
   local stand-in (e.g. a MinIO container or `aws-sdk-client-mock`) — no real
   AWS credentials are assumed to exist in the build.
4. `StrategyEngineModule`: `SignalStrategy` port, registry, runner with
   warm-up gating and per-runner error isolation, `ExecutionPort` bound to
   `NoopExecution`, `ExampleCrossStrategy` (disabled by default, §4.4).
5. `ApiModule`: REST controllers + WS gateway per §3.5, forming-bar
   throttle, ping/pong.
6. `observability`: pino, `/metrics`, `/api/health`.
7. `Dockerfile` (multi-stage, Node 22, non-root), `docker-compose.yml` for
   local dev with `CANDLE_STORE=file` and `ReplayAdapter` fixtures, README
   with run instructions.
8. Tests that must exist: adapter payload mapping (fixtures from real venue
   responses), resampler boundary correctness (including a day boundary and
   a gap), gap repair ordering, store upsert idempotency, WS subscribe/
   unsubscribe contract, strategy runner warm-up gating and error isolation.

**SE-2 — `apps/chart-client`.**
Built against a **mock server** (a small Nest or plain-`ws` fake implementing
§3.5 from replayed fixture candles — SE-2 writes it, it lives in
`apps/chart-client/mock-server/`) until SE-1 lands, then switched to the real
one. Deliverables: shell + instrument switcher + timeframe picker + status
bar; `ChartComponent` on `lightweight-charts` with history load, live
forming/closed merge, scroll-back pagination; WS client with reconnect and
heal; `OverlayLayer` with `marker` and `priceLine` renderers implemented and
the other three primitives stubbed; keyboard shortcuts; runtime
`config.json`; the demo signal from `ExampleCrossStrategy` visibly rendered
as a marker. Unit tests for the stores' merge logic and the WS client's
reconnect/re-subscribe; one e2e (Playwright) that boots the mock server,
switches instrument, and sees a marker.

**Escalation rule for both:** any gap in this note that requires a design
choice (not an implementation choice) goes back to Architect via the
coordinator, per `software-engineer.md` — do not improvise past it. Two
things I expect to come back and have pre-answered: (a) Capital.com
credentials are not available to the build — use `ReplayAdapter` and
fixtures; the adapter is written against the documented API and marked
"untested against live" in the README until the user runs it; (b) exact
Binance/Capital.com pagination limits — take them from the venue docs at
build time, do not copy the bot's constants blindly.

**Hand-off after build:** to the coordinator/Architect for review. **Not**
to Backtesting (the default in `software-engineer.md`) — there is no
strategy to backtest; the demo plug-in is not one.

### 9.2 DevOps Engineer — after SE-1's storage port exists (can start in parallel on the decision)

1. **Pin the storage technology** against §6.1, with §6.3 as the
   recommendation. Provision it (bucket + versioning + lifecycle, or the
   alternative), IAM policy scoped to the server's role, and a bulk-export
   path for the research side.
2. **Compute**: the server is a **single long-running process holding
   WebSockets** (to Binance inbound, to clients outbound) — so **not
   Lambda**. Options in the AWS-only constraint: ECS Fargate (one task,
   ~0.5 vCPU / 1 GB is plenty), or a small EC2 with the container. Pick and
   justify; the Dockerfile from SE-1 is the artifact.
3. **Edge**: HTTPS + WSS termination with WebSocket upgrade support and idle
   timeout ≥ 60 s (§4.5); client hosting per §5.4.
4. **Secrets**: Capital.com credentials (and later Binance trading keys) in
   Secrets Manager or SSM Parameter Store, injected as env — never as Docker
   build args (the bot's `Dockerfile` bakes secrets into the image; do not
   repeat that).
5. **CI/CD**: build/test both apps, build the image, push to ECR, deploy.
6. **Observability plumbing**: CloudWatch Logs for the pino stream,
   a metrics scrape or CloudWatch agent for `/metrics`, an alarm on
   `lastClosedCandleAge` per instrument while the venue is open.
7. Output: a runbook (user-facing parts in plain Russian per `PROJECT.md`),
   the stated storage rationale, and cost posture.

### 9.3 Integration Engineer — deferred until a strategy passes its pre-registered test

Not engaged now. When a strategy ships (currently the two candidates are the
`cmc-bot` smart-money and VWAP passes; either may be killed), their work
is: implement that strategy as a `SignalStrategy` plug-in **from the
validated Python reproduction with parity tests** (bar-for-bar against the
Stage-0 fixtures, using `ReplayAdapter`); define position sizing and
execution and bind them to `ExecutionPort`; harden live operation (stale
data, venue outages, market hours, Capital.com's streaming upgrade if
polling proves too coarse); specify uptime/latency needs to DevOps.

### 9.4 Backtesting — not in this routing

No strategy exists to re-validate. The requirement on the scaffold that
matters for them is already in SE-1: `ReplayAdapter` + a deterministic
`SignalStrategy` make "run the shipped TS strategy over stored history"
a config change, not a new harness.

### 9.5 Researcher — untouched

The VWAP Stage 0 in `researcher-cmc-bot-vwap` continues independently. Its
only future touch-point with this work is that stored 1m candles (§6.4) will
eventually be a second data source it can cross-check against
`data.binance.vision` — not now.

---

## 10. Logging decision

This is infrastructure, not a trading idea, so it does **not** get an
`IDEAS-BACKLOG.md` entry (the backlog is for ideas the Architect routes to
Researcher) or a `RESEARCH-LOG.md` Запись (entries are Идея / Исследование /
Результат for a research pass). It is recorded in `PROJECT.md`: a new
"Architecture" pointer to this note and an updated "Status". If the team
later wants a durable infra log, the right shape is an `architecture/`
index, not a research entry.

---

## 11. Amendments — 2026-09-12, for the research-tier VWAP plug-in

Driven by `architecture/vwap-band-reversal-plugin.md` (read that for the
why; this section is the *what*, because `libs/contracts` is specified
here). Each item is additive to §3/§4 unless marked as a change.

### 11.1 Strategy tier — a required label on every strategy, signal and indicator point

```ts
type StrategyTier = 'demo' | 'research' | 'live';
```

- `demo` — proves the plumbing (`example-cross`). Never a strategy of this project.
- `research` — a faithful port of a strategy that has **not** passed its
  pre-registered test. Visualization only. May never emit `kind: 'entry'`.
- `live` — passed its test; Architect ship ruling on record; Integration
  Engineer owns execution.

`Signal` gains a **required** `tier: StrategyTier`. `SignalStrategy` gains
`readonly tier: StrategyTier`, `readonly displayName: string`,
`readonly description: string` (plain-language, shown in the client). The
tier is declared **in code**, never in `strategies.yaml` — promotion is a
code change gated on an Architect ruling.

### 11.2 Runner rules (change to §4.4)

- `StrategyRunnerService` **overwrites** `tier`, `strategyId` and
  `instrument` on every signal and indicator point a strategy returns.
- A strategy whose `tier !== 'live'` returning a `kind: 'entry'` signal is a
  **runner error** (thrown → caught by the existing per-runner isolation,
  `status: 'error'`, error metric) — not coerced, not dropped silently.
- `StrategyRequirements` gains optional `minBars: Partial<Record<Timeframe, number>>`.
  `warmupBars` keeps its cache-sizing role; `isWarm` uses
  `minBars[tf] ?? warmupBars[tf]`. Rationale in the plug-in note §4: a
  session-anchored indicator's readiness is not a fixed bar count.

### 11.3 Strategy output — indicators alongside signals (change to §4.4)

```ts
interface IndicatorSeriesSpec {
  id: string;                       // e.g. 'vwap-band'
  label: string;                    // plain-language; shown as the series title
  scale: 'price';                   // only price-scale series now; a separate pane is a later addition
  keys: Array<{ key: string; label: string; color?: string; style?: 'solid' | 'dashed' }>;
}
interface IndicatorPoint {
  strategyId: string; instrument: InstrumentId; timeframe: Timeframe; tier: StrategyTier;
  seriesId: string; time: number;   // openTime of the evaluated bar
  values: Record<string, number | null>;
}
interface StrategyOutput {
  signals: Signal[];
  indicators?: Array<Pick<IndicatorPoint, 'seriesId' | 'time' | 'values'>>;   // the runner fills the rest
}
interface StrategyRequirements { …; indicators?: IndicatorSeriesSpec[] }
interface SignalStrategy { …; onCandle(ctx: StrategyContext): StrategyOutput }   // was Signal[]
```

Indicator points are **not persisted** — they are a recomputable
by-product of candles. `IndicatorCache` (strategy-engine) keeps a ring per
`(strategyId, instrument, seriesId)` sized like the candle cache for that
strategy's timeframe. Replay rebuilds them.

### 11.4 REST (addition to §3.5)

| Method / path | Returns |
|---|---|
| `GET /api/indicators?instrument&from&to&strategyId?` | `IndicatorPoint[]` ascending, from `IndicatorCache` |
| `GET /api/strategies` | each item additionally: `tier`, `displayName`, `description`, `minBars` (max over timeframes, like `warmupBars`), `indicators: IndicatorSeriesSpec[]` |

### 11.5 WebSocket (addition to §3.5)

New server→client frame, delivered to every client subscribed to
`topic: 'signals'` for the instrument — no new client→server verb:

| Server → client |
|---|
| `{ type: 'indicator', point: IndicatorPoint }` |

### 11.6 Overlay primitive tweak (addition to §3.4)

`line` gains `style?: 'solid' | 'dashed'`, matching `priceLine`. The
client's `rect`, `ray` and `line` renderers stop being stubs: one
lightweight-charts series primitive draws all three on canvas.

### 11.7 Amendment to §9.3

"Integration Engineer — deferred until a strategy passes its pre-registered
test" still holds for **execution**. The *port* of a strategy into a
`SignalStrategy` may now happen earlier, at `research` tier, when — and
only when — a Stage-0 bit-exact reproduction exists to test parity against.
That is the case for the VWAP band-reversal strategy as of 2026-09-12 and
is the subject of `architecture/vwap-band-reversal-plugin.md`.
