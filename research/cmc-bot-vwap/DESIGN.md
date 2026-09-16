# DESIGN — pre-registration for Stage 1, `cmc-bot` VWAP band-reversal

**Date:** 2026-09-16 · **Status:** committed **before any R, on any arm or
leg, was computed.** This file is the mechanical restatement of
`ARCHITECT-NOTE-STAGE1.md` (the binding Stage 1 gate ruling, 2026-09-16),
which supplements `ARCHITECT-NOTE.md` (2026-09-12 routing ruling) wherever the
latter is silent. Where this file and the Architect note disagree, **the
Architect note wins**; this file may add mechanical detail and **may not
loosen anything**.

Nothing below was written with sight of a performance number. Stage 0
(`PARITY.md`, `results/INVENTORY.md`, `results/crypto/*`) deliberately
produced none, and none has been computed in this pass at the time of this
commit. The holdout is computed **once**, at the end, after this file is
committed, and reported as it comes out.

---

## 1. The tape (Architect note §1, D-01)

**Primary and only tape: bars keyed by `snapshotTimeUTC`.**

- Capital.com legs (US100, US500, EURCHF, GBPCHF): 1-minute bars pulled
  through the bot's own `CapitalComSession` with the request
  `CapitalComClient.realRequest` sends (`ts_harness/pull_1m.ts`), converted by
  `prep_data.py`. OHLC are the bot's own mids, `(ask + bid) / 2` per field
  (`capital-com.helpers.ts:mapMarketDataToChartData`); `volume` is
  `lastTradedVolume` (broker tick activity, **not** exchange volume);
  `spread_close` = `ask − bid` at the bar close, kept per bar for §4's cost
  model. Span **2024-01-01 .. 2026-09-11**; the API serves no 1-minute bar
  before 2024-01-01 (bisected, `results/capital_com_floor_probe.txt`).
- Binance legs (BTCUSDT, ETHUSDT): USD-M perpetual 1-minute klines from the
  public `data.binance.vision` archives, span **2022-08-01 .. 2026-09-11**,
  no missing minutes. `volume` is real exchange base-asset volume.

**The bot's own mislabelled backtest hours are not run, not reported, and are
not a sensitivity.** The `snapshotTime` field the bot's offline path parses is
broker-local wall clock (UTC+2/+3) read as UTC; it selects bars 2–3 h earlier
than the labels claim (indices ≈ 06:xx–09:xx NY, forex ≈ 00:xx–01:xx NY) and
shares 0–3 orders in ~900 with the live stream. Measuring it would only invite
a comparison that must not be made.

**Statement owed to the user, to appear in `REPORT.md`'s first section:** any
past backtest or grid search of this strategy run on Capital.com scraped files
(`npm run scrap` → `BacktestRunner`) measured hours 2–3 h earlier than its
labels said, and is **not evidence about the live windows**. The 09:40–11:40
NY and 03:02/03:03–03:20 NY windows have never been measured by anyone before
this pass.

**The index windows are this registration's pinned parameters** (entry
09:40–11:40 NY, alive 09:40–14:30 NY), user-specified and provisional. No
alternative window is run in this pass, gating or otherwise. A different
window is a **new registration** with its own single shot and its own
Bonferroni accounting.

## 2. The bar convention (Architect note §2, L-01)

- **Primary: the backtest bar.** At gate minute T the engine evaluates the bar
  that **opened at T** — `engine.run(..., live_like=False)`. This is the
  object Stage 0 proved bit-exact against the bot's unmodified TypeScript over
  200,322 evaluated bars / 2,322 orders on Capital.com and 4,591,936 bars /
  8,158 orders on Binance, with 0 discrepancies.
- **Mandatory secondary row: `live_like=True`** — at gate minute T the newest
  readable bar is the one that opened at T−1 (the live request's `max: 720`
  truncation plus the not-yet-served forming minute). Same template, same
  costs, same nulls, reported beside the primary for **every arm and every
  descriptive leg**.
- **Gating consequence (§6's tightening):** a REAL EDGE verdict on the primary
  additionally requires the `live_like=True` row to have **holdout mean net R
  ≥ +0.05R with the same sign**. The primary decides the tier; the live-like
  row can only **veto** a build, never create one. If the two rows straddle a
  verdict tier, `REPORT.md` says so in its first paragraph.

**Unmodelled live-path divergences** (listed, not simulated):

- **L-02** — the live US500 bias VWAP double-counts a chunk-boundary bar
  whenever the 12 h tape has a missing minute (59 % of US500 evaluations).
- **L-03** — the live `/prices` request fails outright if the host clock leads
  Capital.com's by more than the firing latency (reproduced).
- The forming candle the live bias request can include is not reproducible
  from history.

## 3. The eight legs and their status (Architect note §6.1)

| leg | tape | entry / alive window | fit | holdout | status |
|---|---|---|---|---|---|
| **US100** | Capital.com 1m | 09:40–11:40 / 09:40–14:30 NY, Mon–Fri | 2024-01-01..2025-07-31 | 2025-08-01..2026-07-31 | **PRE-REGISTERED** |
| **US500** | Capital.com 1m | same | same | same | **PRE-REGISTERED** |
| **BTCUSDT-(a)** | Binance USD-M perp 1m | same, Mon–Fri | 2022-08-01..2025-07-31 | same | **PRE-REGISTERED** |
| **ETHUSDT-(a)** | Binance USD-M perp 1m | same, Mon–Fri | 2022-08-01..2025-07-31 | same | **PRE-REGISTERED** |
| EURCHF | Capital.com 1m | 03:02–03:20 / 03:00–04:00 NY | 2024-01-01..2025-07-31 | same | descriptive only |
| GBPCHF | Capital.com 1m | 03:03–03:20 / 03:00–05:00 NY | 2024-01-01..2025-07-31 | same | descriptive only |
| BTCUSDT-(b) | Binance USD-M perp 1m | none — every minute, 24/7, never force-closed | 2022-08-01..2025-07-31 | same | descriptive only |
| ETHUSDT-(b) | Binance USD-M perp 1m | none — 24/7 | 2022-08-01..2025-07-31 | same | descriptive only |

**The pre-registered family is exactly four arms.** α = 0.05/4 = **0.0125**
per arm. **No pooling, no picking, four separate verdicts.**

**"Descriptive only" means, precisely:** same engine, same tape, same split
dates, same templates, same cost model, same Null A / Null B / bootstrap
machinery, same tables — run and reported in full, under a `REPORT.md`
heading reading **"Descriptive — no verdict — not pre-registered"**. **No
verdict word (kill / inconclusive / real edge / underpowered) may appear next
to a descriptive number.** No pooled row mixing a descriptive leg with an arm.
These rows cannot be promoted to a verdict by re-reading them; a forex verdict
needs a fresh registration and ≈ 44 months of Capital.com minute history
(not before ~2027-09 on this vendor).

**Why forex is descriptive-only:** ≈ 89–90 caps-off orders/year each, so
`n_holdout ≥ 150` would need ≥ 20 of the 32.3 available months as holdout;
median initial stop is 2.7 bp (EURCHF) / 3.6 bp (GBPCHF), so a 1–2 bp spread
is a large fraction of the stop; and the windows are hard-coded in the bot
(17–18 minutes), so the population cannot be widened without changing the
strategy.

**Why crypto (b) is descriptive-only:** its "window" is an artefact of the
daily caps (93–94 % of as-deployed orders fall in 00:00–06:00 UTC), the
UTC-midnight VWAP anchor is the Binance daily-candle boundary and nothing
more, the band is zero-width at the reset, the 00:00 bar throws `VWAP([])`
daily (1,503 bars/symbol), the caps-off population is ≈ 3,800–4,150
orders/year dominated by re-entries, and the median stop (17.7 / 25.2 bp) is
under twice the standard round-trip cost. **(b) is run caps-off.** The caps-on
(b) population is reported once, as a count and a clock histogram, to document
the artefact — nothing else is computed on it.

### 3.1 Population per leg (Architect note §3.3)

- **Primary population: caps off** — every order the engine places with the
  daily 2-loss / 1-win caps removed (`daily_caps=False`), the ≤ 1-open-order-
  per-direction rule **kept**. That rule swallows ≈ 38 % of index
  `processCharts` signals; the caps-off population is therefore still
  path-dependent through it, and the swallowed count is reported.
- **Mandatory secondary row: the as-deployed caps-on population**
  (`daily_caps=True`).
- **Tail row:** 2026-08-01 .. 2026-09-11 (≈ 6 weeks), reported per arm and per
  leg as a separate **non-gating** "post-holdout tail". It never enters any
  verdict.

### 3.2 Split mechanics

Split **by the signal bar's UTC date** (`signal_ts`), not by the exit date.
Computed **once**, at the end, after this file is committed. **Never re-cut.**
A trade opened in the fit period and closed in the holdout period is a fit
trade; every trade is forced flat inside its own alive window on the same UTC
day, so no trade spans the boundary in any windowed leg. For the (b) legs,
which are never force-closed, the same rule applies by `signal_ts`.

The holdout year **2025-08-01 .. 2026-07-31** is this project's standard
holdout (v5-NY, smart-money ruling §3.2), so every pre-registered line in this
project is judged on the same twelve months of market.

**Projected holdout n (caps off, from `results/INVENTORY.md` / `results/crypto/INVENTORY_CRYPTO.md`
per-year counts):** US100 ≈ 420, US500 ≈ 480, BTCUSDT-(a) ≈ 408, ETHUSDT-(a)
≈ 335. If the **realised** `n_holdout` on any pre-registered arm is < 150,
that arm is **UNDERPOWERED**, takes no directional claim, and returns to the
Architect; the other arms proceed (§7, §8).

## 4. The four numbers per arm (Architect note §6.2) and the cost model (§6.3)

### 4.1 The two trade templates

**Template A — "bot-native" (the bot's own risk management).** Entry at the
signal bar's close, timestamped signal-bar-open + one interval (as
`Order` does). Stop from `RiskManager.adjustStopLoss`: anchor = the 200-bar
range low (BUY) / high (SELL) **excluding the current bar** (D-06), shrunk
by the ratio table (`range/size < 2.5` → ×0.5; `[2.5, 3)` → ×0.7; else ×1.0).
**Target = 3.0R** (`TARGET_RR`). Trail exactly as `verifyExistingOrders`:
evaluated on **M1 closes**, at `R > 1` move the stop to break-even, at
`R > 2` move it to entry ± 1 × initial risk, monotone only. Forced flat at
the arm's alive-window end (the first minute after it), at that bar's close.
The both-directions-open rule (if a BUY and a SELL are open simultaneously,
close the **earlier-entered** one at the close, cause `STRATEGY`) is kept.

**Template B — "project-standard" (v5-NY §6.3.3).** Entry at the signal bar's
close, **the same stop anchor** (the same shrunk `adjustStopLoss` stop),
**target = +1R**, **no trail**, forced flat at the alive-window end at that
bar's close. For the (b) legs, which have no alive window, the trade runs to
target/stop or the end of the tape, matching the engine's own 24/7 behaviour.

### 4.2 The two fill conventions

**Fill convention 1 — "bot-native".** Exits are detected on **M1 closes only**
and with strict inequalities, exactly as `checkAndCloseOrders`: a BUY closes
when `close < stop` (STOP_LOSS) or `close > target` (TAKE_PROFIT). The booked
fill price is then **clamped to the exact stop/target** (`Order.close`, D-10),
so a bar that gaps far through the stop still books exactly the stop price.
This is optimistic, and deliberately so: it is what the bot does.

**Fill convention 2 — "realistic".** Exits are detected **intrabar** on the
bar's high/low against the stop and target in force at the start of that bar.
- If a bar touches **both** levels, the **stop is booked** (pessimistic tie
  rule, as in v5-NY).
- **Target:** filled **at the target level**, always.
- **Stop:** filled at the **stop level** normally; if the bar **gapped**
  through it — i.e. the bar's open is already beyond the stop — filled at the
  **breaching bar's actual open price**.
- Forced flat at the alive-window end is still booked at that bar's close.
- The trail still updates on **M1 closes** (it is part of the trade template,
  not the fill convention).

### 4.3 The four numbers

| # | template | fill | role |
|---|---|---|---|
| **1** | A (bot-native) | 1 (bot-native) | **THE PRIMARY. This number, and only this number, gates.** |
| 2 | A (bot-native) | 2 (realistic) | reported, no verdict |
| 3 | B (project-standard) | 2 (realistic) | reported, no verdict |
| 4 | B (project-standard) | 1 (bot-native) | reported, no verdict |

All four are reported for every arm and every descriptive leg, on fit and on
holdout, caps-off primary and caps-on secondary, `live_like=False` primary and
`live_like=True` secondary. Numbers 2–4 exist so the result cannot be
dismissed as an artefact of either choice; **they carry no verdict**.

**Order population is fixed by the parity-proven run** (`engine.run`,
`live_like` as stated, `daily_caps` as stated) and the four numbers re-account
the **same set of orders** under the four template × fill combinations. This
is a deliberate modelling choice: re-running the bot loop under a different
fill convention would change which orders exist (through the
≤ 1-open-per-direction rule and, with caps on, through the caps), and that
would make templates 1 and 2 incomparable. **`REPORT.md` states this
limitation explicitly**, together with the count of orders whose exit *timing*
differs between conventions (an upper bound on the population that would have
shifted).

**R definition.** `stop_dist = |entry − stop_at_placement|` (the initial,
shrunk stop — never the trailed stop). `gross R = dir × (exit_price − entry) /
stop_dist`, `dir = +1` for BUY, `−1` for SELL. `net R = gross R − cost_R`.

### 4.4 Costs — with the price side stated

**Capital.com arms and legs.** The tape's OHLC are **bid/ask mids**. A BUY
enters at the **ask** = mid + spread/2 and exits at the **bid** = mid −
spread/2; a SELL enters at the **bid** and exits at the **ask**. Either way
the round trip pays half a spread against you on entry and half on exit:

```
cost_price = spread_close[entry bar] / 2  +  spread_close[exit bar] / 2
cost_R     = cost_price / stop_dist
```

**one full spread per round trip, taken from the tape, bar by bar.** No
commission (Capital.com CFDs are spread-only). **No financing**: every
position is forced flat inside its alive window on the same UTC day — this
file asserts it and the checks verify that no position crosses a session
boundary. **Slippage is not modelled.**

Non-gating sensitivities, both reported: **(i)** a fixed spread equal to the
in-window median `spread_close` for that instrument over the **fit** period;
**(ii)** 2× the per-bar spread.

**Binance arms and legs.** 0.10 % round trip (2 × 5 bp USD-M taker),
identical to v5-NY for comparability:

```
cost_R = 0.001 * entry / stop_dist
```

Non-gating sensitivity: **0.04 % round trip** (maker-side fills). Reported,
never used for a verdict.

**`REPORT.md` shows the `cost_R` distribution per arm and the gross-vs-net gap
explicitly, and contains the sentence "slippage is not modelled, so every
number is optimistic."**

## 5. Nulls, interval, secondaries (Architect note §6.4)

Random seed **20260901** (this project's standard), one `default_rng` stream,
draws saved to CSV so a chart and the report quote the same number.

- **Null A — matched-time placebo. PRIMARY. 1,000 draws.** Each real trade is
  replaced by one entered at a bar drawn uniformly from the **same entry
  window on a different random weekday** (for the (b) legs: any bar of a
  different random day), **same symbol, same side, same stop distance in ATR
  units** (`stop_dist / ATR(20)` at the real entry, applied to the placebo
  bar's own ATR(20)), **same template, same 3.0R target, same trail, same
  forced-flat rule, same cost model**. Date collisions are redrawn once; the
  residual rate is reported, not looped over. One-sided
  **`p = share of draws whose mean net R ≥ the observed mean net R`**, on the
  **holdout**.
- **Null B — whole-stream day shift. SECONDARY. 250 draws**, `k ~ U{1..250}`
  without replacement: every signal bar is shifted forward by `k` whole UTC
  days and the identical template is re-run at the same clock time on the
  shifted day. Shifted entries that land on a missing minute are dropped and
  the drop rate reported.
- **Interval.** Day-block bootstrap over **whole UTC days with replacement**,
  **2,000 draws**, **90 % interval** on the **holdout mean net R**. A day is
  the block because intraday trades on one day share one tape.

**Secondary, non-gating, always reported:**

- **Exit-cause breakdown**: target / stop / trailed stop / time-exit (forced
  flat) / both-directions `STRATEGY` close.
- **Component ablation, on the FIT PERIOD ONLY** — drop each of (i) the VWAP
  band bias + band-width regime gate, (ii) the iFVG trigger, (iii) the
  premium/discount gate, (iv) the prior-hour sweep, one at a time, and report
  the resulting n and mean net R.
- **Non-circular forward lift**, built as `session-liquidity-v5-ny/tables.py:block_L`:
  each signal's post-entry MFE in ATR units over its own horizon, divided by
  the median unconditional forward MFE for the same window × direction ×
  horizon-length cell. **1.00 = no better than a random comparable stretch of
  tape.** Pre-registered interpretation for the crypto arms (Architect note
  §4.2): **if this mechanic's signals land at ≈ 1.00 lift in the NY window,
  `REPORT.md` says "the window, not the mechanic" in as many words.**

**Bug fidelity.** The primary reproduces the bot's behaviour exactly as Stage 0
proved it — **no "improvements" in the primary**. Specifically kept:

- **D-03** — `getLastIfvg` is asymmetric: `lastIFVG` is undefined only when
  the **bullish** iFVG list is empty; an empty **bearish** list still returns a
  valid element. (1 order in 2,322 depends on it — no sensitivity row.)
- **D-05** — the bias compares the bar's **open** to the band, not its close.
- **D-06** — the 200-bar range **excludes** the current bar.
- **D-07** — VWAP from 00:01 UTC, **population** standard deviation, broker
  tick volume on the Capital.com legs.
- **D-10** — the bot-native fill clamps to the exact stop/target.
- **D-11** — close-only exits with strict inequalities.
- **D-18** — `VWAP([])` throws on forex holidays → no signal that bar, as
  live.

## 6. Pre-registered interpretation constraints (Architect note §4.2)

- The crypto arms contest the **same standing nulls** as the index arms — the
  proximal-edge iFVG (`smc.md` §3 encoding #4, siblings closed) and the
  prior-hour-sweep shape (`session-liquidity.md` family, Запись 18 killed) —
  **no more**. A miss on a crypto arm is a **kill of this mechanic on that
  symbol**, not a rework request.
- **A kill on BTC/ETH-(a) does not touch Запись 18, and Запись 18 does not
  touch this. A pass on BTC/ETH-(a) does not reopen v5-NY.** The forward-lift
  row is the one place the two may speak to each other, and only as
  attribution.
- **No result on a crypto arm is evidence about an index arm, or vice versa.**
  Different tape, different volume quantity inside the VWAP, different cost
  model. Four verdicts, never a pooled one.
- **A REAL EDGE on a crypto arm routes to a *build decision*, not to
  "validate the deployed bot"** — the bot never ran `VWapStrategy` on crypto.

## 7. The verdict ladder (Architect note §5, including the §2 tightening)

Applied **mechanically** to **number 1 only** (template A, fill 1, caps off,
`live_like=False`), on the **holdout**, **per arm**, with α = 0.05/4 = 0.0125.

| condition | verdict |
|---|---|
| `n_holdout < 150` | **UNDERPOWERED — INCONCLUSIVE.** No directional claim. Return to Architect. |
| holdout mean net R `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — KILL.** |
| `≥ +0.05R` and `0.0125 < p ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| **all** of: holdout mean net R `≥ +0.10R`; Null-A `p ≤ 0.0125`; fit period same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150`; 90 % day-block bootstrap interval **excludes 0**; **gross** expectancy `> 0`; **and** the `live_like=True` row has holdout mean net R `≥ +0.05R` with the same sign | **REAL EDGE — build for real.** Routes to Architect for a build ruling. |

The last row's final clause is the **§2 tightening**. It is a **veto only**:
it can block a build, never create one. If the primary and the live-like row
straddle a verdict tier, `REPORT.md` says so in its first paragraph.

**Nothing in this ladder is adjusted, and nothing may be adjusted after a
number is seen.** Not the +0.05R kill bar, not the +0.10R build bar, not
α = 0.0125, not `n ≥ 150`, not the windows, not the splits. If the
pre-registration turns out to be ambiguous or wrong in a way that matters, the
Researcher **stops and escalates** rather than deciding unilaterally.

## 8. Order of work and stop rules (Architect note §6.5)

1. **This file, committed before any R is computed on any arm or leg.**
2. Build the realistic-fill template as a sibling of the parity-proven
   `engine.py`. **`engine.py` is not edited**, so Stage 0's bit-exact parity
   stands untouched; the sibling module's self-test proves it reproduces
   `engine.run`'s order table and `engine`-native exits exactly before any
   number is taken from it. If `engine.py` is edited at any point, the full
   parity suite is re-run and **any discrepancy stops the pass**.
3. Fit-period numbers for **all eight legs first**, then the holdout **once**.
4. `REPORT.md`; then `HANDOFF.md` and a `RESEARCH-LOG.md` entry **regardless
   of outcome — a kill is a result.**

**Stop and return to the Architect immediately if:**

- realised `n_holdout < 150` on any pre-registered arm — **that arm** is
  UNDERPOWERED and returns; the others proceed;
- the realistic-fill template cannot be made to agree with the bot-native one
  on trades that neither gap nor touch both levels. **Operationally:** on
  every order whose bot-native exit cause is `STOP_LOSS` or `TAKE_PROFIT`,
  where the realistic intrabar walk reaches the *same* level *first* on the
  *same* bar, no bar in the trade touches both levels, and the exit bar does
  not gap through the stop — the two conventions must give a **bit-identical**
  net R. Any mismatch stops the pass;
- any parity re-run after an engine change shows a discrepancy versus Stage
  0's bit-exact result.

## 9. Out of scope (Architect note §7)

- **Software Engineer / Backtesting are not engaged** — only on a REAL EDGE
  verdict, per arm, after a further Architect ruling.
- **The smart-money package's D-03 exposure** is flagged, not actioned.
- **A 2022 extension of the Capital.com instruments** — confirmed impossible
  on this vendor; not attempted.
- **Any alternative index window** — a new registration; not run.
