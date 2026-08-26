# Research package — multi-timeframe SMC (1h context / 5m execution)

**Role:** Researcher · **Hand-off to:** Architect (`agents/roles/architect.md`)
**Executes:** `../intraday-mr-smc/MTF-SMC-DESIGN.md` (Architect, pre-committed protocol)
**Scope:** exploratory feasibility only — not a formal backtest, not an implementation.
**Continues:** `../intraday-mr-smc/REPORT.md` (v1) and `../intraday-mr-smc-v2/REPORT.md` (v2);
nothing in either package is modified.

---

## 0. Bottom line

> **Both variants are dead at stage 1, and so is the secondary encoding of
> Variant B.** All three pre-registered rule-sets — A, B-sweep, B-choch — fail
> the signal-level probe of `MTF-SMC-DESIGN.md` §5.3 on the fit window, on
> sample sizes 14× to 250× the required minimum. Per the design doc's own rule
> ("a variant that fails stage 1 is **dead** — no backtest, no tuning to
> resurrect it"), **stages 2 and 3 were not run and the holdout window was never
> touched.**

| rule-set | best pooled mean fwd return (fit) | max t-stat | observations at h=3 | min required | §5.3 verdict |
|---|---|---|---|---|---|
| **A** — 1h bias + freshness → 5m OB/FVG retest | +1.64 bp @ 144 bars (t = **+0.65**) | +0.65 | 251,920 | 1,000 | **FAIL** |
| **B-sweep** — 1h zone → 5m sweep-and-reclaim | +1.96 bp @ 96 bars (t = **+0.98**) | +1.48 | 28,229 | 400 | **FAIL** |
| **B-choch** — 1h zone → 5m CHoCH | −0.96 bp @ 3 bars (t = **−3.94**) | −0.64 | 30,347 | 400 | **FAIL** |

The bar was "pooled mean forward return positive with **t > 2** at ≥ 2 adjacent
horizons". **No rule-set achieves t > 2 with a positive mean at a single
horizon**, let alone two adjacent ones. Variant A and B-choch are additionally
**negative-signed with significance** at the short horizons (t = −3.0 and −3.9
respectively) — i.e. these triggers do not merely fail to predict, they lean
mildly the wrong way over the first 15–60 minutes.

Three things this pass adds beyond the kill itself:

1. **The frequency-starvation failure mode did not occur.** The design's own
   frequency estimate for Variant B was 40–150 trades/symbol/year and named
   sample starvation as its main exposure (§4). Realised: **765
   trades/symbol/year** for B-sweep, **775** for B-choch, 19k+ engine trades
   pooled in fit. This matters for routing: §5.7's third branch (stage-1–2 pass
   but §5.5 fails on sample size alone → multi-zone inventory follow-up) is
   **factually unavailable**. The single-slot zone inventory was not the binding
   constraint; the absent edge was.
2. **The cost-in-R warning of §0 is confirmed and is larger than assumed.**
   Measured off realised stop distances, median `cost_R` is **0.203 (A)**,
   **0.142 (B-sweep)**, **0.089 (B-choch)** — versus v1's 1h figure of 0.037.
   A 5m structural stop makes a round-trip fee worth **2.4× to 5.5× more in R**
   than the 1h stop did. §3 prices what that means.
3. **The probe harness was validated in both directions** before the kill was
   accepted (§2.4): it reproduces v1's measured zero for single-timeframe `smc`
   at 1h and recovers v2's positive sign for `momentum_breakout` at 1h, using
   the same code path and the same resampled 1h frame this package derives.

---

## 1. What was built and how (§1–§3 of the design)

### 1.1 Data (§1.1)

Binance USD-M perpetual klines, **5m interval, all 8 symbols**
(BTC / ETH / SOL / BNB / XRP / DOGE / ADA / LINK), `2022-08-01 → 2026-07-31`,
from the same public `data.binance.vision` monthly bulk archive as v1/v2 (no
credentials). A fresh 5m pull was required for BNB/XRP/DOGE/ADA/LINK (v2 had
only pulled 1h for those five).

**420,768 complete 5m bars per symbol, 8/8 symbols, no gaps** — exactly
`1,461 days × 288`, so the archive is complete over the window. `fetch_mtf.py`
reuses `fetch_data.py:build` from v1 verbatim; only the symbol/interval set and
the output directory differ.

**1h bars are derived by resampling the 5m frame** (`mtf.resample_h1`), never
pulled separately, so the two timeframes cannot disagree about a print (§1.2).

### 1.2 Timeframe alignment (§1.2) — and the checks that it is causal

`mtf.add_htf_context()` generalises v1's `strategies.py:add_htf_bias()` from one
column to fifteen: resample 5m → 1h with `htf_mult = 12`, run
`indicators.structure(k=2)` and a 14-period ATR on the 1h frame, `shift(1)`
**every** derived column, then `merge_asof(..., direction="backward")` onto the
5m frame. Merged columns: `h1_bias, h1_bos, h1_choch, h1_swing_high,
h1_swing_low, h1_ob_low/high/dir, h1_fvg_low/high/dir, h1_sweep, h1_atr`, plus
`h1_bos_recent_up/dn` (the §2.1 freshness flags, computed as a 24-bar rolling
max over the **already-shifted** 1h BOS column).

`checks.py` verifies, and all four pass:

| check | result |
|---|---|
| every 5m bar carries the structure state of the **previous completed** 1h bar | **0 / 4,000** mismatches |
| the merged state is not accidentally the concurrent 1h bar | differs on 181 / 4,000 sampled bars (a sticky column, so it agrees most of the time by construction — but it does differ, i.e. no same-bar leak) |
| prefix stability: truncating the frame's future changes no earlier signal (A) | **identical** over 300,000 bars |
| prefix stability (B, stateful zone machine) | **identical** over 300,000 bars |

Three lags are stacked and all are deliberate (§5.6): 5m fractals confirm `k = 2`
bars late, 1h fractals confirm 2 **1h** bars late, and the 1h merge adds its own
one-bar lag. Any live version must reproduce all three.

### 1.3 Variant A (§2)

Long (short is the exact mirror): `h1_bias == +1` **and** a 1h BOS up within the
last 24 completed 1h bars, **and** 5m `bias == +1`, **and** this 5m bar trades
into the active 5m bullish OB or FVG (`low <= ob_high and close > ob_low`, or the
FVG equivalent). Stop `min(zone_low, bar.low) − 0.25 × atr_5m`; **fixed 3R**
target; 144-bar (12h) time stop. This is v1's `smc()` entry verbatim with the
directional layer moved to 1h — deliberately, so any difference is attributable
to the timeframe split and nothing else. **No parameter was scanned.**

### 1.4 Variant B (§3)

Three 1h zone types per direction — **OB** (`h1_ob_dir`), **FVG**
(`h1_fvg_dir`), **LIQ** (`h1_swing_low ± 0.25 × h1_atr` for longs, the swing-high
mirror for shorts) — each single-slot per §3.1 (no multi-zone inventory in this
pass). A 5m bar overlapping an active zone opens a **36-bar (3h) entry window**;
the window closes early on 1h mitigation or on a close beyond the far side by
> 0.5 × h1_atr. Inside the window, two **separately evaluated** trigger
encodings (never OR-ed, per §3.2.3):

* **primary / sweep** — `d5.sweep == +1` with close ≥ `z_lo`
* **secondary / CHoCH** — `d5.choch == +1`

Stop behind both the zone boundary and the local 5m extreme, minus
0.25 × atr_5m. Target = nearest opposing 1h liquidity (`h1_swing_high` for
longs), 3R fallback, **capped at 6R**. One entry per zone per direction; a zone
is consumed on entry, on window expiry, or on zone failure. **No parameter was
scanned.**

**Two implementation decisions the design left open**, both recorded here because
they are the only places I had to choose:

* *Zone identity.* The one-entry-per-zone rule needs to know when a zone is
  "new". OB/FVG bands are fixed at creation, but a LIQ band is re-derived every
  bar as `swing ± 0.25 × h1_atr`, so its numeric bounds drift with ATR while the
  zone is unchanged. Identity is therefore keyed on the **swing level** for LIQ
  and on the band low for OB/FVG (`mtf.zone_identity`). Keying it on the band
  would have silently re-armed every LIQ zone every hour and inflated the trade
  count.
* *Degenerate structural targets.* §3.3 specifies a fallback only when
  `h1_swing_high` is NaN. It can also be **below** the entry (an unbroken swing
  high that price has since traded above without a close-based BOS). Those cases
  take the same 3R fallback. Affected: a minority of signals; the direction of
  the effect is to make Variant B *more* favourable, not less.

### 1.5 Engine and risk rules (§1.3) — unchanged from v1

`backtest.py:run` verbatim: 1% equity risk sized off the stop, 2%-of-UTC-day
circuit-breaker on realised + open PnL, 5 bp/side taker fees, signal on 5m close
→ fill at next 5m **open**, stop-before-target on ambiguous bars, one position
per symbol at a time, 10× notional cap.

---

## 2. STAGE 1 — signal-level probe (§5.3). The gate everything failed.

### 2.1 Method

`edge_probe.py`'s methodology unchanged: direction-adjusted forward returns on
**non-overlapping** triggers (kept ≥ horizon bars apart), horizons **3, 6, 12,
24, 48, 96, 144** 5m bars (15 min → 12 h, covering the design's holding
horizon), pooled across all 8 symbols, **fit window only**
(`2022-08-01 → 2025-04-01`). No stops, no targets, no costs — this asks only
whether the trigger sees anything at all.

Pass bar: pooled mean forward return positive with **t > 2** at **≥ 2 adjacent**
horizons, on ≥ 1,000 observations (A) / ≥ 400 (B).

### 2.2 Results (`results/stage1_pooled.csv`)

| rule-set | h=3 | h=6 | h=12 | h=24 | h=48 | h=96 | h=144 |
|---|---|---|---|---|---|---|---|
| **A** mean bp | −0.29 | −0.52 | −0.74 | −0.80 | −0.96 | −0.80 | **+1.64** |
| **A** t | **−3.00** | **−3.04** | **−2.52** | −1.59 | −1.07 | −0.47 | +0.65 |
| **A** n | 251,920 | 158,458 | 100,990 | 64,150 | 37,919 | 20,897 | 14,411 |
| **B-sweep** mean bp | −0.04 | +0.19 | +0.09 | +0.40 | +1.82 | **+1.96** | −2.77 |
| **B-sweep** t | −0.16 | +0.53 | +0.17 | +0.51 | +1.48 | +0.98 | −0.96 |
| **B-sweep** n | 28,229 | 27,779 | 26,651 | 23,991 | 19,313 | 13,630 | 10,569 |
| **B-choch** mean bp | −0.96 | −1.49 | −1.65 | −1.39 | −1.10 | −1.28 | −3.10 |
| **B-choch** t | **−3.94** | **−4.25** | **−3.34** | −1.88 | −0.93 | −0.64 | −1.13 |
| **B-choch** n | 30,347 | 30,034 | 28,607 | 25,505 | 20,381 | 14,145 | 10,873 |

**Verdict: 0 of 3 rule-sets pass. 0 horizons out of 21 reach t > 2 with a
positive mean.**

Reading the three rows:

* **Variant A is the design's own prediction, confirmed.** §4 gave it a
  10–15% chance and called it "a noisy, worse-costed cousin of
  `momentum_breakout`". It is worse than that: over a quarter-million
  non-overlapping observations the 15-minute-to-1-hour forward return is
  **reliably negative** (t ≈ −3). Splitting the 1h bias into a separate
  timeframe did not rescue the OB/FVG retest entry — the retest's ~0 content,
  measured at 15m and 1h in v1, is a mild negative at 5m.
* **B-sweep is the honest zero.** Every horizon's mean sits inside ±2 bp with
  |t| < 1.5 on 10k–28k observations. This is the *strongest* of the three
  results and it is still nothing: the sign is right at 48–96 bars (+1.8,
  +2.0 bp) but the magnitude is one fifth of a round-trip fee and the t-stats
  never approach 2. It is a well-measured absence, not an underpowered one.
* **B-choch is the clearest negative.** A 5m CHoCH inside a 1h zone is followed
  by a mean −1.5 bp over the next 30 minutes with t = −4.25 on 30,034
  observations. Mechanically this reads as: a first counter-trend 5m break
  inside a zone is, on average, the *start* of the move against the zone, not
  the reaction to it. §3.2's question — "which mechanical reading of
  'confirmation' works, if either" — is answered: **neither, and CHoCH is the
  worse of the two.**

### 2.3 Breadth of the failure (`results/stage1_per_symbol.csv`)

Per-symbol mean forward return at h = 12 (1 hour forward), bp:

| symbol | A | B-sweep | B-choch |
|---|---|---|---|
| BTCUSDT | +0.51 | +1.39 | −1.02 |
| ETHUSDT | −0.34 | −0.12 | −2.60 |
| SOLUSDT | −0.06 | −0.54 | −0.18 |
| BNBUSDT | −0.59 | −0.13 | −2.23 |
| XRPUSDT | −0.97 | +0.12 | −1.11 |
| DOGEUSDT | −1.11 | −1.28 | −1.35 |
| ADAUSDT | −2.29 | +0.25 | −0.58 |
| LINKUSDT | −1.08 | +1.08 | −4.08 |

Negative on **7/8** for A, **8/8** for B-choch, mixed 4/4 for B-sweep with the
largest single-symbol value (+1.39 bp on BTC) still under a seventh of the
round-trip fee. Nothing symbol-specific is hiding here. (Per §5.6, 8 USDT perps
on one venue is far fewer than 8 independent tests — this uniformity is
supporting evidence for the negative, not eight confirmations of it.)

### 2.4 Why I believe the kill: harness controls (`results/stage1_controls.csv`)

A null result is only as good as the instrument. Both controls run through the
**same** `stage1.observations()` code path, the same 8 symbols, the same fit
window, on the 1h frame **this package derives from its own 5m data** (so this
also cross-checks the resampler):

| control | h=3 | h=6 | h=12 | h=24 |
|---|---|---|---|---|
| `momentum_breakout` @1h (v2's one signed positive) mean bp | +0.38 | **+3.93** | **+9.59** | −0.80 |
| `momentum_breakout` t | +0.17 | +1.21 | **+1.93** | −0.10 |
| single-TF `smc` @1h (v1's measured zero) mean bp | −0.46 | −0.10 | −1.87 | −5.11 |
| `smc` t | −0.59 | −0.07 | −0.71 | −0.99 |

The probe **recovers v2's positive sign** where v2 found one (+9.6 bp at 12h,
t = 1.93 — the largest conditional mean anywhere in this table) and **reproduces
v1's zero** for single-timeframe `smc`. The instrument works in both directions.
It is also worth noting that even v2's best rule-set does not clear t > 2 on this
probe — the §5.3 bar is strict, and I am applying the design's bar as written.

### 2.5 Stages 2 and 3 were not run — deliberately

§5.4 is explicitly "a gate to believing stage 1", and §5.5 is "only for
rule-sets passing stages 1–2". With no stage-1 survivor there is nothing to
control for and nothing to backtest. Concretely:

* The **random-direction null** (A) would ask whether the 1h bias sign carries
  the content. A's conditional mean is *negative* with t = −3.0; there is no
  positive expectancy to place inside a null.
* The **random-zone null** (B) would ask whether the 1h *location* matters, and
  §5.4 flagged the interesting alternative outcome — "if a sweep-reclaim works
  equally well at random levels, the finding is '5m sweep-reclaim has content'".
  That outcome is ruled out from the other side: the sweep-reclaim **at the true
  zones** already has no measurable content (|t| < 1.5 at every horizon), so a
  null it could beat would have to be worse than nothing, which is not a finding.
* **The holdout window (`2025-04-01 → 2026-08-01`) was not read, at all, for any
  rule-set in this package.** It remains as clean as v2 left it.

---

## 3. §5.2 cost accounting — measured, not inherited

Required by §0/§5.2 because a 5m structural stop makes fees cost more **in R**
than a 1h stop does. Measured off **realised** stop distances at every fit-window
signal (`results/cost_R.csv`), at 10 bp round-trip:

| rule-set | stop distance % of entry (q25 / **median** / q75) | `cost_R` (q25 / **median** / q75) | vs v1's 1h 0.037 |
|---|---|---|---|
| **A** | 0.242 / **0.432** / 0.778 | 0.128 / **0.231** / 0.414 | **6.2×** |
| **B-sweep** | 0.376 / **0.638** / 1.070 | 0.093 / **0.157** / 0.266 | **4.2×** |
| **B-choch** | 0.641 / **0.996** / 1.536 | 0.065 / **0.100** / 0.156 | **2.7×** |

(Trade-weighted medians from the engine replay, `results/gross_breadth_fit.csv`,
are 0.203 / 0.142 / 0.089 — the same picture.)

**What this costs, in the design's own terms.** §5.5's gross-economics bar is
"pooled gross expectancy ≥ 3 × median `cost_R`". That bar is therefore:

| rule-set | required gross expectancy | **measured gross expectancy (fit)** | shortfall |
|---|---|---|---|
| A | ≥ **+0.608 R** | **−0.057 R** | fails by 0.67 R |
| B-sweep | ≥ **+0.425 R** | **+0.003 R** | fails by 0.42 R |
| B-choch | ≥ **+0.267 R** | **−0.023 R** | fails by 0.29 R |

B-sweep's gross expectancy of **+0.0025 R over 19,336 trades** is the cleanest
single number in this package: the trade event is real, the payoff geometry
works as designed, and the edge is **zero to three decimal places** — about 170×
below what the cost structure demands.

**The cost also shows up directly in the realised loss size.** Median realised
R on a losing Variant A trade is **−1.19 R**, not −1.00 R. That 0.19 R overshoot
is not slippage or a sizing bug — it is the round-trip fee expressed in R, and it
matches the measured median `cost_R` of 0.203 almost exactly. §0's warning was
correct and its magnitude was, if anything, understated.

---

## 4. §5.5 diagnostics (post-mortem)

These are computed **fit-window only**, for documentation. They cannot change the
stage-1 verdict and are not an attempt to resurrect anything; no parameter was
varied to produce them. Sources: `results/engine_fit.csv`,
`results/gross_breadth_fit.csv`, `results/trades_fit_*.csv`,
`results/zone_type_split.csv`, `results/side_split.csv`.

### 4.1 Frequency, skips, breaker, hold time

| | **A** | **B-sweep** | **B-choch** |
|---|---|---|---|
| raw signals (fit, 8 symbols) | 561,665 | 28,531 | 30,424 |
| engine trades (fit) | 18,585 | 16,319 | 16,542 |
| **skipped-signal rate** | **96.7%** | **42.8%** | **45.6%** |
| **trades / symbol / year** | 871 | **765** | 775 |
| **breaker-bind frequency** (days halted / days) | **52.3%** | **38.8%** | **24.0%** |
| **median hold time** | **0.75 h** | **2.0 h** | 3.25 h |
| win rate | 25.9% | 32.4% | 42.6% |
| net PF (median across symbols) | 0.67 | 0.69 | 0.74 |
| net expectancy | −0.381 R | −0.202 R | −0.142 R |
| gross PF > 1.0 breadth | **0 / 8** | **3 / 8** | 3 / 8 |

Reading these against the design's expectations:

* **Sample size was never the problem.** §4 estimated 40–150 trades/symbol/year
  for Variant B and named starvation as the main exposure. Realised is **5–19×
  higher**. The §5.5 minimum of 300 pooled trades is cleared by a factor of 54.
  This is the single most consequential diagnostic for routing — see §6.
* **Variant A's 96.7% skip rate** is the OB/FVG-retest condition being a *state*
  rather than an *event*: price sitting inside an unmitigated zone satisfies it
  bar after bar, so A fires on ~25% of all 5m bars and the one-position-per-symbol
  rule discards almost all of them. Same property v1's `smc` had at 1h; at 5m it
  is far more pronounced.
* **The breaker binds hard, exactly as §1.3 predicted.** Variant A halts new
  entries on **more than half of all UTC days**. A meaningful part of A's equity
  profile is the breaker limiting the damage, not the rule-set behaving. This is
  the rule working as intended and no risk rule was changed — but it means A's
  net figures should be read as "with a 2%/day stop-loss applied", not as the
  rule-set's own shape.
* **Median hold 0.75 h (A) / 2.0 h (B-sweep) / 3.25 h (B-choch)** — all well
  under the ~8 h threshold in §5.6, so **unmodelled funding is not the reason
  for the negative result** and would not have rescued it. It remains unmodelled
  and would need adding before any promotion (there is none).

### 4.2 Realised R-multiple distribution (`results/trades_fit_*.csv`)

| rule-set | n | mean | p05 | p25 | median | p75 | p95 | stop / target / time |
|---|---|---|---|---|---|---|---|---|
| **A** | 18,585 | −0.381 | −1.81 | −1.39 | −1.19 | +0.21 | +2.90 | 72% / 21% / 7% |
| **B-sweep** | 16,319 | −0.202 | −1.53 | −1.22 | −1.10 | +0.63 | +2.96 | 64% / 25% / 12% |
| **B-choch** | 16,542 | −0.142 | −1.25 | −1.11 | −1.01 | +0.63 | +2.42 | 50% / 33% / 17% |

The 5m-risk / 1h-reward geometry §3 was built for **does materialise** — B's p95
is ~+3 R and its win rates (32%, 43%) sit against break-even points of ~25–33%,
so the shape is exactly the low-WR/high-R profile the design asked not to be
judged by a win-rate floor (and it was not). The shape is fine. **The
distribution is simply centred fractionally below zero before costs and clearly
below zero after them.**

### 4.3 Zone-type split (§5.5 requirement) — pooled, direction-adjusted mean bp

| encoding | zone type | n (h=12) | mean bp @ h=12 | mean bp @ h=48 |
|---|---|---|---|---|
| **B-sweep** | **FVG** | 8,869 | **+1.92** | **+2.64** |
| B-sweep | LIQ | 14,132 | −1.30 | +1.66 |
| B-sweep | OB | 6,507 | −0.83 | −1.31 |
| B-choch | FVG | 8,400 | −0.65 | +0.54 |
| B-choch | LIQ | 16,512 | −1.88 | −0.77 |
| B-choch | OB | 6,967 | −1.93 | −3.44 |

The only cell with a consistent positive sign across both horizons is
**sweep-reclaim inside a 1h FVG** (+1.9 / +2.6 bp). I am **not** presenting this
as a finding: median per-symbol t is +0.64, it is one of twelve cells examined
after the fact, and +2.6 bp is a quarter of the round-trip fee — it would fail
§5.3 on its own terms and it is exactly the kind of post-hoc subset v2 §1.3
priced at r = −0.49 between in-sample and out-of-sample improvement. It is
recorded because §5.5 asked for the split, and because if anyone ever revisits
this family, **FVG is the least-dead of the three zone types and OB is the most
dead** (negative at both horizons under both encodings).

### 4.4 Long/short split

| rule-set | side | n (h=12) | mean bp @ h=12 | mean bp @ h=48 |
|---|---|---|---|---|
| A | long | 51,891 | +0.08 | +2.23 |
| A | **short** | 49,347 | **−1.60** | **−4.02** |
| B-sweep | long | 14,027 | −0.45 | +2.37 |
| B-sweep | short | 13,945 | +0.45 | −0.26 |
| B-choch | long | 15,162 | −1.32 | −0.26 |
| B-choch | short | 15,217 | −2.12 | −2.45 |

Variant A's failure is concentrated on the **short** side (−1.6 / −4.0 bp),
which is the drift term, not a signal: a 2022–2025 fit window on crypto perps
has positive unconditional drift, and a symmetric rule that takes ~50% shorts
pays it. It is worth stating plainly that **A's long side is not positive
either** (+0.08 bp at h=12, i.e. zero) — the short leg makes the pooled number
look worse than it is, but removing it would not produce an edge, only a
long-only exposure to the drift the probe already nets out.

---

## 5. Standing caveats (§5.6)

* **Funding is unmodelled.** Median holds are 0.75–3.25 h, comfortably inside
  §5.6's ~8 h threshold, so funding is second-order here and cannot explain the
  result. Any future promotion out of this family still needs it added.
* **8 USDT perps on one venue ≈ far fewer than 8 independent tests.** The
  uniformity across symbols in §2.3 makes the *negative* more trustworthy
  (correlated samples inflate confidence, which cuts against a positive and in
  favour of a negative); it does not mean eight independent confirmations.
* **Lag discipline is mandatory and stacked three deep** (5m fractal confirm, 1h
  fractal confirm, 1h merge shift). It was verified causal in four ways (§1.2).
  Any live implementation of anything in this family must reproduce all three
  lags; removing any one of them would manufacture an edge that does not exist.
* **One encoding each.** As in v1, these are two mechanical readings of a
  discretionary practice. This pass makes the verdict on *these* encodings
  definitive at very large sample; it does not, by itself, cover every possible
  reading. §6 argues why I nonetheless think the family is now answered.
* **What I did not do:** no parameter was scanned (the design's pre-registered
  mini-scan in §2.4 is gated on the probe passing, which it did not); the
  multi-zone inventory of §3.1 was not built; the holdout was not read.

---

## 6. §5.7 DECISION GATE — outcome and routing

**The outcome that occurred is the design doc's first branch, in its strongest
form:**

> *"Both variants fail stage 1 or 2 → the MTF re-encoding question is answered;
> SMC-as-entry is retired in full."*

Both variants failed **stage 1** — the earliest and cheapest gate — and so did
Variant B's secondary encoding, on 21 of 21 horizon tests, with sample sizes 14×
to 250× the pre-committed minimums. Applying the doc's own routing rules:

* **Retire SMC-as-entry in full.** This is my recommendation, and it is the only
  branch the results support. `ARCHITECT-NOTE.md` §2.2 kept one escape hatch
  open — that the v1 verdict covered *one encoding*, not the encoding family.
  This pass spent that hatch on the two encodings the Architect judged most
  likely to work, including the sweep-as-trigger inversion §2.3 ranked as the
  most promising structural redesign, and both are dead at the signal level.
  Combined with v1 (46,045 obs at 1h, −0.03 bp) and this pass (310,000+ obs at
  5m across three rule-sets), SMC-as-entry has now been measured at 15m, 1h, and
  5m, single-timeframe and multi-timeframe, as trigger and as context, on 8
  symbols over 4 years. It is a zero.
* **Promote to Backtesting role:** not available. No rule-set passed §5.5; none
  passed §5.3.
* **One multi-zone follow-up (§5.7 branch 3):** **not available, and I want to
  be explicit that this is a factual exclusion rather than a judgment call.**
  That branch is conditioned on "stage 1–2 pass but §5.5 fails on sample size
  alone". Stage 1 did not pass, and sample size was never close to binding —
  765 trades/symbol/year against a 40–150 estimate, 19k+ pooled trades against a
  300 minimum. The multi-zone inventory exists to raise event frequency; raising
  the frequency of an event whose forward return is 0.0025 R gross produces more
  of nothing. I recommend against building it.

**For the Critique & Refinement second opinion** (`ARCHITECT-NOTE.md` §4 step 1,
if still undispatched): the doc anticipated it shrinking to "were these
encodings representative?". My input to that question: the three encodings now
measured span the two axes that were actually in dispute — *what the SMC layer
supplies* (direction in A, location in B) and *what the trigger event is*
(retest in A, sweep-failure in B-sweep, structure-shift in B-choch). The one
axis genuinely untested is a **discretionary** reading of these concepts, which
is not mechanisable and therefore not researchable in this pipeline.

**What I would carry forward instead** (unchanged from v2's ranking, and this
pass adds one supporting data point): the only signed-positive thing in the
harness remains `momentum_breakout` — this package's own control reproduced it
independently at +9.6 bp / t = 1.93 at 12h on 8 symbols. It is still not a
business at retail taker cost, and note that on this pass's strict probe it too
would not clear t > 2. That is the honest state of the portfolio.

---

## 7. Reproducing this package

```bash
python -m venv .venv && .venv/bin/pip install pandas numpy   # repo root
cd research/intraday-mtf-smc
python fetch_mtf.py        # 8 symbols x 5m x 48 months from data.binance.vision (no key)
python prep.py             # cache 5m structure + 1h context per symbol (~12s total)
python checks.py           # causality / lag / prefix-stability checks -- run this first
python stage1.py           # STAGE 1 probe (the gate). Writes results/stage1_*.csv
python control_probe.py    # harness positive + negative controls
python diagnostics.py      # §5.2 cost_R and §5.5 post-mortem diagnostics (fit only)
python gross_check.py      # gross expectancy / breadth vs the §5.5 bar (fit only)
python smoke_controls.py   # §5.4 helpers execute correctly (stage 2 was never reached)
```

| file | what it is |
|---|---|
| `fetch_mtf.py` | 5m data pull, reuses v1's `fetch_data.build` verbatim |
| `common.py` | paths, symbol list, fit/holdout windows, cost constant |
| `mtf.py` | §1.2 alignment, §2 Variant A, §3 Variant B, permutation-control helpers (unused — stage 2 not reached), `sim_R` replay |
| `prep.py` / `rulesets.py` | prepared-frame and signal caches |
| `stage1.py` | the §5.3 probe |
| `checks.py`, `control_probe.py` | correctness and instrument validation |
| `diagnostics.py`, `gross_check.py` | §5.2 / §5.5 post-mortem |
| `smoke_controls.py` | proves the §5.4 permutation helpers run (nulls not used as evidence) |

`mtf.random_direction_bias()` and `mtf.offset_zones()` implement the §5.4
permutation controls. Stage 1 gated the nulls out as a protocol step, so they
were **never run as evidence**; `smoke_controls.py` executes both to prove they
work and to leave a note for whoever picks them up:

* random-direction preserves every bias regime's extent (zero-bars identical,
  sign flipped on 48% of non-zero bars, as expected) and yields 21,211 Variant A
  signals against the true 28,788 on the sample tested;
* random-zone preserves width and lifetime for all six (type, direction) slots
  exactly, but displaced zones are **touched less often** — 590 Variant B signals
  against the true 1,435. That is a real selectivity gap, so a future stage-2 run
  must compare **expectancy in R** (a per-trade statistic), not PF or total PnL,
  or re-draw offsets until trade counts match. `mtf.sim_R()` exists for exactly
  that comparison.

---

## 8. Pros and cons, in the Researcher-role format

**Pros of the MTF-SMC idea as designed**

* The design was genuinely falsifiable and pre-committed, and it falsified
  cleanly and cheaply — total compute for a decisive answer was under a minute
  of CPU after the data pull.
* Variant B's payoff geometry (5m risk, 1h structural reward) **worked as
  intended**: realised p95 ≈ +3 R against 32–43% win rates. If an entry with
  content is ever found on 5m, this geometry is worth reusing.
* Zone-touch frequency is abundant, not scarce — the single-slot inventory
  limitation was never binding.

**Cons / what made me doubt it**

* The core claim ("1h zones are where reactions happen") is not measurable as an
  edge at 5m under any of the three encodings, and the failure is uniform across
  8 symbols and 4 years.
* The cost structure is punishing and was the thing most underestimated going
  in: a 5m structural stop makes a retail round-trip fee worth 0.09–0.23 R.
  Any 5m entry in this family needs a **large** gross edge before it is even
  interesting, and the measured edge is 0.003 R.
* Variant A is a state, not an event (96.7% of its signals are discarded by the
  position rule), which makes its trade selection an artifact of *when a
  position happened to be flat* rather than of the rule. Any future rule in this
  family should fire on a transition, not on a condition.
* The one mildly encouraging cell (sweep-reclaim inside a 1h FVG) is exactly the
  shape of the post-hoc subset v2 measured as anti-predictive, and I do not
  believe it.

---

## 9. Hand-off

To the **Architect**. The decision gate is §5.7 branch 1 — *retire SMC-as-entry
in full*; branches 2 and 3 are factually unavailable, with the reasons stated in
§6. The holdout window is unread by this package and remains available. Full
per-stage numbers are in `results/`.
