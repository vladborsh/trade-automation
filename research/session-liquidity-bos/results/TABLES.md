# Tables — session-liquidity BoS pass (corrected mechanic)

_Window: 2022-08-01 .. 2026-07-31, 4 symbols, 5m bars. **23,423 take-outs** — the unchanged v2/v4 event stream, reproduced byte-for-byte (`checks.py`) — of which **21,118 (90.2%)** are primary (>= 12 bars = 1h left in the sweep block). Session levels only (PDH/PDL out of scope). Only the CONFIRMATION layer differs from v4, and the iFVG arm here is v4's own machine, reproduced verbatim._

## B. The corrected mechanic — where its anchor lands, and whether it can fire at all

### B1. Anchor selection (DESIGN.md §1 pins 1, 2, 4)

| symbol | n_takeouts | unanchorable_n | unanchorable_pct | anchor_age_median_bars | anchor_age_p90_bars | anchor_age_max_bars | stale_anchor_pct | anchor_dist_atr_p10 | anchor_dist_atr_median | anchor_dist_atr_p90 | anchor_beyond_level_pct |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 23423 | 0 | 0.00 | 7.00 | 15.00 | 48 | 0.00 | 3.16 | 4.93 | 7.41 | 0.00 |
| BTCUSDT | 5834 | 0 | 0.00 | 7.00 | 15.00 | 42 | 0.00 | 3.25 | 5.10 | 7.60 | 0.00 |
| ETHUSDT | 5750 | 0 | 0.00 | 8.00 | 15.00 | 38 | 0.00 | 3.32 | 5.13 | 7.49 | 0.00 |
| SOLUSDT | 5966 | 0 | 0.00 | 7.00 | 15.00 | 40 | 0.00 | 3.04 | 4.68 | 7.14 | 0.00 |
| BNBUSDT | 5873 | 0 | 0.00 | 7.00 | 15.00 | 48 | 0.00 | 3.07 | 4.84 | 7.38 | 0.00 |

_`unanchorable` = DESIGN.md §1 pin 4: no k=3 pivot of the opposing side was confirmed anywhere before the take-out bar. The design asks for a loud flag above ~2%; the measured value is **0.000%** (0 events of 23,423), so the category exists in the schema and is empty in the data — see REPORT §2. `anchor_age` = bars from the anchor's own pivot bar to the take-out bar (never < k = 3, by construction). `anchor_dist_atr` = |take-out wick - anchor price| in ATR(14, 5m): the width the mechanic must travel before it can fire at all. `anchor_beyond_level_pct` = share where the anchor sits on the far side of the swept level._

### B2. Outcome state counts — corrected BoS (primary sample)

| state | n | share_pct | delay_median | bars_remaining_median | anchor_dist_atr_median | rev_atr_median |
|---|---|---|---|---|---|---|
| BROKE — a close through the pinned ray | 7135 | 33.79 | 18.00 | 73.00 | 4.22 | 7.76 |
| no break before the sweep block ended | 13983 | 66.21 |  | 55.00 | 5.34 | 2.97 |
| UNANCHORABLE — no qualifying pivot existed | 0 | 0.00 |  |  |  |  |

_Of the 13,983 anchorable-but-unbroken take-outs, **13.4%** would have broken had the block run 2h longer — a diagnostic probe, not part of any definition. `rev_atr` is the wick-anchored reversal over the whole block window, so it is comparable across states._

### B3. Immediate breaks and other edge shapes

* break on the take-out bar itself (`t0`): **39** events = 0.18% of the primary sample — a bar whose wick takes the level out and whose close is already back through the anchor.
* anchor age exactly k = 3 bars (the freshest an anchor can be): 10.3% of events.
* the anchor is on the same side of the swept level as the pre-sweep structure in **100.0%** of events, so a break is nearly always a close back INSIDE the swept range — this single geometric fact drives most of what follows.

## T. Core tables — corrected BoS, v4 format, primary sample

### T2. BoS confirmation rate — level_session x sweep_block

| level_session | Asia | London | NY | Late | ALL blocks |
|---|---|---|---|---|---|
| Asia | 25.04 | 33.59 | 32.29 | 19.28 | 31.86 |
| London | 28.40 | 23.20 | 43.86 | 11.83 | 40.73 |
| NY | 31.63 | 23.29 | 28.54 | 22.24 | 26.95 |
| ALL levels | 29.73 | 31.60 | 39.00 | 20.79 | 33.79 |

_Rows = whose liquidity was taken; columns = the clock block the take-out happened in. The iFVG counterpart is v4's `t2_ifvg_rate_levelsession_x_block.csv`; M1 below puts the two on the same take-outs._

### T2b. Confirmation rate — level_session x direction x asset

| level_session | direction | n | bos_rate_ALL | p1bos_rate_ALL | ifvg_rate_ALL | BTCUSDT | ETHUSDT | SOLUSDT | BNBUSDT |
|---|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 3692 | 32.29 | 81.64 | 65.90 | 34.05 | 30.71 | 32.57 | 31.81 |
| Asia | low_sweep | 3583 | 31.43 | 82.75 | 60.79 | 32.85 | 29.72 | 31.28 | 31.85 |
| London | high_sweep | 3894 | 40.91 | 87.52 | 70.67 | 43.55 | 40.50 | 39.21 | 40.39 |
| London | low_sweep | 3989 | 40.56 | 89.67 | 68.54 | 43.05 | 38.76 | 39.76 | 40.76 |
| NY | high_sweep | 3073 | 27.69 | 74.98 | 62.12 | 28.93 | 28.04 | 25.35 | 28.47 |
| NY | low_sweep | 2887 | 26.15 | 73.64 | 55.42 | 26.16 | 22.25 | 26.08 | 29.84 |

_The per-asset columns are the CORRECTED BoS rate._

### T2c. The full core cut — level_session x sweep_block x direction x asset

Full table in `results/t2c_core_full_cut.csv` — 96 cells with n >= 15 (of 96 possible). Confirmation rate across cells: min 3%, median 28%, max 46%; median R proxy across cells 0.06 / 0.34 / 1.21.

### T3. Take-out -> break delay, and the block-truncation share

| sweep_block | n | confirmed_pct | delay_median_bars | delay_p25 | delay_p75 | delay_p90 | delay_median_min | unconfirmed_n | truncated_share_pct |
|---|---|---|---|---|---|---|---|---|---|
| Asia | 3347 | 29.73 | 23.00 | 12.00 | 40.00 | 59.00 | 115.00 | 2352 | 8.84 |
| London | 4487 | 31.60 | 18.00 | 9.00 | 31.00 | 42.00 | 90.00 | 3069 | 22.84 |
| NY | 10764 | 39.00 | 18.00 | 9.00 | 35.00 | 54.00 | 90.00 | 6566 | 7.92 |
| Late | 2520 | 20.79 | 11.00 | 6.00 | 19.00 | 24.00 | 55.00 | 1996 | 22.44 |
| ALL | 21118 | 33.79 | 18.00 | 9.00 | 33.00 | 51.00 | 90.00 | 13983 | 13.42 |

_`truncated_share_pct` = of the anchorable take-outs that did NOT break, the share that would have broken had the block run 2h longer._

### T6. Magnitude from the BoS BREAK CLOSE — the tradable view

| level_session | direction | n | mfe_atr_median | mfe_atr_p75 | mfe_atr_p90 | mae_atr_median | mae_atr_p90 | mfe_over_mae | end_atr_median | share_end_positive | conf_bars_left_median |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | ALL | 7085 | 2.42 | 5.26 | 9.50 | 2.37 | 9.11 | 1.02 | -0.08 | 48.24 | 41.00 |
| ALL | high_sweep | 3616 | 2.66 | 5.61 | 10.12 | 2.44 | 9.26 | 1.09 | -0.14 | 47.03 | 41.00 |
| ALL | low_sweep | 3469 | 2.21 | 4.81 | 9.02 | 2.30 | 8.98 | 0.96 | 0.00 | 49.50 | 42.00 |
| Asia | ALL | 2294 | 2.19 | 4.68 | 8.18 | 2.11 | 7.34 | 1.04 | -0.05 | 48.53 | 32.00 |
| Asia | high_sweep | 1183 | 2.33 | 5.02 | 8.72 | 2.21 | 7.42 | 1.05 | -0.06 | 47.99 | 30.00 |
| Asia | low_sweep | 1111 | 1.99 | 4.13 | 7.67 | 2.04 | 7.20 | 0.98 | 0.00 | 49.11 | 33.00 |
| London | ALL | 3200 | 3.09 | 6.47 | 12.01 | 3.05 | 10.97 | 1.01 | -0.21 | 47.06 | 62.00 |
| London | high_sweep | 1588 | 3.43 | 6.92 | 12.79 | 3.02 | 10.97 | 1.14 | -0.29 | 45.83 | 62.00 |
| London | low_sweep | 1612 | 2.80 | 5.86 | 11.03 | 3.07 | 10.96 | 0.91 | -0.13 | 48.27 | 62.00 |
| NY | ALL | 1591 | 1.86 | 4.15 | 7.07 | 1.80 | 6.60 | 1.03 | 0.05 | 50.19 | 27.00 |
| NY | high_sweep | 845 | 2.01 | 4.48 | 7.28 | 1.94 | 6.87 | 1.03 | -0.10 | 47.94 | 28.00 |
| NY | low_sweep | 746 | 1.72 | 3.85 | 6.57 | 1.60 | 5.61 | 1.07 | 0.17 | 52.72 | 26.00 |

_MFE/MAE over what is LEFT of the block after the break bar's close, in ATR(14, 5m) at the take-out bar. `share_end_positive` = % still on the favourable side of the break close when the block ends._

### T7. Stop proxy and R proxy at the break bar

| level_session | sweep_block | n | stop_atr_median | stop_atr_p90 | R_median | R_p75 | share_R_ge_1 | share_R_ge_2 |
|---|---|---|---|---|---|---|---|---|
| ALL | ALL | 7085 | 5.77 | 9.78 | 0.41 | 0.90 | 22.37 | 7.44 |
| ALL | Asia | 983 | 6.10 | 9.35 | 0.38 | 0.75 | 14.95 | 3.36 |
| ALL | London | 1399 | 5.33 | 8.65 | 0.36 | 0.74 | 17.80 | 3.93 |
| ALL | NY | 4185 | 5.96 | 10.39 | 0.47 | 1.06 | 27.03 | 10.01 |
| ALL | Late | 518 | 5.03 | 8.34 | 0.25 | 0.54 | 11.20 | 3.86 |
| Asia | ALL | 2294 | 5.66 | 9.42 | 0.38 | 0.83 | 20.05 | 5.19 |
| Asia | Asia | 156 | 5.97 | 9.03 | 0.39 | 0.75 | 17.95 | 4.49 |
| Asia | London | 1202 | 5.24 | 8.52 | 0.37 | 0.77 | 18.64 | 4.41 |
| Asia | NY | 889 | 6.14 | 10.36 | 0.41 | 0.94 | 23.17 | 6.52 |
| Asia | Late | 47 | 6.01 | 8.60 | 0.18 | 0.40 | 4.26 | 2.13 |
| London | ALL | 3200 | 5.84 | 10.15 | 0.49 | 1.12 | 28.31 | 11.31 |
| London | Asia | 191 | 5.93 | 9.56 | 0.34 | 0.70 | 11.52 | 2.09 |
| London | London | 56 | 5.91 | 9.32 | 0.31 | 0.66 | 16.07 | 1.79 |
| London | NY | 2920 | 5.84 | 10.28 | 0.52 | 1.16 | 29.69 | 12.12 |
| London | Late | 33 | 4.94 | 8.15 | 0.30 | 0.84 | 24.24 | 9.09 |
| NY | ALL | 1591 | 5.82 | 9.55 | 0.33 | 0.69 | 13.76 | 2.89 |
| NY | Asia | 636 | 6.13 | 9.33 | 0.38 | 0.77 | 15.25 | 3.46 |
| NY | London | 141 | 5.90 | 9.24 | 0.31 | 0.62 | 11.35 | 0.71 |
| NY | NY | 376 | 6.56 | 11.88 | 0.34 | 0.73 | 15.43 | 1.86 |
| NY | Late | 438 | 4.96 | 8.31 | 0.27 | 0.56 | 10.96 | 3.65 |

_DESIGN.md §2 pin: stop = distance from the BREAK CLOSE back to the sweep leg's running extreme (take-out bar .. break bar) — the SAME convention iFVG uses in v4, which is what makes R comparable across methods. `R` = block-scoped MFE / that stop. **Descriptive only** — no costs, no exit rule, and MFE is a best-case exit nobody hits systematically._

### T12. Monthly stability

Full table in `results/t12_monthly.csv` (48 months). Monthly corrected-BoS rate ranges **27-41%** (median 33%); monthly median R proxy **0.25-0.59** (median 0.41). Worst / best month by rate: 2026-03 / 2023-01. See chart 06.

## D. Corrected BoS vs PHASE-1 BoS — the re-anchoring defect, quantified

### D1. Headline metrics, both arms, same take-out rows (primary sample)

| algorithm | n_confirmed | confirm_rate_pct | delay_median_bars | delay_p90_bars | mfe_atr_median | mae_atr_median | stop_atr_median | R_median | share_R_ge_1 | share_R_ge_2 | end_atr_median |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BoS — CORRECTED (pinned anchor, no re-anchoring) | 7135 | 33.79 | 18.00 | 51.00 | 2.42 | 2.37 | 5.77 | 0.41 | 22.37 | 7.44 | -0.08 |
| BoS — PHASE 1 (re-anchoring, the defect) | 17394 | 82.37 | 19.00 | 45.00 | 1.99 | 2.05 | 3.86 | 0.51 | 26.67 | 9.20 | -0.01 |
| delta (corrected - phase 1) | -10259 | -48.58 | -1.00 | 6.00 | 0.43 | 0.31 | 1.90 | -0.10 | -4.29 | -1.76 | -0.07 |

_Same take-outs, same horizon, same geometry formulas, same k=3 pivots — the ONLY difference is whether the tested level is allowed to MOVE after the take-out. Each row is computed on its own confirmed subset, so `n_confirmed` differs by construction; that difference is the finding._

### D2. Which level was phase 1 actually testing?

| sweep_block | n | level_defined_at_t0_pct | agrees_with_corrected_anchor_at_t0_pct | reanchors_before_break_median | reanchors_before_break_mean | still_same_level_at_break_pct |
|---|---|---|---|---|---|---|
| ALL | 21118 | 98.46 | 98.46 | 2.00 | 2.00 | 11.32 |
| Asia | 3347 | 99.13 | 99.13 | 2.00 | 2.09 | 8.47 |
| London | 4487 | 98.80 | 98.80 | 1.00 | 1.77 | 11.04 |
| NY | 10764 | 97.97 | 97.97 | 2.00 | 2.15 | 11.44 |
| Late | 2520 | 99.01 | 99.01 | 1.00 | 1.30 | 17.26 |

**This is the defect, in two numbers.** At the take-out bar the two mechanics pick the *same* level on **98.5%** of take-outs — they are the same selection rule at `t0`. By the bar phase 1 fires, it is still testing that level on only **11.3%** of them, because a median of **2** newly confirmed pivots overwrote it in between. Phase-1 BoS was therefore not a break of the structure that led into the sweep; it was a break of whatever minor swing happened to be the most recent one at the time.

### D3. Outcome agreement — corrected vs phase 1 (primary sample)

| sweep_block | n | both_pct | corrected_only_pct | phase1_only_pct | neither_pct | same_bar_pct |
|---|---|---|---|---|---|---|
| ALL | 21118 | 33.57 | 0.21 | 48.79 | 17.42 | 40.18 |
| Asia | 3347 | 29.64 | 0.09 | 56.44 | 13.83 | 34.17 |
| London | 4487 | 31.27 | 0.33 | 47.25 | 21.15 | 40.48 |
| NY | 10764 | 38.88 | 0.12 | 50.62 | 10.38 | 39.04 |
| Late | 2520 | 20.24 | 0.56 | 33.57 | 45.63 | 60.39 |

_Neither arm's confirmed set contains the other's: the corrected mechanic can fire where phase 1's level had already been retired by an earlier break, and phase 1 fires constantly on levels the corrected mechanic never watched._

### D4. Where both fire — how far apart are they

| quantity | n | p10 | median | mean | p90 | share_positive_pct | share_zero_pct |
|---|---|---|---|---|---|---|---|
| break delay, corrected - phase 1 (bars) | 7090 | 0.000 | 1.000 | 8.001 | 27.000 | 55.825 | 40.183 |
| stop proxy, corrected - phase 1 (ATR) | 7039 | 0.000 | 0.771 | 1.588 | 4.474 | 56.215 | 40.403 |
| R proxy, corrected - phase 1 | 7039 | -1.824 | -0.251 | -0.627 | 0.000 | 3.381 | 40.403 |
| MFE from the break, corrected - phase 1 (ATR) | 7039 | -4.399 | -0.781 | -1.562 | 0.000 | 3.381 | 40.403 |

_Restricted to the **7,090** primary take-outs both arms confirm. A positive delay delta means the corrected mechanic fired LATER._

### D5. What the phase-1 numbers meant — the cited figures, re-derived

| arm | n | rate_pct | delay_median_bars | stop_atr_median | R_median |
|---|---|---|---|---|---|
| phase-1 mechanic, v4-era block-scoped window | 17394 | 82.37 | 19.00 | 3.86 | 0.51 |
| corrected mechanic, same window | 7135 | 33.79 | 18.00 | 5.77 | 0.41 |

_Phase 1 reported a BoS delay median of 14 bars and a stop width of 3.76 ATR under its own 2h fixed horizon; the correction note predicted both were **inflated** by re-anchoring. Re-derived here on the same window for both arms, the prediction's DIRECTION does not hold — see REPORT §4. The row above is what phase 1's mechanic actually produces when the horizon confound is removed._

## M. Corrected BoS vs iFVG-v4 — the original 'which confirmation method' question

### M1. Agreement matrix — same take-outs, both methods correctly measured

| sweep_block | n | both_pct | bos_only_pct | ifvg_only_pct | neither_pct | bos_rate_pct | ifvg_rate_pct |
|---|---|---|---|---|---|---|---|
| ALL | 21118 | 15.64 | 18.15 | 48.79 | 17.42 | 33.79 | 64.43 |
| Asia | 3347 | 13.18 | 16.55 | 52.91 | 17.36 | 29.73 | 66.09 |
| London | 4487 | 12.46 | 19.14 | 47.63 | 20.77 | 31.60 | 60.08 |
| NY | 10764 | 20.28 | 18.72 | 49.58 | 11.42 | 39.00 | 69.86 |
| Late | 2520 | 4.72 | 16.07 | 42.02 | 37.18 | 20.79 | 46.75 |

_The first time these two methods have been compared with BOTH of them correctly implemented. Read the `both` column as 'how much of the one method is the other method' — the two are far from interchangeable._

### M2. Relative timing where BOTH fire

| scope | n | bos_delay_median | ifvg_delay_median | diff_median_bars | diff_p10 | diff_p90 | bos_first_pct | same_bar_pct | ifvg_first_pct |
|---|---|---|---|---|---|---|---|---|---|
| ALL blocks | 3302 | 24.00 | 13.00 | 11.00 | -36.00 | 43.00 | 23.29 | 1.51 | 75.20 |
| Asia | 441 | 31.00 | 12.00 | 19.00 | -31.00 | 52.00 | 17.69 | 0.00 | 82.31 |
| London | 559 | 26.00 | 12.00 | 13.00 | -19.20 | 34.00 | 15.21 | 2.33 | 82.47 |
| NY | 2183 | 23.00 | 15.00 | 9.00 | -41.00 | 44.00 | 27.21 | 1.47 | 71.32 |
| Late | 119 | 17.00 | 7.00 | 7.00 | -1.60 | 18.40 | 10.08 | 4.20 | 85.71 |

_Positive `diff` = BoS fired LATER than the iFVG on the same take-out._

### M3. Side-by-side geometry from each method's own entry reference

| algorithm | n_confirmed | confirm_rate_pct | delay_median_bars | delay_p90_bars | mfe_atr_median | mae_atr_median | stop_atr_median | R_median | share_R_ge_1 | share_R_ge_2 | end_atr_median |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BoS — CORRECTED (pinned anchor, no re-anchoring) | 7135 | 33.79 | 18.00 | 51.00 | 2.42 | 2.37 | 5.77 | 0.41 | 22.37 | 7.44 | -0.08 |
| BoS — PHASE 1 (re-anchoring, the defect) | 17394 | 82.37 | 19.00 | 45.00 | 1.99 | 2.05 | 3.86 | 0.51 | 26.67 | 9.20 | -0.01 |
| iFVG — v4 (§5.1, the comparison method) | 13606 | 64.43 | 15.00 | 40.00 | 2.34 | 2.36 | 2.67 | 0.84 | 43.82 | 19.69 | 0.10 |

_Identical formulas and an identical stop convention (DESIGN.md §2), so the R column is comparable across rows. Each row is computed on its OWN confirmed subset._

### M3b. Geometry restricted to the take-outs BOTH methods confirm

| method | n | delay_median | mfe_atr_median | mae_atr_median | stop_atr_median | R_median | share_R_ge_1 | end_atr_median |
|---|---|---|---|---|---|---|---|---|
| BoS — CORRECTED (pinned anchor, no re-anchoring) | 3302 | 24.00 | 2.04 | 3.66 | 6.78 | 0.30 | 15.90 | -0.91 |
| iFVG — v4 (§5.1, the comparison method) | 3302 | 13.00 | 6.01 | 1.64 | 2.94 | 2.05 | 76.91 | 3.02 |

_The event set is held FIXED here, so nothing in this table is confounded by the two methods confirming different take-outs. What is left is purely the cost of entering later and from further inside the range._

### M4. Does BoS SELECT? — lift over each block's own unconditional baseline

| sweep_block | direction | n_takeouts | takeout_rev_atr_median | uncond_atr_median | lift_bare_takeout | n_bos | lift_bos | n_ifvg | lift_ifvg | n_p1bos | lift_p1bos |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 1851 | 3.973 | 2.917 | 1.362 | 543 | 2.610 | 1268 | 1.126 | 1616 | 1.473 |
| Asia | low_sweep | 1496 | 4.029 | 2.902 | 1.388 | 452 | 2.772 | 944 | 1.133 | 1265 | 1.531 |
| London | high_sweep | 2387 | 4.106 | 2.695 | 1.524 | 786 | 2.691 | 1484 | 1.208 | 1904 | 1.707 |
| London | low_sweep | 2100 | 3.874 | 2.673 | 1.450 | 632 | 2.431 | 1212 | 1.105 | 1619 | 1.672 |
| NY | high_sweep | 5097 | 4.456 | 2.783 | 1.601 | 2054 | 3.242 | 3648 | 1.347 | 4488 | 1.774 |
| NY | low_sweep | 5667 | 4.162 | 2.725 | 1.528 | 2144 | 2.909 | 3872 | 1.228 | 5146 | 1.629 |
| Late | high_sweep | 1324 | 3.177 | 1.853 | 1.715 | 253 | 3.340 | 694 | 1.346 | 718 | 2.191 |
| Late | low_sweep | 1196 | 3.613 | 1.873 | 1.929 | 271 | 3.213 | 484 | 1.506 | 638 | 2.388 |

_`lift` = conditional median / same-block unconditional median, both measured from the WICK extreme so both are hindsight-flattered the same way. **The v4 standing null is that iFVG does not select** (confirmed lift 0.97-1.23x vs 1.23-1.58x for bare take-outs — confirming made the reversal SMALLER). The question here is whether BoS behaves differently._

### M4b. The same question, window-matched (the honest version)

| sweep_block | bars_remaining | n | hi_lift_bare | hi_lift_bos | hi_lift_ifvg | lo_lift_bare | lo_lift_bos | lo_lift_ifvg |
|---|---|---|---|---|---|---|---|---|
| Asia | 12-24 | 284 | 1.407 | 2.858 | 0.979 | 1.224 | 2.406 | 1.039 |
| Asia | 24-48 | 625 | 1.218 | 2.286 | 1.001 | 1.189 | 2.308 | 0.927 |
| Asia | 48-72 | 956 | 1.151 | 2.060 | 0.961 | 1.190 | 2.332 | 0.961 |
| Asia | 72+ | 1482 | 1.113 | 2.025 | 0.879 | 1.186 | 2.219 | 0.909 |
| London | 12-24 | 626 | 1.498 | 2.739 | 1.107 | 1.291 | 2.647 | 0.944 |
| London | 24-48 | 1838 | 1.277 | 2.312 | 0.954 | 1.256 | 2.104 | 0.939 |
| London | 48-72 | 2023 | 1.143 | 1.955 | 0.940 | 1.140 | 1.700 | 0.855 |
| NY | 12-24 | 477 | 1.326 | 3.071 | 1.194 | 1.453 | 3.021 | 1.085 |
| NY | 24-48 | 1313 | 1.430 | 3.018 | 1.075 | 1.370 | 2.394 | 0.996 |
| NY | 48-72 | 2561 | 1.149 | 2.278 | 0.913 | 1.125 | 2.096 | 0.896 |
| NY | 72+ | 6413 | 1.099 | 1.941 | 0.895 | 1.096 | 1.922 | 0.862 |
| Late | 12-24 | 1005 | 1.393 | 2.905 | 1.110 | 1.629 | 2.938 | 1.285 |
| Late | 24-48 | 1515 | 1.322 | 2.455 | 1.014 | 1.445 | 2.302 | 1.158 |

_Confirmation rate and reversal size are both driven by how much block is left, so an unmatched lift comparison partly measures window length. Inside a bars-remaining bucket that confound is held fixed._

### M4c. Selection summary — one number per method

| subset | n | share_of_primary_pct | rev_atr_median | window_matched_lift_median | share_rev_ge_2atr | share_rev_ge_4atr |
|---|---|---|---|---|---|---|
| bare take-out (no confirmation required) | 21118 | 100.000 | 4.051 | 1.211 | 81.613 | 50.649 |
| BoS-confirmed (corrected) | 7135 | 33.786 | 7.759 | 2.100 | 99.986 | 95.039 |
| iFVG-confirmed (v4) | 13606 | 64.428 | 3.311 | 0.927 | 74.519 | 39.108 |
| BoS-confirmed (phase-1 mechanic) | 17394 | 82.366 | 4.542 | 1.288 | 85.547 | 57.589 |
| both BoS and iFVG confirmed | 3302 | 15.636 | 7.427 | 1.871 | 99.970 | 93.459 |

_`window_matched_lift_median` = the median, over events, of that event's wick-anchored reversal divided by the unconditional median move for its own (block x remaining-window bucket x direction) cell. A value of 1.0 means 'this subset moves exactly like a random bar in the same situation'; above 1 means the filter picked bigger reversals. Because the denominator is a per-cell constant, this is a descriptive ratio, not a test._

### M4d. WHY M4/M4b/M4c CANNOT BE READ AS SELECTION — the circularity

| quantity | p10 | median | p90 |
|---|---|---|---|
| anchor distance |take-out wick - anchor| (ATR) | 2.80 | 4.22 | 6.33 |
| wick-anchored reversal rev_atr, BoS-confirmed events | 4.57 | 7.76 | 15.40 |
| rev_atr, ALL primary take-outs (the comparison base) | 1.40 | 4.05 | 10.19 |

**A BoS break is a close through a ray that sits a median of 4.22 ATR away from the take-out wick, and the ray is always on the near side of the swept level (B1). So a BoS confirmation MECHANICALLY IMPLIES `rev_atr > anchor_dist_atr` — measured share: 100.0%.** The lift columns in M4/M4b/M4c apply a threshold to the very quantity they then report, so a BoS lift of ~2-3x is a floor effect, not evidence that BoS picks better sweeps. iFVG has no such floor (a gap can invert anywhere), which is why the v4 lift table was interpretable and this one is not. The non-circular version is M4e.

### M4e. The non-circular selection test — forward move measured FROM the confirmation bar

Everything before the confirmation bar is discarded, and each confirmed event is compared against the unconditional forward move for bars with the SAME number of bars remaining **at the confirmation bar** — so the confirmation criterion can no longer feed the numerator.

| method | n | mfe_atr_median | matched_uncond_median | forward_lift_median | forward_lift_mean | share_lift_ge_1 |
|---|---|---|---|---|---|---|
| BoS — CORRECTED (pinned anchor, no re-anchoring) | 7085 | 2.422 | 3.090 | 0.867 | 1.367 | 44.573 |
| iFVG — v4 (§5.1, the comparison method) | 13543 | 2.337 | 3.090 | 0.831 | 1.166 | 41.800 |
| BoS — PHASE 1 (re-anchoring, the defect) | 17281 | 1.988 | 3.016 | 0.739 | 1.121 | 38.186 |

_`forward_lift` = the event's post-confirmation MFE divided by the unconditional median forward move for its (block x bars-remaining-at-confirmation x direction) cell. The denominator is measured from a bar's high/low while the numerator starts at a close, which biases the denominator slightly UP — so these numbers are, if anything, conservative against the methods. A value near 1.0 means the confirmation told you nothing about what comes next; this is the column the v4 'iFVG does not select' null actually lives in, and it is where BoS has to be judged too._

## W. Window length — the primary comparative axis (§6.1)

### W1. Confirmation rate by remaining-window bucket, all three arms

| bars_remaining | n | share_pct | bos_rate | p1bos_rate | ifvg_rate | bos_delay_median | ifvg_delay_median | anchor_dist_atr_median |
|---|---|---|---|---|---|---|---|---|
| <12 (short) | 2305 | 9.84 | 5.60 | 7.90 | 10.67 | 4.00 | 5.00 | 5.45 |
| 12-24 | 2392 | 10.21 | 14.30 | 37.88 | 37.71 | 9.00 | 10.00 | 5.29 |
| 24-48 | 5291 | 22.59 | 26.04 | 71.84 | 56.06 | 16.00 | 14.00 | 5.05 |
| 48-72 | 5540 | 23.65 | 31.50 | 90.76 | 68.90 | 24.00 | 16.00 | 4.92 |
| 72+ | 7895 | 33.71 | 46.49 | 97.01 | 75.00 | 18.00 | 17.00 | 4.78 |

_Window length dominates BoS exactly as it dominates iFVG: the mechanic needs enough bars left for price to travel back through a ray that sits a median of several ATR away. Note the anchor DISTANCE is essentially flat across buckets — the rate difference is time, not geometry._

### W2. From-break geometry by remaining-window bucket (corrected BoS)

| bars_remaining | n | delay_median | conf_bars_left_median | mfe_atr_median | mae_atr_median | stop_atr_median | R_median | share_R_ge_1 |
|---|---|---|---|---|---|---|---|---|
| 12-24 | 342 | 9.00 | 9.00 | 1.20 | 1.13 | 5.11 | 0.23 | 8.19 |
| 24-48 | 1378 | 16.00 | 19.00 | 1.58 | 1.63 | 5.32 | 0.29 | 12.77 |
| 48-72 | 1745 | 24.00 | 34.00 | 2.07 | 1.91 | 5.32 | 0.38 | 17.48 |
| 72+ | 3670 | 18.00 | 68.00 | 3.41 | 3.38 | 6.27 | 0.53 | 29.32 |

## H. Clock — derived, and only meaningful window-stratified

### H1. BoS rate by take-out hour (UTC), window-length-stratified

| hour | n | bos_rate_ALL | ifvg_rate_ALL | bos_12-24 | n_12-24 | bos_24-48 | n_24-48 | bos_48-72 | n_48-72 | bos_72+ | n_72+ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 769 | 41.61 | 73.60 |  | 0 |  | 0 |  | 0 | 41.61 | 769 |
| 1 | 713 | 33.38 | 72.23 |  | 0 |  | 0 |  | 0 | 33.38 | 713 |
| 2 | 583 | 24.70 | 72.56 |  | 0 |  | 0 | 24.70 | 583 |  | 0 |
| 3 | 373 | 26.54 | 63.27 |  | 0 |  | 0 | 26.54 | 373 |  | 0 |
| 4 | 320 | 30.31 | 62.50 |  | 0 | 30.31 | 320 |  | 0 |  | 0 |
| 5 | 305 | 20.00 | 56.72 |  | 0 | 20.00 | 305 |  | 0 |  | 0 |
| 6 | 284 | 12.68 | 34.86 | 12.68 | 284 |  | 0 |  | 0 |  | 0 |
| 7 | 0 |  |  |  | 0 |  | 0 |  | 0 |  | 0 |
| 8 | 2023 | 37.91 | 67.77 |  | 0 |  | 0 | 37.91 | 2023 |  | 0 |
| 9 | 1105 | 31.58 | 62.35 |  | 0 | 31.58 | 1105 |  | 0 |  | 0 |
| 10 | 733 | 24.69 | 53.07 |  | 0 | 24.69 | 733 |  | 0 |  | 0 |
| 11 | 626 | 19.33 | 39.46 | 19.33 | 626 |  | 0 |  | 0 |  | 0 |
| 12 | 0 |  |  |  | 0 |  | 0 |  | 0 |  | 0 |
| 13 | 3896 | 54.26 | 76.69 |  | 0 |  | 0 |  | 0 | 54.26 | 3896 |
| 14 | 2517 | 39.65 | 73.58 |  | 0 |  | 0 |  | 0 | 39.65 | 2517 |
| 15 | 1589 | 27.56 | 73.19 |  | 0 |  | 0 | 27.56 | 1589 |  | 0 |
| 16 | 972 | 30.56 | 64.20 |  | 0 |  | 0 | 30.56 | 972 |  | 0 |
| 17 | 740 | 23.65 | 60.27 |  | 0 | 23.65 | 740 |  | 0 |  | 0 |
| 18 | 573 | 21.29 | 49.21 |  | 0 | 21.29 | 573 |  | 0 |  | 0 |
| 19 | 477 | 11.32 | 34.59 | 11.32 | 477 |  | 0 |  | 0 |  | 0 |
| 20 | 0 |  |  |  | 0 |  | 0 |  | 0 |  | 0 |
| 21 | 1515 | 25.94 | 51.95 |  | 0 | 25.94 | 1515 |  | 0 |  | 0 |
| 22 | 1005 | 13.03 | 38.91 | 13.03 | 1005 |  | 0 |  | 0 |  | 0 |
| 23 | 0 |  |  |  | 0 |  | 0 |  | 0 |  | 0 |

_§6.1 warns that an unstratified hourly cut just rediscovers the clock, because a take-out's hour and its remaining window length are the same fact seen twice. The `bos_<bucket>` columns hold the window length fixed; blank cells have < 20 events._

## A. Appendix

### A1. Primary vs short-window sample

| sample | n | share_pct | rem_median | bos_rate | p1bos_rate | ifvg_rate | unanchorable_pct | rev_atr_median | bos_R_median |
|---|---|---|---|---|---|---|---|---|---|
| primary (>= 12 bars left) | 21118 | 90.16 | 59.00 | 33.79 | 82.37 | 64.43 | 0.00 | 4.05 | 0.41 |
| short window (< 12 bars left) | 2305 | 9.84 | 6.00 | 5.60 | 7.90 | 10.67 | 0.00 | 2.36 | 0.15 |
| FULL sample (both) | 23423 | 100.00 | 55.00 | 31.01 | 75.04 | 59.14 | 0.00 | 3.84 | 0.40 |

### A2. Full-sample BoS rate (no window filter)

| level_session | Asia | London | NY | Late | ALL blocks |
|---|---|---|---|---|---|
| Asia | 22.64 | 30.16 | 31.02 | 14.36 | 29.11 |
| London | 25.96 | 19.03 | 43.01 | 10.12 | 38.87 |
| NY | 28.94 | 20.22 | 26.91 | 18.62 | 23.83 |
| ALL levels | 27.13 | 27.96 | 37.84 | 17.06 | 31.01 |

