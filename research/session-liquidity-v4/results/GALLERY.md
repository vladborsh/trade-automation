# Worked-example gallery — session-liquidity v4 (iFVG, no invalidation)

24 real take-outs, drawn by `examples.draw_event`. Selection is stratified across (symbol x direction x level_session x sweep_block) with seed 42 and is **not** hand-curated — re-running `gallery.py` reproduces exactly these panels. Every group gets the same renderer and the same four slots, so the group sizes here say nothing about how common each outcome is (S2 in `TABLES.md` does: 64% confirmed, 30% no candidate, 5% live at block end).

**What to check on a panel** — this is the audit:

1. there is exactly **one horizontal line**: the swept level. It is the boundary, it is fixed, and nothing else is tracked — no invalidation line, no running extreme, no BoS level;
2. numbered zones are the qualifying gaps in **formation order**; green = the one that confirmed, grey = replaced by a later gap and permanently out, orange = still live at block end;
3. only the **latest** live gap can confirm — a close through an older grey zone is not an event;
4. the confirmation is a full **close** through the active gap's far edge (a partial poke never counts), and it must land inside the shaded block window;
5. however far price ran past the boundary first, and however many local highs/lows it printed there, **nothing is discarded** — the header counts both, for reference against what the deleted v3 rule would have done.

`cand`/`repl` are the state-machine counters; `ext` = local extremes printed beyond the take-out bar before the confirmation; `rev` is the wick-anchored reversal and `R` the from-confirmation R proxy, both in ATR(14, 5m) at the take-out bar; `left` = bars of block remaining after the take-out; `v3-A` / `v2` say what the two superseded algorithms did with the same take-out.


## `conf1*` — CONFIRMED with a single candidate — the clean case

_Pool: 5,730 events = 27.1% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | ext | delay | rev | R | v3-A | v2 | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| conf101 | ETHUSDT | 2025-12-27 22:00 | high | NY | Late | 23 | 1 | 0 | 1 | 7 | 4.85 | 0.07 | gave up (3 inval) | same gap | `conf101_ETHUSDT_20251227_2200_hi.png` |
| conf102 | BNBUSDT | 2025-02-24 22:00 | low | NY | Late | 23 | 1 | 0 | 2 | 13 | 3.59 | 0.08 | confirmed | same gap | `conf102_BNBUSDT_20250224_2200_lo.png` |
| conf103 | SOLUSDT | 2025-02-28 13:10 | high | Asia | NY | 93 | 1 | 0 | 1 | 8 | 1.21 | 0.22 | gave up (10 inval) | same gap | `conf103_SOLUSDT_20250228_1310_hi.png` |
| conf104 | BNBUSDT | 2022-09-18 09:45 | low | London | London | 38 | 1 | 0 | 1 | 6 | 6.39 | 0.85 | confirmed | same gap | `conf104_BNBUSDT_20220918_0945_lo.png` |


## `confrep*` — CONFIRMED after a REPLACEMENT — a later gap displaced the live candidate, and the displaced one is permanently out (pin 1)

_Pool: 7,876 events = 37.3% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | ext | delay | rev | R | v3-A | v2 | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| confrep01 | ETHUSDT | 2024-06-18 21:15 | high | NY | Late | 32 | 2 | 1 | 2 | 18 | 1.82 | 0.51 | confirmed | same gap | `confrep01_ETHUSDT_20240618_2115_hi.png` |
| confrep02 | BNBUSDT | 2022-08-19 21:45 | low | NY | Late | 26 | 2 | 1 | 1 | 5 | 1.58 | 0.08 | confirmed | same gap | `confrep02_BNBUSDT_20220819_2145_lo.png` |
| confrep03 | SOLUSDT | 2023-06-23 15:50 | high | Asia | NY | 61 | 3 | 2 | 1 | 6 | 1.80 | 0.55 | confirmed | DIFFERENT gap | `confrep03_SOLUSDT_20230623_1550_hi.png` |
| confrep04 | BNBUSDT | 2023-03-22 09:55 | low | London | London | 36 | 2 | 1 | 4 | 27 | 3.64 | 0.46 | gave up (2 inval) | same gap | `confrep04_BNBUSDT_20230322_0955_lo.png` |


## `multiext*` — THE USER'S DIAGRAM — price crossed the boundary, printed >= 2 further local extremes beyond the take-out bar, and only THEN reversed. Restricted to take-outs the deleted v3 invalidation rule rejected, so every panel here is a signal v3 threw away

_Pool: 6,652 events = 31.5% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | ext | delay | rev | R | v3-A | v2 | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| multiext01 | ETHUSDT | 2025-09-28 22:05 | high | NY | Late | 22 | 4 | 3 | 2 | 14 | 2.91 | 0.16 | gave up (4 inval) | same gap | `multiext01_ETHUSDT_20250928_2205_hi.png` |
| multiext02 | BNBUSDT | 2024-07-24 21:10 | low | NY | Late | 33 | 2 | 1 | 2 | 14 | 3.43 | 0.00 | gave up (4 inval) | same gap | `multiext02_BNBUSDT_20240724_2110_lo.png` |
| multiext03 | SOLUSDT | 2024-01-13 15:30 | high | Asia | NY | 65 | 5 | 4 | 3 | 58 | 4.60 | 0.16 | gave up (5 inval) | same gap | `multiext03_SOLUSDT_20240113_1530_hi.png` |
| multiext04 | BNBUSDT | 2023-03-22 09:55 | low | London | London | 36 | 2 | 1 | 4 | 27 | 3.64 | 0.46 | gave up (2 inval) | same gap | `multiext04_BNBUSDT_20230322_0955_lo.png` |


## `diffgap*` — CONFIRMED through a DIFFERENT gap than v2's retroactive best-pick names — same confirming bar, different gap identity

_Pool: 918 events = 4.3% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | ext | delay | rev | R | v3-A | v2 | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| diffgap01 | BNBUSDT | 2022-08-21 05:15 | high | London | Asia | 32 | 2 | 1 | 3 | 17 | 0.72 | 0.09 | gave up (5 inval) | DIFFERENT gap | `diffgap01_BNBUSDT_20220821_0515_hi.png` |
| diffgap02 | BTCUSDT | 2023-08-28 00:35 | low | London | Asia | 88 | 2 | 1 | 7 | 43 | 2.30 | 0.21 | confirmed | DIFFERENT gap | `diffgap02_BTCUSDT_20230828_0035_lo.png` |
| diffgap03 | BNBUSDT | 2026-05-03 09:05 | high | Asia | London | 46 | 3 | 2 | 2 | 7 | 3.77 | 1.75 | confirmed | DIFFERENT gap | `diffgap03_BNBUSDT_20260503_0905_hi.png` |
| diffgap04 | ETHUSDT | 2024-08-07 13:15 | low | London | NY | 92 | 3 | 2 | 2 | 18 | 3.44 | 0.14 | gave up (5 inval) | DIFFERENT gap | `diffgap04_ETHUSDT_20240807_1315_lo.png` |


## `unclive*` — UNCONFIRMED — a candidate was still live, un-inverted, when the block ended

_Pool: 1,111 events = 5.3% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | ext | delay | rev | R | v3-A | v2 | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| unclive01 | SOLUSDT | 2022-10-23 18:00 | high | Asia | NY | 35 | 3 | 2 | 1 |  | 3.40 |  | gave up (0 inval) | unconfirmed | `unclive01_SOLUSDT_20221023_1800_hi.png` |
| unclive02 | BTCUSDT | 2024-01-27 19:35 | high | Asia | NY | 16 | 1 | 0 | 2 |  | 2.31 |  | gave up (1 inval) | unconfirmed | `unclive02_BTCUSDT_20240127_1935_hi.png` |
| unclive03 | BTCUSDT | 2024-04-17 08:45 | low | Asia | London | 50 | 5 | 4 | 4 |  | 2.57 |  | gave up (5 inval) | unconfirmed | `unclive03_BTCUSDT_20240417_0845_lo.png` |
| unclive04 | BNBUSDT | 2023-01-30 09:05 | low | London | London | 46 | 1 | 0 | 7 |  | 1.77 |  | gave up (1 inval) | unconfirmed | `unclive04_BNBUSDT_20230130_0905_lo.png` |


## `uncnone*` — UNCONFIRMED — no qualifying gap ever formed inside the window

_Pool: 6,401 events = 30.3% of the 21,118-event primary sample._

| # | asset | take-out (UTC) | side | level | block | left | cand | repl | ext | delay | rev | R | v3-A | v2 | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| uncnone01 | ETHUSDT | 2024-07-26 22:45 | high | NY | Late | 14 | 0 | 0 | 0 |  | 2.27 |  | gave up (0 inval) | unconfirmed | `uncnone01_ETHUSDT_20240726_2245_hi.png` |
| uncnone02 | BNBUSDT | 2025-06-15 21:10 | low | NY | Late | 33 | 0 | 0 | 0 |  | 7.88 |  | gave up (0 inval) | unconfirmed | `uncnone02_BNBUSDT_20250615_2110_lo.png` |
| uncnone03 | SOLUSDT | 2024-06-24 14:05 | high | Asia | NY | 82 | 0 | 0 | 1 |  | 7.19 |  | gave up (0 inval) | unconfirmed | `uncnone03_SOLUSDT_20240624_1405_hi.png` |
| uncnone04 | BNBUSDT | 2025-12-14 11:45 | low | London | London | 14 | 0 | 0 | 0 |  | 6.00 |  | gave up (0 inval) | unconfirmed | `uncnone04_BNBUSDT_20251214_1145_lo.png` |
