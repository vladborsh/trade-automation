# Hand-off: Researcher → Architect (session-liquidity **v3**, corrected iFVG)

**Status:** DESIGN.md executed in full. Package committed on
`researcher-sl-v3`. `checks.py` prints ALL CHECKS PASSED (26 assertions + 2
counted diagnostics). Scope held: iFVG confirmation layer only, unchanged v2
event stream, no BoS, no PDH/PDL, no drill-down.

Read: [`REPORT.md`](REPORT.md) §2 first (it changes a premise of your brief),
then §3. Audit surface: [`results/GALLERY.md`](results/GALLERY.md) (28 panels)
and `viz/06_hour_of_day.png`.

---

## The short version

1. **Your pin 3 rested on a false premise, and it turned out to be the biggest
   lever in the study.** A bar that both inverts the active gap and closes
   beyond the take-out extreme is not contradictory — for a high sweep the
   candidate gap normally forms *above* the take-out bar's high, so the two
   trigger zones overlap by construction and every close in the band does
   both. It fires on 13.2 % of events. Per your mid-pass ruling: A is primary,
   B and C ship as labelled sensitivities, and the report leads with the
   finding. **Confirmation rate: A 20.7 % / B 34.6 % / C 60.4 % / v2 64.4 %.**
2. **The correction works and is provable.** The take-out stream reproduces
   v2's committed events exactly, and v2's algorithm re-run inside the v3
   engine reproduces v2's own confirmations exactly — so every number that
   moved, moved because of the confirmation layer and nothing else.
3. **v2's central conclusion survives the correction.** A confirmed sweep is
   still a coin flip from the confirmation close: MFE > MAE in 50.1 % of
   confirmed events (v2: 49.7 %), favourable at block close in 52.0 % (v2:
   51.4 %), median R proxy 0.74 (v2: 0.84). The bug bought **volume, not
   edge** — 3× the confirmations at the same ~50/50 geometry.
4. **One v2 conclusion is overturned.** v2 said the confirmation *eats* the
   take-out's lift (confirmed lift 0.97–1.23× vs 1.23–1.58× for all
   take-outs). Under v3, confirmed lift is **1.28–1.75×, above the
   all-take-out lift in every block**, and window-matched it stays above 1.0
   in every bucket. The corrected filter is far more selective and does select
   stronger reversals. It still only breaks even from the confirmation close,
   because the median confirmation arrives 70 minutes and 2.72 ATR of stop
   distance later.
5. **The user's small-gap-bias prediction is wrong about the sign.** v2's
   selected gaps are *larger* than v3's on the same events (0.364 vs 0.298
   ATR median). Where they disagree, v2 takes an early, larger gap (+7 bars,
   0.352 ATR) and v3 a late, small one (+33 bars, 0.182 ATR). The prediction
   was right that the selection is biased and contaminates gap-size analysis;
   the direction is the opposite of what was expected, and the reason is the
   invalidation rule, not the best-pick.
6. **Invalidation, not gap scarcity, is now the dominant failure mode**:
   44.9 % invalidated out, 30.3 % no candidate ever, 4.0 % live at block end.
   Note that the `no_candidate` bucket has the **largest** median in-block
   reversal of all four (5.98 ATR) — the rule has nothing to fire on exactly
   where the move is best.
7. **Hour of day (the §5.1 required deliverable) has no independent signal.**
   Gap formation is flat across the clock (21.3–24.5 per 100 bars). The
   unstratified hourly confirmation rate looks strong but resets at every
   block boundary — it is window length in an hour costume. Stratified, the
   effect largely flattens. There is no best hour; there is a best amount of
   block left.

---

## What this means for re-deriving `STRATEGY-DESIGN.md`

* Any number in the phase-2 design that came from a confirmation rate, a
  confirmation delay, or from-confirmation geometry is now **twice** invalid
  (phase-1 definitions, then v2's algorithm). Use §3 of this REPORT.
* A strategy built on rule A has a **20.7 % trigger rate on 21,118 take-outs
  over 4 years across 4 assets** — roughly 3 confirmed signals per day across
  the whole basket. That is a thin instrument. Under C it is ~9/day. The
  A/B/C ruling therefore changes the *shape* of any design, not just a
  parameter.
* The per-cell dispersion is wide (T2c: confirmation rate 3–32 %, median R
  0.04–1.62 across 96 cells with n ≥ 15). Do not build on a single cell.
* The v2 asymmetry survives: **NY as a block** (51 % of take-outs, median R
  0.84) vs **London as a level source** (median R 0.90, NY worst at 0.65).
  **Late remains a different, worse regime** (14.8 % confirmed, median R
  0.46) despite having the highest lift, because its baseline is quietest.
* Stability is the honest brake: monthly median R proxy exceeds 1.0 in only
  **4 of 48 months**.

---

## Open questions for you (I did not decide these)

1. **The A/B/C ruling is the user's, and it is question one.** A is what they
   pinned; B and C are one line of code apart and change the study by 3×. My
   own read, offered as input and not as a decision: C is the most defensible
   *as a trading rule* (a candidate is only killed when price closes beyond
   the whole sweep impulse, so the reversal thesis is genuinely dead), A is
   the most conservative, and B is hard to justify on its own merits — it
   keeps the take-out-bar reference but lets a confirmation fire while price
   is still above it, which is the awkward middle.
2. **Should an orphan breach end the watch?** Invalidation is defined on the
   *active candidate*, so a close beyond the take-out extreme while nothing is
   active currently does nothing. 60.9 % of confirmations happened after at
   least one such breach (median 4 per event, p90 55). Under a reading where
   any breach ends the watch, the rate falls further. §5.1 does not say;
   I implemented it literally and measured it rather than guessing.
3. **Is "invalidated out at 44.9 %" a finding or a mis-specified rule?** Under
   A a candidate formed inside the sweep impulse cannot survive to invert.
   Whether that is the intended behaviour is a judgement about the idea. The
   `uncinv*` and `above*` gallery strata are built for exactly this call.
4. **Sensitivity variants are no longer nested.** Under a sequential machine,
   strict location is not a subset of relaxed (179 of 3,060 strict
   confirmations are not relaxed confirmations) — a stricter filter admits
   fewer candidates, so a gap that would have been replaced never exists.
   Worth knowing before any future pass reads a "sensitivity row" as a subset.
5. **`knowledge/session-liquidity.md` needs one edit**, which is yours to
   make: §5.1 should state the tie case explicitly (currently implicit) and
   record which of A/B/C is the pinned V9 default after the user rules. I did
   not touch the knowledge file.

---

## Sequence from here

Unchanged from `DESIGN.md` §3, with the ruling inserted:

1. **User audits** `results/GALLERY.md` (especially the `above*` and `uncinv*`
   strata) + `viz/06_hour_of_day.png` + the Pine indicator on TradingView, and
   **rules on A/B/C**.
2. `knowledge/session-liquidity.md` §5.1 updated with that ruling.
3. PDH/PDL drill-down resumes (salvaged non-iFVG code from
   `researcher-sl-drilldown`, §5.1 wired in).
4. BoS correction pass (§5.2).
5. Architect re-derives the strategy design.
6. Backtest.

**One process note.** Both v2's bug and this pass's pin-3 problem were caught
by looking at pictures, not by reading code — the gallery twice, and a
diagnostic table once. The 20-minute cost of rendering panels before writing
prose has now paid for itself three times in this idea alone. I would keep it
as a standing requirement for any pass that introduces a new mechanic.
