# PDH/PDL worked-example gallery — drill-down pass (post-v4)

Eighteen real **day-level** take-outs, six each of wins, failures and unconfirmed take-outs, all under the **iFVG-v4** mechanic. The renderer is a fork of the v4 package's `examples.draw_event` with the prior-day layer added: the prior UTC day's range as a shaded band, the midnight boundary at which PDH/PDL become sweepable, both rays across their one-day lifetime, and a marker on the bar inside the prior day where the extreme actually printed (with its block — this is how the Late-sets-the-extreme diagnostic is checked by eye).

Inherited from the v4 panel: the swept level is drawn as THE BOUNDARY and **every candidate gap the state machine saw** is drawn and numbered in formation order, coloured green (confirmed), grey (replaced by a later gap — permanently out) or orange (still live when the block ended). **The take-out-wick star marker is deliberately not drawn** (user request 2026-08-31: informational only, visually noisy); no measurement anchor changed.

Selection is stratified across (symbol x direction x sweep_block x coincident_session_level) with seed 42 and is **not** hand-curated; re-running `dd_gallery.py` reproduces exactly these panels. The six slots per group are equal by construction and say nothing about how common each outcome is (D3 and A0 do).

`coincident` = an alive session level sat within 0.05 ATR of the day level at the take-out, so the same excursion took both. About three quarters of day-level take-outs are coincident (D5); the gallery deliberately spans both halves.

`rev`/`adv` are measured from the take-out wick; `mfe`/`mae`/`R`/`ER` from the iFVG inversion close. All in ATR(14, 5m) at the take-out bar.


## `pd_win*` — CONFIRMED, R proxy >= 1 — the iFVG fired and the reversal paid

_Pool: 1,223 events = 25.7% of the 4,751-event PDH/PDL primary sample._

| # | asset | take-out (UTC) | side | block | coincident | left | delay | cand | gap ATR | rev | adv | mfe | mae | R | ER | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pd_win01 | ETHUSDT | 2022-08-17 05:35 | PDH | Asia | yes | 28 | 19 | 2 | 0.27 | 6.37 | 8.60 | 12.00 | 1.15 | 4.04 | +0.85 | `pd_win01_ETHUSDT_20220817_0535_hi.png` |
| pd_win02 | BNBUSDT | 2022-08-02 02:30 | PDL | Asia | yes | 65 | 28 | 3 | 0.35 | 3.66 | 0.61 | 2.74 | 0.09 | 1.80 | +0.26 | `pd_win02_BNBUSDT_20220802_0230_lo.png` |
| pd_win03 | SOLUSDT | 2024-11-13 02:35 | PDL | Asia | yes | 64 | 18 | 2 | 0.17 | 2.74 | 2.63 | 2.00 | 2.69 | 1.75 | +0.02 | `pd_win03_SOLUSDT_20241113_0235_lo.png` |
| pd_win04 | ETHUSDT | 2024-06-13 15:35 | PDL | NY | yes | 64 | 7 | 2 | 0.36 | 2.68 | 2.22 | 2.58 | 0.61 | 1.11 | +0.10 | `pd_win04_ETHUSDT_20240613_1535_lo.png` |
| pd_win05 | SOLUSDT | 2025-09-21 16:35 | PDL | NY | yes | 52 | 4 | 1 | 0.58 | 3.10 | 1.55 | 2.50 | 1.68 | 1.16 | +0.07 | `pd_win05_SOLUSDT_20250921_1635_lo.png` |
| pd_win06 | BTCUSDT | 2022-09-26 08:45 | PDH | London | yes | 50 | 4 | 2 | 0.19 | 8.64 | 1.91 | 8.09 | 1.60 | 3.28 | +0.08 | `pd_win06_BTCUSDT_20220926_0845_hi.png` |


## `pd_fail*` — CONFIRMED, R proxy < 1 — the iFVG fired and it did not pay

_Pool: 1,844 events = 38.8% of the 4,751-event PDH/PDL primary sample._

| # | asset | take-out (UTC) | side | block | coincident | left | delay | cand | gap ATR | rev | adv | mfe | mae | R | ER | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pd_fail01 | BTCUSDT | 2023-12-07 09:15 | PDL | London | yes | 44 | 6 | 1 | 0.42 | 5.41 | 2.25 | 0.53 | 5.40 | 0.08 | -0.04 | `pd_fail01_BTCUSDT_20231207_0915_lo.png` |
| pd_fail02 | SOLUSDT | 2022-11-06 21:50 | PDL | Late | yes | 25 | 7 | 2 | 0.20 | 1.59 | 8.28 | 0.25 | 8.04 | 0.11 | -0.35 | `pd_fail02_SOLUSDT_20221106_2150_lo.png` |
| pd_fail03 | BTCUSDT | 2026-06-13 21:40 | PDH | Late | yes | 27 | 14 | 3 | 0.25 | 5.35 | 0.00 | 1.23 | 1.82 | 0.30 | +0.05 | `pd_fail03_BTCUSDT_20260613_2140_hi.png` |
| pd_fail04 | BTCUSDT | 2026-01-30 01:35 | PDL | Asia | yes | 76 | 3 | 2 | 0.03 | 3.91 | 4.69 | 3.27 | 4.89 | 0.62 | +0.05 | `pd_fail04_BTCUSDT_20260130_0135_lo.png` |
| pd_fail05 | BNBUSDT | 2023-11-19 18:40 | PDH | NY | yes | 27 | 18 | 1 | 0.20 | 2.49 | 3.03 | 2.30 | 1.11 | 0.71 | +0.18 | `pd_fail05_BNBUSDT_20231119_1840_hi.png` |
| pd_fail06 | BTCUSDT | 2026-07-06 21:05 | PDH | Late | no | 34 | 15 | 3 | 0.66 | 3.74 | 1.60 | 2.03 | 0.52 | 0.61 | +0.29 | `pd_fail06_BTCUSDT_20260706_2105_hi.png` |


## `pd_unconf*` — UNCONFIRMED — no in-block iFVG; the day-level take-outs the rule discards

_Pool: 1,669 events = 35.1% of the 4,751-event PDH/PDL primary sample._

| # | asset | take-out (UTC) | side | block | coincident | left | delay | cand | gap ATR | rev | adv | mfe | mae | R | ER | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pd_unconf01 | BTCUSDT | 2023-10-31 08:05 | PDL | London | yes | 58 |  | 0 |  | 9.11 | 0.00 |  |  |  |  | `pd_unconf01_BTCUSDT_20231031_0805_lo.png` |
| pd_unconf02 | ETHUSDT | 2026-04-14 14:30 | PDH | NY | no | 77 |  | 0 |  | 13.06 | 0.00 |  |  |  |  | `pd_unconf02_ETHUSDT_20260414_1430_hi.png` |
| pd_unconf03 | BTCUSDT | 2024-11-15 21:50 | PDH | Late | yes | 25 |  | 0 |  | 3.36 | 0.19 |  |  |  |  | `pd_unconf03_BTCUSDT_20241115_2150_hi.png` |
| pd_unconf04 | BTCUSDT | 2022-08-15 06:55 | PDL | Asia | yes | 12 |  | 0 |  | 1.38 | 1.63 |  |  |  |  | `pd_unconf04_BTCUSDT_20220815_0655_lo.png` |
| pd_unconf05 | BNBUSDT | 2025-12-19 15:15 | PDH | NY | yes | 68 |  | 3 |  | 4.85 | 3.04 |  |  |  |  | `pd_unconf05_BNBUSDT_20251219_1515_hi.png` |
| pd_unconf06 | BTCUSDT | 2026-06-14 21:15 | PDH | Late | no | 32 |  | 7 |  | 3.77 | 6.65 |  |  |  |  | `pd_unconf06_BTCUSDT_20260614_2115_hi.png` |

