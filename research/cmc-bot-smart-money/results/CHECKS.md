# Stage-0 checks

| check | result | detail |
|---|---|---|
| C1 literal transcription of indicatorScript | PASS | 80 windows, 0 mismatches |
| C2 ATR(20) matches the literal transcription | PASS | 0 mismatches |
| C3 every evaluated bar is 09:40-11:10 New York, Mon-Fri, 91 bars/day | PASS | 95,095 bars, 91..91 per day |
| C4 prefix-causality, M1 path (>=200 sampled signals, 0 lookahead) | PASS | 240/240 re-derived identically from a truncated tape |
| C5 D-06 measured: signals surviving a CAUSAL (partial-last-hour) H1 frame | PASS | 195/240 unchanged, 45 changed -> see results/C5_h1_lookahead.txt |
| C6 stop/target arithmetic re-derived from scratch | PASS | 5,795 signals, R:R = 2.700000..2.700000 |
| C7 the {0.5, 0.7, 1.0} shrink table fires in all three branches | PASS | {0.5: 1621, 0.7: 1181, 1.0: 2993} |
| C8 D-01: no signal is possible while either iFVG list is empty | PASS | 69,335/380,380 in-window bars blocked by the undefined lastIFVG |
| C9 D-02: the H1 bias default is sell-leaning | PASS | 53.0% of in-window bars carry a sell bias |
| C10 the two entry branches are mutually exclusive and fully gated | PASS | 2,989 sell / 2,806 buy |
| C11 at most one open order per direction at any time | PASS |  |
| C12 no position survives 11:10 New York | PASS | max hold 90 min, latest exit 670 min past midnight NY |
| C13 every recorded TypeScript parity fixture reproduces | PASS | 4 fixtures, 0 failing  |

**13/13 PASS**
