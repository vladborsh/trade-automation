# Research package — derivatives-positioning signals (OI / taker flow / long-short ratios)

**Role:** Researcher (Opus 5) · **Protocol:** `DESIGN.md` (Architect,
pre-committed before any data was pulled) · **Hand-off:** Architect
(`HANDOFF.md`).

**Idea, in my own words.** Every candidate this project has tested so far has
consumed only OHLCV. Binance publishes, free and in bulk, the quantity side of
the same market: how many contracts are open, which way the top traders are
positioned, and which side the aggressive flow is coming from. The confirmed
diagnosis from `intraday-mr-smc/ARCHITECT-NOTE.md` §2.1 is that crowded
leveraged positioning is the fuel of the self-reinforcing moves that killed
reversion on perps. This pass asks whether *measuring that fuel directly* adds
anything a price chart does not already say.

---

## 0. Bottom line

**All three pre-registered hypotheses are dead. The holdout was never read.**

| hypothesis | stage reached | verdict |
|---|---|---|
| **(a)** OI-tercile conditioning of `momentum_breakout` | passed stage 1, passed the §5.1 random-subset null, **failed the §5.3 redundancy control** | **dead — dominated by its price shadow** |
| **(b1)** crowding squeeze (`crowd ≥ 95` + 12-bar adverse break) | **failed stage 1** | dead — and significantly *negative*: −58.4 bp at 24 h, t = −4.56 |
| **(b2)** taker-imbalance continuation (`taker ≥ 95` + up bar + break of prior high) | **failed stage 1** | dead — also negative: −19.8 bp at 24 h, t = −2.86 |

The one result worth the Architect's time is **(a)**, because it is the only
place in this project so far where a hypothesis cleared its statistical bar and
was then killed by a *control* rather than by a t-stat:

* ΔOI conditioning of `momentum_breakout` **does** separate good triggers from
  bad ones — top-minus-bottom ΔOI tercile is +24.2 bp at 12 h (t = 2.08),
  +45.6 bp at 24 h (t = 2.54), +84.7 bp at 36 h (t = 3.44). Three adjacent
  horizons over the §3 bar, and it beats the 90th percentile of a 200-draw
  random-subset null at four of six horizons.
* Its **price shadow** — the identical test with ΔOI replaced by the trailing
  4 h return percentile, same triggers, same bars, same code — separates them
  **better at every single horizon**: +14.0 / +25.1 / +40.5 / +79.4 / +79.5 /
  +93.1 bp, t = 2.90 … 4.98, beating the null at **6 of 6** horizons and
  positive on **8 of 8 symbols** at four horizons (ΔOI manages 7 of 8 at best
  and collapses to 3 of 8 at 48 h).
* §5.3 is explicit about what that means, and the kill rule follows: dead, no
  tuning, no threshold search.

**And the economics agree, which is the part that would matter even if the
statistics had not.** Priced through the unchanged engine on the fit window,
conditioning `momentum_breakout` on top-tercile ΔOI keeps 55 % of the trades
and destroys 90 % of the net PnL: **+8,339 → +816** currency units,
**+0.0202 → +0.0070** net R per trade. The §3 comparative bar
("must beat the unconditioned strategy on net expectancy **and** total net
PnL") fails on both legs. The can-only-subtract discipline was the right frame:
this filter subtracts.

**The answer to §0's central question, stated plainly.** Binance's public
positioning feeds, at 1 h, on 8 USDT perps over 32 months, **add no signal
beyond price**. That is not because they are price in disguise — the
correlations are near zero (Spearman ρ = 0.12 for ΔOI vs its shadow, 0.04 for
`crowd`, 0.003 for `taker`; §5.2). They are genuinely *different* series that
happen to carry *less* of what matters. A dedicated post-mortem (§5.4) holding
the price shadow fixed and splitting by ΔOI inside it finds **1 significant
cell out of 18** — exactly the chance rate.

Two findings are worth carrying forward as facts rather than as candidates:

1. **The crowding-squeeze sign is inverted, strongly and broadly.** Entering
   *with* an adverse break against extreme top-trader crowding loses
   monotonically in the horizon (−7.9 → −58.4 bp from 3 h to 24 h, t = −4.56,
   negative on 6 of 8 symbols) and sits at the **0th percentile** of its
   random-event null at five of six horizons. That is not "no edge"; that is a
   measured, significant *anti*-edge — the same shape the v1 mean-reversion
   trigger showed, with its sign the other way up. Crowded-extreme + adverse
   break is a **fade**, not a squeeze, at this threshold and horizon.
2. **Taker imbalance is the weakest sensor of the three, exactly as §0
   predicted a priori** — and it is negative too, on 7 of 8 symbols, while its
   *volume* shadow is a clean zero (+2.1 → −6.1 bp, |t| < 0.8). So the
   negativity belongs to the taker ratio specifically, not to "high-activity
   bars".

Everything below is fit-window only. **The holdout (2025-04-01 → 2026-08-01)
was not read at any point in this pass and remains clean.**

---

## 1. STAGE 0 — the data audit, and the one Architect ruling it produced

### 1.1 What was pulled

* **Klines:** reused, not re-pulled — the `intraday-mtf-smc` 5 m pull (8 perps,
  2022-08-01 → 2026-07-31), symlinked into `data/`. 1 h decision bars derived by
  the same resampler (`mtf.resample_h1`'s rule), 35,064 bars per symbol.
* **Metrics:** fresh pull, `fetch_metrics.py`, no credentials.

**Record this so no future pass rediscovers it: the monthly metrics prefix does
not exist.** `data/futures/um/monthly/metrics/<SYM>/<SYM>-metrics-<YYYY-MM>.zip`
returns HTTP 404 for every symbol and month probed. The daily prefix
(`daily/metrics/<SYM>/<SYM>-metrics-<YYYY-MM-DD>.zip`) returns 200 across the
entire window. §1 pre-committed to "fall back to daily files where a month is
missing", so the whole pull ran on the design's own contingency path — 11,688
daily files, **1,461 of 1,461 days present for every one of the 8 symbols**, zero
HTTP failures (`results/fetch_log.csv.gz`).

Column names were verified against the files rather than assumed, and match
§1 exactly: `create_time`, `sum_open_interest`, `sum_open_interest_value`,
`count_toptrader_long_short_ratio`, `sum_toptrader_long_short_ratio`,
`count_long_short_ratio`, `sum_taker_long_short_vol_ratio`.

### 1.2 Coverage and gaps (`results/data_audit.csv`, `data_audit_gaps.csv`)

The dataset is far cleaner than §1's "known to have holes" warning implied.

| window | 5 m grid slots | missing rows | missing % | gaps | single-row (ffilled) | longest gap |
|---|---|---|---|---|---|---|
| fit (per symbol) | 280,512 | 130–153 | 0.046–0.055 % | 3–11 | 0–6 | 625 min |
| holdout (per symbol) | 140,256 | 3 | 0.002 % | 1 | 0 | 15 min |

There is exactly **one** substantial gap in four years, and it is identical on
all 8 symbols: **2024-02-16 13:35 UTC, 125 consecutive 5 m rows, 625 minutes** —
an exchange-wide metrics outage, not a per-symbol data-quality problem. Handled
by the §1.2 rule as written: single missing rows forward-filled (0–6 per
symbol), everything longer left NaN and the affected 1 h bars marked unusable.
No interpolation anywhere.

### 1.3 The one real issue: the archive starts columns on different dates

`results/data_audit_columns.csv`. Uniform across all 8 symbols:

| column | effective coverage start |
|---|---|
| `sum_open_interest`, `sum_open_interest_value` | 2022-08-01 |
| `count_long_short_ratio` | 2022-08-01 |
| `sum_taker_long_short_vol_ratio` | 2022-08-01 |
| **`sum_toptrader_long_short_ratio`, `count_toptrader_long_short_ratio`** | **2022-12-01** |

(There is a single isolated valid row on 2022-09-03 for the top-trader columns
in every symbol's file; the columns are ≥ 99 % populated only from 2022-12-01.)

Consequence for the §1.3 symbol rule, measured on the pre-committed fit window:

| hypothesis | series used | unusable 1 h fit bars, per symbol | §1.3 verdict |
|---|---|---|---|
| (a) | ΔOI | 1.6–1.8 % | 0 / 8 dropped |
| (b2) | taker | 1.6 % | 0 / 8 dropped |
| **(b1)** | **crowd** | **15.5 %** | **8 / 8 dropped** → §1.3 STOP |

### 1.4 The stage-0 escalation and the Architect's ruling

**This deviation was raised and ruled on at stage 0, before any stage-1 number
existed.** No result of any kind had been computed when the question was asked.

I escalated because the mechanical verdict (8/8 dropped → STOP) was triggered by
something §1.3 was not written to catch: no symbol has holes, every symbol is
identical, breadth is intact at 8/8, and the 15.5 % is entirely
`136 days of absent column + the pre-committed 15-day percentile min_periods`.
§6 already anticipates exactly this case — *"Windows: fit … (adjusted per-symbol
to metrics coverage from stage 0; state the effective windows in the report)"*.

**Architect ruling (2026-08-26), applied verbatim:** §6's window-adjustment
clause governs; §1.3's symbol-drop rule is for per-symbol data-quality failure,
not a uniform coverage artefact. Concretely:

* all 8 symbols kept for all three hypotheses;
* **(a) and (b2)** run on the pre-committed fit window **2022-08-01 → 2025-04-01**;
* **(b1)** runs on an effective fit window of **2022-12-16 → 2025-04-01**
  (coverage start + the pre-committed 15-day `min_periods`), costing it ~14 % of
  its fit sample and nothing else;
* holdout unchanged for all three (b1 unusable there: 0.03 %);
* **(b1)'s stage-2 controls — both the random-event null and the price-shadow
  redundancy control — run on that same shortened window**, so the comparison is
  like-for-like (rider 1 of the ruling);
* no threshold, parameter or definition changed anywhere.

On the effective windows, unusable 1 h fit bars are 1.6–1.8 % per symbol for
every hypothesis and **0 / 8 symbols drop**. Stage 0: **PROCEED**.

### 1.5 Alignment and usability, as implemented

* **§1.4 alignment.** A 1 h bar labelled `T` closes at `T+1h` and may use a
  metrics row with `create_time = c` only when `T+1h ≥ c+5min`, i.e.
  `c ≤ T+55min`; it takes the last such row. One full metrics period of lag,
  mirroring the one-completed-bar HTF discipline. All derived series are
  computed on that lagged snapshot.
* **Usability.** A bar is unusable if any of the twelve 5 m metrics slots
  covering `[T, T+55min]` is missing after the single-row fill or belongs to a
  long gap, if it falls outside coverage, or if its own lookback is unmet
  (ΔOI needs bar `T−4`; percentiles need `min_periods` = 15 days). The gate is
  evaluated **per hypothesis**, because §1.3 itself scopes the drop rule to
  *"that hypothesis's"* statistics and there is no reason for a column
  hypothesis (a) never touches to cost hypothesis (a) sample.
* **No signal is ever generated on an unusable bar** — verified directly
  (`checks.py` check 7: 0 violations for all six rule variants).

### 1.6 Derived series (§2), all fixed, none swept

`dOI_4h` (primary) and `dOI_1h` (secondary) as percent change of
`sum_open_interest`; `crowd` from `sum_toptrader_long_short_ratio` (positions);
`taker` from `sum_taker_long_short_vol_ratio`. Each converted to a **rolling
30-day percentile** (720 1 h bars, `min_periods` 360). `count_toptrader_…` and
`count_long_short_ratio` are carried as diagnostics only and were never swept,
per §2.

---

## 2. Causality and wiring checks (`checks.py`)

The merge of an externally-timed 5 m series onto 1 h decision bars is exactly
where a package like this leaks the future, so it is checked directly.

```
check1 alignment: uses a FUTURE metrics row in 0/4000 sampled bars (must be 0);
                  differs from last-eligible raw row in 0/4000 (gap ffill)
check2 equals the T+60min snapshot in 569/35064 bars
       (must be well below n: the lag is real, not a relabelling)
check3a dOI_4h_pct / crowd / taker / ret4h_pct / ret24h_pct / vol_pct
        rolling-percentile prefix-stability: True (all six)
check3b momentum_breakout + all six event variants prefix-stability: True
check4  ΔOI tercile prefix-stability: True
check7  signals on UNUSABLE bars: 0 for all six variants
```

Frequency sanity, BTCUSDT, full window (check 5): `b1_crowd` 473 events
(118/yr, long share 0.53), `b2_taker` 850 (212/yr, 0.56), `b1_shadow` 15 (3.7/yr
— see §5.3, this is the shadow's own problem), `b2_shadow` 1,263 (316/yr, 0.47).

---

## 3. STAGE 1 — the probes (`results/stage1_a.csv`, `stage1_b.csv`)

Method, identical to every prior package: direction-adjusted forward returns on
**non-overlapping** triggers, no stops, no targets, no costs. Horizons 3–48 1 h
bars. Fit window only, usable bars only. For (a), Welch t on
`mean(top ΔOI tercile) − mean(bottom ΔOI tercile)` over the same trigger set,
terciles cut at the pre-registered 33 / 67 of the rolling percentile. For (b),
events de-overlapped at the fixed 12-bar spacing of §4.

### 3.1 (a) — OI-conditioned `momentum_breakout`: PASS

| horizon | n bottom / mid / top | bottom bp | mid bp | top bp | **top − bottom bp** | **t** | passes |
|---|---|---|---|---|---|---|---|
| 3 | 2129 / 1685 / 3039 | −2.5 | −1.1 | +3.1 | +5.6 | 1.02 | no |
| 6 | 1801 / 1412 / 2586 | −1.4 | +1.7 | +9.4 | +10.8 | 1.39 | no |
| **12** | 1419 / 1083 / 2116 | −1.6 | +3.4 | +22.6 | **+24.2** | **2.08** | **yes** |
| **24** | 1090 / 853 / 1589 | −26.6 | −2.7 | +18.9 | **+45.6** | **2.54** | **yes** |
| **36** | 873 / 713 / 1350 | −47.1 | +14.7 | +37.6 | **+84.7** | **3.44** | **yes** |
| 48 | 798 / 636 / 1111 | +14.7 | +17.6 | +36.0 | +21.2 | 0.76 | no |

Three adjacent passing horizons; the §3 bar (t > 2 at ≥ 2 adjacent horizons,
difference positive) is **met**. The monotone tercile ordering
(bottom < mid < top) holds at 5 of 6 horizons, and the top tercile is positive
on its own at every horizon while the bottom tercile is negative at four of
six — this is a real conditional split, not a one-horizon artefact.

The pre-registered **secondary**, `dOI_1h`, also passes (t = 2.45 / 2.09 / 2.62
at 12 / 24 / 36 h) — same shape, slightly weaker, which is what a real effect
measured on a noisier version of the same input looks like.

Per-symbol breadth (`results/stage1_per_symbol.csv`): positive on 4/8, 7/8, 6/8,
7/8, 7/8, 3/8 symbols at the six horizons. Solid in the middle, ragged at both
ends.

### 3.2 (b1) — crowding squeeze: FAIL, and significantly negative

Effective fit window 2022-12-16 → 2025-04-01; 2,087 raw events pooled, 1,188
after de-overlap.

| horizon | n | mean bp | t | hit rate |
|---|---|---|---|---|
| 3 | 1188 | −7.9 | −1.66 | 42.1 % |
| 6 | 1188 | −18.3 | −2.84 | 45.5 % |
| 12 | 1188 | −29.2 | −3.31 | 44.7 % |
| **24** | 1188 | **−58.4** | **−4.56** | 44.4 % |
| 36 | 1188 | −62.4 | −3.97 | 46.6 % |
| 48 | 1188 | −53.2 | −2.89 | 48.1 % |

Monotone in the horizon out to 36 h and negative on 6 of 8 symbols at every
horizon beyond 3 h. The event fired **well above** the §4 frequency floor
(1,188 ≫ 400), so this is a measured refutation, not an under-powered one.

The pre-registered `crowd ≥ 90` sensitivity row is reported and **not promoted**
(it was never eligible for promotion): 1,735 events, −10.2 → −44.4 bp,
t = −2.60 … −4.31. Same sign, same shape, slightly smaller magnitude — i.e.
loosening the threshold dilutes toward zero, exactly as a real effect should.

### 3.3 (b2) — taker-imbalance continuation: FAIL, negative

4,565 raw events, 3,416 after de-overlap.

| horizon | n | mean bp | t | hit rate |
|---|---|---|---|---|
| 3 | 3416 | −7.5 | −3.81 | 44.6 % |
| 6 | 3416 | −7.4 | −2.40 | 46.5 % |
| 12 | 3416 | −13.6 | −2.70 | 47.4 % |
| 24 | 3416 | −19.8 | −2.86 | 46.5 % |
| 36 | 3416 | −17.0 | −2.11 | 47.2 % |
| 48 | 3416 | −15.8 | −1.71 | 48.3 % |

Negative on 7 of 8 symbols at 4 of 6 horizons. §0 called this "the weakest of
the three a priori" at a ~10 % prior; the measurement agrees and adds a sign.
The `taker ≥ 90` sensitivity row (5,723 events) again dilutes toward zero with
the sign intact.

---

## 4. STAGE 2 — controls (`results/null_a.csv`, `null_b.csv`, `harness_validation.csv`)

### 4.1 §5.4 harness validation, both ways

Run through **this package's own probe code path**, on **this package's own 1 h
frames**, so the probe is shown to be capable of finding a signal where one is
known to exist and of returning zero where one is known not to be.

| control | 3 h | 6 h | 12 h | 24 h | 36 h | 48 h |
|---|---|---|---|---|---|---|
| `momentum_breakout` (v2's one positive) | +0.3 bp | +3.9 | +9.6 | −1.4 | +4.5 | **+22.5** |
| | t 0.12 | 1.21 | 1.93 | −0.17 | 0.43 | 1.88 |
| single-TF `smc` (v1's measured zero) | −0.5 bp | −0.1 | −1.9 | −4.8 | −7.9 | −4.4 |
| | t −0.62 | −0.05 | −0.70 | −0.93 | −1.10 | −0.45 |

`smc` comes back a clean zero (|t| < 1.1 everywhere on up to 38,823
observations) — the negative control behaves. `momentum_breakout` comes back
**positive-signed at 5 of 6 horizons** with the largest values at the longer
horizons, consistent with v2's characterisation of it as a *small, stable*
effect (v2's own evidence for it was gross PF 1.07–1.19 on 8/8 perps, never a
t > 2 probe).

**State this plainly, because it bounds everything above:** the base strategy's
own probe never reaches t > 2 on this frame. A conditioning study is measuring a
split *inside* an effect that is itself near the noise floor. That does not
invalidate §3.1's numbers — the split is measured on the split, not on the
base — but it is the honest ceiling on how much (a) could ever have been worth.

### 4.2 §5.1 random-subset null for (a) — PASS

200 draws, random disjoint subsets of the real tercile sizes drawn from the same
trigger set, statistic = the stage-1 top-minus-bottom difference.

| horizon | real diff bp | null p50 | null p90 | null max | beats p90 | real's percentile in null |
|---|---|---|---|---|---|---|
| 3 | +5.6 | +0.6 | +7.5 | +15.4 | no | 83.0 |
| **6** | +10.8 | −0.2 | +9.1 | +28.7 | **yes** | 94.0 |
| **12** | +24.2 | +1.0 | +14.6 | +31.5 | **yes** | 98.5 |
| **24** | +45.6 | +2.4 | +23.4 | +53.2 | **yes** | 99.5 |
| **36** | +84.7 | +3.0 | +32.4 | +68.2 | **yes** | 100.0 |
| 48 | +21.2 | −0.5 | +33.6 | +66.2 | no | 77.5 |

Four consecutive horizons past the 90th percentile, including one above the
null's maximum. (a) clears §5.1 comfortably. **This is a genuine pass, and it is
why §5.3 has to be the thing that kills it.**

### 4.3 §5.2 random-event nulls for (b1)/(b2) — both far *below* the null

| rule-set | horizon | real mean bp | null p50 | null p90 | real's percentile |
|---|---|---|---|---|---|
| b1_crowd | 6 | −18.3 | −1.0 | +6.6 | **0.0** |
| b1_crowd | 24 | −58.4 | −4.3 | +11.9 | **0.0** |
| b1_crowd | 36 | −62.4 | −4.0 | +16.7 | **0.0** |
| b2_taker | 3 | −7.5 | +0.1 | +3.6 | **0.0** |
| b2_taker | 12 | −13.6 | +0.6 | +6.8 | **0.0** |
| b2_taker | 24 | −19.8 | +0.6 | +9.4 | **0.0** |

Both events sit at the **0th percentile** of 200 random same-count, same-side
draws from their own usable bars at most horizons. This is the same signature
the pivot-structure pass found on its flip event: the trigger is not neutral,
it is *actively harmful* in the direction it specifies.

---

## 5. §5.3 — the redundancy control. The finding of this package.

§5.3 was declared mandatory for all three hypotheses and named as §0's central
question "given teeth". It is what actually decides this pass.

### 5.1 (a) vs its price shadow — the real test, one input changed

Identical function, identical trigger set, identical bar gate, identical
de-overlap, identical null. The only difference: `dOI_4h` percentile →
**trailing 4 h return percentile**.

| horizon | ΔOI diff bp (t) | **shadow diff bp (t)** | ΔOI beats null p90 | shadow beats null p90 |
|---|---|---|---|---|
| 3 | +5.6 (1.02) | **+14.0 (2.90)** | no | **yes** |
| 6 | +10.8 (1.39) | **+25.1 (3.70)** | yes | **yes** |
| 12 | +24.2 (2.08) | **+40.5 (3.97)** | yes | **yes** |
| 24 | +45.6 (2.54) | **+79.4 (4.98)** | yes | **yes** |
| 36 | +84.7 (3.44) | +79.5 (3.66) | yes | **yes** |
| 48 | +21.2 (0.76) | **+93.1 (3.80)** | no | **yes** |

Per-symbol breadth of the same two tests:

| | 3 h | 6 h | 12 h | 24 h | 36 h | 48 h |
|---|---|---|---|---|---|---|
| ΔOI, symbols positive | 4/8 | 7/8 | 6/8 | 7/8 | 7/8 | 3/8 |
| **shadow, symbols positive** | **7/8** | **8/8** | **7/8** | **8/8** | **8/8** | **8/8** |

§5.3's condition is *"same sign, larger magnitude, and the shadow fails where
the real one passes"*. The sign is the same; the magnitude is **larger for the
shadow at 5 of 6 horizons**; the shadow does not fail anywhere the real one
passes — it passes everywhere, including both horizons where ΔOI fails. The
positioning version does not visibly beat its price-derived shadow on any axis
measured. **Verdict: dead. Kill rule fires — no tuning, no threshold search,
no stage-3 promotion, holdout not read.**

### 5.2 The label deserves one correction

§5.3 prescribes reporting such a hypothesis as *"price in disguise — no second
signal"*. The second half is exactly right. The first half is not literally what
is happening here, and the Architect should have the precise version:

`results/redundancy_correlations.csv`, Spearman ρ averaged over the 8 symbols:

| series | vs its own shadow | vs trailing 24 h return | vs same-bar return |
|---|---|---|---|
| `dOI_4h_pct` | **+0.123** | +0.088 | +0.038 |
| `crowd` | −0.003 | +0.043 | −0.008 |
| `taker` | +0.003 | +0.022 | **+0.104** |

These series are **not** repackaged price. ΔOI shares ~1.5 % of its rank
variance with the trailing-return percentile it loses to. The accurate statement
is therefore **"dominated, not duplicated"**: positioning is a genuinely
independent measurement that carries *less* of what predicts the next few hours
than the trailing return does — while being nearly orthogonal to it. That is a
stronger and more useful negative than "it was price all along", because it
closes the obvious follow-up ("then combine them"), which §5.4 below tests
directly.

### 5.3 The (b1) shadow is under-powered, and I am not counting it as a pass

`b1_shadow` (trailing 24 h return percentile ≥ 95 + 12-bar adverse break) fires
only **88 raw / 72 de-overlapped events** pooled across 8 symbols — versus 2,087
/ 1,188 for the real rule. The construction is near self-contradictory (a top-5 %
24 h return *and* a break of the 12-bar low in the same bar), so the shadow
starves itself of sample.

This matters for honesty: on §5.3's mechanical wording, `b1_crowd` "beats its
shadow" (the shadow fails; the real one also fails, but negatively and
significantly). **I am not reporting that as anything.** The real rule failed
stage 1 outright, so the shadow comparison never becomes load-bearing for it,
and a shadow that fails from 72 observations is evidence of nothing either way.
Recorded here so the next pass does not mistake the shadow's silence for a
result. `b2_shadow` (volume percentile) is properly powered — 3,568 events — and
comes back a clean zero (+2.1 → −6.1 bp, |t| ≤ 0.8), which does carry
information: (b2)'s negativity belongs to the taker ratio specifically, not to
high-activity bars in general.

### 5.4 One post-mortem, pre-declared as non-promotable (`incremental.py`)

Since §5.2 above shows ΔOI and its shadow are nearly orthogonal, the natural follow-up
is whether ΔOI adds anything *on top of* price rather than instead of it. This
is the sharpest possible form of §0's question, so it is worth one direct
measurement — on the already-dead hypothesis, on the already-used fit window,
with the kill rule already fired and no threshold able to move.

Hold the trailing-4 h-return tercile fixed; split by ΔOI tercile inside it;
18 cells (6 horizons × 3 price terciles):

**1 cell of 18 reaches |t| > 2** (bottom price tercile at 36 h, t = 2.30). At
18 tests that is the chance rate. Inside a fixed price bucket, ΔOI does not
separate. `results/incremental_oi_within_price.csv`.

---

## 6. Economics, for the record (`results/stage3_a_fit.csv`, `stage3_b_fit.csv`)

Nothing survived stage 2, so **stage 3 was not run as a promotion test and the
holdout was never read.** What follows is the fit-window pricing of the dead
hypotheses through the unchanged engine — the same courtesy the MTF and
pivot-structure packages extended to their own kills, so the Architect can see
*how far* from the bar these were, not just *that* they missed it.

Engine: `intraday-mr-smc/backtest.py:run`, unchanged. Risk rules unchanged:
1 %/trade, 2 %-of-day breaker, next-bar-open fills, stop-before-target on
ambiguous bars, 5 bp/side.

### 6.1 (a) — the §3 comparative bar

| variant | trades | WR | net PF | **net exp R** | **net PnL** | gross PF | gross exp R | median cost_R | gross PF > 1 on |
|---|---|---|---|---|---|---|---|---|---|
| unconditioned | 4,477 | 44.2 % | 1.042 | **+0.0202** | **+8,339** | 1.145 | +0.0603 | 0.0344 | 8/8 |
| **top ΔOI tercile** | 2,465 | 43.3 % | 1.007 | **+0.0070** | **+816** | 1.109 | +0.0480 | 0.0356 | 8/8 |
| bottom ΔOI tercile | 1,839 | 41.8 % | 0.929 | −0.0315 | −5,465 | 1.016 | +0.0067 | 0.0328 | 4/8 |

```
§3 comparative bar (can-only-subtract):
  net_exp_R  +0.0070 vs +0.0202  -> FAIL
  net_pnl    +816.3  vs +8339.5  -> FAIL
  trades     2465 (floor 300)    -> PASS
```

Two things to read off this table. **First, the filter subtracts, decisively.**
Keeping 55 % of the trades retains 10 % of the net PnL and a third of the net
edge per trade. §2.3 of the v1 Architect note predicted this class of outcome
for filter architectures; here it is again, measured.

**Second — and this is the part the stage-1 probe could not show — the ordering
that stage 1 found does *not* survive contact with the engine in the way it
looks like it should.** ΔOI genuinely separates: the bottom tercile is a
disaster (net PF 0.93, gross PF > 1 on only 4/8) while the top is fine. But the
top tercile is still *worse than not filtering at all*, because the **middle**
tercile carries a large share of the unconditioned edge, and the pre-registered
"trade the top third" rule throws it away along with the bottom. A probe on raw
forward returns cannot see that; a stop-and-target engine with a daily breaker
can. Worth remembering the next time a tercile split looks like a filter.

### 6.2 (b1) / (b2) — absolute economics

| rule-set | trades | WR | net PF | net exp R | gross PF | gross exp R | median cost_R | 3×cost_R bar | gross PF>1 | median hold |
|---|---|---|---|---|---|---|---|---|---|---|
| b1_crowd | 897 | 39.9 % | 0.889 | −0.0569 | 0.947 | −0.0251 | 0.0264 | +0.079 → **missed** | 3/8 | 48 h |
| b2_taker | 2,607 | 34.2 % | 0.888 | −0.0642 | 0.991 | −0.0051 | 0.0480 | +0.144 → **missed** | 4/8 | 22 h |

Both are **gross-negative before a single basis point of cost** — the §6 bar
(gross expectancy ≥ 3 × median cost_R, net PF ≥ 1.1) is not merely missed, it is
missed on the wrong side of zero. Costs are not the reason these failed.

### 6.3 §6 standard diagnostic block (`results/engine_accounting.csv`)

| variant | raw signals | trades taken | skipped | skipped % | breaker binds (bars) | breaker binds (days) |
|---|---|---|---|---|---|---|
| unconditioned | 7,329 | 4,477 | 2,852 | 38.9 % | 0.14 % | 0.53 % |
| top tercile | 3,258 | 2,465 | 793 | 24.2 % | 0.04 % | 0.13 % |
| b1_crowd | 2,087 | 897 | 1,190 | 57.0 % | 0.02 % | 0.03 % |
| b2_taker | 4,565 | 2,607 | 1,958 | 42.9 % | 0.41 % | 1.14 % |

The 2 %-of-day breaker is **not** shaping these results (it binds on ≤ 1.1 % of
days anywhere). Skips are dominated by the one-position-per-symbol rule and by
signals that no longer make sense at the fill price, as in every prior package.
`b1_crowd`'s 57 % skip rate is a direct consequence of its 48-bar time stop:
events cluster in stressed tape and the book is usually already occupied.

Realised R distributions and exit-reason splits (`results/stage3_*_fit.csv`):

| variant | p05 | p25 | median | p75 | p95 | stop / target / time |
|---|---|---|---|---|---|---|
| unconditioned | −1.07 | −1.03 | −0.20 | +1.40 | +1.48 | 34 % / 27 % / 39 % |
| top tercile | −1.07 | −1.03 | −0.24 | +1.41 | +1.48 | 37 % / 28 % / 35 % |
| b1_crowd | −1.06 | −1.03 | −0.32 | +0.52 | +2.93 | 41 % / 6 % / 53 % |
| b2_taker | −1.12 | −1.06 | −1.03 | +0.63 | +2.95 | 57 % / 14 % / 30 % |

The 3R geometry of (b1)/(b2) works as designed on the upside (p95 ≈ +2.9 R) —
the problem is entirely that the entries are wrong-signed. `b1_crowd` hits its
3R target on **6 % of trades** against a break-even requirement of 25 %.

**Funding, per §6.** Median hold is 16–18 h for (a)'s variants, 22 h for
`b2_taker`, 48 h for `b1_crowd`. All exceed 8 h, so the §6 flag fires: **funding
is a promotion blocker for every variant in this package**, unmodelled here as
in every prior one. It did not need to be modelled to reach these verdicts (all
three are dead on gross numbers), but any future 1 h continuation candidate in
this project must include it.

### 6.4 Long/short split (the drift lesson)

Long share: unconditioned 49.6 %, top tercile 58.3 %, `b1_crowd` 42.0 %,
`b2_taker` 53.6 %. Nothing here is a disguised long-only bet on a rising tape —
the ΔOI filter tilts modestly long (rising OI is somewhat more common on up
moves), but not enough to explain any of the results.

---

## 7. §6 DECISION GATE — outcome

**All three hypotheses die. Kill rule fires on all three. Holdout unread.**

| | (a) OI conditioning | (b1) crowding squeeze | (b2) taker continuation |
|---|---|---|---|
| stage 0 | pass (all 8 symbols) | pass (8 symbols, adjusted window per §1.4) | pass (all 8 symbols) |
| stage 1 | **PASS** (t 2.08/2.54/3.44) | **FAIL** (negative, t −4.56) | **FAIL** (negative, t −2.86) |
| §5.1/§5.2 null | **PASS** (4/6 horizons > p90) | fail (0th percentile) | fail (0th percentile) |
| **§5.3 redundancy** | **FAIL — dominated by shadow** | n/a (already dead; shadow under-powered, §5.3 above) | n/a (already dead; shadow is a clean zero) |
| stage 3 | not run as a promotion test (fit-window pricing reported, §6.1: comparative bar FAILS both legs) | not run (fit pricing: gross-negative) | not run (fit pricing: gross-negative) |
| holdout | **not read** | **not read** | **not read** |

§6's own words for this outcome: *"If all three die, the deliverable is the
measured statement that Binance's public positioning data adds no signal beyond
price at 1 h — which, given how much of crypto-trading folklore leans on these
feeds, is a finding worth having."* That is the deliverable, and §5.2/§5.4
sharpen it: not "it was price all along", but "it is a genuinely independent
measurement that is genuinely less informative, and combining it with price adds
nothing at the chance rate."

Per §7 of the design: the natural next hop *if (a) had passed in full* was to
fold OI-conditioning into the standalone-momentum design pass in the backlog.
**(a) did not pass. Flagged and not done** — and, given §6.1, actively
contra-indicated: the pre-registered top-tercile rule makes `momentum_breakout`
worse, not better.

---

## 8. Doubts about this package

* **The base effect is near the noise floor, which caps everything.** §4.1 shows
  `momentum_breakout`'s own probe never reaches t > 2 on this frame. Any
  conditioning study of it is a split inside something small. A failure to
  improve a near-noise base is weaker evidence against the conditioning variable
  than a failure to improve a robust base would be. This is the single biggest
  reason to hold (a)'s verdict a little more loosely than (b1)'s.
* **The (b1) shadow starved (§5.3).** The pre-registered price proxy for
  crowding is nearly self-contradictory with the adverse-break condition. That
  arm of §5.3 produced no usable information. It did not change any verdict, but
  a future design writing a shadow should check that the shadow can *fire*
  before committing to it.
* **Eight USDT perps on one venue are not eight independent tests**, and the
  same caveat every prior package carries applies here with extra force: the one
  substantial metrics outage is *identical* on all 8 symbols, which is a direct
  demonstration of how shared their microstructure is. This makes the negatives
  more trustworthy and would have made any positive less so.
* **The 33/67 tercile cut is one encoding among several.** §6.1 shows the middle
  tercile carries real edge, so "top third" was probably the wrong shape for a
  ΔOI filter even if ΔOI had information — a continuous weighting, or "not the
  bottom third", would be different rules. They were not pre-registered and I
  did not test them; the kill rule forbids searching for the encoding that
  works, and the §5.4 post-mortem says there is nothing there to find anyway.
* **`crowd` is one of three available ratios.** §2 pre-registered the top-trader
  *position* ratio as the most liquidation-relevant and recorded the other two
  as diagnostics only. They were not tested. If someone wanted one more shot at
  (b1), the global account ratio is the untested variant — but §3.2's t = −4.56
  and 0th-percentile null make me think the sign, not the sensor, is the issue.
* **Only one venue's view of positioning.** Binance's OI and top-trader ratios
  describe Binance's book. Aggregate cross-venue OI (Coinglass-style) is a
  different, more complete series that this pass did not touch and that no free
  bulk archive supplies.
* **Percentile windows were fixed at 30 days and never swept** — correctly, per
  §2. A different normalisation window is a different study, and a legitimate
  one, but it is also exactly the kind of knob that manufactures a result if
  turned after seeing these numbers.

---

## 9. Pros and cons, in the Researcher-role format

**Pros of the idea as specified**

* Cheap, fast, free, no credentials, and the data quality is genuinely excellent
  (0.05 % missing rows over four years, one exchange-wide outage).
* It is mechanism-adjacent: it measures the exact quantity the project's one
  confirmed diagnosis names as causal.
* The pre-committed protocol did its job. (a) cleared its statistical bar and
  its permutation null and was still killed — by a control designed in advance
  to catch precisely this. That is the discipline working, not failing.

**Cons, now measured rather than suspected**

* At 1 h, on this venue, positioning adds nothing beyond price: dominated as a
  conditioner, wrong-signed as a trigger, and worth nothing incrementally
  (1/18 cells).
* Two of three hypotheses are *significantly negative*, so this is not "no
  information" — it is information pointing the other way, which is the kind of
  finding that survives being wrong about magnitude.
* Any tradable version would hold for 16–48 h median, putting unmodelled funding
  first-order.
* The single-venue limitation is structural: the free archive cannot answer
  whether *aggregate* positioning behaves differently from Binance's slice.

---

## 10. Reproducing this package

```
python3 -m venv .venv && .venv/bin/pip install pandas numpy scipy
cd research/deriv-positioning

# data (raw pull is gitignored; klines are symlinked from ../intraday-mtf-smc/data)
python fetch_metrics.py            # ~11.7k daily files, 8 symbols, ~25 min

python prep.py                     # per-symbol 1h decision frames -> cache/
python data_audit.py               # STAGE 0 gate  -> results/data_audit*.csv, symbols_kept.json
python checks.py                   # causality / wiring / prefix stability
python stage1.py                   # STAGE 1 probes -> results/stage1_a.csv, stage1_b.csv
python breadth.py                  #   per-symbol breadth -> results/stage1_per_symbol.csv
python controls.py                 # STAGE 2 nulls + harness validation
python diagnostics.py              # §6 diagnostic block + redundancy correlations
python stage3.py --window fit --events b1_crowd,b2_taker    # fit-window pricing (dead hypotheses)
python incremental.py              # §5.4 post-mortem
```

`stage3.py --window holdout` exists and **was never run**. Running it consumes
the clean holdout; do not, without an Architect ruling.

| file | what it is |
|---|---|
| `common.py` | paths, symbols, windows (incl. the §1.4 per-hypothesis fit windows), fixed parameters, gap rule, rolling percentile |
| `fetch_metrics.py` | the metrics pull (daily archive, per §1's fall-back) |
| `prep.py` | 1 h decision frames: lagged metrics merge, derived series, shadows, per-hypothesis usability gates |
| `signals.py` | the three hypotheses and their shadows — one function per event class, shadow = one changed input |
| `data_audit.py` | STAGE 0 |
| `checks.py` | causality / wiring |
| `stage1.py`, `breadth.py` | STAGE 1 pooled + per-symbol |
| `controls.py` | STAGE 2 nulls + §5.4 harness validation both ways |
| `stage3.py` | engine pricing (fit only, here) |
| `diagnostics.py` | §6 block + redundancy correlations |
| `incremental.py` | §5.4 post-mortem, non-promotable by construction |

`results/` is committed. `data/` and `cache/` are gitignored, as in every prior
package; `results/trades_*.csv` (per-trade logs) are gitignored and regenerated
by `stage3.py`.

---

## 11. Hand-off

To the **Architect** — see `HANDOFF.md`.
