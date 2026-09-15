# INVENTORY — Stage 0 signal inventory (counts only; no R, no win rate)

Produced by `inventory.py` from the parity-proven port over each instrument's whole Capital.com 1-minute history. **As-deployed** = the bot exactly as coded, daily 2-loss/1-win caps on. **Caps off** = same stream with the daily caps removed (the ≤1-open-per-direction rule kept), the population a Stage 1 pass would most likely use as primary, as in the smart-money ruling.

## Summary

| symbol | history | orders as-deployed | per 12 mo | orders caps off | per 12 mo |
|---|---|---|---|---|---|
| US100 | 2024-01-01 .. 2026-09-11 (32.3 mo) | 895 | 332 | 1150 | 427 |
| US500 | 2024-01-01 .. 2026-09-11 (32.3 mo) | 947 | 352 | 1298 | 482 |
| EURCHF | 2024-01-01 .. 2026-09-11 (32.3 mo) | 239 | 89 | 240 | 89 |
| GBPCHF | 2024-01-01 .. 2026-09-11 (32.3 mo) | 241 | 89 | 243 | 90 |

## US100

- Span evaluated: 2024-01-02 .. 2026-09-11 (32.3 months, 698 weekdays with data in the entry window).
- Entry window 09:40–11:40 NY, alive 09:40–14:30 NY.
- **Orders, as-deployed: 895** (504 sell / 391 buy) ≈ **332 per 12 months**.
- **Orders, caps off: 1150** (653 sell / 497 buy) ≈ **427 per 12 months**.
- Orders whose `lastIFVG` exists only through `getLastIfvg`'s asymmetric branch (bearish iFVG list empty, bullish non-empty — D-03): 0 of 895.
- Live-like read (PARITY.md L-01, bar T−1 at gate T): 898 orders; 881 of them are the same (bar, direction) as an as-deployed order one bar earlier.

- Mechanical facts (for PARITY.md): evaluated bars 84,458; 12h window short of 721 bars (missing minutes) on 2,606; fewer than 201 bars (no 200-bar range) on 0; bar at T missing so the previous bar is re-read on 185; VWAP([]) throws (no bar since UTC midnight, D-18) on 0; bullish-iFVG list empty (lastIFVG undefined, gate blocked) on 8,887; asymmetric D-03 branch live on 10,174. Orders: entry already beyond its stop anchor (close broke the 200-bar extreme that excludes the current bar) 0; zero-size stop 0; entry time ≠ signal bar + 1 min 2; signal on a re-read stale bar 0.

| year | as-deployed | caps off |
|---|---|---|
| 2024 | 327 | 436 |
| 2025 | 329 | 410 |
| 2026 | 239 | 304 |

Orders per month (as-deployed): 2024-01 26, 2024-02 25, 2024-03 23, 2024-04 29, 2024-05 28, 2024-06 24, 2024-07 32, 2024-08 29, 2024-09 28, 2024-10 26, 2024-11 28, 2024-12 29, 2025-01 26, 2025-02 26, 2025-03 27, 2025-04 30, 2025-05 32, 2025-06 27, 2025-07 27, 2025-08 27, 2025-09 24, 2025-10 29, 2025-11 27, 2025-12 27, 2026-01 28, 2026-02 30, 2026-03 25, 2026-04 32, 2026-05 30, 2026-06 28, 2026-07 33, 2026-08 26, 2026-09 7

Eligibility funnel over every evaluated bar (as-deployed; each row conditional on the ones above):

| gate | sell side | buy side |
|---|---|---|
| entry-window minutes evaluated | 85,184 | 85,184 |
|   ... with a non-empty 12h window (market open) | 84,458 | 84,458 |
| VWAP bias set (open above upper band = sell / below lower = buy) | 34,320 | 29,260 |
| band width / ATR(20) in [2.5, 11.5] | 29,551 | 24,855 |
| iFVG in the bias direction on this bar | 2,612 | 2,302 |
| premium (sell) / discount (buy) vs 200-bar midpoint | 2,215 | 1,901 |
| ATR(20) / lastIFVG size < 8 (and lastIFVG defined) | 1,666 | 1,411 |
| prior-hour high swept (sell) / low swept (buy), last 6 bars | 1,034 | 825 |
| daily caps not hit (2 losses / 1 win) = processCharts signal | 786 | 647 |
| no open order in the same direction | 504 | 391 |
| order placed (stop and target truthy) | 504 | 391 |

## US500

- Span evaluated: 2024-01-02 .. 2026-09-11 (32.3 months, 698 weekdays with data in the entry window).
- Entry window 09:40–11:40 NY, alive 09:40–14:30 NY.
- **Orders, as-deployed: 947** (560 sell / 387 buy) ≈ **352 per 12 months**.
- **Orders, caps off: 1298** (749 sell / 549 buy) ≈ **482 per 12 months**.
- Orders whose `lastIFVG` exists only through `getLastIfvg`'s asymmetric branch (bearish iFVG list empty, bullish non-empty — D-03): 0 of 947.
- Live-like read (PARITY.md L-01, bar T−1 at gate T): 944 orders; 922 of them are the same (bar, direction) as an as-deployed order one bar earlier.

- Mechanical facts (for PARITY.md): evaluated bars 84,458; 12h window short of 721 bars (missing minutes) on 49,426; fewer than 201 bars (no 200-bar range) on 0; bar at T missing so the previous bar is re-read on 300; VWAP([]) throws (no bar since UTC midnight, D-18) on 0; bullish-iFVG list empty (lastIFVG undefined, gate blocked) on 4,518; asymmetric D-03 branch live on 4,226. Orders: entry already beyond its stop anchor (close broke the 200-bar extreme that excludes the current bar) 0; zero-size stop 1; entry time ≠ signal bar + 1 min 0; signal on a re-read stale bar 0.

| year | as-deployed | caps off |
|---|---|---|
| 2024 | 348 | 489 |
| 2025 | 356 | 490 |
| 2026 | 243 | 319 |

Orders per month (as-deployed): 2024-01 32, 2024-02 24, 2024-03 25, 2024-04 24, 2024-05 30, 2024-06 29, 2024-07 29, 2024-08 31, 2024-09 28, 2024-10 29, 2024-11 33, 2024-12 34, 2025-01 32, 2025-02 28, 2025-03 27, 2025-04 33, 2025-05 29, 2025-06 32, 2025-07 29, 2025-08 31, 2025-09 28, 2025-10 31, 2025-11 29, 2025-12 27, 2026-01 33, 2026-02 26, 2026-03 25, 2026-04 25, 2026-05 32, 2026-06 26, 2026-07 35, 2026-08 27, 2026-09 14

Eligibility funnel over every evaluated bar (as-deployed; each row conditional on the ones above):

| gate | sell side | buy side |
|---|---|---|
| entry-window minutes evaluated | 85,184 | 85,184 |
|   ... with a non-empty 12h window (market open) | 84,458 | 84,458 |
| VWAP bias set (open above upper band = sell / below lower = buy) | 35,958 | 26,406 |
| band width / ATR(20) in [2.5, 11.5] | 31,871 | 23,424 |
| iFVG in the bias direction on this bar | 2,870 | 2,268 |
| premium (sell) / discount (buy) vs 200-bar midpoint | 2,386 | 1,948 |
| ATR(20) / lastIFVG size < 8 (and lastIFVG defined) | 1,983 | 1,585 |
| prior-hour high swept (sell) / low swept (buy), last 6 bars | 1,235 | 895 |
| daily caps not hit (2 losses / 1 win) = processCharts signal | 906 | 625 |
| no open order in the same direction | 560 | 387 |
| order placed (stop and target truthy) | 560 | 387 |

## EURCHF

- Span evaluated: 2024-01-02 .. 2026-09-11 (32.3 months, 704 weekdays with data in the entry window).
- Entry window 03:02–03:20 NY, alive 03:00–04:00 NY.
- **Orders, as-deployed: 239** (120 sell / 119 buy) ≈ **89 per 12 months**.
- **Orders, caps off: 240** (120 sell / 120 buy) ≈ **89 per 12 months**.
- Orders whose `lastIFVG` exists only through `getLastIfvg`'s asymmetric branch (bearish iFVG list empty, bullish non-empty — D-03): 0 of 239.
- Live-like read (PARITY.md L-01, bar T−1 at gate T): 234 orders; 219 of them are the same (bar, direction) as an as-deployed order one bar earlier.

- Mechanical facts (for PARITY.md): evaluated bars 13,376; 12h window short of 721 bars (missing minutes) on 13,376; fewer than 201 bars (no 200-bar range) on 76; bar at T missing so the previous bar is re-read on 77; VWAP([]) throws (no bar since UTC midnight, D-18) on 76; bullish-iFVG list empty (lastIFVG undefined, gate blocked) on 784; asymmetric D-03 branch live on 849. Orders: entry already beyond its stop anchor (close broke the 200-bar extreme that excludes the current bar) 0; zero-size stop 0; entry time ≠ signal bar + 1 min 0; signal on a re-read stale bar 0.

| year | as-deployed | caps off |
|---|---|---|
| 2024 | 82 | 82 |
| 2025 | 100 | 101 |
| 2026 | 57 | 57 |

Orders per month (as-deployed): 2024-01 6, 2024-02 4, 2024-03 10, 2024-04 3, 2024-05 7, 2024-06 9, 2024-07 7, 2024-08 5, 2024-09 11, 2024-10 11, 2024-11 3, 2024-12 6, 2025-01 3, 2025-02 12, 2025-03 5, 2025-04 11, 2025-05 7, 2025-06 12, 2025-07 9, 2025-08 4, 2025-09 13, 2025-10 9, 2025-11 7, 2025-12 8, 2026-01 5, 2026-02 7, 2026-03 6, 2026-04 11, 2026-05 9, 2026-06 2, 2026-07 9, 2026-08 4, 2026-09 4

Eligibility funnel over every evaluated bar (as-deployed; each row conditional on the ones above):

| gate | sell side | buy side |
|---|---|---|
| entry-window minutes evaluated | 13,376 | 13,376 |
|   ... with a non-empty 12h window (market open) | 13,376 | 13,376 |
| VWAP bias set (open above upper band = sell / below lower = buy) | 4,836 | 4,515 |
| band width / ATR(20) in [2.5, 11.5] | 4,390 | 3,980 |
| iFVG in the bias direction on this bar | 465 | 441 |
| premium (sell) / discount (buy) vs 200-bar midpoint | 387 | 368 |
| ATR(20) / lastIFVG size < 8 (and lastIFVG defined) | 301 | 296 |
| prior-hour high swept (sell) / low swept (buy), last 6 bars | 162 | 168 |
| daily caps not hit (2 losses / 1 win) = processCharts signal | 162 | 167 |
| no open order in the same direction | 120 | 119 |
| order placed (stop and target truthy) | 120 | 119 |

## GBPCHF

- Span evaluated: 2024-01-02 .. 2026-09-11 (32.3 months, 704 weekdays with data in the entry window).
- Entry window 03:03–03:20 NY, alive 03:00–05:00 NY.
- **Orders, as-deployed: 241** (125 sell / 116 buy) ≈ **89 per 12 months**.
- **Orders, caps off: 243** (127 sell / 116 buy) ≈ **90 per 12 months**.
- Orders whose `lastIFVG` exists only through `getLastIfvg`'s asymmetric branch (bearish iFVG list empty, bullish non-empty — D-03): 1 of 241.
- Live-like read (PARITY.md L-01, bar T−1 at gate T): 238 orders; 227 of them are the same (bar, direction) as an as-deployed order one bar earlier.

- Mechanical facts (for PARITY.md): evaluated bars 12,672; 12h window short of 721 bars (missing minutes) on 12,672; fewer than 201 bars (no 200-bar range) on 72; bar at T missing so the previous bar is re-read on 73; VWAP([]) throws (no bar since UTC midnight, D-18) on 72; bullish-iFVG list empty (lastIFVG undefined, gate blocked) on 1,283; asymmetric D-03 branch live on 1,153. Orders: entry already beyond its stop anchor (close broke the 200-bar extreme that excludes the current bar) 0; zero-size stop 0; entry time ≠ signal bar + 1 min 0; signal on a re-read stale bar 0.

| year | as-deployed | caps off |
|---|---|---|
| 2024 | 81 | 81 |
| 2025 | 98 | 100 |
| 2026 | 62 | 62 |

Orders per month (as-deployed): 2024-01 7, 2024-02 7, 2024-03 6, 2024-04 4, 2024-05 6, 2024-06 10, 2024-07 7, 2024-08 7, 2024-09 7, 2024-10 8, 2024-11 6, 2024-12 6, 2025-01 7, 2025-02 9, 2025-03 8, 2025-04 10, 2025-05 11, 2025-06 8, 2025-07 8, 2025-08 6, 2025-09 6, 2025-10 15, 2025-11 5, 2025-12 5, 2026-01 6, 2026-02 8, 2026-03 10, 2026-04 6, 2026-05 9, 2026-06 7, 2026-07 8, 2026-08 6, 2026-09 2

Eligibility funnel over every evaluated bar (as-deployed; each row conditional on the ones above):

| gate | sell side | buy side |
|---|---|---|
| entry-window minutes evaluated | 12,672 | 12,672 |
|   ... with a non-empty 12h window (market open) | 12,672 | 12,672 |
| VWAP bias set (open above upper band = sell / below lower = buy) | 4,941 | 4,590 |
| band width / ATR(20) in [2.5, 11.5] | 4,344 | 4,013 |
| iFVG in the bias direction on this bar | 436 | 398 |
| premium (sell) / discount (buy) vs 200-bar midpoint | 356 | 333 |
| ATR(20) / lastIFVG size < 8 (and lastIFVG defined) | 293 | 273 |
| prior-hour high swept (sell) / low swept (buy), last 6 bars | 178 | 162 |
| daily caps not hit (2 losses / 1 win) = processCharts signal | 176 | 162 |
| no open order in the same direction | 125 | 116 |
| order placed (stop and target truthy) | 125 | 116 |

