# REPORT — pipeline calibration: three positive controls (`_calibration`)

**Pre-registration:** `DESIGN.md`, committed `f2f525a`, before any number below
was computed. **Fit period only; no holdout was read on any test, by any code
path.** `engine.py`, `cost_R`, `null_A`, `null_B`, `boot_days` and `verdict`
were imported and called, never edited.

---

## Bottom line

**Yes — this pipeline recovers a known edge of known size, with the right sign,
at the right magnitude, and the verdict ladder fires when the edge is big
enough.** All seven hard gates of Test A pass, two of them to floating-point
exactness (`1e-14` and `1e-16`); Test B's stop condition — the one that would
have made every index verdict in this project suspect — **passes in its
strongest possible form**, with the engine's gross overnight return
**bit-identical** to the tape's own arithmetic and the entire net difference
accounted for, to `1e-17`, by the spread the engine charges. The 30 kills on
the ledger are honest kills.

Three findings sit behind that verdict and matter more than the pass itself:

1. **The ladder's binding gate is the `+0.10R` build bar, not the Bonferroni
   α.** Across all 56 planted cells, *every* cell that cleared `+0.10R` also
   cleared α, while **8 cells cleared α without clearing `+0.10R`**. The
   verdict function was equivalent to `mean ≥ +0.10R` on every single cell.
   Red team §1 treated the two as coinciding at ≈ `+0.11R`; empirically the
   mean bar binds first and alone.
2. **The empirical power curve confirms §1 and is if anything worse than its
   analytic version: 0/8 arms at `d = 0.05`, 1/8 at `d = 0.10`, 3/8 at
   `d = 0.20`** — and this is an **upper bound**, because the fit-only
   calibration satisfies the ladder's "fit agrees" clause for free.
3. **The pre-registered Null-A leakage confound did not materialise**
   (`nullA_mean` is flat to the fourth decimal across all seven drifts,
   `ρ ≈ 0.0004`), so the power curve above is a clean measurement rather than
   the lower bound `DESIGN` A.4 allowed for.

**Test C is the one thing that did not pass.** Liu–Tsyvinski–Wu cross-sectional
momentum reproduces with the **correct sign on all four horizons** but
`t = 0.29 / 1.55 / 0.60 / 0.72` — below the pre-registered `t ≥ 2`. Per
`DESIGN` C.3, written before the number was seen, this leaves **the portfolio
harness uncertified**, and it is reported as such rather than as either a pass
or a pipeline bug.

---

## TEST A — planted signal of known size, end to end

### A.1 Recovery table — mean net R (template 1), fit period, 8 arms × 7 drifts

| arm | n | d=−0.20 | d=−0.10 | d=−0.05 | **d=0** | d=+0.05 | d=+0.10 | d=+0.20 | SE |
|---|---|---|---|---|---|---|---|---|---|
| US100-5m | 370 | −0.0619 | −0.0087 | +0.0251 | **+0.0572** | +0.0748 | +0.1037 | +0.1528 | 0.0447 |
| US100-15m | 348 | −0.0865 | −0.0333 | −0.0089 | **+0.0364** | +0.0565 | +0.0821 | +0.1366 | 0.0452 |
| US500-5m | 378 | −0.1327 | −0.0854 | −0.0691 | **−0.0438** | −0.0160 | −0.0046 | +0.0372 | 0.0475 |
| US500-15m | 368 | −0.1260 | −0.0812 | −0.0656 | **−0.0394** | −0.0137 | +0.0039 | +0.0415 | 0.0476 |
| BTCUSDT-5m | 367 | −0.0895 | −0.0434 | −0.0238 | **−0.0008** | +0.0353 | +0.0537 | +0.0879 | 0.0464 |
| BTCUSDT-15m | 351 | −0.1078 | −0.0495 | −0.0267 | **+0.0042** | +0.0393 | +0.0610 | +0.1093 | 0.0458 |
| ETHUSDT-5m | 358 | −0.1172 | −0.0684 | −0.0495 | **−0.0253** | −0.0043 | +0.0187 | +0.0559 | 0.0474 |
| ETHUSDT-15m | 339 | −0.1421 | −0.0971 | −0.0773 | **−0.0436** | −0.0236 | +0.0027 | +0.0488 | 0.0467 |

`d = 0` is the real fit tape and reproduces the committed `fit_describe.csv`
exactly (gate G2, below).

### A.2 Gate results

| gate | what it asserts | result |
|---|---|---|
| **G0** | the plant does not change which trades exist | **PASS**, 56/56 cells — identical `(date, side, entry, stop, stop_dist, i_entry_min, i_flat)` at every `d` |
| **G1** | **exact recovery of a known size**: on trades held to the 16:00 flat at both `d=0` and `d`, `ΔgrossR == d` | **PASS** — max deviation **`4.7e-14`** over **5,093** template-1 trades and **`5.5e-14`** over **12,300** template-2 trades |
| **G2** | the `d=0` replay reproduces the committed pre-registered fit run | **PASS** — 16/16 arm×template means exact, max deviation **`9.2e-17`**, trade counts identical |
| **G3** | mean net R strictly increasing in `d` | **PASS** — 8/8 arms, both templates |
| **G4** | **sign symmetry**: `mean(−d) < mean(0) < mean(+d)` | **PASS** — 8/8 arms at every `|d|`. *This is the gate a sign error would have broken and nothing else would.* |
| **G5** | `gross − net == cost` exactly; `cost` invariant in `d` | **PASS** — identity to **`8.0e-16`**; cost drifts at most **`6.9e-05 R`** across the full `±0.20` range |
| **G7** | the day-block bootstrap interval covers the run's own mean | **PASS** — 56/56 cells |

### A.3 Attenuation — the one pre-registered prediction that does *not* hold literally

The red team's stated criterion was "recovered mean net R = `d` − `cost_R`
± 1 SE". **It does not hold, and `DESIGN` A.2 said so before the run.**

| `d` | mean Δ vs `d=0` | Δ / `d` (attenuation) |
|---|---|---|
| −0.20 | −0.1011 | 0.505 |
| −0.10 | −0.0515 | 0.515 |
| −0.05 | −0.0301 | 0.602 |
| +0.05 | +0.0254 | 0.509 |
| +0.10 | +0.0470 | 0.470 |
| +0.20 | +0.0906 | 0.453 |

About **45–60 % of the planted drift survives to the mean**, and the fraction
falls as `d` grows. This is **not** a defect: template 1 exits at ±1R, so a
trade that hits its target before the ramp accumulates collects `+1R` and no
more. G1 proves the point exactly — on the 5,093 trades actually held to the
forced flat, the recovered drift is `d` to fourteen decimal places. The
bracket, not the engine, is what attenuates. The attenuation is close to
symmetric in the sign of `d` (0.51 at −0.20 vs 0.45 at +0.20), which is itself
the expected asymmetry: a downward drift converts targets into stops slightly
more readily than an upward drift does the reverse.

**Consequence for reading the ledger:** a true mechanic edge of `x` R per trade
reaches the ladder's mean as roughly `0.5x`. The `+0.10R` build bar therefore
demands a true post-entry drift of about **`+0.20R`**, not `+0.10R`.

### A.4 Empirical power curve

| `d` planted | realised mean net R (8-arm avg) | arms with `p_A ≤ α` | arms with bootstrap excluding 0 | arms with mean ≥ `+0.10R` | **arms reaching REAL EDGE** | `nullA_mean` |
|---|---|---|---|---|---|---|
| 0.00 | −0.0069 | 0/8 | 0/8 | 0/8 | **0/8** | −0.0527 |
| 0.05 | +0.0185 | 2/8 | 1/8 | 0/8 | **0/8** | −0.0528 |
| 0.10 | +0.0401 | 4/8 | 2/8 | 1/8 | **1/8** | −0.0527 |
| 0.20 | +0.0837 | 6/8 | 4/8 | 3/8 | **3/8** | −0.0526 |

Verdict distribution: at `d=0`, 7 NO EDGE / 1 INCONCLUSIVE / 0 REAL EDGE — the
ladder does **not** fire on the unplanted tape. Under every **inverted** plant
(`d < 0`) the result is 8/8 NO EDGE, as it must be.

Three things to read off this table:

* **α is not the binding gate.** 8 cells cleared `p_A ≤ 0.00625` without
  clearing `+0.10R`; **zero** cells cleared `+0.10R` without clearing α. The
  verdict function was identical to `mean ≥ +0.10R` on all 56 cells. Red team
  §1's "the α gate and the +0.10R bar coincide at ≈ +0.11R" is empirically
  wrong in a way that *tightens* its own conclusion: the mean bar binds alone.
* **Null-A did not leak.** `nullA_mean` moves by `0.0003R` across a `0.40R`
  sweep of planted drift (`ρ ≈ 0.0004`). The confound registered in `DESIGN`
  A.4 is absent, so this power curve needs no lower-bound caveat.
* **This is an upper bound on real power.** A fit-only calibration satisfies
  the ladder's "fit agrees" clause automatically. A real registration must
  clear the same bar on a *separate* holdout year, so its true pass rate at
  `d = 0.20` is below 3/8.

---

## TEST B — the overnight index premium through the same tape and primitives

Capital.com 1m tape, `2024-01-01 .. 2025-07-31`, 391 matched overnight pairs
and 392 matched intraday days per instrument, **zero unmatched bars**.

### B.1 The stop condition — engine vs the tape's own arithmetic

| instrument | arm | n | engine gross %/leg | tape arithmetic %/leg | **\|gross − arithmetic\|** | engine net % | \|net − arithmetic\| | applied spread % | `\|net−arith\| − spread` | within spread? |
|---|---|---|---|---|---|---|---|---|---|---|
| US500 | B-ON | 391 | +0.055460 | +0.055460 | **0.0 exactly** | +0.046251 | 0.009209 | 0.009209 | `+1.2e-17` | **YES** |
| US500 | B-DAY | 392 | +0.025112 | +0.025112 | **0.0 exactly** | +0.015898 | 0.009214 | 0.009214 | `−1.0e-17` | **YES** |
| US100 | B-ON | 391 | +0.080518 | +0.080518 | **0.0 exactly** | +0.071194 | 0.009324 | 0.009324 | `+1.7e-18` | **YES** |
| US100 | B-DAY | 392 | +0.014431 | +0.014431 | **0.0 exactly** | +0.005114 | 0.009317 | 0.009317 | `+8.7e-18` | **YES** |

**B1 passes in the strongest form the test admits.** The two bar-locating paths
— `engine.flat_index` + `common.ny_ms` + `searchsorted` over `Tape.t` on one
side, an independent pandas `tz_convert` + wall-clock string match on the other
— select the **same bar and the same price on every one of 783 legs per
instrument**, max price deviation `0.0`. The engine's net return differs from
the tape's arithmetic by **exactly** the spread it charges, to `1e-17`. Nothing
in fills or timestamps is wrong. **No escalation.**

> A note on process: the first run reported B1 as *failed* on three of four
> arms. The cause was in this package's own harness — the comparison was
> `|dev| <= spread` and `|dev|` equals `spread` to the last bit, so the
> floating-point tie fell the wrong way. Fixed to a `1e-9` relative tolerance
> and re-run, per `DESIGN` §0.4; the underlying numbers did not change and are
> the ones tabulated above. Logged rather than quietly corrected.

### B.2 The effect itself

| | US500 | US100 |
|---|---|---|
| close→open (B-ON), gross %/night | **+0.0555** | **+0.0805** |
| open→close (B-DAY), gross %/day | +0.0251 | +0.0144 |
| **B2 — overnight > intraday?** | **YES** | **YES** |
| t-stat (B-ON, gross) | 1.62 | 1.81 |
| annualised Sharpe (B-ON, gross) | 1.30 | 1.45 |
| net after spread | +0.0463 | +0.0712 |
| mean nights held (Fri→Mon = 3) | 1.47 | 1.47 |
| net after financing, 1.1 bp/night | +0.0300 | +0.0550 |
| net after financing, 2.4 bp/night | +0.0109 | +0.0358 |

| B3/B4 — independent external source (Yahoo daily, unadjusted, identical day list) | US500 / SPY | US100 / QQQ |
|---|---|---|
| ETF close→open %/night | +0.05724 | +0.08884 |
| CFD close→open %/night | +0.05546 | +0.08052 |
| **same sign?** | **YES** | **YES** |
| difference | −0.18 bp | −0.83 bp |
| **B4 — within ±3 bp?** | **YES** | **YES** |
| ETF t-stat | 1.63 | 1.98 |

**B2, B3 and B4 all pass.** One pre-registered *sub*-prediction inside B4 was
wrong and is flagged rather than buried: `DESIGN` B.4 predicted the CFD would
be **higher** than the unadjusted ETF by the dividend drag; it is **lower**, by
0.18 bp on US500 and 0.83 bp on US100. The B4 criterion itself (±3 bp) is met
with room, and the sign and magnitude of the effect agree across two entirely
independent data sources. As pre-registered, **no verdict is issued on Test B**:
at t = 1.6–1.8 over 391 nights it could not clear α = 0.00625, exactly as
`DESIGN` B.1 said in advance.

---

## TEST C — cross-sectional crypto momentum as the portfolio harness's Stage 0

Universe: a snapshot of `research/crosssec-instruments-in-play/`'s pull, taken
`2026-09-16T21:47:02Z` — **860 USDT-margined perp symbols**, 2,039 daily bars,
`2020-01-01 .. 2025-07-31`. **Nothing was re-pulled.** The universe is
genuinely survivorship-free: `LUNAUSDT` (466 days), `FTTUSDT` (1,204),
`SRMUSDT` and `BTCSTUSDT` are all present with their truncated histories. The
wide panel reproduces the raw parquet closes with **max deviation `0.0`** on
every spot-checked symbol.

| `k` (trailing weeks) | rebalance dates used | dates dropped (<50 names) | mean leg size | **mean weekly long–short** | weekly sd | **plain t** | NW(4) t | ann. Sharpe | hit rate | long leg | short leg |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 254 | 35 | 41 | **+0.138 %** | 7.70 % | **+0.29** | +0.29 | 0.13 | 48.8 % | +0.818 % | +0.680 % |
| 2 | 253 | 35 | 41 | **+0.764 %** | 7.87 % | **+1.55** | +1.57 | 0.70 | 53.8 % | +1.442 % | +0.678 % |
| 3 | 252 | 35 | 40 | **+0.302 %** | 7.99 % | **+0.60** | +0.61 | 0.27 | 50.4 % | +1.168 % | +0.866 % |
| 4 | 251 | 35 | 40 | **+0.366 %** | 8.07 % | **+0.72** | +0.84 | 0.33 | 54.2 % | +1.275 % | +0.909 % |

Universe size at rebalance: min 51, median 159, max 488. 74–78 names per arm
were carried at a last-available close through a mid-week delisting. C3 (legs
≥ 10 names on ≥ 90 % of dates) and C4 (date counts within 10 % of `k=1`) both
pass; the harness is not degenerate and it fires at a comparable rate across
horizons.

### C.1 verdict: **FAIL — the harness is uncertified**

* **Sign: correct on all four horizons.** The long–short spread is positive at
  every `k`, and the long leg beats the short leg at every `k`. The published
  direction reproduces.
* **Significance: not reached on any horizon.** The pre-registered bar was
  `t ≥ 2`; the best horizon reaches `t = 1.55`.

Per `DESIGN` C.3, written before the number was seen, this is **not
automatically a harness bug**, and it is equally not a pass. The paper's sample
is 2014–2020 **coins**, market-cap weighted, spot; this is 2020–2025
**equal-weighted USDT perps**. Either the effect is weaker out of sample and
out of universe, or the harness has a defect — and this test cannot
distinguish them. **The honest status is: the portfolio harness has not been
certified, and the cross-sectional family's eventual verdict on the RVOL
selector does not yet inherit any credibility from a reproduced published
factor.**

### C.2 The reason it could not have passed, and why that is the finding

The weekly long–short series has `sd = 7.87 %` over 253 dates, so
`SE = 0.494 %/week`. **`t ≥ 2` therefore required a spread of `≥ 0.989 %/week`,
i.e. an annualised Sharpe of 0.91.** The realised `k = 2` spread of
`0.764 %/week` is **77 % of that bar**.

This is red team §1's thesis reappearing inside its own positive control: the
test was set a Sharpe-0.91 hurdle and handed a Sharpe-0.70 object. Fifty
instruments × 250 days did **not** buy the ~40× observation gain §1 credited it
with, because a cross-sectional long–short portfolio yields **one** return per
week, not fifty — 253 observations, not 12,650. The sample size that matters is
the number of *rebalances*, and on that axis the cross-sectional family has
**fewer** independent observations than the single-instrument ORB arms it was
meant to improve on (253 weeks vs 370 trades).

**This is the most consequential number in this report and it goes to the
Architect.** It does not say the cross-sectional family is wrong; it says the
power argument used to prefer it needs restating in terms of rebalances.

---

## What this means for the 30 kills

| claim | status after this pass |
|---|---|
| the engine's fills and timestamps are correct | **verified** — Test A G0–G2, Test B B1 to `1e-17` |
| the cost model is neither double-counted nor sign-flipped | **verified** — Test A G5 to `8e-16`, plus red team §6.0 |
| there is no systematic sign or look-ahead error | **verified** — Test A G4, 8/8 arms, both directions |
| the nulls and bootstrap behave | **verified** — Test A G7 56/56; Null-A does not leak |
| the ladder fires on a real edge when one is present | **verified** — 3/8 arms at `d = 0.20` |
| the ladder does *not* fire on an unplanted tape | **verified** — 0/8 REAL EDGE at `d = 0`, 0/8 under every inversion |
| **the 30 kills are honest kills** | **yes** |
| the portfolio harness reproduces a published factor | **NOT established** — Test C |

Two corrections to red team §1 fall out, both of which make its conclusion
stronger rather than weaker:

1. **The `+0.10R` mean bar binds alone; α never binds.** Any future design
   discussion about loosening or tightening the ladder should be about that
   number and not about the Bonferroni correction.
2. **The bracket halves the edge on its way to the mean.** A mechanic must
   carry a true post-entry drift of ≈ `+0.20R` for its *measured* mean to reach
   `+0.10R`. Nothing in the published single-instrument intraday record is that
   large — which is §1's conclusion, arrived at independently and with a
   factor-of-two larger gap than §1 assumed.

---

## Files

```
research/_calibration/
  DESIGN.md                      pre-registration (commit f2f525a)
  REPORT.md                      this file
  testa.py  testb.py  testc.py   the three harnesses
  results/
    testA_recovery.csv           8 arms x 7 drifts, full ladder output
    testA_gates.csv              G0/G1/G5/G7 per cell
    testA_g2_identity.csv        replay vs committed fit_describe.csv
    testA_summary.csv            G3/G4 per arm
    testA_power.csv              the empirical power curve
    testB_overnight.csv          B1-B2, both instruments, both arms
    testB_US500_ON.csv           per-night overnight series
    testB_US100_ON.csv
    testB_external.csv           B3/B4 vs SPY/QQQ
    testC_xsmom.csv              per-horizon long-short summary
    testC_weekly.csv             the weekly long-short series
    testC_snapshot.txt           universe snapshot timestamp
    crosssec_listing_snapshot.json
```

`testc.py` imports no package constant and is ready to be lifted into
`research/crosssec-instruments-in-play/` as that package's Stage 0.
