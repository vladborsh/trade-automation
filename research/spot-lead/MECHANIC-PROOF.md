# MECHANIC-PROOF — spot-lead (fit period)

Ten trades picked mechanically (first trade of the arm/symbol/exit-cause after 2023-01-01; `boundary` from whichever symbol has one), printed independently of the engine where it matters: the 4h CVD sums are re-summed from the minute arrays (checks.py §2 re-sums them from the raw parquet rows), the exit minute is re-found by a plain loop, and every settlement's R contribution is listed from the funding archive.

## L1 · BTCUSDT · side long · exit `target`

- 4h bar 2023-01-03 04:00:00+00:00 → close **2023-01-03 08:00:00+00:00**; perp close 16723.1, prev close 16684.5, ret_4h +0.00231, ATR 87.6334, thr 0.00131
- cvd_spot 31.40 (recomputed 31.40), cvd_perp 1,097.11 (recomputed 1,097.11) → label **SPOT_LED**, shadow **SPOT_LED**
- entry 16723.1, 1R = 1.5·ATR = 131.45, stop 16591.6, target 16854.6
- engine exit: minute 2023-01-04 03:57:00+00:00 @ 16854.6; plain re-walk: (Timestamp('2023-01-04 03:57:00+0000', tz='UTC'), 'target')
- settlements in (entry, exit): 2 (engine n_settle 2)
  - 2023-01-03 16:00:00+00:00 rate +0.000033 × P 16670.9 → -0.00421 R
  - 2023-01-04 00:00:00+00:00 rate +0.000065 × P 16667.3 → -0.00823 R
- priceR +1.0000, fundingR -0.0124, costR 0.1272 (0.001×16723.1/131.45), **netR +0.8603**, hold 20.0 h

## L1 · SOLUSDT · side long · exit `stop`

- 4h bar 2023-01-04 04:00:00+00:00 → close **2023-01-04 08:00:00+00:00**; perp close 14.109, prev close 13.435, ret_4h +0.05017, ATR 0.608118, thr 0.01078
- cvd_spot 231,426.24 (recomputed 231,426.24), cvd_perp 896,991.00 (recomputed 896,991.00) → label **SPOT_LED**, shadow **SPOT_LED**
- entry 14.109, 1R = 1.5·ATR = 0.912177, stop 13.1968, target 15.0212
- engine exit: minute 2023-01-04 15:08:00+00:00 @ 13.1968; plain re-walk: (Timestamp('2023-01-04 15:08:00+0000', tz='UTC'), 'stop')
- settlements in (entry, exit): 0 (engine n_settle 0)
- priceR -1.0000, fundingR -0.0000, costR 0.0155 (0.001×14.109/0.912177), **netR -1.0155**, hold 7.2 h

## L1 · ETHUSDT · side long · exit `time`

- 4h bar 2023-07-07 12:00:00+00:00 → close **2023-07-07 16:00:00+00:00**; perp close 1871.27, prev close 1859.41, ret_4h +0.00638, ATR 24.8402, thr 0.00332
- cvd_spot 914.27 (recomputed 914.27), cvd_perp -19,719.14 (recomputed -19,719.14) → label **SPOT_LED**, shadow **PERP_LED**
- entry 1871.27, 1R = 1.5·ATR = 37.2602, stop 1834.01, target 1908.53
- engine exit: minute 2023-07-12 15:59:00+00:00 @ 1882.53; plain re-walk: no touch before 5 d / the fit boundary
- settlements in (entry, exit): 14 (engine n_settle 14)
  - 2023-07-08 00:00:00+00:00 rate +0.000038 × P 1870 → -0.00191 R
  - 2023-07-08 08:00:00+00:00 rate +0.000013 × P 1860.66 → -0.00067 R
  - 2023-07-08 16:00:00+00:00 rate -0.000004 × P 1858.35 → +0.00021 R
  - 2023-07-09 00:00:00+00:00 rate +0.000032 × P 1864.45 → -0.00161 R
  - 2023-07-09 08:00:00+00:00 rate +0.000029 × P 1866.47 → -0.00144 R
  - 2023-07-09 16:00:00+00:00 rate +0.000032 × P 1865.52 → -0.00159 R
  - 2023-07-10 00:00:00+00:00 rate +0.000027 × P 1861.81 → -0.00136 R
  - 2023-07-10 08:00:00+00:00 rate +0.000045 × P 1855.43 → -0.00225 R
  - 2023-07-10 16:00:00+00:00 rate +0.000072 × P 1870.01 → -0.00360 R
  - 2023-07-11 00:00:00+00:00 rate +0.000095 × P 1879.35 → -0.00481 R
  - 2023-07-11 08:00:00+00:00 rate +0.000077 × P 1882.39 → -0.00387 R
  - 2023-07-11 16:00:00+00:00 rate +0.000025 × P 1871.16 → -0.00128 R
  - 2023-07-12 00:00:00+00:00 rate +0.000083 × P 1877.66 → -0.00418 R
  - 2023-07-12 08:00:00+00:00 rate +0.000100 × P 1890 → -0.00507 R
- priceR +0.3022, fundingR -0.0334, costR 0.0502 (0.001×1871.27/37.2602), **netR +0.2185**, hold 120.0 h

## L1c · XRPUSDT · side long · exit `target`

- 4h bar 2023-01-13 00:00:00+00:00 → close **2023-01-13 04:00:00+00:00**; perp close 0.3786, prev close 0.3746, ret_4h +0.01068, ATR 0.00838164, thr 0.00553
- cvd_spot -78,664.00 (recomputed -78,664.00), cvd_perp 1,199,606.00 (recomputed 1,199,606.00) → label **PERP_LED**, shadow **SPOT_LED**
- entry 0.3786, 1R = 1.5·ATR = 0.0125725, stop 0.366028, target 0.391172
- engine exit: minute 2023-01-14 00:37:00+00:00 @ 0.391172; plain re-walk: (Timestamp('2023-01-14 00:37:00+0000', tz='UTC'), 'target')
- settlements in (entry, exit): 3 (engine n_settle 3)
  - 2023-01-13 08:00:00+00:00 rate +0.000100 × P 0.3764 → -0.00299 R
  - 2023-01-13 16:00:00+00:00 rate +0.000100 × P 0.3738 → -0.00297 R
  - 2023-01-14 00:00:00+00:00 rate +0.000100 × P 0.3856 → -0.00307 R
- priceR +1.0000, fundingR -0.0090, costR 0.0301 (0.001×0.3786/0.0125725), **netR +0.9609**, hold 20.6 h

## L2 · ETHUSDT · side short · exit `stop`

- 4h bar 2023-01-03 20:00:00+00:00 → close **2023-01-04 00:00:00+00:00**; perp close 1214.23, prev close 1208.92, ret_4h +0.00439, ATR 9.51907, thr 0.00196
- cvd_spot -2,807.09 (recomputed -2,807.09), cvd_perp 14,761.72 (recomputed 14,761.72) → label **PERP_LED**, shadow **SPOT_LED**
- entry 1214.23, 1R = 1.5·ATR = 14.2786, stop 1228.51, target 1199.95
- engine exit: minute 2023-01-04 01:20:00+00:00 @ 1228.51; plain re-walk: (Timestamp('2023-01-04 01:20:00+0000', tz='UTC'), 'stop')
- settlements in (entry, exit): 0 (engine n_settle 0)
- priceR -1.0000, fundingR +0.0000, costR 0.0850 (0.001×1214.23/14.2786), **netR -1.0850**, hold 1.4 h

## L2 · DOGEUSDT · side short · exit `target`

- 4h bar 2023-01-15 20:00:00+00:00 → close **2023-01-16 00:00:00+00:00**; perp close 0.08615, prev close 0.08532, ret_4h +0.00973, ATR 0.00282801, thr 0.00821
- cvd_spot -5,350,577.00 (recomputed -5,350,577.00), cvd_perp 11,009,295.00 (recomputed 11,009,295.00) → label **PERP_LED**, shadow **SPOT_LED**
- entry 0.08615, 1R = 1.5·ATR = 0.00424201, stop 0.090392, target 0.081908
- engine exit: minute 2023-01-16 15:14:00+00:00 @ 0.081908; plain re-walk: (Timestamp('2023-01-16 15:14:00+0000', tz='UTC'), 'target')
- settlements in (entry, exit): 1 (engine n_settle 1)
  - 2023-01-16 08:00:00+00:00 rate +0.000191 × P 0.08641 → +0.00390 R
- priceR +1.0000, fundingR +0.0039, costR 0.0203 (0.001×0.08615/0.00424201), **netR +0.9836**, hold 15.2 h

## L3 · BNBUSDT · side long · exit `target`

- 4h bar 2023-01-05 00:00:00+00:00 → close **2023-01-05 04:00:00+00:00**; perp close 257.57, prev close 258.54, ret_4h -0.00375, ATR 3.00634, thr 0.00292
- cvd_spot 429.26 (recomputed 429.26), cvd_perp -4,462.88 (recomputed -4,462.88) → label **ABSORPTION**, shadow **NONE**
- entry 257.57, 1R = 1.5·ATR = 4.50951, stop 253.06, target 262.08
- engine exit: minute 2023-01-07 00:56:00+00:00 @ 262.08; plain re-walk: (Timestamp('2023-01-07 00:56:00+0000', tz='UTC'), 'target')
- settlements in (entry, exit): 6 (engine n_settle 6)
  - 2023-01-05 08:00:00+00:00 rate -0.000415 × P 257.36 → +0.02368 R
  - 2023-01-05 16:00:00+00:00 rate -0.000344 × P 256.55 → +0.01960 R
  - 2023-01-06 00:00:00+00:00 rate -0.000352 × P 256.43 → +0.02003 R
  - 2023-01-06 08:00:00+00:00 rate -0.000147 × P 256.19 → +0.00836 R
  - 2023-01-06 16:00:00+00:00 rate -0.000216 × P 258.88 → +0.01238 R
  - 2023-01-07 00:00:00+00:00 rate -0.000230 × P 259.69 → +0.01323 R
- priceR +1.0000, fundingR +0.0973, costR 0.0571 (0.001×257.57/4.50951), **netR +1.0402**, hold 45.0 h

## L3 · ADAUSDT · side long · exit `stop`

- 4h bar 2023-02-05 00:00:00+00:00 → close **2023-02-05 04:00:00+00:00**; perp close 0.3969, prev close 0.3993, ret_4h -0.00601, ATR 0.00774841, thr 0.00488
- cvd_spot 36,557.10 (recomputed 36,557.10), cvd_perp -4,068,145.00 (recomputed -4,068,145.00) → label **ABSORPTION**, shadow **NONE**
- entry 0.3969, 1R = 1.5·ATR = 0.0116226, stop 0.385277, target 0.408523
- engine exit: minute 2023-02-05 17:17:00+00:00 @ 0.385277; plain re-walk: (Timestamp('2023-02-05 17:17:00+0000', tz='UTC'), 'stop')
- settlements in (entry, exit): 2 (engine n_settle 2)
  - 2023-02-05 08:00:00+00:00 rate +0.000100 × P 0.401 → -0.00345 R
  - 2023-02-05 16:00:00+00:00 rate +0.000100 × P 0.3908 → -0.00336 R
- priceR -1.0000, fundingR -0.0068, costR 0.0341 (0.001×0.3969/0.0116226), **netR -1.0410**, hold 13.3 h

## L4B · LINKUSDT · side long · exit `stop`

- 4h bar 2023-01-04 00:00:00+00:00 → close **2023-01-04 04:00:00+00:00**; perp close 5.787, prev close 5.618, ret_4h +0.03008, ATR 0.0888932, thr 0.00384
- cvd_spot 77,280.74 (recomputed 77,280.74), cvd_perp 505,109.52 (recomputed 505,109.52) → label **SPOT_LED**, shadow **SPOT_LED**
- entry 5.787, 1R = 1.5·ATR = 0.13334, stop 5.65366, target 5.92034
- engine exit: minute 2023-01-05 22:47:00+00:00 @ 5.65366; plain re-walk: (Timestamp('2023-01-05 22:47:00+0000', tz='UTC'), 'stop')
- settlements in (entry, exit): 5 (engine n_settle 5)
  - 2023-01-04 08:00:00+00:00 rate +0.000015 × P 5.796 → -0.00065 R
  - 2023-01-04 16:00:00+00:00 rate +0.000047 × P 5.81 → -0.00207 R
  - 2023-01-05 00:00:00+00:00 rate +0.000100 × P 5.806 → -0.00435 R
  - 2023-01-05 08:00:00+00:00 rate +0.000100 × P 5.762 → -0.00432 R
  - 2023-01-05 16:00:00+00:00 rate +0.000100 × P 5.715 → -0.00429 R
- priceR -1.0000, fundingR -0.0157, costR 0.0434 (0.001×5.787/0.13334), **netR -1.0591**, hold 42.8 h

## L1 · BNBUSDT · side long · exit `boundary`

- 4h bar 2025-07-30 20:00:00+00:00 → close **2025-07-31 00:00:00+00:00**; perp close 794.07, prev close 785.75, ret_4h +0.01059, ATR 16.1662, thr 0.00509
- cvd_spot 3,322.91 (recomputed 3,322.91), cvd_perp 219.83 (recomputed 219.83) → label **SPOT_LED**, shadow **SPOT_LED**
- entry 794.07, 1R = 1.5·ATR = 24.2492, stop 769.821, target 818.319
- engine exit: minute 2025-08-01 00:00:00+00:00 @ 783.67; plain re-walk: no touch before 5 d / the fit boundary
- settlements in (entry, exit): 2 (engine n_settle 2)
  - 2025-07-31 08:00:00+00:00 rate +0.000000 × P 804.03 → -0.00000 R
  - 2025-07-31 16:00:00+00:00 rate +0.000000 × P 800.01 → -0.00000 R
- priceR -0.4289, fundingR -0.0000, costR 0.0327 (0.001×794.07/24.2492), **netR -0.4616**, hold 24.0 h
