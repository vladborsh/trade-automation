# Drill-down tables (post-v4) — level class x window regime, three combos

_Window: 2022-08-01 .. 2026-07-31, 4 assets (BTC / ETH / SOL / BNB), 5m bars. Descriptive only — no nulls, no gates. Primary sample throughout = >= 12 bars of the sweep block remaining (V4). Confirmation layer = **iFVG-v4** (`session-liquidity-v4/engine.py:ifvg_confirm_v4`), held FIXED and not under test; BoS is still quarantined, neither computed nor drawn._

## D. PDH/PDL stream diagnostics — read before any combo outcome

_A new level class does not get to report outcomes before it is shown to behave. Everything in this section is about the stream itself: how often it fires, how often the iFVG confirms it, and how much of it is the session-level stream wearing a different hat._

### D1. Frequency — take-outs per asset-day, and how the two streams compare

| symbol | days | pd_takeouts | pd_per_day | pdh_hit_pct | pdl_hit_pct | both_sides_pct | session_takeouts | session_per_day | pd_share_of_all_pct |
|---|---|---|---|---|---|---|---|---|---|
| BTCUSDT | 1461 | 1314 | 0.90 | 47.02 | 42.92 | 11.50 | 5834 | 3.99 | 18.38 |
| ETHUSDT | 1461 | 1310 | 0.90 | 45.52 | 44.15 | 10.20 | 5750 | 3.94 | 18.56 |
| SOLUSDT | 1461 | 1331 | 0.91 | 46.82 | 44.28 | 9.58 | 5966 | 4.08 | 18.24 |
| BNBUSDT | 1461 | 1329 | 0.91 | 47.43 | 43.53 | 11.23 | 5873 | 4.02 | 18.45 |

_`pdh_hit_pct` / `pdl_hit_pct` = the share of valid days on which the prior day's high / low was taken out at all. A day-level sweep is roughly a once-a-day event per asset, against ~16 session-level take-outs — the day level is a much rarer, and therefore much more selective, object._

### D2. Where in the clock PDH/PDL sweeps happen (block distribution)

| sweep_block | high_sweep | low_sweep | total | share_pct | ifvg_rate_primary | bars_left_median |
|---|---|---|---|---|---|---|
| Asia | 1531 | 1310 | 2841 | 53.77 | 67.71 | 76.00 |
| London | 411 | 375 | 786 | 14.88 | 57.74 | 38.00 |
| NY | 667 | 736 | 1403 | 26.55 | 65.34 | 65.00 |
| Late | 120 | 134 | 254 | 4.81 | 43.26 | 23.00 |

_The Asia block hosts the most PDH/PDL take-outs of any block, which is the mechanical consequence of the level becoming sweepable at 00:00 UTC — Asia gets first refusal on it every day. That is a property of the definition, not a market fact, and C3's frequency should be read with it in mind._

### D3. iFVG confirmation of PDH/PDL take-outs, vs the session stream

| stream | takeouts | primary | primary_pct | ifvg_rate_primary | ifvg_rate_all | delay_bars_median | would_confirm_extended_pct |
|---|---|---|---|---|---|---|---|
| PDH/PDL (all blocks) | 5284 | 4751 | 89.91 | 64.87 | 59.54 | 15.00 | 22.77 |
| session levels (all blocks) | 23423 | 21118 | 90.16 | 64.43 | 59.14 | 15.00 | 23.36 |

_The day level confirms at essentially the session level's rate. The new class is not harder or easier for the iFVG rule to see._

### D4. Does the Late block set the day's extreme? (the definition's justification)

| symbol | valid_days | late_set_high_pct | late_set_low_pct | late_set_either_pct |
|---|---|---|---|---|
| BTCUSDT | 1461 | 15.95 | 15.54 | 31.14 |
| ETHUSDT | 1461 | 16.02 | 15.20 | 31.14 |
| SOLUSDT | 1461 | 17.45 | 18.75 | 36.21 |
| BNBUSDT | 1461 | 15.95 | 14.24 | 30.05 |
| ALL | 5844 | 16.34 | 15.93 | 32.14 |

_This is the number that justifies the knowledge file's choice of the **full** prior UTC day over the 'max of the three session highs' shorthand. On roughly a sixth of days the high, and on a similar share the low, is printed in 21:00-24:00. A shorthand PDH would be wrong on those days — and wrong in the direction that matters, sitting below the real high so that a 'sweep' of it is not a sweep of anything._

### D5. Coincidence with a still-alive session level

| symbol | primary | coincident_pct | coincident_ifvg_rate | pure_ifvg_rate | coincident_R_median | pure_R_median | coincident_er_median | pure_er_median | n_pure |
|---|---|---|---|---|---|---|---|---|---|
| BTCUSDT | 1175 | 75.06 | 63.04 | 65.53 | 0.72 | 0.80 | 0.02 | 0.03 | 293 |
| ETHUSDT | 1162 | 75.04 | 59.75 | 61.03 | 0.64 | 0.79 | 0.02 | 0.03 | 290 |
| SOLUSDT | 1206 | 68.91 | 66.79 | 70.93 | 0.73 | 0.88 | -0.00 | 0.03 | 375 |
| BNBUSDT | 1208 | 74.09 | 65.70 | 72.52 | 0.80 | 0.95 | 0.02 | 0.00 | 313 |
| ALL | 4751 | 73.25 | 63.79 | 67.82 | 0.72 | 0.87 | 0.01 | 0.02 | 1271 |

_**The single most important diagnostic in this section.** About three quarters of PDH/PDL take-outs happen at a price where a still-alive session level sits within 0.05 ATR — i.e. the same excursion takes both. The day level is therefore mostly *not* an independent object: it is a relabelling of a session level that happened to be the day's extreme. The `pure_*` columns are the day level standing on its own, and they are the honest read of what the new class adds._

### D6. The pure day-level subset, by block

| sweep_block | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Asia | 1004 | 700 | 69.72 | 0.03 | -0.09 | 0.13 | 2.53 | 2.33 | 1.08 | 37.43 | 2.72 | 0.90 | 45.57 | 86.00 | 70.00 | 93.00 |
| London | 89 | 48 | 53.93 | -0.03 | -0.21 | 0.17 | 1.49 | 2.24 | 0.66 | 29.17 | 2.75 | 0.53 | 29.17 | 39.00 | 30.00 | 51.00 |
| NY | 154 | 103 | 66.88 | 0.02 | -0.12 | 0.16 | 2.20 | 2.38 | 0.92 | 35.92 | 2.56 | 0.88 | 44.66 | 66.00 | 50.00 | 79.00 |
| Late | 24 | 11 | 45.83 | 0.01 | -0.49 | 0.26 | 2.03 | 1.42 | 1.43 | 36.36 | 3.67 | 0.47 | 9.09 | 28.00 | 19.75 | 33.25 |
| ALL | 1271 | 862 | 67.82 | 0.02 | -0.10 | 0.14 | 2.44 | 2.32 | 1.05 | 36.77 | 2.72 | 0.87 | 44.08 | 81.00 | 56.00 | 91.00 |

_Same outcome columns as every table below, on the ~25% of day-level take-outs that are not a session level in disguise._


## A0. The three combos in aggregate — the baseline every cut is judged against

| combo | what | n_assets | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | London level swept in NY | 4 | 6671 | 4791 | 71.82 | 0.00 | -0.11 | 0.11 | 2.79 | 3.09 | 0.90 | 33.92 | 2.69 | 1.00 | 50.03 | 82.00 | 67.00 | 90.00 |
| C2 | PDH/PDL swept in NY | 4 | 1327 | 867 | 65.34 | -0.00 | -0.13 | 0.14 | 2.04 | 2.30 | 0.89 | 33.45 | 2.74 | 0.74 | 39.10 | 65.00 | 43.00 | 79.00 |
| C3 | PDH/PDL swept in Asia | 4 | 2645 | 1791 | 67.71 | 0.02 | -0.10 | 0.14 | 2.44 | 2.20 | 1.11 | 38.53 | 2.79 | 0.80 | 42.32 | 76.00 | 54.00 | 88.00 |
| C2-pure | PDH/PDL swept in NY, no coincident session level | 4 | 154 | 103 | 66.88 | 0.02 | -0.12 | 0.16 | 2.20 | 2.38 | 0.92 | 35.92 | 2.56 | 0.88 | 44.66 | 66.00 | 50.00 | 79.00 |
| C3-pure | PDH/PDL swept in Asia, no coincident session level | 4 | 1004 | 700 | 69.72 | 0.03 | -0.09 | 0.13 | 2.53 | 2.33 | 1.08 | 37.43 | 2.72 | 0.90 | 45.57 | 86.00 | 70.00 | 93.00 |

_`er_median` is the signed efficiency ratio of the post-confirmation path to the block end: +1 a perfectly straight reversal, 0 chop, negative a trend running against the sweep. `R_median` is the parent report's MFE-over-sweep-leg-stop proxy — the number whose C1 value of 1.00 is the break-even aggregate this whole pass is trying to beat from the inside._


### A1. Confirmed vs bare take-out — the v4 framing, restated per combo

_v4's headline was that iFVG confirmation is a **timing device, not a filter**: it keeps ~64% of take-outs and the confirmed subset's lift sits *below* the bare take-out's. This table restates that per combo, so the rest of the pass is read with the right expectation. `rev_atr` is measured from the take-out wick (no confirmation involved); `mfe_atr` from the confirmation close. They are different anchors and are NOT comparable to each other -- what is comparable is the confirmed vs unconfirmed split of the same wick-anchored column._

| combo | what | takeouts | ifvg_rate | rev_atr_all | rev_atr_confirmed | rev_atr_unconfirmed | adv_atr_confirmed | adv_atr_unconfirmed | no_candidate_pct | delay_bars_median | n_candidates_median |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | London level swept in NY | 6671 | 71.818 | 4.519 | 3.718 | 7.167 | 4.664 | 0.267 | 91.330 | 17.000 | 1.000 |
| C2 | PDH/PDL swept in NY | 1327 | 65.335 | 4.021 | 3.302 | 5.540 | 3.706 | 0.058 | 86.304 | 17.000 | 1.000 |
| C3 | PDH/PDL swept in Asia | 2645 | 67.713 | 4.247 | 3.410 | 6.183 | 3.689 | 0.000 | 86.183 | 15.000 | 1.000 |

_Read the three `rev_atr_*` columns together: in every combo the **unconfirmed** take-outs carry the larger wick-anchored reversal. That is v4's finding reproduced on all three combos — the iFVG rule is not selecting the better sweeps, it is telling you when to enter the ones it does keep. Nothing below should be read as 'confirmation adds edge'; the pass is asking whether the LEVEL CLASS and the WINDOW REGIME add any._


## W. Question (a), PRIMARY AXIS — the window regime

_Window-length stratum = bars of the sweep block still remaining at the take-out bar (12-24 / 24-48 / 48-72 / 72+, brief-pinned). This is the axis v4 showed dominates everything else in this dataset, so it leads. The clock sub-window (section S) is the derived, secondary cut and is tested against the null this section establishes._

### W1. Each combo across window regimes

| combo | what | stratum | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | London level swept in NY | 12-24 | 217 | 68 | 31.336 | 0.082 | -0.188 | 0.379 | 1.444 | 1.023 | 1.411 | 41.176 | 2.187 | 0.535 | 14.706 | 19.000 | 16.000 | 21.000 |
| C1 | London level swept in NY | 24-48 | 573 | 307 | 53.578 | -0.006 | -0.188 | 0.149 | 1.648 | 1.564 | 1.054 | 35.831 | 2.462 | 0.626 | 32.573 | 37.000 | 31.000 | 42.000 |
| C1 | London level swept in NY | 48-72 | 1277 | 914 | 71.574 | -0.006 | -0.119 | 0.112 | 2.069 | 2.263 | 0.914 | 32.604 | 2.292 | 0.809 | 42.451 | 63.000 | 57.000 | 68.000 |
| C1 | London level swept in NY | 72+ | 4604 | 3502 | 76.064 | 0.003 | -0.101 | 0.103 | 3.288 | 3.649 | 0.901 | 33.952 | 2.821 | 1.128 | 54.226 | 87.000 | 81.000 | 92.000 |
| C1 | London level swept in NY | ALL | 6671 | 4791 | 71.818 | 0.001 | -0.108 | 0.108 | 2.786 | 3.094 | 0.900 | 33.918 | 2.690 | 1.005 | 50.031 | 82.000 | 67.000 | 90.000 |
| C2 | PDH/PDL swept in NY | 12-24 | 105 | 41 | 39.048 | -0.090 | -0.294 | 0.404 | 1.052 | 1.441 | 0.730 | 39.024 | 2.785 | 0.559 | 21.951 | 18.000 | 15.000 | 21.000 |
| C2 | PDH/PDL swept in NY | 24-48 | 283 | 161 | 56.890 | 0.012 | -0.187 | 0.202 | 1.514 | 1.559 | 0.971 | 34.161 | 2.723 | 0.522 | 25.466 | 36.000 | 31.000 | 42.000 |
| C2 | PDH/PDL swept in NY | 48-72 | 422 | 292 | 69.194 | -0.008 | -0.127 | 0.120 | 1.802 | 2.375 | 0.759 | 30.137 | 2.495 | 0.724 | 39.726 | 62.000 | 55.000 | 67.000 |
| C2 | PDH/PDL swept in NY | 72+ | 517 | 373 | 72.147 | -0.002 | -0.104 | 0.123 | 2.798 | 3.038 | 0.921 | 35.121 | 2.997 | 0.893 | 46.381 | 82.000 | 77.000 | 88.000 |
| C2 | PDH/PDL swept in NY | ALL | 1327 | 867 | 65.335 | -0.003 | -0.128 | 0.139 | 2.041 | 2.296 | 0.889 | 33.449 | 2.744 | 0.735 | 39.100 | 65.000 | 43.000 | 79.000 |
| C3 | PDH/PDL swept in Asia | 12-24 | 175 | 66 | 37.714 | 0.046 | -0.209 | 0.396 | 1.280 | 1.017 | 1.259 | 37.879 | 2.658 | 0.457 | 19.697 | 17.000 | 14.000 | 21.000 |
| C3 | PDH/PDL swept in Asia | 24-48 | 382 | 241 | 63.089 | 0.042 | -0.121 | 0.310 | 1.697 | 1.471 | 1.153 | 41.079 | 2.638 | 0.585 | 32.780 | 36.000 | 30.000 | 42.000 |
| C3 | PDH/PDL swept in Asia | 48-72 | 616 | 424 | 68.831 | 0.008 | -0.106 | 0.138 | 2.208 | 2.179 | 1.013 | 35.849 | 2.667 | 0.765 | 40.094 | 62.000 | 56.750 | 67.000 |
| C3 | PDH/PDL swept in Asia | 72+ | 1472 | 1060 | 72.011 | 0.027 | -0.089 | 0.117 | 2.789 | 2.523 | 1.106 | 39.057 | 2.854 | 0.915 | 46.792 | 87.000 | 80.000 | 92.000 |
| C3 | PDH/PDL swept in Asia | ALL | 2645 | 1791 | 67.713 | 0.024 | -0.098 | 0.141 | 2.444 | 2.195 | 1.113 | 38.526 | 2.788 | 0.804 | 42.323 | 76.000 | 54.000 | 88.000 |

_`ifvg_rate` reproduces v4's window-length gradient on all three combos -- longer window, higher confirmation rate, mechanically (there is simply more block left for a gap to form and invert in). `R_median` and `mfe_atr_median` also rise with the stratum, and they rise for the same mechanical reason: a longer window contains a larger maximum excursion. The scale-free columns -- `er_median`, `mfe_over_mae`, `clean_trend_pct`, `R_ge1_pct` -- are the ones that can carry a genuine regime effect, because they do not grow with the window by construction._

### W2. The comparison the clock confound does NOT block — combo vs combo at matched window regime

_Inside a block the take-out hour and the bars-remaining are the same variable seen twice (S3b), so the clock cannot be held fixed. The **level class** can: C1, C2 and C3 compared inside the same window-length stratum. Same amount of clock, different liquidity -- any difference here is about the level, not the window._

| stratum | combo | what | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 12-24 | C1 | London level swept in NY | 217 | 68 | 31.336 | 0.082 | -0.188 | 0.379 | 1.444 | 1.023 | 1.411 | 41.176 | 2.187 | 0.535 | 14.706 | 19.000 | 16.000 | 21.000 |
| 12-24 | C2 | PDH/PDL swept in NY | 105 | 41 | 39.048 | -0.090 | -0.294 | 0.404 | 1.052 | 1.441 | 0.730 | 39.024 | 2.785 | 0.559 | 21.951 | 18.000 | 15.000 | 21.000 |
| 12-24 | C3 | PDH/PDL swept in Asia | 175 | 66 | 37.714 | 0.046 | -0.209 | 0.396 | 1.280 | 1.017 | 1.259 | 37.879 | 2.658 | 0.457 | 19.697 | 17.000 | 14.000 | 21.000 |
| 24-48 | C1 | London level swept in NY | 573 | 307 | 53.578 | -0.006 | -0.188 | 0.149 | 1.648 | 1.564 | 1.054 | 35.831 | 2.462 | 0.626 | 32.573 | 37.000 | 31.000 | 42.000 |
| 24-48 | C2 | PDH/PDL swept in NY | 283 | 161 | 56.890 | 0.012 | -0.187 | 0.202 | 1.514 | 1.559 | 0.971 | 34.161 | 2.723 | 0.522 | 25.466 | 36.000 | 31.000 | 42.000 |
| 24-48 | C3 | PDH/PDL swept in Asia | 382 | 241 | 63.089 | 0.042 | -0.121 | 0.310 | 1.697 | 1.471 | 1.153 | 41.079 | 2.638 | 0.585 | 32.780 | 36.000 | 30.000 | 42.000 |
| 48-72 | C1 | London level swept in NY | 1277 | 914 | 71.574 | -0.006 | -0.119 | 0.112 | 2.069 | 2.263 | 0.914 | 32.604 | 2.292 | 0.809 | 42.451 | 63.000 | 57.000 | 68.000 |
| 48-72 | C2 | PDH/PDL swept in NY | 422 | 292 | 69.194 | -0.008 | -0.127 | 0.120 | 1.802 | 2.375 | 0.759 | 30.137 | 2.495 | 0.724 | 39.726 | 62.000 | 55.000 | 67.000 |
| 48-72 | C3 | PDH/PDL swept in Asia | 616 | 424 | 68.831 | 0.008 | -0.106 | 0.138 | 2.208 | 2.179 | 1.013 | 35.849 | 2.667 | 0.765 | 40.094 | 62.000 | 56.750 | 67.000 |
| 72+ | C1 | London level swept in NY | 4604 | 3502 | 76.064 | 0.003 | -0.101 | 0.103 | 3.288 | 3.649 | 0.901 | 33.952 | 2.821 | 1.128 | 54.226 | 87.000 | 81.000 | 92.000 |
| 72+ | C2 | PDH/PDL swept in NY | 517 | 373 | 72.147 | -0.002 | -0.104 | 0.123 | 2.798 | 3.038 | 0.921 | 35.121 | 2.997 | 0.893 | 46.381 | 82.000 | 77.000 | 88.000 |
| 72+ | C3 | PDH/PDL swept in Asia | 1472 | 1060 | 72.011 | 0.027 | -0.089 | 0.117 | 2.789 | 2.523 | 1.106 | 39.057 | 2.854 | 0.915 | 46.792 | 87.000 | 80.000 | 92.000 |

### W3. Is the W2 ordering the same in all four assets?

_W2 pools the assets. A pooled difference that only two assets produce is not a finding, so the same window-matched comparison is repeated per asset in the largest stratum (72+). The scale-free columns (`er_median`, `mfe_over_mae`) are the ones to read._

| symbol | combo | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BTCUSDT | C1 | 1221 | 918 | 75.184 | 0.008 | -0.092 | 0.108 | 3.459 | 3.764 | 0.919 | 34.641 | 3.032 | 1.133 | 54.357 | 87.000 | 80.000 | 92.000 |
| BTCUSDT | C2 | 158 | 113 | 71.519 | 0.022 | -0.063 | 0.115 | 3.297 | 3.608 | 0.914 | 36.283 | 3.185 | 1.070 | 51.327 | 82.000 | 77.000 | 88.000 |
| BTCUSDT | C3 | 341 | 237 | 69.501 | 0.034 | -0.094 | 0.131 | 2.768 | 2.489 | 1.112 | 39.241 | 2.970 | 0.894 | 45.992 | 87.000 | 80.000 | 91.000 |
| ETHUSDT | C1 | 1137 | 839 | 73.791 | 0.000 | -0.103 | 0.092 | 3.099 | 3.699 | 0.838 | 31.824 | 2.951 | 1.007 | 50.656 | 87.000 | 80.000 | 92.000 |
| ETHUSDT | C2 | 135 | 92 | 68.148 | -0.027 | -0.139 | 0.128 | 2.317 | 2.383 | 0.972 | 35.870 | 3.105 | 0.808 | 38.043 | 81.000 | 77.000 | 87.000 |
| ETHUSDT | C3 | 326 | 226 | 69.325 | 0.031 | -0.064 | 0.106 | 2.579 | 2.167 | 1.190 | 38.053 | 2.992 | 0.787 | 42.478 | 87.000 | 79.000 | 92.000 |
| SOLUSDT | C1 | 1155 | 913 | 79.048 | 0.002 | -0.106 | 0.105 | 3.248 | 3.551 | 0.915 | 35.049 | 2.653 | 1.180 | 56.298 | 88.000 | 81.000 | 93.000 |
| SOLUSDT | C2 | 113 | 93 | 82.301 | -0.007 | -0.104 | 0.136 | 3.612 | 3.231 | 1.118 | 34.409 | 2.682 | 1.098 | 53.763 | 83.000 | 76.000 | 88.000 |
| SOLUSDT | C3 | 398 | 299 | 75.126 | 0.006 | -0.078 | 0.118 | 2.865 | 2.464 | 1.163 | 39.799 | 2.728 | 0.916 | 46.488 | 88.000 | 81.000 | 92.000 |
| BNBUSDT | C1 | 1091 | 832 | 76.260 | -0.001 | -0.101 | 0.101 | 3.339 | 3.692 | 0.904 | 34.135 | 2.645 | 1.196 | 55.409 | 88.000 | 81.000 | 93.000 |
| BNBUSDT | C2 | 111 | 75 | 67.568 | -0.015 | -0.113 | 0.108 | 2.254 | 2.973 | 0.758 | 33.333 | 2.979 | 0.777 | 40.000 | 82.000 | 77.000 | 88.000 |
| BNBUSDT | C3 | 407 | 298 | 73.219 | 0.024 | -0.107 | 0.118 | 3.096 | 2.999 | 1.032 | 38.926 | 2.835 | 1.019 | 51.007 | 87.000 | 81.000 | 92.000 |

_MFE/MAE > 1 in the 72+ stratum: C3 in 4/4 assets, C1 in 0/4, C2 in 1/4. Median signed ER > 0: C3 in 4/4, C1 in 3/4, C2 in 1/4. Median R >= 1: C3 in 1/4, C1 in 4/4, C2 in 2/4._

### W4. The same axis on the PURE day-level subset

_D5 shows ~3 in 4 PDH/PDL take-outs sit within 0.05 ATR of a still-alive session level -- i.e. the day level is mostly a session level wearing a different hat. W2's C2/C3 rows therefore partly restate C1-like events. This table repeats the window-regime cut on the ~25% of day-level take-outs that stand alone, which is the honest read of what the new level class adds._

| combo | stratum | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C2-pure | 48-72 | 63 | 40 | 63.492 | -0.034 | -0.124 | 0.075 | 1.618 | 2.703 | 0.599 | 27.500 | 2.781 | 0.741 | 32.500 | 60.000 | 53.000 | 66.000 |
| C2-pure | 72+ | 60 | 43 | 71.667 | 0.035 | -0.124 | 0.156 | 3.553 | 3.126 | 1.136 | 39.535 | 2.569 | 1.197 | 58.140 | 83.500 | 77.000 | 88.000 |
| C2-pure | ALL | 154 | 103 | 66.883 | 0.019 | -0.120 | 0.158 | 2.196 | 2.383 | 0.921 | 35.922 | 2.559 | 0.875 | 44.660 | 66.000 | 50.000 | 79.000 |
| C3-pure | 12-24 | 40 | 15 | 37.500 | 0.068 | -0.186 | 0.469 | 1.442 | 2.060 | 0.700 | 26.667 | 2.599 | 0.698 | 20.000 | 18.000 | 14.750 | 20.250 |
| C3-pure | 24-48 | 83 | 51 | 61.446 | -0.052 | -0.246 | 0.322 | 1.970 | 1.836 | 1.073 | 37.255 | 2.672 | 0.547 | 39.216 | 34.000 | 30.000 | 41.000 |
| C3-pure | 48-72 | 146 | 100 | 68.493 | 0.073 | -0.070 | 0.188 | 2.569 | 2.096 | 1.226 | 42.000 | 2.527 | 0.933 | 48.000 | 62.000 | 56.000 | 68.000 |
| C3-pure | 72+ | 735 | 534 | 72.653 | 0.018 | -0.087 | 0.114 | 2.581 | 2.534 | 1.018 | 36.891 | 2.761 | 0.914 | 46.442 | 90.000 | 84.000 | 94.000 |
| C3-pure | ALL | 1004 | 700 | 69.721 | 0.027 | -0.093 | 0.132 | 2.526 | 2.329 | 1.085 | 37.429 | 2.724 | 0.896 | 45.571 | 86.000 | 70.000 | 93.000 |

### W5. Separation summary — does any (level class x window regime) cell leave the break-even aggregate?

_The pass's headline number. For each combo: the aggregate, then the best and worst window regime it contains, and the spread between them. `vs_c1_agg` is the distance from the number this pass argues with -- C1's aggregate median R of 1.00, the coin flip v4 measured from the confirmation close. A cell is only interesting if it moves that number by an amount a trader would notice, in a stratum with enough events to be worth trading, and in the scale-free columns as well as in R._

| combo | what | n | agg_R | agg_er | agg_mfe_over_mae | agg_R_ge1_pct | best_regime | best_regime_n | best_R | best_R_ge1_pct | worst_regime | worst_R | regime_R_spread | best_er_regime | best_er | regime_er_spread | vs_c1_agg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | London level swept in NY | 4791 | 1.005 | 0.001 | 0.900 | 50.031 | 72+ | 3502 | 1.128 | 54.226 | 12-24 | 0.535 | 0.593 | 12-24 | 0.082 | 0.088 | 0.123 |
| C2 | PDH/PDL swept in NY | 867 | 0.735 | -0.003 | 0.889 | 39.100 | 72+ | 373 | 0.893 | 46.381 | 24-48 | 0.522 | 0.371 | 24-48 | 0.012 | 0.102 | -0.112 |
| C3 | PDH/PDL swept in Asia | 1791 | 0.804 | 0.024 | 1.113 | 42.323 | 72+ | 1060 | 0.915 | 46.792 | 12-24 | 0.457 | 0.458 | 12-24 | 0.046 | 0.039 | -0.090 |

## S. Question (a), SECONDARY/DERIVED — the clock sub-window

_**The v4 result is the null hypothesis here**: "no best hour, only a best remaining window". Every table in this section is a test against that null, not an independent question. A clock pattern that survives inside a fixed window regime (section W) is about the hour; one that vanishes is reported as **the clock, not the hour**._

### S1. Hourly buckets (take-out bar's UTC hour), per combo

| combo | hour | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | 13:00 | 3034 | 2347 | 77.36 | 0.00 | -0.10 | 0.10 | 3.68 | 3.90 | 0.94 | 34.64 | 2.94 | 1.17 | 55.56 | 91.00 | 88.00 | 94.00 |
| C1 | 14:00 | 1570 | 1155 | 73.57 | 0.00 | -0.10 | 0.11 | 2.84 | 3.19 | 0.89 | 32.55 | 2.58 | 1.05 | 51.52 | 78.00 | 75.00 | 81.00 |
| C1 | 15:00 | 820 | 596 | 72.68 | -0.01 | -0.12 | 0.10 | 2.16 | 2.47 | 0.87 | 30.87 | 2.28 | 0.81 | 42.11 | 67.00 | 64.00 | 69.00 |
| C1 | 16:00 | 457 | 318 | 69.58 | 0.01 | -0.13 | 0.14 | 1.89 | 1.85 | 1.02 | 35.85 | 2.30 | 0.81 | 43.08 | 54.00 | 51.00 | 57.00 |
| C1 | 17:00 | 322 | 181 | 56.21 | -0.01 | -0.14 | 0.14 | 1.91 | 1.52 | 1.25 | 40.33 | 2.53 | 0.69 | 37.02 | 42.00 | 39.00 | 45.00 |
| C1 | 18:00 | 251 | 126 | 50.20 | -0.01 | -0.26 | 0.17 | 1.47 | 1.57 | 0.94 | 29.37 | 2.42 | 0.56 | 26.19 | 30.00 | 27.00 | 33.00 |
| C1 | 19:00 | 217 | 68 | 31.34 | 0.08 | -0.19 | 0.38 | 1.44 | 1.02 | 1.41 | 41.18 | 2.19 | 0.53 | 14.71 | 19.00 | 16.00 | 21.00 |
| C2 | 13:00 | 220 | 151 | 68.64 | -0.00 | -0.11 | 0.09 | 3.24 | 3.50 | 0.93 | 33.11 | 3.15 | 0.89 | 45.03 | 88.00 | 86.00 | 92.00 |
| C2 | 14:00 | 297 | 222 | 74.75 | -0.00 | -0.10 | 0.14 | 2.53 | 2.95 | 0.86 | 36.49 | 2.79 | 0.93 | 47.30 | 77.00 | 75.00 | 80.00 |
| C2 | 15:00 | 247 | 191 | 77.33 | -0.00 | -0.12 | 0.12 | 2.04 | 2.64 | 0.78 | 32.98 | 2.65 | 0.76 | 41.88 | 66.00 | 63.00 | 69.00 |
| C2 | 16:00 | 175 | 101 | 57.71 | -0.04 | -0.13 | 0.12 | 1.53 | 2.07 | 0.74 | 24.75 | 2.16 | 0.67 | 35.64 | 54.00 | 51.00 | 58.00 |
| C2 | 17:00 | 152 | 93 | 61.18 | -0.02 | -0.17 | 0.15 | 1.52 | 1.64 | 0.93 | 30.11 | 2.56 | 0.53 | 25.81 | 42.00 | 38.75 | 44.00 |
| C2 | 18:00 | 131 | 68 | 51.91 | 0.03 | -0.29 | 0.24 | 1.47 | 1.25 | 1.18 | 39.71 | 2.91 | 0.50 | 25.00 | 30.00 | 27.00 | 34.00 |
| C2 | 19:00 | 105 | 41 | 39.05 | -0.09 | -0.29 | 0.40 | 1.05 | 1.44 | 0.73 | 39.02 | 2.78 | 0.56 | 21.95 | 18.00 | 15.00 | 21.00 |
| C3 | 00:00 | 950 | 683 | 71.89 | 0.02 | -0.09 | 0.11 | 2.84 | 2.76 | 1.03 | 37.92 | 2.94 | 0.90 | 46.41 | 91.00 | 88.00 | 94.00 |
| C3 | 01:00 | 522 | 377 | 72.22 | 0.04 | -0.09 | 0.14 | 2.76 | 2.09 | 1.32 | 41.11 | 2.69 | 0.95 | 47.48 | 78.00 | 75.00 | 81.00 |
| C3 | 02:00 | 374 | 270 | 72.19 | -0.00 | -0.11 | 0.14 | 2.10 | 2.33 | 0.90 | 35.56 | 2.61 | 0.77 | 40.74 | 66.00 | 63.00 | 68.75 |
| C3 | 03:00 | 242 | 154 | 63.64 | 0.02 | -0.10 | 0.13 | 2.37 | 1.81 | 1.31 | 36.36 | 2.86 | 0.76 | 38.96 | 55.00 | 52.00 | 57.75 |
| C3 | 04:00 | 198 | 132 | 66.67 | 0.04 | -0.12 | 0.21 | 1.84 | 1.68 | 1.10 | 40.91 | 2.54 | 0.62 | 34.09 | 42.00 | 39.00 | 44.75 |
| C3 | 05:00 | 184 | 109 | 59.24 | 0.05 | -0.12 | 0.39 | 1.40 | 1.27 | 1.11 | 41.28 | 2.86 | 0.51 | 31.19 | 30.00 | 27.00 | 32.00 |
| C3 | 06:00 | 175 | 66 | 37.71 | 0.05 | -0.21 | 0.40 | 1.28 | 1.02 | 1.26 | 37.88 | 2.66 | 0.46 | 19.70 | 17.00 | 14.00 | 21.00 |

_`bars_left_*` sits deliberately in the same table as the outcome columns: within a block the hour and the window length are the same variable seen twice, and any hourly pattern has to be read against that column before it is read as a fact about the hour. Hourly counts fall below ~50 confirmed events per bucket for C2, so the 2h view (S2) is primary there._

### S2. 2h roll-up, per combo

| combo | window | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | 13-15 | 4604 | 3502 | 76.06 | 0.00 | -0.10 | 0.10 | 3.29 | 3.65 | 0.90 | 33.95 | 2.82 | 1.13 | 54.23 | 87.00 | 81.00 | 92.00 |
| C1 | 15-17 | 1277 | 914 | 71.57 | -0.01 | -0.12 | 0.11 | 2.07 | 2.26 | 0.91 | 32.60 | 2.29 | 0.81 | 42.45 | 63.00 | 57.00 | 68.00 |
| C1 | 17-19 | 573 | 307 | 53.58 | -0.01 | -0.19 | 0.15 | 1.65 | 1.56 | 1.05 | 35.83 | 2.46 | 0.63 | 32.57 | 37.00 | 31.00 | 42.00 |
| C1 | 19-21 | 217 | 68 | 31.34 | 0.08 | -0.19 | 0.38 | 1.44 | 1.02 | 1.41 | 41.18 | 2.19 | 0.53 | 14.71 | 19.00 | 16.00 | 21.00 |
| C2 | 13-15 | 517 | 373 | 72.15 | -0.00 | -0.10 | 0.12 | 2.80 | 3.04 | 0.92 | 35.12 | 3.00 | 0.89 | 46.38 | 82.00 | 77.00 | 88.00 |
| C2 | 15-17 | 422 | 292 | 69.19 | -0.01 | -0.13 | 0.12 | 1.80 | 2.38 | 0.76 | 30.14 | 2.49 | 0.72 | 39.73 | 62.00 | 55.00 | 67.00 |
| C2 | 17-19 | 283 | 161 | 56.89 | 0.01 | -0.19 | 0.20 | 1.51 | 1.56 | 0.97 | 34.16 | 2.72 | 0.52 | 25.47 | 36.00 | 31.00 | 42.00 |
| C2 | 19-21 | 105 | 41 | 39.05 | -0.09 | -0.29 | 0.40 | 1.05 | 1.44 | 0.73 | 39.02 | 2.78 | 0.56 | 21.95 | 18.00 | 15.00 | 21.00 |
| C3 | 00-02 | 1472 | 1060 | 72.01 | 0.03 | -0.09 | 0.12 | 2.79 | 2.52 | 1.11 | 39.06 | 2.85 | 0.91 | 46.79 | 87.00 | 80.00 | 92.00 |
| C3 | 02-04 | 616 | 424 | 68.83 | 0.01 | -0.11 | 0.14 | 2.21 | 2.18 | 1.01 | 35.85 | 2.67 | 0.77 | 40.09 | 62.00 | 56.75 | 67.00 |
| C3 | 04-06 | 382 | 241 | 63.09 | 0.04 | -0.12 | 0.31 | 1.70 | 1.47 | 1.15 | 41.08 | 2.64 | 0.58 | 32.78 | 36.00 | 30.00 | 42.00 |
| C3 | 06-08 | 175 | 66 | 37.71 | 0.05 | -0.21 | 0.40 | 1.28 | 1.02 | 1.26 | 37.88 | 2.66 | 0.46 | 19.70 | 17.00 | 14.00 | 21.00 |
### S3. The stratified companion — 2h sub-window WITHIN window-length strata

_The design's central hazard: later take-outs mechanically have shorter windows, so a naive sub-window table mostly rediscovers the clock. Here the comparison is made inside fixed window-length strata (bars of block remaining at the take-out). A sub-window effect that survives across strata is about the hour; one that vanishes is **the clock, not the hour**._

_Buckets are **hourly** here, not 2h: at 2h granularity each stratum contains exactly one window and there is nothing left to compare. That collapse is itself the result — see S3b — and the hourly view is the finest cut at which any within-stratum comparison exists at all._

| combo | stratum | hour | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | 12-24 | 19:00 | 217 | 68 | 31.34 | 0.08 | -0.19 | 0.38 | 1.44 | 1.02 | 1.41 | 41.18 | 2.19 | 0.53 | 14.71 | 19.00 | 16.00 | 21.00 |
| C1 | 24-48 | 17:00 | 322 | 181 | 56.21 | -0.01 | -0.14 | 0.14 | 1.91 | 1.52 | 1.25 | 40.33 | 2.53 | 0.69 | 37.02 | 42.00 | 39.00 | 45.00 |
| C1 | 24-48 | 18:00 | 251 | 126 | 50.20 | -0.01 | -0.26 | 0.17 | 1.47 | 1.57 | 0.94 | 29.37 | 2.42 | 0.56 | 26.19 | 30.00 | 27.00 | 33.00 |
| C1 | 48-72 | 15:00 | 820 | 596 | 72.68 | -0.01 | -0.12 | 0.10 | 2.16 | 2.47 | 0.87 | 30.87 | 2.28 | 0.81 | 42.11 | 67.00 | 64.00 | 69.00 |
| C1 | 48-72 | 16:00 | 457 | 318 | 69.58 | 0.01 | -0.13 | 0.14 | 1.89 | 1.85 | 1.02 | 35.85 | 2.30 | 0.81 | 43.08 | 54.00 | 51.00 | 57.00 |
| C1 | 72+ | 13:00 | 3034 | 2347 | 77.36 | 0.00 | -0.10 | 0.10 | 3.68 | 3.90 | 0.94 | 34.64 | 2.94 | 1.17 | 55.56 | 91.00 | 88.00 | 94.00 |
| C1 | 72+ | 14:00 | 1570 | 1155 | 73.57 | 0.00 | -0.10 | 0.11 | 2.84 | 3.19 | 0.89 | 32.55 | 2.58 | 1.05 | 51.52 | 78.00 | 75.00 | 81.00 |
| C2 | 12-24 | 19:00 | 105 | 41 | 39.05 | -0.09 | -0.29 | 0.40 | 1.05 | 1.44 | 0.73 | 39.02 | 2.78 | 0.56 | 21.95 | 18.00 | 15.00 | 21.00 |
| C2 | 24-48 | 17:00 | 152 | 93 | 61.18 | -0.02 | -0.17 | 0.15 | 1.52 | 1.64 | 0.93 | 30.11 | 2.56 | 0.53 | 25.81 | 42.00 | 38.75 | 44.00 |
| C2 | 24-48 | 18:00 | 131 | 68 | 51.91 | 0.03 | -0.29 | 0.24 | 1.47 | 1.25 | 1.18 | 39.71 | 2.91 | 0.50 | 25.00 | 30.00 | 27.00 | 34.00 |
| C2 | 48-72 | 15:00 | 247 | 191 | 77.33 | -0.00 | -0.12 | 0.12 | 2.04 | 2.64 | 0.78 | 32.98 | 2.65 | 0.76 | 41.88 | 66.00 | 63.00 | 69.00 |
| C2 | 48-72 | 16:00 | 175 | 101 | 57.71 | -0.04 | -0.13 | 0.12 | 1.53 | 2.07 | 0.74 | 24.75 | 2.16 | 0.67 | 35.64 | 54.00 | 51.00 | 58.00 |
| C2 | 72+ | 13:00 | 220 | 151 | 68.64 | -0.00 | -0.11 | 0.09 | 3.24 | 3.50 | 0.93 | 33.11 | 3.15 | 0.89 | 45.03 | 88.00 | 86.00 | 92.00 |
| C2 | 72+ | 14:00 | 297 | 222 | 74.75 | -0.00 | -0.10 | 0.14 | 2.53 | 2.95 | 0.86 | 36.49 | 2.79 | 0.93 | 47.30 | 77.00 | 75.00 | 80.00 |
| C3 | 12-24 | 06:00 | 175 | 66 | 37.71 | 0.05 | -0.21 | 0.40 | 1.28 | 1.02 | 1.26 | 37.88 | 2.66 | 0.46 | 19.70 | 17.00 | 14.00 | 21.00 |
| C3 | 24-48 | 04:00 | 198 | 132 | 66.67 | 0.04 | -0.12 | 0.21 | 1.84 | 1.68 | 1.10 | 40.91 | 2.54 | 0.62 | 34.09 | 42.00 | 39.00 | 44.75 |
| C3 | 24-48 | 05:00 | 184 | 109 | 59.24 | 0.05 | -0.12 | 0.39 | 1.40 | 1.27 | 1.11 | 41.28 | 2.86 | 0.51 | 31.19 | 30.00 | 27.00 | 32.00 |
| C3 | 48-72 | 02:00 | 374 | 270 | 72.19 | -0.00 | -0.11 | 0.14 | 2.10 | 2.33 | 0.90 | 35.56 | 2.61 | 0.77 | 40.74 | 66.00 | 63.00 | 68.75 |
| C3 | 48-72 | 03:00 | 242 | 154 | 63.64 | 0.02 | -0.10 | 0.13 | 2.37 | 1.81 | 1.31 | 36.36 | 2.86 | 0.76 | 38.96 | 55.00 | 52.00 | 57.75 |
| C3 | 72+ | 00:00 | 950 | 683 | 71.89 | 0.02 | -0.09 | 0.11 | 2.84 | 2.76 | 1.03 | 37.92 | 2.94 | 0.90 | 46.41 | 91.00 | 88.00 | 94.00 |
| C3 | 72+ | 01:00 | 522 | 377 | 72.22 | 0.04 | -0.09 | 0.14 | 2.76 | 2.09 | 1.32 | 41.11 | 2.69 | 0.95 | 47.48 | 78.00 | 75.00 | 81.00 |

_Buckets with fewer than 25 take-outs are omitted rather than shown as noise. Empty (stratum x hour) cells are not missing data — they are **impossible**: a take-out at 19:00 in the NY block cannot have 72+ bars left, because the block ends at 21:00. That impossibility is the confound, stated as a structural fact rather than a caveat._

### S3b. How much of the hour IS the window length?

| combo | n | rho_hour_vs_barsleft | hours_per_stratum | two_h_windows_per_stratum | strata_per_2h_window |
|---|---|---|---|---|---|
| C1 | 6671 | -0.944 | 1.750 | 1.000 | 1.000 |
| C2 | 1327 | -0.986 | 1.750 | 1.000 | 1.000 |
| C3 | 2645 | -0.971 | 1.750 | 1.000 | 1.000 |

_Inside a fixed block the take-out hour and the bars-of-block-remaining are the **same variable measured twice**: the rank correlation is about -0.99, and every 2h window sits in exactly one window-length stratum. There is therefore no version of the sub-window question that can be answered while holding window length fixed at 2h resolution, and only a two-hour-wide comparison survives at 1h resolution. This is not a caveat attached to the S1/S2 tables — it is what those tables are._

### S4. Separation summary — does any sub-window cut leave the aggregate?

_For each combo: the aggregate, then the best and worst 2h bucket by median R and by median signed ER, then the same spread measured **within** the single stratum that has the most events — the like-for-like version. The last column is the report's answer in one number: how much of the raw spread survives when window length is held fixed._

| combo | what | n | agg_R | agg_er | best_window | best_R | worst_window | worst_R | raw_R_spread | best_er_window | raw_er_spread | strat_used | n_strat | strat_R_spread | strat_er_spread |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | London level swept in NY | 4791 | 1.005 | 0.001 | 13-15 | 1.128 | 19-21 | 0.535 | 0.593 | 19-21 | 0.088 | 72+ | 4604 | 0.125 | 0.002 |
| C2 | PDH/PDL swept in NY | 867 | 0.735 | -0.003 | 13-15 | 0.893 | 17-19 | 0.522 | 0.371 | 17-19 | 0.102 | 72+ | 517 | 0.043 | 0.001 |
| C3 | PDH/PDL swept in Asia | 1791 | 0.804 | 0.024 | 00-02 | 0.915 | 06-08 | 0.457 | 0.458 | 06-08 | 0.039 | 72+ | 1472 | 0.047 | 0.024 |

## G. Question (b) — the iFVG gap size as a predictor

_Predictor, primary: the inverting FVG's height divided by ATR(14, 5m) **at the gap's own third bar** — causal and cross-asset comparable. Secondary: the same height divided by the swept structure's own range (the level session's high-low, or the prior day's range for PDH/PDL) — known and frozen before the sweep. The sweep block's range was rejected as a denominator: it is not known at confirmation time._

### G1. The predictor's own distribution, per combo

| combo | predictor | n | p10 | p25 | median | p75 | p90 | mean |
|---|---|---|---|---|---|---|---|---|
| C1 | gap / ATR at formation | 4791 | 0.0538 | 0.1316 | 0.3122 | 0.5991 | 0.9897 | 0.4379 |
| C1 | gap / swept structure range | 4791 | 0.0101 | 0.0246 | 0.0596 | 0.1235 | 0.2252 | 0.0988 |
| C2 | gap / ATR at formation | 867 | 0.0578 | 0.1227 | 0.2955 | 0.6042 | 1.0762 | 0.4605 |
| C2 | gap / swept structure range | 867 | 0.0044 | 0.0108 | 0.0263 | 0.0577 | 0.1082 | 0.0494 |
| C3 | gap / ATR at formation | 1791 | 0.0602 | 0.1465 | 0.3458 | 0.6747 | 1.0867 | 0.4805 |
| C3 | gap / swept structure range | 1791 | 0.0040 | 0.0106 | 0.0258 | 0.0519 | 0.0969 | 0.0408 |

_A typical inverting 5m FVG is a fraction of one ATR tall and a low single-digit percentage of the structure it swept. Quintile edges below should be read in those terms._

### G2. Quintiles of the PRIMARY predictor (gap height / ATR at formation)

| combo | quintile | edge_lo | edge_hi | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Q1 | 0.001 | 0.104 | 959 | 959 | 100.000 | -0.005 | -0.118 | 0.104 | 2.586 | 3.054 | 0.847 | 32.430 | 2.245 | 1.049 | 52.138 | 83.000 | 70.000 | 90.000 |
| C1 | Q2 | 0.104 | 0.231 | 958 | 958 | 100.000 | 0.004 | -0.108 | 0.117 | 2.730 | 2.947 | 0.927 | 34.551 | 2.325 | 1.098 | 53.236 | 83.000 | 68.250 | 90.000 |
| C1 | Q3 | 0.231 | 0.406 | 958 | 958 | 100.000 | 0.015 | -0.086 | 0.120 | 2.896 | 2.816 | 1.028 | 36.848 | 2.491 | 1.137 | 54.071 | 83.000 | 71.000 | 90.750 |
| C1 | Q4 | 0.406 | 0.688 | 958 | 958 | 100.000 | -0.006 | -0.117 | 0.100 | 2.691 | 3.428 | 0.785 | 31.628 | 2.829 | 0.938 | 47.286 | 84.000 | 72.000 | 91.000 |
| C1 | Q5 | 0.688 | 4.248 | 958 | 958 | 100.000 | -0.005 | -0.114 | 0.102 | 3.345 | 3.257 | 1.027 | 34.134 | 3.685 | 0.797 | 43.424 | 84.000 | 70.000 | 91.000 |
| C2 | Q1 | 0.001 | 0.096 | 174 | 174 | 100.000 | 0.008 | -0.168 | 0.131 | 1.923 | 2.223 | 0.865 | 30.460 | 2.157 | 0.828 | 44.828 | 68.000 | 49.000 | 79.000 |
| C2 | Q2 | 0.096 | 0.215 | 173 | 173 | 100.000 | -0.020 | -0.127 | 0.121 | 2.098 | 2.430 | 0.863 | 32.370 | 2.236 | 0.847 | 42.197 | 68.000 | 49.000 | 79.000 |
| C2 | Q3 | 0.218 | 0.389 | 173 | 173 | 100.000 | 0.044 | -0.075 | 0.154 | 2.181 | 1.898 | 1.149 | 38.150 | 2.364 | 0.849 | 42.775 | 67.000 | 49.000 | 79.000 |
| C2 | Q4 | 0.389 | 0.739 | 173 | 173 | 100.000 | -0.023 | -0.130 | 0.114 | 1.680 | 2.486 | 0.676 | 32.370 | 3.048 | 0.613 | 36.416 | 71.000 | 56.000 | 80.000 |
| C2 | Q5 | 0.745 | 3.914 | 174 | 174 | 100.000 | -0.019 | -0.171 | 0.148 | 2.183 | 2.711 | 0.805 | 33.908 | 4.091 | 0.526 | 29.310 | 68.000 | 44.000 | 83.000 |
| C3 | Q1 | 0.000 | 0.117 | 359 | 359 | 100.000 | 0.020 | -0.090 | 0.129 | 2.404 | 2.223 | 1.082 | 39.276 | 2.391 | 0.973 | 48.468 | 78.000 | 64.000 | 89.000 |
| C3 | Q2 | 0.118 | 0.249 | 358 | 358 | 100.000 | 0.025 | -0.085 | 0.135 | 2.409 | 1.980 | 1.217 | 39.385 | 2.436 | 0.886 | 44.413 | 77.000 | 61.250 | 89.000 |
| C3 | Q3 | 0.250 | 0.446 | 358 | 358 | 100.000 | 0.031 | -0.118 | 0.162 | 2.453 | 2.094 | 1.172 | 37.989 | 2.628 | 0.865 | 44.693 | 73.000 | 50.000 | 87.000 |
| C3 | Q4 | 0.447 | 0.768 | 358 | 358 | 100.000 | 0.031 | -0.097 | 0.144 | 2.520 | 2.327 | 1.083 | 39.944 | 2.839 | 0.801 | 42.737 | 80.000 | 60.250 | 90.000 |
| C3 | Q5 | 0.771 | 3.452 | 358 | 358 | 100.000 | 0.008 | -0.105 | 0.135 | 2.456 | 2.514 | 0.977 | 36.034 | 3.751 | 0.657 | 31.285 | 76.000 | 57.000 | 90.000 |

### G2b. Quintiles of the SECONDARY predictor (gap height / swept structure range)

| combo | quintile | edge_lo | edge_hi | n_takeouts | n | ifvg_rate | er_median | er_p25 | er_p75 | mfe_atr_median | mae_atr_median | mfe_over_mae | clean_trend_pct | stop_atr_median | R_median | R_ge1_pct | bars_left_median | bars_left_p25 | bars_left_p75 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Q1 | 0.000 | 0.019 | 959 | 959 | 100.000 | -0.003 | -0.114 | 0.104 | 2.571 | 2.879 | 0.893 | 32.847 | 2.103 | 1.087 | 53.389 | 83.000 | 68.000 | 90.000 |
| C1 | Q2 | 0.019 | 0.043 | 958 | 958 | 100.000 | 0.012 | -0.104 | 0.122 | 2.693 | 2.814 | 0.957 | 35.595 | 2.277 | 1.101 | 53.340 | 83.000 | 69.000 | 90.000 |
| C1 | Q3 | 0.043 | 0.079 | 958 | 958 | 100.000 | 0.004 | -0.099 | 0.104 | 2.755 | 3.129 | 0.881 | 34.238 | 2.453 | 1.083 | 52.818 | 84.000 | 71.000 | 91.000 |
| C1 | Q4 | 0.079 | 0.146 | 958 | 958 | 100.000 | -0.007 | -0.122 | 0.103 | 2.840 | 3.399 | 0.836 | 31.733 | 2.951 | 0.957 | 48.434 | 83.500 | 71.000 | 91.000 |
| C1 | Q5 | 0.146 | 4.175 | 958 | 958 | 100.000 | 0.001 | -0.104 | 0.106 | 3.421 | 3.324 | 1.029 | 35.177 | 3.976 | 0.774 | 42.171 | 83.000 | 72.000 | 90.000 |
| C2 | Q1 | 0.000 | 0.008 | 174 | 174 | 100.000 | 0.004 | -0.160 | 0.124 | 1.923 | 2.085 | 0.922 | 31.034 | 2.064 | 0.877 | 46.552 | 66.000 | 46.000 | 78.750 |
| C2 | Q2 | 0.008 | 0.018 | 173 | 173 | 100.000 | 0.019 | -0.109 | 0.152 | 2.198 | 2.193 | 1.002 | 38.728 | 2.203 | 0.908 | 46.243 | 68.000 | 49.000 | 79.000 |
| C2 | Q3 | 0.018 | 0.036 | 173 | 173 | 100.000 | -0.012 | -0.105 | 0.130 | 1.888 | 2.239 | 0.843 | 30.058 | 2.453 | 0.807 | 38.150 | 68.000 | 51.000 | 80.000 |
| C2 | Q4 | 0.036 | 0.068 | 173 | 173 | 100.000 | -0.007 | -0.132 | 0.116 | 1.989 | 2.322 | 0.857 | 32.948 | 2.913 | 0.621 | 36.994 | 70.000 | 55.000 | 80.000 |
| C2 | Q5 | 0.068 | 1.227 | 174 | 174 | 100.000 | -0.014 | -0.152 | 0.158 | 2.228 | 2.711 | 0.822 | 34.483 | 4.345 | 0.497 | 27.586 | 69.000 | 48.500 | 81.000 |
| C3 | Q1 | 0.000 | 0.008 | 359 | 359 | 100.000 | 0.032 | -0.087 | 0.142 | 2.192 | 2.107 | 1.040 | 39.833 | 2.270 | 0.966 | 48.189 | 77.000 | 64.000 | 88.000 |
| C3 | Q2 | 0.008 | 0.018 | 358 | 358 | 100.000 | 0.036 | -0.082 | 0.142 | 2.433 | 1.944 | 1.252 | 38.268 | 2.405 | 0.921 | 46.648 | 75.000 | 53.000 | 88.000 |
| C3 | Q3 | 0.018 | 0.034 | 358 | 358 | 100.000 | 0.003 | -0.134 | 0.139 | 2.385 | 2.294 | 1.040 | 37.430 | 2.593 | 0.803 | 44.134 | 75.500 | 56.000 | 89.000 |
| C3 | Q4 | 0.034 | 0.062 | 358 | 358 | 100.000 | 0.036 | -0.088 | 0.141 | 2.753 | 2.125 | 1.295 | 41.620 | 2.983 | 0.865 | 44.413 | 78.000 | 60.000 | 89.000 |
| C3 | Q5 | 0.062 | 0.546 | 358 | 358 | 100.000 | 0.010 | -0.105 | 0.137 | 2.403 | 2.523 | 0.953 | 35.475 | 4.001 | 0.605 | 28.212 | 79.000 | 61.000 | 90.000 |

_`ifvg_rate` is 100% by construction in G2/G2b: the predictor only exists for events that confirmed, so these tables are cut on the confirmed sample and the confirmation rate is not a free column here._

### G3. Spearman rank correlations — per combo, per asset

| combo | symbol | n | rho_atr_er | rho_atr_mfe | rho_atr_R | rho_struct_er | rho_struct_mfe | rho_struct_R |
|---|---|---|---|---|---|---|---|---|
| C1 | BTCUSDT | 1209 | 0.039 | 0.122 | -0.050 | 0.043 | 0.145 | -0.055 |
| C1 | ETHUSDT | 1146 | -0.004 | 0.072 | -0.090 | 0.005 | 0.097 | -0.103 |
| C1 | SOLUSDT | 1261 | -0.057 | 0.025 | -0.129 | -0.048 | 0.052 | -0.131 |
| C1 | BNBUSDT | 1175 | -0.037 | 0.002 | -0.154 | -0.032 | 0.027 | -0.174 |
| C1 | ALL | 4791 | -0.014 | 0.055 | -0.104 | -0.007 | 0.082 | -0.115 |
| C2 | BTCUSDT | 257 | -0.013 | 0.057 | -0.134 | -0.010 | 0.040 | -0.174 |
| C2 | ETHUSDT | 217 | -0.059 | -0.030 | -0.183 | -0.049 | 0.008 | -0.174 |
| C2 | SOLUSDT | 213 | -0.012 | 0.058 | -0.089 | 0.022 | 0.043 | -0.132 |
| C2 | BNBUSDT | 180 | -0.013 | -0.054 | -0.253 | -0.031 | -0.040 | -0.268 |
| C2 | ALL | 867 | -0.026 | 0.013 | -0.163 | -0.017 | 0.018 | -0.184 |
| C3 | BTCUSDT | 382 | -0.011 | 0.049 | -0.091 | -0.048 | 0.063 | -0.096 |
| C3 | ETHUSDT | 382 | 0.008 | 0.000 | -0.115 | -0.030 | 0.008 | -0.144 |
| C3 | SOLUSDT | 494 | -0.012 | 0.012 | -0.146 | -0.005 | 0.051 | -0.135 |
| C3 | BNBUSDT | 533 | -0.006 | 0.026 | -0.151 | 0.003 | 0.027 | -0.189 |
| C3 | ALL | 1791 | -0.008 | 0.029 | -0.116 | -0.019 | 0.041 | -0.135 |

_The bar the design set for calling this 'a relationship worth carrying to a design pass' is a monotone quintile pattern **plus** a consistent-sign correlation across all four assets. Anything else is reported as flat._

### G4. Robustness — the same correlation WITHIN window-length strata

| combo | stratum | n | rho_atr_er | rho_atr_mfe | rho_atr_R | rho_struct_er | rho_struct_mfe | rho_struct_R |
|---|---|---|---|---|---|---|---|---|
| C1 | 12-24 | 68 | -0.263 | 0.051 | -0.182 | -0.355 | -0.079 | -0.297 |
| C1 | 24-48 | 307 | -0.042 | -0.014 | -0.197 | -0.030 | 0.009 | -0.204 |
| C1 | 48-72 | 914 | -0.026 | 0.027 | -0.128 | -0.026 | 0.046 | -0.130 |
| C1 | 72+ | 3502 | -0.004 | 0.062 | -0.096 | 0.007 | 0.090 | -0.112 |
| C2 | 12-24 | 41 | 0.055 | 0.086 | -0.221 | -0.003 | 0.075 | -0.209 |
| C2 | 24-48 | 161 | -0.035 | -0.058 | -0.231 | -0.004 | -0.040 | -0.259 |
| C2 | 48-72 | 292 | -0.013 | 0.005 | -0.196 | -0.008 | 0.034 | -0.203 |
| C2 | 72+ | 373 | -0.047 | 0.040 | -0.120 | -0.046 | 0.011 | -0.166 |
| C3 | 12-24 | 66 | 0.028 | 0.330 | 0.084 | -0.056 | 0.291 | 0.079 |
| C3 | 24-48 | 241 | 0.007 | 0.040 | -0.043 | 0.021 | 0.022 | -0.080 |
| C3 | 48-72 | 424 | 0.061 | 0.062 | -0.123 | 0.029 | 0.062 | -0.158 |
| C3 | 72+ | 1060 | -0.039 | 0.019 | -0.127 | -0.038 | 0.029 | -0.151 |
### G5. Is the predictor entangled with time remaining? (checked, not assumed)

| combo | n | rho_gapatr_barsleft | rho_gapatr_hour | rho_gapstruct_barsleft | rho_gapatr_stop | rho_gapatr_delay |
|---|---|---|---|---|---|---|
| C1 | 4791 | 0.036 | -0.029 | 0.026 | 0.370 | -0.084 |
| C2 | 867 | 0.037 | -0.034 | 0.044 | 0.419 | -0.138 |
| C3 | 1791 | -0.018 | 0.030 | 0.023 | 0.344 | -0.115 |

_The design says gap size and time-remaining 'should be unrelated, but that is checked, not assumed'. This is the check, and they are unrelated (|rho| <= 0.04 everywhere).

The last two columns are **not** part of the design's question and are the most important numbers in section G. `rho_gapatr_stop` is large and positive in every combo: a taller gap puts the inversion close further back from the sweep extreme, so the stop proxy — the denominator of R — grows with the predictor almost by construction. That, and not a change in the move itself, is what the monotone R decline across G2's quintiles is made of: MFE barely moves across those quintiles while the stop does._

