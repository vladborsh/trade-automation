# DESIGN — pipeline calibration: three positive controls (`_calibration`)

**Status: PRE-REGISTRATION. Committed before any number in any of the three
tests was computed.** Nothing in this package is a registration, a verdict or
a strategy. It is a measurement of *the measuring instrument*.

**Mandate:** `research/_surveys/2026-09-red-team.md` §6.1–§6.3 (Architect,
2026-09-16). The survey's §6.0 lists three calibration facts that already
pass (cost model not double-counted, no systematic sign/look-ahead error, the
statistics do flag positives when they exist). Those are **not redone here**.
What is missing, and what this package supplies, is an **end-to-end positive
control with a known answer**.

**The question this package answers, in one line:** *when a known edge of
known size is present, does this pipeline recover it, at the right size, with
the right sign, and does the verdict ladder fire?*

---

## 0. Standing constraints (bind all three tests)

1. **Fit period only. No holdout is read, on any test, by any code path.**
   - `orb-ny-open` fit = `2024-01-01 .. 2025-07-31` (`common.py:FIT_START/FIT_END`).
   - `crosssec-instruments-in-play` fit = `2020-01-01 .. 2025-07-31`.
   - Test A additionally sets `common.TAIL_END := common.FIT_END` **before any
     object is constructed**, so that `analysis.Pool` — the matched-time
     placebo pool, which in the shipped code spans `FIT_START..TAIL_END` —
     draws only from fit-period days. This is a *window* override, not a code
     change: the null's construction (matched clock slot, matched side,
     matched `stop_atr`, same-date clash re-draw) is untouched. It is recorded
     here because it is the one deviation from running `analysis.py` verbatim,
     and it exists only to honour constraint 1.
2. **`engine.py`, `cost_R`, `null_A`, `null_B`, `boot_days` and `verdict` are
   imported and called, never edited.** The calibration acts on the *data fed
   to them*, which is the entire point: a plant that required touching the
   machinery would not test the machinery.
3. **A failure is the finding.** If a test fails, it is reported as a failure
   and the machinery is not adjusted to make it pass. A failure means the 30
   kills on the ledger need re-reading.
4. **One shot.** Each test is run once at the parameters fixed below. No
   parameter in this file is changed after a number is seen. If a bug in the
   *calibration harness itself* (not the pipeline) is found mid-run, the fix
   and the re-run are logged in `RESEARCH-LOG.md` with the reason.
5. Seeds: `common.SEED = 20260916` throughout, so the nulls are reproducible.

---

# TEST A — a planted signal of known size, end to end

## A.1 What is planted

On `orb-ny-open`'s **fit** tape, on each day that produces a trade, every
1-minute bar strictly after the entry minute and up to the 16:00 NY forced
flat has its `open/high/low/close` shifted by

```
    shift(k) = side * d * stop_dist * (k - i_entry_min) / (i_flat - i_entry_min)
```

where `k` indexes 1-minute bars, `side`/`stop_dist`/`i_entry_min`/`i_flat` are
the *clean-tape* trade's own values, and `d` is the plant size in units of R.
The ramp is linear in elapsed minutes, zero at the entry minute and exactly
`d * stop_dist` at the forced flat.

`d ∈ {0, +0.05, +0.10, +0.20}` and the **inverted** plant
`d ∈ {−0.05, −0.10, −0.20}`. Seven runs per arm, eight arms.

**Why the plant cannot change which trades exist.** The opening range is built
from 09:30–10:00 bars; the trigger is the first arm bar closing beyond the
range in [10:00, 12:00). The shift starts at `i_entry_min + 1`, i.e. strictly
after the trigger bar's last minute. On the 5m/15m arms the trigger bar's own
close is `i_last`, which is not shifted. Therefore, **by construction, the
planted tape yields the identical set of trades with identical `side`,
`entry`, `stop`, `stop_dist`** as the clean tape. This is asserted at runtime
(A.4 gate G0); if it fails the test is void.

**Why the plant is applied per `(symbol, tf)`.** A day's 5m trade and its 15m
trade generally differ in entry minute and stop distance, so a single tape
cannot carry both plants. Each arm gets its own planted copy of its
instrument's 1m tape, built fresh, with `engine.Tape._cache`,
`features.Ind._cache` and `analysis.Pool._cache` cleared between runs.

## A.2 What is *not* claimed, stated before running

Two things are known in advance to make the naive prediction "recovered mean
net R = `d` − `cost_R`" **only approximately** true, and both are stated here
so that neither can be discovered afterwards and used as an excuse:

* **Bounded payoff (attenuation).** Template 1 exits at ±1R. A trade that hits
  its target *before* the ramp has accumulated does not collect the full `d`;
  it collects `+1R` exactly as it did on the clean tape. Only a trade held to
  the 16:00 forced flat collects the full `d`. The realised mean shift is
  therefore `≤ d` and the shortfall grows with `d`.
* **The plant also moves the exit mix.** The drift converts some stop-outs
  into targets and vice versa. This pushes the realised shift *up*, partly
  offsetting attenuation. The net of the two is not predictable in closed form,
  which is why A.3's gates are built on quantities that *are* exact.

So the naive `d − cost_R` prediction is reported as a **diagnostic column,
not a gate**, alongside the attenuation ratio. The gates below are exact.

## A.3 Pre-registered pass criteria

| id | gate | criterion | binding |
|---|---|---|---|
| **G0** | plant is signal-neutral | the trade set at every `d ≠ 0` is identical to `d = 0` in `(date, side, entry, stop, stop_dist, i_entry_min, i_flat)` on every arm | **hard** — failure voids the test |
| **G1** | exact recovery of a known size | on every trade that exits at `time-exit` at **both** `d = 0` and the planted `d`, `grossR(d) − grossR(0) == d` to within `1e-9`, on every arm, both templates, both signs of `d` | **hard** |
| **G2** | identity at `d = 0` | the `d = 0` run reproduces the committed `fit_describe.csv` / `trades_all.parquet` fit rows exactly (mean net R per arm, both templates, to `1e-12`) | **hard** |
| **G3** | monotone recovery | mean net R is strictly increasing in `d` over `{−0.20 … +0.20}` on every arm, both templates | **hard** |
| **G4** | sign symmetry | `mean(d) + mean(−d) − 2·mean(0)` has the same sign and comparable magnitude as the attenuation predicted by A.2 and, critically, `mean(−d) < mean(0) < mean(+d)` on every arm. A sign error in the engine, the plant direction or `cost_R` would break this and nothing else would. | **hard** |
| **G5** | cost sits where §6.0 says | `mean(grossR) − mean(netR) == mean(cost_R)` to `1e-12` at every `d`, and `mean(cost_R)` is invariant in `d` to within `0.002R` (the plant moves exit minutes, hence exit spreads, but only slightly) | **hard** |
| **G6** | α fires at 0.20, not at 0 | `p_A ≤ α = 0.00625` on a **majority of the eight arms** at `d = +0.20`; `p_A > α` on a majority at `d = 0` | **soft** (see A.5 leakage) |
| **G7** | bootstrap covers the truth | the 90 % day-block bootstrap interval `[p5, p95]` of the planted run contains that run's own realised mean on every arm at every `d` (a self-consistency check on `boot_days`), and at `d = +0.20` the interval excludes 0 on a majority of arms | **hard** / **soft** |
| **G8** | power curve | the fraction of the eight arms reaching `REAL EDGE — build for real` under `verdict()`, as a function of `d`, is reported for `d ∈ {0, 0.05, 0.10, 0.20}`. **Descriptive** — this is the deliverable, not a gate. Pre-registered *expectation* from red team §1: ≈ 0/8 at `d = 0.05`, a minority at `d = 0.10`, a majority at `d = 0.20`. | descriptive |

`verdict()` is called with `m_hold` := the **fit-period** planted mean and
`m_fit` := the same (the ladder's "fit agrees" clause is trivially satisfied
in a fit-only calibration; this is stated so the reported pass rate is read as
an **upper bound** on the true ladder pass rate).

## A.4 Known confound, pre-registered: Null-A leakage

`null_A` draws placebo entries from every arm bar opening in [10:00, 12:00) on
every eligible day and walks them forward on **the same tape**. The plant, being
a property of the tape rather than of the breakout, is therefore **partially
visible to the null**: a placebo that happens to enter on a planted day, after
the real entry minute, on the same side as that day's real trade, collects part
of the ramp.

This is a property of the *plant*, not of the pipeline, and it is
unavoidable — no tape-level intervention can be visible to the breakout rule
and invisible to a random-time entry on the same tape. It is registered here,
before running, with its consequence:

> **`nullA_mean` will rise with `d`, and `p_A` will therefore be biased
> upward relative to what the same ladder would return against a genuine
> breakout-specific edge of the same size. The empirical power curve in G8 is
> consequently a LOWER BOUND on the ladder's power against a real edge.**

`nullA_mean(d)` and the implied leakage coefficient `ρ = Δ nullA_mean / d` are
reported as a table row. G6 and the `p_A` half of G7 are marked **soft** for
exactly this reason; G1–G5 are unaffected because the null plays no part in
them.

## A.5 Deliverables

`results/testA_recovery.csv` (per arm × `d`: n, mean gross/net/cost R, exit
mix, `nullA_mean`, `p_A`, `p_B`, bootstrap interval, verdict),
`results/testA_gates.csv` (G0–G7 pass/fail per arm), and in `REPORT.md` the
recovery table and the empirical power curve.

---

# TEST B — a known published effect through the same engine

## B.1 The arms

On the Capital.com 1m tape, `2024-01-01 .. 2025-07-31` (the `orb-ny-open` fit
window), on `US500` and `US100`:

* **Arm B-ON (overnight):** buy at the 16:00 NY bar's close on session day
  `t`, sell at the 09:30 NY bar's close on the next session day `t+1`.
* **Arm B-DAY (mirror, open-to-close):** buy at the 09:30 NY bar's close on
  day `t`, sell at the 16:00 NY bar's close the same day.

A session day is a full NYSE day by `common.nyse_days` (holidays and 1:00 pm
early closes excluded, exactly as every other package in this repo). A pair is
formed only when **both** legs have a 1m bar at the exact minute; unmatched
days are counted and reported, never imputed.

**This is stated in advance and is not a defect:** neither arm will pass the
verdict ladder. The overnight index premium is a Sharpe ≈ 0.4–0.6 object
(red team §3); at ~370 observations it cannot clear `α`. **Test B is a
mechanical check on fills and timestamps, not a strategy, and no verdict is
issued on it.**

## B.2 Units

Returns are in **percent of entry price**, not in R — there is no stop, so
there is no R. `cost_R`'s denominator does not exist for this arm, so the
engine's *cost function is not exercised by Test B*; the spread is applied
directly in price, as `cost_price = (spread_close[entry_minute] +
spread_close[exit_minute]) / 2`, which is the identical formula to
`engine.cost_R`'s Capital.com branch with the `/dist` removed. This is stated
because it means Test B checks the **tape, the timestamps and the fill
convention**, and checks the cost *formula* only in its numerator.

## B.3 Pre-registered expectations

| id | expectation | criterion |
|---|---|---|
| **B1** | **the critical one** | the engine's mean B-ON return equals the arithmetic mean of the tape's own `close(09:30_{t+1}) / close(16:00_t) − 1` over the identical matched day list, **to better than the mean applied spread in percent**. Agreement is computed as `\|engine_mean − arithmetic_mean\|` vs `mean(cost_price)/entry` in the same units. |
| **B2** | overnight beats intraday | `mean(B-ON) > mean(B-DAY)` on **both** US500 and US100, gross of costs |
| **B3** | independent external agreement | the same sign as SPY (vs US500) and QQQ (vs US100) close→open means computed by this package from Yahoo `v8/finance/chart` daily unadjusted OHLC over the identical date list, pulled independently of the CFD tape |
| **B4** | magnitude sanity | the CFD close→open mean is within ±3 bp/day of its SPY/QQQ counterpart. Stated in advance: unadjusted SPY/QQQ close→open carries a **downward** dividend drag of ≈ −1.2 %/yr ≈ −0.5 bp/day concentrated on four ex-dates, and the CFD is a price index with no dividend, so the CFD is *expected to be the higher of the two* by roughly that amount. |

**B1 is a STOP condition.** Per the mandate: *if the engine's close→open number
differs from the tape's own arithmetic by more than the spread, work stops
immediately and the coordinator is escalated, because that would mean fills or
timestamps are wrong and every index verdict this project has produced is
suspect.* B2/B3/B4 are reported; they are not stop conditions.

## B.4 Financing

Capital.com charges overnight financing on index CFDs. This package has no
account statement, so no exact rate is available. Per red team §3 the rate is
`SOFR + 4 % p.a. ≈ 1.1–2.4 bp/night`; **that published band is used, both ends
reported**, and Friday→Monday holds are charged **three** nights (the standard
CFD convention). Financing appears **only** in the economic column. The B1
gate is computed **before financing**, because financing is a constant
per-night deduction that cannot affect an arithmetic-identity check.

## B.5 Deliverables

`results/testB_overnight.csv`, `results/testB_external.csv`, and in
`REPORT.md` the engine-vs-arithmetic agreement table with the spread bound.

---

# TEST C — a Journal of Finance cross-sectional effect as the portfolio harness's Stage 0

## C.1 Coordination with the in-flight package

`research/crosssec-instruments-in-play/` is being built concurrently
(`researcher-crosssec` worktree, uncommitted at the time of this file:
`prep/{fetch,listing,universe,pull1m,pullfunding}.py`, `common.py`,
`engine.py`, plus `data/1d/` and `results/listing.json`). **Its universe and
pull machinery are reused, not duplicated:** this package reads a snapshot of
that package's `data/1d/*.parquet` and `results/listing.json` (860 admitted
USDT-margined perp prefixes including delisted ones — `FTTUSDT`, `LUNAUSDT`,
`SRMUSDT`, `BTCSTUSDT` are all present, so the universe is survivorship-free).
**Nothing is re-pulled.** The snapshot's symbol count and pull timestamp are
recorded in the REPORT, because that package's pull was still in progress.

The Stage-0 harness written here (`testc.py`) is deliberately standalone and
free of this package's constants so it can be lifted into the cross-sectional
package as its Stage 0.

## C.2 The mechanic — Liu, Tsyvinski & Wu, *Journal of Finance* 77(2), 2022

* **Universe, weekly, at each rebalance date `T` (Monday 00:00 UTC):** every
  symbol with a 1d bar on `T` and on `T − 7k` days for the arm's `k`, with no
  missing day in the lookback and a strictly positive close on both ends.
  If fewer than **50** symbols qualify on a date, that date is **dropped** and
  counted (the mandate's `≥50`-perp universe condition).
* **Signal:** trailing `k`-week return `close(T)/close(T − 7k) − 1`, for
  `k ∈ {1, 2, 3, 4}` — four arms, exactly the horizons in the paper.
* **Portfolio:** rank on the signal, **long the top quintile, short the bottom
  quintile**, equal-weighted within each leg.
* **Hold:** one week, `T → T + 7` days. Forward return `close(T+7)/close(T) − 1`,
  computed only for symbols with both bars; a symbol that delists inside the
  week is carried at its last available close and counted (this is the
  survivorship-honest choice and it is stated in advance).
* **Costs:** **gross**, per the mandate. Crypto perp round-trip on a 50-name
  two-sided weekly rebalance is large and would swamp the check; this is a
  control for the harness, not a strategy.
* **Period:** `2020-01-01 .. 2025-07-31`, the cross-sectional package's fit
  window. **No holdout.**

## C.3 Pre-registered expectations

| id | expectation | criterion |
|---|---|---|
| **C1** | **the gate** | the long–short weekly spread is **positive** (same sign as the published result) with **t ≥ 2** on at least one of `k ∈ {1,2,3,4}` over the fit period |
| **C2** | robustness | the plain `t = mean / (sd/√n)` is accompanied by a Newey–West(4) `t`; both are reported, C1 is judged on the plain `t` |
| **C3** | the legs are not degenerate | both legs carry ≥ 10 names on ≥ 90 % of rebalance dates; the count distribution is reported |
| **C4** | the control fires comparably often | per `deriv-positioning`'s own note, a shadow control must *fire* at a comparable rate: the number of rebalance dates used is reported per `k`, and a `k` whose date count is < 90 % of `k=1`'s is flagged |

**C1 is not a verdict and not a registration.** It is the positive control for
the portfolio harness. Stated in advance, both outcomes are informative:

* **C1 passes** → the harness reproduces a Journal of Finance factor on free
  survivorship-free data, and the cross-sectional family's eventual verdict on
  the RVOL selector inherits that credibility.
* **C1 fails** → stated now, before the number is seen: this is **not**
  automatically a harness bug. The paper's sample is 2014–2020 **coins**,
  market-cap weighted, spot; this test is 2020–2025 **USDT perps**,
  equal-weighted. A sign flip would be a genuine and reportable
  out-of-sample/out-of-universe failure of the published effect, and it would
  be reported as such — but it would also leave the harness **uncertified**,
  which is the finding that matters, and the REPORT must say so plainly rather
  than claiming either a pass or a pipeline bug.

## C.4 Deliverables

`results/testC_xsmom.csv` (per `k`: n dates, mean weekly long–short, sd, plain
`t`, NW(4) `t`, mean leg sizes, long-only and short-only means),
`results/testC_weekly.csv` (the weekly series), and the table in `REPORT.md`.

---

## 9. What this package will conclude

`REPORT.md`'s **first paragraph** states, in one sentence and before anything
else: **does this pipeline recover a known edge of known size — yes or no.**
The three possible bottom lines are written down here, in advance, so that the
conclusion is a lookup and not a narrative:

* **All hard gates pass** → the engine, the cost model, the nulls, the
  bootstrap and the ladder are sound; the 30 kills stand as honest kills of
  candidates too small for a one-year holdout, exactly as red team §1 argues,
  and the binding constraint is statistical power, not machinery.
* **G1/G2/G4/G5 or B1 fail** → the machinery has a defect; the affected
  verdicts on the ledger are suspect and must be re-read. Escalate immediately.
* **Hard gates pass but G6/G8 show near-zero power at `d ≤ 0.10`** → the
  machinery is correct and the ladder is, as §1 computed, unable to certify
  realistic edges in one year on one instrument. That is a design finding
  about the *research programme*, not a bug, and it goes to the Architect.
