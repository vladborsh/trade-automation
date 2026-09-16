# HANDOFF — hedged spot–perp carry

**Status: CLOSED. Both registered arms dead; no build object; no Software or
Integration Engineer work.** Read `REPORT.md` §0 first; this file is what a
successor needs in order not to repeat the pass.

## What was registered and what happened

Two arms, `H_majors` and `H_alts`, α = 0.05/2. Long spot / short USD-M perp,
equal notional, gated ON when the trailing 3-day mean funding ≥ 0.02 %/8 h and
OFF at ≤ 0.005 %, no price stop, isolated USDT margin at 2× with spot
unpostable.

- `H_alts` — **SCREENED OUT on fit: one liquidation at L = 2** (DOGEUSDT,
  2021-01-28 14:00, +42 % in one hour, `x_bar_high` 55.78 % vs `x_liq` 51.28 %;
  the same bar crossed the re-centre and the liquidation level). Holdout never
  computed. Verdict `NOT SURVIVABLE — kill at this leverage`.
- `H_majors` — screened in at +7.89 % p.a. on capital with 0 liquidations;
  holdout read once: **+0.885 % p.a. on 143 ON slot-days**, below the
  pre-registered 150 floor, so `UNDERPOWERED — inconclusive`. The always-on
  benchmark on the same window, at ten times the exposure, made +2.60 % — the
  premium was gone, not the exposure.

## The four facts worth carrying forward

1. **The funding gate times carry. It is not the problem.** Null A, 1,000
   draws with utilisation, hold lengths, turnover, cost and margin rule held
   fixed: observed +7.89 %/+6.90 % against null means +3.16 %/+1.40 %,
   `p_A = 0.000` on both tiers. Both arms are TIMED CARRY. The mechanism
   prerequisite passed by 7× and 50× on mean rate ON vs OFF. This closes the
   question the funding family's redundancy control opened: **the funding
   sensor works, hedged as well as directional.**
2. **The binding constraint is utilisation, not rate.** The alt tier's rate
   while ON (0.0395 %/8 h) beat the 0.035 % the design said the arm needed;
   utilisation came in at 0.308 against the 0.45 assumed. 13.3 % of notional
   earned a third of the time is 8.9 % on capital before fees. Anyone
   redesigning this family should be attacking the denominator or the duty
   cycle, not the threshold — every gate sensitivity run lands between +5.2 %
   and +8.7 %, and even **zero cost** only reaches +9.2 %.
3. **The account type is worth more than the gate.** Majors, fit: +7.89 % on
   the primary account; +28.40 % with spot posted as collateral at a 90 %
   haircut and no re-centres. The lift is *not* the capital denominator (1.36×)
   — it is the perp notional compounding with price when the position is never
   re-hedged (one ETH position collected 46.70 USDT on a 50 USDT slot riding
   397 → 2,856). Those positions are unholdable on the primary account. A
   future carry registration should argue about Multi-Assets Mode or Portfolio
   Margin first and about signal second. **Descriptive only — never tested out
   of sample.**
4. **A price gate does not select carry.** −2.78 % and −5.29 % p.a., 42–48
   round trips per symbol-year, more spent on fees than collected in funding
   (cost/carry 1.4 and 1.9). The hedged family's own version of the funding
   family's 25–37× result.

## What NOT to do next

- **Do not re-run this family at lower leverage to make the liquidation go
  away.** That is the move the pre-registration exists to forbid, and the
  numbers say it would not help anyway: the alts' survivable-leverage
  distribution bottoms at `L* = 1.74`, and L = 3 and L = 5 are worse on both
  return and liquidations (8 and 16).
- **Do not re-cut the split or loosen the 150-slot-day floor** to convert
  `H_majors`' inconclusive into a kill. The floor was missed by 7 slot-days and
  the measured number (+0.89 %) is 4.1 points under the kill bar; the honest
  label is the pre-registered one, and the REPORT says both.
- **Do not re-register the extreme-state entry as an arm.** Run fit-only as
  required: +2.35 % and +2.19 % p.a. on capital, inside the note's own
  +1.5–3.5 % prediction, at 6–8 round trips per symbol-year. The note's §1.5
  arithmetic was right.

## What a successor could legitimately ask

Only via an Architect ruling, and each needs its own registration:

- **The account-type question** (§6 of the REPORT): the same trade on an
  account where spot is collateral, with a real model of Multi-Assets Mode
  haircuts and of the notional drift that makes the un-re-centred position so
  profitable and so unholdable. This is the largest unexplored number in the
  pass.
- **A duty-cycle question**: the premium regime covers under a third of this
  tape. Is there a wider universe (beyond eight symbols) on which utilisation
  at the same rate threshold is materially higher? The cross-sectional pass's
  515-symbol perp panel already exists.
- **Dated-futures (quarterly) basis**, which the backlog still holds: a
  different instrument, a convergence with a date attached, and no funding
  clock.

## Artefacts

`DESIGN.md` (pre-registration, §12 = measured power + screen decision),
`MECHANIC-PROOF.md` (20 positions, margin path step by step, worst residual
0.000e+00), `REPORT.md`, `results/` — `screen.json`, `fit_arms.csv`,
`fit_decomp.csv`, `fit_sensitivities.csv`, `fit_sens_window.csv`,
`fit_margin.csv`, `fit_persistence.csv`, `fit_persymbol.csv`, `fit_nulls.csv`,
`fit_readingB.csv`, `capital_eff.csv`, `capital_collateral.csv`,
`liquidations.csv`, `recentres.csv`, `sol_blackout.csv`, `holdout*.csv`,
`tail.csv`, `margin_table.csv`, and the Stage-0 audit set. Code:
`fetch_data.py`, `backfill_klines.py`, `fetch_margin_table.py`,
`data_audit.py`, `common.py`, `engine.py`, `portfolio.py`, `harness.py`,
`checks.py`, `mechanic_proof.py`, `stage1_fit.py`, `stage1_extras.py`,
`stage1_fixups.py`, `stage2_holdout.py`. Data is gitignored; `fetch_data.py`
reproduces it (the funding/perp audit identity against
`research/funding-rate-signals/` is asserted in `data_audit.py`).
