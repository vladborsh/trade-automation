# REPORT — ORB exit construction at the New York open (`orb-ny-open-exit`)

**This family re-uses the 2025-08-01 .. 2026-07-31 holdout, already read by the closed `orb-ny-open` and `orb-ny-open-short` passes on the same instruments and the same days. It is the third and last pre-registered ORB look at that year.** α is corrected for all **20** registered arms — 8 (`orb-ny-open`) + 6 (`orb-ny-open-short`) + 6 (this family) — giving **α = 0.05/20 = 0.0025**. A REAL EDGE reached here is weaker evidence than a first-read REAL EDGE and earns a **forward confirmation on later tape, not a build**. After this family, any further ORB registration on these two instruments — of any kind — must use tape from 2026-08-01 onward; this pass closes the year for ORB.

Pre-registered in `research/orb-ny-open/ARCHITECT-NOTE-EXIT-CONSTRUCTION.md` (`89365fd`) and its mechanical restatement `DESIGN.md` in this package, **committed before any R was computed on any arm**. Nothing in the mechanic, the fills, the costs, the calendar, the nulls, the bootstrap or the ladder was changed after a number was seen; the one amendment, made before any R existed and escalated to the Architect rather than decided locally, is logged in `DESIGN.md` §12.

**No slippage is modelled anywhere, so every number below is optimistic.** Costs are half the entry minute's spread plus half the exit minute's, over `stop_dist`; no commission, no financing.

## 1. What this family tested

Two closed passes, fourteen arms, end on one sentence: after the trigger the tape moves further in the breakout direction than a random comparable bar — median forward lift 1.04–1.65 on every arm — and the +1R-target / full-range-stop construction converts none of it. That is a statement about the **exit**. So the entry was frozen and the exit became the axis.

There are exactly three places a real directional lift can fail to become money, and each registered arm is one of them:

| arm | construction | hypothesis | external anchor |
|---|---|---|---|
| **E0** | range stop, no target, flat 16:00 NY | **the cap** — the +1R target truncates a right tail that averages more than 1R | the Zarattini–Aziz 2023 base shape on this project's trigger |
| **E1** | range stop, no target, **1R ratchet**, flat 16:00 NY | **the give-back** — the run happens and is handed back before the exit | parameter-free; the continuous form of this project's own breakeven-at-1R rule |
| **E2** | stop at **0.10 × dATR14**, no target, flat 16:00 NY | **the stop width** — the range stop is far wider than the noise a genuine breakout must survive | the Zarattini–Barbon–Aziz 2024 exit verbatim |

E1 **nests** E0 (E1 = E0 + ratchet), so the pair attributes: if E1 passes and E0 does not, the ratchet is the finding, by construction. The +1R corner of the grid is the already-killed `OR5` arm of the short pass, quoted on the fit period, **its holdout never computed**.

## 2. The grid — every cell, fit and holdout

α = 0.0025. Kill bar +0.05R, build bar +0.10R, power floor 150 holdout trades. A screened-out arm's holdout was **never computed** and its holdout cells are blank — the blank is the point. The quoted +1R corner is read from the short pass and its holdout is blank for the same reason.

### US100

| cell | exit construction | n fit | fit mean net R | fit p (Null A) | screen | n holdout | holdout mean net R | holdout p (Null A) | 90 % interval | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| **+1R (quoted)** | range stop, **+1R target**, flat 16:00 | 391 | +0.0481 | — (not re-run) | *killed in `orb-ny-open-short`* | — | **never computed** | — | — | NO EDGE — KILL (quoted from the short pass) |
| **E0** | range stop, no target, flat 16:00 NY | 391 | +0.1220 | 0.022 | **PASS** | 248 | **-0.0126** | 0.4590 | [-0.154, +0.150] | **NO EDGE — KILL** |
| **E1** | range stop, no target, 1R ratchet, flat 16:00 NY | 391 | +0.0397 | 0.098 | **SCREENED OUT** | — | **never computed** | — | — | NO EDGE — KILL (fit screen) |
| **E2** | stop at 0.10 x dATR14, no target, flat 16:00 NY | 379 | +0.1037 | 0.126 | **SCREENED OUT** | — | **never computed** | — | — | NO EDGE — KILL (fit screen) |

- `US100-E1` screened out: fit mean net R +0.0397R < +0.05R; fit-period Null-A p = 0.098 > 0.05.
- `US100-E2` screened out: fit-period Null-A p = 0.126 > 0.05.

### US500

| cell | exit construction | n fit | fit mean net R | fit p (Null A) | screen | n holdout | holdout mean net R | holdout p (Null A) | 90 % interval | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| **+1R (quoted)** | range stop, **+1R target**, flat 16:00 | 392 | -0.0295 | — (not re-run) | *killed in `orb-ny-open-short`* | — | **never computed** | — | — | NO EDGE — KILL (quoted from the short pass) |
| **E0** | range stop, no target, flat 16:00 NY | 392 | -0.0489 | 0.702 | **SCREENED OUT** | — | **never computed** | — | — | NO EDGE — KILL (fit screen) |
| **E1** | range stop, no target, 1R ratchet, flat 16:00 NY | 392 | -0.0542 | 0.742 | **SCREENED OUT** | — | **never computed** | — | — | NO EDGE — KILL (fit screen) |
| **E2** | stop at 0.10 x dATR14, no target, flat 16:00 NY | 380 | -0.0537 | 0.652 | **SCREENED OUT** | — | **never computed** | — | — | NO EDGE — KILL (fit screen) |

- `US500-E0` screened out: fit mean net R -0.0489R < +0.05R; fit-period Null-A p = 0.702 > 0.05.
- `US500-E1` screened out: fit mean net R -0.0542R < +0.05R; fit-period Null-A p = 0.742 > 0.05.
- `US500-E2` screened out: fit mean net R -0.0537R < +0.05R; fit-period Null-A p = 0.652 > 0.05.

## 3. The verdict

**All six arms are dead.** 5 of the six were removed by the pre-registered fit-period screen and their holdout was never computed; the remaining 1 was read once on the holdout and killed there.

The sentence that survives both closed passes and this one, sharpened: *the breakout selects direction, and no exit construction with a mechanism — capped, uncapped, ratcheted, or volatility-stopped — converts it at realistic costs.*

**No arm reached REAL EDGE, so `forward_confirm.py` was not written — it is not built speculatively.** No Software Engineer and no Backtesting engagement follows from this family.

## 4. E0 versus E1 — did the ratchet help?

E1 nests E0, so this pair is the whole give-back hypothesis. It is **not** asserted that E1 beats E0 per trade, and it does not: a ratchet can exit a trade that E0 would have held to a better close. Both directions are printed.

| instrument | trades | E1 beat E0 | E1 worse than E0 | identical | mean E1 − E0 | ratchet never moved | ratchet moved |
|---|---|---|---|---|---|---|---|
| US100 | 668 | 68.3 % | 23.5 % | 8.2 % | **-0.0343R** | 4 | 664 |
| US500 | 670 | 70.4 % | 22.8 % | 6.7 % | **+0.0014R** | 19 | 651 |

On every trade where the ratchet never moved, E1's exit minute, price and cause equal E0's **exactly** — the structural identity of `DESIGN.md` §3.4, asserted on every such trade by `checks.py trail`. The `mean E1 − E0` column is therefore attributable entirely to the trades where the ratchet did move.

- **US100, fit period:** E0 +0.1220R → E1 +0.0397R (**-0.0823R** from the ratchet); median harvest ratio -0.511 → -0.143.
- **US500, fit period:** E0 -0.0489R → E1 -0.0542R (**-0.0053R** from the ratchet); median harvest ratio -0.467 → -0.149.

## 5. The descriptive rows — every arm, no verdict attached

### 5.1 Fit period

| arm | n | mean net R | median net R | mean gross R | win rate | mean win R | mean loss R | % long | median stop (pts) | median hold (min) | stop | trail-stop | time-exit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `US100-E0` | 391 | **+0.1220** | -1.0180 | +0.1503 | 34.5 % | +2.2188 | -0.9837 | 48.3 % | 66.60 | 161 | 241 | 0 | 150 |
| `US100-E1` | 391 | **+0.0397** | -0.2663 | +0.0680 | 41.2 % | +1.0184 | -0.6455 | 48.3 % | 66.60 | 30 | 2 | 368 | 21 |
| `US100-E2` | 379 | **+0.1037** | -1.0587 | +0.1692 | 17.4 % | +5.6349 | -1.0627 | 48.3 % | 27.04 | 15 | 311 | 0 | 68 |
| `US500-E0` | 392 | **-0.0489** | -1.0297 | +0.0032 | 27.8 % | +2.4878 | -1.0259 | 51.0 % | 10.85 | 90 | 271 | 0 | 121 |
| `US500-E1` | 392 | **-0.0542** | -0.3378 | -0.0024 | 37.0 % | +0.9581 | -0.6484 | 51.0 % | 10.85 | 23 | 13 | 370 | 9 |
| `US500-E2` | 380 | **-0.0537** | -1.0627 | +0.0404 | 16.8 % | +5.0740 | -1.0923 | 51.1 % | 5.60 | 22 | 312 | 0 | 68 |

### 5.2 Holdout — screened-in arms only

| arm | n | mean net R | median net R | mean gross R | win rate | mean win R | mean loss R | % long | median stop (pts) | median hold (min) | stop | trail-stop | time-exit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `US100-E0` | 248 | **-0.0126** | -1.0110 | +0.0067 | 38.3 % | +1.5074 | -0.9563 | 51.6 % | 103.60 | 179 | 141 | 0 | 107 |

### 5.3 The harvest ratio — where the lift went

Per trade, realised net R divided by the trade's MFE in R over the same horizon (entry → 16:00 NY). This is the direct "how much of the excursion did the construction keep" number, and it is the diagnostic that says *where* the lift went on the arms that die.

| arm | period | n | median harvest | median MFE (R) | % of trades with MFE ≥ 1R | median net R |
|---|---|---|---|---|---|---|
| `US100-E0` | fit | 391 | -0.511 | +1.579 | 64.5 % | -1.0180 |
| `US100-E1` | fit | 391 | -0.143 | +1.579 | 64.5 % | -0.2663 |
| `US100-E2` | fit | 379 | -0.269 | +3.675 | 82.8 % | -1.0587 |
| `US500-E0` | fit | 392 | -0.467 | +1.811 | 71.7 % | -1.0297 |
| `US500-E1` | fit | 392 | -0.149 | +1.811 | 71.7 % | -0.3378 |
| `US500-E2` | fit | 380 | -0.278 | +3.660 | 81.8 % | -1.0627 |
| `US100-E0` | holdout | 248 | -0.505 | +1.241 | 57.3 % | -1.0110 |

### 5.4 The common scale — one unit for every construction

E2's R is roughly half E0's in price, so the R-denominated rows are not directly comparable across constructions. Mean net PnL per trade in points and in dATR14 units puts them on one scale. **The verdict ladder does not read this table** — the ladder is in R, which is what a trader sizes on.

| arm | period | n | mean net R | median stop (points) | mean net (points) | mean net (dATR14) |
|---|---|---|---|---|---|---|
| `US100-E0` | fit | 391 | +0.1220 | 66.60 | +10.09 | +0.0284 |
| `US100-E1` | fit | 391 | +0.0397 | 66.60 | +1.67 | +0.0075 |
| `US100-E2` | fit | 379 | +0.1037 | 27.04 | +2.52 | +0.0104 |
| `US500-E0` | fit | 392 | -0.0489 | 10.85 | -0.56 | -0.0098 |
| `US500-E1` | fit | 392 | -0.0542 | 10.85 | -0.71 | -0.0080 |
| `US500-E2` | fit | 380 | -0.0537 | 5.60 | -0.40 | -0.0054 |
| `US100-E0` | holdout | 248 | -0.0126 | 103.60 | -7.20 | -0.0060 |

### 5.5 The long/short split — printed for every arm, fit and holdout

No side-split arm is registered. `US100` longs beat shorts on the fit period at every width tested by the closed passes, but the fit period is a rising tape and the premium is at least partly drift; Null A is side-matched and controls for it at the arm level. An arm reaching REAL EDGE with a non-positive side is labelled **"one-sided — flagged"**.

| arm | period | side | n | mean net R | win rate | median harvest |
|---|---|---|---|---|---|---|
| `US100-E0` | fit | long | 189 | +0.1343 | 37.0 % | -0.509 |
| `US100-E0` | fit | short | 202 | +0.1105 | 32.2 % | -0.526 |
| `US100-E1` | fit | long | 189 | +0.0405 | 42.9 % | -0.098 |
| `US100-E1` | fit | short | 202 | +0.0389 | 39.6 % | -0.153 |
| `US100-E2` | fit | long | 183 | +0.0092 | 21.3 % | -0.287 |
| `US100-E2` | fit | short | 196 | +0.1919 | 13.8 % | -0.268 |
| `US500-E0` | fit | long | 200 | -0.0754 | 29.0 % | -0.438 |
| `US500-E0` | fit | short | 192 | -0.0212 | 26.6 % | -0.498 |
| `US500-E1` | fit | long | 200 | -0.0423 | 36.5 % | -0.174 |
| `US500-E1` | fit | short | 192 | -0.0665 | 37.5 % | -0.126 |
| `US500-E2` | fit | long | 194 | -0.1178 | 19.1 % | -0.272 |
| `US500-E2` | fit | short | 186 | +0.0130 | 14.5 % | -0.282 |
| `US100-E0` | holdout | long | 128 | -0.0866 | 38.3 % | -0.517 |
| `US100-E0` | holdout | short | 120 | +0.0664 | 38.3 % | -0.479 |

### 5.6 Forward lift — once per instrument

The median ratio of a trade's MFE (in ATR14, entry → 16:00 NY) to the median MFE of a random side-matched, horizon-matched bar from the same [09:35, 12:00) NY window. It does not use the trade's outcome, so it is not circular. **It is a property of the trigger and is identical across E0, E1 and E2 by construction** — the three arms are one trade stream exited three ways — so it is printed once per instrument rather than three times.

| instrument | n | median forward lift | % of trades ≥ 1 |
|---|---|---|---|
| US100 | 391 | **1.653** | 67.3 % |
| US500 | 392 | **1.573** | 65.8 % |

This is the positive result of the whole ORB line, and it is the reason the exit family was registered: the breakout **does** select direction. What the grid above measures is whether any exit construction converts it.

## 6. Costs — the projection, and what was realised

`cost_R` is set by **the stop**, not by the exit, so it is a property of the construction. On E2 the stop is sized to volatility, not to the range, so **`cost_R` is roughly double E0's; on US500 it approaches the level at which this project has previously seen costs decide a verdict** (`cmc-bot` Запись 22: 0.25–0.40R killed everything).

| arm | period | n | mean `cost_R` | median | p90 | mean gross R | mean net R | the gap |
|---|---|---|---|---|---|---|---|---|
| `US100-E0` | fit | 391 | 0.0283 | 0.0267 | 0.0431 | +0.1503 | +0.1220 | 0.0283 |
| `US100-E1` | fit | 391 | 0.0283 | 0.0267 | 0.0431 | +0.0680 | +0.0397 | 0.0283 |
| `US100-E2` | fit | 379 | 0.0655 | 0.0666 | 0.0904 | +0.1692 | +0.1037 | 0.0655 |
| `US500-E0` | fit | 392 | 0.0521 | 0.0410 | 0.0999 | +0.0032 | -0.0489 | 0.0521 |
| `US500-E1` | fit | 392 | 0.0517 | 0.0410 | 0.0999 | -0.0024 | -0.0542 | 0.0517 |
| `US500-E2` | fit | 380 | 0.0942 | 0.0728 | 0.1756 | +0.0404 | -0.0537 | 0.0942 |
| `US100-E0` | holdout | 248 | 0.0192 | 0.0174 | 0.0313 | +0.0067 | -0.0126 | 0.0192 |

The 2023 paper's own optimum — a stop at **0.05 dATR** — is **not registered** here: at these spreads it projects to `cost_R` ≈ 0.09R on US100 and 0.12–0.15R on US500 with p90 well above 0.3R, so the arm would measure the spread rather than the edge. That is the paper's own caveat ("a stop placed at 5 % of the 14-day ATR … will likely be exceeded") quantified on a CFD. It is printed in the S-K ladder below so the cost gradient is on the record.

Cost sensitivities on the holdout (non-gating, screened-in arms):

| arm | base | 2× per-bar spread | fixed fit-median spread |
|---|---|---|---|
| `US100-E0` | -0.0126 | -0.0318 | -0.0126 |

## 7. The fit-only ladders — shapes, not decisions

**None of these can create, upgrade or downgrade a verdict. None is computed on the holdout. No cell below is a recommendation and no "best cell" sentence appears anywhere in this deliverable** — a ladder cell that would clear the build bar on the fit period generates **no follow-up of any kind**; it is a backlog note, and only a fresh registration on 2026-08+ tape could test it. The registered cell is marked ✅.

### S-T target on E0

| instrument | cell | n | mean net R | win rate | mean `cost_R` | median stop (pts) | median hold (min) | median harvest |
|---|---|---|---|---|---|---|---|---|
| US100 | EoD (the arm) ✅ | 391 | +0.1220 | 34.5 % | 0.0283 | 66.6 | 161 | -0.511 |
| US100 | 2R | 391 | +0.0792 | 39.9 % | 0.0283 | 66.6 | 61 | -0.511 |
| US100 | 3R | 391 | +0.0860 | 36.3 % | 0.0283 | 66.6 | 106 | -0.511 |
| US100 | 5R | 391 | +0.0781 | 34.5 % | 0.0283 | 66.6 | 136 | -0.511 |
| US100 | 10R | 391 | +0.1182 | 34.5 % | 0.0283 | 66.6 | 161 | -0.511 |
| US500 | EoD (the arm) ✅ | 392 | -0.0489 | 27.8 % | 0.0521 | 10.8 | 90 | -0.467 |
| US500 | 2R | 392 | -0.0670 | 34.4 % | 0.0530 | 10.8 | 44 | -0.437 |
| US500 | 3R | 392 | -0.0397 | 30.4 % | 0.0521 | 10.8 | 62 | -0.467 |
| US500 | 5R | 392 | +0.0226 | 28.8 % | 0.0521 | 10.8 | 84 | -0.467 |
| US500 | 10R | 392 | -0.0496 | 27.8 % | 0.0521 | 10.8 | 90 | -0.467 |

- **US100:** non-monotone, with the extreme at an end of the ladder.
- **US500:** peaked in the interior of the ladder, not at either end.

### S-T target on E2

| instrument | cell | n | mean net R | win rate | mean `cost_R` | median stop (pts) | median hold (min) | median harvest |
|---|---|---|---|---|---|---|---|---|
| US100 | EoD (the arm) ✅ | 379 | +0.1037 | 17.4 % | 0.0655 | 27.0 | 15 | -0.269 |
| US100 | 2R | 379 | -0.0533 | 33.8 % | 0.0655 | 27.0 | 9 | -0.204 |
| US100 | 3R | 379 | +0.0037 | 26.9 % | 0.0655 | 27.0 | 12 | -0.247 |
| US100 | 5R | 379 | -0.0107 | 19.5 % | 0.0655 | 27.0 | 14 | -0.269 |
| US100 | 10R | 379 | +0.0328 | 17.4 % | 0.0656 | 27.0 | 15 | -0.269 |
| US500 | EoD (the arm) ✅ | 380 | -0.0537 | 16.8 % | 0.0942 | 5.6 | 22 | -0.278 |
| US500 | 2R | 380 | -0.0582 | 34.7 % | 0.0940 | 5.6 | 12 | -0.209 |
| US500 | 3R | 380 | -0.0182 | 27.4 % | 0.0950 | 5.6 | 17 | -0.254 |
| US500 | 5R | 380 | +0.0748 | 21.8 % | 0.0945 | 5.6 | 21 | -0.277 |
| US500 | 10R | 380 | -0.0728 | 16.8 % | 0.0943 | 5.6 | 22 | -0.278 |

- **US100:** non-monotone, with the extreme at an end of the ladder.
- **US500:** peaked in the interior of the ladder, not at either end.

### S-K stop fraction

| instrument | cell | n | mean net R | win rate | mean `cost_R` | median stop (pts) | median hold (min) | median harvest |
|---|---|---|---|---|---|---|---|---|
| US100 | range (= E0) ✅ | 391 | +0.1220 | 34.5 % | 0.0283 | 66.6 | 161 | -0.511 |
| US100 | 0.05 dATR14 | 379 | -0.0269 | 9.8 % | 0.1311 | 13.5 | 4 | -0.149 |
| US100 | 0.1 dATR14 ✅ | 379 | +0.1037 | 17.4 % | 0.0655 | 27.0 | 15 | -0.269 |
| US100 | 0.15 dATR14 | 379 | +0.1079 | 25.3 % | 0.0437 | 40.6 | 41 | -0.372 |
| US100 | 0.25 dATR14 | 379 | +0.0619 | 34.8 % | 0.0262 | 67.6 | 170 | -0.504 |
| US500 | range (= E0) ✅ | 392 | -0.0489 | 27.8 % | 0.0521 | 10.8 | 90 | -0.467 |
| US500 | 0.05 dATR14 | 380 | -0.2963 | 8.7 % | 0.1883 | 2.8 | 6 | -0.157 |
| US500 | 0.1 dATR14 ✅ | 380 | -0.0537 | 16.8 % | 0.0942 | 5.6 | 22 | -0.278 |
| US500 | 0.15 dATR14 | 380 | -0.1189 | 22.9 % | 0.0628 | 8.4 | 46 | -0.397 |
| US500 | 0.25 dATR14 | 380 | -0.0084 | 33.4 % | 0.0377 | 14.0 | 218 | -0.518 |

- **US100:** non-monotone, with the extreme at an end of the ladder.
- **US500:** non-monotone, with the extreme at an end of the ladder.

### S-C time exit on E0

| instrument | cell | n | mean net R | win rate | mean `cost_R` | median stop (pts) | median hold (min) | median harvest |
|---|---|---|---|---|---|---|---|---|
| US100 | 16:00 NY (the arm) ✅ | 391 | +0.1220 | 34.5 % | 0.0283 | 66.6 | 161 | -0.511 |
| US100 | 11:00 NY | 389 | +0.0541 | 46.5 % | 0.0283 | 66.6 | 65 | -0.229 |
| US100 | 12:00 NY | 391 | +0.0689 | 43.2 % | 0.0283 | 66.6 | 115 | -0.382 |
| US100 | 14:00 NY | 391 | +0.1330 | 37.6 % | 0.0283 | 66.6 | 157 | -0.501 |
| US500 | 16:00 NY (the arm) ✅ | 392 | -0.0489 | 27.8 % | 0.0521 | 10.8 | 90 | -0.467 |
| US500 | 11:00 NY | 391 | -0.0313 | 40.9 % | 0.0524 | 10.8 | 50 | -0.492 |
| US500 | 12:00 NY | 392 | -0.0307 | 37.8 % | 0.0521 | 10.8 | 84 | -0.570 |
| US500 | 14:00 NY | 392 | -0.0234 | 32.7 % | 0.0521 | 10.8 | 88 | -0.520 |

- **US100:** non-monotone, with the extreme at an end of the ladder.
- **US500:** monotone increasing across the ladder.

### S-C time exit on E1

| instrument | cell | n | mean net R | win rate | mean `cost_R` | median stop (pts) | median hold (min) | median harvest |
|---|---|---|---|---|---|---|---|---|
| US100 | 16:00 NY (the arm) ✅ | 391 | +0.0397 | 41.2 % | 0.0283 | 66.6 | 30 | -0.143 |
| US100 | 11:00 NY | 389 | +0.0195 | 42.7 % | 0.0283 | 66.6 | 30 | -0.242 |
| US100 | 12:00 NY | 391 | +0.0161 | 41.7 % | 0.0283 | 66.6 | 30 | -0.216 |
| US100 | 14:00 NY | 391 | +0.0414 | 40.9 % | 0.0283 | 66.6 | 30 | -0.161 |
| US500 | 16:00 NY (the arm) ✅ | 392 | -0.0542 | 37.0 % | 0.0517 | 10.8 | 23 | -0.149 |
| US500 | 11:00 NY | 391 | -0.0645 | 38.9 % | 0.0518 | 10.8 | 23 | -0.268 |
| US500 | 12:00 NY | 392 | -0.0838 | 37.2 % | 0.0517 | 10.8 | 23 | -0.261 |
| US500 | 14:00 NY | 392 | -0.0636 | 37.0 % | 0.0517 | 10.8 | 23 | -0.180 |

- **US100:** non-monotone, with the extreme at an end of the ladder.
- **US500:** non-monotone, with the extreme at an end of the ladder.

### S-D trail distance

| instrument | cell | n | mean net R | win rate | mean `cost_R` | median stop (pts) | median hold (min) | median harvest |
|---|---|---|---|---|---|---|---|---|
| US100 | 1R (the arm) ✅ | 391 | +0.0397 | 41.2 % | 0.0283 | 66.6 | 30 | -0.143 |
| US100 | 0.5R | 391 | +0.0237 | 35.5 % | 0.0283 | 66.6 | 8 | -0.102 |
| US100 | 2R | 391 | +0.1421 | 37.1 % | 0.0283 | 66.6 | 106 | -0.383 |
| US500 | 1R (the arm) ✅ | 392 | -0.0542 | 37.0 % | 0.0517 | 10.8 | 23 | -0.149 |
| US500 | 0.5R | 392 | -0.0220 | 34.7 % | 0.0524 | 10.8 | 6 | -0.077 |
| US500 | 2R | 392 | -0.0492 | 31.4 % | 0.0521 | 10.8 | 64 | -0.371 |

- **US100:** non-monotone, with the extreme at an end of the ladder.
- **US500:** peaked in the interior of the ladder, not at either end.

### S-P scale-out (derived)

| instrument | cell | n | mean net R | win rate | mean `cost_R` | median stop (pts) | median hold (min) | median harvest |
|---|---|---|---|---|---|---|---|---|
| US100 | half off at +1R, remainder per E1 | 391 | +0.0439 | 53.5 % | 0.0283 | — | — | — |
| US500 | half off at +1R, remainder per E1 | 392 | -0.0418 | 50.5 % | 0.0519 | — | — | — |


## 8. The checks that had to pass before any number counted

`results/checks.json` holds the full output. Every one is a `DESIGN.md` §11 stop rule: a failure halts the pass and returns to the Architect.

| # | check | result |
|---|---|---|
| 1 | tape integrity — MD5 and `COVERAGE.md` reproduce byte-identically from the raw NDJSON | **PASS** (§2.2) |
| 1 | clock grid — 09:30 / 09:35 / 11:00 / 12:00 / 14:00 / 16:00 NY on the 5-minute epoch grid, every session day, both DST offsets | **PASS** (670 days, 0 violations) |
| 2 | **same trade list** — E0 ≡ E1 ≡ E2 ≡ the short pass's own `US100-OR5` / `US500-OR5` | **PASS** |
| 3 | fills, fixed-stop arms — 1m-path fill ≡ bar-OHLC fill | **PASS** |
| 4 | fills, E1 — numba ≡ pure-Python reference on every trade; unmoved ratchet ≡ E0 exactly | **PASS** |
| 5 | dATR14 look-ahead — recomputed from a tape truncated at 09:30 NY of the trade day, 40 sampled trades across fit and holdout | **PASS** (max abs diff 0) |
| 6 | session — no trade crosses 16:00 NY on any arm | **PASS** |
| 7 | screen before holdout — `analysis.py holdout` refuses to run without `results/fit_screen.csv`, and computes nothing for a screened-out arm or for the quoted +1R corner | **PASS** (structural) |

The trade list is the strongest of these: the three constructions are **one trade stream exited three ways**, and the check re-derives the reference list by importing the short package's own unmodified `common.py` and `engine.py` and calling its own `build_arm` — the committed record executing itself. It is written to `results/short_or5_<symbol>.csv`.

One bounded, pre-registered exclusion applies to E2 only: on **24 triggered days** (all in January 2024, the Wilder ATR(14) warm-up at the very start of the tape) `dATR14` is undefined, so E2 has no stop. `DESIGN.md` §3.6 records the Architect note's erratum and the ruling; the days are enumerated in `results/exclusions.csv`. **The holdout and the tail are entirely unaffected** — 0 of them lie outside the fit period — so every holdout `n` is identical across all six arms.

## 9. What this family did not test, and what is left of the ORB line

- **The papers' entry** — the second 5-minute candle's open in the first candle's direction (2023), or a resting stop order at the range edge (2024). The one ORB *entry* variant this project has not tested. It would trade every day, earlier and closer to the range, at a lower win rate. Logged in `IDEAS-BACKLOG.md`; if wanted it is a fresh registration on 2026-08+ tape with its own count, never a cell here.
- **Relative volume as a filter** — cross-sectional in the 2024 paper (which stocks are in play today). On a single index there is no cross-section; the time-series analogue `or_rvol` was a Study B feature on ~1,400 trades in the closed pass and was **not flagged** (5-minute SHAP direction −0.51, i.e. if anything the wrong sign). Logged, not registered.
- **Crypto** — not in this family. If the parallel NY-anchor investigation concludes the anchor is real, crypto gets its own exit family on the deferred 2026-08-01 .. 2027-07-31 window with its own count, subsuming the frozen `deferred_eth_t2.py`.
- **The width axis** — closed (Запись 24). One width here; a pass would have made width a later sensitivity, never an arm.
- **Tighter stops than 0.10 dATR, ATR-multiple trails, no-progress stops, breakeven-only, midpoint stops** — each ruled individually in the Architect note §4.2 as nested, derived, cost-dead or uncalibrated. The ladders above print the shapes.

**The tail** (2026-08-01 .. 2026-09-11) is descriptive only and is in `results/fit_describe.csv` with `period = tail`. It is also the window `forward_confirm.py` will eventually read, which is why no verdict reads it now.

