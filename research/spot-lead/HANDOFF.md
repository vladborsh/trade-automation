# HANDOFF — spot-lead confirmation (insight-bot P4 gate) → Architect

**Status: CLOSED. All four registered arms NO EDGE — fit-period kill; holdout
never simulated. No build object; no Software Engineer work.** Read
`REPORT.md` §0 first.

## Rulings this hands you (note §4, "kill" branch)

1. `label.p4` stays a **displayed context, score weight 0**. It may not be
   declared as a playbook `context_gate` (design §8.3's twin-arm route is
   closed for this label on this evidence). The design's §8.5 score carries
   `10·confirmations(P4)`; setting that term to 0 (and the matching part of
   IB-019 "P4 label wiring") is the Architect's edit — nothing in
   `architecture/` or `tasks/insight-bot.jsonl` was touched by this pass.
2. Arm (b) of the backlog entry "Spot–perp basis and spot-lead signals" is
   **closed**; arm (a) basis-extreme convergence stays parked, untouched.

## Numbers a successor needs (fit, 2020-01 .. 2025-07, 8 perps)

- L1 long at `SPOT_LED` −0.008R (n 9 265); L1c long at `PERP_LED` −0.012R
  (n 3 318); **contrast +0.005R [−0.041, +0.051]**.
- L4 filter: keeps 84 % of advances, **Δ +0.0001R**.
- L2 short at `PERP_LED` −0.050R; L3 long at `ABSORPTION` −0.060R, and its
  price shadow (down bar with positive perp taker flow) +0.011R beat it by
  −0.071R [−0.129, −0.013].
- 5-day forward drift after SPOT_LED vs PERP_LED advances: +0.650 vs +0.648 ATR.
- `SPOT_LED` is 69 % of all 4 h advances — it is the ordinary advance.

## Three things flagged for you, none of them a verdict

1. **Placebo design flaw (process).** The matched-time placebo draws closes
   uniformly while the arm is one-position-at-a-time; here that selection is
   worth ~+0.03R by itself, so L1/L4/L1c/shadows all got p ≤ 0.018 without any
   label information (REPORT §4.1). Did not change any verdict. Future
   registrations with a one-position rule should push placebo draws through the
   same rule. The funding family's §5.1 null has the same shape.
2. **P3's spot-slope trigger clause** (`cvd.spot.slope_4h > 0`, design §9.1)
   leans on the same observable; untested in P3's context, but its prior is now
   gone. Consider a twin arm without it.
3. **RESEARCH-LOG numbering.** Written as **Запись 36**; the parallel
   `squeeze-full-form` pass may also claim 36 — whichever lands second renumbers.

## Package contents

`ARCHITECT-NOTE.md` (yours) · `DESIGN.md` (pre-registration d3a28c2, §9
audit, §10 screen b60da06) · `REPORT.md` (plain-Russian summary at the end) ·
`MECHANIC-PROOF.md` · `fetch_data.py` (+ `research/hedged-carry/fetch_data.py`
gained `--interval 1m`, default behaviour unchanged) · `data_audit.py`,
`common.py`, `engine.py`, `analysis.py`, `stage1.py`, `checks.py` (40/40),
`mechanic_proof.py` · `results/` (all CSV/JSON outputs; data and cache
gitignored).

## Not done, deliberately

Holdout; any sensitivity (window length, CVD z-score, other venues) — each
would be a new registration, and the fit-period forward profile gives no
reason to expect one.
