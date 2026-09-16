# HANDOFF — cross-sectional "instruments in play" → Architect

**Outcome: both pre-registered arms are `NO EDGE — KILL (fit screen)`. The
holdout was never read; the family's α ledger closes at 2 registered / 0
read.** `REPORT.md` has the full grid; this file is what the Architect has to
decide about.

## 1. The four facts that matter

1. **The honest prior was correct and conservative.** `ARCHITECT-NOTE` §6.3
   said a pass needed ~2× the paper's top RVOL tier (+0.038 dATR). Realised:
   **+0.010 dATR gross** for `RVOL-top5` — ~0.25× the paper's top tier, ~0.12×
   what a pass needed — and 0 net. Writing that number down before the run is
   what made this a three-line verdict instead of an argument.
2. **The selection does rank, and the ranking is too small to trade.** RVOL
   top-5 beats random-5 by **+0.026R** (`p` = 0.000 on 1,000 draws) and
   bottom-5 by +0.0135R, on 5,740 legs over 1,148 trade-days. But the 90 %
   interval on `Δ_tb` includes 0, and the level is −0.0023R against a +0.05R
   bar. **`|TR24|` does not rank at all** (`p` = 0.321).
3. **No configuration in the pre-registered grid comes within 5× of the bar.**
   19 fit-only sensitivities, two placebo anchors, four basket rows: the best
   cell is +0.0114R (maker fees, not a tradable configuration) and the second
   best is +0.0058R (16:00 NY horizon). The paper's own 0.10 × dATR stop is
   the **worst** cell (−0.078R). In dATR units the mechanic is flat at every
   stop width, so no rescaling of R can help it.
4. **The anchor is not the problem and costs are not the whole problem.**
   Both placebo anchors are far below the NY arm (−0.065 at 00:00 UTC,
   −0.037 at 04:00 UTC vs −0.002), so 09:30 NY genuinely is a better ranking
   time. And at **zero cost** the arm would be +0.0206R — still under half the
   kill bar. The mechanic is short of expectancy, not just short of edge.

## 2. What is now closed, and what is not

**Closed by this pass** (a kill is a result):

- "Rank a wide crypto perp cross-section by opening relative volume or by
  trailing absolute return, take the top 5, read the direction off the first
  30 minutes, hold 4 hours" — dead at 0.10 % costs on 2020-11..2025-07.
- The backlog's **dollar-neutral signed-`TR24` basket** — annualised Sharpe
  **−0.23** on 1,148 days, descriptive but unambiguous. This was the original
  backlog entry's construction and it can be struck.
- **The 12 h / 48 h variants, k = 3 / 10, the rank-sum combined selector, the
  5-minute (paper-native) construction, and the signed-`TR24` direction** — all
  run, all negative. None of them is a "one more parameter" candidate.

**Not closed, and explicitly not contested:**

- The funding-rate family (different input, per-asset engine).
- Any ORB arm — the reader here has no range, no trigger and no target.
- **Cross-sectional work in general.** What died is *this reader on this
  horizon*, not the idea that which instrument you trade carries information.
  The +0.026R top-vs-random gap is the measurement that says there is
  something there; it is just smaller than a 4-hour taker round trip.

## 3. The asset this pass leaves behind — and the one decision the Architect owes

The harness is the expensive part and it is built, audited and reusable:

| artefact | scale |
|---|---|
| `data/1d/` | 860 symbols, 636,990 UTC daily bars, 2020-01 .. 2026-08 |
| `data/1m/` | 707 symbols, 14,078 symbol-months, **14 GB** parquet, 0 fetch errors |
| `data/funding/` | 707 symbols, 1,731,317 settlements |
| `results/panel.parquet` | 406,042 (symbol, anchor day) rows, all 7 eligibility rules recorded separately |
| **`results/instrument_days.parquet`** | **206,820 rows — the ML addendum** |

**`results/instrument_days.parquet` is the ML-survey addendum
(`research/_surveys/2026-09-lightgbm-role.md`), delivered as asked.** It holds,
for **every** eligible instrument-day and not only the selected ones: the
decision-time observables (`rvol`, `tr24`, `tr12`, `tr48`, `v30`, `r30`,
`datr14`, `liq_med`) and the realised outcome (`side`, `entry`, `stop`,
`stop_dist`, `exit_px`, `exit_ms`, `exit_cause`, `grossR`, `cost_R`, `netR`,
`path_missing`, `delist_days_after`, `period`). It cost nothing — §8.2.5's
"evaluate the whole panel once, select afterwards" produces it as a
by-product.

**The decision:** the ML survey conditioned a LightGBM ranker study on this
family reaching REAL EDGE. It did not. **This researcher's reading is that the
ranker is now a worse bet than the survey assumed, and the reason is specific
rather than general:** a ranker can only reorder the cross-section, and the
whole spread between the best and the worst deterministic ordering of this
panel is `Δ_tb` = **+0.0135R** with an interval that includes 0. A perfect
ranker on these features therefore has less than ~+0.03R of headroom against
a +0.05R bar — before any of it is given back to overfitting. The 206,820-row
table is on disk and costs nothing to keep; a ranker pass on *this* reader and
*this* horizon is not worth a dispatch. **That is an Architect ruling, not
mine — the input it needs is the `Δ_tb` interval above.**

## 4. If the Architect wants a next cross-sectional registration

The three things this pass learned that a next one should be designed around,
offered as input, not as a plan:

1. **The binding constraint is the round trip against a 4-hour horizon**
   (0.0228R cost vs 0.0206R gross). A cross-sectional registration on this
   universe wants a **longer horizon** — the +6 h cell was the only positive
   structural cell, and the user's standing ruling has already opened the
   horizon to 1–5 days. A multi-day hold amortises the same round trip over
   several times the move.
2. **The liquidity floor is what sets `N_elig`, not the venue.** Rule 5 fails
   184,625 of 406,042 panel rows — by far the binding rule. Realised `N_elig`
   is 132–195, not the 300–400 the note projected. Any future power projection
   on this universe should use the realised series in `results/n_elig.csv`.
3. **Same-day leg correlation is +0.065, not ~0.3.** The note's design-effect
   assumption was three to five times too pessimistic. A k-leg cross-sectional
   arm on this universe is much better powered per trade-day than the note
   assumed, which is good news for any successor registration's sample math.

## 5. Nothing is routed to Software Engineer or Backtesting

Per `ARCHITECT-NOTE` §12, that needs a *confirmed* REAL EDGE. There is none.
The §7.3 forward-confirmation window 2026-08-01 .. 2026-10-31 was neither read
nor needed, and `analysis.py forward` still refuses to run before 2026-11-01.
