_Window: 2022-08-01 .. 2026-07-31 (1460 days), 4 symbols, 5m bars, 20,999 sweep events._

### T1. Sweep (take-out) frequency — level session x direction x asset

| level_session | direction | BNBUSDT | BTCUSDT | ETHUSDT | SOLUSDT | TOTAL | per_day_all |
|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 1008 | 1063 | 1040 | 1027 | 4138 | 3 |
| Asia | low_sweep | 982 | 1012 | 1003 | 1019 | 4016 | 3 |
| London | high_sweep | 781 | 730 | 755 | 780 | 3046 | 2 |
| London | low_sweep | 733 | 700 | 686 | 765 | 2884 | 2 |
| NY | high_sweep | 932 | 867 | 849 | 903 | 3551 | 2 |
| NY | low_sweep | 864 | 824 | 798 | 878 | 3364 | 2 |

### T2. Confirmation rate by method — level session x direction

| level_session | direction | events | ifvg_rate | bos_rate | both | only_ifvg | only_bos | neither |
|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 4138 | 40.48 | 54.57 | 17.01 | 23.47 | 37.55 | 21.97 |
| Asia | low_sweep | 4016 | 37.18 | 56.10 | 16.41 | 20.77 | 39.69 | 23.13 |
| London | high_sweep | 3046 | 40.68 | 50.62 | 15.63 | 25.05 | 35.00 | 24.33 |
| London | low_sweep | 2884 | 35.78 | 55.37 | 15.19 | 20.60 | 40.19 | 24.03 |
| NY | high_sweep | 3551 | 41.26 | 54.15 | 17.69 | 23.57 | 36.47 | 22.28 |
| NY | low_sweep | 3364 | 35.79 | 52.44 | 13.94 | 21.85 | 38.50 | 25.71 |

_Rates in %. `both`/`only_*`/`neither` partition the same events — they sum to 100._

### T3. iFVG x BoS agreement matrix (all events, all sessions)

| cell | events | share_pct |
|---|---|---|
| both fire | 3374 | 16.07 |
| only iFVG | 4734 | 22.54 |
| only BoS | 7963 | 37.92 |
| neither | 4928 | 23.47 |

**Timing offset when both fire** (iFVG delay − BoS delay, bars of 5m; negative = iFVG first): n=3,374, median -6, p25 -10, p75 -1, iFVG-first 81.9%, same-bar 9.5%, BoS-first 8.6%.

| level_session | n | median | p25 | p75 | p90 | mean |
|---|---|---|---|---|---|---|
| Asia | 1363.00 | -5.00 | -10.00 | -1.00 | 0.00 | -5.27 |
| London | 914.00 | -6.00 | -9.00 | -2.00 | 0.00 | -5.54 |
| NY | 1097.00 | -6.00 | -10.00 | -1.00 | 0.00 | -5.48 |

### T4. Reverse move from the sweep's own wick extreme, 2h horizon (ALL take-outs, unconditional on confirmation)

| level_session | direction | rev_atr_n | rev_atr_median | rev_atr_p25 | rev_atr_p75 | rev_atr_p90 | rev_atr_mean | rev_pct_median | adv_atr_median | end_atr_median |
|---|---|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 4138 | 3.34 | 2.05 | 5.08 | 7.43 | 4.00 | 0.70 | 1.59 | 1.20 |
| Asia | low_sweep | 4016 | 3.36 | 2.07 | 4.91 | 6.86 | 3.84 | 0.76 | 1.49 | 1.41 |
| London | high_sweep | 3046 | 3.02 | 1.87 | 4.51 | 6.44 | 3.52 | 0.74 | 1.43 | 1.03 |
| London | low_sweep | 2884 | 3.03 | 1.97 | 4.29 | 6.01 | 3.44 | 0.84 | 1.27 | 1.42 |
| NY | high_sweep | 3551 | 3.24 | 2.03 | 4.91 | 7.08 | 3.85 | 0.70 | 1.56 | 1.26 |
| NY | low_sweep | 3364 | 3.44 | 2.20 | 4.92 | 6.66 | 3.84 | 0.85 | 1.34 | 1.62 |

_`rev` = max favourable excursion away from the swept level (the reversal), `adv` = max continuation past the wick extreme, `end` = signed close at +2h. ATR = ATR(14) on 5m as of the take-out bar._

### T5. Reverse move split by confirmation method

| method | level_session | n | rev_atr_median | rev_atr_p75 | rev_atr_p90 | rev_pct_median | adv_atr_median | end_atr_median |
|---|---|---|---|---|---|---|---|---|
| iFVG | Asia | 3168 | 2.18 | 3.35 | 4.96 | 0.48 | 3.29 | -0.26 |
| iFVG | London | 2271 | 2.04 | 3.03 | 4.34 | 0.53 | 2.94 | -0.21 |
| iFVG | NY | 2669 | 2.29 | 3.43 | 4.85 | 0.53 | 3.25 | -0.18 |
| BoS | Asia | 4511 | 4.32 | 6.13 | 8.62 | 0.91 | 0.80 | 2.74 |
| BoS | London | 3139 | 3.89 | 5.37 | 7.48 | 1.00 | 0.62 | 2.58 |
| BoS | NY | 3687 | 4.23 | 5.96 | 8.11 | 0.96 | 0.67 | 2.85 |
| both | Asia | 1363 | 2.76 | 4.26 | 6.48 | 0.55 | 2.62 | 1.08 |
| both | London | 914 | 2.49 | 3.94 | 5.66 | 0.62 | 2.41 | 1.04 |
| both | NY | 1097 | 2.86 | 4.26 | 6.02 | 0.61 | 2.76 | 1.13 |
| neither | Asia | 1838 | 3.01 | 4.09 | 5.20 | 0.68 | 1.56 | 0.27 |
| neither | London | 1434 | 2.73 | 3.67 | 4.81 | 0.74 | 1.39 | 0.24 |
| neither | NY | 1656 | 3.06 | 4.15 | 5.29 | 0.76 | 1.40 | 0.57 |
| ALL take-outs | Asia | 8154 | 3.35 | 4.99 | 7.13 | 0.72 | 1.54 | 1.31 |
| ALL take-outs | London | 5930 | 3.02 | 4.41 | 6.21 | 0.79 | 1.36 | 1.23 |
| ALL take-outs | NY | 6915 | 3.34 | 4.92 | 6.86 | 0.77 | 1.47 | 1.42 |

### T6. Reverse move by asset (all take-outs)

| symbol | direction | n | rev_atr_median | rev_atr_p90 | rev_pct_median | rev_pct_p90 | adv_atr_median |
|---|---|---|---|---|---|---|---|
| BNBUSDT | high_sweep | 2721 | 3.11 | 6.60 | 0.56 | 1.49 | 1.61 |
| BNBUSDT | low_sweep | 2579 | 3.24 | 6.45 | 0.68 | 1.86 | 1.55 |
| BTCUSDT | high_sweep | 2660 | 3.45 | 7.66 | 0.57 | 1.56 | 1.64 |
| BTCUSDT | low_sweep | 2536 | 3.50 | 6.86 | 0.64 | 1.69 | 1.35 |
| ETHUSDT | high_sweep | 2644 | 3.33 | 7.30 | 0.78 | 2.04 | 1.40 |
| ETHUSDT | low_sweep | 2487 | 3.47 | 6.59 | 0.90 | 2.24 | 1.21 |
| SOLUSDT | high_sweep | 2710 | 3.00 | 6.34 | 1.03 | 2.69 | 1.50 |
| SOLUSDT | low_sweep | 2662 | 2.97 | 6.17 | 1.08 | 2.90 | 1.43 |

_The ATR column is the comparable one; the % column shows why (raw % differs across assets purely through volatility)._

### T7. Session in which the take-out HAPPENS (vs. which session's level)

| sweep_session | n | share_pct | ifvg_rate | bos_rate | rev_atr_median | rev_atr_p90 | adv_atr_median | end_atr_median |
|---|---|---|---|---|---|---|---|---|
| Asia | 3712 | 17.68 | 38.71 | 53.29 | 3.26 | 6.51 | 1.40 | 1.48 |
| London | 5315 | 25.31 | 39.30 | 56.91 | 3.43 | 7.12 | 1.55 | 1.39 |
| London/NY overlap | 2873 | 13.68 | 39.54 | 49.74 | 3.25 | 7.67 | 1.79 | 1.03 |
| NY | 5845 | 27.83 | 37.11 | 53.62 | 3.01 | 6.16 | 1.23 | 1.24 |
| off-session | 3254 | 15.50 | 39.24 | 54.43 | 3.45 | 6.78 | 1.54 | 1.48 |

### T7b. Lift over the unconditional baseline, by clock session

| clock_session | direction | n | cond_rev_atr_median | uncond_atr_median | lift |
|---|---|---|---|---|---|
| Asia | high_sweep | 2030 | 3.183 | 2.504 | 1.271 |
| Asia | low_sweep | 1682 | 3.393 | 2.500 | 1.357 |
| London | high_sweep | 2847 | 3.467 | 2.857 | 1.214 |
| London | low_sweep | 2468 | 3.391 | 2.741 | 1.237 |
| London/NY overlap | high_sweep | 1362 | 3.260 | 2.930 | 1.112 |
| London/NY overlap | low_sweep | 1511 | 3.221 | 2.685 | 1.199 |
| NY | high_sweep | 2836 | 2.947 | 2.281 | 1.292 |
| NY | low_sweep | 3009 | 3.066 | 2.330 | 1.316 |
| off-session | high_sweep | 1660 | 3.306 | 2.548 | 1.297 |
| off-session | low_sweep | 1594 | 3.579 | 2.587 | 1.384 |

_`lift` = conditional median / same-clock-session unconditional median. This is the honest way to read the user's NY/Asia prior: raw medians are confounded by how volatile each clock session is to begin with._

### T8. Take-out → confirmation delay (bars of 5m; window capped at 24 = 2h)

| method | level_session | n | median_bars | p25 | p75 | p90 | median_min |
|---|---|---|---|---|---|---|---|
| iFVG | ALL | 8108 | 13.00 | 8.00 | 18.00 | 22.00 | 65.00 |
| iFVG | Asia | 3168 | 13.00 | 8.00 | 18.00 | 22.00 | 65.00 |
| iFVG | London | 2271 | 13.00 | 8.00 | 18.00 | 22.00 | 65.00 |
| iFVG | NY | 2669 | 13.00 | 8.00 | 18.00 | 22.00 | 65.00 |
| BoS | ALL | 11337 | 14.00 | 10.00 | 19.00 | 22.00 | 70.00 |
| BoS | Asia | 4511 | 14.00 | 10.00 | 19.00 | 22.00 | 70.00 |
| BoS | London | 3139 | 14.00 | 10.00 | 19.00 | 22.00 | 70.00 |
| BoS | NY | 3687 | 15.00 | 10.00 | 19.00 | 22.00 | 75.00 |

### T9. Unconditional yardstick — same 2h horizon, measured from EVERY bar

| clock_session | bars | down_atr_median | down_atr_p90 | up_atr_median | up_atr_p90 |
|---|---|---|---|---|---|
| Asia | 561024 | 2.50 | 6.49 | 2.50 | 6.28 |
| London | 350640 | 2.86 | 7.34 | 2.74 | 7.10 |
| London/NY overlap | 210384 | 2.93 | 7.85 | 2.69 | 7.30 |
| NY | 350640 | 2.28 | 6.12 | 2.33 | 5.69 |
| off-session | 210288 | 2.55 | 6.77 | 2.59 | 6.58 |
| ALL BARS | 1682976 | 2.58 | 6.82 | 2.54 | 6.51 |

_Context only, not a gate: `down_atr` is the drop from a bar's high over the next 2h (the high-sweep analogue), `up_atr` the rise from a bar's low._

Side by side — high-sweep reverse move median **3.21 ATR** vs unconditional down-move median **2.58 ATR**; low-sweep **3.28 ATR** vs unconditional up-move **2.54 ATR**.

### T10. Monthly sweep counts (all assets, both directions)

Full table in `results/t10_monthly_counts.csv` (48 months). Per-month totals: median 436, min 390, max 500; monthly iFVG rate ranges 28–47%, BoS 46–61%. See chart 07.

### T11. Sensitivity — strict vs relaxed iFVG location test

| variant | rate_pct | rev_atr_median |
|---|---|---|
| strict (whole gap beyond the level) | 38.61 | 2.17 |
| relaxed (gap merely reaches beyond) | 47.45 | 2.46 |

### T12. Reverse move measured from each method's CONFIRMATION close (secondary — what a trader entering on the signal would see)

| method | level_session | n | mfe_atr_median | mfe_atr_p90 | mae_atr_median | mfe_over_mae |
|---|---|---|---|---|---|---|
| IFVG | ALL | 8108 | 2.12 | 5.89 | 2.08 | 1.02 |
| IFVG | Asia | 3168 | 2.19 | 6.36 | 2.23 | 0.98 |
| IFVG | London | 2271 | 1.95 | 5.40 | 1.87 | 1.04 |
| IFVG | NY | 2669 | 2.18 | 5.70 | 2.07 | 1.05 |
| BOS | ALL | 11336 | 1.80 | 5.68 | 1.89 | 0.95 |
| BOS | Asia | 4511 | 1.91 | 6.19 | 2.02 | 0.94 |
| BOS | London | 3139 | 1.68 | 5.09 | 1.80 | 0.93 |
| BOS | NY | 3686 | 1.79 | 5.32 | 1.84 | 0.97 |

_MFE/MAE over the 2h following the confirmation bar's close, in ATR(14) units._

### T13. Stop distance and R proxy at the confirmation bar

| method | level_session | n | stop_atr_median | stop_atr_p90 | R_median | R_p75 | share_R_ge_1 | share_R_ge_2 |
|---|---|---|---|---|---|---|---|---|
| IFVG | ALL | 8108 | 2.53 | 4.90 | 0.81 | 1.48 | 41.06 | 14.97 |
| IFVG | Asia | 3168 | 2.57 | 4.89 | 0.83 | 1.52 | 41.86 | 16.32 |
| IFVG | London | 2271 | 2.35 | 4.54 | 0.82 | 1.48 | 41.57 | 14.97 |
| IFVG | NY | 2669 | 2.64 | 5.16 | 0.79 | 1.41 | 39.68 | 13.38 |
| BOS | ALL | 11336 | 3.76 | 6.48 | 0.47 | 0.89 | 20.80 | 5.46 |
| BOS | Asia | 4511 | 3.84 | 6.57 | 0.49 | 0.93 | 22.81 | 6.10 |
| BOS | London | 3139 | 3.48 | 5.95 | 0.47 | 0.88 | 20.52 | 5.07 |
| BOS | NY | 3686 | 3.91 | 6.73 | 0.44 | 0.84 | 18.58 | 5.02 |

_Stop = distance from the confirmation close back to the sweep leg's running extreme (take-out bar .. confirmation bar). `R` = 2h MFE / that stop distance. `share_R_ge_1` = % of confirmed events where price travelled at least one stop distance in the favourable direction within 2h. Descriptive only — no costs, no exit rule, not a backtest._
