_Window: 2022-08-01 .. 2026-07-31 (1460 days), 4 symbols, 5m bars. **23,423 take-outs** — byte-identical to v2's and v3's event stream (checks.py) — of which **21,118 (90.2%)** are primary (>= 12 bars = 1h left in the sweep block). Only the iFVG confirmation layer differs from v2/v3. iFVG only; no BoS, no PDH/PDL._

## D. The three-way delta — v2 / v3-A / v4 on the same take-outs

### D1. Headline metrics, all three algorithms, same event rows (primary sample)

| algorithm | n_confirmed | confirm_rate_pct | delay_median_bars | gap_size_atr_median | mfe_atr_median | mae_atr_median | stop_atr_median | R_median | share_R_ge_1 | share_R_ge_2 |
|---|---|---|---|---|---|---|---|---|---|---|
| v2 — retroactive best-pick (the original bug) | 13606 | 64.43 | 15.00 | 0.35 | 2.34 | 2.36 | 2.67 | 0.84 | 43.61 | 19.60 |
| v3-A — sequential + the fabricated invalidation rule | 4379 | 20.74 | 14.00 | 0.30 | 2.08 | 2.02 | 2.72 | 0.74 | 40.58 | 17.42 |
| v4 — sequential, NO invalidation (§5.1, current spec) | 13606 | 64.43 | 15.00 | 0.36 | 2.34 | 2.36 | 2.67 | 0.84 | 43.61 | 19.60 |
| delta (v4 - v2) | 0 | 0.00 | 0.00 | 0.01 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| delta (v4 - v3-A) | 9227 | 43.69 | 1.00 | 0.06 | 0.25 | 0.34 | -0.05 | 0.10 | 3.03 | 2.18 |

_Same take-outs, same horizon, same geometry formulas — the ONLY difference is which gap (if any) each algorithm selects. Each row is computed on that algorithm's own confirmed subset, so `n_confirmed` differs by construction; that difference IS the finding._

### D2. Selected-gap-size distribution — the small-gap-bias prediction, retested

| algorithm | n | p10 | median | p90 | mean |
|---|---|---|---|---|---|
| v2 — retroactive best-pick (the original bug) | 13606 | 0.060 | 0.355 | 1.236 | 0.548 |
| v3-A — sequential + the fabricated invalidation rule | 4379 | 0.048 | 0.298 | 1.121 | 0.475 |
| v4 — sequential, NO invalidation (§5.1, current spec) | 13606 | 0.061 | 0.363 | 1.253 | 0.559 |
| v2, restricted to take-outs v4 ALSO confirms | 13606 | 0.060 | 0.355 | 1.236 | 0.548 |
| v4, restricted to take-outs v2 ALSO confirms | 13606 | 0.061 | 0.363 | 1.253 | 0.559 |
| v2, ONLY where the two pick different gaps | 918 | 0.047 | 0.245 | 0.875 | 0.401 |
| v4, ONLY where the two pick different gaps | 918 | 0.057 | 0.347 | 1.156 | 0.575 |

_Gap height of the SELECTED gap, in ATR(14, 5m) at the take-out bar. Rows 4-5 hold the event set fixed so the comparison is not confounded by the algorithms confirming different take-outs; rows 6-7 narrow further to the 918 take-outs where they pick a **different** gap, which is the only place a size difference can come from at all._

### D3. Outcome agreement — who confirms what (primary sample)

| pair | case | n | share_pct |
|---|---|---|---|
| v2 vs v4 | both confirm | 13606 | 64.43 |
| v2 vs v4 | only the older algorithm confirms | 0 | 0.00 |
| v2 vs v4 | only v4 confirms | 0 | 0.00 |
| v2 vs v4 | neither confirms | 7512 | 35.57 |
| v3-A vs v4 | both confirm | 4379 | 20.74 |
| v3-A vs v4 | only the older algorithm confirms | 0 | 0.00 |
| v3-A vs v4 | only v4 confirms | 9227 | 43.69 |
| v3-A vs v4 | neither confirms | 7512 | 35.57 |

_v4's confirmed set is a subset of v2's **by construction** (v4 can only ever confirm through a gap v2 also saw and also inverted). Whether the reverse holds is an empirical question, and the row above answers it._

### D4. SAME-GAP AGREEMENT — where v2 and v4 both confirm, do they pick the same gap?

| scope | n | same_gap_pct | delay_median_v2 | delay_median_v4 | gap_atr_median_v2 | gap_atr_median_v4 | R_median_v2 | R_median_v4 |
|---|---|---|---|---|---|---|---|---|
| all take-outs both confirm | 13606 | 93.253 | 15.000 | 15.000 | 0.355 | 0.363 | 0.841 | 0.841 |
| ...where the SAME gap is selected | 12688 | 100.000 | 15.000 | 15.000 | 0.364 | 0.364 | 0.850 | 0.850 |
| ...where a DIFFERENT gap is selected | 918 | 0.000 | 19.000 | 19.000 | 0.245 | 0.347 | 0.702 | 0.702 |

_With invalidation gone, the ONLY residual difference between v2 and v4 is **which** gap gets picked: v2 takes whichever qualifying gap inverts EARLIEST anywhere in the window (a comparison no one watching the tape can make); v4 takes whichever qualifying gap formed LAST before the inverting close. They agree on **93.3%** of the 13,606 take-outs both confirm._

#### D4b. Where they differ — the size of the disagreement

| quantity | n | p10 | median | mean | p90 | share_positive_pct | share_zero_pct |
|---|---|---|---|---|---|---|---|
| confirmation delay, v4 - v2 (bars) | 918 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 100.000 |
| gap FORMATION bar, v4 - v2 (bars) | 918 | 1.000 | 1.000 | 2.716 | 6.000 | 100.000 | 0.000 |
| selected gap height, v4 - v2 (ATR) | 918 | -0.511 | 0.083 | 0.174 | 0.843 | 58.279 | 0.545 |
| MFE from the confirmation close, v4 - v2 (ATR) | 911 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 100.000 |
| R proxy, v4 - v2 | 911 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 100.000 |

_Positive = v4's number is larger. **The confirmation BAR is identical in every one of these cases** (delay delta 0 throughout), and so is all downstream geometry — MFE, R, stop. The two algorithms are inverting two DIFFERENT gaps on the SAME closing bar: v2 names the earliest-formed of them, v4 the latest-formed. That is why only the gap-height row moves. The mechanism is close to a theorem: if no bar before `u` closed below the older gap's lower edge, then every later bar's high — and hence every later bullish gap's lower edge — sits at or above it, so a close that inverts the old gap inverts the fresh one too. Mirror for lows._

#### D4c. Same-gap agreement by how busy the window was

| n_candidates | n | share_of_both_pct | same_gap_pct | delay_delta_median | gap_delta_median |
|---|---|---|---|---|---|
| 1 | 5730 | 42.114 | 100.000 |  |  |
| 2 | 3887 | 28.568 | 89.375 | 0.000 | 0.072 |
| 3-4 | 2930 | 21.535 | 87.201 | 0.000 | 0.089 |
| 5-8 | 986 | 7.247 | 88.032 | 0.000 | 0.089 |
| 9+ | 73 | 0.537 | 83.562 | 0.000 | 0.105 |

_The two algorithms can only disagree when the window offered more than one qualifying gap, so agreement falls monotonically with how many candidates formed. `n_candidates` is v4's counter._

### D5. What the deleted invalidation rule was costing

| local_extremes_beyond_boundary | n | share_pct | v4_rate_pct | v3a_rate_pct | v2_rate_pct | closes_beyond_median | rev_atr_median | v4_R_median |
|---|---|---|---|---|---|---|---|---|
| 0 | 3732 | 17.67 | 11.28 | 11.28 | 11.28 | 0.00 | 6.22 | 0.74 |
| 1 | 3391 | 16.06 | 36.92 | 22.15 | 36.92 | 0.00 | 5.54 | 1.17 |
| 2 | 2433 | 11.52 | 59.35 | 25.11 | 59.35 | 4.00 | 4.46 | 1.15 |
| 3-4 | 3515 | 16.64 | 78.04 | 24.72 | 78.04 | 12.00 | 3.53 | 0.92 |
| 5+ | 8047 | 38.10 | 96.26 | 21.46 | 96.26 | 45.00 | 2.63 | 0.74 |

_Rows: how many local highs (for a high sweep; lows for a low sweep) price printed **beyond the take-out bar's own extreme** during the window — a 2-bar pivot count, diagnostic only, never a filter. This is exactly the shape the user's diagram shows and exactly what the deleted v3 rule punished: v3-A's rate collapses as soon as price makes a single further local high, while v4's does not move, because under v4 the boundary is the swept level and nothing else._

## S. State-machine diagnostics (primary sample)

### S1. Candidates seen and replacements per take-out

| quantity | mean | p50 | p90 | max | share_zero_pct |
|---|---|---|---|---|---|
| qualifying gaps seen (candidates) | 1.54 | 1.00 | 4.00 | 17 | 30.31 |
| replacements (a newer gap displaced a live one) | 0.84 | 0.00 | 3.00 | 16 | 59.36 |
| closes beyond the take-out extreme (v3 would have killed the candidate on the first of these; v4 ignores them) | 20.98 | 9.00 | 65.00 | 95 | 27.84 |
| local extremes printed beyond the take-out extreme | 4.22 | 3.00 | 11.00 | 18 | 17.67 |

### S1b. Candidate-count histogram and the confirmation rate inside each bin

| n_candidates | n | share_pct | confirm_rate_pct | replacements_median | delay_median | R_median |
|---|---|---|---|---|---|---|
| 0 | 6401 | 30.31 | 0.00 | 0.00 |  |  |
| 1 | 6135 | 29.05 | 93.40 | 0.00 | 11.00 | 0.88 |
| 2 | 4149 | 19.65 | 93.69 | 1.00 | 15.00 | 0.86 |
| 3-4 | 3231 | 15.30 | 90.68 | 2.00 | 20.00 | 0.78 |
| 5-8 | 1118 | 5.29 | 88.19 | 4.00 | 30.00 | 0.76 |
| 9+ | 84 | 0.40 | 86.90 | 9.00 | 49.00 | 0.51 |

_Unlike v3, where more candidates meant a LOWER rate (each new gap arrived alongside more chances to breach the invalidation line), under v4 more candidates simply means more chances to confirm._

### S2. Take-outs split by outcome cause — TWO unconfirmed causes now

| cause | n | share_pct | bars_remaining_median | candidates_median | rev_atr_median | adv_atr_median | would_confirm_extended_pct |
|---|---|---|---|---|---|---|---|
| confirmed | 13606 | 64.43 | 66.00 | 2.00 | 3.31 | 3.83 | 0.00 |
| no_candidate | 6401 | 30.31 | 51.00 | 0.00 | 5.98 | 0.00 | 11.83 |
| live_at_block_end | 1111 | 5.26 | 29.00 | 2.00 | 2.76 | 3.83 | 89.83 |

_`no_candidate` = no gap satisfying the V5 location filter ever formed inside the window. `live_at_block_end` = a candidate was alive and un-inverted when the clock ran out. v3's third cause, `invalidated_out` — which accounted for **45%** of its primary sample — **cannot occur under v4**: there is no rule left that discards a candidate. `rev_atr` is the wick-anchored reversal these take-outs still made, i.e. what the rule leaves on the table._

### S3. Outcome cause x sweep_block (column percentages)

| unconf_cause | Asia | London | NY | Late |
|---|---|---|---|---|
| confirmed | 66.09 | 60.08 | 69.86 | 46.75 |
| no_candidate | 28.83 | 33.74 | 27.01 | 40.28 |
| live_at_block_end | 5.08 | 6.17 | 3.13 | 12.98 |

_Within each block, how its take-outs split across the three outcomes._

## T. Re-derived core tables (v4, primary sample)

### T2. iFVG confirmation rate — level_session x sweep_block

| level_session | Asia | London | NY | Late | ALL blocks |
|---|---|---|---|---|---|
| Asia | 60.70 | 61.61 | 67.89 | 45.78 | 63.38 |
| London | 64.71 | 51.20 | 71.82 | 44.80 | 69.59 |
| NY | 68.22 | 54.72 | 64.12 | 47.14 | 58.88 |
| ALL levels | 66.09 | 60.08 | 69.86 | 46.75 | 64.43 |

_v3's counterpart is `../session-liquidity-v3/results/t2_ifvg_rate_levelsession_x_block.csv` — same cells, ~3x lower._

### T2b. Confirmation rate — level_session x direction x asset

| level_session | direction | n | ifvg_rate_ALL | v3a_rate_ALL | v2_rate_ALL | BTCUSDT | ETHUSDT | SOLUSDT | BNBUSDT |
|---|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 3692 | 65.90 | 20.94 | 65.90 | 66.81 | 64.72 | 64.49 | 67.63 |
| Asia | low_sweep | 3583 | 60.79 | 20.12 | 60.79 | 60.95 | 57.65 | 60.79 | 63.81 |
| London | high_sweep | 3894 | 70.67 | 21.19 | 70.67 | 71.31 | 69.15 | 70.16 | 72.05 |
| London | low_sweep | 3989 | 68.54 | 21.06 | 68.54 | 67.35 | 64.76 | 73.26 | 68.63 |
| NY | high_sweep | 3073 | 62.12 | 20.44 | 62.12 | 60.00 | 60.08 | 61.65 | 66.30 |
| NY | low_sweep | 2887 | 55.42 | 20.51 | 55.42 | 54.99 | 52.31 | 56.76 | 57.39 |

### T2c. The full core cut — level_session x sweep_block x direction x asset

Full table in `results/t2c_core_full_cut.csv` — 96 cells with n >= 15 (of 96 possible). Confirmation rate across cells: min 30%, median 61%, max 76%; median R proxy across cells 0.18 / 0.74 / 1.39.

### T3. Take-out -> confirmation delay, and the block-truncation share

| sweep_block | n | confirmed_pct | form_delay_median | delay_median_bars | delay_p25 | delay_p75 | delay_p90 | delay_median_min | unconfirmed_n | truncated_share_pct |
|---|---|---|---|---|---|---|---|---|---|---|
| Asia | 3347 | 66.09 | 10.00 | 15.00 | 8.00 | 27.00 | 42.00 | 75.00 | 1135 | 22.11 |
| London | 4487 | 60.08 | 10.00 | 14.00 | 8.00 | 23.00 | 33.00 | 70.00 | 1791 | 29.15 |
| NY | 10764 | 69.86 | 12.00 | 17.00 | 9.00 | 30.00 | 45.00 | 85.00 | 3244 | 16.09 |
| Late | 2520 | 46.75 | 7.00 | 11.00 | 7.00 | 17.00 | 24.00 | 55.00 | 1342 | 34.28 |
| ALL | 21118 | 64.43 | 11.00 | 15.00 | 8.00 | 26.00 | 40.00 | 75.00 | 7512 | 23.36 |

_`form_delay_median` = bars from the take-out to the 3rd bar of the gap that ended up confirming. `truncated_share_pct` = of the UNCONFIRMED take-outs, the share that would have confirmed had the block run 2h longer — a diagnostic probe, not part of any definition._

### T6. Magnitude from the iFVG CONFIRMATION CLOSE — the tradable view

| level_session | direction | n | mfe_atr_median | mfe_atr_p75 | mfe_atr_p90 | mae_atr_median | mae_atr_p90 | mfe_over_mae | end_atr_median | share_end_positive | conf_bars_left_median |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | ALL | 13543 | 2.34 | 4.34 | 7.65 | 2.36 | 8.70 | 0.99 | 0.10 | 51.40 | 43.00 |
| ALL | high_sweep | 7054 | 2.45 | 4.61 | 8.30 | 2.32 | 8.32 | 1.06 | 0.08 | 50.86 | 42.00 |
| ALL | low_sweep | 6489 | 2.20 | 4.08 | 6.90 | 2.39 | 9.00 | 0.92 | 0.13 | 52.00 | 44.00 |
| Asia | ALL | 4589 | 2.21 | 4.03 | 6.78 | 2.21 | 7.56 | 1.00 | 0.13 | 52.22 | 36.00 |
| Asia | high_sweep | 2419 | 2.37 | 4.34 | 7.38 | 2.25 | 7.66 | 1.05 | 0.10 | 51.13 | 35.00 |
| Asia | low_sweep | 2170 | 2.05 | 3.80 | 6.17 | 2.17 | 7.46 | 0.94 | 0.17 | 53.44 | 36.00 |
| London | ALL | 5472 | 2.69 | 5.13 | 9.30 | 2.89 | 10.32 | 0.93 | 0.05 | 50.60 | 57.00 |
| London | high_sweep | 2741 | 2.79 | 5.51 | 10.22 | 2.76 | 9.99 | 1.01 | -0.00 | 49.75 | 57.00 |
| London | low_sweep | 2731 | 2.58 | 4.83 | 8.41 | 2.97 | 10.66 | 0.87 | 0.09 | 51.46 | 57.00 |
| NY | ALL | 3482 | 1.96 | 3.67 | 6.30 | 1.91 | 7.10 | 1.02 | 0.12 | 51.58 | 31.00 |
| NY | high_sweep | 1894 | 2.04 | 3.87 | 6.75 | 1.86 | 6.85 | 1.10 | 0.13 | 52.12 | 29.00 |
| NY | low_sweep | 1588 | 1.88 | 3.44 | 5.72 | 1.95 | 7.46 | 0.96 | 0.10 | 50.94 | 33.00 |

_MFE/MAE over what is LEFT of the block after the confirmation bar's close, in ATR units — what a trader entering on the signal actually has in front of them. `share_end_positive` = % still on the favourable side of the entry when the block closes._

### T7. Stop proxy and R proxy at the confirmation bar

| level_session | sweep_block | n | stop_atr_median | stop_atr_p90 | R_median | R_p75 | share_R_ge_1 | share_R_ge_2 |
|---|---|---|---|---|---|---|---|---|
| ALL | ALL | 13543 | 2.67 | 5.15 | 0.84 | 1.68 | 43.82 | 19.69 |
| ALL | Asia | 2206 | 2.63 | 4.87 | 0.81 | 1.64 | 43.70 | 18.54 |
| ALL | London | 2678 | 2.69 | 4.86 | 0.81 | 1.61 | 42.23 | 17.21 |
| ALL | NY | 7501 | 2.66 | 5.27 | 0.94 | 1.87 | 47.58 | 22.88 |
| ALL | Late | 1158 | 2.75 | 5.64 | 0.47 | 0.95 | 23.32 | 6.99 |
| Asia | ALL | 4589 | 2.66 | 5.05 | 0.80 | 1.60 | 42.25 | 18.11 |
| Asia | Asia | 381 | 2.64 | 4.85 | 0.66 | 1.34 | 37.01 | 14.70 |
| Asia | London | 2218 | 2.67 | 4.85 | 0.83 | 1.66 | 43.28 | 18.08 |
| Asia | NY | 1877 | 2.63 | 5.26 | 0.84 | 1.63 | 43.79 | 19.71 |
| Asia | Late | 113 | 3.04 | 6.50 | 0.36 | 0.63 | 14.16 | 3.54 |
| London | ALL | 5472 | 2.67 | 5.26 | 0.96 | 1.94 | 48.79 | 23.96 |
| London | Asia | 442 | 2.53 | 4.41 | 0.88 | 1.64 | 45.25 | 20.14 |
| London | London | 128 | 2.72 | 6.02 | 0.68 | 1.36 | 35.16 | 10.94 |
| London | NY | 4780 | 2.69 | 5.29 | 1.00 | 2.01 | 50.15 | 25.17 |
| London | Late | 122 | 2.72 | 5.34 | 0.44 | 0.89 | 22.95 | 4.10 |
| NY | ALL | 3482 | 2.68 | 5.08 | 0.72 | 1.43 | 38.05 | 15.08 |
| NY | Asia | 1383 | 2.66 | 5.04 | 0.85 | 1.69 | 45.05 | 19.09 |
| NY | London | 332 | 2.73 | 4.56 | 0.74 | 1.43 | 37.95 | 13.86 |
| NY | NY | 844 | 2.64 | 5.05 | 0.78 | 1.55 | 41.47 | 16.94 |
| NY | Late | 923 | 2.72 | 5.52 | 0.49 | 0.97 | 24.49 | 7.80 |

_Stop = distance from the confirmation close back to the sweep leg's running extreme (take-out bar .. confirmation bar). `R` = block-scoped MFE / that stop. **Descriptive only** — no costs, no exit rule, and MFE is a best-case exit nobody hits systematically._

### T9. Lift over each block's OWN unconditional baseline

| sweep_block | direction | n_takeouts | takeout_rev_atr_median | uncond_atr_median | lift_takeout | n_confirmed_v4 | lift_confirmed_v4 | n_confirmed_v3a | lift_confirmed_v3a | n_confirmed_v2 | lift_confirmed_v2 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 1851 | 3.973 | 3.220 | 1.234 | 1268 | 1.020 | 464 | 1.281 | 1268 | 1.020 |
| Asia | low_sweep | 1496 | 4.029 | 3.204 | 1.257 | 944 | 1.026 | 366 | 1.300 | 944 | 1.026 |
| London | high_sweep | 2387 | 4.106 | 3.058 | 1.343 | 1484 | 1.064 | 456 | 1.468 | 1484 | 1.064 |
| London | low_sweep | 2100 | 3.874 | 3.049 | 1.271 | 1212 | 0.968 | 415 | 1.285 | 1212 | 0.968 |
| NY | high_sweep | 5097 | 4.456 | 3.109 | 1.433 | 3648 | 1.206 | 1114 | 1.491 | 3648 | 1.206 |
| NY | low_sweep | 5667 | 4.162 | 3.014 | 1.381 | 3872 | 1.110 | 1190 | 1.412 | 3872 | 1.110 |
| Late | high_sweep | 1324 | 3.177 | 2.280 | 1.393 | 694 | 1.094 | 192 | 1.716 | 694 | 1.094 |
| Late | low_sweep | 1196 | 3.613 | 2.292 | 1.576 | 484 | 1.231 | 182 | 1.745 | 484 | 1.231 |

_`lift` = conditional median / same-block unconditional median, both measured from the WICK extreme (so both are hindsight-flattered the same way — the comparison survives, the level does not)._

### T9b. Window-matched lift — inside bars_remaining buckets

| sweep_block | bars_remaining | n | hi_lift | lo_lift | hi_conf_lift | lo_conf_lift |
|---|---|---|---|---|---|---|
| Asia | 12-23 | 284 | 1.407 | 1.224 | 0.979 | 1.039 |
| Asia | 24-47 | 625 | 1.218 | 1.189 | 1.001 | 0.927 |
| Asia | 48-95 | 2438 | 1.147 | 1.200 | 0.930 | 0.947 |
| London | 12-23 | 626 | 1.498 | 1.291 | 1.107 | 0.944 |
| London | 24-47 | 1838 | 1.277 | 1.256 | 0.954 | 0.939 |
| London | 48-95 | 2023 | 1.143 | 1.140 | 0.940 | 0.855 |
| NY | 12-23 | 477 | 1.326 | 1.453 | 1.194 | 1.085 |
| NY | 24-47 | 1313 | 1.430 | 1.370 | 1.075 | 0.996 |
| NY | 48-95 | 8974 | 1.202 | 1.182 | 0.993 | 0.939 |
| Late | 12-23 | 1005 | 1.393 | 1.629 | 1.110 | 1.285 |
| Late | 24-47 | 1515 | 1.322 | 1.445 | 1.014 | 1.158 |

### W2. Confirmation rate by remaining-window bucket

| bars_remaining | n | share_pct | ifvg_rate_v4 | ifvg_rate_v3a | ifvg_rate_v2 | delay_median | candidates_median |
|---|---|---|---|---|---|---|---|
| <12 (appendix only) | 2305 | 9.84 | 10.67 | 4.51 | 10.67 | 5.00 | 0.00 |
| 12-23 | 2392 | 10.21 | 37.71 | 12.71 | 37.71 | 10.00 | 1.00 |
| 24-47 | 5291 | 22.59 | 56.06 | 17.88 | 56.06 | 14.00 | 1.00 |
| 48-95 | 13435 | 57.36 | 72.48 | 23.29 | 72.48 | 17.00 | 1.00 |

_How much of the confirmation rate is just window length. W1 (the window-length distribution itself) is upstream of confirmation and unchanged: see v2's `w1_window_length.csv`._

### T11. Sensitivity — relaxed (V5 default) vs strict iFVG location, under v4

| variant | rate_pct | n | delay_median | rev_atr_median |
|---|---|---|---|---|
| relaxed — gap merely reaches beyond the level (V5, used everywhere) | 64.43 | 13606 | 15.00 | 3.31 |
| strict — whole gap beyond the level (phase-1 D5, sensitivity) | 57.16 | 12072 | 18.00 | 3.08 |

_Strict-but-not-relaxed confirmations: 0. Under a sequential machine, strict is not a subset of relaxed — the stricter filter admits fewer candidates, so a gap the relaxed run would have REPLACED never exists and an earlier strict-qualifying gap can survive to confirm. Counted, not smoothed over._

### T12. Monthly stability

Full table in `results/t12_monthly.csv` (48 months). Monthly v4 confirmation rate ranges **52-74%** (median 65%; v3-A's ranged 16-26%). Monthly median R proxy **0.57-1.16** (median 0.85). Worst / best month by rate: 2022-12 / 2024-12. See chart 07.

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

| hour | n | candidates_per_event | rate_ALL | v3a_rate_ALL | rate_12-24 | n_12-24 | rate_24-48 | n_24-48 | rate_48-72 | n_48-72 | rate_72+ | n_72+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 769 | 1.69 | 73.60 | 29.26 |  | 0 |  | 0 |  | 0 | 73.60 | 769 |
| 1 | 713 | 1.69 | 72.23 | 28.05 |  | 0 |  | 0 |  | 0 | 72.23 | 713 |
| 2 | 583 | 1.64 | 72.56 | 27.44 |  | 0 |  | 0 | 72.56 | 583 |  | 0 |
| 3 | 373 | 1.43 | 63.27 | 23.32 |  | 0 |  | 0 | 63.27 | 373 |  | 0 |
| 4 | 320 | 1.39 | 62.50 | 19.06 |  | 0 | 62.50 | 320 |  | 0 |  | 0 |
| 5 | 305 | 1.56 | 56.72 | 20.33 |  | 0 | 56.72 | 305 |  | 0 |  | 0 |
| 6 | 284 | 1.06 | 34.86 | 12.32 | 34.86 | 284 |  | 0 |  | 0 |  | 0 |
| 7 | 0 |  |  |  |  | 0 |  | 0 |  | 0 |  | 0 |
| 8 | 2023 | 1.62 | 67.77 | 21.21 |  | 0 |  | 0 | 67.77 | 2023 |  | 0 |
| 9 | 1105 | 1.46 | 62.35 | 21.99 |  | 0 | 62.35 | 1105 |  | 0 |  | 0 |
| 10 | 733 | 1.23 | 53.07 | 15.28 |  | 0 | 53.07 | 733 |  | 0 |  | 0 |
| 11 | 626 | 1.02 | 39.46 | 13.90 | 39.46 | 626 |  | 0 |  | 0 |  | 0 |
| 12 | 0 |  |  |  |  | 0 |  | 0 |  | 0 |  | 0 |
| 13 | 3896 | 1.78 | 76.69 | 22.72 |  | 0 |  | 0 |  | 0 | 76.69 | 3896 |
| 14 | 2517 | 1.70 | 73.58 | 22.84 |  | 0 |  | 0 |  | 0 | 73.58 | 2517 |
| 15 | 1589 | 1.72 | 73.19 | 22.97 |  | 0 |  | 0 | 73.19 | 1589 |  | 0 |
| 16 | 972 | 1.44 | 64.20 | 20.88 |  | 0 |  | 0 | 64.20 | 972 |  | 0 |
| 17 | 740 | 1.45 | 60.27 | 16.62 |  | 0 | 60.27 | 740 |  | 0 |  | 0 |
| 18 | 573 | 1.28 | 49.21 | 17.10 |  | 0 | 49.21 | 573 |  | 0 |  | 0 |
| 19 | 477 | 1.04 | 34.59 | 11.53 | 34.59 | 477 |  | 0 |  | 0 |  | 0 |
| 20 | 0 |  |  |  |  | 0 |  | 0 |  | 0 |  | 0 |
| 21 | 1515 | 1.32 | 51.95 | 16.30 |  | 0 | 51.95 | 1515 |  | 0 |  | 0 |
| 22 | 1005 | 1.19 | 38.91 | 12.64 | 38.91 | 1005 |  | 0 |  | 0 |  | 0 |
| 23 | 0 |  |  |  |  | 0 |  | 0 |  | 0 |  | 0 |

_Take-out hour (UTC) on the rows; the `rate_*` columns are the v4 confirmation rate WITHIN a bars-remaining stratum (bins 12-24 / 24-48 / 48-72 / 72+), blank where the stratum has < 20 events. The stratification is the point: §6.1 warns that an unstratified hourly cut just rediscovers the clock, because a take-out's hour and its remaining window length are the same fact seen twice._

## A. Appendix

### A1. Primary vs short-window sample

| sample | n | share_pct | rem_median | ifvg_rate_v4 | ifvg_rate_v3a | ifvg_rate_v2 | rev_atr_median | conf_R_median |
|---|---|---|---|---|---|---|---|---|
| primary (>= 12 bars left) | 21118 | 90.16 | 59.00 | 64.43 | 20.74 | 64.43 | 4.05 | 0.84 |
| short window (< 12 bars left) | 2305 | 9.84 | 6.00 | 10.67 | 4.51 | 10.67 | 2.36 | 0.28 |
| FULL sample (both) | 23423 | 100.00 | 55.00 | 59.14 | 19.14 | 59.14 | 3.84 | 0.83 |

### A2. Full-sample confirmation rate (no window filter)

| level_session | Asia | London | NY | Late | ALL blocks |
|---|---|---|---|---|---|
| Asia | 54.57 | 54.83 | 65.16 | 36.19 | 57.66 |
| London | 60.13 | 39.88 | 70.45 | 34.46 | 66.50 |
| NY | 63.09 | 44.42 | 60.38 | 39.74 | 52.04 |
