# Design: session-liquidity BoS pass — corrected mechanic, first honest measurement

**Role:** Architect · **Hand-off to:** Researcher.
**Why:** BoS has never been correctly measured. Phase-1's `bos_flags()`
re-anchored its tracked level on every newly confirmed pivot (including
post-take-out pullback pivots), silently testing the wrong level; v2/v3/v4
excluded BoS entirely. The defect analysis and corrected-mechanic sketch are
in `research/session-liquidity/corrections/BOS-CORRECTION-NOTE.md` (read it,
including the sketch images' reading). This pass implements the corrected
mechanic and measures it under the current (v4-era) conventions.
**Authoritative context:** `knowledge/session-liquidity.md` — §1/§3/§4
(sessions, level classes, scope), §6 (block-scoped horizon, ATR), §8
(descriptive protocol). §5.2 will be rewritten from this pass's result.

## 1. The corrected BoS mechanic (pinned)

All on the unchanged v2 take-out event stream (session levels; PDH/PDL out of
scope here), 5m, `fractals(df, k=3)` from
`research/intraday-mr-smc/indicators.py` (reused, never re-implemented).
High-sweep side; low sweep is the exact mirror:

1. **Anchor selection, at the take-out bar `t0`:** the BoS level = the most
   recent pivot **low** that is (a) **confirmed as of `t0`** (its
   confirmation bar — pivot bar + k — is ≤ `t0`) and (b) whose **pivot bar
   index is strictly before `t0`** (this resolves the correction note's
   open question about multi-bar grind extremes mechanically: plain bar-index
   ordering, no special-casing). Pivots confirming after `t0` are ignored for
   this event, permanently.
2. **Persistence:** the anchor is **fixed for the life of the event** and
   watched as a forward ray. **No re-anchoring, ever** — this is the entire
   correction.
3. **Break (the confirmation event):** the first **close** beyond the anchor
   (below the pivot low for a high sweep) within
   `[t0, end of sweep_block]` (block-scoped window, V4 conventions). One
   break maximum.
4. **No anchor exists** (no qualifying confirmed pivot before `t0`): the
   event is "unanchorable" — counted and reported as its own category, not
   silently dropped (expected rare; if it exceeds ~2% of events, say so
   loudly).
5. No confirmation before block end → unconfirmed, as elsewhere.

Measurement conventions identical to v4: geometry from the confirmation
close to block end, wick-anchored reversal as the secondary view, ATR(14,5m)
primary unit, primary sample ≥12 bars remaining + appendix, window-length
strata 12–24/24–48/48–72/72+ as the primary comparative axis.

## 2. Required outputs

* **Core tables** (v4 format): confirmation rate, take-out→break delay,
  from-confirmation MFE/MAE/end-value, stop proxy and R — with the stop
  proxy for BoS pinned as: distance from the break close back to the **sweep
  leg's running extreme** (same convention as iFVG's, so R is comparable
  across methods); per level_session × sweep_block × direction × asset.
* **Corrected-BoS vs phase-1-BoS delta** on shared metrics — quantifies what
  the re-anchoring defect did (the phase-1 numbers measured the wrong event;
  now we can say by how much).
* **Corrected-BoS vs iFVG-v4 comparison** — the original phase-1 question
  ("which confirmation method?"), finally with both methods correctly
  measured on the same event stream: agreement matrix (both / BoS-only /
  iFVG-only / neither), relative timing when both fire, and the §2-format
  geometry side by side. Include whether BoS *selects* (confirmed lift vs
  bare take-outs, window-matched) — the v4 finding that iFVG does not select
  is the standing null here too.
* **Window-length-stratified analysis** as primary axis; clock as derived
  (the "no best hour, only a best remaining window" null applies).
* **Gallery, 20+ panels, the anchored ray drawn from its pivot to its break
  (or window end) on every panel** — the audit gap that hid the original
  defect is itself part of the fix; include confirmed / unconfirmed /
  unanchorable strata and the user's sketch shape (downtrend into the sweep,
  ray from the pre-extreme opposing pivot, break on the reversal). No
  take-out-wick star marker (user preference).
* **Pine v6**: BoS ray rendering per the corrected mechanic (anchor pivot →
  extending ray → break marker), toggleable; new file + runbook delta.
* `checks.py`: anchor pivot bar < `t0` and confirmed ≤ `t0` on every event;
  anchor immutability (no event's level changes after `t0`); block
  containment; prefix stability; reproduction of the v2 take-out stream.
* RESEARCH-LOG.md entry (Russian, usual format); update
  `knowledge/session-liquidity.md` §5.2 with the now-pinned corrected
  mechanic (V-ledger V6 row too) — this pass is what V6 was waiting for.

## 3. Protocol and boundaries

Descriptive (no nulls, no gates), per §8. iFVG-v4 machinery reused read-only
for the comparison; PDH/PDL and strategy design out of scope. Package:
`research/session-liquidity-bos/` (code, results/, viz/, REPORT.md,
HANDOFF.md, .pine + runbook). Ask the Architect only where a choice changes
what is measured.
