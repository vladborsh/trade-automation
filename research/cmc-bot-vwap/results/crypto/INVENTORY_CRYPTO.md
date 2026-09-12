# INVENTORY — crypto extension (BTCUSDT, ETHUSDT USD-M perps): counts only

Produced by `crypto/inventory_crypto.py` from the same `engine.py` that is bit-exact against the bot's TypeScript on Capital.com and on this Binance tape (`results/crypto/PARITY_CRYPTO.md`). **No R, no win rate, no PnL.** Every mechanic parameter is the bot's own (VWAP/ATR band [2.5, 11.5], iFVG ATR cap 8, stop-shrink table, 3R target, BE/+1R trail, 2-loss/1-win daily caps). **As-deployed** = caps on; **caps off** = daily caps removed, one-open-order-per-direction kept.

## Summary

| symbol | condition | orders as-deployed | per 12 mo | orders caps off | per 12 mo | gate-passing bars suppressed by caps | signals blocked by open same-dir order |
|---|---|---|---|---|---|---|---|
| BTCUSDT | win | 1,309 | 318 | 1,677 | 408 | 629 | 834 |
| BTCUSDT | all | 2,845 | 691 | 17,095 | 4,154 | 28,248 | 2,764 |
| ETHUSDT | win | 1,145 | 278 | 1,377 | 335 | 388 | 674 |
| ETHUSDT | all | 2,859 | 695 | 15,567 | 3,783 | 24,643 | 2,606 |

Span: 2022-08-01 .. 2026-09-11 23:59 UTC (49.4 months).

### BTCUSDT — (a) NY window — entry 09:40–11:40 NY, alive 09:40–14:30 NY, Mon–Fri

- **Orders, as-deployed: 1,309** (636 sell / 673 buy) ≈ **318 per 12 months**.
- **Orders, caps off: 1,677** ≈ **408 per 12 months**.
- Bars passing every mechanic gate: 2,772; of those, suppressed by the daily 2-loss/1-win caps 629; signal but blocked by an open same-direction order 834.
- Orders on a Saturday/Sunday (UTC): 0. Orders still open at the last bar: 0. Bars where `VWAP([])` throws (the 00:00 UTC bar — the bias window starts at 00:01): 0.

| year | as-deployed | caps off |
|---|---|---|
| 2022 | 107 | 122 |
| 2023 | 283 | 339 |
| 2024 | 347 | 465 |
| 2025 | 334 | 439 |
| 2026 | 238 | 312 |

Eligibility funnel (as-deployed; each row conditional on the rows above):

| gate | sell side | buy side |
|---|---|---|
| entry-window minutes evaluated | 130,075 | 130,075 |
|   ... with a non-empty 12h window (market open) | 130,075 | 130,075 |
| VWAP bias set (open above upper band = sell / below lower = buy) | 44,139 | 48,264 |
| band width / ATR(20) in [2.5, 11.5] | 39,139 | 43,320 |
| iFVG in the bias direction on this bar | 4,118 | 4,409 |
| premium (sell) / discount (buy) vs 200-bar midpoint | 3,372 | 3,531 |
| ATR(20) / lastIFVG size < 8 (and lastIFVG defined) | 2,571 | 2,633 |
| prior-hour high swept (sell) / low swept (buy), last 6 bars | 1,378 | 1,394 |
| daily caps not hit (2 losses / 1 win) = processCharts signal | 1,045 | 1,098 |
| no open order in the same direction | 636 | 673 |
| order placed (stop and target truthy) | 636 | 673 |

### BTCUSDT — (b) unrestricted — every minute, 24/7, never force-closed

- **Orders, as-deployed: 2,845** (1,439 sell / 1,406 buy) ≈ **691 per 12 months**.
- **Orders, caps off: 17,095** ≈ **4,154 per 12 months**.
- Bars passing every mechanic gate: 33,860; of those, suppressed by the daily 2-loss/1-win caps 28,248; signal but blocked by an open same-direction order 2,764.
- Orders on a Saturday/Sunday (UTC): 818. Orders still open at the last bar: 0. Bars where `VWAP([])` throws (the 00:00 UTC bar — the bias window starts at 00:01): 1,503.

| year | as-deployed | caps off |
|---|---|---|
| 2022 | 299 | 1,477 |
| 2023 | 692 | 3,685 |
| 2024 | 683 | 4,453 |
| 2025 | 680 | 4,560 |
| 2026 | 491 | 2,920 |

Signal-bar hour, New York time (as-deployed): 00h 151, 01h 94, 02h 49, 03h 35, 04h 17, 05h 12, 06h 8, 07h 4, 08h 2, 09h 2, 10h 4, 12h 2, 19h 135, 20h 669, 21h 886, 22h 530, 23h 245

Eligibility funnel (as-deployed; each row conditional on the rows above):

| gate | sell side | buy side |
|---|---|---|
| entry-window minutes evaluated | 2,164,320 | 2,164,320 |
|   ... with a non-empty 12h window (market open) | 2,164,320 | 2,164,320 |
| VWAP bias set (open above upper band = sell / below lower = buy) | 718,431 | 677,978 |
| band width / ATR(20) in [2.5, 11.5] | 433,639 | 436,987 |
| iFVG in the bias direction on this bar | 49,453 | 49,761 |
| premium (sell) / discount (buy) vs 200-bar midpoint | 41,471 | 41,104 |
| ATR(20) / lastIFVG size < 8 (and lastIFVG defined) | 33,236 | 32,634 |
| prior-hour high swept (sell) / low swept (buy), last 6 bars | 17,263 | 16,597 |
| daily caps not hit (2 losses / 1 win) = processCharts signal | 2,791 | 2,821 |
| no open order in the same direction | 1,442 | 1,406 |
| order placed (stop and target truthy) | 1,439 | 1,406 |

### ETHUSDT — (a) NY window — entry 09:40–11:40 NY, alive 09:40–14:30 NY, Mon–Fri

- **Orders, as-deployed: 1,145** (546 sell / 599 buy) ≈ **278 per 12 months**.
- **Orders, caps off: 1,377** ≈ **335 per 12 months**.
- Bars passing every mechanic gate: 2,207; of those, suppressed by the daily 2-loss/1-win caps 388; signal but blocked by an open same-direction order 674.
- Orders on a Saturday/Sunday (UTC): 0. Orders still open at the last bar: 0. Bars where `VWAP([])` throws (the 00:00 UTC bar — the bias window starts at 00:01): 0.

| year | as-deployed | caps off |
|---|---|---|
| 2022 | 97 | 109 |
| 2023 | 261 | 314 |
| 2024 | 289 | 361 |
| 2025 | 280 | 334 |
| 2026 | 218 | 259 |

Eligibility funnel (as-deployed; each row conditional on the rows above):

| gate | sell side | buy side |
|---|---|---|
| entry-window minutes evaluated | 130,075 | 130,075 |
|   ... with a non-empty 12h window (market open) | 130,075 | 130,075 |
| VWAP bias set (open above upper band = sell / below lower = buy) | 41,505 | 48,037 |
| band width / ATR(20) in [2.5, 11.5] | 35,924 | 43,193 |
| iFVG in the bias direction on this bar | 3,504 | 4,116 |
| premium (sell) / discount (buy) vs 200-bar midpoint | 2,726 | 3,196 |
| ATR(20) / lastIFVG size < 8 (and lastIFVG defined) | 2,122 | 2,402 |
| prior-hour high swept (sell) / low swept (buy), last 6 bars | 1,076 | 1,131 |
| daily caps not hit (2 losses / 1 win) = processCharts signal | 876 | 943 |
| no open order in the same direction | 546 | 599 |
| order placed (stop and target truthy) | 546 | 599 |

### ETHUSDT — (b) unrestricted — every minute, 24/7, never force-closed

- **Orders, as-deployed: 2,859** (1,478 sell / 1,381 buy) ≈ **695 per 12 months**.
- **Orders, caps off: 15,567** ≈ **3,783 per 12 months**.
- Bars passing every mechanic gate: 30,113; of those, suppressed by the daily 2-loss/1-win caps 24,643; signal but blocked by an open same-direction order 2,606.
- Orders on a Saturday/Sunday (UTC): 824. Orders still open at the last bar: 0. Bars where `VWAP([])` throws (the 00:00 UTC bar — the bias window starts at 00:01): 1,503.

| year | as-deployed | caps off |
|---|---|---|
| 2022 | 297 | 1,387 |
| 2023 | 689 | 3,491 |
| 2024 | 696 | 4,079 |
| 2025 | 683 | 4,026 |
| 2026 | 494 | 2,584 |

Signal-bar hour, New York time (as-deployed): 00h 161, 01h 117, 02h 57, 03h 43, 04h 22, 05h 10, 06h 7, 07h 9, 08h 8, 09h 10, 10h 4, 11h 3, 12h 4, 13h 3, 16h 2, 19h 115, 20h 581, 21h 827, 22h 554, 23h 322

Eligibility funnel (as-deployed; each row conditional on the rows above):

| gate | sell side | buy side |
|---|---|---|
| entry-window minutes evaluated | 2,164,320 | 2,164,320 |
|   ... with a non-empty 12h window (market open) | 2,164,320 | 2,164,320 |
| VWAP bias set (open above upper band = sell / below lower = buy) | 724,886 | 677,410 |
| band width / ATR(20) in [2.5, 11.5] | 459,861 | 454,817 |
| iFVG in the bias direction on this bar | 48,655 | 47,564 |
| premium (sell) / discount (buy) vs 200-bar midpoint | 40,006 | 38,226 |
| ATR(20) / lastIFVG size < 8 (and lastIFVG defined) | 31,598 | 29,812 |
| prior-hour high swept (sell) / low swept (buy), last 6 bars | 15,704 | 14,409 |
| daily caps not hit (2 losses / 1 win) = processCharts signal | 2,898 | 2,572 |
| no open order in the same direction | 1,483 | 1,381 |
| order placed (stop and target truthy) | 1,478 | 1,381 |

