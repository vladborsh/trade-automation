# REPORT — Opening-range breakout at the New York open (`orb-ny-open`)

**Pre-registration:** `DESIGN.md`, committed at `82d6c0b` **before any R was computed on any arm and before any model was trained**; binding ruling `ARCHITECT-NOTE.md` (`7ff19fc`). Holdout cut once, at the end.

## The eight pre-registered verdicts

On the pre-registered gate — **template 1** (+1R target, forced flat at 16:00 NY), holdout 2025-08-01 .. 2026-07-31, ladder at α = 0.05/8 = 0.00625 — the result is **NO EDGE — KILL** on 8 of 8. Every arm was powered: realised `n_holdout` ran 207–236, against a floor of 150.

| arm | n_hold | **holdout mean net R** | gross R | fit mean net R | Null-A p | Null-B p | 90 % day-block bootstrap | **verdict** |
|---|---|---|---|---|---|---|---|---|
| `US100-5m` | 222 | **+0.0332R** | +0.0449R | +0.0572R | 0.168 | 0.212 | [-0.056, +0.117] | **NO EDGE — KILL** |
| `US100-15m` | 207 | **+0.0418R** | +0.0526R | +0.0364R | 0.140 | 0.168 | [-0.044, +0.131] | **NO EDGE — KILL** |
| `US500-5m` | 236 | **-0.0179R** | -0.0021R | -0.0438R | 0.436 | 0.416 | [-0.108, +0.073] | **NO EDGE — KILL** |
| `US500-15m` | 224 | **+0.0057R** | +0.0208R | -0.0394R | 0.307 | 0.288 | [-0.082, +0.096] | **NO EDGE — KILL** |
| `BTCUSDT-5m` | 228 | **-0.1231R** | -0.0193R | -0.0008R | 0.718 | 0.648 | [-0.222, -0.030] | **NO EDGE — KILL** |
| `BTCUSDT-15m` | 222 | **-0.0655R** | +0.0325R | +0.0042R | 0.332 | 0.316 | [-0.157, +0.027] | **NO EDGE — KILL** |
| `ETHUSDT-5m` | 220 | **+0.0132R** | +0.0879R | -0.0253R | 0.060 | 0.048 | [-0.083, +0.106] | **NO EDGE — KILL** |
| `ETHUSDT-15m` | 208 | **+0.0470R** | +0.1198R | -0.0436R | 0.024 | 0.012 | [-0.044, +0.145] | **NO EDGE — KILL** |

Per-arm reasons, mechanically from the ladder:

- **`US100-5m` — NO EDGE — KILL.** holdout mean net R +0.033R < the pre-registered +0.05R kill bar.
- **`US100-15m` — NO EDGE — KILL.** holdout mean net R +0.042R < the pre-registered +0.05R kill bar.
- **`US500-5m` — NO EDGE — KILL.** holdout mean net R -0.018R < the pre-registered +0.05R kill bar.
- **`US500-15m` — NO EDGE — KILL.** holdout mean net R +0.006R < the pre-registered +0.05R kill bar.
- **`BTCUSDT-5m` — NO EDGE — KILL.** holdout mean net R -0.123R < the pre-registered +0.05R kill bar.
- **`BTCUSDT-15m` — NO EDGE — KILL.** holdout mean net R -0.065R < the pre-registered +0.05R kill bar.
- **`ETHUSDT-5m` — NO EDGE — KILL.** holdout mean net R +0.013R < the pre-registered +0.05R kill bar.
- **`ETHUSDT-15m` — NO EDGE — KILL.** holdout mean net R +0.047R < the pre-registered +0.05R kill bar.

**Slippage is not modelled, so every number in this report is optimistic.** No commission is modelled on the Capital.com arms and no financing on any arm (every trade is flat by 16:00 NY).

### Template 2 (pure ORB) — the secondary, no verdict

Template 2 is the literal hypothesis: the breakout's direction persists to the close. It carries **no verdict** (`DESIGN.md` §3.4); it is here so a reader can see whether the +1R cap made or unmade the number.

| arm | fit mean net R (t2) | holdout mean net R (t2) | holdout t1 (the gate) |
|---|---|---|---|
| `US100-5m` | +0.0614R | +0.0142R | +0.0332R |
| `US100-15m` | +0.0433R | +0.0402R | +0.0418R |
| `US500-5m` | +0.0308R | -0.0146R | -0.0179R |
| `US500-15m` | +0.0225R | -0.0232R | +0.0057R |
| `BTCUSDT-5m` | -0.0088R | -0.0878R | -0.1231R |
| `BTCUSDT-15m` | +0.0079R | -0.0323R | -0.0655R |
| `ETHUSDT-5m` | +0.0646R | +0.1059R | +0.0132R |
| `ETHUSDT-15m` | +0.0096R | +0.1375R | +0.0470R |

**Straddle notice (§3.4).** 2 arm(s) reach or exceed the +0.10R build bar on **template 2** while their template-1 verdict is a kill: `ETHUSDT-5m` (+0.1059R), `ETHUSDT-15m` (+0.1375R). Per the pre-registration each arm's verdict remains **template 1's** — stated here in the first section and not revised — and this is grounds for **one** Architect-authorised follow-up registration of template 2 as its own arm, with its own α, its own ladder and its own nulls. It is **never** a re-labelling of these arms. Raised in `HANDOFF.md`.

Two cautions belong with that number, so it is not read as a result. Template 2's holdout figures were **not** subjected to Null A, Null B or the bootstrap — the pre-registration runs those on the gating template only, so there is no p-value and no interval behind +0.1375R. And on the fit period the same arms were at +0.0096R to +0.0646R, i.e. the fit and holdout do not agree in magnitude. A fresh registration is exactly the right way to find out whether it is anything; reading it off this table is not.

### Power — the contingency did not fire

`DESIGN.md` §8.2 required a projection **on the fit period only, before the holdout was touched**, and committed the cutoff decision at `290260e`. Projected `n_holdout` ran 215–241 on the base [10:00, 12:00) NY window, so **no arm used the widened 13:30 window** and no arm ever will in this pass.

| arm | fit eligible days | fit triggered | share | projected n_hold | **realised n_hold** |
|---|---|---|---|---|---|
| `US100-5m` | 392 | 370 | 0.944 | 234 | **222** |
| `US100-15m` | 392 | 348 | 0.888 | 220 | **207** |
| `US500-5m` | 391 | 378 | 0.967 | 241 | **236** |
| `US500-15m` | 391 | 368 | 0.941 | 234 | **224** |
| `BTCUSDT-5m` | 392 | 367 | 0.936 | 233 | **228** |
| `BTCUSDT-15m` | 392 | 351 | 0.895 | 223 | **222** |
| `ETHUSDT-5m` | 392 | 358 | 0.913 | 227 | **220** |
| `ETHUSDT-15m` | 392 | 339 | 0.865 | 215 | **208** |

The Architect's §3.3 assumption was that 60–80 % of eligible days would break out by 12:00 NY; the realised fit-period share is 86.5%–96.7%. A *close* beyond a 30-minute range within the following two hours is simply a common event. The projection tracked reality closely (worst arm: projected 215, realised 207).

### Data, exclusions and the four stop-rule checks

- **Coverage (§2.2).** US100's committed `COVERAGE.md` row and section reproduce **byte-identically** from the raw NDJSON (971,812 bars, 0 duplicate timestamps, 0 non-monotone, 0 zero-volume). US500, pulled and converted during this pass, audits clean at 954,943 bars with the same span and the same eight no-data weekdays. Kept in `results/COVERAGE-AUDIT.md`.
- **Grid (§2.3).** 1,024 NYSE session days checked, **0 violations**: 09:30 NY lands at 13:30 or 14:30 UTC and both sit on the 5- and 15-minute epoch grid, so the NY-anchored bins and the UTC-aligned bins are the same object under either DST offset.
- **Look-ahead (§7.1).** 56 trades sampled across all eight arms, every feature recomputed from a 1-minute tape **truncated at the entry minute**: 1,344 cells compared, max relative difference **0**, **0 violations**.
- **Fills (§3.5).** Exact agreement (max absolute difference **0**) between the 1-minute path and the arm-bar OHLC on 4,841 of 4,851 trades. The 10 excluded trades (all US500) are ones that gap the stop or touch both levels inside one bar — and on **none** of them is the 1-minute fill kinder than the bar fill, which is a stronger statement than §3.5 asked for.
- **Session (§3.4).** 0 trades out of 4,851 cross 16:00 NY on any arm.

One correction was made during the pass and is logged as amendment 2 in `DESIGN.md` §12: `or_rvol` / `bar_rvol` were initially built over prior *triggered* sessions instead of the binding note's prior **eligible** sessions, which silently and non-randomly discarded 846 of 1,473 (5m) and 508 of 1,406 (15m) fit trades from Study B. It was found and fixed **before any model was trained**. Test A was unaffected and this was verified rather than assumed: the rebuilt tables are bit-identical in `netR_1` and `grossR_1` across all 4,851 rows, because no feature enters the signal.

Exclusions per arm (days dropped before any trade logic runs) are in `results/exclusions.csv`. NYSE full closures and 1:00 pm early closes are excluded on **all** arms including crypto, because the anchor under test is the US cash open; the Capital.com CFD tape trades through most US holidays, so bar presence is not evidence of a cash open.

---

## Descriptive rows — no verdict attaches to anything below

### Per-arm detail, fit and holdout (template 1)

| arm | period | n | mean net R | median | gross R | mean cost R | win % | % long | median stop (ATR) | median hold (min) |
|---|---|---|---|---|---|---|---|---|---|---|
| `US100-5m` | fit | 370 | **+0.0572R** | +0.1533R | +0.0739R | 0.0167R | 53.5 | 54.1 | 4.05 | 192 |
| `US100-5m` | holdout | 222 | **+0.0332R** | +0.1102R | +0.0449R | 0.0118R | 53.2 | 54.1 | 4.31 | 270 |
| `US100-15m` | fit | 348 | **+0.0364R** | +0.0992R | +0.0521R | 0.0157R | 53.4 | 54.6 | 3.38 | 214 |
| `US100-15m` | holdout | 207 | **+0.0418R** | +0.1023R | +0.0526R | 0.0108R | 54.1 | 56.5 | 3.67 | 285 |
| `US500-5m` | fit | 378 | **-0.0438R** | -0.0828R | -0.0139R | 0.0299R | 48.7 | 54.8 | 3.82 | 150 |
| `US500-5m` | holdout | 236 | **-0.0179R** | -0.0073R | -0.0021R | 0.0157R | 49.2 | 55.1 | 3.98 | 193 |
| `US500-15m` | fit | 368 | **-0.0394R** | -0.0727R | -0.0114R | 0.0279R | 48.9 | 53.8 | 3.03 | 164 |
| `US500-15m` | holdout | 224 | **+0.0057R** | +0.0075R | +0.0208R | 0.0151R | 50.4 | 55.8 | 3.26 | 238 |
| `BTCUSDT-5m` | fit | 367 | **-0.0008R** | +0.2032R | +0.0950R | 0.0958R | 53.4 | 50.7 | 3.88 | 122 |
| `BTCUSDT-5m` | holdout | 228 | **-0.1231R** | -0.1963R | -0.0193R | 0.1038R | 46.1 | 50.0 | 3.95 | 136 |
| `BTCUSDT-15m` | fit | 351 | **+0.0042R** | +0.0891R | +0.0934R | 0.0892R | 53.0 | 50.4 | 2.91 | 165 |
| `BTCUSDT-15m` | holdout | 222 | **-0.0655R** | -0.0721R | +0.0325R | 0.0980R | 48.2 | 52.7 | 2.88 | 194 |
| `ETHUSDT-5m` | fit | 358 | **-0.0253R** | +0.0554R | +0.0565R | 0.0818R | 51.1 | 47.8 | 3.60 | 110 |
| `ETHUSDT-5m` | holdout | 220 | **+0.0132R** | +0.0874R | +0.0879R | 0.0747R | 52.3 | 46.4 | 3.80 | 142 |
| `ETHUSDT-15m` | fit | 339 | **-0.0436R** | -0.0561R | +0.0324R | 0.0760R | 49.3 | 48.4 | 2.58 | 146 |
| `ETHUSDT-15m` | holdout | 208 | **+0.0470R** | +0.1346R | +0.1198R | 0.0729R | 54.3 | 47.1 | 2.78 | 172 |

**Cost in R is small, as the Architect predicted it would be** for a stop set at the full opening range: 0.016–0.096R across the arms, against the cmc-bot pass's 0.25–0.40R. Costs are therefore not what decides these arms; the gross numbers are near zero on their own.

### Exit causes (fit period)

| arm | n | target | stop | time-exit | t2 stop | t2 time-exit |
|---|---|---|---|---|---|---|
| `US100-5m` | 370 | 141 | 114 | 115 | 128 | 242 |
| `US100-15m` | 348 | 120 | 107 | 121 | 116 | 232 |
| `US500-5m` | 378 | 151 | 155 | 72 | 165 | 213 |
| `US500-15m` | 368 | 143 | 146 | 79 | 154 | 214 |
| `BTCUSDT-5m` | 367 | 160 | 118 | 89 | 139 | 228 |
| `BTCUSDT-15m` | 351 | 141 | 102 | 108 | 117 | 234 |
| `ETHUSDT-5m` | 358 | 150 | 125 | 83 | 147 | 211 |
| `ETHUSDT-15m` | 339 | 126 | 107 | 106 | 127 | 212 |

### Per side (fit period, template 1)

| arm | side | n | mean net R | win % |
|---|---|---|---|---|
| `US100-5m` | long | 200 | +0.0635R | 55.0 |
| `US100-5m` | short | 170 | +0.0498R | 51.8 |
| `US100-15m` | long | 190 | +0.0396R | 54.7 |
| `US100-15m` | short | 158 | +0.0325R | 51.9 |
| `US500-5m` | long | 207 | -0.0419R | 49.8 |
| `US500-5m` | short | 171 | -0.0461R | 47.4 |
| `US500-15m` | long | 198 | -0.0263R | 51.5 |
| `US500-15m` | short | 170 | -0.0545R | 45.9 |
| `BTCUSDT-5m` | long | 186 | +0.0096R | 54.3 |
| `BTCUSDT-5m` | short | 181 | -0.0114R | 52.5 |
| `BTCUSDT-15m` | long | 177 | -0.0123R | 52.5 |
| `BTCUSDT-15m` | short | 174 | +0.0210R | 53.4 |
| `ETHUSDT-5m` | long | 171 | -0.0780R | 49.1 |
| `ETHUSDT-5m` | short | 187 | +0.0228R | 52.9 |
| `ETHUSDT-15m` | long | 164 | -0.0825R | 47.6 |
| `ETHUSDT-15m` | short | 175 | -0.0071R | 50.9 |

### Non-circular forward lift (fit period)

Built as `session-liquidity-v5-ny/tables.py:block_L`: each signal's post-entry MFE in ATR over its own horizon, over the **median** unconditional forward MFE for the same direction and horizon bucket, measured from random comparable stretches of the same tape. 1.00 = no better than a random comparable stretch.

| arm | n | median lift | % ≥ 1 |
|---|---|---|---|
| `US100-5m` | 370 | 1.167 | 58.1 |
| `US100-15m` | 348 | 1.138 | 54.6 |
| `US500-5m` | 378 | 1.216 | 58.5 |
| `US500-15m` | 368 | 1.164 | 55.7 |
| `BTCUSDT-5m` | 367 | 1.227 | 56.7 |
| `BTCUSDT-15m` | 351 | 1.234 | 55.6 |
| `ETHUSDT-5m` | 358 | 1.161 | 55.9 |
| `ETHUSDT-15m` | 339 | 1.035 | 51.9 |

Every arm's median lift is above 1.00, i.e. a breakout bar is followed by more favourable excursion than a random bar in the same window — and yet the traded expectancy is not. That gap is the finding worth keeping: the directional information is real but too small to survive a stop at the opposite side of the range plus costs. Read it with the exit-cause table.

### The two crypto controls (§4.2)

| row | arm | period | n | mean net R | win % |
|---|---|---|---|---|---|
| pre-etf | `BTCUSDT-15m` | pre-etf | 291 | +0.0265R | 54.3 |
| pre-etf | `BTCUSDT-5m` | pre-etf | 316 | -0.0199R | 53.2 |
| pre-etf | `ETHUSDT-15m` | pre-etf | 294 | -0.0001R | 50.7 |
| pre-etf | `ETHUSDT-5m` | pre-etf | 309 | -0.0205R | 52.8 |
| weekend | `BTCUSDT-15m` | fit | 141 | -0.3187R | 44.0 |
| weekend | `BTCUSDT-15m` | holdout | 93 | -0.3572R | 41.9 |
| weekend | `BTCUSDT-5m` | fit | 147 | -0.3836R | 41.5 |
| weekend | `BTCUSDT-5m` | holdout | 97 | -0.3955R | 42.3 |
| weekend | `ETHUSDT-15m` | fit | 140 | -0.3117R | 40.7 |
| weekend | `ETHUSDT-15m` | holdout | 93 | -0.4074R | 37.6 |
| weekend | `ETHUSDT-5m` | fit | 147 | -0.2895R | 41.5 |
| weekend | `ETHUSDT-5m` | holdout | 95 | -0.4074R | 40.0 |

**Weekend row.** Every weekend row is strongly negative (-0.407R to -0.289R), far below the corresponding arms. The pre-registered reading only bites if a crypto arm **passes** and its weekend row is at or above the arm's holdout mean — and no crypto arm passes, so **nothing is inferred** from this. Recorded as the pre-registration requires. For what it is worth descriptively, the same clock without a cash open is much worse, which is the direction the anchor story would want; it is not evidence, because the anchored arms are themselves at zero.

**Pre-ETF row.** 2022-08-01 .. 2023-12-31 gives -0.020R to +0.027R, against a crypto **fit** range of -0.044R to +0.004R. The pre-ETF period is **not weaker** than the ETF era — the two are indistinguishable, both at zero. Per `DESIGN.md` §4.2 this is reported as what it is: **the ETF-transmission story gets no support from the tape.** The honest summary is that the pre-ETF row and the ETF-era arms are both consistent with there being no imported-anchor effect at all, which is the simplest reading of a null on both sides.

### Sensitivities — fit period only, non-gating, every one that was run

#### Mechanic (§3.6)

| arm | pre-registered | S1 OR width 15m | S2 OR width 60m | S3 stop at OR midpoint | S4 re-entry once after a stop |
|---|---|---|---|---|---|
| `BTCUSDT-15m` | **+0.0042R** | -0.0144R | +0.0141R | -0.0617R | -0.0130R |
| `BTCUSDT-5m` | **-0.0008R** | -0.0089R | -0.0177R | -0.0786R | -0.0038R |
| `ETHUSDT-15m` | **-0.0436R** | -0.0874R | -0.0108R | -0.0888R | -0.0157R |
| `ETHUSDT-5m` | **-0.0253R** | -0.1077R | -0.0187R | -0.0912R | -0.0012R |
| `US100-15m` | **+0.0364R** | +0.0715R | +0.0121R | +0.0045R | +0.0139R |
| `US100-5m` | **+0.0572R** | +0.0882R | +0.0053R | -0.0094R | +0.0401R |
| `US500-15m` | **-0.0394R** | -0.0302R | +0.0187R | -0.0735R | -0.0335R |
| `US500-5m` | **-0.0438R** | -0.0312R | +0.0050R | -0.0328R | -0.0016R |

None of these may change a verdict and none was computed on the holdout. They are shown including the ones that came out worse. The stop-at-the-midpoint row (S3) is negative on seven of eight arms, which is the expected direction: halving the stop doubles `cost_R` and raises the stop rate, and the pre-registered full-range stop is the cheap-in-R one.

#### Costs (holdout, template 1)

| arm | pre-registered | 2x per-bar spread | fixed fit-median spread | 0.04% round trip (maker) |
|---|---|---|---|---|
| `US100-5m` | **+0.0332R** | +0.0214R | +0.0333R | — |
| `US100-15m` | **+0.0418R** | +0.0311R | +0.0418R | — |
| `US500-5m` | **-0.0179R** | -0.0336R | -0.0179R | — |
| `US500-15m` | **+0.0057R** | -0.0094R | +0.0060R | — |
| `BTCUSDT-5m` | **-0.1231R** | — | — | -0.0608R |
| `BTCUSDT-15m` | **-0.0655R** | — | — | -0.0067R |
| `ETHUSDT-5m` | **+0.0132R** | — | — | +0.0580R |
| `ETHUSDT-15m` | **+0.0470R** | — | — | +0.0907R |

---

## Study B — the LightGBM feature study: **hypothesis-generating only**

**Nothing in this section is an edge, a verdict, or a parameter change to Test A.** It asks a different question with a weaker standard of evidence: *which conditions correlate with an ORB trade working better?* Test A above was settled first and separately. A feature flagged here earns a **proposal for a new pre-registered arm**, never a rescue of a killed one.

Trained on the **fit period only**, one model per timeframe pooled across the four instruments with `instrument` as a categorical column. Fixed shallow hyper-parameters, no tuning (`num_leaves=7`, `max_depth=3`, `min_data_in_leaf=30`, `learning_rate=0.03`, `lambda_l2=10.0`, `feature_fraction=0.8`, `bagging_fraction=0.8`), `n_estimators` by early stopping on blocked chronological 5-fold CV with a 5-session purge gap, seeds 0–4 averaged. Pinned: Python 3.9.6, lightgbm 4.6.0, shap 0.49.1, scikit-learn 1.6.1, numpy 2.0.2, pandas 2.3.3.

| timeframe | n_fit | dropped on warm-up | CV rounds (median) | out-of-fold Spearman | null-max 95th pct | **features flagged** |
|---|---|---|---|---|---|---|
| 5m | 1436 | 37 | 3 | +0.0224 | 0.00431321 | **none** |
| 15m | 1369 | 37 | 1 | -0.0071 | 0.00480949 | **none** |

The flagging rule was fixed in advance (`DESIGN.md` §9.3): 200 refits of the **whole pipeline** with `netR` permuted within instrument and within fit-year, each recording the maximum permutation importance over all 24 features; a feature is flagged only if its real permutation importance exceeds the **95th percentile of that null-max distribution**. That controls the family-wise error rate across the 24 comparisons (Westfall–Young style) — without it, roughly one feature would look 'important' by chance every run. **Gain and split count are not reported at all**, by design: they are biased toward high-cardinality columns and `tod_min` and the continuous distances would win by construction.

#### 5m — permutation and SHAP importance, all 24 features (+ `instrument`)

| feature | permutation ΔMSE | SHAP mean abs | fit SHAP direction | flagged |
|---|---|---|---|---|
| `ema200_slope` | +0.00187299 | 0.0089652 | +0.426 | — |
| `rsi15` | +0.0012762 | 0.00292983 | +0.214 | — |
| `rsi20` | +0.000969877 | 0.00285488 | +0.308 | — |
| `or_body` | +0.000841046 | 0.00554866 | -0.071 | — |
| `gap_datr` | +0.000559079 | 0.00366632 | -0.374 | — |
| `pd_level_d` | +0.000544751 | 0.0105042 | -0.393 | — |
| `ema50_d` | +0.000528641 | 0.00196409 | +0.238 | — |
| `or_width_datr` | +0.000476433 | 0.00356423 | -0.363 | — |
| `overshoot_atr` | +0.000461862 | 0.00185238 | -0.192 | — |
| `ema20_d` | +0.000348388 | 0.0020959 | -0.007 | — |
| `tod_min` | +0.000319879 | 0.00129358 | +0.212 | — |
| `atr_regime` | +0.000315574 | 0.00247671 | +0.032 | — |
| `dow` | +0.000249644 | 0.00811055 | +0.337 | — |
| `datr_pct` | +0.000200704 | 0.00535574 | -0.112 | — |
| `ema100_d` | +0.000109975 | 0.00284574 | -0.132 | — |
| `vwap_sess_d` | +0.000107026 | 0.002422 | -0.219 | — |
| `ema200_d` | +0.000100918 | 0.00198956 | -0.049 | — |
| `or_rvol` | +5.22406e-05 | 0.00238102 | -0.511 | — |
| `instrument` | -2.09766e-06 | 3.43845e-05 | -0.003 | — |
| `vwap_day_d` | -5.4668e-06 | 0.000953502 | +0.009 | — |
| `ema_stack` | -5.39929e-05 | 0.000813199 | -0.394 | — |
| `range200_pos` | -0.000160727 | 0.00318946 | -0.326 | — |
| `or_width_atr` | -0.000222011 | 0.00316757 | -0.038 | — |
| `bar_rvol` | -0.00025135 | 0.00159648 | +0.073 | — |
| `prev_day_ret` | -0.000767931 | 0.00270852 | -0.176 | — |

#### 15m — permutation and SHAP importance, all 24 features (+ `instrument`)

| feature | permutation ΔMSE | SHAP mean abs | fit SHAP direction | flagged |
|---|---|---|---|---|
| `atr_regime` | +0.00219012 | 0.00729049 | +0.290 | — |
| `rsi15` | +0.0018682 | 0.00556435 | +0.453 | — |
| `vwap_sess_d` | +0.00100467 | 0.00424063 | -0.417 | — |
| `pd_level_d` | +0.00089103 | 0.00560292 | -0.445 | — |
| `ema50_d` | +0.000641451 | 0.00238154 | -0.033 | — |
| `ema200_d` | +0.000600607 | 0.00429565 | +0.335 | — |
| `vwap_day_d` | +0.000455693 | 0.00415739 | -0.072 | — |
| `rsi20` | +0.00040829 | 0.00174276 | +0.147 | — |
| `dow` | +0.000310984 | 0.00241019 | +0.163 | — |
| `or_rvol` | +0.000310698 | 0.00161687 | -0.288 | — |
| `bar_rvol` | +0.00026588 | 0.00193527 | +0.260 | — |
| `or_width_datr` | +0.000263768 | 0.00411605 | -0.326 | — |
| `prev_day_ret` | +0.000188958 | 0.00400942 | +0.164 | — |
| `tod_min` | +0.000167017 | 0.00171212 | +0.099 | — |
| `ema200_slope` | +0.00016595 | 0.00169336 | +0.002 | — |
| `range200_pos` | +0.000146145 | 0.00423691 | +0.214 | — |
| `overshoot_atr` | +0.000130719 | 0.00126686 | -0.239 | — |
| `ema20_d` | +0.0001111 | 0.00149097 | -0.060 | — |
| `instrument` | -5.51371e-06 | 6.58269e-05 | -0.006 | — |
| `ema_stack` | -4.8318e-05 | 0.00087917 | +0.417 | — |
| `gap_datr` | -6.09095e-05 | 0.00495968 | -0.354 | — |
| `datr_pct` | -0.000223202 | 0.00641184 | -0.166 | — |
| `ema100_d` | -0.000302138 | 0.00214725 | -0.283 | — |
| `or_body` | -0.000375974 | 0.00426018 | -0.174 | — |
| `or_width_atr` | -0.00077457 | 0.0060127 | +0.081 | — |

**No feature was flagged on either timeframe.** That is the expected outcome under no signal, and it is what the pre-registration said would be reported either way. The null-max thresholds were 0.00431321 (5m) and 0.00480949 (15m); the largest real permutation importance was 0.00219012. **There is therefore no proposal to make to the Architect from Study B**, and no conditioned-ORB registration is recommended on this evidence.

Two things should be said plainly about that. First, early stopping fired after very few rounds on most folds, which is what a heavily-regularised model does when there is nothing to fit — it is consistent with the flat result, not an artefact hiding one. Second, a null result here is weaker than a null in Test A: 24 features on roughly 1,400 trades per timeframe cannot rule out a small conditional effect, only fail to find one. Study B not finding a condition is not evidence that no condition exists.

There are **no flagged features**, so §9.4's per-feature holdout read has nothing to report. The score-tercile and Spearman rows above are still shown because the pre-registration asked for them regardless; both intervals span 0 on both timeframes, so the frozen model carries **no out-of-sample skill** either. That is consistent with the flagging result rather than an additional finding.

`rsi14` was computed but is **not a model column** (collinear with `rsi15`, conventional period). Its Pearson correlation with `rsi15` is **0.9995**, which is why.

**`tod_min` and `dow` contest Запись 2**, which found clock filters on crypto do not survive a holdout. Neither is flagged here, so nothing in this pass reopens that entry; had either been flagged it would have been a proposal to test it again, not a reversal.

---

## What this pass settles, and what it does not

**Settles.** The plain opening-range breakout at the NY cash open — fixed 30-minute range, first close beyond it between 10:00 and 12:00 NY, stop at the opposite side, +1R target, flat at 16:00 — does not carry a tradable edge on US100, US500, BTCUSDT or ETHUSDT, on 5-minute or 15-minute bars, over a twelve-month holdout, at costs that are *generously* small. This is a well-powered null: 207–236 trades per arm, eight arms, one shared holdout year.

**Does not settle.** (i) Any *conditioned* ORB — Study B looked and found nothing above its FWER-controlled bar, but 24 features on ~1,400 trades cannot exclude a small conditional effect. (ii) ORB on other instruments, other anchors (Asia/London opens, UTC midnight), futures tapes or SPY/QQQ — all explicitly out of scope per `ARCHITECT-NOTE.md` §8. (iii) Template 2 as a registered arm in its own right. (iv) Whether the forward-lift signal (median > 1.00 on every arm) can be harvested by some *other* exit construction; this pass only shows the pre-registered one does not harvest it.

**No Software Engineer or Backtesting engagement follows from this pass** — that requires a REAL EDGE verdict and a further Architect ruling, and there is none.

---

*Generated by `report.py` from the tables in `results/`. Reproduce with:* `python projection.py && python build.py && python checks.py all && python analysis.py fit && python studyb.py train && python analysis.py holdout && python studyb.py holdout && python report.py`
