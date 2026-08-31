# Design: session-liquidity v2 descriptive redo (iFVG only)

**Role:** Architect · **Hand-off to:** Researcher.
**Why this exists:** the user rejected several phase-1 methodology choices
after auditing worked examples (`RESEARCH-LOG.md` Запись 11). This is a redo
of the descriptive study under corrected definitions, **iFVG only** — the BoS
mechanic was additionally found defective and is quarantined to its own later
pass (`../session-liquidity/corrections/BOS-CORRECTION-NOTE.md`).

**The authoritative spec is `knowledge/session-liquidity.md` (v2 reissue).**
Read it first; every definition (non-overlapping sessions, block-scoped
horizon, relaxed block-scoped iFVG, the V1–V8 defaults ledger) lives there,
not here. Phase-1's `research/session-liquidity/REPORT.md` and
`STRATEGY-DESIGN.md` are provisionally invalidated — reference for code reuse
and for what changed, never for definitions or numbers.

## What changed vs phase 1 (summary — knowledge file governs)

1. Sessions non-overlapping: Asia 00–08, London 08–13, NY 13–21, Late 21–24
   UTC (Late produces no levels). The overlap bucket is gone.
2. Measurement horizon: block-scoped (take-out → end of its `sweep_block`),
   replacing the fixed 2h everywhere — including iFVG formation/inversion
   timing. Window-length reporting rules are in the knowledge file.
3. iFVG location: relaxed (gap reaches beyond the level); strict demoted to a
   sensitivity row.
4. ATR(14, 5m) confirmed as primary unit; raw % secondary.
5. BoS: **out of scope entirely** — do not compute, tabulate, or draw it.

## Protocol

Descriptive, per the user's standing call: no permutation null, no kill rule,
no pass/fail gate, no fit/holdout. Causality hygiene is still correctness
(V1 no-lookahead, pivot-free this time so no pivot lag concerns; carry over
`checks.py`-style assertions for level formation, block boundaries, iFVG
timing containment, prefix stability).

## Required outputs (Python)

Assets BTC/ETH/SOL/BNB, 5m, full cached window (reuse the
`research/intraday-mtf-smc/` pull; no new data). Rebuild on phase-1 code
where it survives the definition changes (`common.py`, level machinery,
`fvg_arrays`, table/chart plumbing) — fork into this package, do not modify
phase-1 files.

- Frequency tables: take-outs and iFVG-confirmation rates per level_session ×
  sweep_block × direction × asset; monthly stability.
- Magnitude tables (ATR primary, % secondary), block-scoped per the knowledge
  file: within-window MFE/MAE and end-of-window value, measured from BOTH the
  sweep's wick extreme and the confirmation close (the phase-1 T12/T13-style
  view stays — it was the uncontaminated one); stop proxy (sweep-leg extreme)
  and R-proxy distributions from the confirmation close.
- Window-length distribution + the ≥12-bars-remaining primary/appendix split
  (knowledge file rule); take-out→confirmation delay distribution and the
  share of events unconfirmed because the block ended.
- Session story: per-block lift over each block's own unconditional baseline
  (phase-1 T7b analog, now block-scoped) — the user's NY/Asia prior gets
  re-answered under the new windows.
- `n_levels_taken` split retained.
- **Worked-example gallery is a first-class deliverable:** a 10×10-style set
  (`../session-liquidity/examples_10x10.py` precedent) of iFVG-confirmed
  events — wins, failures, and unconfirmed take-outs — with session
  rectangles, the swept level, the FVG zone, and the inversion close all
  drawn. This format is what caught the phase-1 problems; treat it as the
  user's audit surface, not decoration.

## Required output (Pine)

Update the indicator to v2: non-overlapping session rectangles, relaxed
block-scoped iFVG rendering, **no BoS drawing** (remove rather than leave the
defective mechanic visible). New file in this package (do not edit phase-1's
`.pine`); short runbook delta.

## Deliverable

`research/session-liquidity-v2/` package: REPORT.md (descriptive format,
tables + charts inline), code, `results/`, `viz/`, the `.pine` + runbook,
HANDOFF.md back to Architect, and a `RESEARCH-LOG.md` entry (Russian, usual
format) — mandatory per logging conventions. Keep
`knowledge/session-liquidity.md` current if implementation forces any pinned
choice to change; ask the Architect only where a choice changes what is
measured.

## After this pass

User audit of the v2 gallery and Pine → BoS correction pass (spec §"Spec for
the corrected mechanic" in the correction note) → Architect re-derives the
strategy design (the invalidated `STRATEGY-DESIGN.md`'s arm structure —
time-exit vs target arms, session filter, matched control, reinstated
discipline — remains the template, but every number feeding it must come from
v2) → Researcher backtest.
