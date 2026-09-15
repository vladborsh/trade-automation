# PARITY — the Stage-0 gate, `VWapStrategy`

**Both proofs pass, on the full history of all four instruments.**

| gate | requirement (ARCHITECT-NOTE §5 Stage 0, smart-money precedent) | result |
|---|---|---|
| 1 — bar-for-bar parity against the TypeScript | identical signal timestamps, directions, stops, targets; zero discrepancies or an itemised list | **PASS — 0 discrepancies.** Not a ≥30-day window: **every calendar month of every instrument's entire Capital.com history** (132 month-chunks, 2024-01 .. 2026-09). **200,322 evaluated bars, every intermediate value bit-identical** (floats compared with exact `==`, not a tolerance); **2,322 orders, every field of every order's lifecycle identical** |
| 2 — prefix-causality | re-derive ≥ 200 sampled signals on a tape truncated at the signal bar; 0 lookahead | **PASS — 600/600 identical** (400 signals + 200 non-signal evaluated bars, 150 per instrument), covering the VWAP band, the "high-timeframe" (M1) bias, the 200-bar range, the prior-hour sweep, the iFVG state, ATR, the gates, stop and target |

Machine checks: `results/CHECKS.md` (C1–C4 gating, all PASS; C5 informational).

**Three findings the architecture note and the knowledge file did not have** —
D-01 (the bot's candle timestamps are not UTC), D-03 (`getLastIfvg` is
asymmetric, contradicting both knowledge files), and the live-vs-backtest
section §4 (what the deployed bot reads is one bar earlier than its backtest,
and a request-clock hazard). D-01 is the material one. §5 has the sample-size
consequence for Stage 1, which is the other thing the Architect must decide on
before a go-ahead.

---

## 1. Gate 1 — bar-for-bar parity

### 1.1 How it was run

`npm run backtest ... vwap <static json>` cannot run here (same reasons as the
smart-money pass: `BacktestRunner.init()` builds a native-`canvas` renderer and
an AWS-backed `DynamicConfig`). `ts_parity/dump_vwap.ts` therefore reproduces
`BacktestRunner.runTests`'s bar loop verbatim (`backtest-runner.ts:66-79`:
`requestStartTime = time − 12h; requestEndTime = time; step = 1 minute`) and
imports every line under test **unmodified** from `cmc-bot-main/src/`:
`StaticDataSource`, `VWapStrategy`, `StrategyTemplate`, `RiskManager`, `Order`,
`VWAP`, `calculateFVG`/`fvg-element`, `range`, `ATR`, `previousHourLH`,
`composeIndicators`. **Nothing in `cmc-bot-main/` was edited.** `TZ=UTC`,
`ts-node --transpile-only`, dependency versions pinned to the bot's
`package.json` (`ts_harness/package.json`).

Hyper-parameters are exactly `StrategyProvider`'s (2.5 / 11.5 / 8, the
EURCHF/GBPCHF windows verbatim), with the user-specified provisional
US100/US500 windows (entry 09:40–11:40 NY, alive 09:40–14:30 NY) in place of
the S3 `FOREX_TIMINGS` object.

Two layers are diffed by `parity.py`:

1. **Every evaluated bar** (every minute `isValidTimeForNewOrders` is true). The
   harness calls the strategy's *own private methods* (`processCandles`,
   `getHighTimeFrameBias`, `isIFVGtoATRRatioAllowed`, `abovePrevHourHigh`,
   `belowPrevHourLow`) on the same windows `processStep` hands `processCharts`,
   plus `VWAP()` on the bias window for the band values. Compared: window length
   and first/last bar, 200-bar range top/bottom, `priceInDiscount`, both
   iFVG-occurs flags, `lastIFVG` presence/low/high, both iFVG list lengths,
   ATR(20), previous-hour high/low, bias-window length, VWAP and both bands, bias
   direction, the iFVG/ATR gate, both sweep flags, and whether the bar threw.
2. **Every order**: signal bar, entry time, direction, entry, stop as placed,
   target, exit time, exit price, exit cause, stop at exit, number of trails.

**Tape identity.** Both sides read the same bytes: `export_static.py` writes the
`StaticDataSource` JSON from the very parquet `engine.py` reads and records its
sha256 next to the TypeScript events; `parity.py` regenerates the bytes and
refuses to diff on a fingerprint mismatch.

**Monthly chunking is exact, not an approximation.** Every order is force-closed
at the end of its day's alive window, so no strategy state crosses a UTC
midnight (asserted by C2 on the full run). The TypeScript runs month by month
because `StaticDataSource.getCandles` scans the whole file on every call.

### 1.2 Result

| symbol | months | evaluated bars | bit-identical | TS orders | Python orders | exception bars (identical on both sides) | discrepancies |
|---|---|---|---|---|---|---|---|
| US100 | 33 | 86,878 | 86,878 | 895 | 895 | 0 | **0** |
| US500 | 33 | 86,878 | 86,878 | 947 | 947 | 0 | **0** |
| EURCHF | 33 | 13,642 | 13,642 | 239 | 239 | 76 | **0** |
| GBPCHF | 33 | 12,924 | 12,924 | 241 | 241 | 72 | **0** |

(Evaluated-bar counts include weekday minutes after the last pulled bar,
2026-09-11, and full-holiday days, where both sides see an empty window.)
Every US and EU DST transition in 2024–2026 is inside the battery.

Raw evidence: `results/parity_<SYM>.csv` / `.log` / `_problems.txt`,
`ts_parity/events/*.sha256`. The TypeScript event streams themselves
(`ts_parity/events/*.jsonl.gz`, 14 MB) are gitignored and regenerate with
`ts_parity/run_all.sh`.

### 1.3 The one false start, recorded

The first full battery showed 18–19 mismatching bars in five forex months,
all on the first day of a month that fell on a Monday. Cause: harness, not
port. `StaticDataSource.init` infers the interval from `candles[1] − candles[0]`,
so `export_static.py` trims leading rows until two consecutive minutes; with
only one day of padding that trim ate the sparse Sunday-evening forex bars
that a Monday 07:0x UTC 12-hour window reads. Padding raised to three days; the
whole battery (all four instruments, fingerprints changed) re-run from scratch;
0 discrepancies.

---

## 2. Gate 2 — prefix-causality

`checks.py` C1: for 100 randomly sampled orders and 50 non-signal evaluated
bars per instrument (seed 20260912), every bar after the evaluated bar is
**deleted**, and the bot's whole day is re-run from UTC midnight on that prefix
(so daily-cap and open-order state are rebuilt causally too). All components
listed in §1.1 layer 1, plus the gate flags, signal, stop and target, are
compared. **600/600 identical, 0 lookahead.**

Why it passes, component by component (from the code, confirmed by C1):

- **VWAP band** — cumulative sums and the deviation population run from the
  first bar of the bias window to the evaluated bar; nothing reads a later bar.
- **The M1 "high-timeframe" bias** — `getCandles(startOfDay(T)+1min, T)`;
  `openTime ≤ T`. Unlike the smart-money bot's H1 fetch (whose static-file
  backtest returns the finished hour — D-06 of that pass's unmerged Stage-0 WIP, commit `429b0db`), an M1 bar that opened
  at T is the bar being evaluated, so there is no intra-bar leak beyond the
  convention that decisions happen at the evaluated bar's close (D-02).
- **200-bar range** — covers the 200 bars *before* the evaluated one (D-06).
- **Prior-hour sweep** — the previous clock hour is strictly in the past; the
  6-bar max/min ends at the evaluated bar.

---

## 3. Disposition table — every finding

Bug-fidelity rule (same as the smart-money ruling): the port reproduces the
TypeScript's behaviour, bugs included. Nothing was silently fixed; anything
"repaired" would be a Stage-1 sensitivity row, never the primary.

| # | where | what the code / data actually does | in note / knowledge? | disposition |
|---|---|---|---|---|
| **D-01** | `capital-com.helpers.ts:9` + Capital.com `/prices` | **NEW, material.** The mapper sets `openTime = Date.parse(candle.snapshotTime)`. `snapshotTime` is **broker-local wall-clock time** — UTC+2 in EU winter, UTC+3 in EU summer (switches on the EU DST dates; offsets seen in all 3.9 M pulled bars: only +2 and +3, `results/COVERAGE.md`) — with no offset suffix, so on a UTC host `Date.parse` reads it as UTC. The payload also carries `snapshotTimeUTC`, which the bot discards. `from`/`to` request parameters *are* interpreted as UTC (probe, `ts_harness/probe_raw.ts`). **Consequences:** (a) *Live*, the clock gates use `Date.now()` and the request window is UTC, so the live bot evaluates the right bars — only their labels are shifted, and every label-internal use (`previousHourLH` hour boundaries, the VWAP day-reset, daily-cap day matching) is unaffected for these windows because the offset is a whole number of hours and all four windows sit far from any label midnight. (b) **The bot's own backtest on `npm run scrap` files is a different strategy**: those files store the shifted labels, `StaticDataSource` filters by them, and the runner's clock gates then select bars that really opened 2–3 h earlier — C5 re-runs the port on a label-timed tape: US100/US500 orders land on true **06:xx–09:xx NY** bars (pre-cash-open), EURCHF/GBPCHF on **00:xx–01:xx NY**; **0 / 3 / 0 / 0** of those orders coincide (bar, direction) with the UTC-timed stream. Any historical backtest or grid search the user ran on Capital.com data with this bot (`docs/backtesting.md` shows exactly such commands for US100/US500 `vwap`, and `generateHyperParameters` searches the windows) measured pre-market / Asian-session bars under New-York-session labels. | **no** | **This pass keys the tape by `snapshotTimeUTC`** — it reproduces the *deployed* bot's bars, not its backtest's. Parity is code-vs-code on identical tape, so it is unaffected either way. Declared, not a sensitivity: a label-timed Stage 1 would be testing a strategy nobody trades |
| **D-02** | `static-data-source.ts:44`, `strategy-template.ts:148-160` | The backtest reads the bar that **opened at T** at clock step T (fully formed), enters at its close, `entryTime = openTime + interval`. Self-consistent (decision at the bar's close), but the clock gates are evaluated at the bar's *open* time. Live reads one bar earlier — §4 L-01. | no | **reproduced** (parity target); live-like variant quantified in §4 |
| **D-03** | `fvg.indicator.ts:77-87` (and `FvgCalculator.getLastIfvg`, `fvg-element.ts`) | **NEW — contradicts `knowledge/vwap-band-reversal-ict.md` §3, `knowledge/smart-money-ict.md` §1.3 and the smart-money port.** `getLastIfvg`: bullish-iFVG list empty → `bearish[bullish.length − 1]` = `bearish[−1]` → `undefined`; **bearish list empty → `bullish[bullish.length − 1]`, a valid element.** So `lastIFVG` is undefined **only when the bullish list is empty**, not "whenever either list is empty". Confirmed against the bot's own `calculateFVG` on a constructed tape (`ts_parity/unit_last_ifvg.ts`, `results/D03_unit_last_ifvg.txt`) and by 200,322 bit-identical bars. The branch is live on 10,174 / 4,226 / 849 / 1,153 evaluated bars (US100/US500/EURCHF/GBPCHF) and decides **1 order** (GBPCHF). Consequence for this strategy: the ATR gate requires the **bullish** iFVG list (bearish FVGs closed back above) to be non-empty, for sells as much as for buys. | **no — the opposite is written** | **reproduced as-is.** Knowledge file corrected. **Flag for Architect:** the smart-money Stage-0 WIP (unmerged commit `429b0db`: `engine.py` `nbi == 0 or nsi == 0`, its PARITY D-01) carries the symmetric reading; its 0-discrepancy battery evidently never exercised a bearish-empty/bullish-non-empty bar at an otherwise-passing signal. Not touched by this pass |
| D-04 | `vwap-strategy.ts:232-249` | ATR gate is `ATR(20) / |ifvg.high − ifvg.low| < 8` — rejects **small** gaps (gap must exceed ATR/8). `getLastIfvgDirection` is not used by this strategy at all, so its sell default is irrelevant here. | yes (§4) | reproduced |
| **D-05** | `vwap-strategy.ts:81, 283-304` | The bias compares the evaluated bar's **open** (`lastCandle.open`) to the band computed *through that bar's close*. | partly (§2 says "lastPrice") | reproduced |
| **D-06** | `range.indicator.ts` | The slide pushes the window max **before** appending `candles[barIndex]`, so `top/bottom` cover the **200 bars before the evaluated bar**, excluding it; `priceInDiscount` compares the evaluated close to that midpoint. No value unless the window holds ≥ 201 bars (false / NaN stop otherwise; happened only on forex holiday bars, where the bias throws first). | no | reproduced |
| D-07 | `vwap.indicator.ts`, `vwap-strategy.ts:272` | Bias VWAP window starts at **00:01 UTC** (the 00:00 bar is excluded by `startOfDay + 1 min`). Band = VWAP ± **population** stdev (÷N) of `close − VWAP_at_that_bar` over **all** bars since then (the `differenceInMinutes` slice never trims, because the 00:00 bar is absent). Volume is Capital.com `lastTradedVolume` — broker tick activity, not exchange volume; no zero-volume bars in the tape. For the indices, UTC midnight is 19:00/20:00 NY — the anchor is the overnight CFD session, not the cash open. | partly (§1) | reproduced |
| D-08 | `atr.indicator.ts` | ATR is a plain arithmetic mean of the last 20 true ranges (not Wilder). | no | reproduced |
| D-09 | `previous-hour-lh.indicator.ts`, `vwap-strategy.ts:335-357` | Previous clock hour = `[H−1:00, H−1:59]` of the evaluated bar's label, scanning every window bar except the last; sweep = max high (min low) of the evaluated bar and the 5 before it, **strictly** beyond. | yes (§6) | reproduced |
| D-10 | `order.ts:83-106` | `Order.close()` clamps a close beyond stop/target back to the exact level; `profitable` is set from the unclamped price. | yes (§0) | reproduced |
| D-11 | `strategy-template.ts:194-245`, `risk-manager.ts:11-37` | Exits on M1 **closes** only, strict `<`/`>`; trailing runs **after** the exit check on the same bar; trail thresholds strict (`>1 && <2` → breakeven, `>2` → +1R; exactly 1.0 or 2.0 → no move). | partly | reproduced |
| D-12 | `risk-manager.ts:48-72` | Break-even close counts as a loss for the daily cap. | no | reproduced (affects only the capped population) |
| D-13 | `risk-manager.ts:74-123` | Stop shrink keyed on `rangeSize / stopSize` (small ratio = wide stop → ×0.5 / ×0.7). A zero-distance stop (close exactly on the 200-bar extreme) gives an order with `initialStopLossSize = 0` and ±∞ trail ratios — **1 order** (US500), reproduced bit-for-bit. A NaN stop suppresses the order (`putOrder` truthiness). | partly | reproduced |
| D-14 | `vwap-strategy.ts:200-222` | A buy may open while a sell is open (the cap is per direction); on the next bar the earlier of the two is closed at market. | partly | reproduced |
| D-15 | `vwap-strategy.ts:41-75` | Windows are built as NY wall-clock on the **UTC calendar date**, `getDay` is the UTC weekday; both ends inclusive. All four windows lie inside one UTC date, so no day slip. | knowledge §8 | declared pin: UTC host |
| D-16 | `backtest-runner.ts` loop | The loop steps every minute regardless of data: a missing bar at T re-reads the previous bar (185 / 300 / 77 / 73 evaluated bars; 0 orders came from a re-read bar). A gap before the signal bar makes `entryTime` > bar + 1 min (2 orders, US100). | no | reproduced |
| D-17 | `vwap-strategy.ts:322-325` | `priceAtTime(v, 9, 0)` computed, never read. | yes (§9) | not ported |
| **D-18** | `vwap.indicator.ts:12` | **NEW.** When no bar exists since 00:01 UTC but the 12-hour window is not empty (EURCHF/GBPCHF on 25 Dec and 1 Jan, 07:0x UTC), `VWAP([])` throws `Cannot read properties of undefined (reading 'openTime')`; `processStep` rejects after the exit/trail step. **Live** the runner's try/catch logs it; **the bot's own backtest CLI would crash** (no catch in `runTests`). 76 / 72 bars, identical on both sides. | no | reproduced as "no signal"; harness catches and records |
| D-19 | `strategy-provider.ts:25-26, 38-39` | US100/US500 windows come from S3 in production; this pass uses the user's provisional values. Whether they match what was live-traded is unknown. | yes (§4) | declared |
| D-20 | `backtest-runner.ts:55-62` | The runner's own `onOrderClosedByPrice$` handler calls `order.close()` a second time with `<=`/`>=`; idempotent. | — | not ported (same as smart-money D-15) |

---

## 4. Live bot vs backtest — what the deployed strategy actually reads

Not part of the parity target (parity is against the backtest bar loop), but
Stage 1 measures a strategy that someone trades, so these belong in front of
the Architect. Probes: `ts_harness/probe_raw.ts`, `ts_harness/probe_forming.ts`
(`results/L03_forming_candle_probe.txt`).

| # | what | evidence | effect |
|---|---|---|---|
| **L-01** | `TimerScheduler` fires at the minute boundary; live `getCandles(now−12h, now)` asks for up to 721 bars with `max: 720`, and the API drops the **newest** when truncating (probe). Separately, the still-forming minute was **not served** by requests sent 3.5 s and 10.5 s into the minute, and **was** served at 17.5 s (BTCUSD, weekend probe; `to` covered the forming bar in all three). So live, at clock minute T, the last bar is the one that opened at **T−1**, while the gates still use T. | probes | Live ≡ the backtest shifted one bar: bars 09:39–11:39 instead of 09:40–11:40, exits one bar later. `engine.run(live_like=True)` emulates it: **881/895, 922/947, 219/239, 227/241** orders (US100/US500/EURCHF/GBPCHF) are the same (bar, direction) as the backtest stream; the rest differ at the window edges and through the 720- vs 721-bar window start. Small, but not zero, and all in Stage 1's population |
| L-02 | For requests over 720 minutes (the index bias window, 00:01 UTC → 13:40+ UTC) `CapitalComClient.getCandles` chunks `[s, s+720]`, `[s+720, …]` — consecutive chunks share their boundary bar. When a chunk is complete (721 bars) the truncation drops that boundary bar and nothing is duplicated; **when the chunk has a missing minute, nothing is truncated and the boundary bar enters the live VWAP twice.** US500's tape is missing minutes in the 12-hour window on 59 % of evaluated bars (`results/facts_US500.csv`), so on US500 this is the common case, not an edge. | code | the live US500 bias band is computed on a tape with a duplicated bar most days; not reproducible bar-exactly without knowing the live request timing; small, but a genuine live/backtest difference |
| **L-03** | `convertTime` truncates to whole seconds, and the API rejects a `to` in the server's future (`error.invalid.daterange`, reproduced). The research host's clock ran 0.68 s ahead of Capital.com's `/time`; a request sent at host :00.3 was rejected. If the production host's clock leads the server's by more than the scheduler's firing latency, **every live request in that minute throws** and the runner's catch silently skips the strategy for the minute. | probe | Unverifiable from here (depends on the deployment host's clock). Worth one line in any live-deployment checklist |
| L-04 | Live candle labels carry the D-01 shift; entry/close times stored to DynamoDB are therefore 2–3 h off true UTC. | code | cosmetic for signals; matters to anyone joining the bot's stored orders to market data |

---

## 5. What Stage 0 means for Stage 1's design (no performance number)

**History floor.** Capital.com serves 1-minute bars only from **2024-01-01**
(bisected; identical for all four instruments). 32.3 months in total. The
smart-money pass's 36-month fit / 12-month holdout cannot be copied; the split
has to be pinned by the Architect inside 2024-01 .. 2026-09.

**Projected sample size**, from `results/INVENTORY.md` (orders per 12 months):

| | as-deployed (caps on) | caps off | projected n in a 12-month holdout, caps off | `n_holdout ≥ 150`? |
|---|---|---|---|---|
| US100 | 332 | 427 | ≈ 427 | yes |
| US500 | 352 | 482 | ≈ 482 | yes |
| EURCHF | 89 | 89 | ≈ 89 | **no** |
| GBPCHF | 89 | 90 | ≈ 90 | **no** |

The forex legs are bound by their 17–18-minute entry windows (the daily caps
almost never bind there). **At ~90 orders a year, `n_holdout ≥ 150` needs a
holdout of ≥ 20 months out of 32**, leaving ≤ 12 months of fit. Under the
precedent's stop rule ("projected holdout n < 150 → stop and return to
Architect") the two forex instruments are **UNDERPOWERED by construction**
under any conventional split; the indices clear the bar comfortably. This is
the decision the Architect needs to make before Stage 1, together with D-01
(which tape) and L-01 (backtest bar vs live bar as the primary).

**Other inputs for the Stage 1 design, recorded here:**

- 38 % (US100: 538 of 1,433) / 38 % (US500: 584 of 1,531) of bars where `processCharts` returns a signal are
  rejected because an order in the same direction is already open — signals
  cluster on consecutive bars. Caps-off keeps that rule, so "caps off" is still
  path-dependent through it.
- The raw pull keeps bid/ask OHLC; `prep_data.py` stores the close spread per
  bar, so Stage 1 can use Capital.com's **actual historical spread** instead of
  assuming one (ARCHITECT-NOTE §4 asks for exactly that).
