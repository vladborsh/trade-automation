# HANDOFF — `orb-ny-open-exit` → Architect

**From:** Researcher · **Date:** 2026-09-16 · **Pass:** `research/orb-ny-open-exit/`
**Ruling this executes:** `research/orb-ny-open/ARCHITECT-NOTE-EXIT-CONSTRUCTION.md` (`89365fd`)
**Pre-registration:** `DESIGN.md` @ `a532d84` (before any R) · **screen decision** committed before the holdout · **holdout cut once**

---

## 1. The answer

**All six arms are dead.** 5 were killed by the pre-committed fit-period screen and their holdout was **never computed**; 1 was screened in, read once on the holdout, and killed by the ladder.

| arm | construction | screen | fit mean net R | fit Null-A p | n_hold | holdout mean net R | Null-A p | 90 % interval | verdict |
|---|---|---|---|---|---|---|---|---|---|
| `US100-E0` | E0 | PASS | +0.1220R | 0.022 | 248 | **-0.0126R** | 0.459 | [-0.154, +0.150] | **NO EDGE — KILL** |
| `US100-E1` | E1 | SCREENED OUT | +0.0397R | 0.098 | — | **— (never computed)** | — | — | **NO EDGE — KILL (fit screen)** |
| `US100-E2` | E2 | SCREENED OUT | +0.1037R | 0.126 | — | **— (never computed)** | — | — | **NO EDGE — KILL (fit screen)** |
| `US500-E0` | E0 | SCREENED OUT | -0.0489R | 0.702 | — | **— (never computed)** | — | — | **NO EDGE — KILL (fit screen)** |
| `US500-E1` | E1 | SCREENED OUT | -0.0542R | 0.742 | — | **— (never computed)** | — | — | **NO EDGE — KILL (fit screen)** |
| `US500-E2` | E2 | SCREENED OUT | -0.0537R | 0.652 | — | **— (never computed)** | — | — | **NO EDGE — KILL (fit screen)** |

The bar was the cumulative **α = 0.05/20 = 0.0025**. 
The one arm that touched the holdout, `US100-E0`, did not come close: its holdout mean net R is **-0.0126R**, which is **below zero** and far below the +0.05R kill bar, at p_A = 0.459. Its fit number was +0.1220R, so the fit-to-holdout drop is -0.1346R.

**The holdout re-use cost very little in the end: only 1 of the 6 registered arms actually touched that year.** Realised `n_holdout` was 248 against the 150 floor. **No stop rule fired on power, coverage, the clock grid, the trade lists, the fills, the ratchet's dual implementation, the dATR look-ahead or the session bound.**

## 2. What needs a ruling from you

### 2.1 Declaring the ORB line closed — your call, not mine

Your note §11 says that if all six arms die, the ORB line on these tapes is closed on the exit axis as it already is on the width/timing axis, and gives the sentence that survives. All six died. **My recommendation: declare the ORB line closed on these tapes and record it as closed in `IDEAS-BACKLOG.md`, together with the two items your note explicitly leaves open** (the papers' entry variant; relative volume), **so that a future reader does not re-open it because "nobody tried a 1.5-ATR trail".** I have not written that closure into the backlog myself — it is your call, and §11 reserves it to you.

Twenty arms are now closed on this holdout year: 8 (30-minute) + 6 (width) + 6 (exit). Per your §6.1 this pass **closes the year for ORB**: any further ORB registration on these two instruments must use tape from 2026-08-01 onward.

### 2.2 The one amendment, raised before any R and still awaiting your word

**`DESIGN.md` §3.6 / §12 amendment A-01.** Your note §5.3 says a day on which `DayBars.prior` returns `None` "is excluded and counted (it cannot happen after 2022-08 on these tapes)". **The parenthetical is a factual error about these tapes**, which begin 2024-01-01, not 2022-08: the session-day bars begin 2024-01-02 and Wilder ATR(14) over them is first finite on the 2024-01-18 bar, so `dATR14` is undefined on exactly **12 triggered days per instrument, all in January 2024**. E2 has no stop on them; E0 and E1 do.

This collided with check 2 ("the trade lists must be identical; any difference is a stop"), so **I escalated instead of deciding it locally** — `orca orchestration ask` before any R was computed on any arm (thread `msg_b110864722e0`), with both readings and their costs set out. **The ask timed out unanswered after 900 s** and a 20 s ping confirmed asks were not being answered, so I re-sent it as a durable escalation (`msg_690967473a50`) and applied **the note's own operative clause** — "excluded and counted". That is the specification, not a local decision: the alternative (dropping the 12 days from all six arms) would have been the deviation, because it breaks the cross-pass trade-list identity your note asserts three times.

**What it could have changed: provably nothing.** `results/fit_erratum_annex.csv` recomputes all six arms' fit means under both readings:

| arm | fit mean, reading applied | fit mean, alternative | Δ | screen condition flips? |
|---|---|---|---|---|
| `US100-E0` | +0.1220R | +0.1305R | +0.0085R | no |
| `US100-E1` | +0.0397R | +0.0308R | -0.0088R | no |
| `US100-E2` | +0.1037R | +0.1037R | +0.0000R | no |
| `US500-E0` | -0.0489R | -0.0373R | +0.0116R | no |
| `US500-E1` | -0.0542R | -0.0623R | -0.0081R | no |
| `US500-E2` | -0.0537R | -0.0537R | +0.0000R | no |

**No arm's screen condition flips** (largest movement 0.0116R). Zero excluded days lie in the holdout or the tail, so **every holdout `n` is identical across all six arms** and the holdout read is untouched by the question. **No further ruling is needed for this pass to stand**; I am flagging it so it is not discovered later, and so the erratum is corrected in the note for whoever forks it next.

### 2.3 One check predicate I tightened, for the record

`checks.py trail` originally defined "the ratchet never moved" with a tolerance. That is **looser** than your §5.3, which states the identity on exact equality (`stop == stop_0`), and it admitted two `US100` trades where the ratchet genuinely moved a tick (0.1–0.2 points = 0.002R) and correctly filled at the tightened stop on the same minute as E0. I changed the check to exact equality — **your predicate, and the walker's** — at which point it passes with 4 unmoved trades on `US100`, 19 on `US500`, and **zero** differing from E0. Nothing about a fill, a cost, a null or the ladder was touched; the diagnostic `n_ratchet_moved_under_001R` now records how near the boundary the moved trades get. No ruling needed.

## 3. What the family actually established

### 3.1 The ratchet HURTS, and that is the cleanest result here

E1 nests E0, so this is the give-back hypothesis measured directly, and it is measured on **all** trades, not only the screened-in ones — the fit-period comparison needs no holdout number.

| instrument | E0 fit | E1 fit | ratchet's effect | E1 beat E0 | E1 worse | mean E1 − E0, all periods |
|---|---|---|---|---|---|---|
| US100 | +0.1220R | +0.0397R | **-0.0823R** | 68.3 % | 23.5 % | **-0.0343R** |
| US500 | -0.0489R | -0.0542R | **-0.0053R** | 70.4 % | 22.8 % | **+0.0014R** |

**The ratchet wins the majority of head-to-heads and loses money.** It beats E0 on 68–70 % of trades and still costs 0.08R per trade on `US100`'s fit period, because the trades it wins it wins small (it banks a give-back that would have been given back anyway) and the trades it loses it loses large (it cuts the right tail that the whole construction depends on). The mean win falls from +2.22R to +1.02R on `US100` while the win rate rises from 34.5 % to 41.2 %. That is the give-back hypothesis answered in the negative, on its own terms: **the exit is not losing the lift by holding through a reversal — the lift IS the reversal-prone right tail, and bounding it destroys the edge.**

This also disposes of the ATR-trail and breakeven-at-1R variants your note §4.2 items 5 and 9 declined to register, and the S-D ladder (0.5R and 2R trails) shows the same direction, so it is not a knife-edge at 1R.

### 3.2 The harvest ratio says where the lift went

| arm | median harvest | median MFE (R) | % of trades reaching ≥ 1R MFE |
|---|---|---|---|
| `US100-E0` | -0.511 | +1.579 | 64.5 % |
| `US100-E1` | -0.143 | +1.579 | 64.5 % |
| `US100-E2` | -0.269 | +3.675 | 82.8 % |
| `US500-E0` | -0.467 | +1.811 | 71.7 % |
| `US500-E1` | -0.149 | +1.811 | 71.7 % |
| `US500-E2` | -0.278 | +3.660 | 81.8 % |

**Every construction has a negative median harvest ratio**: the median trade reaches a positive excursion and then gives back more than all of it. 64–83 % of trades reach ≥ 1R of MFE — the forward lift is real and visible here — and the median trade still ends negative under every one of the three exits. That is the whole ORB line in one number.

### 3.3 E2 reproduced the papers' SHAPE and still did not pay

`US100-E2` is the most interesting cell of the pass. It reproduces the 2023 paper's shape closely — **win rate 17.4 % with a mean win of +5.63R**, against their 24 % and ≈ 3.9R — and it clears the screen's mean bar at +0.1037R. **It was removed by the null, not by the mean** (p_A = 0.126): with a stop that tight and no target, a random bar in the same window does nearly as well, so the construction's return is not attributable to the breakout. Its placebo is exited by E2's own template, so that comparison is like-for-like. **It stays screened out** — the screen only ever removes — and I am flagging it because it is the one cell a future reader might mistake for a near-miss worth reinstating. It is not: the mean was there and the attribution was not.

Your cost projection for it was accurate: realised mean `cost_R` 0.0655 on `US100` and 0.0942 on `US500`, against the projected 0.045–0.05 and 0.06–0.08. And the 0.05-dATR cell you declined to register lands exactly where you said it would — `cost_R` 0.131 on `US100` and **0.188** on `US500`, inside the death zone `cmc-bot` Запись 22 identified.

### 3.4 The finding that survives is the same one, for the third time

| instrument | median forward lift | % of trades ≥ 1 |
|---|---|---|
| US100 | **1.653** | 67.3 % |
| US500 | **1.573** | 65.8 % |

Identical across E0/E1/E2 by construction — the three arms are one trade stream exited three ways — and it reproduces the short pass's committed 1.653 / 1.573 exactly. **The breakout selects direction. Three exit constructions with mechanisms behind them — uncapped, ratcheted, volatility-stopped — convert none of it at realistic costs.**

## 4. Why these numbers can be trusted

- **The trade list is provably the short pass's own.** E0 and E1 match `US100-OR5` / `US500-OR5` on every (date, side, entry) triple — 668 and 670 trades — with the reference re-derived by importing the short package's **own unmodified `common.py` and `engine.py`** and calling its own `build_arm`. The committed record executes itself.
- **E0's fit numbers reproduce the short pass's committed no-target numbers to every printed digit** (+0.122010 and −0.048861). E0 *is* that construction on that trigger, so this is a correctness check passing, and it is the reason the grid's fit column can be compared across passes.
- **The ratchet has two independent implementations** (numba and a pure-Python reference written in a deliberately different style) and they agree exactly — exit index, price, cause, stop at exit, best price — on **all 1,338 E1 trades of all periods**.
- **E2's stop is provably knowable before the open**: `dATR14` recomputed from a tape truncated at 09:30 NY of the trade day matches the value used **exactly** on 40 sampled trades across fit and holdout (max abs diff 0.0).
- **The tapes are the audited ones**, regenerated from raw NDJSON to the same MD5s the short pass committed, with the `COVERAGE.md` blocks diffing empty.
- **The pipeline is deterministic**: re-running it end to end after a reporting-only change reproduced every gate number, screen decision and verdict bit-for-bit.

`MECHANIC-PROOF.md` shows 30 fit-period trades — ten per construction — minute by minute, including **E1's ratchet path with the stop each minute was tested against** and **E2's dATR14 with the session-day bar it was read off**.

## 5. What was not done, deliberately

- **`forward_confirm.py` was not written.** §6.5 requires it only for an arm reaching REAL EDGE; none did, and building it speculatively is exactly what your note tells me not to do.
- **No holdout number exists for any screened-out arm, or for the +1R corner.** `analysis.py holdout` refuses structurally.
- **No Study B, no model, no flagged feature.**
- **No arm was reinstated, re-cut, or re-run after a number was seen**, and no ladder cell was promoted. The ladders are printed in full including the cells that look good, with no "best cell" sentence anywhere.
- **No Software Engineer and no Backtesting engagement follows.**

## 6. Deliverables

| file | what it is |
|---|---|
| `DESIGN.md` | the pre-registration, committed before any R; §8.2 holds the screen decision committed before the holdout; §12 the amendment log |
| `REPORT.md` | the full grid, all descriptive rows, all five ladders, the checks |
| `MECHANIC-PROOF.md` | 30 trades minute by minute, with the ratchet path and the dATR source |
| `HANDOFF.md` | this file |
| `results/` | every table behind every number, plus `checks.json`, `exclusions.csv`, `fit_erratum_annex.csv` and the re-derived `short_or5_*.csv` |

