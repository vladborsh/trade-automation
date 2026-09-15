# Scroll-back pagination: real root cause (2026-09-15)

## Summary

The three prior fixes (`b6cab30`, `6d18a59`, `e49d5e9`) are all correct and
necessary, but none of them is the bug the user is hitting. The real cause is
an **unbounded cross-panel chart-sync feedback loop** in
`ChartComponent`/`ChartSyncService` (`apps/chart-client/src/app/features/chart/chart.component.ts`,
`chart-sync.service.ts`) that only manifests against real market data (gaps,
per-instrument session closures) — never against the mock's dense, gap-free
synthetic series. `PanelFeed.loadOlder()` and the `/api/candles` server path
are not reached at all in the failure the user is describing, because the
chart stops responding to further user input before the "near start" logical
threshold is ever crossed.

## Reproduction

Real signal-server + real chart-client, both already running from the
coordinator's earlier session (PID 9567 on :3000, PID 10328 `ng serve` on
:4200, cwd `/Users/Vladyslav_Borsh/Documents/trade_automation`, config.json
there already pointed at `localhost:3000`). Used a headless Playwright script
(scratchpad, not added to the repo) driving `page.mouse.down/move/up` on a
chart panel's time scale, same gesture as `e2e/terminal.spec.ts`'s third
test, but repeated many times instead of once.

Observed:

1. **The very first drag on any panel works** — `data-visible-from` moves
   back correctly, and `ChartSyncService` correctly propagates the new range
   to the other 3 panels (confirmed: their own `data-visible-from` also
   moved, matching the existing e2e test's expectation).
2. **Every subsequent drag — on any panel, in either direction, no matter how
   long you wait — is a complete no-op.** `data-visible-from` never changes
   again. Clicking the timeframe picker still works (proves Angular/zone.js
   and HTTP are not globally frozen); mouse-wheel zoom on the chart also
   stops working after that first drag.
3. **Zero additional `/api/candles` requests are ever fired** after the
   initial per-panel history load, for the rest of the session — confirmed
   both in a fresh repro and by grepping the coordinator's own
   `/tmp/signal-server-demo.log` / `/tmp/ng-serve-demo.log`, which show the
   same pattern (only the two initial-load bursts, nothing triggered by
   scrolling, across a ~20 minute window).
4. Added a temporary `console.log` inside
   `chart.component.ts`'s `subscribeVisibleTimeRangeChange` callback (main
   checkout only, rebuilt via the running `ng serve`, reverted with
   `git checkout --` immediately after capturing the evidence — not part of
   this diff). After a single drag on `btc`, the log shows a **sustained,
   self-perpetuating cascade of range-change events ping-ponging between
   `btc`, `eth`, `btc-oi`, and `dxy`** — dozens of events within a few
   hundred milliseconds, still going when the log capture ended, with the
   `applying` guard reading `false` on every one of them. It never converges
   on a stable range; it cycles between a handful of values indefinitely.

## Root cause

`ChartComponent`'s "Drive/Follow" cross-panel sync (§6.4,
`chart-sync.service.ts` + `chart.component.ts` lines ~152-175 and ~223-244)
has two reentrancy guards meant to stop a follower's own applied range from
re-triggering the loop:

- `applying` (synchronous): suppresses the echo fired *synchronously* inside
  `setVisibleRange()`.
- `lastApplied` + `epsilonSec` (half a bar): meant to suppress an
  *asynchronous* echo, or a follower's own bar-grid "snap" of the requested
  range to a slightly different one.

Both guards assume the follower's snap-back is at most "bar-grid noise" —
off by a fraction of a bar. That assumption holds for the mock's dense,
gap-free synthetic data (and for the single-drag e2e test, which never
iterates enough to notice a slow bounce). It does **not** hold for real
data: Capital.com's DXY panel has real session gaps
(`gapCount24h: 2` in `/api/health` during this repro), and each instrument's
actual candle grid doesn't align with another's. When `ChartComponent`
(follower) calls `setVisibleRange()` with a range that falls partly or
wholly inside one of its own instrument's real gaps, `lightweight-charts`
snaps the *actual* rendered range to something that can be off by **far
more** than half a bar — hours, in a gap. `lastApplied` is set to the
*requested* range, not the snapped one, so when the async echo (or the
follower's own subsequent user-visible range settle) arrives carrying the
*actual* snapped range, `sameRange(proposed, lastApplied, epsilonSec)` comes
back false, and the follower re-proposes its own (gap-adjusted) range back
into `ChartSyncService`. That range change then gets applied to the other
three panels, each of which may snap differently again against its own
data — and the cycle repeats forever, since nothing in `propose()` or the
Follow effect detects or breaks a cycle. The resulting continuous stream of
`setVisibleRange()`/re-render calls appears to pin the main thread badly
enough (or otherwise wedge `lightweight-charts`' own internal
pan/zoom-gesture handling) that the chart stops reacting to any further
mouse/wheel input at all, on any panel.

This is why unit tests never caught it: `chart-sync.service.spec` (if it
exists) and the e2e mock scenario both use synthetic data where every
panel's bar grid aligns and no real closures ever cause a large snap, so the
guards never get exercised past the "half a bar of grid noise" case they
were built for.

## Why the previous 3 fixes didn't catch this

- `b6cab30` and `6d18a59` are both about the `/api/candles` request/response
  path (`boundedFrom()`, `GapRepairService` crash guard) — the freeze happens
  entirely client-side, before any second candle request is ever sent.
- `e49d5e9` added `loadingOlder`/`MAX_EMPTY_GAP_HOPS` guards inside
  `PanelFeed.loadOlder()` — also never reached, because
  `loadOlderRequested` never fires a second time: the chart's logical range
  never crosses `NEAR_START_LOGICAL_INDEX` because user input stops being
  processed at all after the first drag.
- The 56 unit tests + 3 e2e tests all run against the mock's synthetic,
  gap-free, single-timeframe-aligned data, and the one e2e scroll test only
  performs a single drag — never enough repetition/real-gap exposure to
  observe the bounce.

## Routing plan → Software Engineer

**Files:** `apps/chart-client/src/app/features/chart/chart-sync.service.ts`,
`apps/chart-client/src/app/features/chart/chart.component.ts` (Drive/Follow
effects, ~lines 152-175 "Follow" effect and ~223-244
`subscribeVisibleTimeRangeChange`).

**Problem to fix:** the Follow effect's reentrancy guard against re-proposing
an applied range must survive a real snap that's off by much more than half
a bar (a session gap), not just grid noise. Concrete options, in order of
preference — SE should pick based on what's cleanest against
`chart-sync.service.spec.ts`'s existing tests (read them first):

1. **Track the actual applied range from the chart itself, not the requested
   one.** After calling `setVisibleRange(range)` in the Follow effect,
   immediately read back `this.chart.timeScale().getVisibleRange()` and set
   `lastApplied` to *that* (the real, possibly-snapped range) instead of the
   requested `range`. This directly fixes the mismatch that causes
   `sameRange()` to fail on the async echo.
2. **Suppress re-propose from a follower entirely for one full guard window**,
   not just an epsilon-based comparison: e.g. a boolean "just followed, don't
   propose on the very next range-change event no matter what it says," reset
   after that one event. Simpler, but slightly more likely to swallow a
   legitimate immediate follow-up user gesture on that panel — needs a short
   real-world check.
3. As a belt-and-suspenders backstop regardless of which of the above is
   chosen: add a hard circuit breaker in `ChartSyncService.propose()` — if
   the same panel re-proposes more than N times (e.g. 3) within a short
   window (e.g. 500ms) without the range settling, stop propagating further
   proposals for a cooldown period and log a warning. This bounds the damage
   of any *other* not-yet-discovered case that produces the same kind of
   loop, rather than relying solely on getting the snap-comparison exactly
   right for every real-data edge case.

**Verification SE should do before calling it fixed:**
- Re-run the exact repro above (real server + real client, drag one panel's
  time scale repeatedly — at least 10-20 drags, not just one) and confirm
  `data-visible-from` keeps moving on every drag, `/api/candles` requests
  keep firing with progressively older `from`/`to` as the panel nears its
  loaded edge, and the browser console shows no runaway
  `subscribeVisibleTimeRangeChange` cascade.
- Specifically test with the `crypto` layout's `dxy` panel included (it's
  the one with real session-gap data in this environment) since that's the
  panel most likely to trigger the large snap.
- Once the sync loop is fixed, actually verify `loadOlder()`'s own hop logic
  (`MAX_EMPTY_GAP_HOPS`, `HISTORY_LOOKBACK_MULTIPLIER`) against real data —
  that code was never actually exercised in this investigation because the
  freeze prevented reaching it, so it's still unverified in the live
  environment (though nothing found here contradicts it).
- Add a regression test: extend `apps/chart-client/e2e/terminal.spec.ts`'s
  scroll test (or `chart-sync.service.spec.ts`) to drag/propose a sequence
  that includes a range partly inside a data gap for one panel, and assert
  the proposed range converges (stops changing) within a bounded number of
  follow-cycles instead of continuing indefinitely.

## Cleanup already done

- Reverted the temporary diagnostic `console.log` in the main checkout's
  `chart.component.ts` (`git checkout --` on that one file only,
  confirmed via `git status`).
- Did not touch `apps/chart-client/public/config.json` in either the main
  checkout (already pointed at the real server from the coordinator's prior
  session, not something I set) or this worktree (left at mock defaults,
  `localhost:4300`, untouched).
- Left the coordinator's own already-running real server (PID 9567, :3000)
  and `ng serve` (PID 10328, :4200, cwd `/Users/Vladyslav_Borsh/Documents/trade_automation`)
  running, since they predate this investigation and the coordinator may
  still want them for interactive verification. Not started by me; I did not
  stop them.

## Follow-up (2026-09-15): `loadOlder()` pagination trigger is unreachable at real-data buffer depth

This is the "second, separate bug" `238d6e6`'s commit message flagged as found-but-out-of-scope, reported again independently by the SE who verified that fix: even with the sync-loop freeze gone, dragging the BTC panel repeatedly never fires a second `/api/candles` request, despite confirmed older history existing server-side.

### Reproduction

Real signal-server (already running, PID 9567, `:3000`) + a fresh `ng serve
--port 4200` from this worktree (`apps/chart-client`), `config.json`
temporarily pointed at `localhost:3000`/`ws://localhost:3000/ws`, reverted
after. Ad hoc Playwright scripts (not committed —
`architecture/scratch/repro{,2,3}.mjs`, left in place for SE/reviewer
reference since the task allowed keeping scratch scripts here) drove real
`page.mouse.down/move/up` gestures against the `btc` panel's chart container
and captured both `/api/candles` network requests and temporary
`console.log` instrumentation added to `chart.component.ts`'s
`subscribeVisibleLogicalRangeChange` and `panel-feed.ts`'s `loadOlder()`
(reverted via `git checkout --` immediately after capturing evidence — not
part of this diff).

Observed, with the crypto layout's 4 panels (`btc`, `eth`, `dxy` candles +
`btc-oi` a metric/points panel):

1. **Dragging on the chart's time-axis strip** (`y ≈ container height − 10px`
   — the exact gesture `e2e/terminal.spec.ts`'s existing scroll test uses,
   and the most visually "scrollbar-like," discoverable part of the widget)
   is a **zoom/rescale** in `lightweight-charts`, not a pan: `to` stays
   pinned at the last loaded bar while `from` shrinks. Repeating this
   gesture on `btc` (whose loaded buffer is the real `HISTORY_LIMIT = 1500`
   bars — confirmed via network capture, `limit=1500` on the initial
   `/api/candles` call, and real Binance 5m data has no gaps so the store
   actually fills all 1500) drove `btc`'s own logical `from` down to ~388
   and then **completely stopped responding to further identical drags** —
   zero further range-change events of any kind, on any panel, for the rest
   of the session (confirmed over 6+ additional repeats).
2. This is **not a resurgence of the sync-loop freeze** `238d6e6` fixed: no
   `console.warn` from `ChartSyncService`'s circuit breaker ever fired, no
   cascade of ping-ponging range-change events appeared, and — critically —
   dragging **inside the chart's plot body** (a genuine pan, not the axis
   strip) at the same point in the same session immediately started
   responding again, with `btc`'s own logical `from` decreasing smoothly and
   monotonically on every single one of 20 repeated pan gestures, no stalls.
3. The floor hit in (1) is `lightweight-charts`' own `timeScale.minBarSpacing`
   (default `0.5`px/bar): at this panel's rendered width (~630-650px), the
   widest possible zoomed-out view is roughly `width / 0.5 ≈ 1260-1300` bars.
   With `to` pinned at index 1499 (last loaded bar) and 1500 total bars
   loaded, the zoom-drag can reach down to roughly index `1499 − 1300 ≈ 200`,
   nowhere near `NEAR_START_LOGICAL_INDEX = 10`. Past that floor, the library
   itself produces no further range-change event for that gesture — this
   is a real, load-bearing limit of the widget, not an app bug, and it's
   exactly why repeating the *same* drag looks totally dead to the user.
4. The `btc-oi` panel (a `metric`/points panel riding the same synced time
   range) DID correctly fire `loadOlderRequested` → `PanelFeed.loadOlder()`
   during the very same drag, with clean guard state
   (`loadingOlder=false, noMoreOlderHistory=false`), and its fetch
   (`/api/metrics?...&from=...&to=...&limit=500`) genuinely landed. Its own
   loaded buffer is smaller than `btc`'s (visible logical range topped out
   around index ~1000 rather than ~1500 for the same synced time window),
   so the same zoom-drag's floor happened to land close enough to its start
   to cross the threshold. This directly confirms `e49d5e9`'s
   `loadingOlder`/`MAX_EMPTY_GAP_HOPS`/`noMoreOlderHistory` guards are
   **not** the culprit — once the trigger genuinely fires, the fetch path
   works exactly as designed, including against real (non-uniform) data.

### Root cause

`NEAR_START_LOGICAL_INDEX` (`chart.component.ts:45`, value `10`) is compared
against the panel's *bar index* in its full loaded buffer
(`HISTORY_LIMIT = 1500`, `panel-feed.ts:9`) — a buffer size that only became
routinely fillable end-to-end once `a364e59`/`ffdd3bd`'s per-timeframe
backfill/retention policy landed and gapless real data (BTC 5m on Binance)
became available deep enough to actually satisfy a 1500-bar initial request.

The single most discoverable "scroll back" gesture on this widget — dragging
the time-axis strip — is a zoom, not a pan, and is hard-capped by
`lightweight-charts`' `minBarSpacing` to showing at most roughly
`panelWidthPx / 0.5` bars at once. For any panel whose loaded bar count
exceeds that cap (as `HISTORY_LIMIT = 1500` now routinely does against real
backfilled data, at ordinary panel widths), **the near-start threshold is
structurally unreachable via that gesture** — the zoom floor is hit first,
and the gesture then produces literally zero further events, which is
indistinguishable, from a user's perspective, from "scrolling does nothing."

Panning (drag inside the plot body) does not have this problem and
correctly approaches index 0 with repeated gestures — but each realistic
small pan only advances the logical index by a handful of bars (~3-4 in this
repro), so reaching index 10 from a freshly-loaded 1500-bar buffer would
require on the order of 150-400+ repeated pan gestures. That's not "the
pagination doesn't work," but it is a UX/threshold-scaling problem: the
`10`-bar-from-start check was calibrated when a panel's buffer was small
enough (mock: ~576 bars) for either gesture to reach it in one or two
tries; it does not scale with `HISTORY_LIMIT`, and `HISTORY_LIMIT` is a
policy value from §12 that both is already 1500 and is expected to only
grow, not shrink, as backfill/retention policy matures.

### Why the existing e2e test didn't catch it

`apps/chart-client/mock-server/fixtures.ts`'s `SEED_HISTORY_MINUTES = 60 * 24
* 2` (2 days of 1m bars) generates only ~576 5m bars total per instrument —
roughly a third of `minBarSpacing`'s zoom-out cap at typical panel widths, so
the existing scroll e2e test's single time-axis zoom-drag comfortably
reaches every mock panel's own bar-index-0 in one gesture. The test's
assertion (`terminal.spec.ts` lines 111-116) also only checks that panel 2's
`data-visible-from` attribute changed after panel 1 is dragged — which is
true whether or not panel 2's `loadOlder()` fetch actually ran, since the
*synced range itself* moving is sufficient to change `data-visible-from`.
The test never asserts a second `/api/candles`/`/api/metrics` request
actually fired, so it would still pass even in a world where `loadOlder()`
silently never triggered at all. Both of these — a fixture far shallower
than the real `HISTORY_LIMIT`, and an assertion that doesn't confirm the
network request it's nominally testing for — mean this class of bug has no
current test coverage, mock or e2e.

### Routing plan → Software Engineer

**Files:**
- `apps/chart-client/src/app/features/chart/chart.component.ts` — the
  `subscribeVisibleLogicalRangeChange` callback (~lines 236-240) and
  `NEAR_START_LOGICAL_INDEX` (line 45).
- `apps/chart-client/src/app/core/state/panel-feed.ts` — `HISTORY_LIMIT`
  (line 9); no guard-logic changes needed here (see finding 4 above), but SE
  should re-read `loadOlder()` since the fix will likely need it to expose
  `firstOpenTime()`/timeframe info the trigger can use.
- Tests: `apps/chart-client/e2e/terminal.spec.ts` (scroll test's assertion
  gap), `apps/chart-client/mock-server/fixtures.ts`
  (`SEED_HISTORY_MINUTES`), and a new/extended
  `apps/chart-client/src/app/features/chart/chart.component.spec.ts` if one
  gets added (none currently exists for `ChartComponent`).

**Problem to fix:** make the "near start" trigger invariant to how many bars
happen to be loaded and to which gesture (zoom-drag vs. pan) the user used,
instead of an absolute bar-index count that assumes the visible viewport can
always reach index ~10 through ordinary interaction.

**Recommended fix:** change the trigger to a **time-based** proximity check
instead of (or in addition to) the logical-index one: in the
`subscribeVisibleLogicalRangeChange` (or better, also/instead in the
existing `subscribeVisibleTimeRangeChange`) handler, convert the visible
range's `from` to a timestamp (`chart.timeScale().coordinateToTime()` or use
the time range callback's own `range.from`, which is already a UTC
timestamp) and compare it against the panel's own `firstOpenTime()` (or an
equivalent "oldest loaded bar" time), e.g. "visible `from` is within N bars'
worth of calendar time of the oldest loaded bar" (reuse the same
`TIMEFRAME_MS[tf] * someSmallMultiplier` shape already used for
`boundedFrom()`). This fires correctly regardless of total buffer size and
regardless of whether the user reached the edge by zooming or panning, since
it's anchored to actual data availability, not to how many bars fit on
screen. `PanelFeed` already exposes `firstOpenTime()`
(candles)/`firstTime()` (points) internally — SE will need to surface
whichever one `ChartComponent` doesn't already have visibility into (it
currently only holds candle/point *arrays* as inputs, not the store), most
simply by computing "oldest loaded time" from the `candles()`/`points()`
input signals it already has (e.g. `candles()[0]?.openTime`) rather than
reaching into `PanelFeed` directly, keeping `ChartComponent` free of feed
knowledge as documented at the top of the file.

**Alternative (weaker, not recommended as primary):** detect "a zoom gesture
happened but the range didn't move" as a proxy trigger. More fragile (harder
to distinguish "hit the zoom floor" from "user didn't actually drag much"),
and doesn't fix the underlying scaling mismatch for pan-only reachability
either.

**Do not** fix this by shrinking `HISTORY_LIMIT` — that value exists to
serve §12's backfill/retention depth policy; making it smaller to keep it
under the zoom-floor cap defeats the point of that work and would just
recreate this bug the next time a panel gets wider or `HISTORY_LIMIT` grows
again.

**Regression tests to add:**
1. Bump `apps/chart-client/mock-server/fixtures.ts`'s `SEED_HISTORY_MINUTES`
   (or add a second, opt-in fixture profile) so at least one e2e scenario
   generates a buffer comparable in bar-count to the real `HISTORY_LIMIT`
   (≥1500 5m bars ⇒ ≥5.2 days of 1m seed), and extend
   `terminal.spec.ts`'s scroll test (or add a new test) to perform a
   *single* time-axis zoom-drag against that deep fixture and assert a
   second `/api/candles` (or `/api/metrics`) request is actually observed
   (via Playwright's `page.on('request')`, not just a DOM attribute
   change) — this is the concrete gap that let this bug ship unnoticed.
2. Keep the existing shallow-fixture scroll test as-is (regression guard
   that the original, already-passing scenario doesn't regress).
3. A focused unit test (new `chart.component.spec.ts`, or extend
   `chart-sync.service.spec.ts` if `ChartComponent` is hard to instantiate
   standalone) asserting `loadOlderRequested` fires when the visible time
   range's `from` is within the time-based proximity window of the panel's
   oldest loaded data point, independent of how many total bars are loaded
   — i.e., directly tests the fix's invariant, not just the old
   bar-index-10 case.

**Verification SE should do before calling it fixed:** re-run this
investigation's repro (real server + real client, `btc` panel, both the
time-axis zoom-drag *and* plain panning) and confirm a second
`/api/candles` request fires within a small, realistic number of gestures
either way — not just via extensive panning.
