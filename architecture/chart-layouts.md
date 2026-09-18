# Architecture note — multi-panel layout-setups for the chart terminal

**Role:** Architect. **Date:** 2026-09-12. **Status:** design, routed to
Software Engineer (§9). Nothing here is implemented.
**Amended 2026-09-18 (§11):** OI plotted in USD notional and as candles; panels arranged
as one horizontal row with per-panel collapse. §11 supersedes the conflicting parts of
§2.1, §4.2, §6.1 and §6.6.

**Extends:** [`live-signal-server.md`](live-signal-server.md) (the base
system — §3 contracts, §4 server, §5 client). This is a separate note, not
an appended section, because it is a feature layered on that system with
its own routing plan, and the base note is already the size of a small
book. Section numbers below refer to *this* note unless prefixed
`base §`.

**Concurrent design to reconcile against:** the VWAP `SignalStrategy`
plug-in design (`architect-vwap-signal-design`, not landed). This note
does **not** touch `Signal`, `OverlayPrimitive`, `Instrument`, `Candle`
or `SignalStrategy`. Its `libs/contracts` additions are new files plus
additive edits to `wire.ts` (§3.4) — see §8 for the exact list the
coordinator should merge-check.

---

## 0. What the user asked for, restated as requirements

> "We will store not [individual selected] instruments but layout-setups.
> First layout: crypto trading — chart split into 4: BTC, ETH, open
> interest, DXY (Capital.com). All timeframes synchronized; scrolling one
> chart scrolls all in the same direction. Signals only on BTC/ETH.
> Second layout: 3 sections — US100, US500, DXY. Same requirements."

| # | Requirement | Where it is designed |
|---|---|---|
| R1 | The unit of selection is a **named layout**, not an instrument; layouts are **stored**, more will be added over time | §2 `layouts.yaml`, `GET /api/layouts` |
| R2 | A layout is **N panels shown simultaneously**, each bound to its own data series | §2 panel schema, §6 client |
| R3 | One panel shows **open interest** — not a candle series, not currently ingested | §4 metric series |
| R4 | One panel shows **DXY from Capital.com** — not yet in `instruments.yaml` | §5, epic confirmed |
| R5 | **One timeframe** for all panels | §6.3 (already true; verified) |
| R6 | **Scroll/zoom one → all follow**, same direction | §6.4 sync mechanism |
| R7 | **Signals rendered per panel by config**: BTC/ETH yes; OI/DXY no; layout 2 not mentioned → off | §2 `signals` flag, §6.5 |

---

## 1. Decisions at a glance

| Decision | Choice | One-line why |
|---|---|---|
| D1 Where layouts live | **Server-side `layouts.yaml`**, zod-validated at boot, served by `GET /api/layouts`; client remembers only *which* layout is active (localStorage) | The user said "store"; it is the same "named setups" shape as `instruments.yaml`/`strategies.yaml`; the server can validate panel → instrument references at boot; layouts follow the user across browsers/devices |
| D2 What open interest *is* | A **`MetricSeries`** — a new data kind keyed by `(instrument, metric)`, **not** an `Instrument` and **not** a field on one | OI is a single value over time, about an instrument but not tradeable; the candle pipeline (resampler, gap-repair, strategy eligibility, precision, session) is the wrong shape for it |
| D3 OI ingestion | New **`MetricAdapter` port** beside `VenueAdapter`; `BinanceMetricsAdapter` **polls** REST (no WS stream exists); history via `openInterestHist` at 5m; live via `/fapi/v1/openInterest` every 60 s; stored raw in a `MetricStore` (file/S3), bucketed to the requested timeframe at query time | Polling is the only ingestion shape Binance offers; storing raw observations lets us outgrow Binance's short history retention |
| D4 OI transport to client | A new WS topic **`metrics`** on the existing socket, plus `GET /api/metrics` for history | One socket, N subscriptions is the model already; a REST-polling loop on the client would be a second reconnect/heal path for ≤1 frame/min |
| D5 DXY symbol | **Resolved: `DXY`**, confirmed against the live Capital.com API (§5) | No longer a guess — checked directly with the coordinator's Capital.com session |
| D6 Panel sync | **Time-range** sync (not logical/bar-index) via a `ChartSyncService` with reentrancy guards | Panels have different bar grids (DXY has market-hours gaps, OI history is 5m-spaced); only wall-clock alignment is meaningful across them |
| D7 Signal suppression | **Upstream**: a `signals: false` panel never subscribes/fetches signals; `OverlayLayer` untouched | Zero wasted traffic, zero change to the per-signal overlay contract the VWAP design may be extending |
| D8 Layout 2 signals | `false` on all three panels **by default**, flagged as a question | Verbatim request mentions signals only for BTC/ETH; but the VWAP strategy under design targets US100/US500, so the user may want them |

---

## 2. Layouts — config shape and API

### 2.1 `apps/signal-server/config/layouts.yaml`

```yaml
# architecture/chart-layouts.md §2 — named multi-panel layout-setups.
# A layout references instruments from instruments.yaml by id; an unknown
# id is a boot failure (same rule as every other config file, base §4.7).
layouts:
  - id: crypto
    name: "Crypto trading"
    grid: { columns: 2, rows: 2 }          # panels flow row-major into the grid
    panels:
      - id: btc
        kind: candles
        instrument: "binance:BTCUSDT"
        signals: true
      - id: eth
        kind: candles
        instrument: "binance:ETHUSDT"
        signals: true
      - id: btc-oi
        kind: metric
        instrument: "binance:BTCUSDT"
        metric: openInterest
        signals: false                      # must be false for kind: metric (schema-enforced)
      - id: dxy
        kind: candles
        instrument: "capitalcom:DXY"
        signals: false

  - id: us-indices
    name: "US indices"
    grid: { columns: 1, rows: 3 }          # stacked: time axes line up vertically (§6.4)
    panels:
      - id: us100
        kind: candles
        instrument: "capitalcom:US100"
        signals: false                      # see D8 — flip to true if VWAP signals are wanted here
      - id: us500
        kind: candles
        instrument: "capitalcom:US500"     # SE adds this to instruments.yaml alongside DXY (§2 notes)
        signals: false
      - id: dxy
        kind: candles
        instrument: "capitalcom:DXY"
        signals: false
```

Notes on the concrete examples:

- **Open interest panel binds to `binance:BTCUSDT`.** The user said "open
  interest" without naming the market; BTC perp OI is the standard read
  for a crypto layout and BTC is already on the same screen. ETH OI is a
  one-line addition if wanted.
- **`us-indices` is stacked (1×3), `crypto` is 2×2.** "Split into 4
  parts" reads as a 2×2 grid; "3 sections" was not specified, and for
  time-synced charts a vertical stack is the better default because the
  time axes align. Both are one-line yaml changes — user preference wins.
- **`US500` is not in `instruments.yaml` today** (only BTCUSDT, ETHUSDT,
  US100). Its Capital.com epic is known from the VWAP research package
  (`US500`); SE adds it alongside DXY.
- **Panel `signals` defaults to `false`** in the schema — a panel shows
  signals only when the config says so, never inferred from the
  instrument or from which strategies are enabled.

### 2.2 Schema (`libs/contracts/src/layout.ts`, new file)

```ts
export const PanelKindSchema = z.enum(['candles', 'metric']);

export const PanelSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    kind: PanelKindSchema,
    instrument: InstrumentIdSchema,
    metric: MetricKindSchema.optional(),      // §4.2; required iff kind === 'metric'
    signals: z.boolean().default(false),
    title: z.string().min(1).optional(),      // default: instrument.displayName (+ " · Open interest")
  })
  .superRefine((p, ctx) => {
    if (p.kind === 'metric' && !p.metric) ctx.addIssue({ code: 'custom', message: 'metric panel needs `metric`' });
    if (p.kind === 'candles' && p.metric) ctx.addIssue({ code: 'custom', message: 'candles panel must not set `metric`' });
    if (p.kind === 'metric' && p.signals) ctx.addIssue({ code: 'custom', message: 'signals cannot render on a metric panel' });
  });

export const LayoutGridSchema = z.object({
  columns: z.number().int().min(1).max(4),
  rows: z.number().int().min(1).max(4),
});

export const LayoutSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    grid: LayoutGridSchema,
    panels: z.array(PanelSchema).min(1).max(6),
  })
  .superRefine((l, ctx) => {
    if (l.panels.length > l.grid.columns * l.grid.rows) ctx.addIssue({ code: 'custom', message: 'more panels than grid cells' });
    if (new Set(l.panels.map((p) => p.id)).size !== l.panels.length) ctx.addIssue({ code: 'custom', message: 'duplicate panel id' });
  });
export type Layout = z.infer<typeof LayoutSchema>;
export type Panel = z.infer<typeof PanelSchema>;

export const LayoutsResponseSchema = z.array(LayoutSchema);
export type LayoutsResponse = z.infer<typeof LayoutsResponseSchema>;
```

Server-side file wrapper (`apps/signal-server/src/config/layouts.schema.ts`):
`LayoutsFileSchema = { layouts: LayoutSchema[] (min 1, unique ids) }`.
`AppConfigService` loads it from `LAYOUTS_FILE` (env, default
`config/layouts.yaml`) and performs the **cross-file check**: every
`panel.instrument` must exist in `instruments.yaml`. Failure is a boot
failure, like every other config error (base §4.7). The set of `(instrument,
metric)` pairs referenced by metric panels is also what drives metric
ingestion at boot (§4.4) — the layouts file is the demand signal; there is
no second place to list "which metrics to ingest".

### 2.3 API

| Method / path | Returns |
|---|---|
| `GET /api/layouts` | `Layout[]` verbatim from config (no status decoration; per-instrument venue status is already on `GET /api/instruments` and the WS `status` frame) |

No write endpoint. Layouts are edited by editing the yaml and restarting,
exactly like instruments and strategies; runtime-editable config remains
out of scope (base §4.7's `ConfigSource` note applies unchanged).

The client persists **only** `chart-client:active-layout` (a layout id) in
localStorage, replacing today's `chart-client:selected-instrument`. On
boot it selects the stored id if it still exists, else the first layout.

---

## 3. Contracts — what changes in `libs/contracts`

New files: `layout.ts` (§2.2), `metric.ts` (§4.2). Additive edits to
`wire.ts` (§4.5) and `index.ts` (two re-exports). **No edits** to
`instrument.ts`, `candle.ts`, `signal.ts`, `strategy.ts`, `timeframe.ts`.

The client currently builds against a **local stand-in**
(`apps/chart-client/src/app/core/contracts/contracts.ts`) because
`libs/contracts` did not exist when SE-2 built it; its README lists the
swap as pending. The client unit in §9 does that swap as its step 0, so
the new types arrive from the lib rather than being hand-mirrored twice.

---

## 4. Open interest — a metric series, not an instrument

### 4.1 Why not an `Instrument`

`Instrument` (base §3.1) carries `pricePrecision`, `quoteCurrency`,
`sessionTimezone` and implies: a `VenueAdapter` streams 1m OHLCV for it,
`Resampler` derives coarser bars, `GapRepair` expects a bar every minute
while the venue is open, `CandleCache`/`CandleStore` hold it, strategies
may declare it in `requirements.instruments`, `/api/health` alarms on its
`lastClosedCandleAge`. Open interest satisfies none of that: it is one
number per observation, its natural history granularity is 5m (Binance),
its live form is a point-in-time snapshot, and it is about a market
rather than being one. A field on `Instrument` (`hasOpenInterest: true`)
would push "is this really a candle instrument?" branches into every
service above. A new top-level kind keeps them untouched.

What OI *is* about is an instrument — so a metric series is **keyed by
`(instrument, metric)`**, and the instrument must exist in
`instruments.yaml`. That gives the panel its display name, venue status,
and (later) lets a strategy ask for "OI of the instrument I trade" without
a second identity scheme.

### 4.2 Contract (`libs/contracts/src/metric.ts`, new file)

```ts
/** architecture/chart-layouts.md §4 — non-OHLCV series about an instrument. */
export const MetricKindSchema = z.enum(['openInterest']);   // extensible: 'fundingRate', 'longShortRatio', …
export type MetricKind = z.infer<typeof MetricKindSchema>;

/**
 * One raw observation as ingested and stored. `time` is the venue's stamp
 * (openInterestHist.timestamp, or /fapi/v1/openInterest.time), ms UTC — never
 * the local clock (same rule as Candle.openTime, base §3.3).
 * `value`: for openInterest, contracts outstanding in base-asset units (Binance
 * `sumOpenInterest` / `openInterest`). `notional`: quote-currency value
 * (`sumOpenInterestValue`) — present on history rows, absent on live snapshots.
 */
export const MetricObservationSchema = z.object({
  metric: MetricKindSchema,
  instrument: InstrumentIdSchema,
  time: z.number().int().nonnegative(),
  value: z.number().nonnegative(),
  notional: z.number().nonnegative().optional(),
});
export type MetricObservation = z.infer<typeof MetricObservationSchema>;

/**
 * What the wire carries: observations bucketed to a timeframe so a metric
 * panel shares the candle panels' time grid. `time` = bucket openTime
 * (floor to TIMEFRAME_MS[timeframe]); `value`/`notional` = the LAST observation
 * in the bucket. Identity is (metric, instrument, timeframe, time): a newer
 * point with the same `time` REPLACES (the forming-bar rule, base §5.3 step 3).
 */
export const MetricPointSchema = MetricObservationSchema.extend({
  timeframe: TimeframeSchema,
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;

export function metricKey(metric: string, instrument: string, timeframe: string, time: number): string {
  return `${metric}|${instrument}|${timeframe}|${time}`;
}

/** Pure, unit-tested: observations (ascending) → points for `tf`, last-in-bucket. */
export function bucketObservations(obs: readonly MetricObservation[], tf: Timeframe): MetricPoint[];
```

Two types on purpose: **observations** are stored at native granularity
(whatever cadence the source gave — 5m from history backfill, 1m from
live polling), and **points** are the timeframe-bucketed view. Storing
raw and bucketing on read is what lets the same store serve `1m` and `4h`
panels, and lets the granularity of the source change (e.g. a 30 s poll)
without a storage migration.

Consequence worth stating: on the **`1m` timeframe, history is 5m-spaced**
(Binance's finest history period) and only the live-polled window is
1m-spaced. The line series draws straight segments across the sparser
part; this is a display limitation of the source, not a bug, and it
shrinks as our own store accumulates 1m observations.

### 4.3 Source (Binance USD-M futures) — facts and what to verify at build

| Need | Endpoint | Notes (from the public docs as I know them — **SE verifies at build time**, same rule as base §9.1(b)) |
|---|---|---|
| History | `GET /futures/data/openInterestHist?symbol&period&limit&startTime&endTime` | `period` ∈ 5m…1d; `limit` ≤ 500; rows `{symbol, sumOpenInterest, sumOpenInterestValue, timestamp}`. **Retention: only roughly the latest 30 days is served** — flagged as *unconfirmed*; SE confirms the current window and records it in the adapter's header comment. No API key. |
| Live | `GET /fapi/v1/openInterest?symbol` | Point-in-time `{openInterest, symbol, time}`; request weight 1; no notional. **There is no WebSocket stream for OI** — polling is the ingestion shape, not a shortcut. |
| Deep history (research side only) | `data.binance.vision` `futures/um/.../metrics/` | 5m CSVs, used by the derivatives-positioning research package (`knowledge/derivatives-positioning.md` §1). Not a server dependency; a later offline backfill path into the same `MetricStore` layout if long OI history is ever wanted on the chart. |

Because the venue's history window is short, **our own `MetricStore` is
the long-term OI history** — one more reason it must be a persisted store
(PROJECT.md: "persistent storage is a hard requirement for market data"),
not just an in-memory cache.

### 4.4 Server design

```
apps/signal-server/src/
  market-data/metrics/
    metric-adapter.port.ts          # METRIC_ADAPTERS token; interface below
    binance/binance-metrics.adapter.ts + binance-metrics.mapper.ts
    metric-cache.service.ts         # ring buffer per (instrument, metric) of raw observations; 30 days default
    metric-ingestion.service.ts     # boot: storage → REST tail → poll loop; emits MetricObserved
    metric.events.ts                # MetricObserved { observation }
  storage/
    metric-store.port.ts            # METRIC_STORE token
    file/file-metric-store.ts       # <root>/metrics/venue=<v>/symbol=<s>/metric=<m>/date=YYYY-MM-DD.jsonl
    s3/s3-metric-store.ts           # identical relative key, gzipped (base §6.4 rule)
  api/rest/metrics.controller.ts    # GET /api/metrics
  api/rest/layouts.controller.ts    # GET /api/layouts
  api/ws/live.gateway.ts            # + 'metrics' topic (§4.5)
  config/layouts.schema.ts          # §2.2
```

```ts
interface MetricAdapter {
  readonly venue: Venue;
  readonly supports: readonly MetricKind[];
  /** REST history, paginated internally, ascending, at the source's native granularity. */
  fetchObservations(instrument: Instrument, metric: MetricKind, from: number, to: number): Promise<MetricObservation[]>;
  /** One snapshot per call; the ingestion service owns the cadence. */
  fetchLatest(instrument: Instrument, metric: MetricKind): Promise<MetricObservation>;
}
```

- **A separate port, not a method on `VenueAdapter`.** Capital.com has no
  OI; forcing every venue adapter to implement (or throw from) metric
  methods is the "is this really a candle instrument" smell again, one
  layer down. `buildVenueAdapters`' sibling `buildMetricAdapters` returns
  only Binance for now.
- **Polling cadence: 60 s, on the `BarClock` 1m tick + jitter** (the same
  clock that drives Capital.com polling, base §4.6), not a free-running
  timer — so a live observation lands once per minute, aligned to bar
  boundaries, and buckets to `1m` cleanly. Weight 1 per instrument per
  minute is negligible against Binance's limits. Cadence is an env value
  (`METRIC_POLL_INTERVAL_MS`, default 60 000), not hard-coded.
- **Boot order mirrors candles** (base §4.1 GapRepair note): load the
  store's last 30 days into `MetricCache` → backfill from
  `openInterestHist` (5m) from the latest stored observation to now →
  start polling. Backfilled and polled observations go through the same
  `WriteBuffer` → `MetricStore.upsert` (idempotent on
  `(instrument, metric, time)`).
- **Which pairs are ingested** = the metric panels of `layouts.yaml`
  (§2.2). If a layout references a metric on a venue with no
  `MetricAdapter`, the pair is logged as `down` and skipped (the
  `IngestionService` "no adapter for venue" precedent), not a boot failure.
- **Events:** `MetricObserved { observation }` on the in-process bus.
  Consumers: `StorageModule` (persist), `ApiModule` gateway (push).
  Strategies do **not** consume it now — a `SignalStrategy` wanting OI
  would need a context extension; that is a strategy-engine change and is
  out of scope here (and the derivatives-positioning line is closed).
- **`/api/health`** gains `metrics: [{ instrument, metric, lastObservationAge }]`
  (additive, default `[]`, so DevOps' existing alarm design is untouched;
  an OI alarm, if wanted, is theirs to add). `/metrics` gains
  `metric_observations_total{instrument,metric}` and
  `metric_poll_errors_total`.
- **`ReplayAdapter`-equivalent for metrics:** a `ReplayMetricAdapter` that
  reads a JSONL fixture, so the pipeline and the client's mock server work
  without live Binance. In scope, same reasoning as base §4.1.

### 4.5 Wire additions (`wire.ts`, additive)

REST:

| Method / path | Returns |
|---|---|
| `GET /api/metrics?instrument&metric&timeframe&from&to&limit` | `MetricPoint[]` ascending, bucketed to `timeframe` (§4.2); `limit` default 1500, max 5000; served from `MetricCache` when in-window, else `MetricStore` |

```ts
export const MetricsQuerySchema = z.object({
  instrument: InstrumentIdSchema, metric: MetricKindSchema, timeframe: TimeframeSchema,
  from: z.coerce.number().int().nonnegative(), to: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(5000).default(1500),
});
export const MetricsResponseSchema = z.array(MetricPointSchema);
```

WebSocket (the existing socket, one more topic):

| Client → server | Server → client |
|---|---|
| `{ type: 'subscribe',   topic: 'metrics', instrument, metric, timeframe }` | `{ type: 'metric', point: MetricPoint }` — one frame per observation, already bucketed to the subscribed `timeframe`; same-`time` frames replace |
| `{ type: 'unsubscribe', topic: 'metrics', instrument, metric, timeframe }` | |

Schemas: `WsSubscribeMetricsSchema`, `WsUnsubscribeMetricsSchema` added to
the `topic` discriminated unions; `WsMetricMessageSchema` added to
`WsServerMessageSchema`. `HealthResponseSchema.metrics` as above. Gateway
`ClientState` gains `metricTopics: Set<'${instrument}|${metric}|${timeframe}'>`
and `onMetricObserved` fans one bucketed point per subscribed timeframe.
At ≤1 observation/min no throttle is needed.

**Why WS and not REST-only (D4):** the client already has one socket with
subscription churn, reconnect and a heal-on-reconnect path per feed. A
metric panel that polled REST would need its own timer, its own
"reconnect" semantics and its own staleness handling — more code than a
frame type, for a series that is *less* frequent than candles. Uniformity
across panel kinds is the point: `PanelFeed` (§6.2) treats
candles and metrics identically except for the topic name.

---

## 5. DXY via Capital.com — resolved 2026-09-12

**Answered directly against the live Capital.com API** (session + `GET
/api/v1/markets/DXY`, using the credentials already in
`cmc-bot-main/.env`) — no longer an open question:

- **Epic/symbol: `DXY`**. `instrumentType: INDICES`, name "US Dollar
  Index", `streamingPricesAvailable: true`. This is the spot/rolling CFD;
  a separate dated future (`DXZ2026`) also exists and is not this
  instrument — use `DXY`.
- **Trading hours are near-continuous, not the US cash-session shape
  US100/US500 have**: Mon–Fri 00:00–21:00 UTC plus a Sun 22:00–00:00 UTC
  open (the market's own `openingHours`, zone UTC). Set
  `sessionTimezone: UTC` for this instrument in `instruments.yaml` — do
  not reuse `America/New_York` from the index CFDs, and do not assume the
  same "closed" windows as US100/US500 when the adapter reports
  `VenueStatus`.

`instruments.yaml` and `layouts.yaml` below use `capitalcom:DXY` directly;
the panels no longer need to stay commented out or stand in behind
`DXY-MOCK` for the real config (the mock server may still use a
`DXY-MOCK` fixture id purely as a build/e2e convenience, since it has no
real Capital.com session either — that is an SE implementation detail,
not an open design question anymore).

Second question, lower stakes (D8): *the VWAP strategy currently being
designed targets US100/US500 — should its signals show on the
"US indices" layout?* Default in this note: no (`signals: false`),
matching the literal request. Changing it is a one-line yaml edit.

---

## 6. Client — panel grid, feeds, sync

### 6.1 Structure (delta to base §5.2)

```
apps/chart-client/src/app/
  core/
    contracts/contracts.ts            # DELETED — step 0: import @trade-automation/contracts (README's pending swap)
    state/layouts.store.ts            # NEW  Layout[] + activeLayoutId (localStorage 'chart-client:active-layout')
    state/instruments.store.ts        # KEEP the universe (displayName/precision/status lookups); DROP `selected` + its localStorage key
    state/timeframe.store.ts          # UNCHANGED (§6.3)
    state/connection.store.ts         # UNCHANGED (already per-instrument)
    state/candles.store.ts            # KEEP logic; no longer providedIn:'root' — one instance per panel (constructed by PanelFeed)
    state/signals.store.ts            # same
    state/metric-points.store.ts      # NEW  MetricPoint[] container; mergePoint = same time → replace, newer → append (mirrors mergeCandle)
    state/panel-feed.ts               # NEW  one per panel: owns its stores + WS topic pair + pagination + heal (§6.2)
    state/layout-feed.service.ts      # NEW  replaces market-feed.service.ts: boot, (activeLayout, timeframe) → N PanelFeeds
  features/
    layout-switcher/…                 # NEW  replaces instrument-switcher (dropdown over layouts.store; `/` focuses it)
    terminal/terminal-shell.component.ts   # top bar: layout switcher + timeframe picker; body: <app-panel-grid>; keyboard shortcuts unchanged
    panel-grid/panel-grid.component.ts     # NEW  CSS grid from layout.grid; one <app-chart-panel> per panel; PROVIDES ChartSyncService (§6.4)
    panel-grid/chart-panel.component.ts    # NEW  header (title, venue status dot) + <app-chart>; binds its PanelFeed's signals to chart inputs
    chart/chart-sync.service.ts            # NEW  shared visible-time-range coordinator (§6.4)
    chart/chart.component.ts               # CHANGED: `kind` input, `points` input, LineSeries path, visibleRange in/out, prepend-preserves-range
    chart/chart-data.adapter.ts            # + toLineData(MetricPoint) → { time: s, value }
    chart/overlay/*                        # UNCHANGED
    status-bar/…                           # iterates the active layout's distinct instruments instead of the one selected
```

The `instrument-switcher` is removed rather than hidden: the user's
framing is "layouts instead of instruments", and an ad-hoc single chart
is expressible as a one-panel layout in yaml. If a free-form "open any
instrument" panel is wanted later, that is a `kind: 'candles'` panel
with a runtime-chosen instrument — an additive feature, not a reason to
keep two selection models now.

### 6.2 `PanelFeed` — one feed per panel

`MarketFeedService` today is a singleton wired to one `CandlesStore`,
one `SignalsStore`, one `(instrument, timeframe)`. It becomes
`LayoutFeedService` (singleton, boot + orchestration) plus `PanelFeed`
(plain class, N instances):

```ts
class PanelFeed {
  readonly candles = new CandlesStore();          // kind === 'candles'
  readonly points  = new MetricPointsStore();     // kind === 'metric'
  readonly signals = new SignalsStore();          // populated only when panel.signals === true
  constructor(readonly panel: Panel, readonly timeframe: Timeframe, deps: { rest, socket })
  async start(): Promise<void>      // history GETs (candles|metrics, + signals iff panel.signals) → subscribe topics → frame subscriptions
  stop(): void                      // unsubscribe topics, drop frame subscriptions
  loadOlder(): Promise<void>        // per-panel scroll-back page (candles or metrics), prepend
  healAfterReconnect(): Promise<void>
}
```

`LayoutFeedService`:

```ts
effect(() => {
  const layout = this.layouts.active();
  const tf = this.timeframe.selected();
  if (layout) void this.rebuild(layout, tf);   // stop all PanelFeeds → new PanelFeed per panel → start all; sync.reset()
});
```

Boot: `config.load()` → `GET /api/instruments` + `GET /api/layouts` in
parallel → stores → open WS (unchanged socket, unchanged reconnect/heal
plumbing: `reconnected` now fans out to every live `PanelFeed`). Switching
layout or timeframe is subscription churn on the one socket, never a
reconnect (base §5.3 step 2 holds with N pairs instead of one).

`LiveSocket` gains `subscribeMetrics/unsubscribeMetrics/metricsFor` — the
same three-method shape as candles — and its `activeTopics` map already
survives reconnect for any number of topics.

### 6.3 Timeframe sync — already true, verified

`TimeframeStore` (`core/state/timeframe.store.ts`) is a root singleton
holding one `Timeframe` signal with localStorage persistence; the picker
and the `[`/`]` shortcuts write to it and nothing else reads a per-chart
timeframe. R5 is therefore satisfied by construction the moment all
panels are driven from the same store, which `LayoutFeedService`'s single
effect does. **No change to the store or the picker.** The only new
behaviour is that a timeframe change now rebuilds N feeds instead of one.

### 6.4 Scroll/zoom sync — `ChartSyncService`

**Time-based, not index-based (D6).** lightweight-charts exposes both
`visibleLogicalRange` (bar indices) and `visibleRange` (times). The four
panels have different bar grids: Binance perps trade 24/7, Capital.com
CFDs have session gaps, OI history is 5m-spaced. Syncing bar indices would
put "bar 500" of BTC next to a different wall-clock time on DXY; syncing
the **time window** keeps every panel on the same wall-clock span, which
is what a trader comparing markets means by "scroll together". A side
effect: panels may show different *bar counts* for the same window —
that is correct, not a defect.

Mechanism (one instance per `PanelGridComponent`, provided in its
`providers: []` so tests can instantiate it in isolation):

```ts
@Injectable()
export class ChartSyncService {
  private readonly _range = signal<TimeRange | null>(null);
  private readonly _origin = signal<string | null>(null);   // panel id that proposed the current range
  readonly range = this._range.asReadonly();
  readonly origin = this._origin.asReadonly();

  /** Called by a panel on a USER-driven visible-time-range change. */
  propose(panelId: string, range: TimeRange, epsilonSec: number): void {
    const cur = this._range();
    if (cur && sameRange(cur, range, epsilonSec)) return;   // drift guard
    this._origin.set(panelId);
    this._range.set(range);
  }
  reset(): void { this._range.set(null); this._origin.set(null); }   // on layout/timeframe rebuild
}
```

Per `ChartComponent` (given `panelId`, `syncEpsilonSec` = half the current
timeframe in seconds, and the injected service):

1. **Drive:** `timeScale().subscribeVisibleTimeRangeChange(r => { if (this.applying || !r || sameRange(r, this.lastApplied, eps)) return; sync.propose(panelId, r, eps); })`.
2. **Follow:** `effect(() => { const r = sync.range(); if (!r || sync.origin() === panelId) return; this.applying = true; try { timeScale().setVisibleRange(r); this.lastApplied = r; } finally { this.applying = false; } })`.

Two reentrancy guards, both required:

- `applying` suppresses the range-change callback fired **synchronously**
  by the follower's own `setVisibleRange`.
- `lastApplied` + epsilon suppresses the callback if the library fires it
  **asynchronously** (next frame) and suppresses the *snap echo*: a
  follower snaps the requested window to its own bar grid and would
  otherwise re-propose a slightly different window, moving the driver,
  which re-proposes, … The epsilon (half a bar) is larger than any snap.

Together: only user gestures (wheel, drag, keyboard) produce proposals;
followers never bounce. Latest gesture wins — there is no "leader"
election, because a gesture can only be on one panel at a time.

Interaction with pagination (base §5.3 step 4): each panel paginates
**its own** series when its `visibleLogicalRange.from ≤ 10`, including
when that condition is reached by a programmatic `setVisibleRange` — the
follower panels load older history on their own as the driver scrolls
back, which is exactly the wanted behaviour. **Prepend must be
range-neutral:** `ChartComponent`, when `renderCandles`/`renderPoints`
detects a prepend (series grew at the front), captures
`getVisibleRange()` before `setData` and restores it after, under the
`applying` guard. Without this, one panel's page load could shift its
window and propagate a jump to the others.

On rebuild (layout or timeframe change) `sync.reset()` is called before
the new feeds start; the first range-change after data lands (from
whichever panel renders first) seeds the shared range and the rest
follow. Crosshair sync (`setCrosshairPosition`) is a trivial follow-up on
the same service and is **not** in scope.

### 6.5 Per-panel signal visibility — upstream, not in the renderer

`panel.signals === false` ⇒ `PanelFeed.start()` does not `GET
/api/signals`, does not `subscribe signals`, and its `signals` store stays
empty ⇒ `ChartPanelComponent` passes `overlays = []` ⇒ `OverlayLayer`
renders nothing. `OverlayLayer`, the renderers and `signalsToOverlays`
are **not modified** — the per-signal overlay contract is exactly what
the VWAP design may be extending, and this feature never touches it.
Metric panels cannot set `signals: true` (schema, §2.2), so a metric
panel's `ChartComponent` never receives overlays either.

### 6.6 `ChartComponent` changes

- `kind = input.required<'candles' | 'metric'>()`; `candles = input<Candle[]>([])`;
  `points = input<MetricPoint[]>([])`; `overlays` unchanged.
- `ngAfterViewInit` adds `CandlestickSeries` or `LineSeries` by `kind`
  (OI line: single colour, `lastValueVisible`, price-scale formatting
  with thousands separators; `priceFormat: { type: 'volume' }` is fine).
  `OverlayLayer.attachAll` only for `candles`.
- `panelId = input.required<string>()`; sync wiring per §6.4.
- Test hooks: alongside the existing `data-marker-count`, expose
  `data-visible-from` / `data-visible-to` (seconds) on the container so
  Playwright can assert range equality across panels without reading
  canvases.
- `renderPoints` mirrors `renderCandles` (incremental `update()` for
  same/next time, `setData` otherwise, prepend range-neutral).

### 6.7 Mock server (`apps/chart-client/mock-server/`)

Extend with `GET /api/layouts` (both layouts, DXY as
`capitalcom:DXY-MOCK`), `GET /api/metrics` and the `metrics` WS topic
from a synthetic OI walk, so the client unit builds and e2e-tests without
the server unit. Same precedent as SE-2.

---

## 7. What is deliberately not designed here

- Free-form panels (user picks an instrument at runtime), panel resizing,
  drag-reorder, saving layouts from the UI. All additive later; none
  needed to satisfy R1–R7.
- OI available to strategies (`SignalStrategy` context). Strategy-engine
  change; no strategy asks for it.
- Crosshair sync; per-panel timeframe override ("BTC on 5m, OI on 1h").
  The user asked for one timeframe.
- Other metrics (funding, long/short ratio). The `MetricKind` enum and
  the adapter's `supports` list are the extension points; nothing else
  changes.

---

## 8. Merge-check list for the coordinator (vs. the VWAP design)

Files this design adds/edits in shared territory:

| File | This design | Likely VWAP touch? |
|---|---|---|
| `libs/contracts/src/layout.ts`, `metric.ts` | new | no |
| `libs/contracts/src/index.ts` | +2 export lines | maybe (if it adds a file) — trivial textual merge |
| `libs/contracts/src/wire.ts` | additive: metrics query/response, 2 client frames, 1 server frame, `HealthResponse.metrics` | unlikely (VWAP is `signal.ts`/`strategy.ts` territory) |
| `libs/contracts/src/signal.ts`, `strategy.ts`, `instrument.ts` | **untouched** | yes — no conflict |
| `apps/chart-client/src/app/features/chart/overlay/*` | **untouched** | possibly (new renderer) — no conflict |
| `apps/chart-client/src/app/features/terminal/terminal-shell.component.ts` | rewritten (grid instead of single chart) | should not need to; if the VWAP design adds a side-panel here, rebase it onto `ChartPanelComponent`/the shell's side-panel slot — flag for the coordinator |
| `apps/signal-server/config/instruments.yaml` | + US500, + DXY (`sessionTimezone: UTC`, per §5) | VWAP will want US500 too — same entry, take either |

**No contracts change is needed to `Signal`/`OverlayPrimitive`** for this
feature. If the VWAP design changes `Signal`'s shape, this design is
unaffected: signals flow through `PanelFeed` → `signalsToOverlays`
opaque.

---

## 9. Routing plan — Software Engineer, three units

Not self-dispatching: two of the three units are multi-module and one
depends on a user answer; the coordinator asked to review first. Same
reasoning as base §9.

**Ordering:** SE-3 first (small, ~hours), then **SE-4 ∥ SE-5** in
parallel, the way SE-1/SE-2 ran — the shared contract is fixed in this
note and SE-5 builds against its mock server.

### SE-3 — contracts + layouts config + `GET /api/layouts` (first, sequential)

1. `libs/contracts`: `layout.ts` (§2.2), `metric.ts` (§4.2 incl.
   `bucketObservations` + unit test), `wire.ts` additions (§4.5),
   `index.ts` exports. Round-trip tests like the existing ones.
2. `apps/signal-server`: `config/layouts.schema.ts`, `LAYOUTS_FILE` env,
   `AppConfigService.layouts` with the cross-file instrument check (boot
   failure on a dangling id — test it), `api/rest/layouts.controller.ts`.
3. `config/layouts.yaml` per §2.1 with DXY panels **enabled** (epic
   confirmed, §5); `instruments.yaml` + `capitalcom:DXY`
   (`sessionTimezone: UTC`, per §5) and `capitalcom:US500` (epic from the
   VWAP research package; `sessionTimezone: America/New_York`, precision
   as US100).
4. Hand-off: to coordinator; unblocks SE-4 and SE-5.

### SE-4 — open-interest ingestion (server) — after SE-3

Everything in §4.4/§4.5: `MetricAdapter` port, `BinanceMetricsAdapter`
(+ mapper with fixtures from real responses; confirm `openInterestHist`
retention/limits at build and record them), `ReplayMetricAdapter`,
`MetricCache`, `MetricIngestionService` (boot order, `BarClock`-aligned
polling, `METRIC_POLL_INTERVAL_MS`), `MetricStore` port + file + S3
(layout §4.4; round-trip + idempotency tests), `WriteBuffer` reuse,
`MetricObserved` event, `GET /api/metrics` (cache-then-store, bucketed),
gateway `metrics` topic, `/api/health.metrics`, Prometheus counters,
`docker-compose`/README updates. Tests that must exist: mapper, bucketing
at every timeframe incl. a day boundary, store idempotency, WS
subscribe/unsubscribe for the new topic, ingestion boot order from
fixtures.

Escalation pre-answers: (a) no Binance key is needed for either
endpoint; (b) if `openInterestHist` proves shorter than expected, the
design does not change — backfill what exists.

### SE-5 — client panel grid + sync — after SE-3, parallel with SE-4

Step 0: the README's pending swap — delete
`core/contracts/contracts.ts`, import `@trade-automation/contracts`
(mock server included), re-run tests. Then §6 in full: `LayoutsStore`,
`PanelFeed`/`LayoutFeedService` (replacing `MarketFeedService`),
`MetricPointsStore`, `LiveSocket` metrics methods, `LayoutSwitcher`
(instrument switcher removed), `PanelGridComponent` +
`ChartPanelComponent`, `ChartSyncService`, `ChartComponent` changes
(§6.6), status bar over the layout's instruments, mock server extension
(§6.7).

Tests that must exist: `ChartSyncService` (propose/follow/origin,
epsilon drift guard, reset), `mergePoint`, `PanelFeed` with
`signals:false` never subscribing signals (fake socket, as the existing
`live.socket.spec.ts` does), `LayoutsStore` restore-or-first. One
Playwright e2e: boot on `crypto` (4 panels incl. `DXY-MOCK`), markers
present only on the two `signals: true` panels, change timeframe → all
four re-fetch, scroll panel 1 back → `data-visible-from/to` equal within
epsilon on all four and panel 2 fires its own older-history request.

**Hand-off after build (both SE-4 and SE-5):** to the coordinator/
Architect for review, then a user session to (1) supply the DXY epic and
enable the panels, (2) confirm D8 and the layout-2 arrangement.

### Not engaged

- **DevOps**: no infra change. `MetricStore` reuses the S3 bucket and
  IAM policy already pinned (`live-signal-server-infra.md` §1) under a
  new `metrics/` prefix; an OI staleness alarm is an optional add.
- **Researcher / Backtesting / Integration Engineer**: nothing here is a
  trading idea or a strategy.

---

## 10. Logging decision

Same as base §10: this is a UI/infrastructure feature, not a trading
idea — **no `IDEAS-BACKLOG.md` entry, no `RESEARCH-LOG.md` Запись**. It
is recorded by a row in `PROJECT.md`'s Architecture table and a line in
its Status section (done alongside this note). No `knowledge/` file:
open interest as a concept is already defined in
`knowledge/derivatives-positioning.md` §1; this note only adds how it is
ingested.

---

## 11. Amendment 2026-09-18 — OI in USD, OI as candles; horizontal columns, collapsible panels

**Role:** Architect. **Status:** design, routed (§11.4). Supersedes the parts of §2.1,
§4.2, §6.1 and §6.6 named below; everything else in this note stands. Input:
[`coinalyze-oi-assessment.md`](coinalyze-oi-assessment.md) (read it first — it is the
evidence for §11.1). Component files written for this amendment follow the repo rule in
`AGENTS.md` (template/styles in `.component.html` / `.component.scss`).

### 11.1 Open interest in USD notional (stream A1)

**What changes and why.** The panel plots `value = sumOpenInterest` — base units (BTC).
The user compares it against Coinalyze, whose default line is **USD notional**; that alone
explains why the slopes disagree (24 h on BTCUSDT: +1.171 % in BTC vs +2.652 % in USD,
price +1.464 % — assessment §3). The panel switches to USD notional.

**Prerequisite — the unit tag (routed first, SE-A1).** Exactly the assessment's §5 step:

```ts
// libs/contracts/src/metric.ts
export const MetricUnitSchema = z.enum(['base', 'quote', 'contracts']);
export const NotionalBasisSchema = z.enum(['venue', 'derived']);

export const MetricObservationSchema = z.object({
  metric, instrument, time,
  value: z.number().nonnegative(),
  unit: MetricUnitSchema,                         // NEW, required: the unit of `value`
  notional: z.number().nonnegative().optional(),  // always the instrument's quoteCurrency
  notionalBasis: NotionalBasisSchema.optional(),  // NEW: present iff `notional` is
});
```

- `unit` describes `value` and nothing else. `notional` is, by definition, `value`
  expressed in `instrument.quoteCurrency` (USDT for `binance:BTCUSDT`) — no second unit
  field for it. `notionalBasis`: `'venue'` = the venue's own published figure
  (`sumOpenInterestValue`); `'derived'` = `value × price` computed by us (§11.1 tip rule).
  It exists so a visible step at the history/tip join can be attributed, not guessed at.
- Every mapper writes `unit` (Binance USDⓈ-M: `'base'`; a future COIN-M mapper: `'contracts'`
  — that is the latent ~10⁵ bug this closes). `MetricPoint` carries it; the WS payload and
  REST response carry it; `ReplayMetricAdapter` fixtures carry it.
- **Legacy stored rows** have neither field. The store read path (file and S3) runs a pure
  `upgradeLegacyObservation(raw)`: missing `unit` → `'base'` (every row written before this
  change came from the USDⓈ-M mapper, which only ever wrote base units); `notional` present
  without `notionalBasis` → `'venue'` (only history rows ever had one). Write path always
  writes both. No file rewrite, no migration job.
- The panel header names the unit: `BTCUSDT · Open interest · BTC` after SE-A1 (base asset =
  `symbol` minus `quoteCurrency` suffix; `'contracts'` → `contracts`), `… · USDT` once SE-A3
  plots notional.

**History: use the venue's figure, do not recompute (decision).** Every `openInterestHist`
row already carries `sumOpenInterestValue`, mapped into `notional` and stored — we carry it
and simply never plotted it. We plot it as is. Reasons: (1) it is the number Binance itself
publishes and the one any third party (Coinalyze included) starts from, so "our USD OI"
means the same thing as theirs; (2) recomputing would need a price at every 5 m stamp for
30 days, i.e. a dependency on our candle store being gap-free across that window, which it
is not guaranteed to be; (3) the stored record stays "what the venue said". We compute a
notional **only where the venue gives none** — the live tip.

**The live tip (SE-A2, server).** `/fapi/v1/openInterest` has no notional. At ingestion,
`MetricIngestionService` derives it:

- **Price = close of the instrument's own most recent *closed* 1 m candle** from
  `CandleCache`, accepted only if that bar closed within **120 s before** the snapshot's
  venue `time` (and not after it). Why this price: it is the same contract (candles stream
  from `fapi`, the USDⓈ-M perp), it is already in memory (zero new requests), and the poll
  fires on the `BarClock` 1 m tick + ≤2 s jitter, so the just-closed bar's close is the
  price at ≈ the snapshot instant. It is also the price the user sees on the BTC panel next
  to it, so OI-in-USD and price move together on screen. Not mark price by default — see
  the join check.
- **Stale or missing price → no notional, never an old price.** The observation is stored
  with `value`/`unit` only; counter `metric_notional_missing_total{instrument,metric}`;
  one warn log per streak, not per poll. The panel draws a gap for that bucket (a
  base-unit number is never drawn on a USD series).
- **The join check — measured, not assumed.** Binance does not publish which price
  `sumOpenInterestValue` uses. SE-A2 measures it over the stored 30 d: implied price
  `notional / value` per history row vs (a) our 1 m candle close at the row stamp and
  (b) Binance 1 m mark price (`/fapi/v1/markPriceKlines`, a one-off, ≤ 30 calls). Report
  median and p99 |Δ| in bps, and the resulting step at the join as a fraction of the median
  |5 m ΔOI_usd|. **Decision rule (pre-authorised, no need to come back):** keep last-trade
  close if its median |Δ| ≤ 2 bps; otherwise, if mark price matches at least twice as
  closely, switch the tip price to mark price fetched from `/fapi/v1/premiumIndex` in the
  same poll (+1 request weight per instrument per minute — ≈0.04 % of the 2400/min budget;
  not a new loop, it rides the existing 60 s poll). Either way the step must be < 10 % of
  the median 5 m move; record the numbers in the adapter header comment and the PR.
- **Measured 2026-09-18 (SE-A2, 7 925 BTCUSDT history rows) — and the decision taken on
  it.** `sumOpenInterestValue` is **exactly OI × 1 m mark price** (median |Δ| 0.00 bps).
  Against last-trade close: median 0.14 bps, p99 3.67 bps. The rule above would keep
  last-trade (median ≤ 2 bps), and the *median* join step is only 2.4 % of the median
  |5 m ΔOI_usd| ($4.89 m) — but the **p90 step is 23 % and p99 62 %**, i.e. a visible
  notch at the join one time in ten. The rule's intent ("the step must be < 10 % of the
  move") is not met in the tail, so the architect overrides the median-only test: **the tip
  uses mark price**, from `/fapi/v1/premiumIndex` (`markPrice`, `time`) fetched in the
  same 60 s poll (+1 weight per instrument per minute), accepted only if its `time` is
  within 120 s of the snapshot. Same basis as the venue → no step by construction. The
  closed-1 m-candle price is dropped. The legacy-row repair uses 1 m mark-price klines
  (`/fapi/v1/markPriceKlines`, ≤ 1 500 rows per call, one pass per boot over rows still
  lacking notional, paced — ≈30 calls for a full 30 d window).
- **Legacy tip rows.** While the server has been running, the store has accumulated 1 m
  snapshots with no notional (the backfill only ever runs forward from the latest stored
  row at boot, so those stretches have no history rows either). A boot-time, idempotent
  repair derives `notional` for them with the same price rule (candle close from
  `CandleCache`, falling back to `CandleStore` for the older part of the 30 d window),
  `notionalBasis: 'derived'`, re-upserted through `MetricWriteBuffer`. Rows with no
  qualifying candle stay without notional.

**No base↔USD toggle (decision).** The user asked for USD ("как на coinalyze"). A toggle is
not free — a persisted per-panel preference, a second render path, a second axis label and
crosshair value — so it is not built. The base value stays on the wire (`value`), so a
toggle later is a client-only change.

### 11.2 Open interest as candles (stream A2)

**The obstacle.** History is one scalar per 5 m; `bucketObservations` keeps the last one
per bucket; the live tip is polled every 60 s, so the newest buckets hold 5× more samples
than history buckets do, and a candle built from them would have wider wicks than any
history candle — not comparable.

**The rule (decision):**

1. **Sample grain = 5 minutes, always.** Before building OHLC, observations are reduced to
   one sample per 5 m sub-bucket (last-in-sub-bucket — today's rule, one level down). The
   live tip's 1 m snapshots therefore contribute exactly as many samples as history rows
   do; the forming 5 m sub-bucket's latest snapshot is the live close. Every candle on the
   chart, old or live, is built from the same grain. (At the `1m` timeframe the grain is
   1 m — no reduction — see rule 4.)
2. **open = previous bucket's close** when the immediately preceding bucket exists in the
   input; otherwise the bucket's first sample. `high`/`low` = max/min over `{open} ∪
   samples`; `close` = last sample. This is the right OHLC for a series of instantaneous
   readings: the body is the change over the interval, and no change between two samples
   is lost in the gap between candles (with open = first sample, a 15 m candle would show
   only 2 of its 3 five-minute changes).
3. Consequence: **at 5 m, candles are not flat** — each is the change since the previous
   reading, body only, no wicks (open and close are the only two values). At 15 m it has 4
   values, at 1 h 13, and wicks appear.
4. **At 1 m, a line, not candles.** History buckets at 1 m sit 5 minutes apart with no
   predecessor, so rule 2 would make every history candle a flat dash while the live part
   has bodies — exactly the "looks broken" chart to avoid. `metricSeriesStyle(tf)` =
   `tf === '1m' ? 'line' : 'candles'`.
5. **The user is always told.** The panel header carries a small caption chip, with a
   tooltip: at 1 m `line · source is one reading per 5 min`; at 5 m `candles: change per
   5 min, no wicks`; at ≥ 15 m nothing. OI candles use their own colours (up `#58a6ff`,
   down `#f0883e`) so they never read as price candles.

**Contract** (`libs/contracts/src/metric.ts`):

```ts
export const MetricOhlcSchema = z.object({ open, high, low, close });  // all nonnegative numbers
export const MetricPointSchema = z.object({
  metric, instrument, timeframe, time, unit,
  value: z.number().nonnegative(),            // = ohlc.close (kept: last-in-bucket, back-compat)
  ohlc: MetricOhlcSchema,                     // of `value`, always present
  notional: z.number().nonnegative().optional(),     // = notionalOhlc.close
  notionalOhlc: MetricOhlcSchema.optional(),         // over samples that carry notional; absent if none
  notionalBasis: NotionalBasisSchema.optional(),     // of the closing sample
  samples: z.number().int().positive(),              // 5 m-grain samples in the bucket
});
export function bucketObservations(obs: readonly MetricObservation[], tf: Timeframe): MetricPoint[];
```

`bucketObservations` stays pure and keeps its existing tests (their expected objects gain
the new fields); new tests: 5 m-grain reduction of 1 m tip data, open = previous close,
open = first sample after a gap, high/low including open, notional OHLC skipping samples
without notional, 1 m timeframe (no reduction), a day boundary.

**Server consequences (both in SE-A3):**

- `GET /api/metrics` queries observations from `from − TIMEFRAME_MS[tf]` so the first
  returned bucket has its predecessor, and drops that extra leading bucket from the
  response. Otherwise the first candle of every page would differ from the same candle
  fetched mid-page.
- **The gateway must stop bucketing a single observation** (`live.gateway.ts`
  `onMetricObserved` calls `bucketObservations([observation], tf)` today — with OHLC that
  would replace the forming candle with a flat one on every poll). It builds the point from
  `MetricCache.query(instrument, metric, bucketStart − tfMs, observation.time)` and sends
  the last point. Test: the WS point for a bucket equals the REST point for the same bucket.
- Mock server (`apps/chart-client/mock-server/state.ts`, `server.ts`) does the same, and its
  synthetic walk emits `unit` and a notional.

**Client (SE-A3):** `ChartComponent` picks `LineSeries` or `CandlestickSeries` for
`kind: 'metric'` from `metricSeriesStyle(timeframe)` and **swaps the series** if the style
changes (do not rely on the panel being recreated on timeframe change). It plots the
notional side (`notionalOhlc` / `notional`); a point without notional is whitespace
(`{ time }`). Price scale: custom compact formatter (`8.33B`). The crosshair follow reads
the plotted close, not `value`. Put the new mapping in `chart-data.adapter.ts` and the
style rule in its own file with a spec — `chart.component.ts` is already 656 lines and
must not grow (AGENTS.md rule 3).

### 11.3 Horizontal columns, collapsible panels (stream B)

**What is there today.** `PanelGridComponent` is a CSS grid sized from `layout.grid`:
`crypto` is 2×2 (row-major), `us-indices` is 1 column × 3 rows — a **vertical stack**.
Nothing is horizontal-by-rule.

**Arrangement (decision).** Every layout renders as **one row of columns, left to right, in
the order the panels are listed**. The client no longer reads `grid.rows`/`grid.columns`
for arrangement; it lays out a flex row. `layouts.yaml` is migrated so the file does not
contradict the screen: `crypto` → `grid: { columns: 4, rows: 1 }`, `us-indices` →
`grid: { columns: 3, rows: 1 }`. The schema is unchanged (`grid` still bounds panel
count), so an old file with `rows: 3` keeps parsing and simply renders as one row — no
boot failure, no server change beyond the yaml.

**Collapse.** Each panel header gets its own collapse button (a chevron, right end of the
header, `aria-label="Collapse panel"`), not overloaded onto the title or anything else.

- **Collapsed = a thin vertical strip** (28 px wide, full height) showing the rotated
  panel title and an expand chevron; clicking anywhere on the strip restores it. Never
  zero-width — a collapsed panel is always visible and recoverable.
- **Fill.** Expanded columns share the remaining width equally (`flex: 1 1 0`); strips are
  fixed width. Collapsing/restoring re-flows instantly (no animation — an animated width
  change would fire a stream of resize-driven range changes into the sync).
- **All collapsed cannot happen.** The collapse button of the last expanded panel is
  disabled (tooltip: "At least one panel stays open"). Removes the empty-screen edge case
  instead of designing for it.
- **Persistence: yes**, like calendar filters. `localStorage['chart-client:collapsed-panels']
  = { [layoutId]: panelId[] }`. On load, ids not in the layout are dropped; if the stored
  set would collapse every panel (layout edited in yaml), it is ignored and all expand.
  State lives in a small root `CollapsedPanelsStore` with a spec.

**Sync — the part most likely to break.** Three rules, each with a test:

1. **A collapsed panel's chart is destroyed, not hidden.** Its `PanelFeed` keeps running
   (data stays live and paged-in), but the `ChartComponent` is removed from the DOM. A
   hidden chart at 0 width would keep receiving resize and range-change callbacks and
   could propose ranges or be counted as origin takeovers by the circuit breaker. If the
   destroyed chart was the crosshair origin, it clears the crosshair on destroy.
2. **A chart that mounts while a shared range exists joins it; it never leads.** Today a
   chart's first `setData` fires the logical-range callback and *proposes* its own
   autofit window — on restore that would yank every other panel to the right edge, or
   (the reverse failure) the restored panel would show whatever stale window it had.
   New rule in `ChartComponent`: on its first render with data, if `sync.range()` is set,
   apply it under the `applying` guard and seed `lastApplied`, and do not propose; only if
   no shared range exists does it seed one (today's boot behaviour). This is the fix for
   "restore shows a stale window".
3. **Resizes are not gestures.** When a sibling collapses or restores, every remaining
   chart changes width, and `autoSize` makes each fire a logical-range change — N panels
   proposing N slightly different ranges at once, which is precisely the origin-takeover
   pattern the breaker trips on. `ChartComponent` treats range changes that arrive while
   its container is resizing (a `ResizeObserver` on the container; suppress until the
   next animation frame after the last resize) as non-proposing, and `ChartSyncService`
   gains `reassert()` — bumps an epoch signal that makes **every** chart, the origin
   included, re-apply the current shared `TimeRange` to its new width. The grid calls it
   after each collapse/restore. Result: the same wall-clock window on every panel, wider or
   narrower bars.

**Acceptance (Playwright, against the mock server):** scroll panel 1 back a day → collapse
panel 2 → no `[ChartSyncService] … circuit breaker` warning in the console, and panels
1/3/4 `data-visible-from/to` equal each other and the pre-collapse range within epsilon →
scroll panel 1 further back → restore panel 2 → its `data-visible-from/to` equal the
*current* shared range (not its autofit latest window, not the range at collapse time) →
reload → panel 2's collapsed state persisted as left.

### 11.4 Routing

See [`four-streams-2026-09-18.md`](four-streams-2026-09-18.md) for task ids, branches and
sequencing. Streams: SE-A1 (unit tag) → SE-A2 (USD tip, server) ∥ SE-A3 (OHLC + client
rendering); SE-B (layout/collapse); SE-C in `economic-calendar.md` §11.

---

## 12. Amendment 2026-09-18 — chart visuals: no grid, white/blue palette, New York time, day separators, RSI pane

**Role:** Architect. **Status:** routed (§12.7). Display-only: no contract, server or
candle-boundary change.

User request (verbatim, RU): «убери сетку на фоне · добавь горизонтальные разделители как
окончание дня, если ТФ больше 1H то не показывай этот индикатор · время показывай по НЙ ·
00:00 по НЮ это как раз должен быть добавлен разделитель · добавить индикатор RSI внизу
графика, должна быть возможность его спрятать · палитра графика белый (свеча вверх) и синий
(свеча вниз)».

### 12.1 Theme: grid off, palette, one place for colours

- New `features/chart/chart-theme.ts` owns `CHART_PALETTE` (`up`, `down`, `bg`, `border`,
  `text`, `muted`, `separator`), `CHART_OPTIONS` (the `createChart` options, moved out of
  `chart.component.ts` verbatim, then changed) and `PRICE_CANDLE_OPTIONS`. **Names and shape
  deliberately match the `chart-theme.ts` the aggregated-OI client branch
  (`se-oi-aggregate-client`, SE-AG4, unmerged) introduces with the same extraction**, so
  whichever lands second resolves a trivial add/add conflict by keeping this file's values.
- Grid: `grid.vertLines.visible = false`, `grid.horzLines.visible = false` — all panels
  (candle and metric share `CHART_OPTIONS`).
- **Up = `#ffffff` (white), down = `#2962ff` (blue)**, on body, border and wick
  (`borderVisible: true`, `borderUp/DownColor` set). `#2962ff` contrast: 3.9:1 against the
  `#0d1117` background, 4.9:1 against white — distinguishable from both; a lighter blue
  (e.g. `#58a6ff`) falls to ~1.9:1 against white and reads as "grey-ish" next to it.
- **OI candles take the same pair.** Today they are `#58a6ff`/`#f0883e` (SE-A3); with a blue
  *down* on price, a blue *up* on OI would read as the opposite direction on adjacent panels.
  `METRIC_UP_COLOR`/`METRIC_DOWN_COLOR` in `metric-series-style.ts` become aliases of
  `CHART_PALETTE.up/down` — a two-line change in a file the OI branches do not touch; the OI
  data path is untouched.
- No volume series exists in the client today, so there is nothing to recolour; when one is
  added it must read `CHART_PALETTE`.
- AGENTS.md rule 4 is updated to name `CHART_PALETTE` as the source of up/down colours.

### 12.2 New York time — formatters only, never shifted timestamps

Every timestamp handed to lightweight-charts stays **real UTC epoch seconds**.
`ChartSyncService`, `logicalToTimeSec`/`timeSecToLogical`, `loadOlder()` pagination, metric
alignment and the crosshair channel keep reasoning in UTC and are not touched. Only what is
*displayed* changes:

- `features/chart/ny-time.ts` (pure, spec'd): `nyParts(sec)` via a cached
  `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', … })`
  `formatToParts`; `nyDayKey(sec)` (`YYYY-MM-DD` NY calendar day); `nyTickLabel(sec, tickType)`;
  `nyCrosshairLabel(sec)`. Real tz database → DST-correct with no fixed offset.
- Wired through `CHART_OPTIONS.localization.timeFormatter` (crosshair label) and
  `CHART_OPTIONS.timeScale.tickMarkFormatter` (axis labels).
- **Known library limitation:** lightweight-charts chooses *which* bars get tick marks (and
  their weight: year/month/day/time) from UTC. The formatter therefore labels by the tick's NY
  wall-clock, not by the weight it was given: a tick whose NY time is 00:00 shows the NY
  date, any other intraday tick shows NY `HH:mm`, month/year ticks show the NY month/year.
  Ticks keep landing on UTC-round instants (e.g. an hourly tick at 00:00 UTC is labelled
  `20:00`/`19:00`); the NY day boundary is marked by the separator (§12.3), not by a tick.
- **Candle boundaries stay UTC** (`resampler.ts`, one H1 definition shared with research).
  So a 1d candle opens at **20:00 NY (summer, EDT)** / **19:00 NY (winter, EST)** of the
  previous NY day, and a 4h candle opens at 20/00/04/08/12/16 NY (summer) or 19/23/03/…
  (winter). Intentional; stated in the user section.
- Scope: the chart (axis, crosshair, anything in `features/chart` / panel header that renders
  a time). The **economic-calendar view is not changed**: it has its own `et-time.ts` and
  deliberately shows local time with the ET instant in a tooltip (`economic-calendar.md`
  §7.1). Same for the status-bar "next event" time. Flagged to the user as a question.

### 12.3 Day separators

- Vertical, subtle (`CHART_PALETTE.separator`, 1 px, dashed, ~35 % alpha) lines at the
  **00:00 America/New_York** boundary. Timeframes `1m`, `5m`, `15m`, `1h` only; hidden on
  `4h` and `1d` (`showsDaySeparators(tf)`).
- Placement is **per data transition, not per calendar midnight**: pure
  `nyDayBoundaryIndices(timesSec): number[]` returns every index `i > 0` whose `nyDayKey`
  differs from bar `i-1`'s. The line is drawn at logical `i − 0.5` (the left edge of the first
  bar of the new NY day; if a bar opens exactly at 00:00 NY that is exactly midnight).
  Consequences, both intended: a weekend / market-closed gap on a Capital.com index panel
  yields **one** line at the first bar after the gap (no stacked cluster, no line floating in
  empty space — the time scale has no empty slots for missing days); a crypto panel gets one
  line per day.
- Drawn by a **pane primitive** (`DaySeparatorsPrimitive`, `pane.attachPrimitive`) on the
  price pane — it survives the metric line↔candles series swap (§11.2) and is drawn on metric
  panels too. It reads the component's `lastTimesSec` and timeframe; it never touches the
  time scale, the crosshair or `ChartSyncService`, so sync and the circuit breaker are
  unaffected by construction. `hitTest` returns null (no crosshair interference).
- Tests: summer day (00:00 NY = 04:00 UTC), winter day (05:00 UTC), both DST transition
  days (2026-03-08, 2026-11-01 — a 23 h and a 25 h NY day each yield exactly one boundary),
  a Fri→Mon gap (one line), and 4h/1d hidden.

### 12.4 RSI pane

- Pure `features/chart/indicator/rsi.ts` + spec: `rsiWilder(closes, period): (number|null)[]`.
  Wilder smoothing, seeded with the simple average of the first `period` changes. Indices
  `0 … period−1` are `null` (**nothing drawn**, not a misleading 50 or 0). All-gain → 100,
  all-loss → 0, flat → 50.
- **Prepend stability (`loadOlder()`):** RSI is recomputed over the whole loaded buffer, so
  prepending history re-seeds it. The seed error decays by `(1 − 1/period)` per bar; after
  `10 × period` bars it is < 0.01 RSI points. So the pane draws **nothing for the first
  `RSI_STABLE_BARS = 10 × period` bars of the loaded buffer** (140 bars at 14). These are at
  the far-left edge of history, where `loadOlder()` is already fetching more. Spec asserts:
  computing over `older ++ current` vs `current` differs by < 0.01 at every drawn index.
- Forming bar: the chart already gets a new `candles` array on every forming tick; the RSI
  renderer recomputes (O(n) over ≤ a few thousand bars every ~3 s — negligible) and uses
  `series.update()` for the last point on an incremental append/update, `setData` otherwise
  (mirrors `renderCandles`).
- lightweight-charts 5 **native pane** (`chart.addSeries(LineSeries, opts, 1)`): shares the
  time scale and crosshair with the price pane for free; ~25 % height; 70/30 guide lines as
  price lines on the RSI series; fixed 0–100 scale. Hiding removes the series (and the pane),
  returning the space to the price pane. Owned by `RsiPaneRenderer`
  (`features/chart/indicator/rsi-pane.renderer.ts`); `ChartComponent` gets two inputs
  (`rsiVisible`, `rsiPeriod`) and a handful of forwarding lines.
- **Candle panels only** — never the OI metric panel.
- Preferences: `core/state/rsi-prefs.store.ts` (+ pure `rsi-prefs.ts` parser with spec),
  localStorage key `chart-client:rsi` = `{ period: number, hidden: { [layoutId]: panelId[] } }`,
  same try/catch pattern as `collapsed-panels.store.ts`. Default: visible, **period 14**,
  clamped 2–100. Period is one global setting; visibility is per panel.
- UI: in the candle panel header, an `RSI` toggle chip (pressed = shown) and, while shown, a
  compact number input for the period.
- Panel sync: the RSI pane does not add time-scale slots (its points are exactly the candle
  times), so `lastTimesSec`, logical ranges and the sync channel are unchanged. The crosshair
  follower still positions on the price series.
- If the separators primitive has landed first, the RSI pane attaches one too (one line).

### 12.5 `chart.component.ts` size (AGENTS.md rule 3)

It is 610 lines today. Stream CV-T first **extracts** the chart/series options to
`chart-theme.ts` (≈ −25 lines), which pays for CV-T's and CV-R's forwarding lines; both
keep all logic in their own files (primitive, renderer, pure helpers). Net: the file must not
grow versus master. A real split of the component (render/bookkeeping vs. sync) is a separate
follow-up, not in this amendment.

### 12.6 Coordination with the aggregated-OI work

Shared files with `se-oi-aggregate-client` (SE-AG4, unmerged): `chart-theme.ts` (add/add,
keep §12.1 values), `chart.component.ts` (its hunk replacing the inline options with
`CHART_OPTIONS` is identical to CV-T's), `chart-panel.component.html/.ts` (CV-R adds the RSI
chip at the end of the header, beside the collapse button). `metric-series-style.ts` is
touched only here. No OI data-path file (`metric-points.store`, `panel-feed`,
`metric-series.renderer`, `aggregate-*`) is touched.

### 12.7 Routing and merge order

| Stream | Branch | Scope |
|---|---|---|
| **CV-T** (time + theme) | `se-chart-time` | commit 1: §12.1 (theme extraction, grid off, palette, OI colours, AGENTS.md); commit 2+: §12.2, §12.3 |
| **CV-R** (RSI) | `se-chart-rsi` | §12.4 |

Both branch from `master` and run in parallel. **Merge order: CV-T, then CV-R** into
`architect-chart-visuals` (integration). Expected CV-R conflicts: adjacent lines in
`chart.component.ts` `ngAfterViewInit`/`ngOnDestroy`, resolved by keeping both sides; then
the one-line separator attach on the RSI pane.
