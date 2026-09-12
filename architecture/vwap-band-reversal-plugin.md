# Architecture note — `vwap-band-reversal` as a research-tier chart plug-in

**Author:** Architect · **Date:** 2026-09-12 · **Status:** design + routing
plan to Software Engineer (two parallel units, §8). Extends
`architecture/live-signal-server.md`; the contract amendments this design
needs are recorded there in §11 (single source of truth for the wire
contract) and only *referenced* here.

Role-to-role technical material (`PROJECT.md` → "Communicating with the
user"). UI copy in §6 is user-facing and written plainly.

Inputs read: `PROJECT.md`; `agents/roles/{architect,software-engineer}.md`;
`architecture/live-signal-server.md`; `knowledge/vwap-band-reversal-ict.md`;
`research/cmc-bot-vwap/ARCHITECT-NOTE.md`; `IDEAS-BACKLOG.md` (VWAP entry);
`RESEARCH-LOG.md` (Запись 19); the merged scaffold — `libs/contracts/src/*`,
`apps/signal-server/src/{strategy-engine,market-data,api,config}/**`,
`apps/signal-server/config/*.yaml`, `apps/signal-server/README.md`,
`apps/chart-client/src/app/**`; in `cmc-bot-main/` (read only):
`src/strategy/{vwap-strategy,risk-manager}.ts`,
`src/indicator/tools/{vwap,fvg,range,previous-hour-lh,atr}.indicator.ts`,
`src/indicator/tools/fvg-element.ts`; and, **read-only, in the in-flight
Researcher worktree `researcher-cmc-bot-vwap`** (nothing touched):
`research/cmc-bot-vwap/{README.md,common.py,engine.py}`,
`results/{COVERAGE,INVENTORY,CHECKS}.md`, `results/parity_*.log`,
`results/L03_forming_candle_probe.txt`.

---

## 0. The user's ask, and the tension

The user asked: *implement the VWAP strategy's signals on the chart, copied
from `cmc-bot-main`; compute on the server, hand the signal to the client.*

The standing discipline says the opposite order: `live-signal-server.md`
§9.3 defers the strategy plug-in port to Integration Engineer "until a
strategy passes its pre-registered test"; `research/cmc-bot-vwap/ARCHITECT-NOTE.md`
§5 says Software Engineer engages "only on a REAL EDGE verdict, per
instrument". The VWAP band-reversal strategy has **no verdict**: Stage 1 (the
pre-registered hypothesis test, kill/build thresholds fixed in §3 of that
note) has not started.

### 0.1 What the Researcher's worktree actually contains today

This matters for the ruling, so I checked (read-only). Stage 0 is
**materially complete** in `researcher-cmc-bot-vwap`, uncommitted:

- `results/CHECKS.md`: **all gating checks pass on all four instruments** —
  TypeScript↔Python parity is **bit-exact over 33 months** (US100: 86,878
  evaluated bars, 895 orders vs 895; US500 86,878 / 947; EURCHF 13,642 /
  239; GBPCHF 12,924 / 241; zero problems), prefix-causality 0 leaks,
  invariants 0 violations.
- `results/COVERAGE.md`: Capital.com serves 1-minute history from
  **2024-01-01** for all four; the tape is clean (0 duplicates, 0
  non-monotone, 0 zero-volume bars).
- `results/INVENTORY.md`: signal counts and the full eligibility funnel, no
  performance number (as the ruling requires).
- Not yet written: `PARITY.md` (the disposition table for the `D-xx`/`L-xx`
  findings the code comments reference) and `HANDOFF.md`. The Researcher is
  at the close-out step of Stage 0, not mid-port.

So: **the port's correctness is provable today; the strategy's validity is
not.** Those are two different questions, and the ruling below rests on
keeping them separate.

### 0.2 Ruling

**Build it now, as a `research`-tier, visualization-only, disabled-by-default
plug-in — with the "unvalidated" label enforced structurally in the contract
and the runner, not painted on in the UI.** Option (a) from the dispatch,
tightened. Reasoning:

1. **No trading risk is created.** `ExecutionPort` is `NoopExecution`; the
   plug-in emits `kind: 'info'` only; the runner *rejects* `kind: 'entry'`
   from any non-`live` tier (§11.2 of the infra note). Nothing this plug-in
   does can reach a broker, now or by a config edit. Promotion to `live` is a
   **code change gated on an Architect ship ruling**, not a YAML flip
   (§5.3).
2. **The port has a parity oracle today, which it would not have had before
   Stage 0.** The Researcher's bit-exact TS↔Python harness and the
   per-bar component dumps (`results/evals_*.parquet`) are exactly the
   fixtures a TypeScript plug-in needs to prove it reproduces the bot. §9.3
   of the infra note wanted the port done "from the validated Python
   reproduction with parity tests" — the *reproduction* exists now; only
   the *verdict* is pending. Doing the port now front-loads Integration
   Engineer's mechanical work; if Stage 1 kills the idea, the plug-in
   directory is deleted (§5.4) and the cost was a bounded engineering unit.
3. **Watching the mechanic on live bars is legitimately useful to the user
   before Stage 1** — the index timing windows are *user-supplied
   provisional values* ("потом протестируем поменяем"), and seeing where the
   mechanic fires on a live chart is a reasonable way to sanity-check
   them. That use is served by a labelled research overlay; it is not
   served by a chart that looks like a trading terminal with a working
   signal on it.
4. **Why not (b), block until Stage 1?** Because the thing that is
   dangerous — an unvalidated idea presented as a signal — is prevented by
   labelling and by the `entry`-rejection guard, not by the absence of code.
   The project's kills (`IDEAS-BACKLOG.md`, `RESEARCH-LOG.md` Записи 17–18)
   were of *claims*, not of *code*; the risk this discipline guards against
   is someone reading a chart marker as evidence. §6 makes that reading
   impossible to arrive at by accident.

**What this ruling does *not* change:** the pre-registration in
`research/cmc-bot-vwap/ARCHITECT-NOTE.md` §3 stands verbatim. Nothing on the
chart is admissible evidence for Stage 1. The plug-in's existence must never
be cited in a ship/kill argument, and INVENTORY-style counts from the live
server are not a substitute for the holdout test. Stage 1 still needs its
own Architect go-ahead, unaffected by this note.

**Non-negotiables for Software Engineer** (each is a concrete build item in
§8): the plug-in's `tier` is `'research'` in code; every signal and every
indicator point it produces is stamped `tier: 'research'` by the *runner*,
not by the plug-in; the strategies API exposes the tier and a
plain-language description; the chart shows a persistent research badge
whenever research-tier output is on screen; the config entry ships
`enabled: false`; the strategy id carries no `example-` prefix (it is not a
demo — it is a faithful port of a real, unvalidated strategy, and the label
says exactly that).

---

## 1. Scope: what "the signal" is

The bot's `VWapStrategy` has three layers. Only the first is this plug-in's
job.

| Layer | Bot code | Ported here? |
|---|---|---|
| **Mechanical trigger** — VWAP-band bias, band-width regime, iFVG on this bar, premium/discount, iFVG-size gate, prior-hour sweep, entry window, plus the stop/target the bot would compute | `processCharts` (minus the two `riskManager.*PerDayReached` terms), `adjustStopLoss`, `adjustTakeProfitToTargetRiskRewardRatio` | **Yes** — pure function of the candle window and the clock |
| **Order-state rules** — ≤1 open order per direction, daily 2-loss/1-win caps, force-close outside the alive window, breakeven/+1R trailing | `RiskManager`, `Order`, `verifyExistingOrders`, `processOutOfValidTime` | **No** — this is position management. Per `live-signal-server.md` §9.3 it is Integration Engineer's, and it is path-dependent on simulated exits, which a `SignalStrategy` must not carry. Stage 1's own primary population is "caps off" for the same reason (`research/cmc-bot-vwap/ARCHITECT-NOTE.md` §5, mirroring Запись 19 §3.4) |
| **Live-read quirks** — the deployed bot's `max: 720` dropping the newest bar so gate `T` reads bar `T−1` (Researcher's L-02), forming-candle inclusion in the bias request (L-03) | `strategy-runner.ts`, `capital-com-client.ts` | **No** — these are artifacts of the bot's polling, not of the strategy. The plug-in evaluates the just-closed bar `T` with a window ending at `T`, i.e. the **backtest/parity semantics** the Researcher proved. Documented in the plug-in README so nobody "fixes" it toward the live bot later |

Consequence, stated plainly on the chart (§6): **a marker is "the mechanic
fired here", not "an order would have been placed here".** The funnel in
`results/INVENTORY.md` gives the size of the gap: for US100, 1,859
mechanical triggers vs 895 as-deployed orders over 32 months.

---

## 2. `VwapBandReversalStrategy` — the plug-in

Directory: `apps/signal-server/src/strategy-engine/strategies/vwap-band-reversal/`,
mirroring `strategies/example-cross/`. Registered in
`strategy-registry.service.ts`'s `PLUGIN_FACTORIES` under id
**`vwap-band-reversal`**. Files:

```
vwap-band-reversal/
  vwap-band-reversal.strategy.ts   # SignalStrategy impl: window slicing, gates, Signal/indicator assembly
  vwap-band-reversal.evaluate.ts   # pure evaluate(mainWindow, biasWindow, now, params): Evaluation — the parity surface
  indicators/vwap.ts               # VWAP + expanding-stdev band (bot's vwap.indicator.ts, last-value form)
  indicators/fvg.ts                # calculateFVG (fvg.indicator.ts + fvg-element.ts), incl. the D-03 lastIFVG asymmetry
  indicators/range.ts              # 200-bar high/low BEFORE the current bar (D-06), priceInDiscount
  indicators/atr.ts                # ATR(20), arithmetic mean of the last 20 true ranges
  indicators/previous-hour.ts      # previous clock-hour high/low, excluding the last bar
  session.ts                       # entry-window predicate (NY wall clock via ctx.clock.toZoned), Mon–Fri
  README.md                        # what it is, tier, "signal ≠ order", parity-fixture provenance, promotion/kill path
```

### 2.1 Declared requirements

```ts
readonly id = 'vwap-band-reversal';
readonly tier = 'research' as const;                       // §11.1 of live-signal-server.md
readonly displayName = 'VWAP band reversal (cmc-bot port)';
readonly description = 'Unvalidated. Port of the cmc-bot VWAP band-reversal mechanic; markers show where it fires, not trades.';
get requirements(): StrategyRequirements {
  return {
    instruments: [],                                       // filled from strategies.yaml by the registry, as example-cross
    timeframe: '1m',
    warmupBars: { '1m': 1440 },                            // CACHE DEPTH: a full UTC day (bias window) > the 12h main window
    minBars:    { '1m': 1 },                               // READINESS: evaluate as soon as one closed bar exists (§4)
    indicators: [{
      id: 'vwap-band', label: 'VWAP band (research, unvalidated)', scale: 'price',
      keys: [
        { key: 'vwap',       label: 'VWAP',        color: '#d29922' },
        { key: 'vwapTop',    label: 'VWAP +1σ',    color: '#d29922', style: 'dashed' },
        { key: 'vwapBottom', label: 'VWAP −1σ',    color: '#d29922', style: 'dashed' },
      ],
    }],
  };
}
```

Per-instrument params from `strategies.yaml` (§7): `entryWindow` (NY
wall-clock `[hh:mm, hh:mm]`, inclusive), `minVwapAtrRatio` (2.5),
`maxVwapAtrRatio` (11.5), `maxIfvgToAtrRatio` (8), `targetRr` (3),
`rangeBars` (200), `atrBars` (20), `mainWindowMs` (12 h),
`sessionTimezone` (`'America/New_York'` — the bot hardcodes NY for all four
instruments, including the CHF pairs; the plug-in reads this param, **not**
`Instrument.sessionTimezone`, to stay bug-faithful).

### 2.2 What `onCandle` reads from `ctx`

Everything comes through `ctx`; no I/O, no `Date.now()`, no timers.

- `ctx.now` — `openTime` of the bar that just closed; this is the bot's `T`.
- `bars = ctx.window('1m')` — closed 1m bars, ascending. Two slices **by
  timestamp**, never by count (the tape has gaps; the bot slices by time):
  - **main window** `M = bars.filter(b => now − 12h ≤ b.openTime ≤ now)`
    (both ends inclusive; up to 721 bars) — `backtest-runner.ts`'s
    `[T−12h, T]`. The FVG state, the 200-bar range, ATR and the prior-hour
    scan are all computed **inside this window only** — an FVG that formed
    before `now − 12h` does not exist to the bot, and parity depends on
    reproducing that.
  - **bias window** `B = bars.filter(b => utcMidnight(now) + 60_000 ≤ b.openTime ≤ now)`
    — `getHighTimeFrameBias`'s `add(startOfDay(endDate), { minutes: 1 })`:
    the 00:00 bar is **excluded**, bug-faithfully. `utcMidnight` is a plain
    `now − (now mod 86_400_000)` — `main.ts` pins `TZ=UTC`, which is the
    systemic fix for the host-timezone caveat (`vwap-band-reversal-ict.md` §1).
- `ctx.clock.toZoned(now, params.sessionTimezone)` — for the entry-window
  predicate (§2.5) and for `previousHourLH`'s clock-hour arithmetic (which is
  UTC-hour arithmetic on `openTime`; `toZoned` is only needed for the
  window).
- `ctx.instrument` — only for `id`/`pricePrecision` in output.
- `ctx.state` — **unused**. The mechanic is stateless per bar by design
  (§1). Leaving `state` empty is what makes replay evaluation trivially
  reproducible.

### 2.3 `evaluate(M, B, now, params): Evaluation` — the pure core

This function is the **parity surface**: its output vector is compared
field-by-field to the Researcher's per-bar dump (§8, SE-3 step 6). Field
names below match `engine.py`'s `COMP` layout so the fixture maps 1:1.

```ts
interface Evaluation {
  n: number;                       // |M|
  err: boolean;                    // bot would have thrown (any of: |M| = 0, |B| = 0 (D-18 VWAP([]) throws), |M| < 6 in the sweep loop)
  // range(v, 200) — D-06: the 200 bars BEFORE the last bar; undefined unless n ≥ 201
  rangeTop?: number; rangeBottom?: number; inDiscount: boolean;   // inDiscount = close[last] < (top+bottom)/2, false when undefined (close < NaN)
  // calculateFVG over M
  bullOcc: boolean; bearOcc: boolean;                            // bullishIfvgOccurs = a BEARISH FVG was inverted by the last bar, and vice versa
  nBullIfvg: number; nBearIfvg: number;
  hasIfvg: boolean; ifvgLow?: number; ifvgHigh?: number;         // D-03: bullish list empty → undefined; bearish empty → last bullish; both → larger x, tie → bearish
  // ATR(20) over M — undefined unless n ≥ 21
  atr?: number;
  // previousHourLH over M[0..n−2] (last bar excluded), clock hour = hour(now) − 1 in UTC, [hh:00, hh:59]
  prevFound: boolean; prevHigh?: number; prevLow?: number;
  // VWAP over B
  nBias: number; vwap?: number; vwapTop?: number; vwapBottom?: number;
  // sweep: max high / min low over the last 6 bars of M (last + 5 before)
  hi6?: number; lo6?: number;
  // derived
  bias: 'sell' | 'buy' | null;      // open[last] > vwapTop → sell; open[last] < vwapBottom → buy (D-05: OPEN, not close)
  vwapAtrRatio?: number;            // (vwapTop − vwapBottom) / atr
  ifvgGate: boolean;                // hasIfvg && atr / |ifvgHigh − ifvgLow| < maxIfvgToAtrRatio   (rejects SMALL gaps; Infinity < 8 is false)
  aboveHi: boolean; belowLo: boolean; // hi6 > prevHigh; lo6 < prevLow; both false when !prevFound
  sell: boolean; buy: boolean;      // the mechanical trigger, §2.4
  stop?: number; target?: number; stopShrink?: 0.5 | 0.7 | 1;
}
```

Indicator definitions, each in its own file so a unit test can pin it
against a hand-computed case (all "last value only" — the bot computes full
arrays and reads the tail; computing only the tail is an optimisation that
must not change any value):

- **VWAP band** (`vwap.indicator.ts`): cumulative `Σ close·volume / Σ volume`
  over `B`; `deviation_i = close_i − vwap_i` (vwap *as of bar i*, not the
  final one); `stdev` = **population** stdev of the last
  `differenceInMinutes(openTime_last, utcMidnight)` deviations — which, with
  1-minute bars starting at 00:01, is always *all* deviations in `B`;
  `vwapTop/Bottom = vwap ± stdev`. Zero cumulative volume → `NaN` → no bias
  (comparisons with `NaN` are false). Capital.com's tape has no zero-volume
  bars (COVERAGE.md), so this is a guard, not an expected path.
- **FVG** (`fvg.indicator.ts` + `fvg-element.ts`): for `i` from 3 to `n−1`,
  bullish FVG iff `close_i > open_{i−2} && low_i > high_{i−2}` with box
  `[high_{i−2}, low_i]`, `x = i`; bearish mirror `[high_i, low_{i−2}]`.
  After each bar's detection, filter with **that bar's** open/close: a
  bullish FVG is *inverted* iff `open > box.low && close < box.low` (the
  **proximal** edge; `smart-money-ict.md` §1.2), moving it to the
  *bearish-iFVG* list; the bearish mirror uses `open < box.high && close >
  box.high`. Then the same predicates prune the two iFVG lists. Flags are
  read **only off the last bar**. `lastIFVG` per D-03 above. Note the bot's
  `x` is a *window index*, not a time — the plug-in converts to `openTime`
  when drawing (§3) but keeps the index semantics for the tie-break.
- **Range** (`range.indicator.ts`): `top = max(high)`, `bottom = min(low)`
  over `M[n−201 .. n−2]` — the 200 bars **before** the last (the slide
  pushes the window max before appending `candles[barIndex]`; Researcher
  D-06). `inDiscount = close_last < (top + bottom)/2`.
- **ATR** (`atr.indicator.ts`): `TR_k = max(h_k − l_k, |h_k − c_{k−1}|,
  |l_k − c_{k−1}|)`, ATR = arithmetic mean of `TR` over the last 20 bars of
  `M` (`k = n−20 .. n−1`). Requires `n ≥ 21`.
- **Previous hour** (`previous-hour-lh.indicator.ts`): `h = hour(now) − 1`
  (UTC, `add(openTime, {hours: −1})` then `setMinutes(0)`/`setMinutes(59)`);
  scan `M[0 .. n−2]` for bars with `hh:00 ≤ openTime ≤ hh:59` of that hour;
  `prevFound` iff any. On a UTC-host `setMinutes` is UTC-minute arithmetic,
  so this is "the previous UTC clock hour", which coincides with the
  previous NY clock hour (NY is a whole-hour offset).
- **Sweep**: `hi6 = max(high)` and `lo6 = min(low)` over `M[n−6 .. n−1]`;
  the bot indexes `candles[n−6]` unguarded, so `n < 6` **throws** in the bot
  → `err = true`, no signal.

### 2.4 The mechanical trigger and levels (bot's `processCharts`, caps removed)

```
common = !err && vwapAtrRatio ∈ [min, max] && ifvgGate
sell   = common && bearOcc && !inDiscount && bias === 'sell' && aboveHi
buy    = common && bullOcc &&  inDiscount && bias === 'buy'  && belowLo
```
`bias` is exclusive, so at most one is true. When one is true:

- `entry = close_last`; anchor = `rangeTop` (sell) / `rangeBottom` (buy);
  `stopSize = |anchor − entry|`; `ratio = (rangeTop − rangeBottom) / stopSize`;
  `shrink = ratio < 2.5 ? 0.5 : ratio < 3 ? 0.7 : 1`;
  `stop = entry ± stopSize·shrink` (sell: `+`, buy: `−`);
  `target = entry ∓ targetRr·|stop − entry|`.
- **A Signal is emitted only if `stop` and `target` are finite and truthy**
  — the bot's `putOrder` "stop and target truthy" condition. With `n < 201`
  the sell path passes the discount gate (`!false`) but `rangeTop` is
  undefined → `NaN` stop → no order; the plug-in must reproduce that outcome
  (no signal), and `evaluate` still reports `sell = true` for the parity
  vector. `stopSize = 0` (entry exactly at the range extreme — INVENTORY
  records 1 such US500 order) gives `stop = entry`, truthy → **emitted**,
  with `meta.stopSize = 0`.

### 2.5 Session gate

`isValidTimeForNewOrders`: signals only when `toZoned(now, tz)` falls inside
`entryWindow` **inclusive at both ends** (`date-fns` `isWithinInterval`) and
the **UTC** weekday of `now` is Mon–Fri (the bot's `getDay(timestamp)` on a
UTC host). Equivalence note for the unit test: the bot builds the window as
"NY wall-clock `hh:mm` on the **UTC calendar date** of `T`"
(`common.py: ny_window_utc_ms`); for every window in this strategy
(03:00–05:00 and 09:40–14:30 NY, i.e. 07:00–09:00 and 13:40–18:30 UTC) the
UTC date and the NY date coincide, so "zoned hour:minute of `now` within the
window" is the same predicate. Test it across the March and November DST
transitions (`ctx.clock.toZoned` is `date-fns-tz`; no `Date`-local math).

**Indicator points are emitted on every closed bar** where `B` is non-empty,
regardless of the entry window — the band is an indicator, and the chart
should show it all day. The bot never evaluates outside the alive window,
so there is no parity fixture for those bars; the *values* are the same
function, so the parity test on in-window bars covers the code path.

### 2.6 Output

`onCandle` returns `StrategyOutput` (§11.3 of the infra note):

```ts
{
  signals: sell || buy ? [signal] : [],
  indicators: nBias > 0 ? [{ seriesId: 'vwap-band', time: now, values: { vwap, vwapTop, vwapBottom } }] : [],
}
```

The `Signal`:

```ts
{
  id: uuid(), strategyId: 'vwap-band-reversal', tier: 'research',   // tier re-stamped by the runner regardless
  instrument: ctx.instrument.id, timeframe: '1m', time: now,
  kind: 'info',                                                      // NEVER 'entry' at research tier — runner rejects it
  direction: sell ? 'short' : 'long',
  levels: { entry, stop, target },
  overlay: [ …§3 ],
  meta: {                                                            // flat; every gate's inputs so a signal is auditable from the wire alone
    n, nBias, vwap, vwapTop, vwapBottom, vwapAtrRatio, atr,
    rangeTop, rangeBottom, inDiscount, ifvgLow, ifvgHigh, ifvgAtrRatio: atr/|ifvgHigh−ifvgLow|,
    prevHigh, prevLow, hi6, lo6, stopSize, stopShrink,
    entryWindow: '09:40-11:40 America/New_York', windowSemantics: 'backtest[T-12h,T]',
    caveat: 'mechanical trigger only; order-state rules (1/direction, daily caps, alive-window close) not applied',
  },
}
```

---

## 3. Overlay primitives and what the client must actually render

Per signal, `overlay` carries:

| Primitive | Content | Renderer status |
|---|---|---|
| `marker` | `time: now`, `position: 'above'` (short) / `'below'` (long), `shape: arrowDown/arrowUp`, `color: '#d29922'` (amber — reserved for research tier, §6), `text: 'research'` | exists |
| `rect` | the `lastIFVG` box: `from: openTime(M[ifvg.x])`, `to: now`, `top: ifvgHigh`, `bottom: ifvgLow`, translucent amber, `label: 'iFVG'` | **stub → implement** |
| `line` (2 points) | the swept prior-hour level: `(openTime(first bar of the previous clock hour), prevHigh|prevLow) → (now, same)`, dashed, `label: 'prev-hour high'/'low'` | **stub → implement** |
| `line` (2 points) ×2 | stop and target as short horizontal segments `(now, stop) → (now + 60 min, stop)`, red dashed; `(now, target) → (now + 60 min, target)`, green dashed. Segments, not `priceLine`s — a full-width price line per historical signal would smear the chart | (same) |

Not drawn (in `meta` only): the 200-bar range top/bottom, `hi6/lo6`.
`ray` is **not** used by this strategy (it exists for the smart-money bot's
true-open levels); it is implemented in the same pass anyway because the
one canvas primitive (§3.2) covers all three at once.

### 3.1 The gap: continuous indicator lines are not "signal overlays"

The dispatch asked whether `Signal.overlay` suffices to show the VWAP band
continuously. **It does not, and it should not be bent to.** Options
considered:

- *An `info` signal every bar carrying the day's polyline* — 1,440 persisted
  signals per instrument-day in `SignalStore`, each with a payload that grows
  through the day. Rejected: signals are the durable record of "the strategy
  said something"; an indicator is a recomputable by-product of candles.
- *Compute the band on the client from candles* — rejected: the user asked
  for server-side computation, and a client-side band would be a second
  implementation that can drift from the one the signals used. The chart
  must show *the band the signal saw*.
- *Add a first-class indicator path* — **chosen.** `live-signal-server.md`
  §11.3–§11.5 specify it: a strategy returns `indicators` alongside
  `signals`; the runner stamps and caches them in an in-memory
  `IndicatorCache` (ring per `(strategy, instrument, series)`, **not
  persisted** — rebuildable by replay); served by `GET /api/indicators` and
  pushed as `{ type: 'indicator', point }` frames on the existing `signals`
  subscription (no new client→server verb). The client draws each key as a
  lightweight-charts `LineSeries`.

Rule for the client: indicator series are drawn **only when the chart's
timeframe equals the point's timeframe** (`'1m'` here). On 5m/15m/1h the
band is hidden rather than mis-aligned — lightweight-charts merges time
scales across series, so 1m points on a 5m candlestick would insert phantom
time slots between bars. Downsampling for coarser timeframes is a later
addition, not in this pass.

### 3.2 Client renderers

- `rect`, `ray`, `line` are implemented by **one** lightweight-charts v5
  series primitive (`ISeriesPrimitive` attached to the candlestick series,
  drawing on canvas in `paneViews`) — `overlay/shapes.primitive.ts` — with
  the three existing stub renderer classes becoming thin adapters that
  hand their primitive lists to it. One canvas pass, no per-shape series
  objects. This is the "series primitives / plugin API" path
  `live-signal-server.md` §5.1 chose the library for.
- `IndicatorLayer` (`chart/indicator/indicator-layer.ts`) — separate from
  `OverlayLayer`: owns one `LineSeries` per `(strategyId, seriesId, key)`,
  `setData` on history load, `update` on live points, hidden when the
  timeframe rule above fails. Series title = the spec's `label` (which for
  this strategy says "research, unvalidated").
- `IndicatorsStore` (`core/state/indicators.store.ts`) — same shape as
  `SignalsStore`: history + live append, keyed by `(strategyId, seriesId)`.
- `StrategiesStore` — `GET /api/strategies` at boot; provides tier,
  display name, description and indicator specs by `strategyId` to the
  badge and the layers.

---

## 4. Warm-up and the session reset — is `warmupBars` the right shape?

Not on its own. `StrategyRequirements.warmupBars` currently does two jobs:
(1) it sizes the `CandleCache` (`StrategyRegistryService.sizeCache`), and
(2) it gates evaluation (`StrategyRunnerService.isWarm`: "at least N bars in
the cache"). For a fixed-lookback strategy those coincide. For a
session-anchored one they don't:

- **Cache depth** must cover the *largest* window the strategy will ever
  slice: the bias window at 23:59 UTC is 1,439 bars, the main window is up to
  721 → `warmupBars['1m'] = 1440` (the 3-day default depth already exceeds
  it; the declaration is for correctness, not sizing).
- **Readiness** is "does the window the bot would have had exist", and the
  bot's answer is *always yes* — it evaluates on whatever the venue returns,
  including a 3-bar day at 00:03 UTC and a 12h window with holes.
  `results/COVERAGE.md` shows the 12h window is short of 721 bars on 2,606
  US100 evaluations and on **every** EURCHF/GBPCHF evaluation (their 03:00
  NY windows are 7 hours after the UTC reset, but the CFD tape opens late
  Sunday and has thin overnight hours). Gating on 721 bars would make the
  server refuse exactly the bars the tape contains and the parity fixture
  expects.

**Decision — a minimal contract addition, `minBars`** (`live-signal-server.md`
§11.2): an optional `Partial<Record<Timeframe, number>>` the runner uses for
`isWarm` instead of `warmupBars` when present. This plug-in declares
`minBars: { '1m': 1 }` and handles short windows itself exactly as the bot
does (`err`, `n < 201`, `n < 21`, `n < 6` in §2.3). The cache-depth meaning
of `warmupBars` is unchanged, and `GET /api/strategies` keeps reporting
`warmupBars` as before (adding `minBars` next to it).

Rejected alternative: an `isReady(ctx)` hook on `SignalStrategy`. More
general, but it moves readiness logic into every plug-in and gives the
runner nothing to size a cache with. `minBars` is enough for every strategy
this project has pinned (the smart-money bot's 720-bar H1 lookback is a
genuine fixed count and keeps using `warmupBars`).

**Restart behaviour**: after a restart the boot sequence is storage → venue
REST tail → live (`live-signal-server.md` §4.1 `GapRepair`), so the cache is
whole before the first live close; `minBars: 1` does not weaken that. If a
backfill fails, evaluation proceeds on a short window — the bot's behaviour
— and `meta.n`/`meta.nBias` make it visible on every signal.

**Session reset itself** needs no runner support: the plug-in derives
`utcMidnight(now)` per call. There is no per-day state to reset because
there is no state (§2.2).

---

## 5. Instruments, data availability, and lifecycle

### 5.1 Instruments

All four of the bot's instruments are the demo universe, on Capital.com:

| `InstrumentId` | `assetClass` | `pricePrecision` | `quoteCurrency` | `sessionTimezone` | entry window (NY) | source of window |
|---|---|---|---|---|---|---|
| `capitalcom:US100` | `index-cfd` | 1 | USD | `America/New_York` | 09:40–11:40 | user-supplied, provisional |
| `capitalcom:US500` | `index-cfd` | 1 | USD | `America/New_York` | 09:40–11:40 | user-supplied, provisional |
| `capitalcom:EURCHF` | `forex-cfd` | 5 | CHF | `UTC` | 03:02–03:20 | hardcoded in the bot |
| `capitalcom:GBPCHF` | `forex-cfd` | 5 | CHF | `UTC` | 03:03–03:20 | hardcoded in the bot |

`instruments.yaml` currently has only US100; add the other three. The
`sessionTimezone` on the forex rows is the instrument's own session
convention (CFD forex runs on a UTC weekly cycle); the plug-in ignores it and
uses its `sessionTimezone` param (NY for all four, as the bot does).

### 5.2 What can run right now

- **Live Capital.com: not in the build environment.** `README.md` §"Capital.com
  adapter — untested against live" stands: no credentials here, the adapter
  has never been exercised against a session. The credentials *do* exist
  on the user's machine (`cmc-bot-main/.env`, gitignored; the Researcher's
  L-03 probe used them successfully today) — under different env names
  (`CAPITAL_COM_CUSTOM_PASS` vs the server's `CAPITAL_COM_PASSWORD`). Running
  the server in `MARKET_DATA_MODE=live` with those is a **user action**,
  documented in the README; the first such run doubles as the adapter's
  first live test and may surface mapper issues (the Researcher's D-01:
  `snapshotTime` is a label-timezone string, `snapshotTimeUTC` is the truth —
  the server's `mapPriceRow` already uses `snapshotTimeUTC`, which is the
  right choice and matches the Researcher's tape).
- **Replay: yes, once real fixtures exist.** The bundled
  `test/fixtures/capitalcom/US100/1m.jsonl` is 180 synthetic bars — no
  UTC-day structure, no 12h window; useless for this strategy. The parity
  fixtures (§5.3) double as replay fixtures for all four instruments. Until
  they land, SE-3 builds against unit-level fixtures they construct by
  hand (a synthetic day with a known FVG/inversion, a known prior-hour
  sweep) for the indicator unit tests, and the parity test is written
  against the fixture *format* below, ready to run.
- **Binance instruments**: irrelevant — this strategy has no crypto leg and
  must not be enabled on a `binance:*` id (the registry should reject an
  instrument whose `venue !== 'capitalcom'` for this plug-in with a boot
  error, since NY-window semantics on a 24/7 perp would be a silent
  misconfiguration).

### 5.3 Parity fixture — the dependency on the Researcher

The plug-in's correctness gate is bar-for-bar agreement with the
Researcher's proven port. The Researcher's tape (`data/*.parquet`) is
gitignored and lives only in their worktree, so the fixture must be
**exported there**, at Stage-0 close-out, and committed with the package.
Exact ask (coordinator → Researcher, §8.3):

```
research/cmc-bot-vwap/fixtures/parity/<SYMBOL>/candles.jsonl   # server Candle JSON, one per line, ascending; mid OHLC + volume; closed:true; source:'venue-rest'; bid/ask optional
research/cmc-bot-vwap/fixtures/parity/<SYMBOL>/evals.jsonl     # one line per evaluated bar in the entry window: {T, ...COMP fields by name, bias, sell, buy, stop, target, order_placed}
research/cmc-bot-vwap/fixtures/parity/README.md                # span, generator command, sha256 of the source tape slice
```
Span: **2025-03-05 00:00 UTC → 2025-03-12 23:59 UTC** for all four (8
calendar days, ≥ 5 trading days, straddles the 2025-03-09 US DST switch; ≈
10k bars per instrument, a few MB total). `evals` fields named exactly as
`engine.py`'s `COMP` list so the TypeScript test maps them without a
translation table. Generated by a small `export_fixture.py` next to
`inventory.py`, reading the same parquet, so it is reproducible by anyone
with the tape.

### 5.4 Lifecycle: promotion or deletion

- **Stage 1 passes on an instrument** (Architect ship ruling): Integration
  Engineer changes `tier` to `'live'` *in code* for that instrument set,
  switches `kind` to `'entry'`, implements the order-state layer (§1) behind
  `ExecutionPort`, and decides the live-read semantics question (L-02) with
  the Researcher's `PARITY.md` in hand. The chart badge disappears
  automatically because the tier on the wire changes. Signals persisted at
  research tier stay research tier — the label is per signal, not per
  strategy, precisely so history is never re-labelled retroactively.
- **Stage 1 kills it**: delete
  `strategies/vwap-band-reversal/`, its `strategies.yaml` entry, its
  registry line and the parity test; purge `data/signals/**` rows with that
  `strategyId` (file store) — one commit. The contract additions (`tier`,
  `minBars`, indicators) are generic and stay.
- **Either way**, `research/cmc-bot-vwap/` and the pre-registration are
  untouched by this note.

---

## 6. Labelling — where "unvalidated" lives, exactly

Built in at four layers; Software Engineer implements all four, the tests
in §8 assert each.

1. **Contract** (`live-signal-server.md` §11.1): `Signal.tier` and
   `IndicatorPoint.tier` are **required** fields of type
   `'demo' | 'research' | 'live'`. A consumer cannot receive a signal
   without its tier.
2. **Server**: `SignalStrategy.tier` is a readonly class property (not
   config). `StrategyRunnerService` overwrites `tier` on every signal and
   indicator point with the plug-in's declared value, and **throws** (→ the
   existing per-runner error path, `status: 'error'`, metric increment) if a
   non-`live` strategy returns `kind: 'entry'`. `GET /api/strategies`
   returns `tier`, `displayName`, `description`, `minBars`, `indicators` per
   strategy. `strategies.yaml` ships the entry with `enabled: false` and a
   comment mirroring the one on `example-cross`.
3. **Chart, per element**: research-tier markers are amber (`#d29922`) with
   text `research`; the indicator series title carries "(research,
   unvalidated)"; `signalsToOverlays`' fallback marker (for a signal with no
   overlay) uses the tier to pick colour, so even a strategy that forgets its
   overlay is labelled.
4. **Chart, persistent badge**: `ResearchBadgeComponent` in the top bar,
   shown whenever the selected instrument has (a) any displayed signal or
   indicator point with `tier !== 'live'`, or (b) an enabled non-`live`
   strategy in `/api/strategies` listing that instrument. Copy (plain
   English UI text, fixed here so it is built in, not improvised):

   > **RESEARCH — not a trading signal**
   > "VWAP band reversal" is an unvalidated strategy still being tested.
   > The amber markers and lines show where its rules would have fired.
   > They are not trade recommendations and have no track record.

   The first line is always visible; the rest is a tooltip/expander on the
   badge. The status bar additionally lists active strategies with their
   tier, e.g. `strategies: vwap-band-reversal (research)`.

The `demo` tier is what `example-cross` becomes — its "never described as a
strategy of this project" rule now has a field backing it.

---

## 7. Configuration

`strategies.yaml` addition (SE-3 writes the real one; values here are the
pinned parameters from `knowledge/vwap-band-reversal-ict.md` §2/§4/§7/§8 and
`research/cmc-bot-vwap/ARCHITECT-NOTE.md` §4):

```yaml
  # vwap-band-reversal: RESEARCH TIER — an unvalidated port of cmc-bot's VWapStrategy
  # (knowledge/vwap-band-reversal-ict.md). Visualization only; it cannot emit 'entry'
  # signals. Enabling it draws amber research markers/lines on the chart; it does not
  # create a trading signal. Promotion to 'live' is a code change gated on an Architect
  # ruling after research/cmc-bot-vwap Stage 1 — never a config edit.
  - id: vwap-band-reversal
    enabled: false
    instruments: ["capitalcom:US100", "capitalcom:US500", "capitalcom:EURCHF", "capitalcom:GBPCHF"]
    params:
      sessionTimezone: America/New_York
      minVwapAtrRatio: 2.5
      maxVwapAtrRatio: 11.5
      maxIfvgToAtrRatio: 8
      targetRr: 3
      rangeBars: 200
      atrBars: 20
      mainWindowMinutes: 720
      entryWindow:                       # NY wall clock, inclusive; US100/US500 are user-supplied PROVISIONAL values
        "capitalcom:US100":  ["09:40", "11:40"]
        "capitalcom:US500":  ["09:40", "11:40"]
        "capitalcom:EURCHF": ["03:02", "03:20"]
        "capitalcom:GBPCHF": ["03:03", "03:20"]
```

Per-instrument params keyed by `InstrumentId` inside `params` is a
convention this plug-in introduces; the registry passes the whole `params`
object to the factory as today, and the plug-in resolves per-instrument
values in `onCandle` from `ctx.instrument.id`. A missing window for an
enabled instrument is a **boot error** (zod-validate the params in the
factory), not a silent "never fires".

---

## 8. Routing plan

I am **not** self-dispatching. The work spans two apps and a contract
change, depends on an in-flight Researcher export, and the coordinator
asked for a plan to review. Two Software Engineer units run **in parallel**
— the contract they share is fixed in `live-signal-server.md` §11, the same
pattern that let SE-1/SE-2 run concurrently.

### 8.1 SE-3 — `libs/contracts` + `apps/signal-server`

Build order:

1. **Contracts** (`libs/contracts/src/{strategy,signal,wire}.ts`): implement
   §11.1–§11.5 of the infra note exactly — `StrategyTier`,
   `IndicatorSeriesSpec`, `StrategyRequirements.minBars/indicators`,
   `Signal.tier`, `IndicatorPoint`, `StrategiesResponse` fields,
   `IndicatorsQuery/Response`, the `indicator` WS frame. Round-trip tests.
2. **Strategy engine**: `SignalStrategy` gains `tier`, `displayName`,
   `description`; `onCandle` returns `StrategyOutput`. Update
   `ExampleCrossStrategy` (`tier: 'demo'`, wrap its array in
   `{ signals }`). Runner: `isWarm` honours `minBars`; stamps `tier`,
   `strategyId`, `instrument` on signals and points; rejects `entry` from
   non-live tiers; `IndicatorCache` (depth = the strategy's `warmupBars[tf]`
   + margin, mirroring `CandleCache.setMinDepth`); emits
   `IndicatorEmitted`. `statuses()` returns the new fields. Registry:
   venue guard for this plug-in (§5.2).
3. **API**: `GET /api/indicators`; gateway forwards `IndicatorEmitted` to
   `signals`-topic subscribers as `{ type: 'indicator', point }`. Extend
   `live.gateway.spec.ts`.
4. **The plug-in** per §2, file layout as listed, indicators each with a
   hand-computed unit test (an FVG that forms and inverts through the
   proximal edge; D-03's asymmetric `lastIFVG`; D-06's range excluding the
   last bar; the 00:00 bar excluded from the bias window; `n < 6` → `err`).
   Session predicate tested on 2025-03-09 and 2025-11-02 (DST) for all four
   windows.
5. **Config**: three instruments added; `strategies.yaml` entry (§7);
   params zod schema in the factory.
6. **Parity test** (`test/strategy-engine/vwap-band-reversal.parity.spec.ts`):
   loads `research/cmc-bot-vwap/fixtures/parity/<SYMBOL>/{candles,evals}.jsonl`,
   feeds candles through `CandleCache` (so the same `window()` the runner
   uses is exercised), calls `evaluate` at every `T` in `evals`, and asserts
   every `COMP` field equal (booleans/ints exact; floats within
   `1e-9·max(1,|x|)`), plus `sell/buy/stop/target`. Skips with a loud
   message, not a silent pass, if the fixture directory is absent — so the
   suite is green before the Researcher's export lands and red-or-skipped
   after, never falsely green.
7. **README**: a section for the plug-in (tier, "signal ≠ order", window
   semantics choice, fixture provenance, how the user runs live with
   their own credentials incl. the env-name mapping, promotion/kill path).
8. **Do not**: touch `ExecutionPort`; persist indicator points; read
   `Instrument.sessionTimezone` in the plug-in; "fix" any of the
   bug-faithful behaviours in §2.3 (each has a test pinning it *because*
   it looks wrong).

### 8.2 SE-4 — `apps/chart-client`

Build order:

1. **Retire the local contract stand-in**: replace
   `src/app/core/contracts/contracts.ts` with imports from
   `@trade-automation/contracts` (the README's own deferred TODO; now
   required — two hand-kept copies of a contract that is changing is how
   drift starts). Update `mock-server/` to the amended contract: it must
   emit `tier` on signals, serve `/api/strategies` with the new fields and
   `/api/indicators`, and push `indicator` frames (a synthetic VWAP band is
   fine — three slow sine-ish lines around the fixture's closes).
2. **`ShapesPrimitive`** (`chart/overlay/shapes.primitive.ts`): one
   lightweight-charts v5 `ISeriesPrimitive` drawing `rect` (filled,
   translucent, optional label), `ray` (horizontal from `(time, price)` to
   the right edge), `line` (polyline through `points`, solid or dashed per
   the new `style` field — §11.6 of the infra note, added by SE-3 step 1).
   `rect/ray/line.renderer.ts` become adapters onto it; the warn-and-skip
   bodies go.
3. **Indicators**: `IndicatorsStore`, `StrategiesStore`, `IndicatorLayer`;
   `MarketFeedService.switchTo` also fetches `/api/indicators` for the
   instrument and routes `indicator` frames; timeframe rule from §3.1.
4. **Labelling** per §6 items 3–4: tier-aware colours in
   `signalsToOverlays`, `ResearchBadgeComponent` with the fixed copy,
   status-bar strategy list.
5. **Tests**: store merge tests for indicators; a renderer test that a
   `rect` and a two-point `line` produce draw calls (mock canvas); e2e
   (Playwright, on the mock server): select US100 on 1m → three band lines
   present, an amber marker present, the research badge visible; switch to
   5m → band hidden, badge still visible.

Escalation rule, both units: any gap needing a *design* choice comes back to
Architect via the coordinator (`software-engineer.md`). Pre-answered:
(a) the `line` primitive needs a `style` field — add it (§11.6);
(b) the parity fixture is not there yet — build steps 1–5 and 7, write step 6
against the format in §5.3, and report "parity pending fixture" in the
hand-off; (c) Capital.com live cannot be exercised here — replay only, per
`live-signal-server.md` §9.1(a).

**Hand-off after build**: to the coordinator/Architect for review — **not**
to Backtesting (nothing to backtest: the strategy is unvalidated by
construction, and the parity test is the correctness gate) and not to
Integration Engineer (nothing ships).

### 8.3 Coordinator → Researcher (small, at Stage-0 close-out)

Ask the Researcher, when they write `PARITY.md`/`HANDOFF.md`, to also commit
the parity fixture export described in §5.3 (a ~30-line script over the
parquet they already have; span and format fixed there). This is the only
cross-worktree dependency. It does not block SE-3's build, only the final
run of the parity test. If the Researcher's pass has already closed by the
time this is read, it is a one-off follow-up task in that package.

### 8.4 Not routed

- **Integration Engineer** — unchanged: engaged only on a ship ruling (§5.4).
- **Backtesting** — nothing to re-validate; the replay path this pass makes
  real (four instruments' fixtures + a deterministic plug-in) is what they
  will use *if* Stage 1 passes.
- **DevOps Engineer** — no infra change; note for their existing list: the
  Capital.com credentials in Secrets Manager (`live-signal-server.md`
  §9.2 item 4) are what would make `MARKET_DATA_MODE=live` real for this
  plug-in in a deployed environment.
- **Researcher** — Stage 1 still requires its own Architect go-ahead after
  Stage 0's `HANDOFF.md`; this note does not grant it.

---

## 9. Logging decision

- **`IDEAS-BACKLOG.md`** — the VWAP entry gets a dated status line: an
  engineering build now exists for this idea *before* its verdict, at
  research tier, and that build is not evidence. A future reader of the
  backlog who finds `vwap-band-reversal` in the server must be able to see
  from the backlog that the idea's status did not change. Done in this pass.
- **`RESEARCH-LOG.md`** — **no entry.** This is an engineering/routing
  decision on infrastructure, not a research pass with a Результат; the
  live-server note set the same precedent (§10 there). The log entry that
  *is* owed is Stage 0's, from the Researcher, when they close out.
- **`PROJECT.md`** — Architecture table row for this note and a Status
  bullet. Done in this pass.
- **Gap noticed, not fixed here** (belongs to whoever closes the research
  package): the VWAP routing ruling of 2026-09-12
  (`research/cmc-bot-vwap/ARCHITECT-NOTE.md`) has no `RESEARCH-LOG.md`
  Запись, unlike the smart-money ruling (Запись 19). PROJECT.md's convention
  says every Architect pass gets one. Flagged to the coordinator in the
  report.
