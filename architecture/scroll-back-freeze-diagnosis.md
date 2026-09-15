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
