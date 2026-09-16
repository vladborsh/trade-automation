# MECHANIC PROOF — hedged spot–perp carry

Ten fit-period positions per tier, chosen by a fixed **outcome-blind stride** (every `len(positions)//10`-th closed position in entry order, index 0 first), hand-recomputed from the tape. Every quantity below is recomputed here from the raw 1 h closes and the raw funding rows and compared with the engine's value; the residual column is `|hand − engine|`. The margin path is printed step by step.

Cost model (DESIGN §4, pinned): spot 0.10 % + perp 0.05 % taker per side, 0.02 % slippage per fill, **both fee legs on the entry notional `N`**; one round trip = 0.38 % of `N`. At `L = 2`, `x_liq(F=0) = 48.515 %`, re-centre trigger `x_rc = 24.257 %`, evaluated on the perp 1 h **high**.

## Tier `majors` — 47 closed fit positions, stride 4, `C_slot = 50.0000`, `N = C_slot/1.5 = 33.333333`

### `BTCUSDT` 2020-01-16 08:00 → 2020-03-13 08:00 (`gate_on` → `gate_off`)

```
ENTRY   bar open 2020-01-16 08:00 UTC, both legs at that bar's close
  spot close  S_e = 8675.44000000   ->  q_s = N/S_e = 0.0038422643 units
  perp close  P_e = 8685.37000000   ->  q_p = N/P_e = 0.0038378714 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.114461%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (171 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2020-01-16 16:00  f = +0.031466%  perp open  8715.840000  ++0.0105254630 USDT   F = 0.0105254630
  2020-01-17 00:00  f = +0.010000%  perp open  8724.990000  ++0.0033485390 USDT   F = 0.0138740020
  2020-01-17 08:00  f = +0.015027%  perp open  8943.990000  ++0.0051581505 USDT   F = 0.0190321525
  2020-01-17 16:00  f = +0.056749%  perp open  8857.650000  ++0.0192915512 USDT   F = 0.0383237037
  ... 164 further settlements ...
  2020-03-12 16:00  f = -0.015149%  perp open  6122.460000  +-0.0035595930 USDT   F = 2.4134762315
  2020-03-13 00:00  f = -0.016073%  perp open  4762.280000  +-0.0029376652 USDT   F = 2.4105385663
  2020-03-13 08:00  f = -0.300000%  perp open  5374.150000  +-0.0618758901 USDT   F = 2.3486626762
  TOTAL FUNDING F = 2.3486626762   (engine 2.3486626762, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.070460 = (0.5 + 0.070460 - 0.01)/1.01 = 55.491077%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +21.353494%  at 2020-02-13 13:00
    worst bar 2020-02-13 13:00  high/P_e - 1 = +21.353494%  -> no action
    worst bar 2020-02-13 07:00  high/P_e - 1 = +21.037446%  -> no action
    worst bar 2020-02-12 07:00  high/P_e - 1 = +20.662447%  -> no action
  buffer left at the worst bar = x_liq - x_max = +34.137583% of notional

EXIT    bar open 2020-03-13 08:00
  spot close  S_x = 5276.38000000     perp close P_x = 5258.46000000
  basis PAID  b_x = P_x/S_x - 1 = -0.339627%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = -13.0600868659   (engine -13.0600868659, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = +13.1520399630  (engine +13.1520399630, res 0.00e+00)
  hedge_pnl = +0.0919530971   [basis reading N*(b_e - b_x) = +0.1513626143; difference is the second-order quantity mismatch]
  funding   = +2.3486626762
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = +2.3139491066   (engine +2.3139491066, res 0.00e+00)   = +4.6279% of slot capital
  cost / carry = 0.054

DAILY MARKS (bar closing 00:00 UTC; 57 days shown first 3 and last 3)
  2020-01-16 23:00  S= 8720.010000 P= 8725.080000  unreal +0.01884785  F_to_date +0.01052546  equity 49.96603997
  2020-01-17 23:00  S= 8913.280000 P= 8918.720000  unreal +0.01827684  F_to_date +0.03832370  equity 49.99326721
  2020-01-18 23:00  S= 8915.960000 P= 8925.000000  unreal +0.00447228  F_to_date +0.06263304  equity 50.00377198
  2020-03-10 23:00  S= 7894.560000 P= 7897.660000  unreal +0.02278236  F_to_date +2.39808276  equity 52.35753179
  2020-03-11 23:00  S= 7934.520000 P= 7938.390000  unreal +0.02000274  F_to_date +2.41097590  equity 52.36764530
  2020-03-12 23:00  S= 4800.000000 P= 4764.650000  unreal +0.15675452  F_to_date +2.41347623  equity 52.50689742
```

### `ETHUSDT` 2020-03-13 02:00 → 2020-03-13 03:00 (`recentre` → `recentre`)

```
ENTRY   bar open 2020-03-13 02:00 UTC, both legs at that bar's close
  spot close  S_e = 111.12000000   ->  q_s = N/S_e = 0.2999760019 units
  perp close  P_e = 110.80000000   ->  q_p = N/P_e = 0.3008423586 units
  basis RECEIVED  b_e = P_e/S_e - 1 = -0.287977%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (0 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  TOTAL FUNDING F = 0.0000000000   (engine 0.0000000000, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.000000 = (0.5 + 0.000000 - 0.01)/1.01 = 48.514851%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +26.353791%  at 2020-03-13 03:00
    worst bar 2020-03-13 03:00  high/P_e - 1 = +26.353791%  -> RE-CENTRE
  buffer left at the worst bar = x_liq - x_max = +22.161061% of notional

EXIT    bar open 2020-03-13 03:00
  spot close  S_x = 124.24000000     perp close P_x = 124.62000000
  basis PAID  b_x = P_x/S_x - 1 = +0.305860%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +3.9356851452   (engine +3.9356851452, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -4.1576413959  (engine -4.1576413959, res 0.00e+00)
  hedge_pnl = -0.2219562507   [basis reading N*(b_e - b_x) = -0.1979455295; difference is the second-order quantity mismatch]
  funding   = +0.0000000000
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = -0.3486229174   (engine -0.3486229174, res 0.00e+00)   = -0.6972% of slot capital
  cost / carry = n/a (F <= 0)

DAILY MARKS (bar closing 00:00 UTC; 0 days shown in full)
```

### `BTCUSDT` 2020-06-04 16:00 → 2020-06-15 16:00 (`gate_on` → `gate_off`)

```
ENTRY   bar open 2020-06-04 16:00 UTC, both legs at that bar's close
  spot close  S_e = 9770.31000000   ->  q_s = N/S_e = 0.0034116966 units
  perp close  P_e = 9769.14000000   ->  q_p = N/P_e = 0.0034121052 units
  basis RECEIVED  b_e = P_e/S_e - 1 = -0.011975%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (33 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2020-06-05 00:00  f = +0.010000%  perp open  9788.320000  ++0.0033398778 USDT   F = 0.0033398778
  2020-06-05 08:00  f = +0.010000%  perp open  9775.010000  ++0.0033353362 USDT   F = 0.0066752140
  2020-06-05 16:00  f = +0.010000%  perp open  9707.080000  ++0.0033121578 USDT   F = 0.0099873718
  2020-06-06 00:00  f = +0.010000%  perp open  9616.640000  ++0.0032812987 USDT   F = 0.0132686705
  ... 26 further settlements ...
  2020-06-15 00:00  f = +0.010000%  perp open  9339.700000  ++0.0031868039 USDT   F = 0.0914176277
  2020-06-15 08:00  f = -0.004149%  perp open  9114.990000  +-0.0012903931 USDT   F = 0.0901272345
  2020-06-15 16:00  f = -0.018213%  perp open  9290.010000  +-0.0057732462 USDT   F = 0.0843539883
  TOTAL FUNDING F = 0.0843539883   (engine 0.0843539883, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.002531 = (0.5 + 0.002531 - 0.01)/1.01 = 48.765408%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +2.526835%  at 2020-06-10 18:00
    worst bar 2020-06-10 18:00  high/P_e - 1 = +2.526835%  -> no action
    worst bar 2020-06-11 01:00  high/P_e - 1 = +2.057090%  -> no action
    worst bar 2020-06-11 02:00  high/P_e - 1 = +1.851340%  -> no action
  buffer left at the worst bar = x_liq - x_max = +46.238573% of notional

EXIT    bar open 2020-06-15 16:00
  spot close  S_x = 9362.92000000     perp close P_x = 9356.08000000
  basis PAID  b_x = P_x/S_x - 1 = -0.073054%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = -1.3898910748   (engine -1.3898910748, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = +1.4094041714  (engine +1.4094041714, res 0.00e+00)
  hedge_pnl = +0.0195130966   [basis reading N*(b_e - b_x) = +0.0203596925; difference is the second-order quantity mismatch]
  funding   = +0.0843539883
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = -0.0227995818   (engine -0.0227995818, res 0.00e+00)   = -0.0456% of slot capital
  cost / carry = 1.502

DAILY MARKS (bar closing 00:00 UTC; 11 days shown first 3 and last 3)
  2020-06-04 23:00  S= 9789.060000 P= 9788.330000  unreal -0.00150899  F_to_date +0.00000000  equity 49.93515768
  2020-06-05 23:00  S= 9621.160000 P= 9617.290000  unreal +0.00927363  F_to_date +0.00998737  equity 49.95592767
  2020-06-06 23:00  S= 9666.300000 P= 9664.000000  unreal +0.00389818  F_to_date +0.01983977  equity 49.96040461
  2020-06-12 23:00  S= 9465.130000 P= 9458.910000  unreal +0.01735583  F_to_date +0.07459755  equity 50.02862005
  2020-06-13 23:00  S= 9473.340000 P= 9468.540000  unreal +0.01250728  F_to_date +0.07951238  equity 50.02868633
  2020-06-14 23:00  S= 9342.100000 P= 9339.610000  unreal +0.00467895  F_to_date +0.08823082  equity 50.02957644
```

### `ETHUSDT` 2020-08-02 03:00 → 2020-09-22 00:00 (`recentre` → `gate_off`)

```
ENTRY   bar open 2020-08-02 03:00 UTC, both legs at that bar's close
  spot close  S_e = 407.41000000   ->  q_s = N/S_e = 0.0818176612 units
  perp close  P_e = 408.40000000   ->  q_p = N/P_e = 0.0816193275 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.242998%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (153 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2020-08-02 08:00  f = +0.094879%  perp open   380.390000  ++0.0294572501 USDT   F = 0.0294572501
  2020-08-02 16:00  f = +0.033067%  perp open   368.300000  ++0.0099400719 USDT   F = 0.0393973220
  2020-08-03 00:00  f = +0.029170%  perp open   372.860000  ++0.0088771843 USDT   F = 0.0482745063
  2020-08-03 08:00  f = +0.050577%  perp open   385.030000  ++0.0158942722 USDT   F = 0.0641687785
  ... 146 further settlements ...
  2020-09-21 08:00  f = +0.010000%  perp open   369.630000  ++0.0030168952 USDT   F = 1.4817832560
  2020-09-21 16:00  f = +0.005075%  perp open   339.850000  ++0.0014077202 USDT   F = 1.4831909762
  2020-09-22 00:00  f = -0.022757%  perp open   340.190000  +-0.0063187266 USDT   F = 1.4768722496
  TOTAL FUNDING F = 1.4768722496   (engine 1.4768722496, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.044306 = (0.5 + 0.044306 - 0.01)/1.01 = 52.901601%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +19.813908%  at 2020-09-01 22:00
    worst bar 2020-09-01 22:00  high/P_e - 1 = +19.813908%  -> no action
    worst bar 2020-09-01 15:00  high/P_e - 1 = +19.196866%  -> no action
    worst bar 2020-09-01 21:00  high/P_e - 1 = +18.949559%  -> no action
  buffer left at the worst bar = x_liq - x_max = +33.087693% of notional

EXIT    bar open 2020-09-22 00:00
  spot close  S_x = 342.51000000     perp close P_x = 342.35000000
  basis PAID  b_x = P_x/S_x - 1 = -0.046714%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = -5.3099662093   (engine -5.3099662093, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = +5.3909565785  (engine +5.3909565785, res 0.00e+00)
  hedge_pnl = +0.0809903692   [basis reading N*(b_e - b_x) = +0.0965708061; difference is the second-order quantity mismatch]
  funding   = +1.4768722496
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = +1.4311959521   (engine +1.4311959521, res 0.00e+00)   = +2.8624% of slot capital
  cost / carry = 0.086

DAILY MARKS (bar closing 00:00 UTC; 51 days shown first 3 and last 3)
  2020-08-02 23:00  S=  372.420000 P=  372.850000  unreal +0.03876713  F_to_date +0.03939732  equity 50.01483112
  2020-08-03 23:00  S=  385.940000 P=  386.200000  unreal +0.05532388  F_to_date +0.08168388  equity 50.07367443
  2020-08-04 23:00  S=  389.610000 P=  390.100000  unreal +0.03727932  F_to_date +0.13098661  equity 50.10493260
  2020-09-19 23:00  S=  385.250000 P=  384.960000  unreal +0.10007766  F_to_date +1.47298893  equity 51.50973326
  2020-09-20 23:00  S=  371.040000 P=  370.850000  unreal +0.08909741  F_to_date +1.47921465  equity 51.50497873
  2020-09-21 23:00  S=  340.360000 P=  340.190000  unreal +0.08138015  F_to_date +1.48319098  equity 51.50123779
```

### `ETHUSDT` 2020-11-18 04:00 → 2020-11-24 00:00 (`recentre` → `recentre`)

```
ENTRY   bar open 2020-11-18 04:00 UTC, both legs at that bar's close
  spot close  S_e = 493.39000000   ->  q_s = N/S_e = 0.0675598073 units
  perp close  P_e = 494.00000000   ->  q_p = N/P_e = 0.0674763833 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.123634%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (18 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2020-11-18 08:00  f = +0.037818%  perp open   477.330000  ++0.0121806113 USDT   F = 0.0121806113
  2020-11-18 16:00  f = +0.010000%  perp open   474.130000  ++0.0031992578 USDT   F = 0.0153798691
  2020-11-19 00:00  f = +0.010000%  perp open   478.600000  ++0.0032294197 USDT   F = 0.0186092888
  2020-11-19 08:00  f = +0.014096%  perp open   472.120000  ++0.0044905557 USDT   F = 0.0230998444
  ... 11 further settlements ...
  2020-11-23 08:00  f = +0.114125%  perp open   581.430000  ++0.0447744256 USDT   F = 0.3220586823
  2020-11-23 16:00  f = +0.085758%  perp open   590.830000  ++0.0341892032 USDT   F = 0.3562478855
  2020-11-24 00:00  f = +0.064276%  perp open   609.120000  ++0.0264182167 USDT   F = 0.3826661022
  TOTAL FUNDING F = 0.3826661022   (engine 0.3826661022, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.011480 = (0.5 + 0.011480 - 0.01)/1.01 = 49.651483%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +24.380567%  at 2020-11-24 00:00
    worst bar 2020-11-24 00:00  high/P_e - 1 = +24.380567%  -> RE-CENTRE
    worst bar 2020-11-23 22:00  high/P_e - 1 = +23.862348%  -> no action
    worst bar 2020-11-23 23:00  high/P_e - 1 = +23.684211%  -> no action
  buffer left at the worst bar = x_liq - x_max = +25.270917% of notional

EXIT    bar open 2020-11-24 00:00
  spot close  S_x = 611.23000000     perp close P_x = 612.50000000
  basis PAID  b_x = P_x/S_x - 1 = +0.207778%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +7.9612476945   (engine +7.9612476945, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -7.9959514170  (engine -7.9959514170, res 0.00e+00)
  hedge_pnl = -0.0347037225   [basis reading N*(b_e - b_x) = -0.0280477707; difference is the second-order quantity mismatch]
  funding   = +0.3826661022
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = +0.2212957131   (engine +0.2212957131, res 0.00e+00)   = +0.4426% of slot capital
  cost / carry = 0.331

DAILY MARKS (bar closing 00:00 UTC; 6 days shown in full)
  2020-11-18 23:00  S=  478.410000 P=  478.610000  unreal +0.02641562  F_to_date +0.01537987  equity 49.97846216
  2020-11-19 23:00  S=  471.250000 P=  471.380000  unreal +0.03054166  F_to_date +0.03561950  equity 50.00282782
  2020-11-20 23:00  S=  510.120000 P=  510.370000  unreal +0.02568718  F_to_date +0.09406377  equity 50.05641761
  2020-11-21 23:00  S=  552.350000 P=  554.100000  unreal -0.07200439  F_to_date +0.12956200  equity 49.99422427
  2020-11-22 23:00  S=  560.030000 P=  560.420000  unreal +0.02040418  F_to_date +0.21746673  equity 50.17453758
  2020-11-23 23:00  S=  608.580000 P=  609.120000  unreal +0.01433296  F_to_date +0.35624789  equity 50.30724752
```

### `BTCUSDT` 2020-12-27 11:00 → 2021-01-03 07:00 (`recentre` → `recentre`)

```
ENTRY   bar open 2020-12-27 11:00 UTC, both legs at that bar's close
  spot close  S_e = 27646.48000000   ->  q_s = N/S_e = 0.0012056990 units
  perp close  P_e = 27679.15000000   ->  q_p = N/P_e = 0.0012042759 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.118171%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (20 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2020-12-27 16:00  f = +0.071164%  perp open 27399.500000  ++0.0234816702 USDT   F = 0.0234816702
  2020-12-28 00:00  f = +0.043463%  perp open 26301.760000  ++0.0137667209 USDT   F = 0.0372483911
  2020-12-28 08:00  f = +0.036133%  perp open 27028.860000  ++0.0117613655 USDT   F = 0.0490097566
  2020-12-28 16:00  f = +0.071278%  perp open 26944.250000  ++0.0231285071 USDT   F = 0.0721382637
  ... 13 further settlements ...
  2021-01-02 08:00  f = +0.020151%  perp open 29778.770000  ++0.0072265224 USDT   F = 0.2692010472
  2021-01-02 16:00  f = +0.115471%  perp open 31720.790000  ++0.0441105952 USDT   F = 0.3133116424
  2021-01-03 00:00  f = +0.124058%  perp open 32198.410000  ++0.0481044438 USDT   F = 0.3614160862
  TOTAL FUNDING F = 0.3614160862   (engine 0.3614160862, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.010842 = (0.5 + 0.010842 - 0.01)/1.01 = 49.588365%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +25.842918%  at 2021-01-03 07:00
    worst bar 2021-01-03 07:00  high/P_e - 1 = +25.842918%  -> RE-CENTRE
    worst bar 2021-01-03 05:00  high/P_e - 1 = +23.630964%  -> no action
    worst bar 2021-01-03 06:00  high/P_e - 1 = +23.491003%  -> no action
  buffer left at the worst bar = x_liq - x_max = +23.745447% of notional

EXIT    bar open 2021-01-03 07:00
  spot close  S_x = 34452.34000000     perp close P_x = 34472.24000000
  basis PAID  b_x = P_x/S_x - 1 = +0.057761%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +8.2058186069   (engine +8.2058186069, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -8.1807545872  (engine -8.1807545872, res 0.00e+00)
  hedge_pnl = +0.0250640197   [basis reading N*(b_e - b_x) = +0.0201365353; difference is the second-order quantity mismatch]
  funding   = +0.3614160862
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = +0.2598134392   (engine +0.2598134392, res 0.00e+00)   = +0.5196% of slot capital
  cost / carry = 0.350

DAILY MARKS (bar closing 00:00 UTC; 7 days shown first 3 and last 3)
  2020-12-27 23:00  S=26281.660000 P=26305.640000  unreal +0.00852288  F_to_date +0.02348167  equity 49.96867122
  2020-12-28 23:00  S=27079.410000 P=27102.660000  unreal +0.01053728  F_to_date +0.07213826  equity 50.01934221
  2020-12-29 23:00  S=27385.000000 P=27402.830000  unreal +0.01749934  F_to_date +0.11283430  equity 50.06700031
  2020-12-31 23:00  S=28923.630000 P=28951.680000  unreal +0.00738127  F_to_date +0.22915645  equity 50.17320439
  2021-01-01 23:00  S=29331.690000 P=29337.160000  unreal +0.03515453  F_to_date +0.25844152  equity 50.23026272
  2021-01-02 23:00  S=32178.330000 P=32199.910000  unreal +0.01980469  F_to_date +0.31331164  equity 50.26978300
```

### `ETHUSDT` 2021-01-04 06:00 → 2021-01-19 07:00 (`recentre` → `recentre`)

```
ENTRY   bar open 2021-01-04 06:00 UTC, both legs at that bar's close
  spot close  S_e = 1105.00000000   ->  q_s = N/S_e = 0.0301659125 units
  perp close  P_e = 1114.90000000   ->  q_p = N/P_e = 0.0298980477 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.895928%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (45 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-01-04 08:00  f = +0.375000%  perp open  1052.050000  ++0.1179534039 USDT   F = 0.1179534039
  2021-01-04 16:00  f = +0.085432%  perp open  1041.090000  ++0.0265920414 USDT   F = 0.1445454453
  2021-01-05 00:00  f = +0.102541%  perp open  1043.120000  ++0.0319797195 USDT   F = 0.1765251648
  2021-01-05 08:00  f = +0.043050%  perp open  1004.370000  ++0.0129273563 USDT   F = 0.1894525211
  ... 38 further settlements ...
  2021-01-18 08:00  f = +0.028606%  perp open  1220.700000  ++0.0104402022 USDT   F = 1.6152590104
  2021-01-18 16:00  f = +0.109269%  perp open  1241.960000  ++0.0405739610 USDT   F = 1.6558329713
  2021-01-19 00:00  f = +0.121462%  perp open  1263.000000  ++0.0458655503 USDT   F = 1.7016985216
  TOTAL FUNDING F = 1.7016985216   (engine 1.7016985216, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.051051 = (0.5 + 0.051051 - 0.01)/1.01 = 53.569402%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +24.890125%  at 2021-01-19 07:00
    worst bar 2021-01-19 07:00  high/P_e - 1 = +24.890125%  -> RE-CENTRE
    worst bar 2021-01-10 08:00  high/P_e - 1 = +21.505068%  -> no action
    worst bar 2021-01-10 09:00  high/P_e - 1 = +21.235088%  -> no action
  buffer left at the worst bar = x_liq - x_max = +28.679277% of notional

EXIT    bar open 2021-01-19 07:00
  spot close  S_x = 1375.00000000     perp close P_x = 1382.70000000
  basis PAID  b_x = P_x/S_x - 1 = +0.560000%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +8.1447963801   (engine +8.1447963801, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -8.0066971627  (engine -8.0066971627, res 0.00e+00)
  hedge_pnl = +0.1380992174   [basis reading N*(b_e - b_x) = +0.1119758673; difference is the second-order quantity mismatch]
  funding   = +1.7016985216
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = +1.7131310724   (engine +1.7131310724, res 0.00e+00)   = +3.4263% of slot capital
  cost / carry = 0.074

DAILY MARKS (bar closing 00:00 UTC; 15 days shown first 3 and last 3)
  2021-01-04 23:00  S= 1041.430000 P= 1043.110000  unreal +0.22873378  F_to_date +0.14454545  equity 50.30994589
  2021-01-05 23:00  S= 1099.560000 P= 1101.290000  unreal +0.24280986  F_to_date +0.22184247  equity 50.40131900
  2021-01-06 23:00  S= 1208.420000 P= 1212.640000  unreal +0.19752349  F_to_date +0.44210963  equity 50.57629979
  2021-01-16 23:00  S= 1227.830000 P= 1230.190000  unreal +0.25833312  F_to_date +1.48872322  equity 51.68372301
  2021-01-17 23:00  S= 1232.450000 P= 1233.710000  unreal +0.29245851  F_to_date +1.56458661  equity 51.79371178
  2021-01-18 23:00  S= 1258.450000 P= 1262.990000  unreal +0.20135740  F_to_date +1.65583297  equity 51.79385704
```

### `BTCUSDT` 2021-02-19 16:00 → 2021-05-21 00:00 (`recentre` → `gate_off`)

```
ENTRY   bar open 2021-02-19 16:00 UTC, both legs at that bar's close
  spot close  S_e = 54368.65000000   ->  q_s = N/S_e = 0.0006130984 units
  perp close  P_e = 54461.78000000   ->  q_p = N/P_e = 0.0006120500 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.171294%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (271 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-02-20 00:00  f = +0.156318%  perp open 56005.850000  ++0.0535832802 USDT   F = 0.0535832802
  2021-02-20 08:00  f = +0.116465%  perp open 55312.050000  ++0.0394277596 USDT   F = 0.0930110398
  2021-02-20 16:00  f = +0.122535%  perp open 56231.960000  ++0.0421725916 USDT   F = 0.1351836314
  2021-02-21 00:00  f = +0.100357%  perp open 55908.450000  ++0.0343409287 USDT   F = 0.1695245602
  ... 264 further settlements ...
  2021-05-20 08:00  f = +0.010000%  perp open 39946.920000  ++0.0024449513 USDT   F = 3.9079622353
  2021-05-20 16:00  f = +0.010000%  perp open 41445.800000  ++0.0025366903 USDT   F = 3.9104989255
  2021-05-21 00:00  f = +0.010000%  perp open 40500.000000  ++0.0024788026 USDT   F = 3.9129777281
  TOTAL FUNDING F = 3.9129777281   (engine 3.9129777281, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.117389 = (0.5 + 0.117389 - 0.01)/1.01 = 60.137558%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +19.324249%  at 2021-04-14 06:00
    worst bar 2021-04-14 06:00  high/P_e - 1 = +19.324249%  -> no action
    worst bar 2021-04-14 11:00  high/P_e - 1 = +19.172950%  -> no action
    worst bar 2021-04-14 12:00  high/P_e - 1 = +18.910197%  -> no action
  buffer left at the worst bar = x_liq - x_max = +40.813309% of notional

EXIT    bar open 2021-05-21 00:00
  spot close  S_x = 41725.59000000     perp close P_x = 41713.51000000
  basis PAID  b_x = P_x/S_x - 1 = -0.028951%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = -7.7514400915   (engine -7.7514400915, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = +7.8025788605  (engine +7.8025788605, res 0.00e+00)
  hedge_pnl = +0.0511387690   [basis reading N*(b_e - b_x) = +0.0667482086; difference is the second-order quantity mismatch]
  funding   = +3.9129777281
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = +3.8374498304   (engine +3.8374498304, res 0.00e+00)   = +7.6749% of slot capital
  cost / carry = 0.032

DAILY MARKS (bar closing 00:00 UTC; 91 days shown first 3 and last 3)
  2021-02-19 23:00  S=55906.000000 P=56004.100000  unreal -0.00143013  F_to_date +0.00000000  equity 49.93523654
  2021-02-20 23:00  S=55841.190000 P=55917.410000  unreal +0.01189358  F_to_date +0.13518363  equity 50.08374388
  2021-02-21 23:00  S=57408.570000 P=57487.430000  unreal +0.01192101  F_to_date +0.24777748  equity 50.19636516
  2021-05-18 23:00  S=42849.780000 P=42882.530000  unreal +0.02487917  F_to_date +3.91227828  equity 53.87382412
  2021-05-19 23:00  S=36690.090000 P=36689.140000  unreal +0.03904742  F_to_date +3.90327173  equity 53.87898581
  2021-05-20 23:00  S=40526.640000 P=40500.300000  unreal +0.05860962  F_to_date +3.91049893  equity 53.90577521
```

### `ETHUSDT` 2021-05-10 05:00 → 2021-05-19 16:00 (`recentre` → `gate_off`)

```
ENTRY   bar open 2021-05-10 05:00 UTC, both legs at that bar's close
  spot close  S_e = 4127.82000000   ->  q_s = N/S_e = 0.0080752875 units
  perp close  P_e = 4132.65000000   ->  q_p = N/P_e = 0.0080658496 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.117011%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (29 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-05-10 08:00  f = +0.066380%  perp open  4109.170000  ++0.0220009521 USDT   F = 0.0220009521
  2021-05-10 16:00  f = +0.075749%  perp open  4160.280000  ++0.0254184805 USDT   F = 0.0474194326
  2021-05-11 00:00  f = +0.041169%  perp open  3950.320000  ++0.0131175496 USDT   F = 0.0605369822
  2021-05-11 08:00  f = +0.043204%  perp open  3962.850000  ++0.0138096194 USDT   F = 0.0743466016
  ... 22 further settlements ...
  2021-05-19 00:00  f = +0.010000%  perp open  3377.030000  ++0.0027238616 USDT   F = 0.2740240825
  2021-05-19 08:00  f = +0.053311%  perp open  2985.290000  ++0.0128367025 USDT   F = 0.2868607850
  2021-05-19 16:00  f = -0.356332%  perp open  2750.430000  +-0.0790506675 USDT   F = 0.2078101175
  TOTAL FUNDING F = 0.2078101175   (engine 0.2078101175, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.006234 = (0.5 + 0.006234 - 0.01)/1.01 = 49.132109%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +5.965422%  at 2021-05-12 14:00
    worst bar 2021-05-12 14:00  high/P_e - 1 = +5.965422%  -> no action
    worst bar 2021-05-12 06:00  high/P_e - 1 = +5.864276%  -> no action
    worst bar 2021-05-12 03:00  high/P_e - 1 = +5.497683%  -> no action
  buffer left at the worst bar = x_liq - x_max = +43.166688% of notional

EXIT    bar open 2021-05-19 16:00
  spot close  S_x = 2852.60000000     perp close P_x = 2856.12000000
  basis PAID  b_x = P_x/S_x - 1 = +0.123396%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = -10.2977681520   (engine -10.2977681520, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = +10.2962989849  (engine +10.2962989849, res 0.00e+00)
  hedge_pnl = -0.0014691671   [basis reading N*(b_e - b_x) = -0.0021284279; difference is the second-order quantity mismatch]
  funding   = +0.2078101175
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = +0.0796742837   (engine +0.0796742837, res 0.00e+00)   = +0.1593% of slot capital
  cost / carry = 0.610

DAILY MARKS (bar closing 00:00 UTC; 9 days shown first 3 and last 3)
  2021-05-10 23:00  S= 3945.880000 P= 3950.330000  unreal +0.00134789  F_to_date +0.04741943  equity 49.98543399
  2021-05-11 23:00  S= 4173.450000 P= 4175.910000  unreal +0.01954672  F_to_date +0.08397075  equity 50.04018413
  2021-05-12 23:00  S= 3823.210000 P= 3828.990000  unreal -0.01053744  F_to_date +0.12225166  equity 50.04838088
  2021-05-16 23:00  S= 3582.100000 P= 3581.390000  unreal +0.03953434  F_to_date +0.21438147  equity 50.19058248
  2021-05-17 23:00  S= 3282.510000 P= 3283.580000  unreal +0.02234962  F_to_date +0.24698602  equity 50.20600231
  2021-05-18 23:00  S= 3375.070000 P= 3376.350000  unreal +0.02152937  F_to_date +0.27130022  equity 50.22949626
```

### `ETHUSDT` 2021-10-15 08:00 → 2021-11-08 00:00 (`gate_on` → `recentre`)

```
ENTRY   bar open 2021-10-15 08:00 UTC, both legs at that bar's close
  spot close  S_e = 3764.98000000   ->  q_s = N/S_e = 0.0088535220 units
  perp close  P_e = 3769.03000000   ->  q_p = N/P_e = 0.0088440085 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.107570%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0633333333
  margin posted M = N/2 = 16.666667; slot capital = N*1.5 = 50.0000

SETTLEMENT LEDGER  (71 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-10-15 16:00  f = +0.023043%  perp open  3793.590000  ++0.0077310514 USDT   F = 0.0077310514
  2021-10-16 00:00  f = +0.031365%  perp open  3872.700000  ++0.0107425726 USDT   F = 0.0184736241
  2021-10-16 08:00  f = +0.024049%  perp open  3857.170000  ++0.0082037979 USDT   F = 0.0266774220
  2021-10-16 16:00  f = +0.052591%  perp open  3911.380000  ++0.0181924249 USDT   F = 0.0448698469
  ... 64 further settlements ...
  2021-11-07 08:00  f = +0.018519%  perp open  4544.830000  ++0.0074436223 USDT   F = 0.8099153935
  2021-11-07 16:00  f = +0.032259%  perp open  4607.850000  ++0.0131461440 USDT   F = 0.8230615375
  2021-11-08 00:00  f = +0.021005%  perp open  4616.510000  ++0.0085760167 USDT   F = 0.8316375542
  TOTAL FUNDING F = 0.8316375542   (engine 0.8316375542, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.024949 = (0.5 + 0.024949 - 0.01)/1.01 = 50.985062%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +24.939308%  at 2021-11-08 00:00
    worst bar 2021-11-08 00:00  high/P_e - 1 = +24.939308%  -> RE-CENTRE
    worst bar 2021-11-03 19:00  high/P_e - 1 = +24.063751%  -> no action
    worst bar 2021-11-03 18:00  high/P_e - 1 = +23.815942%  -> no action
  buffer left at the worst bar = x_liq - x_max = +26.045754% of notional

EXIT    bar open 2021-11-08 00:00
  spot close  S_x = 4688.29000000     perp close P_x = 4696.19000000
  basis PAID  b_x = P_x/S_x - 1 = +0.168505%
  exit cost = 0.0633333333

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +8.1745454159   (engine +8.1745454159, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -8.1998109151  (engine -8.1998109151, res 0.00e+00)
  hedge_pnl = -0.0252654992   [basis reading N*(b_e - b_x) = -0.0203115474; difference is the second-order quantity mismatch]
  funding   = +0.8316375542
  fees+slip = 0.1266666667  (engine 0.1266666667, res 0.00e+00)
  NET       = +0.6797053883   (engine +0.6797053883, res 0.00e+00)   = +1.3594% of slot capital
  cost / carry = 0.152

DAILY MARKS (bar closing 00:00 UTC; 24 days shown first 3 and last 3)
  2021-10-15 23:00  S= 3868.990000 P= 3872.710000  unreal +0.00390802  F_to_date +0.00773105  equity 49.94830574
  2021-10-16 23:00  S= 3829.960000 P= 3833.300000  unreal +0.00689743  F_to_date +0.04486985  equity 49.98843395
  2021-10-17 23:00  S= 3846.850000 P= 3851.010000  unreal -0.00019397  F_to_date +0.08703631  equity 50.02350901
  2021-11-05 23:00  S= 4474.240000 P= 4477.290000  unreal +0.01559157  F_to_date +0.75630666  equity 50.70856490
  2021-11-06 23:00  S= 4518.000000 P= 4521.400000  unreal +0.01291248  F_to_date +0.79320770  equity 50.74278685
  2021-11-07 23:00  S= 4612.590000 P= 4616.500000  unreal +0.00930192  F_to_date +0.82306154  equity 50.76903012
```

## Tier `alts` — 166 closed fit positions, stride 16, `C_slot = 16.6667`, `N = C_slot/1.5 = 11.111111`

### `XRPUSDT` 2020-09-17 00:00 → 2020-11-20 16:00 (`gate_on` → `recentre`)

```
ENTRY   bar open 2020-09-17 00:00 UTC, both legs at that bar's close
  spot close  S_e = 0.25655000   ->  q_s = N/S_e = 43.3097295307 units
  perp close  P_e = 0.25640000   ->  q_p = N/P_e = 43.3350667360 units
  basis RECEIVED  b_e = P_e/S_e - 1 = -0.058468%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (194 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2020-09-17 08:00  f = +0.010000%  perp open     0.251100  ++0.0010881435 USDT   F = 0.0010881435
  2020-09-17 16:00  f = +0.010000%  perp open     0.250100  ++0.0010838100 USDT   F = 0.0021719535
  2020-09-18 00:00  f = +0.010000%  perp open     0.252300  ++0.0010933437 USDT   F = 0.0032652973
  2020-09-18 08:00  f = +0.010000%  perp open     0.254300  ++0.0011020107 USDT   F = 0.0043673080
  ... 187 further settlements ...
  2020-11-20 00:00  f = +0.039389%  perp open     0.304000  ++0.0051890518 USDT   F = 0.2860002801
  2020-11-20 08:00  f = +0.036253%  perp open     0.301000  ++0.0047287888 USDT   F = 0.2907290689
  2020-11-20 16:00  f = +0.103588%  perp open     0.313900  ++0.0140909487 USDT   F = 0.3048200176
  TOTAL FUNDING F = 0.3048200176   (engine 0.3048200176, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.027434 = (0.5 + 0.027434 - 0.01)/1.01 = 51.231069%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +25.234009%  at 2020-11-20 16:00
    worst bar 2020-11-20 16:00  high/P_e - 1 = +25.234009%  -> RE-CENTRE
    worst bar 2020-11-20 14:00  high/P_e - 1 = +23.829953%  -> no action
    worst bar 2020-11-20 13:00  high/P_e - 1 = +23.712949%  -> no action
  buffer left at the worst bar = x_liq - x_max = +25.997060% of notional

EXIT    bar open 2020-11-20 16:00
  spot close  S_x = 0.31956000     perp close P_x = 0.32060000
  basis PAID  b_x = P_x/S_x - 1 = +0.325447%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +2.7289460577   (engine +2.7289460577, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -2.7821112845  (engine -2.7821112845, res 0.00e+00)
  hedge_pnl = -0.0531652267   [basis reading N*(b_e - b_x) = -0.0426572917; difference is the second-order quantity mismatch]
  funding   = +0.3048200176
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = +0.2094325686   (engine +0.2094325686, res 0.00e+00)   = +1.2566% of slot capital
  cost / carry = 0.139

DAILY MARKS (bar closing 00:00 UTC; 64 days shown first 3 and last 3)
  2020-09-17 23:00  S=    0.252140 P=    0.252200  unreal -0.00898863  F_to_date +0.00217195  equity 16.63873888
  2020-09-18 23:00  S=    0.250650 P=    0.250800  unreal -0.01285103  F_to_date +0.00544808  equity 16.63815261
  2020-09-19 23:00  S=    0.251120 P=    0.251100  unreal -0.00549598  F_to_date +0.00870125  equity 16.64876083
  2020-11-17 23:00  S=    0.302470 P=    0.303000  unreal -0.03063133  F_to_date +0.26160629  equity 16.87653052
  2020-11-18 23:00  S=    0.293350 P=    0.293400  unreal -0.00959942  F_to_date +0.27548825  equity 16.91144438
  2020-11-19 23:00  S=    0.303580 P=    0.304000  unreal -0.02589260  F_to_date +0.28081123  equity 16.90047419
```

### `XRPUSDT` 2020-11-24 04:00 → 2020-12-09 16:00 (`recentre` → `gate_off`)

```
ENTRY   bar open 2020-11-24 04:00 UTC, both legs at that bar's close
  spot close  S_e = 0.68505000   ->  q_s = N/S_e = 16.2194162632 units
  perp close  P_e = 0.68440000   ->  q_p = N/P_e = 16.2348204429 units
  basis RECEIVED  b_e = P_e/S_e - 1 = -0.094884%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (47 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2020-11-24 08:00  f = +0.102290%  perp open     0.698500  ++0.0115997086 USDT   F = 0.0115997086
  2020-11-24 16:00  f = +0.070342%  perp open     0.673200  ++0.0076878749 USDT   F = 0.0192875835
  2020-11-25 00:00  f = +0.064145%  perp open     0.695400  ++0.0072417743 USDT   F = 0.0265293578
  2020-11-25 08:00  f = +0.047907%  perp open     0.681100  ++0.0052973339 USDT   F = 0.0318266917
  ... 40 further settlements ...
  2020-12-09 00:00  f = +0.001985%  perp open     0.558600  ++0.0001800151 USDT   F = 0.1526268097
  2020-12-09 08:00  f = +0.010000%  perp open     0.527100  ++0.0008557374 USDT   F = 0.1534825471
  2020-12-09 16:00  f = -0.066076%  perp open     0.550000  +-0.0059000260 USDT   F = 0.1475825211
  TOTAL FUNDING F = 0.1475825211   (engine 0.1475825211, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.013282 = (0.5 + 0.013282 - 0.01)/1.01 = 49.829943%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +14.538282%  at 2020-11-24 05:00
    worst bar 2020-11-24 05:00  high/P_e - 1 = +14.538282%  -> no action
    worst bar 2020-11-24 19:00  high/P_e - 1 = +9.731151%  -> no action
    worst bar 2020-11-24 06:00  high/P_e - 1 = +9.555815%  -> no action
  buffer left at the worst bar = x_liq - x_max = +35.291662% of notional

EXIT    bar open 2020-12-09 16:00
  spot close  S_x = 0.55339000     perp close P_x = 0.55310000
  basis PAID  b_x = P_x/S_x - 1 = -0.052404%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = -2.1354483452   (engine -2.1354483452, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = +2.1316319242  (engine +2.1316319242, res 0.00e+00)
  hedge_pnl = -0.0038164211   [basis reading N*(b_e - b_x) = -0.0047199237; difference is the second-order quantity mismatch]
  funding   = +0.1475825211
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = +0.1015438778   (engine +0.1015438778, res 0.00e+00)   = +0.6093% of slot capital
  cost / carry = 0.286

DAILY MARKS (bar closing 00:00 UTC; 15 days shown first 3 and last 3)
  2020-11-24 23:00  S=    0.694000 P=    0.695100  unreal -0.02854880  F_to_date +0.01928758  equity 16.63629434
  2020-11-25 23:00  S=    0.630220 P=    0.631400  unreal -0.02886511  F_to_date +0.05245918  equity 16.66914963
  2020-11-26 23:00  S=    0.536540 P=    0.537000  unreal -0.01573298  F_to_date +0.05470503  equity 16.68452761
  2020-12-06 23:00  S=    0.621070 P=    0.621600  unreal -0.01817153  F_to_date +0.14319158  equity 16.77057561
  2020-12-07 23:00  S=    0.608180 P=    0.608500  unreal -0.01456366  F_to_date +0.14952988  equity 16.78052178
  2020-12-08 23:00  S=    0.558900 P=    0.558700  unreal -0.00536243  F_to_date +0.15244679  equity 16.79263992
```

### `BNBUSDT` 2021-01-04 06:00 → 2021-01-13 08:00 (`recentre` → `gate_off`)

```
ENTRY   bar open 2021-01-04 06:00 UTC, both legs at that bar's close
  spot close  S_e = 42.02660000   ->  q_s = N/S_e = 0.2643828221 units
  perp close  P_e = 42.26400000   ->  q_p = N/P_e = 0.2628977643 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.564880%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (28 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-01-04 08:00  f = +0.343153%  perp open    40.925000  ++0.0369201436 USDT   F = 0.0369201436
  2021-01-04 16:00  f = +0.112134%  perp open    39.940000  ++0.0117742233 USDT   F = 0.0486943669
  2021-01-05 00:00  f = +0.089558%  perp open    41.126000  ++0.0096829514 USDT   F = 0.0583773182
  2021-01-05 08:00  f = +0.039534%  perp open    39.683000  ++0.0041244130 USDT   F = 0.0625017312
  ... 21 further settlements ...
  2021-01-12 16:00  f = +0.000000%  perp open    38.326000  ++0.0000000000 USDT   F = 0.2584087704
  2021-01-13 00:00  f = +0.000000%  perp open    38.274000  ++0.0000000000 USDT   F = 0.2584087704
  2021-01-13 08:00  f = +0.015524%  perp open    38.364000  ++0.0015657211 USDT   F = 0.2599744915
  TOTAL FUNDING F = 0.2599744915   (engine 0.2599744915, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.023398 = (0.5 + 0.023398 - 0.01)/1.01 = 50.831456%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +6.946811%  at 2021-01-10 00:00
    worst bar 2021-01-10 00:00  high/P_e - 1 = +6.946811%  -> no action
    worst bar 2021-01-10 01:00  high/P_e - 1 = +6.414443%  -> no action
    worst bar 2021-01-07 16:00  high/P_e - 1 = +6.303237%  -> no action
  buffer left at the worst bar = x_liq - x_max = +43.884645% of notional

EXIT    bar open 2021-01-13 08:00
  spot close  S_x = 38.13950000     perp close P_x = 38.24800000
  basis PAID  b_x = P_x/S_x - 1 = +0.284482%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = -1.0276824678   (engine -1.0276824678, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = +1.0557974215  (engine +1.0557974215, res 0.00e+00)
  hedge_pnl = +0.0281149537   [basis reading N*(b_e - b_x) = +0.0311553745; difference is the second-order quantity mismatch]
  funding   = +0.2599744915
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = +0.2458672230   (engine +0.2458672230, res 0.00e+00)   = +1.4752% of slot capital
  cost / carry = 0.162

DAILY MARKS (bar closing 00:00 UTC; 9 days shown first 3 and last 3)
  2021-01-04 23:00  S=   41.133300 P=   41.142000  unreal +0.05879812  F_to_date +0.04869437  equity 16.75304804
  2021-01-05 23:00  S=   41.821900 P=   41.799000  unreal +0.06812830  F_to_date +0.07185539  equity 16.78553924
  2021-01-06 23:00  S=   42.241700 P=   42.288000  unreal +0.05055920  F_to_date +0.14402248  equity 16.84013723
  2021-01-10 23:00  S=   42.403100 P=   42.399000  unreal +0.06404893  F_to_date +0.25840877  equity 16.96801326
  2021-01-11 23:00  S=   38.167400 P=   38.104000  unreal +0.07334851  F_to_date +0.25840877  equity 16.97731284
  2021-01-12 23:00  S=   38.254100 P=   38.275000  unreal +0.05131499  F_to_date +0.25840877  equity 16.95527931
```

### `XRPUSDT` 2021-01-30 16:00 → 2021-02-01 03:00 (`recentre` → `recentre`)

```
ENTRY   bar open 2021-01-30 16:00 UTC, both legs at that bar's close
  spot close  S_e = 0.41972000   ->  q_s = N/S_e = 26.4726749050 units
  perp close  P_e = 0.42180000   ->  q_p = N/P_e = 26.3421316053 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.495568%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (4 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-01-31 00:00  f = +0.123441%  perp open     0.444800  ++0.0144635575 USDT   F = 0.0144635575
  2021-01-31 08:00  f = +0.119868%  perp open     0.443000  ++0.0139880733 USDT   F = 0.0284516308
  2021-01-31 16:00  f = +0.109098%  perp open     0.478200  ++0.0137428649 USDT   F = 0.0421944957
  2021-02-01 00:00  f = +0.128729%  perp open     0.495900  ++0.0168159505 USDT   F = 0.0590104461
  TOTAL FUNDING F = 0.0590104461   (engine 0.0590104461, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.005311 = (0.5 + 0.005311 - 0.01)/1.01 = 49.040687%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +38.691323%  at 2021-02-01 03:00
    worst bar 2021-02-01 03:00  high/P_e - 1 = +38.691323%  -> RE-CENTRE
    worst bar 2021-01-31 10:00  high/P_e - 1 = +21.953532%  -> no action
    worst bar 2021-01-31 13:00  high/P_e - 1 = +21.811285%  -> no action
  buffer left at the worst bar = x_liq - x_max = +10.349364% of notional

EXIT    bar open 2021-02-01 03:00
  spot close  S_x = 0.55450000     perp close P_x = 0.55860000
  basis PAID  b_x = P_x/S_x - 1 = +0.739405%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +3.5679871237   (engine +3.5679871237, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -3.6036036036  (engine -3.6036036036, res 0.00e+00)
  hedge_pnl = -0.0356164799   [basis reading N*(b_e - b_x) = -0.0270929328; difference is the second-order quantity mismatch]
  funding   = +0.0590104461
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = -0.0188282560   (engine -0.0188282560, res 0.00e+00)   = -0.1130% of slot capital
  cost / carry = 0.716

DAILY MARKS (bar closing 00:00 UTC; 2 days shown in full)
  2021-01-30 23:00  S=    0.443720 P=    0.444500  unreal +0.03737781  F_to_date +0.00000000  equity 16.68293337
  2021-01-31 23:00  S=    0.495070 P=    0.495900  unreal +0.04276410  F_to_date +0.04219450  equity 16.73051415
```

### `SOLUSDT` 2021-02-10 20:00 → 2021-02-19 13:00 (`recentre` → `recentre`)

```
ENTRY   bar open 2021-02-10 20:00 UTC, both legs at that bar's close
  spot close  S_e = 8.77620000   ->  q_s = N/S_e = 1.2660503534 units
  perp close  P_e = 8.79650000   ->  q_p = N/P_e = 1.2631286433 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.231307%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (26 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-02-11 00:00  f = +0.162680%  perp open     9.109800  ++0.0187193425 USDT   F = 0.0187193425
  2021-02-11 08:00  f = +0.151791%  perp open     9.442400  ++0.0181040608 USDT   F = 0.0368234033
  2021-02-11 16:00  f = +0.128569%  perp open     9.297300  ++0.0150987396 USDT   F = 0.0519221428
  2021-02-12 00:00  f = +0.211126%  perp open     9.219700  ++0.0245870312 USDT   F = 0.0765091741
  ... 19 further settlements ...
  2021-02-18 16:00  f = +0.083108%  perp open     9.246100  ++0.0097061947 USDT   F = 0.3556973309
  2021-02-19 00:00  f = +0.094704%  perp open     8.997600  ++0.0107632292 USDT   F = 0.3664605601
  2021-02-19 08:00  f = +0.094971%  perp open     9.520900  ++0.0114213279 USDT   F = 0.3778818880
  TOTAL FUNDING F = 0.3778818880   (engine 0.3778818880, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.034009 = (0.5 + 0.034009 - 0.01)/1.01 = 51.882116%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +27.707611%  at 2021-02-19 13:00
    worst bar 2021-02-19 13:00  high/P_e - 1 = +27.707611%  -> RE-CENTRE
    worst bar 2021-02-19 12:00  high/P_e - 1 = +23.249019%  -> no action
    worst bar 2021-02-12 13:00  high/P_e - 1 = +12.974478%  -> no action
  buffer left at the worst bar = x_liq - x_max = +24.174505% of notional

EXIT    bar open 2021-02-19 13:00
  spot close  S_x = 11.15250000     perp close P_x = 11.13020000
  basis PAID  b_x = P_x/S_x - 1 = -0.199955%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +3.0085154547   (engine +3.0085154547, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -2.9477633150  (engine -2.9477633150, res 0.00e+00)
  hedge_pnl = +0.0607521397   [basis reading N*(b_e - b_x) = +0.0479180630; difference is the second-order quantity mismatch]
  funding   = +0.3778818880
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = +0.3964118055   (engine +0.3964118055, res 0.00e+00)   = +2.3785% of slot capital
  cost / carry = 0.112

DAILY MARKS (bar closing 00:00 UTC; 9 days shown first 3 and last 3)
  2021-02-10 23:00  S=    9.090000 P=    9.110200  unreal +0.00104315  F_to_date +0.00000000  equity 16.64659870
  2021-02-11 23:00  S=    9.200400 P=    9.221500  unreal +0.00022889  F_to_date +0.05192214  equity 16.69770658
  2021-02-12 23:00  S=    9.200000 P=    9.234400  unreal -0.01657189  F_to_date +0.09613317  equity 16.72511683
  2021-02-16 23:00  S=    8.300200 P=    8.303600  unreal +0.01995614  F_to_date +0.29238234  equity 16.95789404
  2021-02-17 23:00  S=    8.235700 P=    8.253300  unreal +0.00183126  F_to_date +0.31832512  equity 16.96571194
  2021-02-18 23:00  S=    8.977100 P=    8.995600  unreal +0.00286060  F_to_date +0.35569733  equity 17.00411349
```

### `BNBUSDT` 2021-03-30 08:00 → 2021-04-05 11:00 (`gate_on` → `recentre`)

```
ENTRY   bar open 2021-03-30 08:00 UTC, both legs at that bar's close
  spot close  S_e = 293.53160000   ->  q_s = N/S_e = 0.0378532026 units
  perp close  P_e = 294.13600000   ->  q_p = N/P_e = 0.0377754206 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.205906%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (18 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-03-30 16:00  f = +0.098543%  perp open   297.086000  ++0.0110590361 USDT   F = 0.0110590361
  2021-03-31 00:00  f = +0.053492%  perp open   312.322000  ++0.0063110369 USDT   F = 0.0173700730
  2021-03-31 08:00  f = +0.079309%  perp open   302.588000  ++0.0090653272 USDT   F = 0.0264354002
  2021-03-31 16:00  f = +0.039337%  perp open   306.956000  ++0.0045612794 USDT   F = 0.0309966795
  ... 11 further settlements ...
  2021-04-04 16:00  f = +0.041287%  perp open   344.471000  ++0.0053724861 USDT   F = 0.1445322622
  2021-04-05 00:00  f = +0.015106%  perp open   349.277000  ++0.0019930986 USDT   F = 0.1465253607
  2021-04-05 08:00  f = +0.002577%  perp open   340.594000  ++0.0003315589 USDT   F = 0.1468569197
  TOTAL FUNDING F = 0.1468569197   (engine 0.1468569197, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.013217 = (0.5 + 0.013217 - 0.01)/1.01 = 49.823478%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +25.451492%  at 2021-04-05 11:00
    worst bar 2021-04-05 11:00  high/P_e - 1 = +25.451492%  -> RE-CENTRE
    worst bar 2021-04-05 10:00  high/P_e - 1 = +23.458536%  -> no action
    worst bar 2021-04-02 01:00  high/P_e - 1 = +21.854516%  -> no action
  buffer left at the worst bar = x_liq - x_max = +24.371986% of notional

EXIT    bar open 2021-04-05 11:00
  spot close  S_x = 363.20630000     perp close P_x = 364.67700000
  basis PAID  b_x = P_x/S_x - 1 = +0.404921%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +2.6374105321   (engine +2.6374105321, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -2.6647159439  (engine -2.6647159439, res 0.00e+00)
  hedge_pnl = -0.0273054119   [basis reading N*(b_e - b_x) = -0.0221127900; difference is the second-order quantity mismatch]
  funding   = +0.1468569197
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = +0.0773292856   (engine +0.0773292856, res 0.00e+00)   = +0.4640% of slot capital
  cost / carry = 0.288

DAILY MARKS (bar closing 00:00 UTC; 6 days shown in full)
  2021-03-30 23:00  S=  311.296200 P=  312.347000  unreal -0.01548118  F_to_date +0.01105904  equity 16.64113341
  2021-03-31 23:00  S=  302.372400 P=  302.700000  unreal +0.01114389  F_to_date +0.03099668  equity 16.68769613
  2021-04-01 23:00  S=  334.799100 P=  335.334000  unreal +0.00583526  F_to_date +0.05331556  equity 16.70470637
  2021-04-02 23:00  S=  338.293200 P=  338.821000  unreal +0.00637524  F_to_date +0.09467281  equity 16.74660361
  2021-04-03 23:00  S=  321.949700 P=  322.235000  unreal +0.01426455  F_to_date +0.13506197  equity 16.79488208
  2021-04-04 23:00  S=  348.861700 P=  349.304000  unreal +0.01042708  F_to_date +0.14453226  equity 16.80051490
```

### `DOGEUSDT` 2021-04-15 19:00 → 2021-04-16 00:00 (`recentre` → `recentre`)

```
ENTRY   bar open 2021-04-15 19:00 UTC, both legs at that bar's close
  spot close  S_e = 0.16828100   ->  q_s = N/S_e = 66.0271279058 units
  perp close  P_e = 0.16788200   ->  q_p = N/P_e = 66.1840525554 units
  basis RECEIVED  b_e = P_e/S_e - 1 = -0.237103%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (1 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-04-16 00:00  f = +0.007184%  perp open     0.181646  ++0.0008636654 USDT   F = 0.0008636654
  TOTAL FUNDING F = 0.0008636654   (engine 0.0008636654, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.000078 = (0.5 + 0.000078 - 0.01)/1.01 = 48.522548%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +34.618363%  at 2021-04-16 00:00
    worst bar 2021-04-16 00:00  high/P_e - 1 = +34.618363%  -> RE-CENTRE
    worst bar 2021-04-15 21:00  high/P_e - 1 = +13.867478%  -> no action
    worst bar 2021-04-15 20:00  high/P_e - 1 = +13.734051%  -> no action
  buffer left at the worst bar = x_liq - x_max = +13.904185% of notional

EXIT    bar open 2021-04-16 00:00
  spot close  S_x = 0.22110340     perp close P_x = 0.21946000
  basis PAID  b_x = P_x/S_x - 1 = -0.743272%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +3.4877113611   (engine +3.4877113611, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -3.4136410627  (engine -3.4136410627, res 0.00e+00)
  hedge_pnl = +0.0740702984   [basis reading N*(b_e - b_x) = +0.0562409707; difference is the second-order quantity mismatch]
  funding   = +0.0008636654
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = +0.0327117416   (engine +0.0327117416, res 0.00e+00)   = +0.1963% of slot capital
  cost / carry = 48.887

DAILY MARKS (bar closing 00:00 UTC; 1 days shown in full)
  2021-04-15 23:00  S=    0.182360 P=    0.181654  unreal +0.01810256  F_to_date +0.00000000  equity 16.66365811
```

### `DOGEUSDT` 2021-08-07 08:00 → 2021-08-08 00:00 (`gate_on` → `recentre`)

```
ENTRY   bar open 2021-08-07 08:00 UTC, both legs at that bar's close
  spot close  S_e = 0.21487000   ->  q_s = N/S_e = 51.7108535911 units
  perp close  P_e = 0.21512000   ->  q_p = N/P_e = 51.6507582331 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.116349%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (2 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-08-07 16:00  f = +0.060928%  perp open     0.238280  ++0.0074986177 USDT   F = 0.0074986177
  2021-08-08 00:00  f = +0.065496%  perp open     0.261950  ++0.0088615539 USDT   F = 0.0163601716
  TOTAL FUNDING F = 0.0163601716   (engine 0.0163601716, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.001472 = (0.5 + 0.001472 - 0.01)/1.01 = 48.660635%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +32.433061%  at 2021-08-08 00:00
    worst bar 2021-08-08 00:00  high/P_e - 1 = +32.433061%  -> RE-CENTRE
    worst bar 2021-08-07 23:00  high/P_e - 1 = +22.410747%  -> no action
    worst bar 2021-08-07 22:00  high/P_e - 1 = +17.724991%  -> no action
  buffer left at the worst bar = x_liq - x_max = +16.227575% of notional

EXIT    bar open 2021-08-08 00:00
  spot close  S_x = 0.27334000     perp close P_x = 0.27395000
  basis PAID  b_x = P_x/S_x - 1 = +0.223165%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +3.0235336095   (engine +3.0235336095, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -3.0386141069  (engine -3.0386141069, res 0.00e+00)
  hedge_pnl = -0.0150804974   [basis reading N*(b_e - b_x) = -0.0118684298; difference is the second-order quantity mismatch]
  funding   = +0.0163601716
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = -0.0409425480   (engine -0.0409425480, res 0.00e+00)   = -0.2457% of slot capital
  cost / carry = 2.581

DAILY MARKS (bar closing 00:00 UTC; 1 days shown in full)
  2021-08-07 23:00  S=    0.261890 P=    0.261940  unreal +0.01315584  F_to_date +0.00749862  equity 16.66621001
```

### `SOLUSDT` 2021-08-28 12:00 → 2021-08-30 18:00 (`recentre` → `recentre`)

```
ENTRY   bar open 2021-08-28 12:00 UTC, both legs at that bar's close
  spot close  S_e = 93.19000000   ->  q_s = N/S_e = 0.1192307234 units
  perp close  P_e = 93.22500000   ->  q_p = N/P_e = 0.1191859599 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.037558%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (7 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2021-08-28 16:00  f = +0.010000%  perp open    94.691000  ++0.0011285838 USDT   F = 0.0011285838
  2021-08-29 00:00  f = +0.010000%  perp open    96.232000  ++0.0011469503 USDT   F = 0.0022755341
  2021-08-29 08:00  f = +0.010000%  perp open    94.116000  ++0.0011217306 USDT   F = 0.0033972647
  2021-08-29 16:00  f = +0.014102%  perp open    92.280000  ++0.0015510057 USDT   F = 0.0049482704
  2021-08-30 00:00  f = +0.010000%  perp open    94.242000  ++0.0011232323 USDT   F = 0.0060715027
  2021-08-30 08:00  f = +0.020770%  perp open   100.122000  ++0.0024785125 USDT   F = 0.0085500152
  2021-08-30 16:00  f = +0.010000%  perp open   105.661000  ++0.0012593308 USDT   F = 0.0098093460
  TOTAL FUNDING F = 0.0098093460   (engine 0.0098093460, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.000883 = (0.5 + 0.000883 - 0.01)/1.01 = 48.602261%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +25.073746%  at 2021-08-30 18:00
    worst bar 2021-08-30 18:00  high/P_e - 1 = +25.073746%  -> RE-CENTRE
    worst bar 2021-08-30 17:00  high/P_e - 1 = +16.382944%  -> no action
    worst bar 2021-08-30 16:00  high/P_e - 1 = +15.843390%  -> no action
  buffer left at the worst bar = x_liq - x_max = +23.528515% of notional

EXIT    bar open 2021-08-30 18:00
  spot close  S_x = 115.72000000     perp close P_x = 115.65900000
  basis PAID  b_x = P_x/S_x - 1 = -0.052713%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +2.6862681976   (engine +2.6862681976, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -2.6738178243  (engine -2.6738178243, res 0.00e+00)
  hedge_pnl = +0.0124503733   [basis reading N*(b_e - b_x) = +0.0100301249; difference is the second-order quantity mismatch]
  funding   = +0.0098093460
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = -0.0199625029   (engine -0.0199625029, res 0.00e+00)   = -0.1198% of slot capital
  cost / carry = 4.304

DAILY MARKS (bar closing 00:00 UTC; 2 days shown in full)
  2021-08-28 23:00  S=   96.220000 P=   96.225000  unreal +0.00371121  F_to_date +0.00112858  equity 16.65039535
  2021-08-29 23:00  S=   94.230000 P=   94.239000  unreal +0.00314539  F_to_date +0.00494827  equity 16.65364921
```

### `LINKUSDT` 2023-11-11 16:00 → 2024-02-11 04:00 (`gate_on` → `recentre`)

```
ENTRY   bar open 2023-11-11 16:00 UTC, both legs at that bar's close
  spot close  S_e = 15.98900000   ->  q_s = N/S_e = 0.6949222035 units
  perp close  P_e = 16.00800000   ->  q_p = N/P_e = 0.6940973957 units
  basis RECEIVED  b_e = P_e/S_e - 1 = +0.118832%
  entry cost  (0.10%+0.05%+2*0.02%) * N = 0.0211111111
  margin posted M = N/2 = 5.555556; slot capital = N*1.5 = 16.6667

SETTLEMENT LEDGER  (274 collected; a settlement counts iff t_entry < t_j <= t_exit_bar_open)
  2023-11-12 00:00  f = +0.032417%  perp open    16.484000  ++0.0037089915 USDT   F = 0.0037089915
  2023-11-12 08:00  f = +0.010000%  perp open    16.261000  ++0.0011286718 USDT   F = 0.0048376633
  2023-11-12 16:00  f = +0.010000%  perp open    15.954000  ++0.0011073630 USDT   F = 0.0059450263
  2023-11-13 00:00  f = +0.023487%  perp open    16.031000  ++0.0026134162 USDT   F = 0.0085584425
  ... 267 further settlements ...
  2024-02-10 08:00  f = +0.010000%  perp open    18.332000  ++0.0012724193 USDT   F = 0.4309820459
  2024-02-10 16:00  f = +0.010000%  perp open    18.358000  ++0.0012742240 USDT   F = 0.4322562699
  2024-02-11 00:00  f = +0.010000%  perp open    19.079000  ++0.0013242684 USDT   F = 0.4335805384
  TOTAL FUNDING F = 0.4335805384   (engine 0.4335805384, residual 0.00e+00)

MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)
  x_liq at F=0        = (0.5 - 0.01)/1.01            = 48.514851%
  x_liq at F=0.039022 = (0.5 + 0.039022 - 0.01)/1.01 = 52.378440%
  x_rc  = 0.5 * x_liq(F=0)                            = 24.257426%
  max adverse excursion over the hold                 = +24.562719%  at 2024-02-11 04:00
    worst bar 2024-02-11 04:00  high/P_e - 1 = +24.562719%  -> RE-CENTRE
    worst bar 2024-02-05 14:00  high/P_e - 1 = +23.688156%  -> no action
    worst bar 2024-02-11 03:00  high/P_e - 1 = +23.644428%  -> no action
  buffer left at the worst bar = x_liq - x_max = +27.815722% of notional

EXIT    bar open 2024-02-11 04:00
  spot close  S_x = 19.84500000     perp close P_x = 19.83500000
  basis PAID  b_x = P_x/S_x - 1 = -0.050391%
  exit cost = 0.0211111111

P&L (USDT, hand-recomputed)
  spot_pnl  = q_s*(S_x - S_e) = +2.6796200165   (engine +2.6796200165, res 0.00e+00)
  perp_pnl  = -q_p*(P_x - P_e) = -2.6563107335  (engine -2.6563107335, res 0.00e+00)
  hedge_pnl = +0.0233092830   [basis reading N*(b_e - b_x) = +0.0188024693; difference is the second-order quantity mismatch]
  funding   = +0.4335805384
  fees+slip = 0.0422222222  (engine 0.0422222222, res 0.00e+00)
  NET       = +0.4146675992   (engine +0.4146675992, res 0.00e+00)   = +2.4880% of slot capital
  cost / carry = 0.097

DAILY MARKS (bar closing 00:00 UTC; 92 days shown first 3 and last 3)
  2023-11-11 23:00  S=   16.477000 P=   16.484000  unreal +0.00873167  F_to_date +0.00000000  equity 16.65428723
  2023-11-12 23:00  S=   16.025000 P=   16.031000  unreal +0.00905296  F_to_date +0.00594503  equity 16.66055354
  2023-11-13 23:00  S=   14.358000 P=   14.370000  unreal +0.00351342  F_to_date +0.01133002  equity 16.66039899
  2024-02-08 23:00  S=   18.212000 P=   18.200000  unreal +0.02335057  F_to_date +0.42581546  equity 17.09472158
  2024-02-09 23:00  S=   18.470000 P=   18.469000  unreal +0.01592830  F_to_date +0.42842763  equity 17.08991148
  2024-02-10 23:00  S=   19.084000 P=   19.080000  unreal +0.01851702  F_to_date +0.43225627  equity 17.09632885
```

## Residuals

Worst `|hand − engine|` over all 20 proved positions and all seven quantities (funding, spot_pnl, perp_pnl, fees, net, settlement count, max excursion): **0.000e+00**. The `1e−9` bar of DESIGN §8.5 is met.

  tier   symbol                     entry                      exit  funding  spot  perp  fees  net  nsettle  xmax
majors  BTCUSDT 2020-01-16 08:00:00+00:00 2020-03-13 08:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
majors  ETHUSDT 2020-03-13 02:00:00+00:00 2020-03-13 03:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
majors  BTCUSDT 2020-06-04 16:00:00+00:00 2020-06-15 16:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
majors  ETHUSDT 2020-08-02 03:00:00+00:00 2020-09-22 00:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
majors  ETHUSDT 2020-11-18 04:00:00+00:00 2020-11-24 00:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
majors  BTCUSDT 2020-12-27 11:00:00+00:00 2021-01-03 07:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
majors  ETHUSDT 2021-01-04 06:00:00+00:00 2021-01-19 07:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
majors  BTCUSDT 2021-02-19 16:00:00+00:00 2021-05-21 00:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
majors  ETHUSDT 2021-05-10 05:00:00+00:00 2021-05-19 16:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
majors  ETHUSDT 2021-10-15 08:00:00+00:00 2021-11-08 00:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts  XRPUSDT 2020-09-17 00:00:00+00:00 2020-11-20 16:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts  XRPUSDT 2020-11-24 04:00:00+00:00 2020-12-09 16:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts  BNBUSDT 2021-01-04 06:00:00+00:00 2021-01-13 08:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts  XRPUSDT 2021-01-30 16:00:00+00:00 2021-02-01 03:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts  SOLUSDT 2021-02-10 20:00:00+00:00 2021-02-19 13:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts  BNBUSDT 2021-03-30 08:00:00+00:00 2021-04-05 11:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts DOGEUSDT 2021-04-15 19:00:00+00:00 2021-04-16 00:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts DOGEUSDT 2021-08-07 08:00:00+00:00 2021-08-08 00:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts  SOLUSDT 2021-08-28 12:00:00+00:00 2021-08-30 18:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
  alts LINKUSDT 2023-11-11 16:00:00+00:00 2024-02-11 04:00:00+00:00      0.0   0.0   0.0   0.0  0.0        0   0.0
