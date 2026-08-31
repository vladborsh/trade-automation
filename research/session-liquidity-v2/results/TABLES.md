_Window: 2022-08-01 .. 2026-07-31 (1460 days), 4 symbols, 5m bars. **23,423 take-outs** in total; **21,118 (90.2%)** are in the primary sample (>= 12 bars = 1h left in the sweep block). Sessions are non-overlapping (Asia 00-08 / London 08-13 / NY 13-21 / Late 21-24 UTC); Late produces no levels but hosts take-outs. iFVG only — BoS is out of scope for this pass._

### W1. Window-length distribution — how much block is left after a take-out

| sweep_block | take_outs | share_pct | rem_median | rem_p25 | rem_p75 | window_min_median | share_primary_pct | share_zero_window_pct |
|---|---|---|---|---|---|---|---|---|
| Asia | 3712 | 15.85 | 64.00 | 34.00 | 81.00 | 320.00 | 90.17 | 0.48 |
| London | 5315 | 22.69 | 41.00 | 21.00 | 54.00 | 205.00 | 84.42 | 1.09 |
| NY | 11143 | 47.57 | 76.00 | 56.00 | 88.00 | 380.00 | 96.60 | 0.20 |
| Late | 3253 | 13.89 | 23.00 | 13.00 | 31.00 | 115.00 | 77.47 | 1.05 |
| ALL | 23423 | 100.00 | 55.00 | 29.00 | 80.00 | 275.00 | 90.16 | 0.56 |

_`rem_*` are bars of 5m remaining in the block after the take-out bar; `window_min_median` is the same in minutes. `share_primary_pct` is the fraction that clears the >= 12-bar rule; the rest are the appendix sample (A1/A2). A zero window means the take-out printed on the block's very last bar — counted as a take-out, no magnitude measurable._

### W2. Take-outs and confirmation rate by remaining-window bucket

| bars_remaining | n | share_pct | ifvg_rate | ifvg_delay_median | rev_atr_median | adv_atr_median |
|---|---|---|---|---|---|---|
| <12 (appendix only) | 2305 | 9.84 | 10.67 | 5.00 | 2.36 | 0.23 |
| 12-23 | 2392 | 10.21 | 37.71 | 10.00 | 3.13 | 1.09 |
| 24-47 | 5291 | 22.59 | 56.06 | 14.00 | 3.67 | 1.70 |
| 48-95 | 13435 | 57.36 | 72.48 | 17.00 | 4.46 | 2.95 |

_This is the table that says how much of the confirmation rate is just window length. It is also why lift is computed bucket-matched (T9b)._

### T1. Take-out frequency — level_session x sweep_block (primary sample, all assets, both directions)

| level_session | Asia | London | NY | Late | TOTAL |
|---|---|---|---|---|---|
| Asia | 631 | 3623 | 2772 | 249 | 7275 |
| London | 683 | 250 | 6671 | 279 | 7883 |
| NY | 2033 | 614 | 1321 | 1992 | 5960 |
| TOTAL | 3347 | 4487 | 10764 | 2520 | 21118 |

_Rows = whose liquidity was taken; columns = the clock block it was taken in. 14.5 take-outs/day across the 4 assets._

### T1b. Take-out frequency — level_session x direction x asset (primary)

| level_session | direction | BNBUSDT | BTCUSDT | ETHUSDT | SOLUSDT | TOTAL | per_day |
|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 899 | 934 | 941 | 918 | 3692 | 2.53 |
| Asia | low_sweep | 876 | 904 | 895 | 908 | 3583 | 2.45 |
| London | high_sweep | 973 | 976 | 953 | 992 | 3894 | 2.67 |
| London | low_sweep | 1001 | 971 | 996 | 1021 | 3989 | 2.73 |
| NY | high_sweep | 822 | 750 | 724 | 777 | 3073 | 2.10 |
| NY | low_sweep | 744 | 711 | 692 | 740 | 2887 | 1.98 |

### T2. iFVG confirmation rate — level_session x sweep_block (primary)

| level_session | Asia | London | NY | Late | ALL blocks |
|---|---|---|---|---|---|
| Asia | 60.70 | 61.61 | 67.89 | 45.78 | 63.38 |
| London | 64.71 | 51.20 | 71.82 | 44.80 | 69.59 |
| NY | 68.22 | 54.72 | 64.12 | 47.14 | 58.88 |
| ALL levels | 66.09 | 60.08 | 69.86 | 46.75 | 64.43 |

_% of take-outs whose sweep is confirmed by a relaxed, block-scoped iFVG._

### T2b. iFVG confirmation rate — direction x asset x level_session (primary)

| level_session | direction | n | ifvg_rate_ALL | BTCUSDT | ETHUSDT | SOLUSDT | BNBUSDT |
|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 3692 | 65.90 | 66.81 | 64.72 | 64.49 | 67.63 |
| Asia | low_sweep | 3583 | 60.79 | 60.95 | 57.65 | 60.79 | 63.81 |
| London | high_sweep | 3894 | 70.67 | 71.31 | 69.15 | 70.16 | 72.05 |
| London | low_sweep | 3989 | 68.54 | 67.35 | 64.76 | 73.26 | 68.63 |
| NY | high_sweep | 3073 | 62.12 | 60.00 | 60.08 | 61.65 | 66.30 |
| NY | low_sweep | 2887 | 55.42 | 54.99 | 52.31 | 56.76 | 57.39 |

### T3. Take-out -> iFVG confirmation delay, and the block-truncation share

| sweep_block | n | confirmed_pct | delay_median_bars | delay_p25 | delay_p75 | delay_p90 | delay_median_min | unconfirmed_n | truncated_share_pct |
|---|---|---|---|---|---|---|---|---|---|
| Asia | 3347 | 66.09 | 15.00 | 8.00 | 27.00 | 42.00 | 75.00 | 1135 | 22.11 |
| London | 4487 | 60.08 | 14.00 | 8.00 | 23.00 | 33.00 | 70.00 | 1791 | 29.15 |
| NY | 10764 | 69.86 | 17.00 | 9.00 | 30.00 | 45.00 | 85.00 | 3244 | 16.09 |
| Late | 2520 | 46.75 | 11.00 | 7.00 | 17.00 | 24.00 | 55.00 | 1342 | 34.28 |
| ALL | 21118 | 64.43 | 15.00 | 8.00 | 26.00 | 40.00 | 75.00 | 7512 | 23.36 |

_`truncated_share_pct` = of the take-outs left UNCONFIRMED, the share that WOULD have confirmed had the block run 2h longer. That is the price of the block-scoped rule, quantified rather than assumed. It is a diagnostic probe, not part of any definition — those events stay unconfirmed everywhere else in this report._

### T4. Magnitude from the sweep's own WICK EXTREME, block-scoped (primary sample, ALL take-outs regardless of confirmation)

| level_session | direction | rev_atr_n | rev_atr_median | rev_atr_p25 | rev_atr_p75 | rev_atr_p90 | rev_atr_mean | rev_pct_median | adv_atr_median | adv_atr_p90 | share_no_continuation | end_atr_median |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 3692 | 4.07 | 2.43 | 6.33 | 9.90 | 5.13 | 0.85 | 2.31 | 9.58 | 15.93 | 1.33 |
| Asia | low_sweep | 3583 | 3.94 | 2.40 | 6.00 | 8.85 | 4.82 | 0.91 | 2.07 | 8.75 | 19.56 | 1.54 |
| London | high_sweep | 3894 | 4.52 | 2.61 | 7.65 | 12.50 | 6.18 | 1.07 | 2.88 | 11.73 | 14.71 | 1.08 |
| London | low_sweep | 3989 | 4.21 | 2.47 | 7.05 | 11.27 | 5.72 | 1.08 | 2.96 | 11.67 | 13.79 | 1.32 |
| NY | high_sweep | 3073 | 3.67 | 2.23 | 5.84 | 8.98 | 4.60 | 0.82 | 2.06 | 8.43 | 18.94 | 1.27 |
| NY | low_sweep | 2887 | 3.80 | 2.42 | 5.68 | 8.36 | 4.57 | 0.96 | 1.79 | 8.55 | 24.28 | 1.65 |

_`rev` = max FAVOURABLE excursion away from the swept level within the block (the reversal); `adv` = max ADVERSE continuation past the wick extreme; `end` = signed value at the block's closing bar (positive = still on the reversal side); `share_no_continuation` = % of take-outs where price NEVER traded past the take-out wick again before the block closed (excursions are floored at 0, so this column carries what the floor hides). ATR = ATR(14) 5m read at the take-out bar. Measured from the wick, this table is contaminated by hindsight — the wick extreme is only knowable after the fact. T6/T7 are the tradable view._

### T5. Magnitude from the wick extreme, by asset and by sweep_block (primary)

| symbol | sweep_block | n | rev_atr_median | rev_atr_p90 | rev_pct_median | adv_atr_median | end_atr_median |
|---|---|---|---|---|---|---|---|
| BTCUSDT | Asia | 724 | 4.25 | 9.61 | 0.66 | 2.06 | 1.82 |
| BTCUSDT | London | 1100 | 4.31 | 8.86 | 0.57 | 2.05 | 1.62 |
| BTCUSDT | NY | 2840 | 4.56 | 13.05 | 0.90 | 2.91 | 1.32 |
| BTCUSDT | Late | 582 | 3.65 | 7.45 | 0.64 | 1.31 | 1.89 |
| ETHUSDT | Asia | 757 | 4.13 | 9.16 | 1.00 | 1.96 | 1.80 |
| ETHUSDT | London | 1122 | 4.09 | 8.59 | 0.80 | 1.97 | 1.74 |
| ETHUSDT | NY | 2713 | 4.41 | 12.12 | 1.22 | 2.71 | 1.35 |
| ETHUSDT | Late | 609 | 3.74 | 7.01 | 0.92 | 0.94 | 1.99 |
| SOLUSDT | Asia | 852 | 3.61 | 8.71 | 1.29 | 2.16 | 1.19 |
| SOLUSDT | London | 1126 | 3.67 | 7.69 | 1.05 | 2.05 | 1.27 |
| SOLUSDT | NY | 2699 | 4.10 | 11.05 | 1.59 | 2.80 | 0.92 |
| SOLUSDT | Late | 679 | 2.98 | 6.14 | 1.01 | 1.50 | 1.06 |
| BNBUSDT | Asia | 1014 | 4.02 | 9.96 | 0.78 | 2.62 | 1.51 |
| BNBUSDT | London | 1139 | 3.92 | 8.72 | 0.67 | 2.07 | 1.38 |
| BNBUSDT | NY | 2512 | 4.16 | 11.02 | 0.88 | 2.86 | 1.13 |
| BNBUSDT | Late | 650 | 3.28 | 6.79 | 0.56 | 1.52 | 1.21 |

_The ATR column is the cross-asset-comparable one; the % column is kept beside it to show why (raw % differs across assets purely through volatility — SOL looks ~2x BTC in % and does not in ATR)._

### T6. Magnitude from the iFVG CONFIRMATION CLOSE — the tradable view (primary sample, confirmed events only)

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

_MFE/MAE over what is LEFT of the block after the confirmation bar's close (median `conf_bars_left_median` bars), in ATR units. This is what a trader entering on the signal actually has in front of them — the uncontaminated comparison. `share_end_positive` = % of confirmed events still on the favourable side of the entry when the block closes._

### T7. Stop proxy and R proxy at the iFVG confirmation bar (primary, confirmed)

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

_Stop = distance from the confirmation close back to the sweep leg's running extreme (take-out bar .. confirmation bar) — where a protective stop would sit. `R` = (block-scoped MFE) / (that stop distance). `share_R_ge_1` = % of confirmed events where price travelled at least one stop distance favourably before the block closed. **Descriptive only** — no costs, no exit rule, no slippage, not a backtest, and MFE is a best-case exit nobody can hit systematically._

### T8. Unconditional yardstick — the same block-scoped horizon, from EVERY bar

| sweep_block | bars | down_atr_median | down_atr_p90 | up_atr_median | up_atr_p90 |
|---|---|---|---|---|---|
| Asia | 490896 | 3.22 | 8.86 | 3.20 | 8.68 |
| London | 280512 | 3.06 | 8.18 | 3.05 | 8.23 |
| NY | 490896 | 3.11 | 9.77 | 3.01 | 9.06 |
| Late | 140160 | 2.28 | 6.38 | 2.29 | 5.98 |
| ALL | 1402464 | 3.03 | 8.80 | 2.99 | 8.48 |

_Context, not a gate: `down_atr` is the drop from a bar's high to the end of that bar's own block (the high-sweep analogue), `up_atr` the rise from a bar's low. Restricted to bars with >= 12 bars left, to match the primary sample. NOTE the asymmetry this bakes in: a block's early bars have long windows and its late bars short ones, in the baseline exactly as in the events — which is why T9b exists._

### T9. Lift over each block's OWN unconditional baseline (primary sample)

| sweep_block | direction | n_takeouts | takeout_rev_atr_median | uncond_atr_median | lift_takeout | n_confirmed | confirmed_rev_atr_median | lift_confirmed |
|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 1851 | 3.973 | 3.220 | 1.234 | 1268 | 3.285 | 1.020 |
| Asia | low_sweep | 1496 | 4.029 | 3.204 | 1.257 | 944 | 3.287 | 1.026 |
| London | high_sweep | 2387 | 4.106 | 3.058 | 1.343 | 1484 | 3.255 | 1.064 |
| London | low_sweep | 2100 | 3.874 | 3.049 | 1.271 | 1212 | 2.952 | 0.968 |
| NY | high_sweep | 5097 | 4.456 | 3.109 | 1.433 | 3648 | 3.749 | 1.206 |
| NY | low_sweep | 5667 | 4.162 | 3.014 | 1.381 | 3872 | 3.347 | 1.110 |
| Late | high_sweep | 1324 | 3.177 | 2.280 | 1.393 | 694 | 2.495 | 1.094 |
| Late | low_sweep | 1196 | 3.613 | 2.292 | 1.576 | 484 | 2.822 | 1.231 |

_`lift` = conditional median / same-block unconditional median. This is the honest way to read the user's NY/Asia prior: raw medians are confounded by how volatile each block is to begin with, and by how long its windows are. A lift near 1.0 means the sweep told you nothing the clock did not already tell you. Both columns measure from the WICK extreme, so both are hindsight-flattered in the same way — the comparison survives, the level does not._

### T9b. Window-matched lift — same comparison, inside bars_remaining buckets

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

_Removes the last confound in T9: within a block, an early take-out has a long window and a late one a short window, and so does the baseline bar it is compared against. Matching on the bucket compares like with like._

### T10. `n_levels_taken` split — how often one bar clears several levels

| n_levels_taken | n | share_pct | ifvg_rate | excursion_atr_median | rev_atr_median | adv_atr_median | conf_mfe_atr_median | conf_R_median |
|---|---|---|---|---|---|---|---|---|
| 1 | 18721 | 88.65 | 65.01 | 0.59 | 4.01 | 2.39 | 2.37 | 0.86 |
| 2 | 2065 | 9.78 | 60.63 | 0.77 | 4.32 | 2.17 | 2.06 | 0.71 |
| 3 | 286 | 1.35 | 58.39 | 0.91 | 5.22 | 1.74 | 1.94 | 0.62 |
| 4 | 41 | 0.19 | 36.59 | 1.04 | 5.09 | 0.56 | 0.90 | 0.30 |
| 5 | 5 | 0.02 | 20.00 | 1.43 | 5.16 | 1.06 | 7.14 | 2.07 |

_V2 attribution: when one bar takes out several levels the event is credited to the deepest one and all of them are retired, so a multi-level bar produces ONE event, not N correlated ones. This table is what that choice costs / buys._

### T11. Sensitivity — relaxed (V5 default) vs strict iFVG location

| variant | rate_pct | n | delay_median | rev_atr_median |
|---|---|---|---|---|
| relaxed — gap merely reaches beyond the level (V5, used everywhere above) | 64.43 | 13606 | 15.00 | 3.31 |
| strict — whole gap beyond the level (phase-1 D5, sensitivity only) | 57.16 | 12072 | 18.00 | 3.08 |

### T12. Monthly stability

Full tables in `results/t12_monthly.csv` and `results/t12b_monthly_by_level_session.csv` (48 months). Per-month take-outs: median 444, min 385, max 493. Monthly iFVG rate ranges **52–74%** (median 65%). Monthly median R proxy ranges **0.57–1.16** (median 0.85). Worst / best month by iFVG rate: 2022-12 / 2024-12. See chart 07.

### A1. APPENDIX — the short-window sample that the primary tables exclude

| sample | n | share_pct | rem_median | ifvg_rate | rev_atr_median | adv_atr_median | conf_R_median |
|---|---|---|---|---|---|---|---|
| primary (>= 12 bars left) | 21118 | 90.16 | 59.00 | 64.43 | 4.05 | 2.35 | 0.84 |
| short window (< 12 bars left) | 2305 | 9.84 | 6.00 | 10.67 | 2.36 | 0.23 | 0.28 |
| FULL sample (both) | 23423 | 100.00 | 55.00 | 59.14 | 3.84 | 2.10 | 0.83 |

_The short-window events are not noise to be discarded — they are real take-outs whose measurement window the clock cut short. Their lower confirmation rate and smaller magnitudes are an artefact of window length, which is exactly why they are reported separately rather than pooled in._

### A2. APPENDIX — full-sample versions of T2 and T4 (no window filter)

| level_session | Asia | London | NY | Late | ALL blocks |
|---|---|---|---|---|---|
| Asia | 54.57 | 54.83 | 65.16 | 36.19 | 57.66 |
| London | 60.13 | 39.88 | 70.45 | 34.46 | 66.50 |
| NY | 63.09 | 44.42 | 60.38 | 39.74 | 52.04 |

| level_session | direction | n | rev_atr_median | rev_atr_p90 | adv_atr_median | end_atr_median |
|---|---|---|---|---|---|---|
| Asia | high_sweep | 4140 | 3.85 | 9.53 | 2.02 | 1.33 |
| Asia | low_sweep | 4016 | 3.77 | 8.43 | 1.84 | 1.53 |
| London | high_sweep | 4123 | 4.33 | 12.27 | 2.72 | 1.09 |
| London | low_sweep | 4200 | 4.08 | 11.10 | 2.77 | 1.31 |
| NY | high_sweep | 3569 | 3.45 | 8.58 | 1.76 | 1.24 |
| NY | low_sweep | 3375 | 3.56 | 7.96 | 1.55 | 1.56 |
