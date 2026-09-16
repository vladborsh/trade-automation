# REPORT — Stage 1, the pre-registered test of `cmc-bot`'s VWAP band-reversal strategy

**Date:** 2026-09-16 · Pre-registration: `DESIGN.md`, committed (`8a07a20`) **before any R was computed on any arm or leg**, restating `ARCHITECT-NOTE-STAGE1.md`. The holdout was computed **once**, at the end, and is reported as it came out. Nothing was adjusted after a number was seen.

## The verdict, per pre-registered arm

**US100 — NO EDGE — KILL** (holdout mean net R +0.029, n = 434, Null-A p = 0.628); **US500 — NO EDGE — KILL** (holdout mean net R -0.053, n = 471, Null-A p = 0.914); **BTCUSDT-(a) — NO EDGE — KILL** (holdout mean net R -0.285, n = 442, Null-A p = 0.265); **ETHUSDT-(a) — NO EDGE — KILL** (holdout mean net R -0.083, n = 362, Null-A p = 0.037).

- **US100: NO EDGE — KILL.** holdout mean net R +0.029R < the pre-registered +0.05R kill bar.
- **US500: NO EDGE — KILL.** holdout mean net R -0.053R < the pre-registered +0.05R kill bar.
- **BTCUSDT-(a): NO EDGE — KILL.** holdout mean net R -0.285R < the pre-registered +0.05R kill bar.
- **ETHUSDT-(a): NO EDGE — KILL.** holdout mean net R -0.083R < the pre-registered +0.05R kill bar.

**The primary and the mandatory `live_like=True` secondary row agree on the verdict tier for every pre-registered arm** — no arm's result depends on the bar convention (`DESIGN.md` §2).

**Slippage is not modelled, so every number in this report is optimistic.**

---

## 1. What this measures, and what your past backtests measured (D-01) — read this first

**Any past backtest or grid search of this strategy that was run on Capital.com scraped files (`npm run scrap` → `BacktestRunner`) was measuring hours 2–3 h earlier than its labels said, and is not evidence about the live windows.**

The bot's candle timestamps come back from Capital.com in two fields. `snapshotTimeUTC` is the true bar-open instant; `snapshotTime` is broker-local wall clock (UTC+2 in winter, UTC+3 in summer) with no offset attached, and the bot's offline path parses it as if it were UTC. The deployed bot is unaffected — it streams live and trades the right bars. Its **own backtest** is not: it selects bars 2–3 hours earlier than the labels claim (indices ≈ 06:xx–09:xx New York, i.e. **before the cash open**; forex ≈ 00:xx–01:xx New York). Measured against the live stream, the two share essentially no orders at all: 0 of 895 on US100, 3 of 947 on US500, 0 of 239 on EURCHF, 0 of 241 on GBPCHF.

They are two different strategies wearing the same labels. **This pass measures only the live windows** (`snapshotTimeUTC`), which is what the deployed bot actually trades. The mislabelled hours are not run, not reported and not a sensitivity here, precisely so that nobody compares two things that must not be compared.

The practical consequence: **09:40–11:40 New York on US100/US500, and 03:02/03:03–03:20 New York on EURCHF/GBPCHF, had never been measured by anyone before this pass.** Whatever confidence existed for this strategy before today did not come from a measurement of the windows it trades.

A second caveat on the same footing: the US100/US500 windows used here are the **provisional values you gave by hand**, not the bot's live S3 config. They are this registration's pinned parameters. A different window is a new registration with its own single shot — it is not a rerun of this one.

## 2. What was run

| leg | tape | entry / alive window | fit | holdout | status |
|---|---|---|---|---|---|
| US100 | Capital.com 1m CFD | 09:40–11:40 / 09:40–14:30 NY | 2024-01-01..2025-07-31 | 2025-08-01..2026-07-31 | **pre-registered** |
| US500 | Capital.com 1m CFD | 09:40–11:40 / 09:40–14:30 NY | 2024-01-01..2025-07-31 | 2025-08-01..2026-07-31 | **pre-registered** |
| BTCUSDT-(a) | Binance USD-M perp 1m | 09:40–11:40 / 09:40–14:30 NY | 2022-08-01..2025-07-31 | 2025-08-01..2026-07-31 | **pre-registered** |
| ETHUSDT-(a) | Binance USD-M perp 1m | 09:40–11:40 / 09:40–14:30 NY | 2022-08-01..2025-07-31 | 2025-08-01..2026-07-31 | **pre-registered** |
| EURCHF | Capital.com 1m CFD | 03:02–03:20 / 03:00–04:00 NY | 2024-01-01..2025-07-31 | 2025-08-01..2026-07-31 | descriptive |
| GBPCHF | Capital.com 1m CFD | 03:03–03:20 / 03:00–05:00 NY | 2024-01-01..2025-07-31 | 2025-08-01..2026-07-31 | descriptive |
| BTCUSDT-(b) | Binance USD-M perp 1m | none — 24/7 | 2022-08-01..2025-07-31 | 2025-08-01..2026-07-31 | descriptive |
| ETHUSDT-(b) | Binance USD-M perp 1m | none — 24/7 | 2022-08-01..2025-07-31 | 2025-08-01..2026-07-31 | descriptive |

Four pre-registered arms, α = 0.05/4 = **0.0125** per arm, no pooling, four separate verdicts. Primary population caps-off, as-deployed caps-on as a secondary row, `live_like=True` as a second secondary row, and a non-gating post-holdout tail row (2026-08-01..2026-09-11).

### 2.1 Machine checks that had to pass before any number counted

`engine.py` — the file Stage 0 proved bit-exact against the bot's unmodified TypeScript — **was not edited**. Everything Stage 1 needed went into `stage1_engine.py`, a sibling. Three self-tests, all on the caps-off / `live_like=False` population:

| leg         |   orders |   walker_vs_engine_mismatches |   cross_order_closes |   agreement_set_n |   agreement_violations |
|:------------|---------:|------------------------------:|---------------------:|------------------:|-----------------------:|
| US100       |     1150 |                             0 |                   13 |               586 |                      0 |
| US500       |     1298 |                             0 |                   20 |               576 |                      0 |
| BTCUSDT-(a) |     1677 |                             0 |                   27 |               840 |                      0 |
| ETHUSDT-(a) |     1377 |                             0 |                   16 |               657 |                      0 |
| EURCHF      |      240 |                             0 |                    0 |               128 |                      0 |
| GBPCHF      |      243 |                             0 |                    0 |               122 |                      0 |
| BTCUSDT-(b) |    17095 |                             0 |                 1233 |              9168 |                      0 |
| ETHUSDT-(b) |    15567 |                             0 |                 1193 |              7733 |                      0 |

1. **The trade walker reproduces the engine's own exits.** On every order not closed by the cross-order rule (a BUY and a SELL open at the same time close the earlier one), the walker's bot-native template + bot-native fill gives a bit-identical gross R. Without this the nulls would be testing a different rule than the observation.

2. **`DESIGN.md` §8's agreement stop rule holds.** On every order where no bar touched both levels, the exit bar did not gap through the stop, and both conventions found the same level on the same bar, the bot-native and realistic fills agree bit-for-bit. **0 violations anywhere.** The pass was not stopped.

3. **`run_ablate(drop=None)` returns an order table identical to `engine.run`'s**, so the ablation rows below differ from the bot only in the gate they drop. The global rolling ATR(20) used by the placebo pool equals the engine's per-bar ATR to 1.8e-10 (a summation-order difference; it feeds no gate).

**One limitation, stated plainly.** The four template × fill numbers re-account the *same* set of orders. Re-running the bot loop under a different fill convention would change *which* orders exist (through the ≤ 1-open-order-per-direction rule, and with caps on through the caps), which would make the four numbers incomparable. The cross-order close counts above bound the part of the population that is sensitive to this.

**A pre-registration hygiene disclosure.** The first version of the fit pass also printed a whole-sample row, whose value together with the fit and tail rows implies the holdout mean. That row was produced and seen for **BTCUSDT-(a)** before the holdout pass was run; it was then removed from the code and the pass re-run. Nothing was changed as a result: every threshold, window, split and criterion was already fixed in the committed `DESIGN.md`, the ladder is applied mechanically by `stage1_analysis.verdict()`, and no arm's numbers were recomputed under different settings. It is recorded here because the reader is entitled to know it, not because it changed a result.

## 3. The four pre-registered arms

### 3.1 The primary number (bot-native template, bot-native fill, caps off, backtest bar), holdout

| leg         |   n_fit |   n_holdout |   mean_netR_fit |   mean_netR_holdout |   mean_grossR_holdout |   mean_netR_holdout_livelike |   p_A |   p_B |   boot_lo |   boot_hi | verdict        |
|:------------|--------:|------------:|----------------:|--------------------:|----------------------:|-----------------------------:|------:|------:|----------:|----------:|:---------------|
| US100       |     676 |         434 |           0.086 |               0.029 |                 0.085 |                        0.021 | 0.628 | 0.6   |    -0.089 |     0.149 | NO EDGE — KILL |
| US500       |     776 |         471 |           0.051 |              -0.053 |                 0.016 |                       -0.044 | 0.914 | 0.792 |    -0.157 |     0.057 | NO EDGE — KILL |
| BTCUSDT-(a) |    1181 |         442 |          -0.336 |              -0.285 |                 0.097 |                       -0.267 | 0.265 | 0.552 |    -0.397 |    -0.169 | NO EDGE — KILL |
| ETHUSDT-(a) |     978 |         362 |          -0.238 |              -0.083 |                 0.153 |                       -0.095 | 0.037 | 0.228 |    -0.209 |     0.042 | NO EDGE — KILL |

`p_A` is Null A (matched-time placebo, 1,000 draws, one-sided). `p_B` is Null B (whole-stream day shift, 250 draws), secondary. `boot_lo`/`boot_hi` are the 90 % day-block bootstrap interval (2,000 draws) on the holdout mean net R.

### 3.2 The cost wall

| leg         |   n |   mean_grossR |   mean_cost_R |   median_cost_R |   mean_netR |   win_rate |   median_stop_atr |
|:------------|----:|--------------:|--------------:|----------------:|------------:|-----------:|------------------:|
| US100       | 434 |         0.085 |         0.056 |           0.045 |       0.029 |     28.111 |             2     |
| US500       | 471 |         0.016 |         0.069 |           0.058 |      -0.053 |     28.238 |             1.997 |
| BTCUSDT-(a) | 442 |         0.097 |         0.382 |           0.33  |      -0.285 |     30.317 |             2.123 |
| ETHUSDT-(a) | 362 |         0.153 |         0.236 |           0.215 |      -0.083 |     31.492 |             2.236 |

Read the gross column against the cost column. This is the single biggest fact in the pass and it is a property of the strategy's own geometry, not of the cost model: the stop is a **shrunk** fraction of a 200-bar range, so it is small in price terms, and a cost that is fixed in price terms is therefore large in R terms.

### 3.3 The nulls

| leg         |   n_holdout |   mean_netR |   nullA_mean |   p_A |   nullB_mean |   p_B |   nullB_drop_rate |   boot_lo |   boot_hi |
|:------------|------------:|------------:|-------------:|------:|-------------:|------:|------------------:|----------:|----------:|
| US100       |         434 |       0.029 |        0.052 | 0.628 |        0.066 | 0.6   |             0.472 |    -0.089 |     0.149 |
| US500       |         471 |      -0.053 |        0.043 | 0.914 |        0.061 | 0.792 |             0.461 |    -0.157 |     0.057 |
| BTCUSDT-(a) |         442 |      -0.285 |       -0.33  | 0.265 |       -0.276 | 0.552 |             0.239 |    -0.397 |    -0.169 |
| ETHUSDT-(a) |         362 |      -0.083 |       -0.219 | 0.037 |       -0.181 | 0.228 |             0.248 |    -0.209 |     0.042 |

`nullA_mean` is the mean of the 1,000 placebo draws: the same side, the same stop distance in ATR, the same 3.0R target, the same forced-flat rule and the same costs, entered at a random bar in the same window on a different day. **A placebo mean close to the observed mean means the mechanic is not adding anything the window and the trade geometry do not already give you.**

**On both index arms the placebo beat the strategy.** US100: the mechanic returned +0.029R where a random bar in the same window, same side, same stop, same target and same costs returned +0.052R on average. US500: −0.053R against the placebo's +0.043R. That is why `p_A` is 0.63 and 0.91 — the pre-registered comparison is not "is this positive?" but "does picking the bar this way beat picking it at random?", and on the indices the answer is no. On the two crypto arms the placebo is also negative (−0.33 / −0.22), so the mechanic is not worse than random there — it is merely, like the placebo, well below the kill bar.

The day-block bootstrap intervals say the same thing from the other side: US100's 90 % interval [−0.089, +0.149] and US500's [−0.157, +0.057] both straddle zero, and both crypto arms' intervals sit entirely below it.

### 3.4 The other three numbers (template × fill), fit period

| leg         |   number | template_fill                                   |    n |   mean_grossR |   mean_cost_R |   mean_netR |   win_rate |
|:------------|---------:|:------------------------------------------------|-----:|--------------:|--------------:|------------:|-----------:|
| US100       |        1 | bot-native template / bot-native fill (PRIMARY) |  676 |         0.159 |         0.073 |       0.086 |     30.769 |
| US100       |        2 | bot-native template / realistic fill            |  676 |         0.054 |         0.073 |      -0.019 |     26.479 |
| US100       |        3 | project-standard template / realistic fill      |  676 |        -0.004 |         0.073 |      -0.077 |     49.852 |
| US100       |        4 | project-standard template / bot-native fill     |  676 |        -0.02  |         0.073 |      -0.093 |     48.964 |
| US500       |        1 | bot-native template / bot-native fill (PRIMARY) |  775 |         0.179 |         0.128 |       0.051 |     31.097 |
| US500       |        2 | bot-native template / realistic fill            |  775 |         0.045 |         0.128 |      -0.082 |     25.935 |
| US500       |        3 | project-standard template / realistic fill      |  775 |        -0.026 |         0.127 |      -0.154 |     48.516 |
| US500       |        4 | project-standard template / bot-native fill     |  775 |        -0.014 |         0.127 |      -0.142 |     49.032 |
| BTCUSDT-(a) |        1 | bot-native template / bot-native fill (PRIMARY) | 1181 |         0.026 |         0.361 |      -0.336 |     26.588 |
| BTCUSDT-(a) |        2 | bot-native template / realistic fill            | 1181 |        -0.073 |         0.361 |      -0.435 |     22.608 |
| BTCUSDT-(a) |        3 | project-standard template / realistic fill      | 1181 |        -0.062 |         0.361 |      -0.423 |     45.555 |
| BTCUSDT-(a) |        4 | project-standard template / bot-native fill     | 1181 |        -0.03  |         0.361 |      -0.391 |     47.079 |
| ETHUSDT-(a) |        1 | bot-native template / bot-native fill (PRIMARY) |  978 |         0.045 |         0.284 |      -0.238 |     27.607 |
| ETHUSDT-(a) |        2 | bot-native template / realistic fill            |  978 |        -0.057 |         0.284 |      -0.34  |     23.62  |
| ETHUSDT-(a) |        3 | project-standard template / realistic fill      |  978 |        -0.048 |         0.284 |      -0.331 |     47.444 |
| ETHUSDT-(a) |        4 | project-standard template / bot-native fill     |  978 |        -0.035 |         0.284 |      -0.319 |     47.853 |

Numbers 2–4 carry **no verdict**. They exist so the result cannot be dismissed as an artefact of the optimistic bot-native fill (which clamps a gapped stop back to the exact stop price) or of the 3.0R target.

### 3.5 Exit causes, fit period

| leg         |    n |   target |   stop |   trailed stop |   time-exit |   both-directions close |
|:------------|-----:|---------:|-------:|---------------:|------------:|------------------------:|
| US100       |  676 |      117 |    342 |            198 |          11 |                       8 |
| US500       |  776 |      138 |    392 |            224 |           5 |                      17 |
| BTCUSDT-(a) | 1181 |      145 |    596 |            365 |          55 |                      20 |
| ETHUSDT-(a) |  978 |      127 |    499 |            275 |          64 |                      13 |

### 3.6 Cost sensitivities — every one that was run, including the ones that came out worse

| leg         |   base | fixed fit-median spread   | 2x per-bar spread   | 0.04% round trip (maker)   |
|:------------|-------:|:--------------------------|:--------------------|:---------------------------|
| US100       |  0.029 | +0.030                    | -0.026              |                            |
| US500       | -0.053 | -0.053                    | -0.122              |                            |
| BTCUSDT-(a) | -0.285 |                           |                     | -0.056                     |
| ETHUSDT-(a) | -0.083 |                           |                     | +0.059                     |

All non-gating. The Capital.com legs are re-priced at a fixed spread (the in-window fit-period median for that instrument) and at 2× the per-bar spread; the Binance legs at a 0.04 % maker round trip instead of the 0.10 % taker round trip. The maker row is the optimistic one and it is shown because it was run, not because it is the answer: it assumes every entry and exit is a resting limit fill, which a stop-loss exit is not.

### 3.7 Component ablation, FIT PERIOD ONLY

| leg         | dropped           |    n |   mean_grossR |   mean_netR |   median_netR |   n_cost_gt_5R |
|:------------|:------------------|-----:|--------------:|------------:|--------------:|---------------:|
| US100       | nothing (the bot) |  676 |         0.159 |       0.086 |        -1.015 |              0 |
| US100       | bias              | 1007 |         0.117 |       0.042 |        -1.017 |              0 |
| US100       | ifvg              | 3598 |         0.394 |      -0.385 |        -1.044 |            103 |
| US100       | pd                |  701 |         0.144 |       0.072 |        -1.014 |              0 |
| US100       | sweep             |  865 |         0.162 |       0.093 |        -0.136 |              0 |
| US500       | nothing (the bot) |  775 |         0.179 |       0.051 |        -1.014 |              0 |
| US500       | bias              | 1075 |         0.142 |       0.016 |        -1.023 |              0 |
| US500       | ifvg              | 3499 |         0.378 |      -0.23  |        -1.049 |             18 |
| US500       | pd                |  799 |         0.186 |       0.059 |        -1.008 |              0 |
| US500       | sweep             | 1006 |         0.172 |       0.051 |        -0.773 |              0 |
| BTCUSDT-(a) | nothing (the bot) | 1181 |         0.026 |      -0.336 |        -1.094 |              0 |
| BTCUSDT-(a) | bias              | 1694 |         0.078 |      -0.289 |        -1.066 |              0 |
| BTCUSDT-(a) | ifvg              | 5442 |         0.419 |      -4.623 |        -1.406 |            740 |
| BTCUSDT-(a) | pd                | 1258 |         0.03  |      -0.328 |        -1.081 |              0 |
| BTCUSDT-(a) | sweep             | 1623 |         0.063 |      -0.288 |        -1.069 |              0 |
| ETHUSDT-(a) | nothing (the bot) |  978 |         0.045 |      -0.238 |        -1.074 |              0 |
| ETHUSDT-(a) | bias              | 1505 |         0.057 |      -0.233 |        -1.074 |              0 |
| ETHUSDT-(a) | ifvg              | 4508 |         0.448 |      -2.848 |        -1.224 |            410 |
| ETHUSDT-(a) | pd                | 1046 |         0.05  |      -0.233 |        -1.065 |              0 |
| ETHUSDT-(a) | sweep             | 1394 |         0.036 |      -0.239 |        -1.074 |              0 |

Each row drops one component and re-runs the bot's whole loop. `dropped = bias` removes the VWAP-band bias and the band-width/ATR regime gate (the side then comes from which iFVG inverted); `ifvg` removes the iFVG trigger and its ATR size gate (the side comes from the bias); `pd` removes the premium/discount gate; `sweep` removes the prior-hour high/low sweep. Fit period only, by pre-registration. **These are descriptive: a component whose removal improves the number is not thereby a licence to remove it** — that would be a new strategy and a new registration.

`n_cost_gt_5R` counts orders whose shrunk stop came out a fraction of a tick wide, so a price-denominated cost over that stop explodes. Those orders make the `drop = ifvg` **mean** unreadable; the **median** is printed beside it. The bot itself never places them — the gate that the row removes is what keeps them out.

### 3.8 Non-circular forward lift

| leg         |    n |   lift_median |   pct_ge_1 |   ref_n |
|:------------|-----:|--------------:|-----------:|--------:|
| US100       |  676 |         0.991 |     49.852 |   20000 |
| US500       |  776 |         1.051 |     51.804 |   20000 |
| BTCUSDT-(a) | 1181 |         0.857 |     42.93  |   20000 |
| ETHUSDT-(a) |  978 |         0.796 |     40.9   |   20000 |

Each signal's post-entry maximum favourable excursion in ATR units over its own horizon, divided by the median unconditional forward excursion for a comparable stretch of the same tape (same direction, same horizon length). **1.00 means the signal picked a stretch of tape no better than a random one.** Horizon capped at 290 bars (the indices' alive window) because the 24/7 legs have no alive window; reference pool a seeded 20,000-bar subsample.

**The index arms land at 0.99 and 1.05 — dead on 1.00.** The signals pick stretches of tape that are neither better nor worse than random comparable stretches: whatever the three components are selecting, it is not future movement in the signal's own direction. The crypto arms land at 0.86 and 0.80, i.e. **below** random. Combined with the gross expectancies in §3.2 — small and positive on every arm, and smaller than the costs on three of four — the picture is a mechanic that selects a roughly average stretch of tape and then pays a spread or a taker fee for the privilege.

### 3.9 Fit-period and tail rows

| leg         | caps_on   | live_like   | period   |    n |   mean_grossR |   mean_cost_R |   mean_netR |   win_rate |
|:------------|:----------|:------------|:---------|-----:|--------------:|--------------:|------------:|-----------:|
| US100       | False     | False       | fit      |  676 |         0.159 |         0.073 |       0.086 |     30.769 |
| US100       | False     | False       | tail     |   40 |         0.418 |         0.04  |       0.378 |     42.5   |
| US100       | False     | True        | fit      |  675 |         0.164 |         0.074 |       0.09  |     30.963 |
| US100       | False     | True        | tail     |   41 |         0.439 |         0.04  |       0.399 |     43.902 |
| US100       | True      | False       | fit      |  522 |         0.187 |         0.073 |       0.114 |     31.034 |
| US100       | True      | False       | tail     |   33 |         0.429 |         0.038 |       0.391 |     42.424 |
| US100       | True      | True        | fit      |  523 |         0.192 |         0.074 |       0.118 |     31.166 |
| US100       | True      | True        | tail     |   32 |         0.41  |         0.036 |       0.374 |     43.75  |
| US500       | False     | False       | fit      |  775 |         0.179 |         0.128 |       0.051 |     31.097 |
| US500       | False     | False       | tail     |   51 |         0.164 |         0.089 |       0.076 |     31.373 |
| US500       | False     | True        | fit      |  772 |         0.18  |         0.128 |       0.052 |     30.829 |
| US500       | False     | True        | tail     |   52 |         0.18  |         0.088 |       0.092 |     32.692 |
| US500       | True      | False       | fit      |  556 |         0.186 |         0.127 |       0.058 |     31.655 |
| US500       | True      | False       | tail     |   41 |        -0.015 |         0.087 |      -0.102 |     24.39  |
| US500       | True      | True        | fit      |  552 |         0.186 |         0.128 |       0.058 |     31.341 |
| US500       | True      | True        | tail     |   41 |         0.034 |         0.088 |      -0.054 |     26.829 |
| BTCUSDT-(a) | False     | False       | fit      | 1181 |         0.026 |         0.361 |      -0.336 |     26.588 |
| BTCUSDT-(a) | False     | False       | tail     |   54 |        -0.135 |         0.47  |      -0.606 |     18.519 |
| BTCUSDT-(a) | False     | True        | fit      | 1185 |         0.026 |         0.363 |      -0.336 |     26.498 |
| BTCUSDT-(a) | False     | True        | tail     |   56 |        -0.166 |         0.466 |      -0.632 |     17.857 |
| BTCUSDT-(a) | True      | False       | fit      |  930 |         0.063 |         0.362 |      -0.298 |     28.172 |
| BTCUSDT-(a) | True      | False       | tail     |   40 |        -0.108 |         0.43  |      -0.538 |     20     |
| BTCUSDT-(a) | True      | True        | fit      |  934 |         0.064 |         0.363 |      -0.299 |     28.051 |
| BTCUSDT-(a) | True      | True        | tail     |   40 |        -0.108 |         0.427 |      -0.535 |     20     |
| ETHUSDT-(a) | False     | False       | fit      |  978 |         0.045 |         0.284 |      -0.238 |     27.607 |
| ETHUSDT-(a) | False     | False       | tail     |   37 |        -0.157 |         0.349 |      -0.506 |     24.324 |
| ETHUSDT-(a) | False     | True        | fit      |  980 |         0.044 |         0.284 |      -0.241 |     27.653 |
| ETHUSDT-(a) | False     | True        | tail     |   37 |        -0.225 |         0.349 |      -0.574 |     21.622 |
| ETHUSDT-(a) | True      | False       | fit      |  808 |         0.071 |         0.281 |      -0.21  |     27.599 |
| ETHUSDT-(a) | True      | False       | tail     |   32 |        -0.182 |         0.345 |      -0.526 |     25     |
| ETHUSDT-(a) | True      | True        | fit      |  811 |         0.065 |         0.282 |      -0.217 |     27.497 |
| ETHUSDT-(a) | True      | True        | tail     |   32 |        -0.26  |         0.345 |      -0.605 |     21.875 |

The tail rows (2026-08-01..2026-09-11) are **non-gating** and enter no verdict. US100's tail row is strongly positive on 40 trades; six weeks of one instrument is noise at this sample size, the row was pre-registered as non-gating precisely so that it could not be read as a reprieve, and it is not one. It is printed because it was run.

---

## 4. Descriptive — no verdict — not pre-registered

**Nothing in this section carries a verdict.** EURCHF and GBPCHF are too thin to gate (≈ 89–90 caps-off orders a year against an `n_holdout ≥ 150` requirement) and their stops are 2.7 / 3.6 bp, so they are a cost problem before they are a mechanic problem. BTCUSDT-(b) and ETHUSDT-(b) are the mechanic with no session concept at all, on a population nobody designed. These rows **cannot be promoted** to a verdict by re-reading them; a forex verdict needs a fresh registration and roughly 44 months of Capital.com minute history, i.e. not before ~2027-09 on this vendor.

| leg         |   n_fit |   n_holdout |   mean_netR_fit |   mean_netR_holdout |   mean_grossR_holdout |   mean_netR_holdout_livelike |   p_A |   p_B |   boot_lo |   boot_hi |
|:------------|--------:|------------:|----------------:|--------------------:|----------------------:|-----------------------------:|------:|------:|----------:|----------:|
| EURCHF      |     141 |          91 |          -0.604 |              -0.789 |                 0.219 |                       -0.78  | 0.745 | 0.468 |    -1.032 |    -0.559 |
| GBPCHF      |     143 |          92 |          -0.431 |              -0.682 |                 0.128 |                       -0.702 | 0.78  | 0.392 |    -0.917 |    -0.439 |
| BTCUSDT-(b) |   12348 |        4265 |          -0.568 |              -0.586 |                 0.117 |                       -0.586 | 0     | 0     |    -0.636 |    -0.537 |
| ETHUSDT-(b) |   11320 |        3800 |          -0.385 |              -0.262 |                 0.165 |                       -0.263 | 0     | 0     |    -0.306 |    -0.22  |

Costs and gross, holdout:

| leg         |    n |   mean_grossR |   mean_cost_R |   median_cost_R |   mean_netR |   win_rate |   median_stop_atr |
|:------------|-----:|--------------:|--------------:|----------------:|------------:|-----------:|------------------:|
| EURCHF      |   91 |         0.219 |         1.008 |           0.9   |      -0.789 |     25.275 |             1.993 |
| GBPCHF      |   92 |         0.128 |         0.81  |           0.739 |      -0.682 |     23.913 |             1.977 |
| BTCUSDT-(b) | 4265 |         0.117 |         0.703 |           0.532 |      -0.586 |     27.808 |             2.696 |
| ETHUSDT-(b) | 3800 |         0.165 |         0.428 |           0.336 |      -0.262 |     30.658 |             2.76  |

Two things in those rows are worth saying out loud, as description rather than verdict. **On EURCHF and GBPCHF one round-trip spread is roughly 0.8–1.0R** — the median `cost_R` is 0.90 and 0.74. The stop this strategy places on a CHF cross is so tight that a single spread costs about as much as the whole risk unit; a mechanic would have to be extraordinary to survive that, and the gross expectancies here (+0.22R, +0.13R) are not extraordinary. **On the (b) legs the matched-time placebo comes out far worse than the real signals** (−0.96 vs −0.59 on BTC, −0.54 vs −0.26 on ETH, so `p_A` rounds to 0.000). That is not evidence of an edge: it says the mechanic's own gates avoid some of the worst 24/7 entries a random draw would take, while still leaving the result deep below the level at which anything would be built. No verdict attaches to either observation.

Four numbers, ablation and forward lift, fit period:

| leg         |   number |     n |   mean_grossR |   mean_cost_R |   mean_netR |   win_rate |
|:------------|---------:|------:|--------------:|--------------:|------------:|-----------:|
| EURCHF      |        1 |   141 |         0.184 |         0.788 |      -0.604 |     29.078 |
| EURCHF      |        2 |   141 |         0.045 |         0.787 |      -0.743 |     24.113 |
| EURCHF      |        3 |   141 |        -0.021 |         0.782 |      -0.803 |     37.589 |
| EURCHF      |        4 |   141 |         0.009 |         0.787 |      -0.778 |     39.007 |
| GBPCHF      |        1 |   143 |         0.218 |         0.649 |      -0.431 |     30.769 |
| GBPCHF      |        2 |   143 |         0.015 |         0.646 |      -0.631 |     24.476 |
| GBPCHF      |        3 |   143 |        -0.063 |         0.611 |      -0.674 |     41.958 |
| GBPCHF      |        4 |   143 |        -0.007 |         0.613 |      -0.619 |     46.154 |
| BTCUSDT-(b) |        1 | 12348 |         0.102 |         0.67  |      -0.568 |     27.146 |
| BTCUSDT-(b) |        2 | 12348 |        -0     |         0.67  |      -0.67  |     22.433 |
| BTCUSDT-(b) |        3 | 12348 |        -0.011 |         0.67  |      -0.681 |     40.703 |
| BTCUSDT-(b) |        4 | 12348 |         0.015 |         0.67  |      -0.655 |     41.723 |
| ETHUSDT-(b) |        1 | 11320 |         0.082 |         0.468 |      -0.385 |     27.871 |
| ETHUSDT-(b) |        2 | 11320 |        -0.023 |         0.468 |      -0.491 |     22.588 |
| ETHUSDT-(b) |        3 | 11320 |        -0.018 |         0.468 |      -0.486 |     45.362 |
| ETHUSDT-(b) |        4 | 11320 |         0.007 |         0.468 |      -0.461 |     46.343 |

| leg         | dropped           |     n |   mean_grossR |    mean_netR |   median_netR |   n_cost_gt_5R |
|:------------|:------------------|------:|--------------:|-------------:|--------------:|---------------:|
| EURCHF      | nothing (the bot) |   141 |         0.184 | -0.604       |        -1.275 |              0 |
| EURCHF      | bias              |   189 |         0.181 | -0.608       |        -1.167 |              0 |
| EURCHF      | ifvg              |   743 |         0.367 | -5.235       |        -2.469 |            193 |
| EURCHF      | pd                |   142 |         0.175 | -0.61        |        -1.28  |              0 |
| EURCHF      | sweep             |   233 |         0.244 | -0.493       |        -0.911 |              0 |
| GBPCHF      | nothing (the bot) |   143 |         0.218 | -0.431       |        -1.233 |              1 |
| GBPCHF      | bias              |   201 |         0.125 | -0.543       |        -1.201 |              1 |
| GBPCHF      | ifvg              |   744 |         0.427 | -7.56653e+08 |        -2     |            160 |
| GBPCHF      | pd                |   144 |         0.209 | -0.438       |        -1.253 |              1 |
| GBPCHF      | sweep             |   214 |         0.258 | -0.349       |        -1.055 |              1 |
| BTCUSDT-(b) | nothing (the bot) | 12348 |         0.102 | -0.568       |        -1.16  |             26 |
| BTCUSDT-(b) | bias              | 21958 |         0.099 | -0.628       |        -1.159 |            101 |
| BTCUSDT-(b) | ifvg              | 47312 |         0.497 | -7.485       |        -1.632 |           9279 |
| BTCUSDT-(b) | pd                | 12782 |         0.099 | -0.559       |        -1.154 |             26 |
| BTCUSDT-(b) | sweep             | 16034 |         0.096 | -0.546       |        -1.149 |             28 |
| ETHUSDT-(b) | nothing (the bot) | 11320 |         0.082 | -0.385       |        -1.087 |              8 |
| ETHUSDT-(b) | bias              | 20398 |         0.092 | -0.403       |        -0.981 |             37 |
| ETHUSDT-(b) | ifvg              | 44248 |         0.5   | -4.284       |        -1.37  |           6460 |
| ETHUSDT-(b) | pd                | 11756 |         0.081 | -0.38        |        -1.083 |              8 |
| ETHUSDT-(b) | sweep             | 14741 |         0.077 | -0.373       |        -1.086 |              9 |

| leg         |     n |   lift_median |   pct_ge_1 |   ref_n |
|:------------|------:|--------------:|-----------:|--------:|
| EURCHF      |   141 |         1.154 |     55.319 |   13299 |
| GBPCHF      |   143 |         1.061 |     55.944 |   12599 |
| BTCUSDT-(b) | 12348 |         0.788 |     39.31  |   20000 |
| ETHUSDT-(b) | 11320 |         0.737 |     37.35  |   20000 |

### 4.1 The (b) legs with the daily caps ON — a count and a clock histogram, and nothing else

The caps reset at UTC midnight and are used up within hours, so with the caps on the 24/7 condition becomes an implicit "first hours after the VWAP reset" strategy — a window nobody chose. It is documented here and **no performance number is computed on it**.

- **BTCUSDT-(b)**: 2,845 orders with the caps on vs 17,095 with them off; **2,684 of 2,845 (94 %) fall in 00:00–06:00 UTC.**
- **ETHUSDT-(b)**: 2,859 orders with the caps on vs 15,567 with them off; **2,647 of 2,859 (93 %) fall in 00:00–06:00 UTC.**

| leg         |   n_caps_on |   n_caps_off |   h00 |   h01 |   h02 |   h03 |   h04 |   h05 |   h06 |   h07 |   h08 |   h09 |   h10 |   h11 |   h12 |   h13 |   h14 |   h15 |   h16 |   h17 |   h18 |   h19 |   h20 |   h21 |   h22 |   h23 |
|:------------|------------:|-------------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|------:|
| BTCUSDT-(b) |        2845 |        17095 |   480 |   972 |   654 |   310 |   163 |   105 |    66 |    36 |    20 |    13 |     8 |     7 |     3 |     2 |     2 |     2 |     2 |     0 |     0 |     0 |     0 |     0 |     0 |     0 |
| ETHUSDT-(b) |        2859 |        15567 |   373 |   929 |   670 |   351 |   200 |   124 |    71 |    47 |    26 |    14 |    11 |     7 |    10 |     6 |     6 |     4 |     5 |     1 |     2 |     0 |     0 |     2 |     0 |     0 |

---

## 5. What these results do and do not mean (pre-registered, `DESIGN.md` §6)

- **A miss on an arm is a kill of this mechanic on that symbol**, not a request to rework it. One pre-registered pass, one shot.

- **A kill on BTCUSDT-(a) / ETHUSDT-(a) does not touch Запись 18's v5-NY result, and Запись 18 does not touch this.** The overlap is the clock, not the mechanic (far-edge vs proximal iFVG, session-extreme vs prior-hour sweep, 5m vs 1m, fixed-UTC vs NY-DST window). A pass here would not have reopened v5-NY either.

- **No result on a crypto arm is evidence about an index arm, or vice versa.** Different tape, different volume quantity inside the VWAP (exchange base-asset volume vs broker tick activity), different cost model.

- **The descriptive legs say nothing about the arms**, and no row anywhere pools them.

- Unmodelled live-path divergences, listed not simulated: **L-02** (the live US500 bias VWAP double-counts a chunk-boundary bar whenever the 12 h tape has a missing minute — 59 % of US500 evaluations), **L-03** (the live request fails outright if the host clock leads Capital.com's by more than the firing latency), and the forming candle the live bias request can include, which is not reproducible from history.

- Bug fidelity kept in the primary, deliberately: D-03 (`getLastIfvg` is asymmetric), D-05 (the bias compares the bar's **open** to the band), D-06 (the 200-bar range excludes the current bar), D-07 (VWAP from 00:01 UTC, population stdev, broker tick volume), D-10 (the fill is clamped to the exact stop/target), D-11 (close-only exits), D-18 (`VWAP([])` throws on forex holidays → no signal, as live). **No "improvements" in the primary.**

- **Slippage is not modelled, so every number here is optimistic.**

