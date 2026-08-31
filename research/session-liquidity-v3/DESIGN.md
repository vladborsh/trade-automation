# Design: session-liquidity v3 — corrected iFVG confirmation, core numbers redo

**Role:** Architect · **Hand-off to:** Researcher.
**Authoritative definitions:** `knowledge/session-liquidity.md` (reorganized;
§0 Status says what is current, **§5.1 is the corrected v3 iFVG state
machine**, V9 in the §7 ledger). Read it first — this brief adds only
mechanical pins and scope, never redefines.

## 0. Why this pass, and why it is deliberately small

v2's `ifvg_confirm` retroactively best-picked the earliest-inverting gap
across the whole block window (§5.1's defect note) — invalidating v2's
confirmation-rate, delay, and from-confirmation geometry numbers, and
structurally biasing selection toward small near-price gaps. This pass
**re-derives exactly those numbers** under the §5.1 sequential state machine,
on the unchanged v2 event stream. Nothing else: the PDH/PDL drill-down
resumes as a separate pass **after the user audits this pass's gallery**
(sequencing decision: two methodology defects in a row were caught only by
worked-example audits, so the corrected confirmation layer gets audited
before anything is built on it).

Take-out detection, sessions, blocks, horizon, units, level scope: all
unchanged from v2 — reuse `research/session-liquidity-v2/` code (fork into
this package, never modify v2 files). The take-out event stream must
reproduce v2's counts exactly (assert it — that is the check that only the
confirmation layer changed).

## 1. The v3 state machine — implementation pins

§5.1 governs. Pins for the edge cases it leaves implicit (per V-ledger
convention: document, deviate only via Architect):

1. **Replacement is final.** When a newer qualifying gap replaces a live
   candidate, the replaced gap is permanently out — its later inversion does
   NOT count, and it never returns, even if the newer candidate is
   invalidated (§5.1 point 3: post-invalidation eligibility is
   forming-after-the-invalidation-bar only).
2. **Only the active candidate can confirm.** A close through the far edge of
   a non-active gap is not an event.
3. **Invalidation reference** = the take-out bar's own extreme (high of the
   take-out bar for a high sweep), fixed at take-out time; invalidation = a
   *close* beyond it. If the same bar closes both through the active gap's
   far edge and beyond the take-out extreme (contradictory in direction —
   should be near-impossible; assert and count), invalidation wins
   (conservative).
4. **Same-bar ordering:** a gap whose 3rd bar is bar `t` becomes the active
   candidate at the close of `t`; a confirmation close can occur at `t+1` at
   the earliest (a gap cannot form and confirm on the same bar).
5. State-machine transitions logged per event (`n_candidates_seen`,
   `n_invalidations`, `replaced_count`, active-gap formation bar and size) —
   these are the audit trail and feed §3's comparisons.

## 2. Required outputs

On the v2 event stream (both directions, 4 assets, primary ≥12-bar sample +
appendix, per §6.1):

* **Re-derived core tables** — confirmation rate, take-out→confirmation delay,
  from-confirmation geometry (MFE/MAE/end value, stop proxy to the sweep-leg
  extreme, R proxy, R≥1 / R≥2 shares), per level_session × sweep_block ×
  direction × asset, plus the block-lift table — the v3 analogs of v2's
  confirmation-dependent tables, same conventions.
* **v2-vs-v3 delta table** — the same headline metrics side by side, so the
  bug's bias is quantified rather than asserted. Include the **gap-size
  distribution of selected gaps under v2 vs v3** (the user's "of course
  you'll get a small ratio" prediction, tested directly).
* **State-machine diagnostics** — distribution of candidates-seen,
  invalidations, replacements per event; share of unconfirmed take-outs by
  cause (no candidate ever / invalidated out / block ended while live).
* **Hour-of-day chart (new §5.1 required deliverable)** — gap frequency by
  clock hour, and confirmed-reversal rate by hourly window —
  **window-length-stratified** (§6.1's warning: unstratified hourly cuts
  rediscover the clock; use the v2 strata convention 12–24/24–48/48–72/72+).
* **Worked-example gallery (first-class, the audit surface):** 20+ panels
  stratified across confirmed / invalidated-then-confirmed / replaced /
  unconfirmed cases — the state machine's *transitions* must be visible
  (candidate gaps drawn with formation order, replacement and invalidation
  marked, take-out-bar extreme line shown), not just the final confirmation.
* **Pine update** to the §5.1 state machine (new file in this package;
  sequential tracking, invalidation line at the take-out bar's extreme; no
  BoS; PDH/PDL toggle can wait for the drill-down resumption) + runbook
  delta.
* `checks.py` assertions: v2 take-out stream reproduced exactly; no
  confirmation from a non-active gap; no post-invalidation retroactive
  eligibility; prefix stability; block containment.

## 3. Deliverable and sequence

`research/session-liquidity-v3/` package (code, `results/`, `viz/`,
REPORT.md — delta-style: reference v2 for the surviving upstream tables,
re-print only what changed —, HANDOFF.md to Architect, `.pine` + runbook),
committed to the worktree branch; `RESEARCH-LOG.md` entry (Russian, usual
format). Descriptive protocol throughout (§8). Ask the Architect only where
a choice changes what is measured.

After this pass: user audit of the gallery + hour-of-day chart → PDH/PDL
drill-down resumes (salvaged non-iFVG code from the halted worker in
`researcher-sl-drilldown`, §5.1 wired in) → BoS pass → strategy design.
