# Architecture note — the `cmc-bot` smart-money ICT strategy

**Author:** Architect · **Date:** 2026-09-12 · **Status:** routing decision,
pre-registration of thresholds. No result exists yet.

Inputs read for this note: `PROJECT.md`, `agents/roles/architect.md`,
`IDEAS-BACKLOG.md` (the "Smart-money ICT strategy from `cmc-bot`" entry),
`knowledge/session-liquidity.md`, `knowledge/smc.md`, `RESEARCH-LOG.md`
Записи 17 и 18, `research/session-liquidity-v5-ny/{DESIGN,REPORT}.md`, and the
`cmc-bot-main/` source itself — `src/strategy/{smartmoney-strategy,
strategy-template,risk-manager,order}.ts`, `src/indicator/main-indicator.ts`,
`src/indicator/tools/{fvg-element,fvg.indicator,date-helpers}.ts`,
`src/indicator/functions/{swings,y-in-discount}.ts`,
`src/backtesting/{backtest-runner,backtest-helpers,static-data-source}.ts`,
`docs/backtesting.md`.

---

## 1. What this idea actually is

The mechanic is pinned in full, from the code, in
**`knowledge/smart-money-ict.md`** (new, written with this note). The short
version:

> Continuation in the direction of an **H1 iFVG bias** (720h lookback),
> triggered by an **M1 iFVG**, permitted only while price sits on the
> bias-consistent side of both the **NY-AM true open (07:30 New York)** and
> the **midpoint of a swing-anchored running range**, inside a **09:40–11:10
> America/New_York wall-clock** window, Mon–Fri, with a stop anchored to that
> range's far extreme, a fixed **2.7R** target, a breakeven/+1R trail, a
> **forced flat at 11:10 NY**, and daily caps of 2 losses / 1 win.

### 1.1 Corrections to the backlog entry (verified against the code)

The backlog summary was written from a first read and is wrong in four
places. These matter, so they are corrected here and in the knowledge file:

1. **The ATR gate rejects *small* gaps, not large ones.** `isIFVGtoATRRatioAllowed`
   computes `ATR(20) / ifvgSize` despite the constant being named
   `MAX_IFVG_TO_ATR_RATIO`; `< 8` therefore requires the gap to be **wider
   than ATR/8**. Not an "abnormally large/illiquid gap" filter.
2. **The stop shrink fires when the stop is *large* relative to the range,
   not small.** `getStopLossRatio` returns `rangeSize / stopSize`; a *small*
   ratio means a *wide* stop, and that is what triggers the ×0.5 / ×0.7
   shrink.
3. **This bot's iFVG is not this project's iFVG.** Inversion here is a close
   through the gap's **proximal** edge, with the bar required to have opened
   on the far side of it. `knowledge/session-liquidity.md` §5.1 defines
   inversion as a close through the **far** edge. Different event, different
   frequency. The shared word is a trap.
4. **`priceInDiscount` is not "a 60-bar swing range".** The 60-bar swing only
   *seeds* the range; the operative bounds are running extremes that trail
   from that seed over the whole 12-hour M1 window, and they do not update at
   all until bar index > 200 of that window.

### 1.2 Facts the backlog did not have, that change the design

- **The session window is also the exit.** `canOrdersBeAlive` is the *same*
  predicate as `isValidTimeForNewOrders`, and outside it `processStep`
  force-closes every open order at market. Maximum hold is **90 minutes**, and
  a **time-exit at 11:10 NY is a first-class outcome** that will plausibly
  dominate the exit mix. Any validation that models only stop/target
  misrepresents the strategy.
- **The bot has no working BoS.** `trend` and `itrend` are declared in
  `main-indicator.ts` and never assigned, so `bullishBos`/`bearishBos` are
  permanently `false`.
- **The level machinery is unused and structurally broken.** PDH/PDL,
  PWH/PWL, PMH/PML and the London high/low are computed, never read by the
  signal, and — because they are scanned only over the supplied 12-hour
  window — measure at most a couple of hours of the prior day. This bot
  contains **no sweep-detection step of any kind**.
- **Two latent behaviours that gate trading and must be reproduced, not
  fixed.** `getLastIfvg()` indexes one iFVG array by the other's length and
  returns `undefined` whenever either list is empty, which makes the ATR gate
  `Infinity < 8` → **false** → no trade. And `getLastIfvgDirection()` returns
  `sell` as the *default* when the bullish list is empty. Together: the
  strategy can only fire when **both** iFVG lists are non-empty, and its bias
  is structurally sell-leaning in quiet tape.
- **The bot's own backtester is not admissible evidence.** It models **no
  costs, no spread, no slippage**; it fills entries at the signal bar's close;
  it checks exits on M1 **closes only**; and `Order.close()` then **clamps a
  gapped-through stop back to the exact stop price**, so a violent adverse gap
  is booked as a tidy −1R. The loss side of its R distribution is optimistic
  by construction.
- **Parameter provenance is unknown.** The 09:40–11:10 window, the
  `MAX_IFVG_TO_ATR_RATIO = 8`, the 2.7R target, the {0.5, 0.7} shrink table
  and the 2-loss/1-win caps are hardcoded constants chosen by a human on a
  sample this project cannot inspect. The repo also ships a grid-search
  harness (`BacktestRunner.generateHyperParameters`, `reports/grid-search-*.csv`)
  whose axes are *exactly* window timings and `MAX_IFVG_TO_ATR_RATIO` — it is
  currently wired only to the vwap strategy, but its existence establishes
  that searching over these knobs is part of this codebase's history.

---

## 2. Decision 1 — knowledge base

**Ruling: a new file, `knowledge/smart-money-ict.md`, plus two one-line
cross-references. Not an extension of `knowledge/session-liquidity.md`.**

Why not session-liquidity: that file's entire subject is *a level being taken
out and price reversing*. This strategy never requires a level to be taken
out. Filing it there would (a) imply an evidential connection to a shelved
family that does not exist, and (b) put two mutually incompatible definitions
of "iFVG" (§1.2 vs §5.1) in the same document. Both are worse than a second
file.

Why not a section of `knowledge/smc.md` either: the mechanic introduces three
primitives this project had never pinned — the ICT **true-open** family
(NY-AM = 07:30 New York, day, week, month), the **premium/discount midpoint
over a swing-anchored running range**, and the **proximal-edge iFVG**. Those
are concept-area material, not a table row.

Cross-references written alongside:

- `knowledge/smc.md` §3 gains this as **encoding #4** of the "HTF bias → LTF
  entry trigger" register, status *untested*. That is the family this idea
  genuinely belongs to, and encodings #1–#3 are all closed as
  indistinguishable from noise. The verdict lineage lives there; the mechanic
  lives in the new file.
- `knowledge/session-liquidity.md` §0 gains one line stating that this idea is
  **not** that family and that the **C3 reopen trigger is untouched** — in
  either direction. Nothing in this pass can burn C3, and nothing in C3
  bears on this pass.

---

## 3. Decision 2 — reopening standard and the numbers, fixed now

### 3.1 Ruling: **pre-registered, hypothesis-tested. One shot.**

This is *not* because it reopens session-liquidity — it does not. It is
because both of §8's own criteria in `knowledge/session-liquidity.md` are met
independently:

> *"exploring the shape of the idea is descriptive; arguing with a null, or
> acting on a cut somebody chose by eye, is not."*

- **A cut chosen by eye.** Every threshold in §1.2's last bullet was picked by
  a human on unpublished data. A descriptive pass over hand-tuned constants
  measures the tuning, not the tape.
- **Arguing with a null.** `knowledge/smc.md` §3 closes three encodings of
  exactly this shape — HTF bias engine feeding an LTF FVG/OB entry trigger —
  including `research/intraday-mtf-smc/` (1h bias → 5m FVG retest), which
  failed all three pre-registered rule sets at stage 1. This composition has
  not been tested, but the family verdict is standing and negative, and this
  idea arrives to contest it.

A descriptive pass would produce a seventh "shape" and no decision. The
machinery for the right pass already exists and is audited:
`research/session-liquidity-v5-ny/hypothesis.py` (split, Null A, Null B,
day-block bootstrap, verdict ladder applied mechanically) forks cleanly.

**I explicitly considered, and rejected, killing this before Researcher
touches it.** The honest case for a pre-emptive kill is that it is the
SMC-family null in a new coat, entered in a window where a different mechanic
was just measured at *par*. The case against, which wins: the composition is
genuinely untested here, the user owns and wrote this code and asked directly,
and one pre-registered pass on existing machinery buys a decisive answer
cheaply. But it is **one shot** — the thresholds below are fixed now, by
someone who has seen no result, and a miss is a kill, not a rework request.

### 3.2 Pre-registered numbers

These are binding. `DESIGN.md` restates them; it may add mechanical detail and
may not loosen anything here.

**Population (primary).** Every M1 bar in 09:40–11:10 America/New_York,
Mon–Fri, on which all of §4.2's entry conditions fire, **with the daily
2-loss/1-win caps removed**, on the four assets of §5, over
**2022-08-01 .. 2026-07-31**.

- *Why remove the caps:* they discard signals for reasons unrelated to signal
  quality, they make the trade stream path-dependent (which makes a placebo
  null ill-defined), and they cost a large fraction of the sample. If the raw
  signal has no edge, a cap cannot create one; if it has, the caps can be
  re-applied afterwards. **The as-deployed capped population is a mandatory
  secondary row**, reported beside the primary, never instead of it.
- *What is kept:* the ≤1-open-order-per-direction concurrency rule and the
  both-directions-open resolution. Those define what a "trade" *is*; the daily
  caps are a risk overlay on top.

**Split.** Identical to v5-NY so the two results are directly comparable:
fit **2022-08-01 .. 2025-07-31** (36 mo), holdout **2025-08-01 .. 2026-07-31**
(12 mo), by the signal bar's UTC date. **Holdout is computed once, at the
end.** No parameter changes after looking at it. The split is never re-cut.

**Primary metric.** Mean **net R per trade** on the **holdout**, pooled across
the four assets, under the bot's own trade template, costs applied.

**Costs.** **0.10 % round trip** (2 × 5 bp Binance USD-M taker), identical to
v5-NY for comparability: `cost_R = 0.001 × entry / stop_dist`,
`netR = grossR − cost_R`. **Slippage is not modelled** — so every reported
number is optimistic, not conservative, and that sentence must appear in the
REPORT. This matters more here than it did in v5-NY, because the 11:10-NY
time-exit is a market exit at a fixed clock instant.

**The four primary numbers** (2 trade templates × 2 fill conventions):

| # | Trade template | Fill convention |
|---|---|---|
| 1 | **Bot-native**: entry at signal-bar close, stop per `adjustStopLoss`, target 2.7R, BE-at-1R / +1R-at-2R trail, forced flat 11:10 NY | **Bot-native**: exits checked on M1 closes only, recorded fill clamped to the exact stop/target |
| 2 | Bot-native | **Realistic**: intrabar touch, stop checked first on a bar touching both, fill at the level for target and at the **breaching bar's actual price** for a gapped stop (no clamping) |
| 3 | **Project-standard** (v5-NY §6.3.3): entry at signal close, same stop anchor, target **+1R**, no trail, forced flat 11:10 NY | Realistic |
| 4 | Project-standard | Bot-native |

Number **1** is the pre-registered primary; the other three exist so the
result cannot be dismissed as an artifact of either choice. Multiple-comparison
correction: **Bonferroni, α = 0.05 / 4 = 0.0125.**

**Null A — matched-time placebo (primary), 1,000 draws.** Each real trade is
replaced by a trade entered at a bar drawn uniformly from **the same
09:40–11:10 NY window on a different randomly chosen weekday**, same symbol,
same side, **same stop distance in ATR**, same template, same forced-flat
rule, same costs. This holds the clock, the risk, the direction mix and the
costs fixed and destroys **only** the link to the H1-bias / M1-iFVG /
premium-discount / true-open composition. One-sided
`p = share of draws with mean netR ≥ observed`.

**Null B — whole-stream day shift (secondary), 250 draws.** Shift every signal
timestamp forward `k ~ U{1..250}` whole days, re-evaluate at the same clock
time.

**Interval.** Day-block bootstrap, resampling whole UTC days with replacement,
2,000 draws, **90 % interval** on the observed holdout mean netR.

**Verdict ladder** — applied mechanically to primary number 1, on the holdout:

| condition | verdict |
|---|---|
| `n_holdout < 150` | **UNDERPOWERED — inconclusive.** No directional claim. Return to Architect. |
| `mean netR < +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill.** |
| `mean netR ≥ +0.05R` and `0.0125 < p ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| **all six** of: `mean netR ≥ +0.10R`; `p ≤ 0.0125`; fit period same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150`; the 90 % bootstrap interval **excludes 0**; **gross** expectancy `> 0` | **REAL EDGE — build for real.** Routes to Software Engineer + Backtesting. |

**Why the build bar is +0.10R, above v5-NY's +0.05R.** Three reasons, all
fixed before any result: (a) in deployment this strategy takes at most three
trades a day inside one 90-minute window — a handful of trades a week — so a
+0.05R expectancy does not repay the cost of operating and monitoring it;
(b) slippage is unmodelled and the forced 11:10 market exit is a *worse*
slippage profile than the limit-ish exits v5-NY assumed; (c) primary number 1
uses the bot's own optimistic fill convention, so it is already generous by
construction. The **kill** threshold stays at +0.05R, deliberately identical
to v5-NY, so "this failed the same bar that one did" is a true statement.

**Secondary, pre-registered, explicitly non-gating.** Reported always, never
promoted to a verdict without a fresh pre-registration:

- **Exit-cause breakdown** — target / stop / trailed-stop / 11:10 time-exit.
- **Component ablation**, **fit period only**: drop each of the four gates
  (H1 bias, M1 iFVG, premium/discount, true-open side) in turn and report the
  marginal contribution of each. This is attribution, not a test.
- **Bug-fidelity sensitivities** — the §1.2 `getLastIfvg` index bug repaired,
  and the ATR gate's direction inverted to match its name. Sensitivity rows
  only; the primary reproduces the bugs (§4.2).
- **Non-circular forward lift**, built exactly as `v5-ny/tables.py:block_L`:
  post-signal MFE in ATR divided by the median unconditional forward extreme
  for the same `(bars-remaining-in-window × direction)` cell, computed from
  every in-window bar. **Pre-registered interpretation:** v5-NY measured
  0.95 (iFVG) / 1.00 (BoS) — par — for a *different* mechanic in *nearly this
  same window*. If this strategy's signals also land at ≈ 1.00, that is
  evidence the window, not the mechanic, is what is being measured, and it
  should be said plainly in the REPORT rather than left for a reader to
  notice.

---

## 4. Decision 3 — routing plan

**Architect → Researcher (one package, two stages, an Architect gate between)
→ Architect (judge) → [only on REAL EDGE] Software Engineer + Backtesting.**

Package: **`research/cmc-bot-smart-money/`** (this note lives there).
Deliverable set mirrors `research/session-liquidity-v5-ny/`: `README.md`,
`DESIGN.md`, `PARITY.md`, `REPORT.md`, `HANDOFF.md`, `RUNBOOK.md`, plus
`common.py` / `engine.py` / `hypothesis.py` / `tables.py` / `checks.py` /
`charts.py` / `examples.py` / `gallery.py`, `results/`, `viz/`.

No Integration Engineer and no DevOps engagement until a ship decision exists.
**No port of the bot's TypeScript into this project's production codebase at
this stage** — Software Engineer is not in this routing unless Stage 1 clears
the top row of the ladder.

### Stage 0 — reproduction and audit (descriptive, no performance number)

Gate to Stage 1. Produces **no** R, no expectancy, no win rate. Its output is
a parity proof and a signal inventory.

**What "reproduce the signals" means operationally.** Re-implement in Python,
in the style of this project's other passes, **bar-for-bar**:

- `getFvgElement` (including the `close[i]` vs `open[i-2]` body clause),
  `filterFvgArrays`, `filterInverseFvgArrays`, and the stateful
  `FvgCalculator.calculateStep` loop;
- `getLastIfvgDirection` / `getLastIfvg` **including the index bug and the
  directional defaults** (§1.2);
- the H1 bias: `calculateFVG` over a rolling **720-hour** H1 window ending at
  the current bar, re-evaluated every M1 bar;
- `Swings` at length 60, the `h_trail_up` / `h_trail_dn` running range, its
  `i > 200` warm-up, and `YinDiscount`;
- `isNewYorkAMTrueOpen` at **07:30 New York** and the `aboveNYamTrueOpen`
  comparison against the **last bar's open**, including its `false`-when-unset
  behaviour;
- the ATR(20) gate as written (`ATR / gapSize < 8`);
- `adjustStopLoss` with the {0.5, 0.7, 1.0} table, the 2.7R target,
  `tryToTrailStopLoss`, the close-only exit check, `Order.close()`'s clamping,
  and the 11:10-NY forced flat;
- the 12-hour rolling M1 evaluation window and a **UTC host** assumption for
  every `startOfDay`-based conversion (`knowledge/smart-money-ict.md` §2).

**Bug-fidelity rule.** The port reproduces the TypeScript's *behaviour*, bugs
included. Every divergence found gets a row in `PARITY.md` with a
**pre-registered** disposition — *reproduced as-is* (primary) or *fixed*
(sensitivity row only). **Nothing is silently fixed.** We are testing the
user's strategy as it exists; an improved version is a different hypothesis
and needs its own registration.

**Parity proof (`PARITY.md`), the Stage-0 gate.** Two checks, both must pass:

1. **Bar-for-bar parity against the TypeScript.** Run
   `npm run backtest ... BTCUSDT sm <static json>` over a **≥ 30-trading-day**
   window and assert the Python produces **identical signal timestamps,
   directions, stop prices and target prices** — zero discrepancies, or an
   itemised, explained list. This is the `MECHANIC-PROOF.md` standard applied
   to a port.
2. **Prefix-causality.** The bot recomputes every indicator from a window each
   bar, and several of its helpers are *window-end-relative*
   (`isYesterdayWithLastCandle`, the London scan, `chartData[last]`). A naive
   vectorised Python port will leak the future here. Re-derive **≥ 200 sampled
   signals** from a data prefix truncated at the signal bar and assert
   **0 lookahead**.

Plus the signal inventory: counts per asset, per year, per direction; the
eligibility funnel (in-window bars → both iFVG lists non-empty → bias agrees →
zone filters agree → ATR gate passes); and the **projected holdout trade
count**. If that projection is **< 150**, Stage 0 stops and returns to
Architect — the pass does not proceed to a hypothesis test it cannot power.

### Stage 1 — the pre-registered test

`DESIGN.md` is written and **committed before any R is computed**, restating
§3.2 verbatim and adding only mechanical detail. Then `engine.py` →
`tables.py` → `hypothesis.py` → `charts.py` → `examples.py` → `gallery.py` →
`checks.py`, and `REPORT.md` with the verdict in its first paragraph.

Measurement conventions, per this project's standing rules:

- **MFE/MAE and every geometry number in ATR(14) on the 5m frame** (resampled
  from 1m), per `knowledge/session-liquidity.md` §6.2, so the numbers are
  comparable across passes. The bot's internal ATR(20, M1) stays inside the
  mechanic and is not a reporting unit.
- **Stop-referenced R** — `1R ≡ |entry − stop|` at entry.
- Degenerate trades (zero stop distance, non-finite ATR, no forward bars)
  **excluded and counted** in a reported exclusions row.
- An un-curated, seeded, stratified worked-example gallery — the format that
  surfaced real bugs in three prior passes — plus captioned examples showing
  a target exit, a stop exit, a trailed exit and a **time exit**.

`checks.py` must assert, at minimum: bar-for-bar parity with the recorded
Stage-0 fixtures; prefix-causality on a fresh sample; that no signal falls
outside 09:40–11:10 NY; that no position survives 11:10 NY; that the placebo
machinery reproduces the real-trade template on 100 % of real trades (v5-NY's
own check); and brute-force re-derivation of the stop/target/cost arithmetic.

---

## 5. Decision 4 — symbols and data source

### 5.1 Symbols: **BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT** (Binance USD-M perp)

Pooled across all four for the primary number, with a per-asset table as a
mandatory robustness appendix.

- `PROJECT.md` scopes the project to **crypto and equities, intraday**. These
  four are in scope and are the assets this project already owns four audited
  years of.
- **Power.** The bot's daily caps and 90-minute window make a two-asset sample
  thin; §3.2 already removes the caps, and four assets is the other half of
  the fix. v5-NY treated SOL/BNB as an appendix because BTC/ETH alone cleared
  its power minimum; here they are promoted into the primary population, and
  that promotion is declared **now**, not after seeing a count.
- Cross-asset agreement is the cheapest robustness check available for a
  strategy whose parameters were hand-picked.

### 5.2 Explicitly excluded this pass: **US500 / US100 and every Capital.com
instrument**

Four reasons, any one sufficient:

- The bot's own documented smart-money backtests are **BTCUSDT and ETHUSDT
  only** (`cmc-bot-main/docs/backtesting.md`); US500/US100 appear there
  against the **vwap** strategy, which is out of scope (§6).
- `PROJECT.md` defers forex/futures until the crypto/equities pipeline is
  proven.
- Capital.com is a **CFD broker**, not an exchange tape: its prices and its
  costs (spread, financing) are broker-specific and unknown to us, so a result
  would be neither reproducible nor portable, and the 0.10 % cost model would
  be a fabrication.
- Most importantly, **a 09:40–11:10 New York window means something entirely
  different on an instrument that only trades 09:30–16:00 New York.** On an
  index it is "the first hundred minutes after the cash open" — a genuinely
  different and arguably more plausible hypothesis than the same clock slice
  of a 24/7 crypto tape. It deserves its own pre-registration and must not
  ride along on this one. **Logged as a separate backlog candidate**, not
  killed.

### 5.3 Data source: **this project's own Binance archive loader, not the
bot's `npm run scrap`**

Use `research/intraday-mr-smc/fetch_data.py` — Binance's public bulk archive
(`data.binance.vision`, USD-M perpetual monthly klines, no API key), the same
puller every pass since Запись 1 has used. It takes the interval as a free
CLI argument, so **1m requires no code change**.

- **Independence.** Validating a bot with the bot's own data pipeline makes a
  pipeline bug invisible. The whole point of this pass is to not take the
  bot's word for anything.
- **Comparability.** Same source, same 48 months, same symbols, same loader as
  all seven prior passes — which is what makes "this failed the same bar
  v5-NY failed" meaningful.
- **No dependency on the artifact under test.** `npm run scrap` needs the
  bot's `.env`, its Binance client and a Capital.com session.

**Timeframes.** Pull **1m** for 2022-08-01 .. 2026-07-31 on all four symbols
(new for this project — no pass has used 1m before; `fetch_data.py` supports
it unchanged). Derive **1h by resampling the 1m frame**, per the house
convention in `intraday-mtf-smc/fetch_mtf.py`; derive **5m** the same way for
the ATR(14) reporting unit.

**Do not substitute 5m for the M1 stream.** The M1 iFVG is *the* entry
primitive; on 5m it is a different event and the pass would be testing a
different strategy. If 1m proves infeasible at this volume (~2.1 M bars per
symbol), Stage 0 stops and returns to Architect — it does not downgrade the
timeframe on its own authority.

**One declared deviation to record in `DESIGN.md`:** our archive is USD-M
**perpetual futures**, while the bot's `BinanceClient` may run spot. The
0.10 % taker cost model is the perp one, held identical to v5-NY on purpose.
Declare it; do not silently paper over it.

---

## 6. Decision 5 — scope boundary

**Out of scope for this pass, confirmed.** A Researcher must not read,
reproduce, measure or report on any of:

- `cmc-bot-main/src/strategy/vwap-strategy.ts` and the whole vwap idea
  (including the US500/US100 examples in `docs/backtesting.md`);
- the `tech-analysis` / RSI strategy (`ta` in the backtest CLI);
- `correlation-analyzer`;
- the Telegram control/notification bot;
- AWS / OTel deployment plumbing;
- `chart-visualizer`;
- `cmc-bot-main/src/backtesting/` **as a source of results** — it is read
  *only* as the specification of the bot's own bar loop and fill semantics,
  and as the harness for the Stage-0 parity run. **No number it produces
  enters this project's record.**

Also out of scope: the unused level machinery inside the indicator
(PDH/PDL/PWH/PWL/PMH/PML, London high/low, the dead BoS flags). It is not
ported and not measured — see `knowledge/smart-money-ict.md` §5.

---

## 7. What Researcher is handed

1. This note and `knowledge/smart-money-ict.md`.
2. **Stage 0:** the Python reproduction, `PARITY.md` with both proofs passing,
   the signal inventory and funnel, the projected holdout trade count, and the
   `PARITY.md` disposition table for every bug found. **Stop and return to
   Architect** — with the count, and immediately, if projected holdout
   n < 150, or if the 1m pull proves infeasible, or if bar-for-bar parity
   cannot be reached.
3. **Stage 1**, on an Architect go: `DESIGN.md` committed before any R, then
   the test exactly as pre-registered in §3.2, then `REPORT.md` with the
   verdict in the first paragraph and every sensitivity actually run listed —
   including the ones that came out worse.
4. `HANDOFF.md` back to Architect either way. A kill is as much a result as a
   ship, and gets its own `RESEARCH-LOG.md` entry regardless of outcome.
