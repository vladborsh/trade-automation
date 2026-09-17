# Panel sync (crosshair, right edge) and OI history depth: diagnosis + routing (2026-09-17)

Three bugs from the user's live test of the real terminal (signal-server PID 41703 on
`:3000`, cwd `apps/signal-server`; `ng serve` on `:4200`, `config.json` already pointed at
`localhost:3000` — neither started nor touched by me). Same shape as
`architecture/scroll-back-freeze-diagnosis.md`, which owns the vocabulary for the chart-sync
subsystem (Drive/Follow, `applying`/`lastApplied`, snap echo, circuit breaker) that bugs 1 and 3
live in.

## Summary — one line each

- **Bug 1 (crosshair not mirrored):** not a defect, a never-built feature — chart-layouts §6.4
  explicitly deferred it ("Crosshair sync … is a trivial follow-up … not in scope"); no code
  subscribes `subscribeCrosshairMove` or calls `setCrosshairPosition` anywhere in the client.
  **Ruling:** a *time-synced* crosshair — one vertical line per panel at the hovered
  timestamp, each panel's own horizontal line at *its own* value at that instant; the driver's
  price level is never mirrored (units differ per panel).
- **Bug 2 (OI panel has 5.7 days, not 30):** `BinanceMetricsAdapter.fetchObservations`
  paginates as if Binance returned the *oldest* 500 rows of `[startTime, endTime]`; the venue
  returns the *newest* 500 (verified live today), so the loop exits after exactly one page
  (500 × 5m = 41h40m). `MetricIngestionService.warmUp` then only ever extends *forward* from
  the last stored observation, so that first-run depth froze on 2026-09-11 22:45 UTC and every
  restart since has only re-filled its own outage tail. The other ~4 days are 1-minute polls.
- **Bug 3 (driver pans into the void, followers don't):** the shared range is a
  `lightweight-charts` *visible time range*, which the library clamps to `[first bar, last bar]`
  and which `setVisibleRange` maps through `timeToIndex(findNearest = true)`; empty space
  beyond the data is therefore *unrepresentable* on the sync channel, so the driver proposes
  only the bars still on screen and each follower stretches exactly those bars across its
  full width. Not a `rightOffset`/`fixRightEdge` mismatch — all four panels run the library
  defaults (`0` / `false`). **Ruling:** all panels move into the void together, right *and*
  left.

Recommended SE order: bug 3 first (it introduces the logical↔time helper), bug 1 second (reuses
it), bug 2 is server-side and independent — a second SE can take it in parallel.

---

## Bug 3 — right-edge desync (do first)

### Reproduction (live, today)

`architecture/scratch/repro-right-edge-desync.mjs` (Playwright, headless, against the running
`:4200`/`:3000`): wait for the crypto layout, read every panel's `data-visible-from/to`, pan
the **btc plot body** right-to-left three times (the gesture that drags the last bar away from
the right edge and reveals empty future space), read the hooks again, screenshot.

| | btc | eth | btc-oi | dxy |
|---|---|---|---|---|
| before, from → to | 1789627200 → 1789658100 (103 bars) | same | same | same |
| after, from → to | 1789657800 → 1789658100 (**2 bars**) | same | same | same |

The screenshot is the whole bug in one frame: **btc** shows two candles squeezed into the
left ~35 % of the panel with dead space to the right (the user's "empty chart"); **eth, btc-oi
and dxy** show *the same two bars stretched across their entire width* — two giant candles /
one line segment, x-axis labels 15:10 and 15:15 only. The followers did not merely "stop at the
end of the chart"; they were zoomed in ~50× relative to the driver. The `data-visible-*` hooks
agree across all four panels throughout, which is why no existing assertion can see this.

No `[ChartSyncService]` circuit-breaker warning fired; this is not a resurgence of either
freeze — the guards converge fine, on a wrong range.

### Root cause

Three `lightweight-charts` 5.2.1 facts (read from
`node_modules/lightweight-charts/dist/lightweight-charts.development.mjs`, not from memory):

1. `subscribeVisibleTimeRangeChange` / `getVisibleRange()` return
   `timeRangeForLogicalRange()`, which does
   `from = indexToTime(max(firstIndex, from))`, `to = indexToTime(min(lastIndex, to))` — the
   time range is **clamped to the bars that exist**. The typings say so too: "this method
   cannot extrapolate time and will use the only currently existent data."
2. `setVisibleRange()` → `logicalRangeForTimeRange()` → `timeToIndex(time, findNearest = true)`,
   and `timeToIndex` has an explicit special case: any time later than the last bar returns
   `points.length − 1`. A follower asked for a `to` in the future lands on its last bar.
3. The `fixRightEdge` / `rightOffset` options are at their defaults on every panel
   (`chart.component.ts:236`, `timeScale: { timeVisible, secondsVisible, borderColor }` only),
   so the coordinator's "driver has a right offset, followers fix the edge" hypothesis is
   ruled out — the panels are configured identically. The asymmetry is between *dragging*
   (which moves the logical range freely) and *following* (which goes through the time-range
   API and cannot express whitespace).

So when the driver pans past its last bar, its `subscribeVisibleTimeRangeChange` callback
(`chart.component.ts:265`) receives a range whose `to` is pinned at the last bar and whose
`from` keeps moving right as the void grows. `propose()` forwards that. Each follower's Follow
effect (`chart.component.ts:179`) calls `setVisibleRange(from, lastBar)` and fits it to its
full width. The design's D6 decision (time-based sync, chart-layouts §6.4) is right; the
*representation* chosen for it — the library's clamped visible time range — cannot carry the
one thing a pan past the edge produces.

The same defect exists at the **left** edge and for **session-gapped instruments** today, just
less visibly: a follower whose first loaded bar is later than the driver's `from` (btc-oi's
shallower buffer; any panel that has finished paginating) snaps `from` to its own first bar and
renders zoomed in; and dxy (Capital.com, closed weekends) can *never* align with btc over a
weekend because its last bar is Friday's and `timeToIndex` snaps every later `to` onto it.

### Ruling: all panels scroll into the void together

- A right margin past the last bar is a normal trader habit (room for the next bars); the
  layout must follow it, not fight it.
- "None may" (`fixRightEdge: true` everywhere) would only stop the *driver*; a follower whose
  last bar is earlier than the driver's (dxy on a weekend, an OI panel that has not polled
  yet) would still disagree, because with the edge fixed it *cannot* show the whitespace it
  needs to stay on the same wall clock. The only representation under which four panels with
  different bar grids agree is "the window is a wall-clock span, and a panel with no bars in
  part of it shows blank there" — which is exactly what §6.4 already says about differing bar
  counts.
- Symmetric on the left: the same rule answers bug 2's client-side question (below).

### Fix

Keep `ChartSyncService` and its `TimeRange` contract unchanged (`from`/`to` in seconds; the
service, epsilon drift guard, breaker and all its tests stay as they are). Change what
`ChartComponent` puts *into* and takes *out of* that range: **edge times**, derived from the
logical range and the panel's own data, extrapolated by the shared timeframe beyond the data.

Files: `apps/chart-client/src/app/features/chart/chart.component.ts` (Drive handler ~265-291,
Follow effect ~179-220, `withPreservedRangeOnPrepend` ~330-350, `visibleFrom/To` hooks); new
pure helpers next to `isNearOldestLoaded`; `chart.component.spec.ts`; `e2e/terminal.spec.ts`;
`mock-server/fixtures.ts`.

1. **Two pure, exported helpers** (unit-testable without a chart, same pattern as
   `isNearOldestLoaded`):
   - `logicalToTimeSec(logical, timesSec: readonly number[], tfSec)`: inside the data,
     linear interpolation between the two neighbouring bar times (logical indices are
     fractional — `getVisibleLogicalRange()` returns e.g. `-3.5`); beyond the last bar,
     `last + (logical − lastIdx) · tfSec`; before the first, `first − (0 − logical) · tfSec`.
   - `timeSecToLogical(timeSec, timesSec, tfSec)`: the inverse — binary search for the
     bracketing bars and interpolate; beyond either end, extrapolate by `tfSec`.
   `timesSec` is the panel's own `candles()`/`points()` mapped to seconds (already the array
   `setData` was given, so index `i` ⇔ logical `i`; a `series.update()` append keeps that
   true). `tfSec` is the shared `timeframe()` — every panel in a grid is on the same
   timeframe (§6.3), and the OI panel is bucketed to it server-side, so one extrapolation
   step is correct for all of them.
2. **Drive on the logical range**: switch the proposal source to
   `subscribeVisibleLogicalRangeChange`, convert both ends with `logicalToTimeSec`, and
   propose that. Keep `subscribeVisibleTimeRangeChange` only if something still needs it;
   the pagination trigger (`isNearThisPanelsOldestLoaded`) works unchanged on the
   edge-`from` (a `from` in the left whitespace is trivially "near the oldest bar" — correct,
   it should ask for more; `noMoreOlderHistory` stops it once the store is exhausted).
3. **Follow on the logical range**: `setVisibleLogicalRange({ from: timeSecToLogical(r.from),
   to: timeSecToLogical(r.to) })` instead of `setVisibleRange`. The `applying` guard and the
   `requestAnimationFrame` read-back stay exactly as they are, but the read-back becomes
   `getVisibleLogicalRange()` → `logicalToTimeSec` → `lastApplied`. Note this *shrinks* the
   snap-echo class the freeze diagnosis fought: a logical range is applied exactly (the only
   clamps left are `minBarSpacing` and the fixed-edge options, which are off), so a follower
   inside a data gap no longer snaps hours away from the request. Keep every guard and the
   breaker anyway — that is what they are for.
4. **`withPreservedRangeOnPrepend`**: preserve *edge times* (via `logicalToTimeSec` on the
   old array), then after `setData` re-apply them through `timeSecToLogical` on the *new*
   array. Preserving a logical range across a prepend would be wrong (indices shift).
5. **Test hooks**: `data-visible-from/to` must publish the edge times, not the clamped
   library range — otherwise the e2e suite still cannot observe the void. (This is the
   assertion gap the freeze follow-up warned about, in a new place.)
6. Panels with no data yet (`lastRenderedCount === 0`) keep skipping the Follow effect, as now.

Do **not** fix this with `fixRightEdge`/`fixLeftEdge` or by clamping the driver: see the
ruling. Do not switch the *service* to logical ranges: D6 stands, bar grids differ.

### Regression tests

- **Unit** (`chart.component.spec.ts`): `logicalToTimeSec`/`timeSecToLogical` round-trip on a
  gapless grid, on a grid with a multi-hour gap (interpolation lands *inside* the gap, not on
  a bar), on fractional indices, beyond both ends (extrapolation by `tfSec`), and
  `timeSecToLogical(logicalToTimeSec(x)) ≈ x`.
- **E2E** (`terminal.spec.ts`, mock `:4300`): record every panel's `to − from` (window width)
  and `to`; pan the **btc plot body** right-to-left three times with the exact gesture in
  `repro-right-edge-desync.mjs` (mid-height, 0.8 → 0.3 of width, `steps: 15`); then assert
  (a) all four `data-visible-to` are equal within half a bar **and later than the fixture's
  last bar time** (the void is represented), (b) all four widths are equal within a bar
  **and equal to the pre-pan width** (a pan is not a zoom — today the width collapses from
  103 bars to 2), (c) no `[ChartSyncService]` console warning. Today (a) and (b) fail.
- **E2E, weekend case**: give one mock instrument (the `capitalcom:DXY-MOCK` fixture) a tail
  gap — its last seeded bar several hours before the others' — and assert its
  `data-visible-to` still equals the others' after a right-edge pan. Today it can never pass.
- Keep the existing scroll-back test as-is.

### Verification before calling it fixed

Re-run `repro-right-edge-desync.mjs` against the real server: after the pans, the four
screenshots' x-axes must show the same labels at the same x positions, and the dxy panel must
show blank space where btc shows bars it lacks (not stretched bars).

---

## Bug 1 — synced crosshair (do second)

### Interpretation ruling

The user said "horizontal line" and described "the current date and time the cursor is over".
Date/time is the x-axis on every one of these charts, so the line that marks it on another
panel is **vertical** within that panel; "horizontal" describes the *direction the marker runs
across the layout* — the same instant, visible on all four panels side by side. I rule for
the **time-synced crosshair**: hovering panel A puts a vertical line on B, C and D at the same
timestamp.

Two refinements, stated separately because they are product decisions:

- **Each follower's horizontal line shows its *own* value at that instant, not the driver's
  price.** `setCrosshairPosition(price, time, series)` needs a `price` for its horizontal line
  and axis label; passing the follower's own bar value (candle close / OI value / DXY close at
  the nearest bar) makes that line read "ETH was 2452.01, OI was 108.86K, DXY was 99.88 at
  15:15" — which is precisely "read what BTC, ETH, OI and DXY were all doing at that instant".
- **Mirroring the driver's *price level* as a horizontal line on the other panels is not
  wanted** and should not be built: BTC dollars, OI contracts and an index level share no
  scale, so a line at `76 331` on the DXY panel is meaningless. If a price-level ruler across
  same-unit panels is ever asked for, it is a separate feature with an explicit "same
  instrument family" rule.

### Why it does not exist

Chart-layouts §6.4, last paragraph: "Crosshair sync (`setCrosshairPosition`) is a trivial
follow-up on the same service and is **not** in scope." Nothing in `apps/chart-client` calls
`subscribeCrosshairMove`, `setCrosshairPosition` or `clearCrosshairPosition`. The crosshair
options are library defaults plus `mode: 0` (free, not magnet).

### Design

Files: `chart-sync.service.ts` (+ spec), `chart.component.ts` (+ spec), `e2e/terminal.spec.ts`.

1. **A second, independent channel on `ChartSyncService`**, not a second service and not the
   `propose()` path: `crosshair = signal<{ origin: string; timeSec: number } | null>`,
   `setCrosshair(panelId, timeSec | null)`, cleared by `reset()`. Same lifetime as the range
   (one per grid, fresh per layout), but a separate signal so hover never re-runs the Follow
   effect for ranges and never touches the epsilon guard or the breaker — those exist to
   police a *feedback* loop, and (see 3) the crosshair has none.
2. **Drive**: `chart.subscribeCrosshairMove(param => …)`. Mouse leaving the pane arrives as
   `param.point === undefined` → `setCrosshair(panelId, null)`. Otherwise use
   `param.logical` (defined even over whitespace, where `param.time` is not) through bug 3's
   `logicalToTimeSec`, so hovering the void still syncs at the right wall-clock instant.
3. **Follow**: `effect(() => …)` reading `sync.crosshair()`: `null` → `clearCrosshairPosition()`;
   `origin === panelId` → do nothing (the driver keeps its own native crosshair); no data →
   nothing; else find this panel's nearest bar by time (binary search on its own array),
   take its value (`close` for candles, `value` for points) and call
   `setCrosshairPosition(value, barTimeSec, series)`.
4. **Loop prevention — three layers, and say so in the code**:
   - By construction: the library does **not** fire `subscribeCrosshairMove` for a
     programmatic position. `setAndSaveSyntheticPosition` calls
     `setAndSaveCurrentPosition(x, y, null, pane, /* skipEvent */ true)` (verified in the 5.2.1
     source). A follower applying a position therefore produces no event at all — there is
     no echo to guard, unlike the range path where `setVisibleRange` fires synchronously.
   - Explicit: the Drive handler proposes **only when `param.sourceEvent` is defined**
     (`MouseEventParams.sourceEvent`, "the underlying source mouse or touch event data, if
     available" — undefined for anything programmatic). If a future library version starts
     firing on synthetic positions, this line keeps the channel one-directional.
   - Origin: followers never write; only the panel under the pointer does, and
     `origin === panelId` is skipped on read.
   This is what makes a lighter channel safe where the range channel needed a breaker: there
   is no follower-side write-back at all, so the "origin takeover" the breaker counts cannot
   occur.
5. **Rate**: `crosshairMove` fires per pointer move (≤ display refresh); three
   `setCrosshairPosition` calls per event are single-pane repaints and Angular coalesces
   signal writes per tick. No throttle now; if it ever shows on a profiler, coalesce the
   *service* write to one `requestAnimationFrame` — not the followers.
6. **Known limitation, accept for v1**: `setCrosshairPosition` goes through
   `timeToIndex(findNearest = true)`, so on a follower that has no bar at that instant (dxy
   during a weekend, btc-oi before its first point) the line sits on the *nearest* bar, not
   at the exact wall-clock x. Document it in the component. If exact placement in whitespace
   is wanted later, a small series primitive drawing at `logicalToCoordinate(timeSecToLogical(t))`
   replaces the call — `ShapesPrimitive` already shows the pattern.
7. **Test hook**: `data-crosshair-time` (seconds, or absent) on `.chart-container`, set by the
   driver from its own event and by followers from the bar they positioned on.

### Regression tests

- **Unit** (`chart-sync.service.spec.ts`): `setCrosshair` sets origin+time; `null` clears;
  `reset()` clears; writing the crosshair does not change `range()`/`origin()`.
  (`chart.component.spec.ts`): the nearest-bar lookup — exact hit, between bars, before first,
  after last.
- **E2E** (`terminal.spec.ts`): move the pointer to 60 % width / mid-height of panel 1 and
  assert all four `data-crosshair-time` are present and equal within one bar; move the
  pointer off the grid and assert all four clear; **and** assert every panel's
  `data-visible-from/to` are unchanged across the hover and no `[ChartSyncService]`
  warning was logged (hover must not disturb the synced range — the concrete "no echo"
  check, on the network/DOM-state level rather than a DOM attribute merely existing).

---

## Bug 2 — OI history depth (server; independent, parallelisable)

### Evidence

- Coordinator's live query: 1,635 5m points, 2026-09-11 22:45 → 2026-09-17 15:25 UTC.
- On-disk store, `apps/signal-server/data/metrics/venue=binance/symbol=BTCUSDT/metric=openInterest/`:

  | file | rows | first row | mtime (local) |
  |---|---|---|---|
  | date=2026-09-11 | 15 | 22:45:00 | Sep 13 09:22 |
  | date=2026-09-12 | 288 | 00:00:00 (= exactly one day of 5m rows) | Sep 13 09:22 |
  | date=2026-09-13 | 403 | 00:00:00 | Sep 14 15:01 |
  | 09-14 / 09-15 / 09-16 / 09-17 | 296 / 711 / 987 / 659 | on-the-minute poll times | … |

  The oldest two files were written in one shot on 2026-09-13 09:22 local = 16:22 UTC, contain
  only 5-minute-aligned rows (backfill, not polls), and their span is
  `09-13 16:25 − 500 × 5 min = 09-11 22:45` **to the minute** — one page of 500 rows. The
  `metrics/` adapter and ingestion service landed in `7b09d16` on 09-12; 09-13 16:22 UTC was
  the first boot against real Binance with this data dir. Everything after is 1-minute
  polling (`bucketObservations` folds those into 5m buckets for the query — hence ~5.7 days
  of 5m points, not 41 hours).
- Today's restart (PID 41703, 15:23 UTC): `Warm-up backfilled 0 observations for
  binance:BTCUSDT/openInterest` — the tail between the previous run's last poll and now had
  no 5m boundary in it. Consistent with "extend forward only".
- **Venue semantics, verified live today** against `fapi.binance.com/futures/data/openInterestHist`
  with `symbol=BTCUSDT&period=5m&startTime=<now−29d>&endTime=<now>&limit=500`: 500 rows,
  **first 2026-09-15 21:55, last 2026-09-17 15:30**. Binance returns the *newest* `limit` rows
  inside the window, not the oldest.

### Root cause — two defects, both needed

1. **`BinanceMetricsAdapter.fetchObservations` paginates in the wrong direction**
   (`binance-metrics.adapter.ts:57-76`). It sets `startTime = cursor`, `endTime = to`,
   `limit = 500`, takes the page, then `cursor = lastTimestamp + 5m`. Because the page is the
   *newest* 500 rows, `lastTimestamp` is already ≈ `to`, `cursor > to`, the `while` exits:
   **one page, always, however wide the window**. The `HIST_RETENTION_MS` header comment
   ("CONFIRMED LIVE … startTime up to 30 days succeeds and returns data") is true and was the
   thing SE-4 verified; *which* 500 rows come back was never checked, and the mock/replay
   adapter never modelled it. The coordinator's "~3.3 pages then stopped" reading was the
   right instinct with the wrong arithmetic: it was one page plus four days of polls.
2. **`MetricIngestionService.warmUp` never deepens** (`metric-ingestion.service.ts:99-127`):
   `backfillFrom = latestStored + 1`. That is the right rule for "a restart never leaves a
   hole" (chart-layouts §4.4) and it is the *only* rule — there is no equivalent of the
   candle path's Phase 2 `deepenHistoryAsync()` (`ingestion.service.ts:99`, kicked from
   `main.ts:43`). So whatever depth the very first run achieved is the depth forever, and
   with (1) that depth was 41h40m. Fixing (1) alone would not heal this installation, or any
   installation that has already booted once; fixing (2) alone would heal it one page (41 h)
   per boot. Both are needed.

Side finding, cosmetic: on a fresh install `backfillFrom = now − 30d` is computed a few ms
before the adapter's own `earliestAllowed = Date.now() − 30d`, so the "clamping backfill
start" warning fires on every first boot for a few milliseconds of difference. Compute the
clamp against a `now` passed in, or clamp to `30d − 1 page`.

Also: the same one-page bug means any past outage longer than 41h40m left a permanent hole
in the middle of the store, not just at the front. The deepen shape below heals those too,
which is why I prefer it over "walk back from the oldest stored row".

### Fix

Files: `apps/signal-server/src/market-data/metrics/binance/binance-metrics.adapter.ts`,
`metric-ingestion.service.ts`, `main.ts`, `/api/health` shape in
`observability/health.controller.ts` (consumes `MetricIngestionService.status()`),
`test/market-data/metrics/metric-ingestion.service.spec.ts`, and a **new**
`test/market-data/metrics/binance-metrics.adapter.spec.ts`.

1. **Adapter: paginate backwards by `endTime`.** Request `[from, cursorEnd]` with
   `limit = 500`; the response is the newest 500 of that window; prepend it; stop when
   `rows.length < 500` or `firstTimestamp <= from`; else `cursorEnd = firstTimestamp − 1`.
   Return ascending. Rewrite the header comment to state the venue's newest-first semantics
   and the live check above. 30 days at 5m is 8,640 rows ≈ 18 requests — seconds.
2. **Ingestion: keep Phase 1 as-is, add Phase 2** mirroring candles: `deepenHistoryAsync()`
   called from `main.ts` after `app.listen()`, per pair: fetch the whole
   `[now − DEFAULT_CACHE_LOOKBACK_MS, oldest cached observation]` window through the fixed
   adapter — or, simpler and self-healing, the whole 30-day window — and upsert into
   `MetricCache` + `MetricWriteBuffer` (idempotent on `(instrument, metric, time)`). Do
   **not** emit `MetricObserved` for deep rows (the candle deepen does not push its pages to
   the bus/gateway either; 8k events to every WS client is noise). Walk oldest-page-last so
   `MetricCache.covers()` only ever gets more true, exactly the candle argument in §12.3.
   Anchor on `cache.window(...)[0]?.time` like `deepenInstrument1m` does — no new
   `MetricStore` port method needed.
3. **`/api/health`**: add `backfillStatus: 'deepening' | 'complete'` to each `metrics[]`
   entry (additive, same vocabulary as the candle field) so a shallow panel is honestly
   labelled while Phase 2 runs.
4. **No retention change**: 30 days is the venue floor; the store is the long-term history
   (§4.3) and grows one day per day from here. Nothing to do on the client for that.

### Client: scrolling a metric panel past the available history

Nothing new to build, once bug 3 lands: the panel shows blank space to the left of its first
point at the correct wall-clock alignment (the whitespace rule), `loadOlder()` keeps
paginating until the store is exhausted, and `noMoreOlderHistory` (5 empty hops) stops the
requests. The one thing the SE should check is that `isNearThisPanelsOldestLoaded` firing
every frame while the edge-`from` sits in the whitespace is fully absorbed by
`loadingOlder`/`noMoreOlderHistory` — it is today, per the freeze follow-up's finding 4. A
"history still loading" hint driven by the new `backfillStatus` is optional and out of scope.

### Regression tests

- **Adapter unit test (new, the one that would have caught this)**: a fake `fetch` over a
  synthetic 30-day 5m series that returns **the newest `limit` rows inside
  `[startTime, endTime]`**, exactly like the venue. Assert `fetchObservations(from = now − 30d,
  to = now)` returns all 8,640 rows ascending with no gaps, in ≥ 18 calls, and that a window
  narrower than one page returns in one call. The existing ingestion spec's fake adapter
  hides this because it is not a paginating fake.
- **Ingestion spec**: "store shallower than the lookback deepens after listen": fake store
  with 2 days, fake adapter with 30, assert Phase 1 still fills the tail first and starts
  polling, and that after `deepenHistoryAsync()` resolves the cache covers `now − 30d`,
  the write buffer received the deep rows, no `MetricObserved` was emitted for them, and
  `status()` reports `complete`.
- **Live check** (SE, before closing): restart is the coordinator's call, but once the
  server has been rebooted on the fix, `GET /api/metrics?…&timeframe=5m&from=0&to=<now>&limit=10000`
  must return ≈ 8,600 points spanning ≈ 30 days, and the oldest day files under
  `data/metrics/…` must reach `date=<today − 30>`.

---

## Aside, not diagnosed

The headless Playwright session logged `WebSocket connection to 'ws://localhost:3000/ws'
failed: Connection closed before receiving a handshake response` and the status bar showed
`reconnecting` throughout, while REST worked. The user's own browser evidently connects (they
see live data), so this may be headless-specific (origin/upgrade headers); the freeze
diagnosis's repros did not report it. Worth a look by whoever next touches `live.gateway.ts`,
not part of any of the three bugs.

## Cleanup

- Nothing on the running server or client was restarted, reconfigured or instrumented;
  `apps/chart-client/public/config.json` in the main checkout was already at
  `localhost:3000` and is untouched; this worktree's copy is untouched.
- The repro script is committed as `architecture/scratch/repro-right-edge-desync.mjs`
  (writes its screenshots to `/tmp`). The scratch `node_modules` symlink lives only in my
  session scratchpad.
