_Window: 2022-08-01 .. 2026-07-31 (1460 days), 4 symbols, 5m bars. **23,423 take-outs** — byte-identical to v2's event stream (checks.py) — of which **21,118 (90.2%)** are primary (>= 12 bars = 1h left in the sweep block). Only the iFVG confirmation layer differs from v2. iFVG only; no BoS, no PDH/PDL._

## D. v2 vs v3 — what the retroactive-best-pick bug was buying

### D1. Headline metrics, both algorithms, same event rows (primary sample)

| algorithm | n_confirmed | confirm_rate_pct | delay_median_bars | gap_size_atr_median | mfe_atr_median | mae_atr_median | stop_atr_median | R_median | share_R_ge_1 | share_R_ge_2 |
|---|---|---|---|---|---|---|---|---|---|---|
| v2 (retroactive best-pick — the bug) | 13606 | 64.43 | 15.00 | 0.35 | 2.34 | 2.36 | 2.67 | 0.84 | 43.61 | 19.60 |
| v3 (sequential state machine, §5.1 / V9) | 4379 | 20.74 | 14.00 | 0.30 | 2.08 | 2.02 | 2.72 | 0.74 | 40.58 | 17.42 |
| delta (v3 - v2) | -9227 | -43.69 | -1.00 | -0.06 | -0.25 | -0.34 | 0.05 | -0.10 | -3.03 | -2.18 |

_Same take-outs, same horizon, same geometry formulas — the ONLY difference is which gap (if any) each algorithm selects. Every row is computed on the confirmed subset of that algorithm, so `n_confirmed` differs by construction; that difference IS the finding._

### D2. Selected-gap-size distribution — the small-gap-bias prediction, tested

| algorithm | n | p10 | median | p90 | mean |
|---|---|---|---|---|---|
| v2 (retroactive best-pick) | 13606 | 0.060 | 0.355 | 1.236 | 0.548 |
| v3 (sequential) | 4379 | 0.048 | 0.298 | 1.121 | 0.475 |
| v2, restricted to events v3 ALSO confirms | 4379 | 0.057 | 0.364 | 1.246 | 0.548 |
| v3, restricted to events v2 ALSO confirms | 4379 | 0.048 | 0.298 | 1.121 | 0.475 |

_Gap height of the SELECTED gap, in ATR(14, 5m) at the take-out bar. The last two rows hold the event set fixed so the comparison is not confounded by the two algorithms confirming different take-outs. Agreement on WHICH gap: of the 4,379 take-outs both algorithms confirm, **72.9%** select the same gap._

### D3. Where the two algorithms disagree (primary sample)

| case | n | share_pct |
|---|---|---|
| both confirm, SAME gap selected | 3191 | 15.11 |
| both confirm, DIFFERENT gap selected | 1188 | 5.63 |
| v2 confirms, v3 does not | 9227 | 43.69 |
| v3 confirms, v2 does not | 0 | 0.00 |
| neither confirms | 7512 | 35.57 |

_v3's confirmed set is a strict SUBSET of v2's here — mechanically expected: v3 can only ever confirm through a gap v2 also saw, and v2 additionally accepts gaps v3 had already replaced or invalidated away._

## V. The pin-3 geometry finding — three invalidation variants

### V1. Confirmation rate and geometry under A / B / C (primary sample)

| variant | n_confirmed | confirm_rate_pct | delay_median_bars | mfe_atr_median | stop_atr_median | R_median | share_R_ge_1 |
|---|---|---|---|---|---|---|---|
| A — PRIMARY: pin 3 as written (invalidation wins the tie) | 4379 | 20.74 | 14.00 | 2.08 | 2.72 | 0.74 | 40.58 |
| B — sensitivity: confirmation wins the tie | 7313 | 34.63 | 21.00 | 2.05 | 2.63 | 0.76 | 40.80 |
| C — sensitivity: reference = running extreme frozen at activation | 12757 | 60.41 | 17.00 | 2.26 | 2.65 | 0.81 | 42.69 |
| v2 (the bug), for scale | 13606 | 64.43 | 15.00 | 2.34 | 2.67 | 0.84 | 43.61 |

_**The tie is not rare and is not contradictory.** For a high sweep the bullish candidate usually forms ABOVE the take-out bar's high, so its lower edge sits above the invalidation reference and EVERY close in between satisfies both tests at once — the gap inverts while price is still above the sweep wick. It fires on **3,824 bars** across **3,073 of the 21,118** primary take-outs (14.6%). DESIGN.md §1 pin 3 assumed it was 'near-impossible'; that assumption was wrong and was corrected mid-pass (Architect ruling: keep A as primary, ship B and C as labelled sensitivities)._

### V2. Above-extreme gaps — the geometry that creates the tie

| variant | n_confirmed | confirm_rate_pct | share_confirmed_via_above_extreme_gap_pct | n_above_extreme |
|---|---|---|---|---|
| A (primary) | 4379 | 20.74 | 10.14 | 444 |
| B | 7313 | 34.63 | 47.64 | 3484 |
| C | 12757 | 60.41 | 55.77 | 7115 |

_Under A, a confirmation whose gap lay entirely beyond the take-out extreme is only possible when price closed back below that extreme BEFORE inverting the gap — so the share is small by construction. Under B and C those confirmations are exactly what is added back._

## S. State-machine diagnostics (primary sample, variant A)

### S1. Candidates seen / replacements / invalidations per take-out

| quantity | mean | p50 | p90 | max | share_zero_pct |
|---|---|---|---|---|---|
| qualifying gaps seen (candidates) | 2.46 | 1.00 | 7.00 | 20 | 30.31 |
| replacements (a newer gap displaced a live one) | 0.05 | 0.00 | 0.00 | 5 | 95.72 |
| invalidations (close beyond the take-out extreme) | 2.16 | 1.00 | 7.00 | 19 | 45.26 |
| tie bars (invalidation AND inversion on one close) | 0.18 | 0.00 | 1.00 | 5 | 85.45 |
| orphan breaches (beyond the extreme, nothing active) | 16.51 | 4.00 | 55.00 | 88 | 31.66 |

### S1b. Candidate-count histogram and the confirmation rate inside each bin

| n_candidates | n | share_pct | confirm_rate_pct | invalidations_median | R_median |
|---|---|---|---|---|---|
| 0 | 6401 | 30.31 | 0.00 | 0.00 |  |
| 1 | 4643 | 21.99 | 55.46 | 0.00 | 0.92 |
| 2 | 2586 | 12.25 | 38.44 | 2.00 | 0.72 |
| 3-4 | 3168 | 15.00 | 19.82 | 3.00 | 0.48 |
| 5-8 | 3251 | 15.39 | 5.23 | 6.00 | 0.30 |
| 9+ | 1069 | 5.06 | 1.12 | 10.00 | 0.11 |

### S2. Unconfirmed take-outs, split by cause (primary sample)

| cause | n | share_pct | bars_remaining_median | candidates_median | rev_atr_median | adv_atr_median | would_confirm_extended_pct |
|---|---|---|---|---|---|---|---|
| confirmed | 4379 | 20.74 | 65.00 | 1.00 | 4.26 | 2.00 | 0.00 |
| invalidated_out | 9488 | 44.93 | 62.00 | 4.00 | 2.80 | 4.82 | 5.41 |
| no_candidate | 6401 | 30.31 | 51.00 | 0.00 | 5.98 | 0.00 | 3.72 |
| live_at_block_end | 850 | 4.03 | 55.00 | 4.00 | 2.66 | 4.44 | 20.71 |

_`invalidated_out` = at least one candidate existed and every one of them was invalidated (or replaced-then-invalidated) before the block ended. `no_candidate` = no gap satisfying the V5 location filter ever formed inside the window. `live_at_block_end` = a candidate was still alive, un-inverted, when the clock ran out. `rev_atr` is the wick-anchored reversal these take-outs still made — the column that says how much the rule leaves on the table._

### S3. Unconfirmed-by-cause x sweep_block

| unconf_cause | Asia | London | NY | Late |
|---|---|---|---|---|
| confirmed | 24.80 | 19.41 | 21.40 | 14.84 |
| invalidated_out | 42.64 | 43.21 | 47.66 | 39.37 |
| no_candidate | 28.83 | 33.74 | 27.01 | 40.28 |
| live_at_block_end | 3.73 | 3.63 | 3.93 | 5.52 |

_Column percentages: within each block, how its take-outs split across the four outcomes._

## T. Re-derived core tables (variant A, primary sample)

### T2. iFVG confirmation rate — level_session x sweep_block

| level_session | Asia | London | NY | Late | ALL blocks |
|---|---|---|---|---|---|
| Asia | 21.24 | 19.62 | 22.04 | 15.26 | 20.54 |
| London | 24.74 | 14.00 | 21.38 | 12.54 | 21.12 |
| NY | 25.92 | 20.36 | 20.21 | 15.11 | 20.47 |
| ALL levels | 24.80 | 19.41 | 21.40 | 14.84 | 20.74 |

_v2's counterpart table is `../session-liquidity-v2/results/t2_ifvg_rate_levelsession_x_block.csv` — same cells, ~3x higher._

### T2b. Confirmation rate — level_session x direction x asset

| level_session | direction | n | ifvg_rate_ALL | v2_rate_ALL | BTCUSDT | ETHUSDT | SOLUSDT | BNBUSDT |
|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 3692 | 20.94 | 65.90 | 22.91 | 22.42 | 19.50 | 18.80 |
| Asia | low_sweep | 3583 | 20.12 | 60.79 | 22.68 | 20.89 | 18.17 | 18.72 |
| London | high_sweep | 3894 | 21.19 | 70.67 | 23.98 | 23.29 | 19.46 | 18.09 |
| London | low_sweep | 3989 | 21.06 | 68.54 | 21.11 | 20.18 | 21.16 | 21.78 |
| NY | high_sweep | 3073 | 20.44 | 62.12 | 19.87 | 21.41 | 18.92 | 21.53 |
| NY | low_sweep | 2887 | 20.51 | 55.42 | 21.24 | 22.11 | 18.92 | 19.89 |

### T2c. The full core cut — level_session x sweep_block x direction x asset

Full table in `results/t2c_core_full_cut.csv` — 96 cells with n >= 15 (of 96 possible). Confirmation rate across cells: min 3%, median 20%, max 32%; median R proxy across cells 0.04 / 0.64 / 1.62.

### T3. Take-out -> confirmation delay, and the block-truncation share

| sweep_block | n | confirmed_pct | form_delay_median | delay_median_bars | delay_p25 | delay_p75 | delay_p90 | delay_median_min | unconfirmed_n | truncated_share_pct |
|---|---|---|---|---|---|---|---|---|---|---|
| Asia | 3347 | 24.80 | 13.00 | 17.00 | 6.00 | 32.00 | 53.10 | 85.00 | 2517 | 5.28 |
| London | 4487 | 19.41 | 9.00 | 13.00 | 6.00 | 24.00 | 37.00 | 65.00 | 3616 | 6.44 |
| NY | 10764 | 21.40 | 13.00 | 16.00 | 7.00 | 34.00 | 56.00 | 80.00 | 8460 | 4.39 |
| Late | 2520 | 14.84 | 5.00 | 8.00 | 5.00 | 15.00 | 22.00 | 40.00 | 2146 | 8.85 |
| ALL | 21118 | 20.74 | 11.00 | 14.00 | 6.00 | 29.00 | 49.00 | 70.00 | 16739 | 5.54 |

_`form_delay_median` = bars from the take-out to the 3rd bar of the gap that ended up confirming (new in v3 — under the state machine the winning gap has an identity, not just an inversion time). `truncated_share_pct` = of the UNCONFIRMED take-outs, the share that would have confirmed had the block run 2h longer — a diagnostic probe, not part of any definition._

### T6. Magnitude from the iFVG CONFIRMATION CLOSE — the tradable view

| level_session | direction | n | mfe_atr_median | mfe_atr_p75 | mfe_atr_p90 | mae_atr_median | mae_atr_p90 | mfe_over_mae | end_atr_median | share_end_positive | conf_bars_left_median |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | ALL | 4351 | 2.08 | 3.96 | 6.91 | 2.02 | 7.63 | 1.03 | 0.11 | 52.00 | 41.00 |
| ALL | high_sweep | 2213 | 2.28 | 4.23 | 7.41 | 2.05 | 7.50 | 1.11 | 0.11 | 51.93 | 41.00 |
| ALL | low_sweep | 2138 | 1.93 | 3.70 | 6.27 | 1.99 | 7.77 | 0.97 | 0.11 | 52.07 | 40.00 |
| Asia | ALL | 1478 | 1.97 | 3.69 | 6.26 | 1.92 | 6.42 | 1.03 | 0.11 | 52.48 | 35.00 |
| Asia | high_sweep | 767 | 2.14 | 4.02 | 6.68 | 2.07 | 6.38 | 1.04 | 0.05 | 50.71 | 35.00 |
| Asia | low_sweep | 711 | 1.82 | 3.32 | 5.54 | 1.73 | 6.47 | 1.06 | 0.17 | 54.37 | 33.00 |
| London | ALL | 1660 | 2.54 | 4.63 | 8.53 | 2.39 | 9.74 | 1.06 | 0.14 | 52.31 | 56.00 |
| London | high_sweep | 824 | 2.65 | 4.79 | 9.06 | 2.36 | 9.77 | 1.12 | 0.09 | 51.64 | 57.50 |
| London | low_sweep | 836 | 2.38 | 4.54 | 8.00 | 2.44 | 9.42 | 0.98 | 0.17 | 52.98 | 53.00 |
| NY | ALL | 1213 | 1.73 | 3.44 | 5.77 | 1.77 | 7.04 | 0.98 | 0.07 | 50.98 | 30.00 |
| NY | high_sweep | 622 | 1.95 | 3.73 | 6.43 | 1.66 | 6.40 | 1.17 | 0.28 | 53.82 | 29.00 |
| NY | low_sweep | 591 | 1.60 | 3.17 | 4.95 | 1.87 | 7.34 | 0.86 | -0.10 | 47.97 | 31.00 |

_MFE/MAE over what is LEFT of the block after the confirmation bar's close, in ATR units — what a trader entering on the signal actually has in front of them. `share_end_positive` = % still on the favourable side of the entry when the block closes._

### T7. Stop proxy and R proxy at the confirmation bar

| level_session | sweep_block | n | stop_atr_median | stop_atr_p90 | R_median | R_p75 | share_R_ge_1 | share_R_ge_2 |
|---|---|---|---|---|---|---|---|---|
| ALL | ALL | 4351 | 2.72 | 5.18 | 0.74 | 1.57 | 40.84 | 17.54 |
| ALL | Asia | 826 | 2.69 | 4.96 | 0.71 | 1.44 | 38.50 | 14.77 |
| ALL | London | 863 | 2.69 | 4.94 | 0.72 | 1.48 | 38.59 | 14.60 |
| ALL | NY | 2293 | 2.74 | 5.32 | 0.84 | 1.80 | 45.01 | 21.19 |
| ALL | Late | 369 | 2.76 | 5.61 | 0.46 | 1.00 | 25.47 | 7.86 |
| Asia | ALL | 1478 | 2.72 | 5.06 | 0.70 | 1.49 | 38.63 | 15.43 |
| Asia | Asia | 132 | 2.89 | 4.97 | 0.61 | 1.24 | 33.33 | 10.61 |
| Asia | London | 703 | 2.65 | 4.84 | 0.73 | 1.49 | 38.98 | 14.51 |
| Asia | NY | 605 | 2.74 | 5.24 | 0.73 | 1.58 | 41.49 | 18.51 |
| Asia | Late | 38 | 3.33 | 6.04 | 0.27 | 0.48 | 5.26 | 0.00 |
| London | ALL | 1660 | 2.73 | 5.29 | 0.90 | 1.86 | 46.51 | 22.05 |
| London | Asia | 169 | 2.67 | 4.70 | 0.82 | 1.57 | 44.38 | 17.75 |
| London | London | 35 | 2.72 | 6.45 | 0.48 | 1.16 | 28.57 | 11.43 |
| London | NY | 1422 | 2.72 | 5.31 | 0.93 | 1.92 | 47.68 | 23.21 |
| London | Late | 34 | 3.36 | 6.59 | 0.28 | 1.02 | 26.47 | 5.88 |
| NY | ALL | 1213 | 2.71 | 5.19 | 0.65 | 1.37 | 35.78 | 13.93 |
| NY | Asia | 525 | 2.69 | 5.01 | 0.69 | 1.44 | 37.90 | 14.86 |
| NY | London | 125 | 2.89 | 4.95 | 0.78 | 1.43 | 39.20 | 16.00 |
| NY | NY | 266 | 2.79 | 5.70 | 0.62 | 1.59 | 38.72 | 16.54 |
| NY | Late | 297 | 2.64 | 5.21 | 0.53 | 1.06 | 27.95 | 9.09 |

_Stop = distance from the confirmation close back to the sweep leg's running extreme (take-out bar .. confirmation bar). `R` = block-scoped MFE / that stop. **Descriptive only** — no costs, no exit rule, and MFE is a best-case exit nobody hits systematically._

### T9. Lift over each block's OWN unconditional baseline

| sweep_block | direction | n_takeouts | takeout_rev_atr_median | uncond_atr_median | lift_takeout | n_confirmed_v3 | lift_confirmed_v3 | n_confirmed_v2 | lift_confirmed_v2 |
|---|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 1851 | 3.973 | 3.220 | 1.234 | 464 | 1.281 | 1268 | 1.020 |
| Asia | low_sweep | 1496 | 4.029 | 3.204 | 1.257 | 366 | 1.300 | 944 | 1.026 |
| London | high_sweep | 2387 | 4.106 | 3.058 | 1.343 | 456 | 1.468 | 1484 | 1.064 |
| London | low_sweep | 2100 | 3.874 | 3.049 | 1.271 | 415 | 1.285 | 1212 | 0.968 |
| NY | high_sweep | 5097 | 4.456 | 3.109 | 1.433 | 1114 | 1.491 | 3648 | 1.206 |
| NY | low_sweep | 5667 | 4.162 | 3.014 | 1.381 | 1190 | 1.412 | 3872 | 1.110 |
| Late | high_sweep | 1324 | 3.177 | 2.280 | 1.393 | 192 | 1.716 | 694 | 1.094 |
| Late | low_sweep | 1196 | 3.613 | 2.292 | 1.576 | 182 | 1.745 | 484 | 1.231 |

_`lift` = conditional median / same-block unconditional median, both measured from the WICK extreme (so both are hindsight-flattered the same way — the comparison survives, the level does not). The v2 column is printed beside the v3 one because this is the table where the selection bias should show up as a difference in what the confirmed subset contains._

### T9b. Window-matched lift — inside bars_remaining buckets

| sweep_block | bars_remaining | n | hi_lift | lo_lift | hi_conf_lift | lo_conf_lift |
|---|---|---|---|---|---|---|
| Asia | 12-23 | 284 | 1.407 | 1.224 | 1.560 | 1.386 |
| Asia | 24-47 | 625 | 1.218 | 1.189 | 1.252 | 1.260 |
| Asia | 48-95 | 2438 | 1.147 | 1.200 | 1.158 | 1.158 |
| London | 12-23 | 626 | 1.498 | 1.291 | 1.845 | 1.398 |
| London | 24-47 | 1838 | 1.277 | 1.256 | 1.380 | 1.261 |
| London | 48-95 | 2023 | 1.143 | 1.140 | 1.219 | 1.097 |
| NY | 12-23 | 477 | 1.326 | 1.453 | 1.705 | 1.553 |
| NY | 24-47 | 1313 | 1.430 | 1.370 | 1.560 | 1.393 |
| NY | 48-95 | 8974 | 1.202 | 1.182 | 1.228 | 1.193 |
| Late | 12-23 | 1005 | 1.393 | 1.629 | 2.021 | 1.830 |
| Late | 24-47 | 1515 | 1.322 | 1.445 | 1.514 | 1.629 |

### W2. Confirmation rate by remaining-window bucket

| bars_remaining | n | share_pct | ifvg_rate_v3 | ifvg_rate_v2 | delay_median | candidates_median | invalidations_median |
|---|---|---|---|---|---|---|---|
| <12 (appendix only) | 2305 | 9.84 | 4.51 | 10.67 | 5.00 | 0.00 | 0.00 |
| 12-23 | 2392 | 10.21 | 12.71 | 37.71 | 8.00 | 1.00 | 0.00 |
| 24-47 | 5291 | 22.59 | 17.88 | 56.06 | 13.00 | 1.00 | 0.00 |
| 48-95 | 13435 | 57.36 | 23.29 | 72.48 | 17.00 | 2.00 | 1.00 |

_How much of the confirmation rate is just window length — and it is still a lot under v3. W1 (the window-length distribution itself) is upstream of confirmation and unchanged: see v2's `w1_window_length.csv`._

### T11. Sensitivity — relaxed (V5 default) vs strict iFVG location, under v3

| variant | rate_pct | n | delay_median | rev_atr_median |
|---|---|---|---|---|
| relaxed — gap merely reaches beyond the level (V5, used everywhere) | 20.74 | 4379 | 14.00 | 4.26 |
| strict — whole gap beyond the level (phase-1 D5, sensitivity) | 14.28 | 3015 | 19.00 | 4.00 |

### T12. Monthly stability

Full table in `results/t12_monthly.csv` (48 months). Monthly v3 confirmation rate ranges **16–26%** (median 21%; v2's ranged 52–74%). Monthly median R proxy **0.48–1.08** (median 0.75). Worst / best month by rate: 2026-06 / 2026-07. See chart 07.

## H. Hour of day (§5.1 required deliverable)

### H1. Gap frequency by UTC clock hour — every bar, no sweep required

| hour | bars | bull | bear | fvg_per_100_bars | block |
|---|---|---|---|---|---|
| 0 | 70128 | 8700 | 8119 | 23.98 | Asia |
| 1 | 70128 | 8710 | 8437 | 24.45 | Asia |
| 2 | 70128 | 8545 | 8316 | 24.04 | Asia |
| 3 | 70128 | 8411 | 7677 | 22.94 | Asia |
| 4 | 70128 | 8551 | 8132 | 23.79 | Asia |
| 5 | 70128 | 8344 | 8275 | 23.70 | Asia |
| 6 | 70128 | 8346 | 8077 | 23.42 | Asia |
| 7 | 70128 | 8271 | 8166 | 23.44 | Asia |
| 8 | 70128 | 8357 | 7965 | 23.27 | London |
| 9 | 70128 | 8136 | 7387 | 22.14 | London |
| 10 | 70128 | 7613 | 7633 | 21.74 | London |
| 11 | 70128 | 8000 | 7287 | 21.80 | London |
| 12 | 70128 | 7908 | 7821 | 22.43 | London |
| 13 | 70128 | 7412 | 7998 | 21.97 | NY |
| 14 | 70128 | 7909 | 7723 | 22.29 | NY |
| 15 | 70128 | 7528 | 7378 | 21.26 | NY |
| 16 | 70128 | 7447 | 7473 | 21.28 | NY |
| 17 | 70128 | 8192 | 7591 | 22.51 | NY |
| 18 | 70128 | 7741 | 7191 | 21.29 | NY |
| 19 | 70128 | 7987 | 7232 | 21.70 | NY |
| 20 | 70128 | 7999 | 7515 | 22.12 | NY |
| 21 | 70128 | 8856 | 8181 | 24.29 | Late |
| 22 | 70128 | 8863 | 7919 | 23.93 | Late |
| 23 | 70128 | 8168 | 7930 | 22.96 | Late |

_Raw 3-candle FVG formation rate per clock hour, pooled over the 4 assets. This is the 'gap frequency by hour' half of the chart — it says nothing about sweeps, only about when the tape produces gaps at all._

### H2. Confirmed-reversal rate by hour, window-length-stratified

| hour | n | candidates_per_event | rate_ALL | v2_rate_ALL | rate_12-23 | n_12-23 | rate_24-47 | n_24-47 | rate_48-71 | n_48-71 | rate_72+ | n_72+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 769 | 3.31 | 29.26 | 73.60 |  | 0 |  | 0 |  | 0 | 29.26 | 769 |
| 1 | 713 | 3.02 | 28.05 | 72.23 |  | 0 |  | 0 |  | 0 | 28.05 | 713 |
| 2 | 583 | 2.66 | 27.44 | 72.56 |  | 0 |  | 0 | 27.44 | 583 |  | 0 |
| 3 | 373 | 2.08 | 23.32 | 63.27 |  | 0 |  | 0 | 23.32 | 373 |  | 0 |
| 4 | 320 | 1.63 | 19.06 | 62.50 |  | 0 | 19.06 | 320 |  | 0 |  | 0 |
| 5 | 305 | 1.55 | 20.33 | 56.72 |  | 0 | 20.33 | 305 |  | 0 |  | 0 |
| 6 | 284 | 0.94 | 12.32 | 34.86 | 12.32 | 284 |  | 0 |  | 0 |  | 0 |
| 7 | 0 |  |  |  |  | 0 |  | 0 |  | 0 |  | 0 |
| 8 | 2023 | 2.33 | 21.21 | 67.77 |  | 0 |  | 0 | 21.21 | 2023 |  | 0 |
| 9 | 1105 | 1.84 | 21.99 | 62.35 |  | 0 | 21.99 | 1105 |  | 0 |  | 0 |
| 10 | 733 | 1.39 | 15.28 | 53.07 |  | 0 | 15.28 | 733 |  | 0 |  | 0 |
| 11 | 626 | 0.93 | 13.90 | 39.46 | 13.90 | 626 |  | 0 |  | 0 |  | 0 |
| 12 | 0 |  |  |  |  | 0 |  | 0 |  | 0 |  | 0 |
| 13 | 3896 | 3.76 | 22.72 | 76.69 |  | 0 |  | 0 |  | 0 | 22.72 | 3896 |
| 14 | 2517 | 3.28 | 22.84 | 73.58 |  | 0 |  | 0 |  | 0 | 22.84 | 2517 |
| 15 | 1589 | 2.91 | 22.97 | 73.19 |  | 0 |  | 0 | 22.97 | 1589 |  | 0 |
| 16 | 972 | 2.10 | 20.88 | 64.20 |  | 0 |  | 0 | 20.88 | 972 |  | 0 |
| 17 | 740 | 1.78 | 16.62 | 60.27 |  | 0 | 16.62 | 740 |  | 0 |  | 0 |
| 18 | 573 | 1.33 | 17.10 | 49.21 |  | 0 | 17.10 | 573 |  | 0 |  | 0 |
| 19 | 477 | 0.94 | 11.53 | 34.59 | 11.53 | 477 |  | 0 |  | 0 |  | 0 |
| 20 | 0 |  |  |  |  | 0 |  | 0 |  | 0 |  | 0 |
| 21 | 1515 | 1.43 | 16.30 | 51.95 |  | 0 | 16.30 | 1515 |  | 0 |  | 0 |
| 22 | 1005 | 1.07 | 12.64 | 38.91 | 12.64 | 1005 |  | 0 |  | 0 |  | 0 |
| 23 | 0 |  |  |  |  | 0 |  | 0 |  | 0 |  | 0 |

_Take-out hour (UTC) on the rows; the `rate_*` columns are the v3 confirmation rate WITHIN a bars-remaining stratum (DESIGN.md §2 bins: 12–24 / 24–48 / 48–72 / 72+), blank where the stratum has < 20 events. The stratification is the point: §6.1 warns that an unstratified hourly cut just rediscovers the clock, because a take-out's hour and its remaining window length are the same fact seen twice._

## A. Appendix

### A1. Primary vs short-window sample

| sample | n | share_pct | rem_median | ifvg_rate_v3 | ifvg_rate_v2 | rev_atr_median | conf_R_median |
|---|---|---|---|---|---|---|---|
| primary (>= 12 bars left) | 21118 | 90.16 | 59.00 | 20.74 | 64.43 | 4.05 | 0.74 |
| short window (< 12 bars left) | 2305 | 9.84 | 6.00 | 4.51 | 10.67 | 2.36 | 0.26 |
| FULL sample (both) | 23423 | 100.00 | 55.00 | 19.14 | 59.14 | 3.84 | 0.73 |

### A2. Full-sample confirmation rate (no window filter)

| level_session | Asia | London | NY | Late | ALL blocks |
|---|---|---|---|---|---|
| Asia | 19.13 | 17.64 | 21.20 | 12.98 | 18.83 |
| London | 23.05 | 11.48 | 20.99 | 9.88 | 20.25 |
| NY | 23.95 | 16.38 | 19.21 | 12.92 | 18.17 |
