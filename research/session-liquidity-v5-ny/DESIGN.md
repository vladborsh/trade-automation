# Design / PRE-REGISTRATION — session-liquidity **v5-NY**

**Role:** Researcher · **Hand-off:** Architect (`HANDOFF.md`)
**Package:** `research/session-liquidity-v5-ny/`
**Status of this file:** written and committed **before any outcome number for
this pass existed**. Everything in §3–§7 is fixed in advance. If a later
section of `REPORT.md` deviates from this file it must say so explicitly and
say why.

---

## 0. Why this pass exists, stated honestly

The session-liquidity idea was **shelved** on 2026-08-31 (`RESEARCH-LOG.md`
Запись 17) after six descriptive passes converged on one null: confirmation
(iFVG or BoS) is a *timing / entry-reference* mechanic, not a *selection*
filter — the circularity-free forward lift is below 1.0 for every rule
measured (BoS 0.87, iFVG-v4 0.83, phase-1 BoS 0.74).

The user reviewed that verdict, was not convinced, and asked for one more pass
with three definitional changes (§2). Two things about the origin of this pass
matter and are recorded here rather than buried:

1. **It is motivated by disagreement with a null**, and
2. **the changes are hand-picked cuts** (a specific 100-minute window of the
   day, chosen by a human who believes it is where the move happens).

That is the textbook setup for p-hacking. So this pass is **not** run under
the descriptive protocol of `knowledge/session-liquidity.md` §8. It is run as
a **pre-registered hypothesis test** — the standard the Architect's own
shelving ruling (Запись 17 §7) demands before this idea may be reopened:
permutation null, kill rule, chronological fit/holdout split, a real stop rule
pinned before any R is computed. The descriptive metrics every prior pass
reported are computed **as well**, not instead.

A second, independent deliverable is a **visual audit** (`MECHANIC-PROOF.md`)
of the current detection mechanics on real charts, because the user's stated
distrust of the null is partly a distrust of the implementation — justified,
since 3 of the 6 prior passes did carry real implementation bugs.

---

## 1. What is inherited unchanged (and must reproduce bit-for-bit)

Everything upstream of the confirmation layer is inherited from
`research/session-liquidity-bos/`, which inherited it from
`research/session-liquidity-v4/`, which reproduced v2 byte-identically:

* sessions and blocks (`knowledge/session-liquidity.md` §1) — Asia 00–08,
  London 08–13, **NY 13–21**, Late 21–24, fixed UTC, no DST;
* level classes §3.1 (session highs/lows; **PDH/PDL out of scope**, as in the
  BoS pass), reference scope §4, the V1–V9 ledger §7;
* the block-scoped horizon §6.1 and the primary filter ≥ 12 bars remaining;
* ATR(14, 5m) as the primary unit §6.2;
* **iFVG v4** (§5.1) — sequential, latest-formed active candidate, no
  invalidation, relaxed location;
* **BoS pinned anchor** (§5.2) — anchor = most recent opposing k=3 fractal
  pivot confirmed as of `t0`, fixed for the event's life, break = first close
  beyond it inside the block.

`checks.py` asserts the take-out stream and both confirmation streams
reproduce `research/session-liquidity-v4/results/events_*.csv` and
`research/session-liquidity-bos/results/events_*.csv` exactly. **If they do
not, this pass is invalid and reports that instead of a result.**

### 1.1 Data note (deviation from prior passes, recorded up front)

Prior passes read `research/intraday-mtf-smc/data/`. That directory is not
present in this worktree (it is gitignored and was not materialised). This
pass reads `research/intraday-mr-smc/data/` for BTC/ETH/SOL — same source,
same puller (`fetch_data.py`), same range **2022-08-01 .. 2026-07-31**, same
420,768 bars per symbol — and re-pulls **BNBUSDT** from the identical public
Binance archive because no local copy existed. The bit-identity checks in
`checks.py` are what proves the substitution is harmless; they are run on all
four symbols.

---

## 2. The three definitional changes (pinned)

### 2.1 Long-horizon column, block-scoping stays primary

The block-scoped horizon (§6.1) **remains the primary measurement**. Added
alongside it, as a secondary/appendix column reported side by side in the same
units (ATR multiples, same MFE / MAE / end-of-window convention):

* **`h24` horizon** = from the confirmation bar to `min(t0 + 288 bars, last
  bar of the dataset)` — 288 × 5m = **24 hours from the take-out bar**. It may
  and usually will cross block and day boundaries; that is the point.

**Detection is unchanged.** A confirmation still has to happen inside the
block-scoped window to exist at all (§5.1 / §5.2 are untouched). Only the
*measurement* horizon after confirmation is extended. This is deliberate: it
isolates "does the move keep going past the block boundary" from "does a
longer detection window find more events", which are different questions and
must not be mixed in one number.

### 2.2 The NY window: 09:40–11:20 New York, as a **fixed UTC** window

House convention is fixed UTC, no DST handling (24/7 crypto tape,
`knowledge/session-liquidity.md` §1). Applying it here:

| offset | 09:40–11:20 NY becomes | inside NY block (13:00–21:00 UTC)? |
|---|---|---|
| **UTC−4 (EDT) — PINNED, primary** | **13:40–15:20 UTC** | yes, fully |
| UTC−5 (EST) — sensitivity row | 14:40–16:20 UTC | yes, fully |

**Primary = UTC−4**, because EDT covers roughly eight months of the calendar
(mid-March to early November) against EST's four. Both offsets place the
window fully inside the NY block, so the pass is feasible either way; UTC−5 is
reported as a sensitivity row, not as a second hypothesis.

**DST-drift caveat, to be repeated verbatim in `REPORT.md`:** a fixed UTC−4
window is *not* 09:40–11:20 New York wall clock all year. During EST months it
is really **08:40–10:20** New York wall clock. Nobody should read these
numbers as wall-clock precision around the 09:30 NYSE open; they are a fixed
100-minute UTC window that coincides with 09:40–11:20 NY for ~2/3 of the
sample and sits one hour earlier for the rest.

**How the filter is applied — LIVE FILTER on the confirmation bar.** A
take-out counts as a *trade* in the primary hypothesis test if and only if its
**confirmation bar** (the iFVG inversion close, or the BoS break close) has an
open-time in `[13:40, 15:20)` UTC. 100 minutes = **20 five-minute bars**
(13:40 … 15:15 inclusive of bar open times).

**Structural consequence, to be measured and reported, not assumed:** because
confirmation is block-scoped, `t0 ≤ confirmation bar` and both sit in the same
block, so an in-window confirmation forces the take-out itself into
`13:00–15:15 UTC` inside the NY block. The eligible take-out population is
therefore a *narrow slice* of the full stream. `REPORT.md` must state, in
counts: total take-outs → take-outs in the NY block → take-outs whose `t0`
could still produce an in-window confirmation → take-outs that actually do,
per arm. If that final number is small, that is the finding and it is reported
as such; the window is not widened to make it bigger.

### 2.3 Assets

Computed on **BTC / ETH / SOL / BNB** exactly as every prior pass, for the
cross-asset robustness check. **Reported** with **BTC and ETH foregrounded** —
they carry the report body, every chart and the whole gallery. SOL and BNB go
in an explicitly labelled appendix table as the robustness check. They are not
removed from computation and their numbers are never dropped for being
inconvenient.

**The pre-registered hypothesis test in §3 is run on the pooled BTC+ETH
population.** The 4-asset pooled version and the per-asset breakdown are
reported alongside as robustness, not as the primary number. Pinned here so
the choice cannot be made after seeing which one looks better.

---

## 3. The hypothesis

> **H1 (iFVG arm).** A trade taken at an **iFVG-v4 confirmation** whose close
> lands inside the NY window (13:40–15:20 UTC), on BTC or ETH, risking to the
> pinned stop of §4, has a **positive net expectancy in R** — materially above
> zero and above what the same trade template earns at a matched random time
> inside the same window.
>
> **H2 (BoS arm).** The same statement for the **BoS pinned-anchor**
> confirmation.

`H0` in both cases: net expectancy is ≤ 0 / indistinguishable from the
matched-time placebo of §6.

Two arms × two horizons (block-scoped, h24) = **four primary numbers**. That
multiplicity is accounted for in §7's thresholds and is not to be quietly
dropped.

---

## 4. The stop rule and the trade template (pinned BEFORE any R is computed)

The stop is the project's **existing** convention, reused, not invented for
this pass — `research/session-liquidity-bos/DESIGN.md` §2, which is the same
convention iFVG has used since v2, so R stays comparable across packages:

* **Entry** — at the **close of the confirmation bar** `u` (iFVG inversion
  close, or BoS break close). Direction: high sweep → **short**, low sweep →
  **long**.
* **Stop price** — the **sweep leg's running extreme over `[t0, u]`**: the
  highest high for a high sweep, the lowest low for a low sweep. This is the
  take-out-wick-anchored stop for iFVG and the same running extreme for BoS,
  exactly as the BoS pass pinned it.
* **`stop_dist` = |entry − stop price|**, in price; `stop_atr = stop_dist /
  ATR(14)` at `t0`. `1R ≡ stop_dist`.
* **Target** — **+1R** from entry in the favourable direction. A fixed 1R
  target is chosen because it needs no parameter fitting and because MFE (the
  metric every prior pass used) is a best-case exit nobody hits; this is a
  rule an execution engine could run unchanged.
* **Path evaluation**, bar by bar from `u+1` to the horizon end:
  1. if the bar's adverse extreme reaches the stop → **−1.00R**, done;
  2. else if the bar's favourable extreme reaches the target → **+1.00R**,
     done;
  3. **same-bar ambiguity is resolved as a LOSS** (stop checked first) — the
     conservative reading, pinned so it cannot be flipped later;
  4. if neither by horizon end → **mark to market at the horizon's closing
     price**, signed, in R.
* **Horizons** — `block` (primary, §6.1) and `h24` (§2.1).
* **Costs** — **0.10% round trip** (2 × 5 bp, Binance USD-M taker). In R:
  `cost_R = 0.001 × entry_price / stop_dist`. Applied per trade.
  **`netR = grossR − cost_R`.** Slippage beyond the taker fee is not modelled
  and this is stated as a limitation, not silently assumed away.
* **Degenerate cases** — `stop_dist ≤ 0` or non-finite ATR → the trade is
  **excluded and counted** in a reported exclusions row, never silently
  dropped.

**Primary success metric: the mean `netR` per trade (expectancy), block-scoped
horizon, pooled BTC+ETH, on the holdout period.** Secondary reported
alongside, always: median `netR`, win rate, mean `grossR`, and the same four
on the `h24` horizon.

---

## 5. Fit / holdout split (chronological, pinned dates)

Sample: **2022-08-01 .. 2026-07-31**, 48 months.

| period | dates | months | use |
|---|---|---|---|
| **Fit** | 2022-08-01 .. **2025-07-31** | 36 (75%) | all exploration, all eyeballing, every sensitivity row |
| **Holdout** | **2025-08-01** .. 2026-07-31 | 12 (25%) | **touched once, at the end**, to report the final number |

Split by the **take-out bar's UTC date**. No parameter in §2 or §4 may be
changed after looking at the holdout. If anything in the plan turns out
infeasible, `REPORT.md` says so; it does not re-cut the split.

---

## 6. Permutation null (the "how often would this happen by chance" test)

**Null A — matched-time placebo (primary).** For each real trade, draw a
placebo entry bar uniformly from the bars inside the *same* NY window
(13:40–15:20 UTC) on a **different, randomly chosen date** for the **same
symbol**, and run the identical trade template with:

* the **same side** (long/short) as the real trade,
* the **same stop distance in ATR** (`stop_atr` converted back to price with
  that placebo bar's own ATR),
* the **same horizon type** (block end of that placebo day's NY block, or
  +288 bars for `h24`),
* the same costs and the same path rules of §4.

**1,000 draws** of the complete trade set → a null distribution of mean
`netR`. One-sided **p = share of draws whose mean `netR` ≥ the observed mean**.

What Null A holds fixed: time of day, session block, side mix, stop width in
ATR, horizon length, cost model, asset mix. What it destroys: the alignment
with an actual swept level and an actual confirmation. So it answers exactly
the question that matters — *does the sweep-confirmation add anything over
entering at a random moment in the same window with the same risk?*

**Null B — whole-stream day shift (secondary).** Shift every confirmation
timestamp forward by `k` whole days, `k` drawn from 1..250, and re-evaluate at
the same clock time on the shifted day. 250 draws. This preserves the event
stream's own clustering and time-of-day structure and only breaks the
price alignment. Reported as a cross-check on Null A.

**Block bootstrap (for the confidence interval, not the p-value).** Resample
**whole UTC days** (all trades on a day move together) with replacement, 2,000
draws, to give a 90% interval on the observed mean `netR`. Days are the
natural block because intraday trades on one day share one tape.

---

## 7. Kill rule and verdict rule (numeric, fixed now)

Evaluated on the **holdout**, per arm, primary horizon:

**Minimum power.** Fewer than **150 holdout trades** in an arm → that arm is
**"underpowered — inconclusive"**, and no directional claim is made from it
either way.

**Verdict ladder** (`m` = holdout mean `netR`, `p` = Null-A one-sided p-value):

| condition | verdict |
|---|---|
| `m < +0.05R` **or** `p > 0.20` | **NO EDGE** — kill. Stated as plainly as the six prior passes. |
| `m ≥ +0.05R` and `0.0125 < p ≤ 0.20` | **INCONCLUSIVE / suggestive at best** — not a reopen. |
| `m ≥ +0.05R` and `p ≤ 0.0125` and the **fit period has the same sign with `m_fit ≥ +0.05R`** | **REAL EDGE, provisionally** — hand to the Architect as a reopen candidate under Запись 17 §7. |

The `0.0125` threshold is `0.05 / 4` — a Bonferroni correction for the four
primary numbers of §3. `p ≤ 0.05` alone, uncorrected, buys the word
"suggestive" and nothing more.

**`+0.05R` is the kill threshold** because a 0.10% round-trip cost is already
inside `netR`, and an expectancy under 5% of the risk taken is not a strategy
anybody can size — it is inside the slippage that this study does not model.

**Anti-p-hacking commitments, in force from this line:**

* the holdout is computed **once**, at the end, and reported whatever it says;
* no cut, filter, threshold, or window is added after seeing holdout numbers;
* every sensitivity actually run is **listed** in `REPORT.md`, including the
  ones that looked worse, so the reader can count the comparisons;
* if the verdict is NO EDGE, the report says NO EDGE in its first paragraph.

---

## 8. Deliverables

* `DESIGN.md` (this file) — committed before results exist.
* `common.py`, `engine.py` — fork of `session-liquidity-bos/`, plus the NY
  window flag, the `h24` horizon, and the §4 trade template.
* `hypothesis.py` — the §5–§7 machinery: split, trade construction, Null A,
  Null B, bootstrap, the verdict ladder applied mechanically.
* `tables.py` — descriptive tables (house format) + the pre-registered ones.
* `checks.py` — correctness checks in the spirit of the BoS pass's 18:
  bit-identity of the take-out stream and of both confirmation streams against
  v4 / BoS; anchor causality; no re-anchoring; block containment; window-flag
  causality; trade-path/stop/cost arithmetic re-derived brute force; horizon
  containment for both horizons.
* `charts.py`, `examples.py`, `gallery.py` — the BoS pass's renderer, extended
  to draw the NY window and the trade's stop/target. **≥ 15 NY-session
  gallery panels**, both arms, BTC and ETH, under `results/gallery_ny/` with
  `GALLERY.md`.
* `MECHANIC-PROOF.md` — 6–10 hand-picked, fully captioned worked examples
  proving the level never moved and the gap was not picked retroactively.
* `REPORT.md`, `HANDOFF.md`, `RUNBOOK.md`.
* `RESEARCH-LOG.md` Запись 18 (Russian, house format), `IDEAS-BACKLOG.md`
  status update, and a new `knowledge/session-liquidity.md` subsection for the
  h24 horizon and the NY window — **added**, with the existing pinned
  definitions untouched.
