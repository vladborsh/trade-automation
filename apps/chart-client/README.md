# chart-client

Terminal-style live chart client (Angular 20+, standalone components, Signals)
built against the wire contract in `architecture/live-signal-server.md` §3,
extended in `architecture/vwap-band-reversal-plugin.md` §3/§6/§11 (strategy
tiers, indicator series, research-tier labelling). Built by SE-2; SE-4
(`architecture/vwap-band-reversal-plugin.md` §8.2) added indicators, shapes
rendering and the research badge.

## Running locally against the mock server

The client always talks to whatever `apiBaseUrl`/`wsUrl` are in
`public/config.json` (fetched at boot, §5.4) — right now that points at the
mock server on port 4300. Two processes, from `apps/chart-client/`:

```bash
npm run mock-server   # http://localhost:4300 — REST + WS, replays fixture candles
npm run start         # http://localhost:4200 — ng serve
```

Open `http://localhost:4200`. Boot sequence: instruments and strategies load,
last-selected instrument/timeframe are restored from `localStorage`, the WS
connects, and the demo `example-cross` signal (an SMA-20 crossover, §4.4's
stand-in for a real strategy) renders as chart markers immediately — the mock
server backfills historical crossings over its seed data at boot, not just
live ones, so a marker is visible without waiting for one to occur live.
`capitalcom:US100` additionally carries a synthetic research-tier
`vwap-band-reversal` mock (three sine-ish VWAP band lines + periodic amber
"research" markers) — see "Research-tier labelling" below.

Keyboard shortcuts: `/` focuses the instrument switcher, `[` / `]` cycle
timeframes finer/coarser.

### Mock server (`mock-server/`)

Implements the REST endpoints and WS protocol of `@trade-automation/contracts`
from an in-memory, deterministically-seeded (mulberry32 PRNG) random-walk
candle series — no real venue credentials or network calls. It is **not**
`apps/signal-server`; it exists so this client is buildable and testable
without a running server. `mock-server/vwap-band-mock.ts` is a synthetic
stand-in for the real `vwap-band-reversal` plug-in (not a port of the bot's
mechanic) so the indicator/research-labelling plumbing has something real to
render against; it ships `enabled: true` here (the real server ships
`enabled: false` by default, per the note's §7).

Env vars: `MOCK_SERVER_PORT` (default 4300), `MOCK_BAR_MS` (default 2000 —
simulated 1m-bar duration in wall-clock ms; the mock server is not real-time,
it just replays fast).

```bash
npm run mock-server        # watch mode (tsx watch)
npm run mock-server:once   # single run, no watch
```

## Research-tier labelling (architecture/vwap-band-reversal-plugin.md §6)

- Signals/indicator points from a non-`live` strategy render amber (`#d29922`);
  the fallback marker a strategy-less signal gets is also tier-aware
  (`signal-to-overlays.ts`).
- `ResearchBadgeComponent` (top bar) shows a persistent
  `RESEARCH — not a trading signal` banner, with the fixed explanatory copy
  from §6 behind a click-to-expand toggle, whenever the selected instrument
  has any non-`live` signal/indicator point or an enabled non-`live` strategy.
- The status bar lists active strategies with tier, e.g.
  `strategies: vwap-band-reversal (research)`.
- Indicator series are shown only when their own timeframe matches the
  chart's displayed timeframe (§3.1) — mismatched series are hidden, never
  resampled.

## Tests

```bash
npm test    # unit tests (Vitest): store merge logic, live.socket reconnect/re-subscribe, ShapesPrimitive draw calls
npm run e2e # Playwright: boots mock-server + ng serve; instrument switch, VWAP band + research badge, timeframe hide rule
```

`npm run e2e` starts both servers itself (`playwright.config.ts`
`webServer`); no need to start them by hand first.

## Structure

```
src/app/
  core/
    contracts/        # derived.ts — ergonomic type aliases over @trade-automation/contracts responses (no duplicated shapes)
    config/            # runtime config.json fetch
    api/               # rest.client.ts, live.socket.ts (reconnect+backoff), socket-factory.ts (test seam)
    state/             # instruments/timeframe/connection/candles/signals/indicators/strategies stores + market-feed.service.ts (orchestrator)
  features/
    terminal/          # shell: top bar (switcher, tf picker, research badge) + chart pane + (empty) side-panel slot
    instrument-switcher/, timeframe-picker/, status-bar/, research-badge/
    chart/
      chart.component.ts, chart-data.adapter.ts
      overlay/         # marker + price-line + shapes.primitive.ts (one ISeriesPrimitive drawing rect/ray/line); rect/ray/line.renderer.ts are thin adapters onto it
      indicator/        # indicator-layer.ts — one LineSeries per (strategyId, seriesId, key)
mock-server/            # REST + WS fake, replayed fixture candles + synthetic VWAP band mock (see above)
```

## `libs/contracts`

All wire types come from `@trade-automation/contracts` (a real workspace
package, built by SE-3 alongside `apps/signal-server`). The app's previous
`src/app/core/contracts/contracts.ts` — a hand-kept local transcription of
the contract, needed only because `libs/contracts` didn't exist on disk when
this app was first built — has been deleted; every former import of it now
imports directly from `@trade-automation/contracts`, except where an
ergonomic per-item/per-frame alias is useful (`InstrumentWithStatus`,
`StrategyInfo`, `WsCandleFrame`, etc.) — those live in
`core/contracts/derived.ts` as pure type-level projections
(`InstrumentsResponse[number]`, `Extract<WsServerMessage, {...}>`), not
duplicated shapes. `mock-server/*.ts` imports the same package.
