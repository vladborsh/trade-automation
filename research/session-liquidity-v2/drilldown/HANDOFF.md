# HANDOFF — session-liquidity drill-down (post-v4) → Architect

**From:** Researcher · **Package:** `research/session-liquidity-v2/drilldown/` ·
**Full write-up:** `REPORT.md` · **Numbers:** `results/TABLES.md` + CSVs ·
**Charts:** `viz/01`–`08` · **Gallery:** `results/PD-GALLERY.md` + `viz/pd_*.png`

## The verdict, in the terms the brief asked for

**No (level class × window regime) cut separates from the known break-even
aggregate in a way that survives the scale-free check.** State it plainly in any
downstream summary.

* **The one cell that beats R 1.00:** C1 (London level swept in NY) × **72+ bars
  of block remaining** — median R **1.128**, R≥1 **54.2%**, n=3,502 confirmed,
  above 1.00 in **4/4 assets**. That is **+0.123 R and +4.2pp** over C1's
  aggregate.
* **Why I do not believe it is selection:** that same cell has **MFE/MAE 0.90**
  and **median signed ER +0.003**. R's numerator grows with the window; the stop
  proxy, frozen at the sweep leg, does not. The regime buys a longer window, not
  a better sweep. `viz/02_window_regime.png` is the one picture that makes this
  argument.
* **The clock question is closed, again.** Raw 2h R spread 0.37–0.59 per combo
  collapses to 0.043–0.125 within a fixed window-length stratum (79–88% gone),
  and hour vs bars-remaining is ρ = −0.94 … −0.99. **The clock, not the hour** —
  v4's null survives on both level classes.
* **The gap-size predictor is flat** and should not be carried. It correlates
  with R in 12/12 asset-combos, but ρ(gap, **stop proxy**) = +0.34 … +0.42 while
  MFE barely moves — it is a relationship with R's denominator. Against signed ER:
  |ρ| ≤ 0.06 everywhere, sign inconsistent.

## The one thing worth carrying

**C3 — PDH/PDL swept in Asia — is the only cut in the study with a consistent
scale-free shape:** MFE > MAE in **4/4** assets, positive median ER in **4/4**,
highest clean-trend share (39.1% at 72+). It pays with a wider stop, so its
median R (0.80–0.92) is *below* C1's. It survives on the pure, non-coincident
subset (534 confirmed events at 72+). A shape, not an edge — but it is the only
finding that does not dissolve under stratification.

## Two facts a design pass must not skip

1. **73.2% of PDH/PDL take-outs are a session level in disguise** (an alive
   session level within 0.05 ATR). The genuinely new population is ~0.24 pure
   day-level take-outs per asset-day. The class is real and audited; it is also
   small.
2. **The stop proxy is doing a lot of work in every R number here**, and it is a
   proxy (the sweep-leg extreme), not a committed rule. Several orderings above
   would move under a different stop. **I would pin a real stop rule before
   running any further R-based comparison.** That is the largest fragility in
   this package.

## Also decided / delivered

* **C2 (PDH/PDL swept in NY) does not warrant further work** — weakest combo on
  every column and every per-asset count.
* PDH/PDL is now fully specified, implemented, diagnosed and visually audited
  (§2, §6 of REPORT.md; 27 assertions passing, including a lookahead check and a
  60%-prefix causality check).
* **Wiring check requested by the brief: PD0 passes** — `ifvg_confirm_v4`
  re-run from this package reproduces the v4 package's committed confirmation
  set on 6,000 sampled session-level events, 0 mismatches. PD0b asserts this
  package defines no confirmation of its own.
* Pine: `session_liquidity_v4_pdhpdl.pine` — the **v4** indicator plus an
  optional PDH/PDL layer, default off, purely additive diff (`PINE-DELTA.md`).
* Gallery panels drop the take-out-wick star marker per the user's request; the
  boundary line is the swept level, and every candidate gap the v4 machine saw is
  drawn and numbered by fate.

## Open, not decided here

* **BoS (§5.2, V6)** is still quarantined and unmeasured. It is the only
  untested detection method left in the idea.
* Whether the ~0.24/asset-day pure day-level population is worth a design pass at
  all is an Architect call, not a Researcher one.
* No `knowledge/session-liquidity.md` edit was made by this pass — §3.2 was
  already pinned and the measurements did not change any definition. §0's
  "PDH/PDL drill-down — designed, dispatch halted" bullet is now stale and wants
  a status line pointing at this package.
