# PARITY — the Stage-0 gate

**Both pre-registered checks pass.**

| gate | ARCHITECT-NOTE §4 requirement | result |
|---|---|---|
| 1 — bar-for-bar parity against the TypeScript | ≥ 30 trading days, identical signal timestamps, directions, stop prices, target prices; **zero discrepancies** or an itemised list | **PASS — 0 discrepancies**, 4 windows × ≥ 35 trading days, 4 symbols, 75 orders, and the comparison was extended beyond the required fields to entry time, exit bar, exit price, stop-at-exit and trail count |
| 2 — prefix-causality | ≥ 200 sampled signals re-derived from a tape truncated at the signal bar; **0 lookahead** | **PASS — 240/240 identical**, on the M1 path |

Machine checks: **13/13 PASS** (`results/CHECKS.md`, produced by `checks.py`).

There is one finding that the architecture note did not have, and it is not
cosmetic — see **D-06** below and §4. Stage 1's thresholds were pinned without
it.

---

## 1. Gate 1 — bar-for-bar parity against the bot's own TypeScript

### 1.1 How it was run

`npm run backtest ... sm <static json>` itself **cannot execute in this
environment**, and the reason is infrastructural, not logical:
`BacktestRunner.init()` constructs a `ChartCanvasRenderer` (the native `canvas`
2.11.2 bindings, which do not build against the Node 24 toolchain here),
an `EnvConfig` and a `DynamicConfig` (a `.env` and AWS SSM this project does
not hold), and `BacktestReporter.generateReport()` renders PNGs. None of that
participates in signal generation.

So `ts_parity/dump_signals.ts` reproduces `BacktestRunner.runTests`'s bar loop —
the twelve lines at `backtest-runner.ts:64-79`, verbatim:

```
requestStartTime = time - 12h ;  requestEndTime = time ;  step = 1 minute
strategy.processStep(requestStartTime, requestEndTime)
```

and imports **every other line under test unmodified** from `cmc-bot-main/src/`:
`StaticDataSource`, `SmartMoneyStrategy`, `StrategyTemplate`, `RiskManager`,
`Order`, `indicatorScript`, `FvgCalculator`, `Swings`, `YinDiscount`, `ATR`,
the date helpers. **Nothing in `cmc-bot-main/` was edited by this pass.**
It runs under `TZ=UTC` (the host pin of `knowledge/smart-money-ict.md` §2) with
`ts-node --transpile-only` against a minimal, `--no-save` dependency set
(`date-fns@2.30.0`, `date-fns-tz@1.3.8`, `rxjs@7.8.1`, `uuid@11.0.3`,
`lodash@4.17.21`).

Both sides are fed **byte-identical tape**: `ts_parity/export_static.py` writes
the bot's `StaticDataSource` JSON from the same Binance USD-M archive rows
`fetch_1m.py` pulled, and the H1 file is the same resample `common.resample_1h`
produces — never a separate H1 pull, which could disagree with the 1m frame at
a boundary and turn a data difference into a fake parity failure.

The TypeScript side necessarily runs with the daily 2-loss / 1-win caps **on**
(`RiskManager` is not parameterised), so the Python side is run with
`daily_caps=True` for this comparison only. ARCHITECT-NOTE §3.2's caps-removed
primary population is a strict superset of that stream.

Reproduce: `ts_parity/run_all.sh`.

### 1.2 Result

| window | trading days | symbol | TS orders | Python orders | discrepancies |
|---|---|---|---|---|---|
| 2024-11-01 .. 2024-12-20 (crosses the EDT→EST change, 2024-11-03) | 35 | BTCUSDT | 17 | 17 | **0** |
| 2024-11-01 .. 2024-12-20 | 35 | ETHUSDT | 17 | 17 | **0** |
| 2023-02-20 .. 2023-04-10 (crosses the EST→EDT change, 2023-03-12) | 35 | SOLUSDT | 23 | 23 | **0** |
| 2025-09-01 .. 2025-10-20 (inside the holdout) | 36 | BNBUSDT | 18 | 18 | **0** |

Fields compared, per order: **signal-bar timestamp, entry time, direction,
entry price, stop price as placed, target price** (the pre-registered
minimum), plus **exit bar time, exit price, stop price at exit and the number
of stop trails** (added because a parity proof that stops at the entry says
nothing about `tryToTrailStopLoss`, `Order.close()`'s clamping or the forced
flat). Float comparison at `rtol = 1e-6`; the two sides differ only in decimal
printing.

Raw evidence: `ts_parity/ts_events_*.jsonl` (the TypeScript's own event
stream), `results/parity_*.txt`, `results/parity_all.log`.

Both DST transitions are deliberately inside the battery. The 09:40–11:10
New York window moves by an hour in UTC across them, and `startOfDay` +
`zonedTimeToUtc` is the single place where a port most plausibly slips a day;
covering both directions is what makes the UTC-host pin (D-07) evidence rather
than an assertion.

### 1.3 A second, independent parity layer: the literal transcription

`engine.py` is fast — it hoists `TA.highest` / `TA.lowest` / the ATR window out
of the per-window loop, and collapses `ScriptVar`'s write semantics into two
branches. Both are *reasoning steps*, and a parity pass is not allowed to take
a reasoning step on trust.

`reference.py` therefore transcribes `indicatorScript` line by line — including
a faithful `ScriptVar` with the negative-index write that JavaScript silently
turns into a no-op (D-05) — and `checks.py` **C1** asserts the two agree,
insight for insight, over 80 randomly sampled real windows. **0 mismatches.**
That is what makes D-05 below a measured fact rather than a reading of the
code.

---

## 2. Gate 2 — prefix-causality

`checks.py` **C4**: 240 signals (60 per symbol, seeded sample) are re-derived
after truncating the tape **at the signal bar** — every bar after it deleted —
and re-running the whole pipeline from scratch on the prefix. Compared:
`bull_occ`, `bear_occ`, `above_nyam`, `in_disc`, `bias`, `has_ifvg`, `atr_ok`,
`range_high`, `range_low`, `signal`, `direction`, `stop`, `target`.

**240/240 identical. 0 lookahead on the M1 path.**

This is the check the architecture note specifically warned about
(`isYesterdayWithLastCandle`, the London scan and `chartData[last]` are all
window-end-relative). It passes because none of those window-end-relative
helpers is read by the signal — they feed the dead level machinery of
`knowledge/smart-money-ict.md` §5, which this port does not carry.

**But the H1 bias is a different matter, and it does not pass a causal test —
because the bot does not either.** See D-06 and §4; `checks.py` **C5**
measures it and writes `results/C5_h1_lookahead.txt`.

---

## 3. Disposition table — every divergence found

**Disposition is pre-registered by ARCHITECT-NOTE §4's bug-fidelity rule:** the
primary port reproduces the TypeScript's behaviour, bugs included; anything
"repaired" is a Stage-1 sensitivity row and never the primary. Nothing here was
silently fixed.

| # | where | what the code actually does | in the note? | disposition |
|---|---|---|---|---|
| **D-01** | `fvg-element.ts:165-175`, `fvg.indicator.ts:77-87` | `getLastIfvg` indexes one array by **the other array's** `length - 1`, i.e. `arr[-1]` → `undefined` in JS, whenever either iFVG list is empty. The ATR gate then divides by nothing (`Infinity < 8` → false) and blocks the trade, so the gate silently also enforces "**both** lists non-empty". Blocks **18.2 %** of in-window bars outright. | yes, §1.2 | **reproduced as-is**; repair is a Stage-1 sensitivity |
| **D-02** | same | `getLastIfvgDirection` returns **sell** when the bullish list is empty and **buy** when the bearish list is empty — *defaults, not observations*. Measured effect on the H1 frame: the bias is sell on **53.0 %** of in-window bars, so the lean is real but small (720 H1 bars rarely leave a list empty). | yes, §1.2 | **reproduced as-is** |
| **D-03** | `risk-manager.ts:100-109` | `getStopLossRatio` returns `rangeSize / stopSize`; a **small** ratio is a **wide** stop, and that is what triggers the ×0.5 / ×0.7 shrink — the opposite of what the name suggests. All three branches fire in the real stream (C7). | yes, §1.1 | **reproduced as-is** |
| **D-04** | `main-indicator.ts:459-461` | `aboveNYamTrueOpen` compares the **open** of the last bar (not its close) to the 07:30 NY level, and is **`false` when no level has been set**, so "not above" conflates *below* with *unknown* — and the buy branch keys off `!aboveNYamTrueOpen`. On this data the level is always set inside the 12h window, so the unset path is never exercised; the open-not-close comparison is live on every bar. | yes, §1.2 / knowledge §2 | **reproduced as-is** |
| **D-05** | `script-var.ts:23-30` | **NEW.** `set()` pushes on its first call in an iteration, then writes to `history[history.length - iteration - 1]` — which, after that push, is index **0**, not the current slot. So **every later `set()` in the same iteration is discarded** (and quietly corrupts the oldest history slot). Consequence for the signal: on a bar that confirms a 60-bar swing, `h_trail_up.set(max(high, h_trail_up))` is dropped and the range edge is left at exactly the swing level, the bar's own high/low never folded in. Confirmed by C1 against a faithful `ScriptVar`. | **no** | **reproduced as-is** |
| **D-06** | `smartmoney-strategy.ts:224-238` + `static-data-source.ts:44` | **NEW, and the material one.** `getHighTimeFrameBias` asks for H1 candles with `openTime <= endTime`, and `StaticDataSource` hands back the **complete** hourly candle. At an M1 timestamp of 13:47 the bot therefore reads the whole 13:00–14:00 hour — **up to 59 minutes of lookahead in its own backtest**. Live it would not: Binance returns the in-progress hour partially formed, so **the deployed bot and its backtest are not the same strategy**. See §4. | **no** | **reproduced as-is** (parity demands it); the causal-H1 variant is measured by C5 and must be a Stage-1 sensitivity |
| **D-07** | `smartmoney-strategy.ts:45`, `date-helpers.ts:100` | `startOfDay(new Date(ts))` is the **host machine's** local midnight, reinterpreted as New York; `getDay(ts)` is the host's local weekday. Correct on a UTC host, day-slipping elsewhere. | yes, knowledge §2 | **declared assumption: UTC host.** Both DST transitions are inside the parity battery (§1.2), which is what turns the pin into evidence |
| **D-08** | `smartmoney-strategy.ts:44-64` | `canOrdersBeAlive` is the *same* predicate as `isValidTimeForNewOrders`, so the entry window is also the exit: max hold 90 minutes, forced market flat at 11:10 NY. Not a bug — a design fact that dominates the exit mix (**1,062 of 2,830** primary trades, 37.5 %). | yes, §1.2 | **reproduced as-is** |
| **D-09** | `order.ts:91-105` | `Order.close()` **clamps** a gapped-through fill back to the exact stop or target price, so a violent adverse gap books as a tidy −1R. Optimistic on the loss side. | yes, §1.2 | **reproduced as-is** — it *is* fill convention "bot-native", primary number 1 of ARCHITECT-NOTE §3.2 |
| **D-10** | `strategy-template.ts:207-245` | Exits are checked on M1 **closes only** (`close < stopLoss`, `close > takeProfit`); intrabar wicks never trigger anything. | yes, §1.2 | **reproduced as-is**; the realistic intrabar convention is numbers 2/3 of §3.2 |
| **D-11** | `smartmoney-strategy.ts:207-222` | The gate computes `ATR(20) / ifvgSize` despite `MAX_IFVG_TO_ATR_RATIO`, so `< 8` **requires the gap to be wider than ATR/8** — it rejects *small* gaps. It removes 21.8 % of otherwise-eligible bars. | yes, §1.1 | **reproduced as-is**; inverting it is a Stage-1 sensitivity |
| **D-12** | `atr.indicator.ts` | `ATR()` is a plain arithmetic mean of true ranges, **not** Wilder's smoothing, and its `slice(i - length, i)` is off by one against the natural reading — it happens to land on exactly the last `length` candles. | no | **reproduced as-is**; asserted by C2 against the literal transcription |
| **D-13** | `tech-analysis.ts:6-20` | `TA.highest(length, ...)` walks `i-1` down to `i-length+1`, i.e. only **`length - 1` bars**, excluding the current one. `Swings(60)` therefore compares `high[i-60]` against the max of **59** bars, not 60. | no | **reproduced as-is** |
| **D-14** | `risk-manager.ts:48-59` | A break-even close counts as a **loss** for the daily cap (`!order.profitable` is true at exactly break-even). | no | **reproduced as-is** — affects only the capped secondary population |
| **D-15** | `backtest-runner.ts:55-62` | The runner's own `onOrderClosedByPrice$` handler calls `order.close()` a **second** time on an already-closed order, with `<=`/`>=` where the template used `<`/`>`. Idempotent in practice (same bar, same prices, same R:R). | no | **not ported** — it is runner-side reporting, and it changes nothing. Our harness does not subscribe |
| **D-16** | `main-indicator.ts:70-71, 446-447` | `trend` / `itrend` are declared and **never assigned**, so `bullishBos` / `bearishBos` are permanently `false`. There is no working BoS in this bot. | yes, §1.2 | **not ported** (ARCHITECT-NOTE §6) |
| **D-17** | `main-indicator.ts:105-124, 253-324` | PDH/PDL, PWH/PWL, PMH/PML and the London high/low are computed, never read by the signal, and scanned only over the supplied 12-hour window — so "yesterday's high" is at most a couple of hours of the prior day. | yes, §1.2 | **not ported** (ARCHITECT-NOTE §6) |
| **D-18** | `main-indicator.ts:200` | `trail_dn_x.set(trail_up.get() === high.get() ? ...)` — a copy-paste of the `trail_up_x` line. Dead: the `_x` values are render coordinates only. | no | **not ported** |

### Two more pins, neither of them a bug

| # | what | disposition |
|---|---|---|
| **D-19** | The bot's rolling M1 window is `[t − 12h, t]` **inclusive of both ends** = 721 bars, so the `i > 200` warm-up leaves 520 bars of range trailing. `knowledge/smart-money-ict.md` §3's "≥ 201 bars is a hard warm-up requirement" is satisfied with room. | pinned |
| **D-20** | Our archive starts 2022-08-01, so signals in the first ~30 days of the pinned period see **fewer than 720 H1 bars** of bias history. 524 of 5,795 signals (9.0 %) fall in 2022; the H1 FVG machine still runs, on a shorter history. Declared, not fixed — trimming the period would contradict ARCHITECT-NOTE §3.2's fixed split. | declared |

---

## 4. The one finding that bears on Stage 1's thresholds — D-06

ARCHITECT-NOTE §7 asks to be told if anything in the TypeScript materially
changes §1.2's understanding of the mechanic. This does.

**What it is.** The H1 bias is re-read on every M1 bar from candles filtered by
`openTime <= endTime`. In a *live* run Binance returns the in-progress hour
partially formed, so the bias at 13:47 knows the tape up to 13:47. In a
*backtest against a static file* — which is every number the bot has ever
produced, and the harness this parity check uses — the same filter returns the
**finished** 13:00–14:00 candle. The bias at 13:47 therefore knows where the
hour will close.

**Size of it.** Inside the 09:40–11:10 NY window the leak is 0–59 minutes of
the current hour, on every single evaluation — and it is not a rounding error:
**18.8 % of signals do not exist without it.** `checks.py` C5 re-derives the same
240 sampled signals with a fully causal H1 frame (last hour partial, resampled
from the truncated 1m). **195 of 240 survive; 45 — 18.8 % — do not**: the bias
flips and the signal disappears. Detail in `results/C5_h1_lookahead.txt`.

That is the size of it: close to one signal in five exists only because the bot
was allowed to see the rest of the hour.

**Why it matters before Stage 1, not after.** Three consequences:

1. **The bot's own historical results are inflated by it**, on top of the four
   reasons §6 of the note already lists. This is a fifth, and it is the only
   one that is a genuine lookahead rather than an optimistic convention.
2. **Bar-for-bar parity requires reproducing it.** A port that fixed it would
   not match, and gate 1 would have failed for the right reason. So the primary
   port carries it, as the bug-fidelity rule requires.
3. **A Stage-1 "REAL EDGE" verdict computed on the lookahead stream would not
   be a deployable edge**, because the deployed bot cannot see the hour's
   close. If Stage 1 runs, the causal-H1 variant should be promoted from a
   sensitivity to a **co-primary**, or the verdict ladder should be applied to
   the causal stream — that is an Architect decision, made with this fact in
   hand, and this pass does not make it.

Nothing else found here changes the note's understanding. D-05 is real but
small and local to swing-confirmation bars; D-12/D-13/D-14/D-18 are
bookkeeping; every other row was already in §1.1/§1.2.

---

## 5. What reproducing the strategy cost, in numbers

| | |
|---|---|
| in-window M1 bars evaluated | 380,380 (4 symbols × 95,095) |
| full `indicatorScript` evaluations | 380,380, each over a 721-bar window recomputed from scratch |
| H1 bias evaluations | 380,380, cached on the (first, last) H1 index — inside one 91-minute session the window changes at most twice |
| wall clock | ~6 s per symbol (numba), ~25 s for the whole four-year, four-symbol run |
| 1m bars pulled | 2,103,840 per symbol, 8,415,360 total, no gaps |

The ~2.1 M bars/symbol that ARCHITECT-NOTE §5.3 flagged as a feasibility risk
are not one. The 1m pull took minutes and the full scan seconds.
