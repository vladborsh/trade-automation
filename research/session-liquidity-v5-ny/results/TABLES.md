# Tables — session-liquidity v5-NY (descriptive layer)

Pre-registration: `DESIGN.md`. Pre-registered hypothesis test and null: `results/HYPOTHESIS.md` (written by `hypothesis.py`). This file is the house-style descriptive layer, reported alongside, per DESIGN §0.

Sample: 23,423 take-outs, 21,118 primary, BTC/ETH/SOL/BNB 5m, 2022-08-01 .. 2026-07-31. BTC+ETH foregrounded (DESIGN §2.3).

## E — Eligibility funnel: how many take-outs can reach the NY window

The window is **13:40–15:20 UTC** (09:40–11:20 New York at the pinned fixed offset UTC−4), 20 five-minute bars, and it sits **fully inside** the NY block (13:00–21:00 UTC).

Because confirmation is block-scoped and the confirmation bar is at or after the take-out bar, an in-window confirmation forces the take-out itself into **13:00–15:15 UTC**. The eligible population is therefore a narrow slice of the stream, and that is a property of the definition, not a choice made here.

**E1 — the funnel (primary sample, ≥12 bars remaining)**

| scope | take_outs | primary | in_NY_block | t0_window_eligible | iFVG_conf_in_window | BoS_conf_in_window |
|---|---|---|---|---|---|---|
| BTCUSDT | 5834 | 5246 | 2840 | 1925 | 574 | 427 |
| ETHUSDT | 5750 | 5201 | 2713 | 1780 | 482 | 341 |
| SOLUSDT | 5966 | 5356 | 2699 | 1729 | 560 | 344 |
| BNBUSDT | 5873 | 5315 | 2512 | 1624 | 518 | 311 |
| BTC+ETH (foreground) | 11584 | 10447 | 5553 | 3705 | 1056 | 768 |
| ALL 4 | 23423 | 21118 | 10764 | 7058 | 2134 | 1423 |

**E2 — conversion inside the eligible slice (BTC+ETH).** Of the **3,705** primary take-outs whose `t0` could still produce an in-window confirmation, **1,056** (28.5%) actually confirm by iFVG inside the window and **768** (20.7%) by BoS. The rest either never confirm, or confirm after 15:20 UTC.

**E3 — offset sensitivity (BTC+ETH primary).** UTC−4 is the pinned window; UTC−5 is the same 100 New York minutes read under the winter offset. Both sit fully inside the NY block.

| arm | confirmed | in_window_UTC4 | share_UTC4 | in_window_UTC5 | share_UTC5 |
|---|---|---|---|---|---|
| iFVG-v4 | 6592 | 1056 | 16.02 | 1214 | 18.42 |
| BoS pinned anchor | 3545 | 768 | 21.66 | 633 | 17.86 |

> **DST caveat, verbatim from DESIGN §2.2:** a fixed UTC−4 window is *not* 09:40–11:20 New York wall clock all year. During EST months it is really **08:40–10:20** New York. These are fixed UTC minutes, not wall-clock precision around the 09:30 NYSE open.


## G — From-confirmation geometry: block-scoped vs the 24h horizon

All in ATR(14, 5m) multiples, medians. `MFE`/`MAE` are the best and worst excursions after the confirmation close; `end value` is the signed move at the horizon's last bar; `stop` is the pinned proxy (confirmation close back to the sweep leg's running extreme) and `R proxy` is MFE/stop — a **best-case** exit nobody hits systematically, kept only because every prior pass reported it.

**G1[iFVG-v4] — BTC+ETH, primary sample**

| scope | n | MFE | MAE | MFE_over_MAE | end_value | pct_end_favourable | stop | R_proxy | pct_R_ge_1 |
|---|---|---|---|---|---|---|---|---|---|
| all confirmations · block-scoped (PRIMARY) | 6561 | 2.37 | 2.44 | 0.97 | 0.14 | 52.19 | 2.84 | 0.80 | 42.11 |
| NY window only · block-scoped (PRIMARY) | 1056 | 4.01 | 4.36 | 0.92 | 0.24 | 52.27 | 3.09 | 1.25 | 59.38 |
| all confirmations · 24h (appendix) | 6592 | 6.78 | 6.96 | 0.97 | 0.67 | 53.88 | 2.85 | 2.34 | 76.29 |
| NY window only · 24h (appendix) | 1056 | 7.09 | 7.06 | 1.00 | 0.54 | 52.84 | 3.09 | 2.28 | 74.91 |

**G1[BoS pinned anchor] — BTC+ETH, primary sample**

| scope | n | MFE | MAE | MFE_over_MAE | end_value | pct_end_favourable | stop | R_proxy | pct_R_ge_1 |
|---|---|---|---|---|---|---|---|---|---|
| all confirmations · block-scoped (PRIMARY) | 3525 | 2.54 | 2.48 | 1.02 | -0.17 | 47.57 | 5.98 | 0.41 | 22.87 |
| NY window only · block-scoped (PRIMARY) | 768 | 4.43 | 4.64 | 0.95 | -0.22 | 47.53 | 5.63 | 0.78 | 41.28 |
| all confirmations · 24h (appendix) | 3545 | 7.10 | 7.29 | 0.97 | -0.09 | 49.34 | 5.99 | 1.17 | 55.35 |
| NY window only · 24h (appendix) | 768 | 6.73 | 8.11 | 0.83 | -0.52 | 45.96 | 5.63 | 1.20 | 55.21 |


## L — The non-circular forward lift (the metric the shelving turned on)

Every naive 'confirmed sweeps move N× more' number in this family is an artifact: the confirmation criterion mechanically requires the move already reported to have happened. The non-circular version throws away everything before the confirmation bar and compares each event's **post-confirmation MFE** against the unconditional forward move for the same `block × bars-remaining-at-confirmation × direction` cell. **1.0 = no better than a random comparable stretch of tape.** The shelved verdict rests on 0.83 (iFVG) and 0.87 (BoS) all-hours.

**L1 — forward lift, BTC+ETH primary, block-scoped horizon**

| arm | scope | n | lift_median | pct_ge_1 |
|---|---|---|---|---|
| iFVG-v4 | all confirmations | 6561 | 0.84 | 41.79 |
| iFVG-v4 | NY window only | 1056 | 0.95 | 47.44 |
| BoS pinned anchor | all confirmations | 3525 | 0.89 | 45.82 |
| BoS pinned anchor | NY window only | 768 | 1.00 | 50.26 |


## W — Window length, the axis that dominated every prior pass

**W1 — BTC+ETH primary.** Note the in-window columns concentrate in the long buckets by construction: a take-out at 13:00–15:15 UTC always has most of the 96-bar NY block ahead of it.

| bars_left_at_t0 | n | share | iFVG_rate | BoS_rate | iFVG_in_window | BoS_in_window |
|---|---|---|---|---|---|---|
| 12-24 | 1180 | 11.30 | 35.68 | 14.49 | 0 | 0 |
| 24-48 | 2561 | 24.51 | 54.71 | 26.04 | 0 | 0 |
| 48-72 | 2656 | 25.42 | 67.17 | 30.76 | 3 | 5 |
| 72+ | 4050 | 38.77 | 73.73 | 46.67 | 1053 | 763 |

**W2 — confirmation rate by take-out hour (UTC), BTC+ETH primary.** Written to `w2_rate_by_hour.csv`; the standing null from v4/BoS is that this is window length in disguise, and chart `03_hour_and_window.png` shows the stratified version beside it.


## A — Appendix

### A1 — SOL / BNB robustness check (NOT foregrounded)

Computed identically to BTC/ETH. Present so a cross-asset check exists, per DESIGN §2.3; they are not part of the pre-registered test population.

| symbol | arm | confirmed | in_window | MFE_blk | MAE_blk | stop | R_proxy |
|---|---|---|---|---|---|---|---|
| BTCUSDT | iFVG | 3366 | 574 | 4.29 | 4.53 | 3.17 | 1.30 |
| BTCUSDT | BoS | 1861 | 427 | 4.57 | 4.62 | 5.63 | 0.80 |
| ETHUSDT | iFVG | 3226 | 482 | 3.70 | 4.18 | 3.02 | 1.22 |
| ETHUSDT | BoS | 1684 | 341 | 4.25 | 4.74 | 5.53 | 0.75 |
| SOLUSDT | iFVG | 3487 | 560 | 4.09 | 3.95 | 2.69 | 1.35 |
| SOLUSDT | BoS | 1768 | 344 | 4.29 | 4.20 | 5.33 | 0.81 |
| BNBUSDT | iFVG | 3527 | 518 | 3.77 | 4.26 | 2.72 | 1.39 |
| BNBUSDT | BoS | 1822 | 311 | 3.96 | 4.44 | 5.14 | 0.73 |

### A2 — Exclusions (DESIGN §4: counted, never silently dropped)

A trade is excluded when the confirmation lands on the horizon's last bar (no forward bars to run the template on) or the stop distance is zero. All four assets, primary sample.

| arm | horizon | confirmed | tradeable | excluded |
|---|---|---|---|---|
| ifvg | blk | 13606 | 13543 | 63 |
| ifvg | h24 | 13606 | 13606 | 0 |
| bos | blk | 7135 | 7085 | 50 |
| bos | h24 | 7135 | 7135 | 0 |

