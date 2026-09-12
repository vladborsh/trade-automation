# CHECKS — Stage 0

Produced by `checks.py`.

| check | symbol | result | detail |
|---|---|---|---|
| C1 prefix-causality | US100 | PASS | 100 signals + 50 non-signal bars re-derived on a tape truncated at the bar; 0 differ |
| C2 invariants | US100 | PASS | 895 orders, 0 violations |
| C3 TS parity | US100 | PASS | 33 months, 86,878 evaluated bars (86,878 bit-exact), 895 TS orders vs 895 Python, 0 problems, missing months: none |
| C5 D-01 size (info) | US100 | — | label-timed tape: 712 orders; 0 share (true bar, direction) with the 895 UTC-timed orders |
| C1 prefix-causality | US500 | PASS | 100 signals + 50 non-signal bars re-derived on a tape truncated at the bar; 0 differ |
| C2 invariants | US500 | PASS | 947 orders, 0 violations |
| C3 TS parity | US500 | PASS | 33 months, 86,878 evaluated bars (86,878 bit-exact), 947 TS orders vs 947 Python, 0 problems, missing months: none |
| C5 D-01 size (info) | US500 | — | label-timed tape: 778 orders; 3 share (true bar, direction) with the 947 UTC-timed orders |
| C1 prefix-causality | EURCHF | PASS | 100 signals + 50 non-signal bars re-derived on a tape truncated at the bar; 0 differ |
| C2 invariants | EURCHF | PASS | 239 orders, 0 violations |
| C3 TS parity | EURCHF | PASS | 33 months, 13,642 evaluated bars (13,642 bit-exact), 239 TS orders vs 239 Python, 0 problems, missing months: none |
| C5 D-01 size (info) | EURCHF | — | label-timed tape: 112 orders; 0 share (true bar, direction) with the 239 UTC-timed orders |
| C1 prefix-causality | GBPCHF | PASS | 100 signals + 50 non-signal bars re-derived on a tape truncated at the bar; 0 differ |
| C2 invariants | GBPCHF | PASS | 241 orders, 0 violations |
| C3 TS parity | GBPCHF | PASS | 33 months, 12,924 evaluated bars (12,924 bit-exact), 241 TS orders vs 241 Python, 0 problems, missing months: none |
| C5 D-01 size (info) | GBPCHF | — | label-timed tape: 108 orders; 0 share (true bar, direction) with the 241 UTC-timed orders |
| C4 D-03 unit | TS | CONFIRMED | bullish-only list → lastIFVG defined; bearish-only → undefined |

**Overall: ALL GATING CHECKS PASS**

C5 detail (where the bot's own backtest would actually be trading, in true New York time):

- US100: NY hour of the true bar for label-tape orders: 06h 84, 07h 284, 08h 263, 09h 81
- US500: NY hour of the true bar for label-tape orders: 06h 101, 07h 294, 08h 285, 09h 98
- EURCHF: NY hour of the true bar for label-tape orders: 00h 63, 01h 49
- GBPCHF: NY hour of the true bar for label-tape orders: 00h 57, 01h 51
