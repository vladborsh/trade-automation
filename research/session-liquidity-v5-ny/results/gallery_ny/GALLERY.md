# NY-window worked-example gallery — session-liquidity v5-NY

Up to 24 real take-outs, drawn by `examples.draw_event`. **Every panel is an event whose confirmation landed inside the pinned NY window (13:40–15:20 UTC = 09:40–11:20 New York at UTC−4)** — the exact population the pre-registered test ran on. BTC and ETH only (DESIGN §2.3).

Selection is stratified across (symbol × direction × level_session) with seed 42 and is **not** hand-curated — re-running `gallery.py` reproduces exactly these panels. Every group gets the same renderer and the same three slots, so the group sizes here say nothing about how common each outcome is (`results/HYPOTHESIS.md` P1 does).

## What to check on a panel — this is the audit

1. the **green ray** starts on its own pivot bar, that bar is **before** the dotted `t0` line, and the thin green dotted vertical (the bar the pivot was confirmed on) is also at or before `t0`;
2. the green ray is **flat all the way across — it never steps**. That is the entire BoS correction: the anchor is chosen once, at `t0`, and is fixed for the event's life;
3. the **red step-line** is what a re-anchoring implementation would have tested over the same window. Every step is a pivot that confirmed *after* the take-out. It is drawn purely as the contrast — no number in this pass uses it;
4. the **grey boxes** are qualifying iFVG gaps the state machine held and then discarded when a newer one formed, numbered in formation order; the **blue box** is the one that was active when price closed through it. A grey box that would have 'worked better' proves nothing — it was not the active candidate at that moment, and that is the point;
5. the confirmation is a full **close** through the ray or the gap edge, inside the shaded block window — a wick through it is not an event;
6. the **orange band** is the NY window. The confirmation marker must sit inside it on every panel in this gallery;
7. the black / red / green horizontal brackets are the pinned trade: entry at the confirmation close, stop at the sweep leg's running extreme, target one stop-width away;
8. there is deliberately **no star on the take-out wick** (user preference); the take-out is the dotted vertical `t0` line.

`left` = bars of block remaining at the take-out; `age` = bars from the BoS anchor pivot to `t0`; `dist` = |take-out wick − anchor| in ATR; `gaps` = qualifying iFVG candidates seen / displaced; `delay` = bars from `t0` to the confirmation; `stop` = the pinned stop proxy in ATR; `netR` = the pinned trade's result after 0.10% round-trip cost, block horizon; `netR 24h` = the same trade on the long horizon.


## `ifvg_target*` — **iFVG-v4**, confirmed inside the NY window, and the pinned trade reached +1R.

_Pool: 471 events. Subject mechanic drawn: **iFVG-v4**._

| # | asset | take-out (UTC) | side | level | left | age | dist | gaps | delay | stop | exit | netR | netR 24h | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ifvg_target01 | ETHUSDT | 2024-03-20 13:40 | high | NY | 87 | 6 | 2.09 | 1/0 | 17 | 1.20 | target | +0.84 | +0.84 | `ifvg_target01_ETHUSDT_20240320_1340_hi.png` |
| ifvg_target02 | ETHUSDT | 2025-04-21 13:35 | low | London | 88 | 17 | 3.79 | 1/0 | 7 | 3.14 | target | +0.87 | +0.87 | `ifvg_target02_ETHUSDT_20250421_1335_lo.png` |
| ifvg_target03 | ETHUSDT | 2024-12-09 14:45 | high | London | 74 | 5 | 4.78 | 1/0 | 4 | 3.37 | target | +0.90 | +0.90 | `ifvg_target03_ETHUSDT_20241209_1445_hi.png` |


## `ifvg_stop*` — **iFVG-v4**, confirmed inside the NY window, and the pinned trade was stopped out (−1R).

_Pool: 479 events. Subject mechanic drawn: **iFVG-v4**._

| # | asset | take-out (UTC) | side | level | left | age | dist | gaps | delay | stop | exit | netR | netR 24h | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ifvg_stop01 | ETHUSDT | 2023-09-30 13:50 | high | London | 85 | 8 | 4.80 | 1/0 | 14 | 5.06 | stop | -1.23 | -1.23 | `ifvg_stop01_ETHUSDT_20230930_1350_hi.png` |
| ifvg_stop02 | ETHUSDT | 2026-01-18 13:40 | high | NY | 87 | 4 | 4.96 | 2/1 | 12 | 5.30 | stop | -1.19 | -1.19 | `ifvg_stop02_ETHUSDT_20260118_1340_hi.png` |
| ifvg_stop03 | BTCUSDT | 2024-12-06 13:40 | high | Asia | 87 | 3 | 4.68 | 2/1 | 16 | 2.51 | stop | -1.15 | -1.15 | `ifvg_stop03_BTCUSDT_20241206_1340_hi.png` |


## `ifvg_mtm*` — **iFVG-v4**, confirmed inside the NY window, and neither barrier was reached — marked to market at the block's last close.

_Pool: 106 events. Subject mechanic drawn: **iFVG-v4**._

| # | asset | take-out (UTC) | side | level | left | age | dist | gaps | delay | stop | exit | netR | netR 24h | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ifvg_mtm01 | BTCUSDT | 2026-07-02 13:05 | high | London | 94 | 10 | 3.85 | 1/0 | 17 | 4.35 | mtm | -0.06 | -0.76 | `ifvg_mtm01_BTCUSDT_20260702_1305_hi.png` |
| ifvg_mtm02 | ETHUSDT | 2024-12-03 13:50 | low | NY | 85 | 11 | 4.93 | 1/0 | 10 | 4.76 | mtm | +0.86 | +0.94 | `ifvg_mtm02_ETHUSDT_20241203_1350_lo.png` |
| ifvg_mtm03 | BTCUSDT | 2025-12-06 14:15 | high | Asia | 80 | 4 | 6.83 | 1/0 | 12 | 7.85 | mtm | -0.13 | +0.88 | `ifvg_mtm03_BTCUSDT_20251206_1415_hi.png` |


## `bos_target*` — **BoS pinned anchor**, confirmed inside the NY window, and the pinned trade reached +1R.

_Pool: 279 events. Subject mechanic drawn: **BoS pinned anchor**._

| # | asset | take-out (UTC) | side | level | left | age | dist | gaps | delay | stop | exit | netR | netR 24h | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bos_target01 | BTCUSDT | 2026-02-24 13:30 | low | Asia | 89 | 4 | 4.64 | 0/0 | 13 | 5.14 | target | +0.92 | +0.92 | `bos_target01_BTCUSDT_20260224_1330_lo.png` |
| bos_target02 | ETHUSDT | 2023-10-22 13:25 | high | London | 90 | 8 | 3.62 | 2/1 | 12 | 4.32 | target | +0.80 | +0.80 | `bos_target02_ETHUSDT_20231022_1325_hi.png` |
| bos_target03 | BTCUSDT | 2026-02-09 14:10 | low | NY | 81 | 12 | 4.65 | 0/0 | 5 | 4.81 | target | +0.93 | +0.93 | `bos_target03_BTCUSDT_20260209_1410_lo.png` |


## `bos_stop*` — **BoS pinned anchor**, confirmed inside the NY window, and the pinned trade was stopped out (−1R).

_Pool: 263 events. Subject mechanic drawn: **BoS pinned anchor**._

| # | asset | take-out (UTC) | side | level | left | age | dist | gaps | delay | stop | exit | netR | netR 24h | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bos_stop01 | ETHUSDT | 2023-03-01 13:30 | low | London | 89 | 12 | 5.40 | 2/1 | 15 | 9.32 | stop | -1.07 | -1.07 | `bos_stop01_ETHUSDT_20230301_1330_lo.png` |
| bos_stop02 | ETHUSDT | 2023-06-28 13:05 | low | Asia | 94 | 7 | 5.40 | 1/0 | 18 | 5.97 | stop | -1.08 | -1.08 | `bos_stop02_ETHUSDT_20230628_1305_lo.png` |
| bos_stop03 | BTCUSDT | 2024-08-23 14:10 | high | NY | 81 | 4 | 6.53 | 5/4 | 7 | 8.42 | stop | -1.04 | -1.04 | `bos_stop03_BTCUSDT_20240823_1410_hi.png` |


## `bos_mtm*` — **BoS pinned anchor**, confirmed inside the NY window, and neither barrier was reached — marked to market at the block's last close.

_Pool: 226 events. Subject mechanic drawn: **BoS pinned anchor**._

| # | asset | take-out (UTC) | side | level | left | age | dist | gaps | delay | stop | exit | netR | netR 24h | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bos_mtm01 | BTCUSDT | 2026-05-29 13:05 | low | Asia | 94 | 3 | 2.77 | 2/1 | 24 | 15.45 | mtm | -0.06 | +0.02 | `bos_mtm01_BTCUSDT_20260529_1305_lo.png` |
| bos_mtm02 | BTCUSDT | 2023-01-05 14:00 | low | NY | 83 | 9 | 5.76 | 0/0 | 11 | 5.87 | mtm | +0.16 | -1.20 | `bos_mtm02_BTCUSDT_20230105_1400_lo.png` |
| bos_mtm03 | ETHUSDT | 2026-01-24 13:55 | low | Asia | 84 | 4 | 7.04 | 0/0 | 13 | 8.90 | mtm | -0.47 | -1.16 | `bos_mtm03_ETHUSDT_20260124_1355_lo.png` |


## `both*` — **Both mechanics confirmed inside the window on the same take-out.** The panel shows the two entries and the two stops together; the BoS one is later and several ATR wider, which is the whole difference between the arms' net numbers.

_Pool: 172 events. Subject mechanic drawn: **BoS pinned anchor**._

| # | asset | take-out (UTC) | side | level | left | age | dist | gaps | delay | stop | exit | netR | netR 24h | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| both01 | BTCUSDT | 2024-10-30 13:10 | low | London | 93 | 12 | 3.22 | 1/0 | 11 | 5.09 | mtm | +0.82 | +0.90 | `both01_BTCUSDT_20241030_1310_lo.png` |
| both02 | ETHUSDT | 2025-04-21 13:35 | low | London | 88 | 17 | 3.79 | 1/0 | 10 | 7.40 | stop | -1.06 | -1.06 | `both02_ETHUSDT_20250421_1335_lo.png` |
| both03 | BTCUSDT | 2025-07-08 13:40 | high | London | 87 | 16 | 3.42 | 1/0 | 6 | 6.09 | mtm | -0.20 | -1.18 | `both03_BTCUSDT_20250708_1340_hi.png` |


## `bos_only*` — **BoS confirmed inside the window and the iFVG never confirmed at all** — no qualifying gap ever inverted before the block ended. These are the take-outs where BoS is the only confirmation available.

_Pool: 378 events. Subject mechanic drawn: **BoS pinned anchor**._

| # | asset | take-out (UTC) | side | level | left | age | dist | gaps | delay | stop | exit | netR | netR 24h | file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bos_only01 | ETHUSDT | 2025-11-20 13:30 | high | London | 89 | 10 | 3.13 | 0/0 | 2 | 4.31 | target | +0.94 | +0.94 | `bos_only01_ETHUSDT_20251120_1330_hi.png` |
| bos_only02 | BTCUSDT | 2022-12-30 14:45 | low | Asia | 74 | 7 | 6.60 | 0/0 | 6 | 7.14 | mtm | +0.25 | +0.39 | `bos_only02_BTCUSDT_20221230_1445_lo.png` |
| bos_only03 | ETHUSDT | 2025-02-20 14:05 | high | Asia | 82 | 9 | 5.39 | 0/0 | 9 | 6.37 | mtm | -0.52 | -1.07 | `bos_only03_ETHUSDT_20250220_1405_hi.png` |

