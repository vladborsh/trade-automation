# Worked-example gallery — session-liquidity BoS pass (corrected, pinned-anchor mechanic)

Up to 32 real take-outs, drawn by `examples.draw_event`. Selection is stratified across (symbol x direction x level_session x sweep_block) with seed 42 and is **not** hand-curated — re-running `gallery.py` reproduces exactly these panels. Every group gets the same renderer and the same four slots, so the group sizes here say nothing about how common each outcome is (B2, D3 and M1 in `TABLES.md` do).

**What to check on a panel** — this is the audit, and it is the audit that phase 1 never had:

1. the **green ray** starts on its own pivot bar, that bar is **before** the dotted `t0` line, and the pivot was **confirmed** by `t0` (the thin green dotted vertical marks the confirmation bar, always >= 3 bars after the pivot);
2. the green ray is **flat all the way across** — it never steps. That is the whole correction: the anchor is chosen once, at `t0`, and is fixed for the event's life;
3. the **red step-line** is phase 1's tested level over the same window. Every step is a newly confirmed pivot overwriting the test. Where the red sits far from the green, phase 1 was testing something nobody was watching at the take-out;
4. the BoS break is a full **close** through the ray (circle), inside the shaded block window — a wick through it is not an event;
5. the anchor is on the **near** side of the dashed boundary in essentially every panel, so a break means price closed back **inside** the swept range. That is why the stop proxy is wide;
6. there is deliberately **no star on the take-out wick** (user preference); the take-out is the dotted vertical `t0` line.

`age` = bars from the anchor pivot to `t0`; `dist` = |take-out wick - anchor| in ATR(14, 5m); `delay` = bars from `t0` to the break; `re-anch` = pivots that overwrote phase 1's level inside the window; `rev` is the wick-anchored reversal and `R` the from-break R proxy, both in ATR; `left` = bars of block remaining after the take-out.


## `broke*` — BROKE — a full close through the pinned ray inside the block-scoped window

_Pool: 7,135 events = 33.79% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | age | dist | delay | re-anch | rev | R | phase-1 BoS | iFVG | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| broke01 | ETHUSDT | 2025-03-01 21:55 | high | NY | Late | 24 | 3 | 3.69 | 7 | 0 | 7.13 | 0.86 | same level | no | `broke01_ETHUSDT_20250301_2155_hi.png` |
| broke02 | BNBUSDT | 2024-01-15 22:15 | low | NY | Late | 20 | 7 | 7.19 | 14 | 0 | 8.39 | 0.15 | same level | no | `broke02_BNBUSDT_20240115_2215_lo.png` |
| broke03 | SOLUSDT | 2024-04-23 15:05 | high | Asia | NY | 70 | 4 | 4.00 | 61 | 5 | 5.37 | 0.23 | +54b RE-ANCHORED | +35b | `broke03_SOLUSDT_20240423_1505_hi.png` |
| broke04 | BNBUSDT | 2022-08-26 11:05 | low | London | London | 22 | 10 | 6.69 | 17 | 1 | 9.57 | 0.10 | +10b RE-ANCHORED | +16b | `broke04_BNBUSDT_20220826_1105_lo.png` |


## `sketch*` — THE USER'S SKETCH SHAPE — an aged anchor (>= 8 bars before the take-out) sitting further than the median distance away, broken >= 15 bars after the sweep: a real leg into the extreme, the ray drawn forward from the last opposing pivot before it, and the break on the reversal

_Pool: 1,011 events = 4.79% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | age | dist | delay | re-anch | rev | R | phase-1 BoS | iFVG | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sketch01 | ETHUSDT | 2024-02-20 09:45 | low | NY | London | 38 | 8 | 6.26 | 15 | 1 | 10.44 | 0.49 | +9b RE-ANCHORED | no | `sketch01_ETHUSDT_20240220_0945_lo.png` |
| sketch02 | BNBUSDT | 2023-12-01 09:15 | high | Asia | London | 44 | 9 | 5.70 | 42 | 1 | 7.85 | 0.17 | +15b RE-ANCHORED | no | `sketch02_BNBUSDT_20231201_0915_hi.png` |
| sketch03 | BNBUSDT | 2023-06-01 00:10 | high | London | Asia | 93 | 18 | 6.94 | 31 | 1 | 16.50 | 0.43 | +7b RE-ANCHORED | no | `sketch03_BNBUSDT_20230601_0010_hi.png` |
| sketch04 | SOLUSDT | 2024-09-03 08:35 | low | Asia | London | 52 | 11 | 4.98 | 42 | 1 | 6.74 | 0.20 | +9b RE-ANCHORED | +9b | `sketch04_SOLUSDT_20240903_0835_lo.png` |


## `nobreak*` — NO BREAK — the ray was never reached before the sweep block ended (66% of primary take-outs)

_Pool: 13,983 events = 66.21% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | age | dist | delay | re-anch | rev | R | phase-1 BoS | iFVG | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nobreak01 | ETHUSDT | 2025-06-09 21:00 | high | NY | Late | 35 | 10 | 5.87 |  | 3 | 1.52 |  | never fired | +19b | `nobreak01_ETHUSDT_20250609_2100_hi.png` |
| nobreak02 | BNBUSDT | 2026-06-28 22:50 | low | NY | Late | 13 | 10 | 5.15 |  | 1 | 5.24 |  | never fired | no | `nobreak02_BNBUSDT_20260628_2250_lo.png` |
| nobreak03 | SOLUSDT | 2026-05-11 15:55 | high | Asia | NY | 60 | 17 | 6.64 |  | 5 | 0.89 |  | +37b RE-ANCHORED | +37b | `nobreak03_SOLUSDT_20260511_1555_hi.png` |
| nobreak04 | BNBUSDT | 2025-01-19 08:30 | low | London | London | 53 | 9 | 8.51 |  | 3 | 1.82 |  | +51b RE-ANCHORED | +24b | `nobreak04_BNBUSDT_20250119_0830_lo.png` |


## `defect*` — THE RE-ANCHORING DEFECT, on one chart — phase 1 fired at least 20 bars earlier than the corrected mechanic, on a level it had re-anchored to at least twice

_Pool: 588 events = 2.78% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | age | dist | delay | re-anch | rev | R | phase-1 BoS | iFVG | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| defect01 | BTCUSDT | 2024-07-02 08:10 | low | NY | London | 57 | 17 | 6.29 | 55 | 2 | 7.73 | 0.01 | +11b RE-ANCHORED | no | `defect01_BTCUSDT_20240702_0810_lo.png` |
| defect02 | SOLUSDT | 2025-01-20 02:55 | low | London | Asia | 60 | 9 | 4.83 | 44 | 2 | 9.20 | 0.78 | +21b RE-ANCHORED | no | `defect02_SOLUSDT_20250120_0255_lo.png` |
| defect03 | BTCUSDT | 2024-04-03 14:05 | high | London | NY | 82 | 5 | 5.44 | 51 | 2 | 6.45 | 0.15 | +16b RE-ANCHORED | no | `defect03_BTCUSDT_20240403_1405_hi.png` |
| defect04 | BTCUSDT | 2023-08-07 14:00 | low | Asia | NY | 83 | 4 | 2.77 | 49 | 3 | 6.78 | 0.14 | +28b RE-ANCHORED | +14b | `defect04_BTCUSDT_20230807_1400_lo.png` |


## `p1only*` — PHASE-1 FALSE POSITIVE — phase 1 called a BoS, the pinned ray was never touched. This is 48.8% of the primary sample and it is what the phase-1 BoS tables were counting

_Pool: 10,304 events = 48.79% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | age | dist | delay | re-anch | rev | R | phase-1 BoS | iFVG | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p1only01 | ETHUSDT | 2024-01-25 21:00 | high | NY | Late | 35 | 3 | 3.35 |  | 1 | 3.19 |  | +13b RE-ANCHORED | +6b | `p1only01_ETHUSDT_20240125_2100_hi.png` |
| p1only02 | BNBUSDT | 2022-10-06 21:00 | low | NY | Late | 35 | 11 | 8.16 |  | 1 | 0.64 |  | +19b RE-ANCHORED | +12b | `p1only02_BNBUSDT_20221006_2100_lo.png` |
| p1only03 | SOLUSDT | 2024-08-19 13:15 | high | Asia | NY | 92 | 11 | 5.63 |  | 1 | 6.25 |  | +8b RE-ANCHORED | +7b | `p1only03_SOLUSDT_20240819_1315_hi.png` |
| p1only04 | BNBUSDT | 2025-05-04 08:40 | low | London | London | 51 | 4 | 4.01 |  | 1 | 2.15 |  | +23b RE-ANCHORED | +20b | `p1only04_BNBUSDT_20250504_0840_lo.png` |


## `bosonly*` — BoS ONLY — the corrected mechanic confirmed where iFVG-v4 did not

_Pool: 3,833 events = 18.15% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | age | dist | delay | re-anch | rev | R | phase-1 BoS | iFVG | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bosonly01 | ETHUSDT | 2024-10-08 21:45 | high | NY | Late | 26 | 6 | 5.18 | 15 | 0 | 6.41 | 0.08 | same level | no | `bosonly01_ETHUSDT_20241008_2145_hi.png` |
| bosonly02 | BNBUSDT | 2024-01-17 22:20 | low | NY | Late | 19 | 6 | 5.35 | 5 | 0 | 6.76 | 0.09 | same level | no | `bosonly02_BNBUSDT_20240117_2220_lo.png` |
| bosonly03 | SOLUSDT | 2025-12-25 16:25 | high | Asia | NY | 54 | 4 | 3.21 | 7 | 0 | 5.15 | 0.45 | same level | no | `bosonly03_SOLUSDT_20251225_1625_hi.png` |
| bosonly04 | BNBUSDT | 2024-07-16 08:20 | low | London | London | 55 | 3 | 3.88 | 12 | 0 | 7.68 | 0.71 | same level | no | `bosonly04_BNBUSDT_20240716_0820_lo.png` |


## `ifvgonly*` — iFVG ONLY — iFVG-v4 confirmed where the corrected mechanic never reached its ray

_Pool: 10,304 events = 48.79% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | age | dist | delay | re-anch | rev | R | phase-1 BoS | iFVG | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ifvgonly01 | ETHUSDT | 2024-05-20 21:50 | high | NY | Late | 25 | 18 | 6.30 |  | 1 | 0.45 |  | never fired | +9b | `ifvgonly01_ETHUSDT_20240520_2150_hi.png` |
| ifvgonly02 | BNBUSDT | 2024-04-28 22:30 | low | NY | Late | 17 | 6 | 6.53 |  | 1 | 2.92 |  | never fired | +12b | `ifvgonly02_BNBUSDT_20240428_2230_lo.png` |
| ifvgonly03 | SOLUSDT | 2026-05-08 17:30 | high | Asia | NY | 41 | 8 | 6.94 |  | 3 | 1.01 |  | +30b RE-ANCHORED | +25b | `ifvgonly03_SOLUSDT_20260508_1730_hi.png` |
| ifvgonly04 | BNBUSDT | 2025-01-19 08:30 | low | London | London | 53 | 9 | 8.51 |  | 3 | 1.82 |  | +51b RE-ANCHORED | +24b | `ifvgonly04_BNBUSDT_20250119_0830_lo.png` |


## `unanch*` — UNANCHORABLE (DESIGN §1 pin 4) — no opposing k=3 pivot was confirmed anywhere before the take-out bar

_Pool: 0 events = 0.00% of the 21,118-event primary sample._

**This pool is EMPTY.** The category is part of the pinned mechanic and part of the schema, and the data contains no instance of it — see B1 in `TABLES.md`. It is reported rather than deleted so that a later re-run on other assets or a coarser pivot k can be compared against a stated zero.
