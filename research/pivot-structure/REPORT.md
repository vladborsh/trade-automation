# Research package — two-tier pivot structure (major/minor CHoCH)

**Role:** Researcher · **Hand-off to:** Architect (`agents/roles/architect.md`)
**Executes:** `DESIGN.md` (Architect, pre-committed protocol) — phase 1, one pass.
**Scope:** exploratory feasibility only — not a formal backtest, not an implementation.
**Continues:** `../intraday-mtf-smc/REPORT.md` (the pass that retired SMC-as-entry),
`../intraday-mr-smc/REPORT.md` (v1), `../intraday-mr-smc-v2/REPORT.md` (v2).
Nothing in any of those packages is modified — in particular `indicators.py`'s
retired `structure()` state machine is untouched, and the new primitive lives in
this package's own `pivot.py`.

---

## 0. Bottom line

> **The flip event is dead at stage 1, everywhere in the grid.** All 48
> pre-registered cells — flip and retest event classes × 12 (K, k) combos ×
> Mode S and Mode M — **fail** the `DESIGN.md` §6 stage-1 bar on the fit
> window. The primary config (K=15, k=4, Mode S) is not merely flat but
> **significantly negative**: −32.3 bp at 24 h, t = **−4.73**, on 3,523
> de-overlapped observations. Per the design's own kill rule, **stage 3 was not
> run against the economic bar and the holdout window was never read.**

| event class | mode | best pooled mean (fit) | max t | min t | obs at h=3 | min required | §6 verdict |
|---|---|---|---|---|---|---|---|
| **flip** (arms E1-*), K=15 k=4 | S | −1.99 bp @ 12 bars (t = −0.43) | **−0.43** | −4.73 | 5,141 | 1,000 | **FAIL** |
| **retest** (arm E2-T2), K=15 k=4 | S | +1.73 bp @ 12 bars (t = +0.39) | **+0.39** | −4.01 | 4,631 | 1,000 | **FAIL** |
| **flip**, all 12 (K, k) | S | — | **−0.40** | −4.73 | up to 8,315 | 1,000 | **0/12 PASS** |
| **retest**, all 12 (K, k) | S | — | **+0.72** | −4.01 | up to 7,528 | 1,000 | **0/12 PASS** |
| **flip**, all 12 (K, k) | M | — | **+1.08** | −4.12 | up to 107,528 | 1,000 | **0/12 PASS** |
| **retest**, all 12 (K, k) | M | — | **+0.73** | −4.49 | up to 98,982 | 1,000 | **0/12 PASS** |

The bar was "pooled mean positive with **t > 2** at ≥ 2 adjacent horizons, on
≥ 1,000 flips". **No cell reaches t > 2 with a positive mean at even one
horizon.** There is no interior region to fall back on (§6's second clause):
the grid is uniformly signed, so there is not an isolated passing cell to
distrust — there is no passing cell at all. **Kill rule fires.**

Four things this pass adds beyond the kill:

1. **The k-scale dimension — the genuinely novel content of the idea (§0.2 of
   the design) — was measured and is not the missing ingredient.** Structure
   defined on 2-, 3-, 4- and 5-bar minor pivots against 10-, 15- and 20-bar
   major pivots behaves the same as `k=2` did: flat-to-negative, monotone in
   nothing, with the pooled mean sitting between −9.3 and −5.6 bp (median
   across horizons) at every k in Mode S. Larger swings do not rescue the
   family. §2.3.
2. **Flip location is not noise — it is actively adverse.** The §6 stage-2
   random-flip control was run anyway (§3): against 200 draws that preserve
   flip count and strict direction-alternation while destroying location, the
   real flip set lands at the **0th percentile** of the null at 3 h and 24 h
   and the 0.5th at 48 h. A coin flip placed at random bars would have done
   materially better. This is the same shape as the retired `B-choch` result
   and is the strongest single argument that the minor-CHoCH flip is a
   *late-entry* event, not an information event.
3. **The `K` degeneracy the design predicted (§1.2) is confirmed exactly.** In
   every probe and in the fixed-RR arm, the three `K` columns are identical to
   3 significant figures (e.g. flip @ h=6, k=4: −7.630 / −7.596 / −7.651 bp for
   K = 10 / 15 / 20). The design called this in advance and asked that it not
   be read as a robustness finding; it is not one. §2.4.
4. **One arm came out positive, and it is the arm the design expected to
   lose.** Control arm **C1** — option (b), "the minor flip only *arms* the
   trade; entry requires a subsequent close beyond a major swing" — is the only
   cell in the whole pass with positive fit expectancy (+0.036 R net,
   net PF 1.13, gross PF > 1 on **8/8** symbols, 1,970 trades). §5 dissects it:
   it **still fails the stage-1 bar** (one horizon at t > 2, not two adjacent),
   and an attribution probe shows the sign belongs to the **bare major-break
   event**, not to the two-tier machinery. §3.1's architectural claim ("(b)
   reconstructs the retired BOS engine with an extra warning light") is
   therefore **half falsified**: (b) does beat (a), because the thing (b) adds
   is the only event in this design with a positive sign, and (a)'s flip is a
   drag on it. That is a routing finding, not a rescue.

---

## 1. What was built and how (§1–§4 of the design)

### 1.1 Data (§6)

Reuses the `intraday-mtf-smc` package's existing 5m pull verbatim — no re-pull.
Binance USD-M perpetual klines, 5m, all 8 symbols, **420,768 bars/symbol**,
`2022-08-01 → 2026-07-31`. 1h bars are derived by resampling with the same
helper (`strategies._htf_rule` + `resample`) that package used, giving 35,064
1h bars/symbol.

Windows exactly as pre-committed: **fit** `2022-08-01 → 2025-04-01`,
**holdout** `2025-04-01 → 2026-08-01`. Everything in this report is fit-only.
**The holdout was never read by any script in this package.**

### 1.2 The new primitive `pivot_structure(df, K, k)` (§1.1)

`pivot.py`, module-level, built on `indicators.fractals()` only. `indicators.py`
is imported unchanged; `structure()` is not called anywhere in this package.

* `major_track(df, K)` — last confirmed, still-unbroken major swing `MH` / `ML`,
  cleared on a close beyond, plus `mbias` (the major-break bias) and `mbreak`
  (the +1/−1 break event bar). Non-gating by §3.1: it initialises `B` and
  supplies the T2 target reference, nothing else.
* `pivot_structure(df, K, k)` — one causal pass. Minor fractals at half-width
  `k`; `B = 0` until the first close beyond a confirmed major swing; thereafter
  **the first close beyond the current confirmed minor swing against `B` flips
  `B` on that bar** and emits `flip = ±1`. The broken minor swing is cleared,
  the leg extreme `X` resets, and `flip_X` records the extreme the market just
  failed to sustain (the stop reference). Asserts `k < K`.
* `build(df, K, k, mode)` — Mode S computes both tiers on the same frame;
  Mode M merges the 1h major state onto native 5m bars through the
  `mtf.add_htf_context` pattern (resample ×12 → `shift(1)` every derived
  column → `merge_asof` backward), i.e. a 5m bar only ever sees the last
  **completed** 1h bar.

### 1.3 Causality checks — all pass (`checks.py`)

The design marks these as required. Output, BTCUSDT, K=15 k=4:

```
check1 Mode S prefix-stability over ['B','flip','MH','ML','mh','ml','X']: True
check2 flips whose broken level is not a <=i-confirmed fractal: 0/989
check3 flips without a close beyond the broken minor swing:     0/989
check4 Mode M one-bar-lag mismatches: 0/4000
       (agrees with CONCURRENT 1h bar 3964/4000 — sticky col, must be < 4000)
check5 Mode M flip prefix-stability: True
check6 E1-T1 / E1-T2 / E2-T2 / C1 signal prefix-stability: True (all four)
check7 BTCUSDT 1h K=15 k=4: 989 flips (247/yr), long share 0.50, alternating=True
```

Check 2 is the specific one §1.1 asked for ("a flip at bar i must use only
minor swings confirmed at or before i"): every broken level is traced back to a
fractal extreme whose confirmation bar is ≤ i. Check 7 confirms flips strictly
alternate direction, as the state machine requires.

### 1.4 Rule-sets (§4) and the one engine extension

`pivot.ruleset(df, ps, arm, mode)` implements the four pre-registered arms with
every buffer, window and cap frozen as written (`pivot.P`): stop behind the
flip-time leg extreme buffered 0.25 × atr; T1 = fixed 2R; T2 = opposing major
swing with a 3R fallback and a 6R cap; E2 retest band 0.25 × atr within 12 bars
(S) / 36 bars (M); time stops 48 × 1h (S) / 288 × 5m (M).

**C1's entry trigger.** The design says "a close beyond the major swing level in
the flip direction after the minor flip and before entry", with no window. It is
implemented as the `mbreak` event (the bar on which that close happens — the
level itself is cleared by the break, so testing `close > MH` after the fact
would never fire), and the arming expires at the next opposite flip. This is the
only implementation choice the design left underspecified; it is recorded here
rather than resolved by tuning.

**Opposite-flip exit (`engine.run_flip`).** `backtest.py` stays frozen, so the
mandated extension lives in this package as a copy of `backtest.run` plus four
lines: a flip against the open position on bar i−1 closes it at bar i's **open**,
before stop/target/time are considered. `smoke_engine.py` verifies the design's
requested no-position case:

```
smoke1 flip=None reproduces backtest.run exactly: True (543 vs 543 trades)
smoke2 with the flip exit: 980 trades — flip 546, stop 169, time 144, target 120
smoke4 no overlapping / inverted trades: True
```

Risk rules unchanged: 1% of equity per trade sized off the stop, 2%-of-UTC-day
circuit breaker, 5 bp/side taker, next-bar-open fills, stop before target on
ambiguous bars.

---

## 2. STAGE 1 — the flip-event probe (§6). The gate everything failed.

### 2.1 Method

Identical to v1's `edge_probe.py` and the MTF pass's `stage1.py`, reused as a
code path: direction-adjusted forward returns on **non-overlapping** events
(kept ≥ horizon bars apart), no stops, no targets, no costs. Horizons 3–48 bars
(Mode S) and 3–144 bars (Mode M, adding 96/144 as the design specifies). Two
event classes probed separately: the flip itself, and the E2 retest touch (taken
from the arm's own entry bars, so probe and arm cannot disagree about what the
event is).

### 2.2 Primary config, pooled, fit window (`results/stage1_pooled.csv`)

**K = 15, k = 4, Mode S — the pre-declared primary:**

| kind | horizon (1h bars) | n | mean bp | t | hit rate |
|---|---|---|---|---|---|
| flip | 3 | 5,141 | **−5.74** | **−2.32** | 0.438 |
| flip | 6 | 4,942 | **−7.60** | **−2.36** | 0.456 |
| flip | 12 | 4,510 | −1.99 | −0.43 | 0.480 |
| flip | 24 | 3,523 | **−32.34** | **−4.73** | 0.458 |
| flip | 48 | 2,428 | **−24.35** | **−2.19** | 0.470 |
| retest | 3 | 4,631 | −1.89 | −0.92 | 0.479 |
| retest | 6 | 4,470 | −2.29 | −0.72 | 0.481 |
| retest | 12 | 4,111 | +1.73 | +0.39 | 0.500 |
| retest | 24 | 3,244 | **−27.60** | **−4.01** | 0.462 |
| retest | 48 | 2,285 | −19.88 | −1.72 | 0.480 |

Sample is **5.1× the pre-committed 1,000-flip minimum** at the shortest horizon.
This is a measured negative, not an underpowered one. The hit rate is below 0.50
at every horizon for both classes — the flip does not merely fail to lead, it
leans the wrong way, and the magnitude at 24 h (−32 bp, roughly 3× a
round-trip fee) is the single worst number in the pass.

**Mode M, K = 15, k = 4** is a flat zero rather than a negative — mean between
−1.71 and +0.02 bp, |t| ≤ 0.95 at all seven horizons, on 13k–65k observations.
Earlier detection on 5m closes does not find an edge that the 1h close missed;
it finds the same nothing, more often, at 4× the cost in R (§4).

### 2.3 The whole grid (`results/stage1_verdict.csv`) — 0/48

| mode | kind | cells | passing | worst t | best t | pooled median mean bp (range across cells) |
|---|---|---|---|---|---|---|
| S | flip | 12 | **0** | −4.73 | −0.40 | −9.34 … −5.58 |
| S | retest | 12 | **0** | −4.01 | +0.72 | −4.57 … −2.27 |
| M | flip | 12 | **0** | −4.12 | +1.08 | −0.72 … −0.15 |
| M | retest | 12 | **0** | −4.49 | +0.73 | −1.16 … −0.13 |

The k-sweep is the part of this that answers the actual open question. Reading
Mode S flip down the k axis (pooled median mean, any K): k=2 ≈ −5.8 bp,
k=3 ≈ −9.2, k=4 ≈ −7.6, k=5 ≈ −5.6. No trend, no sign change, no cell better
than "significantly negative at some horizon". **The k-scale hypothesis is
measured and rejected**: it was the one genuinely untested axis in this family
(everything in v1/v2/MTF ran at k=2), and enlarging the swings changes nothing
about the sign.

### 2.4 The predicted `K` degeneracy — confirmed (§1.2)

The design warned that outside the T2 arm, `K` cannot matter, and asked that
identical columns not be read as robustness. They are identical:

```
flip, Mode S, k=4, h=6:   K=10 −7.630 bp | K=15 −7.596 bp | K=20 −7.651 bp
flip, Mode S, k=2, h=3:   K=10 −5.617    | K=15 −5.804    | K=20 −5.739
E1-T2 fit trades, k=4:    K=10  5,163    | K=15  5,163    | K=20  5,154
```

The residual differences are warm-up bars only. Recorded as the design asked:
**this is arithmetic, not evidence.**

### 2.5 Why I believe the kill: harness validated both ways (`results/stage1_controls.csv`)

Run before the kill was accepted, through the same `observations()` code path,
same 8 symbols, same fit window, on the 1h frame this package derives itself:

| control | h=3 | h=6 | h=12 | h=24 |
|---|---|---|---|---|
| `momentum_breakout` (v2's positive) | +0.38 bp (t=0.17) | +3.93 (t=1.21) | **+9.59 (t=1.93)** | −0.80 (t=−0.10) |
| single-TF `smc` @ 1h (v1's zero) | −0.46 (t=−0.59) | −0.10 (t=−0.07) | −1.87 (t=−0.71) | −5.11 (t=−0.99) |

These reproduce the MTF pass's control table to three decimals, which also
cross-checks this package's resampler against that one. The probe recovers a
positive sign where one is known to exist and returns ≈0 where one is known not
to. It is not a broken instrument.

### 2.6 Stage 3 was not run against the economic bar — deliberately

§6's kill rule: *"stage-1 failure at the primary config **and** no credible
interior region ⇒ the two-tier pivot engine is dead as an entry engine — no
backtest, no tuning."* Both clauses hold (0/48, uniform sign). Accordingly:

* the §6 economic bar (≥300 trades, gross expectancy ≥ 3 × cost_R, net PF ≥ 1.1,
  gross PF > 1 on ≥5/8) was **not applied as a promotion test**;
* the **holdout window was never read** — it remains as clean as the MTF pass
  left it;
* nothing was tuned. Every buffer, window, cap and time stop is as written in
  §4.

What *was* run on the fit window is the §5 diagnostic set (§4 below) and the §6
stage-2 permutation control (§3) — both as post-mortem, because the design lists
them as required and because they are what tells a future pass *how* this failed.

---

## 3. STAGE 2 control, run post-mortem — the flip is worse than random (`results/stage2_permutation.csv`)

200 draws, primary config, fit window. The null preserves each symbol's flip
**count** and the strict **alternation** of direction, and destroys only
**location** (uniform random bars inside the fit window) — exactly the §6
construction.

| horizon | real mean bp | real t | null mean bp | null 90th pct | beats p90? | real's percentile in the null |
|---|---|---|---|---|---|---|
| 3 | −5.74 | −2.32 | +0.20 | +2.77 | no | **0.0** |
| 6 | −7.60 | −2.36 | −0.14 | +3.35 | no | **1.5** |
| 12 | −1.99 | −0.43 | −0.02 | +6.77 | no | 38.0 |
| 24 | −32.34 | −4.73 | +1.26 | +11.06 | no | **0.0** |
| 48 | −24.35 | −2.19 | −0.39 | +14.65 | no | **0.5** |

The real flip set is not merely below the 90th percentile — at three of five
horizons it is at or below the **1st**. Flip location carries information; the
information is that price has already moved and is about to keep moving *against*
the flip direction over the next few hours. That is the signature of a late
entry, which is precisely the failure mode §3.2 anticipated for flip-close
entries ("it buys after an impulsive break") and which the E2 retest arm was
pre-registered to test. E2 does not fix it: the retest event is flat at short
horizons and equally negative at 24 h.

---

## 4. §5 diagnostics (post-mortem, fit window only, `results/diagnostics_fit.csv`)

All four arms run through `engine.run_flip` on the fit window at the primary
config. **These are not a stage-3 evaluation** — no arm is being judged against
the promotion bar and no holdout number exists.

| mode | arm | trades | skipped | long share | net exp R | gross exp R | long R | short R | WR | net PF | cost_R | 3× bar | median hold | breaker bind |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S | E1-T1 | 5,159 | 0.6% | 0.501 | −0.023 | +0.008 | −0.010 | −0.036 | 0.360 | 0.94 | 0.026 | 0.078 | 24 h | 0.8% |
| S | E1-T2 | 5,163 | 0.6% | 0.500 | −0.040 | −0.009 | −0.031 | −0.049 | 0.475 | 0.87 | 0.026 | 0.078 | 16 h | 0.5% |
| S | E2-T2 | 4,642 | 0.5% | 0.500 | −0.028 | +0.007 | −0.009 | −0.047 | 0.437 | 0.91 | 0.028 | 0.085 | 16 h | 0.6% |
| S | **C1** | 1,970 | 0.0% | 0.509 | **+0.036** | **+0.055** | +0.047 | +0.025 | 0.355 | **1.13** | 0.016 | 0.049 | 27 h | 0.0% |
| M | E1-T1 | 38,597 | 41.5% | 0.496 | −0.133 | −0.005 | −0.135 | −0.130 | 0.306 | 0.70 | 0.101 | 0.304 | 1.9 h | 48.1% |
| M | E1-T2 | 36,805 | 44.2% | 0.495 | −0.147 | −0.018 | −0.139 | −0.155 | 0.302 | 0.69 | 0.103 | 0.309 | 2.0 h | 50.1% |
| M | E2-T2 | 35,076 | 43.2% | 0.495 | −0.156 | −0.009 | −0.151 | −0.161 | 0.289 | 0.68 | 0.110 | 0.331 | 1.8 h | 49.8% |

### 4.1 Frequency (§5)

The design estimated "low hundreds of flips/symbol/year" at 1h, k=3–5, and said
the estimate was not load-bearing. Realised, fit window: **240 flips/symbol/year**
at k=4 and **388** at k=2 (Mode S) — the estimate was accurate. Mode M runs
**3,061/symbol/year** at k=4. Sample starvation never came close to being the
binding constraint; as in the MTF pass, the failure mode is absent edge.

### 4.2 Cost accounting (§5, `cost_R` off realised stops)

Median `cost_R`, measured off the realised stop distance of each trade:

* **Mode S: 0.026** — *better* than v1's 1h figure of 0.037, because the stop
  sits behind the leg extreme rather than a tight structural level. The §6 gross
  bar (3 × cost_R) is therefore only **+0.078 R**. E1-T1 and E2-T2 clear it in
  *sign* (+0.008, +0.007 gross) but fall an order of magnitude short in size,
  and E1-T2 is gross-negative.
* **Mode M: 0.101–0.110** — squarely inside the 0.089–0.231 band the MTF pass
  measured for 5m-scale stops, **3.9× Mode S**. The gross bar rises to +0.30 R
  against a measured gross expectancy of −0.005 to −0.018 R. The design's §2
  warning that Mode M's cost multiplier is "exactly the fee that killed the last
  package" is confirmed; Mode M was never in contention on economics even before
  the probe.

### 4.3 Breaker bind, holds, and the funding flag (§5)

* **Breaker bind** is negligible in Mode S (0.0–0.8% of UTC days) but binds on
  **~50% of days in Mode M**. The design predicted clustered stop-outs would make
  it bind; at 5m it binds constantly, which by itself makes Mode M's engine
  numbers unrepresentative of the rule-set (half its days are truncated).
* **Median hold is 16–27 h in Mode S** — well past the design's own ~8 h
  threshold. **Funding is unmodelled and would have to be added before any
  promotion of anything in this shape.** It cannot explain the negative sign
  (funding is a cost, and gross expectancy is already ≈0), but it is a real
  further drag on the one positive cell (C1, 27 h median hold), and §5 asked for
  it to be flagged either way.
* **Skipped-signal rate**: 0.5–0.6% in Mode S (essentially every flip trades),
  **41–44% in Mode M** — the engine is in a position when the next flip arrives,
  because flips at 5m come faster than trades resolve.
* **E2's missed-trade rate** (the arm's pre-registered cost): 115 of 989 armed
  flips on BTCUSDT never see the retest band inside 12 bars — **11.6%**. Patience
  costs about one trade in nine and buys nothing measurable.

### 4.4 Realised R distribution and long/short split (§5)

R-quantiles are the shape the design expected and confirm the engine mechanics
are sane: Mode S E1-T2 p10 = −1.02 R, median = −0.06 R, p90 = +0.86 R; E1-T1
p10 = −1.03, median = −0.26, p90 = +1.93 (the fixed-2R arm's fatter right tail).
The p10 overshoot beyond −1 R is the fee, as in the MTF pass.

**Long/short**, the diagnostic §5 specifically required because the fit window
has positive crypto drift: the engine takes a **50.0/50.1% split** and *both*
sides are negative in every non-C1 arm — Mode S E1-T2 is −0.031 R long and
−0.049 R short. Drift is not masking anything; the shorts are only slightly
worse than the longs, which is what drift alone would produce on top of a zero.

---

## 5. The one anomaly: control arm C1 (`results/c1_*.csv`, `results/major_break_probe.csv`)

C1 is the arm the design ran to **falsify §3.1's architectural claim** at the
cost of one config, and it is the only positive cell in the pass. It deserves to
be taken seriously and then taken apart.

**What it does look like.** +0.036 R net / +0.055 R gross expectancy on 1,970
fit trades, net PF 1.13, **gross PF > 1.0 on 8/8 symbols**, both directions
positive (+0.047 long, +0.025 short), lowest cost_R in the pass (0.016), breaker
never binds. Against the §6 stage-3 fit criteria it would clear trades (1,970 ≥
300), gross expectancy (+0.055 ≥ 3 × 0.016 = 0.049), net PF (1.13 ≥ 1.1) and
breadth (8/8 ≥ 5/8).

**Why it is not a promotion.** Three reasons, in order of weight:

1. **It fails the gate that governs it.** Subjecting the C1 *entry event* to the
   same stage-1 probe (`results/c1_event_probe.csv`) gives +0.07 / +5.4 / +7.7 /
   +14.1 / **+43.6** bp at h = 3 / 6 / 12 / 24 / 48, with t = 0.02 / 1.04 / 1.11
   / 1.34 / **2.82**. That is **one** horizon above t = 2, not two adjacent —
   the §6 bar, applied to C1 exactly as it was applied to everything else,
   returns FAIL. Reading a single passing horizon as a green light is the v2
   r = −0.49 mistake the design's own interpretation rule exists to prevent.
2. **The sign does not belong to this design.** An attribution probe of the
   **bare major-break event** — a close beyond a confirmed K-bar swing, with the
   minor tier and the flip removed entirely (`results/major_break_probe.csv`) —
   is positive at every K and nearly every horizon, and at **K = 20 it clears
   t > 2 at two adjacent horizons** (h=6: +12.9 bp, t = 2.60; h=12: +15.7 bp,
   t = 2.42; n ≈ 2,500), with the sign consistent across all three K columns
   (the grid-neighbourhood credibility the design asks for). Per-symbol breadth
   at K=20 is 6/8 positive at h=6 and 7/8 at h=12, though only ETHUSDT is
   individually significant. **C1's edge survives deletion of the two-tier
   machinery.** The flip conditioning is not adding the sign; if anything it is
   subtracting frequency (1,970 trades vs 3,183 raw K=15 breaks).
3. **It is a rediscovery, not a discovery.** "Close beyond a confirmed multi-day
   swing high" is a slow breakout. `momentum_breakout` is already this codebase's
   one signed-positive family, reproduced as a positive control in §2.5 of this
   very report. Finding it again through a different parameterisation is
   reassuring about the harness and uninformative about the pivot idea.

**What this does to §3.1.** The design predicted (a) ≥ (b) and offered C1 as the
falsifier. Measured, **(b) > (a)** — decisively, on every metric. But the reason
is not the one option (b) was arguing for: (b) does not win because "major
confirmation filters bad flips", it wins because the major break is the only
event here with a signal, and (a) contributes a negatively-signed entry to it.
So §3.1's *conclusion* (don't build (b)) survives — building (b) means building a
breakout strategy with a harmful pre-filter — while §3.1's *reasoning* ("(b) is
a filter on an event family measured at zero, and can only subtract") is the
wrong way round: here the filter is the good half and the filtered event is the
bad half. Recorded because the design explicitly asked to be told if the claim
was falsified.

---

## 6. Standing caveats

* **Post-hoc is post-hoc.** §5's major-break finding was not pre-registered. It
  is reported because §5's diagnostics forced the arm that surfaced it and
  because deleting a component to attribute a result is standard practice, not
  because it is a validated edge. It has never been run against a permutation
  null, a cost model, or the holdout, and it should not be until an Architect
  note pre-commits how.
* **The holdout is untouched** by every script here. Any future pass on this
  data still has one clean read.
* **8 USDT perps on one venue ≪ 8 independent tests.** Cross-symbol uniformity
  strengthens the negative (§2.3); it would not have strengthened a positive.
* **Funding is unmodelled** and median holds of 16–27 h in Mode S are past the
  design's own flag threshold (§4.3).
* **Two stacked lags are mandatory and were verified** (minor fractal confirm at
  `k` bars, major at `K`; plus the 1h merge shift in Mode M). At 1h with K=15,
  the major tier is confirmed ~15 h late by construction. That is correct, not a
  bug to optimise away, and any live version must reproduce it.
* **C1's arming window** is the one place the design was silent (§1.4); the
  choice made (expires at the next opposite flip) is documented, not tuned.

---

## 7. §6 DECISION GATE — outcome and routing

> *"Kill rule: stage-1 failure at the primary config and no credible interior
> region ⇒ the two-tier pivot engine is dead as an entry engine — no backtest,
> no tuning, and phase 2 (FVG zones) does not run on top of a dead phase 1."*

**Stage reached: 1. Outcome: FAIL — kill rule fires.** The primary config fails
(t = −4.73 at 24 h, negative-signed), and there is no credible interior region
because there is no passing cell anywhere in the 48-cell grid. Stage 2's
permutation control, run anyway, puts the real flip set below the 1st percentile
of a random-flip null at three of five horizons. Stage 3 was not run as a
promotion test; the holdout was not read.

**Consequences, per the design:**

1. **The two-tier pivot engine is retired as an entry engine.** The k-scale
   dimension — the one genuinely untested axis in this family, and the whole
   reason the design gave the idea a 15–20% prior — has now been measured across
   12 (K, k) combinations, two timeframe modes, two event classes and 8 symbols.
   It is flat-to-negative everywhere.
2. **Phase 2 (1h FVG priority zones) does not run.** §7 of the design makes this
   automatic: there is no live phase 1 to layer zones onto.
3. **`indicators.structure()` stays retired.** Nothing here argues for reviving it.

**What I would route instead (Architect's call, not mine).** The only thing in
this pass with a positive, cross-symbol-consistent, grid-coherent sign is the
**bare major-swing break at K = 20 on 1h** — and it is a re-detection of
`momentum_breakout`, which `IDEAS-BACKLOG.md` already carries as "a standalone
momentum/continuation design with its own trigger". That backlog item is where
the evidence points, and this pass adds one concrete parameterisation to it:
a close beyond a confirmed 20-bar (≈20 h) swing, ~120 events/symbol/year, mean
+12.9 bp over the next 6 h. It needs its own pre-committed protocol before
anyone touches the holdout with it.

---

## 8. Pros and cons, in the Researcher-role format

**The idea, in my words.** Define market structure on two pivot scales instead
of one: big swings (10–20 bars) say which way the market is trending and where
the far target is; small swings (2–5 bars) say when that trend has broken. Enter
the moment a small swing breaks against the tracked bias, ride the new direction
to the opposing big swing, and abandon on the next flip.

**Pros**
* Coherent as a mechanism: it is a continuation/trend strategy expressed in swing
  geometry, and it puts small structural risk against large structural reward.
* Cheap in fees at 1h (cost_R 0.026, the lowest in this codebase) because the
  stop sits behind a leg extreme rather than a tight level.
* Frequency is comfortable (240 flips/symbol/year at the primary config) — the
  failure is not starvation.
* The engine's own abandonment rule (opposite-flip exit) is well-defined and
  needs no separate exit design.

**Cons**
* The entry event is measurably **adverse**, not neutral: worse than a
  count-and-alternation-matched random null at three of five horizons.
* Structurally it is a late entry. The flip fires after the impulsive move that
  broke the minor swing, and the pre-registered patience arm (E2 retest) does not
  recover it.
* The major tier is decorative in every arm except T2 — a three-value sweep of a
  parameter that cannot matter, exactly as the design predicted.
* Mode M multiplies costs 4× and binds the daily breaker on half of all days,
  for no measurable gain in detection.
* Median holds of 16–27 h at 1h put it in funding-cost territory that this
  research does not model.

**What made me doubt it, and what would have changed my mind.** The prior was
already poor: `B-choch` (a k=2 CHoCH entry) was significantly negative in the
MTF pass, and this is its cousin. What would have rescued it is a k-scale
trend — some sign that structure defined on bigger swings behaves differently
from k=2. There is no such trend: k=2 and k=5 are equally negative. The one
positive result in the pass survives deleting the entire two-tier apparatus,
which is the cleanest possible statement that the apparatus is not what produced
it.

---

## 9. Reproducing this package

Data is the `intraday-mtf-smc` pull (gitignored); regenerate it with that
package's `fetch_mtf.py` if `../intraday-mtf-smc/data/*-5m.csv.gz` is absent.
Then, from this directory, with a venv holding `pandas` + `numpy`:

| # | command | ~time | writes |
|---|---|---|---|
| 1 | `python checks.py` | 30 s | — (console; run first) |
| 2 | `python smoke_engine.py` | 10 s | — (console) |
| 3 | `python stage1.py` | 1 min | `results/stage1_{pooled,per_symbol,verdict}.csv` |
| 4 | `python controls.py` | 30 s | `results/stage1_controls.csv` |
| 5 | `python permutation.py` | 10 s | `results/stage2_permutation.csv` |
| 6 | `python diagnostics.py` | 2.5 min | `results/diagnostics_*.csv`, `results/grid_trade_counts.csv`, `results/trades_fit_primary.csv.gz` |
| 7 | `python c1_followup.py` | 1.5 min | `results/c1_*.csv`, `results/major_break_*.csv` |

File map:

| file | role |
|---|---|
| `common.py` | paths, symbols, windows, 1h resampler; imports v1/v2/mtf unchanged |
| `pivot.py` | **`pivot_structure(df, K, k)`**, `major_track`, `merge_major_h1`, the four arms |
| `engine.py` | `run_flip` — `backtest.run` + the mandated opposite-flip exit |
| `checks.py` | causality / prefix-stability / lag checks (§1.1, required) |
| `smoke_engine.py` | the flip-exit smoke test the design asked for (§4) |
| `stage1.py` | the flip- and retest-event probe over the 48-cell grid (§6 stage 1) |
| `controls.py` | harness validation both ways (§6 stage 2 (ii)) |
| `permutation.py` | random-flip null, 200 draws (§6 stage 2 (i)) |
| `diagnostics.py` | §5 post-mortem diagnostics, fit only |
| `c1_followup.py` | the C1 anomaly and its attribution to the bare major break |

---

## 10. Hand-off

`HANDOFF.md` — Researcher → Architect, at the §6 decision gate.
