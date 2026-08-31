# Hand-off: Researcher → Architect (session-liquidity **v2**, iFVG only)

**Executes:** `DESIGN.md` — the descriptive redo under the reissued definitions.
Frequency, iFVG confirmation, block-scoped magnitude from both the wick and the
confirmation close, window-length reporting with the ≥12-bar primary/appendix
split, confirmation delay and block-truncation share, per-block lift against
each block's own baseline, the `n_levels_taken` split, a 30-panel worked-example
gallery, and an updated Pine v6 indicator with a runbook delta.

Protocol was **descriptive by the user's standing call**: no permutation null,
no kill rule, no gate, no fit/holdout. Nothing in this package should be cited
as evidence that the idea passed or failed anything. Causality hygiene was kept
as correctness — 19 mechanical assertions in `checks.py`, all passing, including
the three v2 additions (block-boundary containment, iFVG timing containment,
prefix stability under a 60% truncation).

**BoS: not computed, not tabulated, not drawn**, per the brief. The Pine
indicator has its pivot and BoS drawing *removed*, not merely disabled.

**Reads as authoritative:** `knowledge/session-liquidity.md` (v2 reissue).
**No change was needed** — implementation did not force any pinned choice to
move, so the file is current as written and this pass did not edit it.

**Reuses, unmodified:** `research/intraday-mr-smc/indicators.py` (`atr`) and the
cached 5m pull under `research/intraday-mtf-smc/data/`. Phase-1 code was
**forked**, never modified: `common.py`'s loading/level machinery, `engine.py`'s
`fvg_arrays` and level pool, the `tables.py` markdown plumbing, the
`examples.py` candle renderer and the `examples_10x10.py` stratified-gallery
format all have v2 descendants here. No file under `research/session-liquidity/`
was touched.

**Read first:** `REPORT.md` §2 (headline), then §5 (what stands out) and §6
(doubts). §1 is the definitions/ledger summary you need before designing
anything. `RUNBOOK.md` and the gallery are for the user's audit, not for you —
but §3.1 explains what the gallery is showing if the user's feedback references
a panel.

---

## The short version

Under the corrected definitions, **the iFVG-confirmed session sweep is in
aggregate a coin flip.** From the confirmation close, median MFE 2.34 ATR and
median MAE 2.36 ATR; MFE exceeds MAE in 49.7% of confirmed events; the sign at
the block close is favourable 51.4% of the time. The R proxy looks better
(median 0.84, 43.6% ≥1) only because the sweep-leg stop is tight (2.67 ATR
median) — it is a statement about stop geometry, not about direction.

The measurement that matters most is the lift comparison, because it is the one
the user's prior was really about:

| sweep_block | lift, all take-outs | lift, iFVG-confirmed |
|---|---|---|
| Asia | 1.25 | **1.02** |
| London | 1.31 | **1.03** |
| NY | 1.40 | **1.15** |
| Late | 1.48 | **1.15** |

**The take-out carries mild lift and the confirmation removes most of it.** The
iFVG's median delay is 15 bars (75 min); on confirmed events the wick-anchored
reversal is 3.31 ATR while the MFE remaining after confirmation is 2.34 ATR.
Window-matched (T9b), in the 48–95-bars-remaining bucket the confirmed lift is
**below 1.0 in all three blocks that have one**.

**The user's NY/Asia prior gets a split answer**, and the split is only visible
because `level_session` and `sweep_block` are kept apart:

- as a **block** (when to watch): NY is best — 51% of take-outs, 69.9%
  confirmation, median R 0.94, 47.6% reaching R≥1;
- as a **level source** (whose liquidity): NY is **worst** — median R 0.72,
  38.1% reaching R≥1; London is best (0.96 / 48.8%).

**Late (21–24 UTC) is a different regime** and is worse on every axis at once:
46.8% confirmation, median window 23 bars, median R 0.47, 23% reaching R≥1.
If this data warrants any block filter it is "not Late", not "only NY".

**The strongest cell** is London liquidity taken out in the NY block: 6,671
primary take-outs (4.6/day across four assets), 71.8% confirm, median R exactly
1.00, 50.0% reach R≥1. **Even there MFE > MAE in only 48.2% of events**, and the
cell's median R clears 1 in 46% of the 48 months.

**Stability:** frequency is steady (385–493 take-outs/month over 48 months,
median 444); outcome is not — the monthly median R proxy ranges 0.57–1.16 and
clears 1.0 in **7 of 48 months**.

---

## What this means for re-deriving `STRATEGY-DESIGN.md`

The invalidated phase-2 design's *structure* — time-exit vs target arms, a
session filter, a matched control, reinstated discipline — remains the right
template. Every number feeding it must now come from here. Four specific
consequences:

1. **The arm structure has to survive a coin flip.** MFE≈MAE and a 50/50 sign
   at the block close mean no design built on directional expectancy from the
   iFVG alone is supported by this pass. What *is* supported is the stop
   geometry (2.67 ATR median from a confirmation close to the sweep-leg
   extreme), which is a reason to design around asymmetric exits rather than
   around a directional prior.
2. **The session filter should be "not Late", and it should be defended as a
   window-length effect first.** Late's weakness is confounded with its short
   windows (median 23 bars). W2 shows confirmation rate is largely a function of
   window length across the whole study. Any filter that is really a
   window-length filter should say so.
3. **The block-scoped horizon is also an exit deadline, and that is a design
   choice nobody has made yet.** Every magnitude here is measured to the block
   end because that is the measurement rule; it is not a claim that a trade
   should be flat at the block end. If the design uses a different exit horizon,
   none of the magnitude tables transfer directly.
4. **The matched control must be window-matched.** T9's block-level baseline is
   already confounded by window length within the block; T9b is the version to
   copy. This is the single easiest way to accidentally recreate the phase-1
   problem in a new form.

## Open questions for you (I did not decide these)

1. **Is the London 5h / Asia-NY 8h asymmetry to be kept?** It does real work:
   London's median window is 41 bars against NY's 76, which depresses London's
   confirmation rate through window length alone (W1/W2). It is a pinned
   Architect choice, and the `.pine` exposes the boundaries as inputs so the
   user can challenge them visually. If it moves, this pass re-runs cheaply
   (~2 min end to end).
2. **Should confirmation be allowed to run past the block end?** 23.4% of
   unconfirmed take-outs (34.3% in Late) would confirm with 2h more block. V4
   forbids it and this pass obeyed; the cost is now quantified rather than
   assumed, so the choice can be made on evidence.
3. **Is the ≥12-bar primary threshold the right line?** It excludes 9.8% of
   take-outs whose confirmation rate is 10.7%. Both samples are reported (A1/A2);
   a different threshold moves the headline rate by several points.

None of these change what was measured enough to have blocked this pass, which
is why I proceeded rather than asking mid-run.

## Sequence from here

Per `DESIGN.md`: **user audit of the 30-panel gallery and the Pine** → BoS
correction pass → you re-derive the strategy design → Researcher backtest. The
gallery is the audit surface that caught the phase-1 problems, so the user's
review of it should gate the rest.
