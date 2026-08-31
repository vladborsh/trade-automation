# Worked-example gallery — session-liquidity v3 (corrected iFVG state machine)

28 real take-outs, drawn by `examples.draw_event`. Selection is stratified across (symbol x direction x level_session x sweep_block) with seed 42 and is **not** hand-curated — re-running `gallery.py` reproduces exactly these panels. Every group gets the same renderer and the same four slots, so the group sizes here say nothing about how common each outcome is (S2 in `TABLES.md` does: 21% confirmed, 45% invalidated out, 30% no candidate, 4% live at block end).

**What to check on a panel** — this is the audit:

1. the **red line** is the take-out bar's own extreme; a candidate dies the moment a bar CLOSES beyond it (red `x`);
2. numbered zones are the qualifying gaps in **formation order**; green = the one that confirmed, red = invalidated, grey = replaced by a later gap and permanently out, orange = still live at block end;
3. only the **latest** live gap can confirm — a close through an older grey zone is not an event;
4. after an invalidation, only gaps forming on a **later** bar are eligible;
5. the header's `B` / `C` line says what the two sensitivity variants did with the same take-out.

`cand`/`repl`/`inval`/`tie` are the state-machine counters; `rev` is the wick-anchored reversal, `R` the from-confirmation R proxy, both in ATR(14, 5m) at the take-out bar; `left` = bars of block remaining after the take-out.


## `conf1*` — CONFIRMED, a single candidate, never invalidated — the clean case

_Pool: 2,575 events = 12.2% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | inval | tie | delay | rev | R | B | C | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| conf101 | ETHUSDT | 2025-12-15 02:15 | high | London | Asia | 68 | 1 | 0 | 0 | 0 | 58 | 3.54 | 0.26 | +58b, R 0.26 | +58b, R 0.26 | `conf101_ETHUSDT_20251215_0215_hi.png` |
| conf102 | SOLUSDT | 2022-11-26 01:20 | high | London | Asia | 79 | 1 | 0 | 0 | 0 | 13 | 4.60 | 1.07 | +13b, R 1.07 | +13b, R 1.07 | `conf102_SOLUSDT_20221126_0120_hi.png` |
| conf103 | BTCUSDT | 2025-07-17 01:35 | low | London | Asia | 76 | 1 | 0 | 0 | 0 | 4 | 3.77 | 1.44 | +4b, R 1.44 | +4b, R 1.44 | `conf103_BTCUSDT_20250717_0135_lo.png` |
| conf104 | SOLUSDT | 2023-11-04 08:15 | high | Asia | London | 56 | 1 | 0 | 0 | 0 | 26 | 4.25 | 1.22 | +26b, R 1.22 | +26b, R 1.22 | `conf104_SOLUSDT_20231104_0815_hi.png` |


## `confrep*` — CONFIRMED after a REPLACEMENT — a later gap displaced the live candidate, and the displaced one is permanently out (pin 1)

_Pool: 608 events = 2.9% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | inval | tie | delay | rev | R | B | C | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| confrep01 | ETHUSDT | 2025-09-15 08:00 | low | NY | London | 59 | 5 | 1 | 3 | 0 | 42 | 2.63 | 0.08 | +42b, R 0.08 | +13b, R 0.95 | `confrep01_ETHUSDT_20250915_0800_lo.png` |
| confrep02 | BNBUSDT | 2023-03-12 01:00 | high | London | Asia | 83 | 2 | 1 | 0 | 0 | 28 | 4.31 | 1.12 | +28b, R 1.12 | +28b, R 1.12 | `confrep02_BNBUSDT_20230312_0100_hi.png` |
| confrep03 | BNBUSDT | 2023-07-10 09:20 | high | London | London | 43 | 3 | 2 | 0 | 0 | 28 | 4.68 | 0.24 | +28b, R 0.24 | +28b, R 0.24 | `confrep03_BNBUSDT_20230710_0920_hi.png` |
| confrep04 | SOLUSDT | 2023-02-01 08:15 | low | Asia | London | 56 | 2 | 1 | 0 | 0 | 11 | 4.34 | 0.92 | +11b, R 0.92 | +11b, R 0.92 | `confrep04_SOLUSDT_20230201_0815_lo.png` |


## `confinv*` — CONFIRMED after one or more INVALIDATIONS — earlier candidates died against the take-out extreme first

_Pool: 1,382 events = 6.5% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | inval | tie | delay | rev | R | B | C | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| confinv01 | SOLUSDT | 2023-10-31 00:30 | high | London | Asia | 89 | 4 | 1 | 2 | 0 | 32 | 2.72 | 0.52 | +32b, R 0.52 | +19b, R 1.02 | `confinv01_SOLUSDT_20231031_0030_hi.png` |
| confinv02 | ETHUSDT | 2024-12-03 21:05 | high | NY | Late | 34 | 4 | 0 | 3 | 0 | 34 | 2.80 |  | +34b | +6b, R 2.05 | `confinv02_ETHUSDT_20241203_2105_hi.png` |
| confinv03 | BNBUSDT | 2022-09-13 11:05 | high | Asia | London | 22 | 3 | 0 | 2 | 0 | 17 | 27.57 | 0.95 | +17b, R 0.95 | +17b, R 0.95 | `confinv03_BNBUSDT_20220913_1105_hi.png` |
| confinv04 | BTCUSDT | 2024-12-14 01:00 | high | NY | Asia | 83 | 5 | 1 | 3 | 0 | 33 | 3.64 | 1.15 | +33b, R 1.15 | +33b, R 1.15 | `confinv04_BTCUSDT_20241214_0100_hi.png` |


## `above*` — THE PIN-3 TIE — a bar that both inverted the active gap and closed beyond the take-out extreme. Under A (drawn) it invalidates; the header shows what B and C did with the same event

_Pool: 3,073 events = 14.6% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | inval | tie | delay | rev | R | B | C | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| above01 | BTCUSDT | 2024-07-25 21:20 | high | Asia | Late | 31 | 3 | 0 | 3 | 1 |  | 2.03 |  | +10b, R 0.86 | +10b, R 0.86 | `above01_BTCUSDT_20240725_2120_hi.png` |
| above02 | BNBUSDT | 2024-10-21 13:15 | low | London | NY | 92 | 10 | 0 | 10 | 2 |  | 1.93 |  | +17b, R 0.74 | +10b, R 0.62 | `above02_BNBUSDT_20241021_1315_lo.png` |
| above03 | ETHUSDT | 2026-06-17 08:15 | low | Asia | London | 56 | 3 | 0 | 3 | 1 |  | 0.81 |  | +18b, R 0.06 | +18b, R 0.06 | `above03_ETHUSDT_20260617_0815_lo.png` |
| above04 | BNBUSDT | 2024-07-20 16:00 | high | Asia | NY | 59 | 6 | 0 | 6 | 1 |  | 2.46 |  | +28b, R 1.93 | +28b, R 1.93 | `above04_BNBUSDT_20240720_1600_hi.png` |


## `uncinv*` — UNCONFIRMED — invalidated out; the dominant failure mode of the corrected rule

_Pool: 9,488 events = 44.9% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | inval | tie | delay | rev | R | B | C | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| uncinv01 | ETHUSDT | 2025-09-16 22:05 | high | NY | Late | 22 | 1 | 0 | 1 | 0 |  | 3.36 |  | unconf (invalidated out) | unconf (invalidated out) | `uncinv01_ETHUSDT_20250916_2205_hi.png` |
| uncinv02 | BNBUSDT | 2022-11-06 22:40 | low | NY | Late | 15 | 3 | 0 | 3 | 0 |  | 2.21 |  | unconf (invalidated out) | unconf (invalidated out) | `uncinv02_BNBUSDT_20221106_2240_lo.png` |
| uncinv03 | SOLUSDT | 2024-09-26 14:15 | high | Asia | NY | 80 | 8 | 0 | 8 | 2 |  | 2.03 |  | +24b, R 2.82 | +24b, R 2.82 | `uncinv03_SOLUSDT_20240926_1415_hi.png` |
| uncinv04 | BNBUSDT | 2025-06-01 08:00 | low | London | London | 59 | 4 | 0 | 4 | 1 |  | 1.51 |  | +50b, R 0.02 | +43b, R 0.33 | `uncinv04_BNBUSDT_20250601_0800_lo.png` |


## `unclive*` — UNCONFIRMED — a candidate was still live, un-inverted, when the block ended

_Pool: 850 events = 4.0% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | inval | tie | delay | rev | R | B | C | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| unclive01 | BNBUSDT | 2023-05-23 02:00 | high | London | Asia | 71 | 7 | 0 | 6 | 2 |  | 1.60 |  | +26b, R 2.24 | +26b, R 2.24 | `unclive01_BNBUSDT_20230523_0200_hi.png` |
| unclive02 | SOLUSDT | 2025-11-20 02:05 | high | Asia | Asia | 70 | 4 | 0 | 3 | 0 |  | 2.60 |  | unconf (live at block end) | +50b, R 1.45 | `unclive02_SOLUSDT_20251120_0205_hi.png` |
| unclive03 | BNBUSDT | 2022-08-03 09:10 | high | Asia | London | 45 | 7 | 0 | 6 | 1 |  | 0.77 |  | +24b, R 1.26 | +24b, R 1.26 | `unclive03_BNBUSDT_20220803_0910_hi.png` |
| unclive04 | ETHUSDT | 2025-10-17 06:45 | low | NY | Asia | 14 | 2 | 0 | 1 | 0 |  | 2.17 |  | unconf (live at block end) | unconf (live at block end) | `unclive04_ETHUSDT_20251017_0645_lo.png` |


## `uncnone*` — UNCONFIRMED — no qualifying gap ever formed inside the window

_Pool: 6,401 events = 30.3% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | inval | tie | delay | rev | R | B | C | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| uncnone01 | ETHUSDT | 2024-07-26 22:45 | high | NY | Late | 14 | 0 | 0 | 0 | 0 |  | 2.27 |  | unconf (no candidate) | unconf (no candidate) | `uncnone01_ETHUSDT_20240726_2245_hi.png` |
| uncnone02 | BNBUSDT | 2025-06-15 21:10 | low | NY | Late | 33 | 0 | 0 | 0 | 0 |  | 7.88 |  | unconf (no candidate) | unconf (no candidate) | `uncnone02_BNBUSDT_20250615_2110_lo.png` |
| uncnone03 | SOLUSDT | 2024-06-24 14:05 | high | Asia | NY | 82 | 0 | 0 | 0 | 0 |  | 7.19 |  | unconf (no candidate) | unconf (no candidate) | `uncnone03_SOLUSDT_20240624_1405_hi.png` |
| uncnone04 | BNBUSDT | 2025-12-14 11:45 | low | London | London | 14 | 0 | 0 | 0 | 0 |  | 6.00 |  | unconf (no candidate) | unconf (no candidate) | `uncnone04_BNBUSDT_20251214_1145_lo.png` |
