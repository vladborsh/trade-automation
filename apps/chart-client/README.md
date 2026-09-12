# chart-client

Terminal-style live chart client (Angular 20+, standalone components, Signals)
built against the wire contract in `architecture/live-signal-server.md` §3.
Built by SE-2; see that note's §5 for the design and §9.1 for the deliverable
list this app implements.

## Running locally against the mock server

The client always talks to whatever `apiBaseUrl`/`wsUrl` are in
`public/config.json` (fetched at boot, §5.4) — right now that points at the
mock server on port 4300. Two processes, from `apps/chart-client/`:

```bash
npm run mock-server   # http://localhost:4300 — REST + WS, replays fixture candles
npm run start         # http://localhost:4200 — ng serve
```

Open `http://localhost:4200`. Boot sequence: instruments load, last-selected
instrument/timeframe are restored from `localStorage`, the WS connects, and
the demo `example-cross` signal (an SMA-20 crossover, §4.4's stand-in for a
real strategy) renders as chart markers immediately — the mock server
backfills historical crossings over its seed data at boot, not just live
ones, so a marker is visible without waiting for one to occur live.

Keyboard shortcuts: `/` focuses the instrument switcher, `[` / `]` cycle
timeframes finer/coarser.

### Mock server (`mock-server/`)

Implements §3.5's REST endpoints and WS protocol from an in-memory,
deterministically-seeded (mulberry32 PRNG) random-walk candle series — no
real venue credentials or network calls. It is **not** SE-1's
`apps/signal-server`; it exists so this client is buildable and testable
without waiting on that in-parallel work (see `architecture/live-signal-server.md`
§9.1). Once SE-1's server lands, switch `public/config.json` to point at it
and the client needs no code change — the contract is what both sides built
against.

Env vars: `MOCK_SERVER_PORT` (default 4300), `MOCK_BAR_MS` (default 2000 —
simulated 1m-bar duration in wall-clock ms; the mock server is not real-time,
it just replays fast).

```bash
npm run mock-server        # watch mode (tsx watch)
npm run mock-server:once   # single run, no watch
```

## Tests

```bash
npm test    # unit tests (Vitest): candles.store merge logic, live.socket reconnect/re-subscribe
npm run e2e # Playwright: boots mock-server + ng serve, switches instrument, asserts a marker renders
```

`npm run e2e` starts both servers itself (`playwright.config.ts`
`webServer`); no need to start them by hand first.

## Structure

Per `architecture/live-signal-server.md` §5.2:

```
src/app/
  core/
    contracts/       # wire-contract types — local stand-in for libs/contracts, see note below
    config/           # runtime config.json fetch
    api/              # rest.client.ts, live.socket.ts (reconnect+backoff), socket-factory.ts (test seam)
    state/            # instruments/timeframe/connection/candles/signals stores + market-feed.service.ts (orchestrator)
  features/
    terminal/         # shell: top bar + chart pane + (empty) side-panel slot
    instrument-switcher/, timeframe-picker/, status-bar/
    chart/
      chart.component.ts, chart-data.adapter.ts
      overlay/        # marker + price-line implemented; rect/ray/line are type-complete stubs (warn-and-skip)
mock-server/           # REST + WS fake, replayed fixture candles (see above)
```

## `libs/contracts` note

`libs/contracts` did not exist on disk when this app was built — SE-1 was
building it in parallel. `src/app/core/contracts/contracts.ts` is a local,
verbatim transcription of §3's types so both sides had a fixed contract to
build against without waiting on each other. Once SE-1's `libs/contracts`
lands: delete this file, `import` from the shared package everywhere it's
currently imported from `core/contracts/contracts`, and re-run the test
suite. The mock server (`mock-server/*.ts`) imports the same local file and
needs the same swap.
