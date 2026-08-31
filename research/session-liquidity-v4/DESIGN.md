# Design: session-liquidity v4 — invalidation removed, core numbers re-derived

**Role:** Architect · **Hand-off to:** Researcher.
**Authoritative definitions:** `knowledge/session-liquidity.md` §5.1 (v4) —
the v3 invalidation rule was fabricated during grilling, never part of the
user's idea, and is removed; the fixed boundary + latest-active-candidate
rule is the whole mechanic. The A/B/C tie question from the v3 pass is moot.
**This is a delta pass on `research/session-liquidity-v3/`:** fork its code,
delete the invalidation branch of the state machine, re-derive. Everything
that made v3 auditable carries over.

## 1. Mechanic (per §5.1 v4) and carried pins

1. From the take-out bar, the **active candidate = the most recently formed
   qualifying gap** (relaxed location filter, V5) that has not yet confirmed;
   a newer qualifying gap **replaces** a live one.
2. **Confirmation** = close through the active candidate's far edge.
   Unconfirmed at block end unchanged. **No invalidation of any kind.**
3. Pins carried from the v3 design (unchanged semantics): replacement is
   final (a replaced gap's later inversion never counts); only the active
   candidate can confirm; a gap activates at its 3rd bar's close and can
   confirm at the next bar's close at the earliest; transition logging per
   event (`n_candidates_seen`, `replaced_count`, active-gap formation bar and
   size). The v3 invalidation pins and same-bar tie rule are void.

## 2. Required outputs

Same shape as the v3 pass, on the unchanged v2/v3 take-out stream (assert
byte-identical reproduction again):

* Re-derived core tables (confirmation rate, delay, from-confirmation
  MFE/MAE/end-value/stop/R geometry, block lift), per level_session ×
  sweep_block × direction × asset, primary + appendix samples.
* **Four-way delta table: v2 (bug) / v3-A / v4** on the shared headline
  metrics (keep the v3-A column — it is the audit trail of why v4 exists),
  including selected-gap-size distributions. Add an **agreement analysis**:
  on take-outs confirmed by both v2 and v4, how often do they select the
  *same gap*, and where they differ, the delay and gap-size deltas — with
  invalidation gone, the entire residual v2↔v4 difference is
  latest-active-vs-earliest-inverting selection, and this quantifies it.
* State-machine diagnostics (candidates seen, replacements; unconfirmed =
  no-candidate-ever vs candidate-live-at-block-end — only two causes now).
* **Hour-of-day chart** (§5.1 requirement): gap frequency by clock hour +
  confirmed-reversal rate by hourly window, window-length-stratified
  (12–24/24–48/48–72/72+ bars, per §6.1's warning).
* **Worked-example gallery, 20+ panels**, transitions drawn (candidates with
  formation order, replacements marked, boundary line = the swept level
  only — no other reference lines, matching the user's diagram); include a
  stratum of the multi-local-highs-then-reversal shape the user drew, plus
  unconfirmed cases.
* **Pine v6** updated to the v4 mechanic (new file; no invalidation line, no
  BoS) + runbook delta.
* `checks.py`: take-out stream byte-identical to v2/v3; no confirmation from
  a non-active gap; replaced gaps never confirm; block containment; prefix
  stability.

## 3. Deliverable and sequence

`research/session-liquidity-v4/` package (code, `results/`, `viz/`,
delta-style REPORT.md — lead with the v4-vs-v3-A-vs-v2 comparison —,
HANDOFF.md to Architect, `.pine` + runbook), committed to the worktree
branch; `RESEARCH-LOG.md` entry (Russian, usual format). Descriptive
protocol (§8) unchanged. Ask the Architect only where a choice changes what
is measured.

After this pass: user audit of the gallery + hour-of-day chart + Pine → the
PDH/PDL drill-down resumes on the salvaged `researcher-sl-drilldown` code
with the v4 confirmation wired in → BoS pass → strategy design.
