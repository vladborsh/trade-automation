# Worked-example gallery — session-liquidity v2 (iFVG only)

Thirty real take-outs, drawn by `examples.draw_event`. Selection is stratified across (symbol x direction x level_session x sweep_block) with seed 42 and is **not** hand-curated — re-running `gallery.py` reproduces exactly these panels. Wins, failures and unconfirmed take-outs get the same renderer and the same ten slots, so the group sizes here say nothing about how common each outcome is (T2/T7 do — 64% of take-outs confirm, and 44% of those reach R>=1).

`rev`/`adv` are measured from the take-out wick, `mfe`/`mae`/`R` from the iFVG inversion close. All in ATR(14, 5m) at the take-out bar. `left` = bars of block remaining after the take-out.


## `win*` — CONFIRMED, R proxy >= 1 — the iFVG fired and the reversal paid

_Pool: 5,934 events = 28.1% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | delay | rev | adv | mfe | mae | R | lvls | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| win01 | SOLUSDT | 2024-03-23 14:30 | high | Asia | NY | 77 | 8 | 7.05 | 0.00 | 3.97 | 0.38 | 1.29 | 2 | `win01_SOLUSDT_20240323_1430_hi.png` |
| win02 | BTCUSDT | 2023-07-30 14:45 | high | Asia | NY | 74 | 9 | 23.55 | 0.69 | 21.50 | 1.77 | 7.84 | 4 | `win02_BTCUSDT_20230730_1445_hi.png` |
| win03 | BTCUSDT | 2025-06-30 08:55 | low | Asia | London | 48 | 17 | 6.95 | 1.09 | 6.17 | 0.57 | 3.29 | 1 | `win03_BTCUSDT_20250630_0855_lo.png` |
| win04 | BNBUSDT | 2024-12-08 09:20 | low | London | London | 43 | 8 | 2.34 | 5.05 | 5.39 | 0.02 | 2.69 | 1 | `win04_BNBUSDT_20241208_0920_lo.png` |
| win05 | BTCUSDT | 2023-11-11 21:55 | low | Asia | Late | 24 | 17 | 6.43 | 7.72 | 7.26 | 1.00 | 1.05 | 2 | `win05_BTCUSDT_20231111_2155_lo.png` |
| win06 | ETHUSDT | 2025-12-23 13:35 | low | NY | NY | 88 | 20 | 8.40 | 4.25 | 8.78 | 2.73 | 2.27 | 3 | `win06_ETHUSDT_20251223_1335_lo.png` |
| win07 | BTCUSDT | 2025-01-17 01:35 | high | Asia | Asia | 76 | 12 | 2.37 | 4.52 | 4.62 | 0.86 | 2.04 | 2 | `win07_BTCUSDT_20250117_0135_hi.png` |
| win08 | BTCUSDT | 2025-10-14 09:50 | low | London | London | 37 | 9 | 2.37 | 4.38 | 4.32 | 1.75 | 1.79 | 2 | `win08_BTCUSDT_20251014_0950_lo.png` |
| win09 | ETHUSDT | 2024-05-09 21:05 | high | NY | Late | 34 | 24 | 3.15 | 6.25 | 3.36 | 0.07 | 1.01 | 1 | `win09_ETHUSDT_20240509_2105_hi.png` |
| win10 | BNBUSDT | 2026-03-15 08:15 | high | Asia | London | 56 | 14 | 3.78 | 5.99 | 6.52 | 0.28 | 2.01 | 1 | `win10_BNBUSDT_20260315_0815_hi.png` |


## `fail*` — CONFIRMED, R proxy < 1 — the iFVG fired and it did not pay

_Pool: 7,609 events = 36.0% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | delay | rev | adv | mfe | mae | R | lvls | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fail01 | ETHUSDT | 2025-02-25 22:00 | high | NY | Late | 23 | 3 | 2.78 | 0.87 | 1.48 | 1.14 | 0.68 | 1 | `fail01_ETHUSDT_20250225_2200_hi.png` |
| fail02 | BNBUSDT | 2025-10-10 21:00 | low | NY | Late | 35 | 18 | 1.10 | 36.18 | 5.76 | 0.50 | 0.22 | 1 | `fail02_BNBUSDT_20251010_2100_lo.png` |
| fail03 | SOLUSDT | 2025-05-31 19:00 | high | Asia | NY | 23 | 8 | 0.63 | 1.69 | 1.01 | 0.52 | 0.80 | 1 | `fail03_SOLUSDT_20250531_1900_hi.png` |
| fail04 | BNBUSDT | 2025-06-01 08:00 | low | London | London | 59 | 43 | 1.51 | 5.83 | 0.91 | 3.60 | 0.33 | 2 | `fail04_BNBUSDT_20250601_0800_lo.png` |
| fail05 | BTCUSDT | 2026-02-28 22:30 | high | NY | Late | 17 | 8 | 2.67 | 1.98 | 1.06 | 0.45 | 0.30 | 1 | `fail05_BTCUSDT_20260228_2230_hi.png` |
| fail06 | BTCUSDT | 2022-08-24 01:40 | low | London | Asia | 75 | 4 | 5.16 | 1.40 | 2.83 | 3.73 | 0.91 | 1 | `fail06_BTCUSDT_20220824_0140_lo.png` |
| fail07 | SOLUSDT | 2024-06-29 21:05 | low | NY | Late | 34 | 25 | 2.20 | 3.37 | 0.67 | 1.84 | 0.23 | 1 | `fail07_SOLUSDT_20240629_2105_lo.png` |
| fail08 | BTCUSDT | 2025-11-18 14:35 | high | Asia | NY | 76 | 17 | 5.10 | 4.82 | 0.62 | 3.78 | 0.63 | 1 | `fail08_BTCUSDT_20251118_1435_hi.png` |
| fail09 | ETHUSDT | 2024-11-11 15:20 | high | Asia | NY | 67 | 4 | 0.66 | 8.51 | 0.45 | 8.39 | 0.21 | 1 | `fail09_ETHUSDT_20241111_1520_hi.png` |
| fail10 | BTCUSDT | 2024-08-02 14:50 | low | Asia | NY | 73 | 8 | 0.53 | 4.47 | 1.21 | 3.79 | 0.45 | 1 | `fail10_BTCUSDT_20240802_1450_lo.png` |


## `unconf*` — UNCONFIRMED take-out — no in-block iFVG; the events the rule discards

_Pool: 7,512 events = 35.6% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | delay | rev | adv | mfe | mae | R | lvls | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| unconf01 | ETHUSDT | 2025-07-05 22:40 | high | NY | Late | 15 |  | 2.18 | 0.22 |  |  |  | 1 | `unconf01_ETHUSDT_20250705_2240_hi.png` |
| unconf02 | BNBUSDT | 2024-03-19 22:25 | low | NY | Late | 18 |  | 1.65 | 2.59 |  |  |  | 1 | `unconf02_BNBUSDT_20240319_2225_lo.png` |
| unconf03 | SOLUSDT | 2025-07-13 14:20 | high | Asia | NY | 79 |  | 9.28 | 0.00 |  |  |  | 1 | `unconf03_SOLUSDT_20250713_1420_hi.png` |
| unconf04 | BNBUSDT | 2025-12-14 11:45 | low | London | London | 14 |  | 6.00 | 0.00 |  |  |  | 1 | `unconf04_BNBUSDT_20251214_1145_lo.png` |
| unconf05 | BTCUSDT | 2024-06-01 22:25 | high | NY | Late | 18 |  | 3.75 | 0.00 |  |  |  | 1 | `unconf05_BTCUSDT_20240601_2225_hi.png` |
| unconf06 | BTCUSDT | 2024-04-09 06:40 | low | London | Asia | 15 |  | 2.29 | 3.20 |  |  |  | 1 | `unconf06_BTCUSDT_20240409_0640_lo.png` |
| unconf07 | SOLUSDT | 2025-10-28 21:05 | low | NY | Late | 34 |  | 4.14 | 0.00 |  |  |  | 1 | `unconf07_SOLUSDT_20251028_2105_lo.png` |
| unconf08 | BTCUSDT | 2025-02-28 16:40 | high | Asia | NY | 51 |  | 4.20 | 0.48 |  |  |  | 1 | `unconf08_BTCUSDT_20250228_1640_hi.png` |
| unconf09 | ETHUSDT | 2024-11-07 18:30 | high | Asia | NY | 29 |  | 3.17 | 1.91 |  |  |  | 1 | `unconf09_ETHUSDT_20241107_1830_hi.png` |
| unconf10 | BTCUSDT | 2023-12-17 14:35 | low | Asia | NY | 76 |  | 12.98 | 0.00 |  |  |  | 2 | `unconf10_BTCUSDT_20231217_1435_lo.png` |
