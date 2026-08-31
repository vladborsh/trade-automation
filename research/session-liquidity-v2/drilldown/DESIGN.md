# Design: session-liquidity drill-down — three combos, sub-windows, gap-size predictor

**Role:** Architect · **Hand-off to:** Researcher.
**Parent package:** `research/session-liquidity-v2/` (definitions, engine,
event stream — reuse, do not modify). **Authoritative definitions:**
`knowledge/session-liquidity.md`, including the new **PDH/PDL level class**
pinned there for this pass. Protocol unchanged from v2: **descriptive only**
(no nulls, no gates), block-scoped horizon, non-overlapping sessions,
ATR(14, 5m) primary unit, **iFVG only** (BoS still quarantined).

## 0. The three combos under the microscope

| combo | level | sweep_block | event source |
|---|---|---|---|
| C1 | London session level | NY | existing v2 stream, filtered (≈6.7k primary events — the strongest cell in the v2 report) |
| C2 | **PDH/PDL** (new class) | NY | new PDH/PDL stream |
| C3 | **PDH/PDL** (new class) | Asia | new PDH/PDL stream |

The PDH/PDL stream is built per the knowledge-file definition (full prior UTC
day extreme including Late; sweepable next day only; separate stream;
`coincident_session_level` flag). Build it for all blocks (cheap, and the
C2/C3 filter is then just a cut), but only C2/C3 are analyzed in depth.

For each combo, two questions — (a) sub-windows, (b) gap-size predictor —
answered with the same machinery so the three combos are directly comparable.

## 1. Question (a): time sub-windows inside the sweeping block

Bucket each event by the **take-out bar's hour within its sweep_block**:
eight 1h buckets (NY 13:00–21:00; Asia 00:00–08:00), plus a coarse 2h
roll-up (4 buckets) for stability — both reported, the 2h view is primary
when hourly counts drop below ~50 events/bucket/combo.

**The trendiness metric (pinned — "directional, not choppy"):**

* **Primary: signed efficiency ratio** of the post-confirmation path to the
  block end: `ER = (close_end − close_conf, signed into the reversal
  direction) / Σ|bar-to-bar closes|` over the same span. +1 = perfectly
  trending reversal, ~0 = chop, negative = trending continuation against the
  sweep. Report median and IQR per bucket.
* Secondary: median MFE_ATR, MFE/MAE ratio, share of events with
  MFE ≥ 2 × MAE (the "clean trend" share), and share reaching R ≥ 1 against
  the sweep-leg stop proxy — all as in the v2 report's conventions.

**The window-length confound is the design's central hazard.** The v2 pass
proved window length is the strongest single driver in this dataset, and
later take-outs mechanically have shorter windows — so a naive sub-window
table would mostly rediscover the clock. Required treatment:

1. Every sub-window table carries the bucket's window-length distribution
   beside its outcome columns.
2. The comparison that supports any "hour X is better" statement is
   **window-length-stratified**: events grouped into window-length strata
   (pinned: 12–24 / 24–48 / 48–72 / 72+ bars remaining), sub-window
   comparisons made within strata, and the per-stratum pattern reported. A
   sub-window effect that vanishes within strata is reported as "the clock,
   not the hour".
3. The primary sample keeps the v2 ≥12-bars-remaining rule.

## 2. Question (b): iFVG gap size as a predictor

**Numerator:** the inverting FVG's gap height, `gap_high − gap_low`.

**Denominator (my call, documented per the brief):**

* **Primary: ATR(14, 5m) at the gap's formation bar** — causal, cross-asset
  comparable, and consistent with the project's unit decision. So the
  predictor is *gap size in ATR multiples*.
* **Secondary: the swept level's own session range** (level_session high −
  low; for PDH/PDL, the prior day's range) — known and frozen before any
  sweep, causal, and captures "how big is the gap relative to the liquidity
  structure it swept". Reported alongside to see whether structure-relative
  scaling says anything ATR-scaling does not.
* **Rejected: the sweep_block's range** — the block's full range is not known
  at confirmation time (lookahead); range-so-far was considered and dropped
  as a moving denominator that confounds the predictor with time-in-block.

**Analysis (descriptive, pre-pinned):** per combo, quintiles of the primary
predictor; per quintile, the same outcome metrics as §1 (signed ER primary).
Strength = the Spearman rank correlation between the predictor and signed ER
(and MFE_ATR) reported with its value per combo per asset — descriptive
statistics, not significance gates. A monotone quintile pattern plus a
consistent-sign correlation across the 4 assets is the bar for calling it "a
relationship worth carrying to a design pass"; anything else is reported as
flat. The gap-size distribution itself (per combo) is reported so quintile
edges are interpretable in ATR terms. Window-length confound applies here
too: report the correlation within the same §1 strata as a robustness column
(gap size and time-remaining should be unrelated, but that is checked, not
assumed).

## 3. Required outputs

* `research/session-liquidity-v2/drilldown/` — code (imports the parent v2
  engine; **no modifications to parent files**), `results/`, `viz/`,
  `REPORT.md`, HANDOFF.md back to Architect, RESEARCH-LOG.md entry (Russian,
  usual format).
* PDH/PDL stream diagnostics (before any combo analysis): events/day
  frequency, take-out rate, iFVG-confirmation rate, share of days where Late
  set the day's extreme, `coincident_session_level` share — plus a
  **10–20-panel worked-example gallery of PDH/PDL sweeps specifically**
  (wins / failures / unconfirmed, day-level ray + session rectangles + FVG
  drawn). A new level class does not ship without its own visual audit
  surface; this is the user's checkpoint format.
* Per combo: the §1 sub-window tables (hourly + 2h, with stratified
  companion), the §2 quintile/correlation tables, and comparison charts
  (sub-window bar charts with window-length overlays; quintile→outcome
  plots).
* Pine: extend the v2 indicator with an **optional PDH/PDL ray toggle**
  (default off; new file in the drilldown dir or a documented delta —
  researcher's choice; no BoS drawing, as before).
* `checks.py`-style assertions extended to the PDH/PDL stream: level frozen
  before its day starts, no boundary crossing, stream separation (no event
  appears in both streams), prefix stability.

## 4. Framing constraints for the report

* Descriptive protocol: findings are stated as measured patterns, not
  pass/fail. But the v2 report's honesty conventions carry over — every
  sub-window or quintile claim carries its stratified companion, and a
  pattern that dies under stratification is called "the clock" in plain
  words.
* C1's baseline numbers (median R 1.00 aggregate) are already known from v2 —
  the drill-down's job is whether *any interior cut* of C1/C2/C3 separates
  from that break-even aggregate, and by how much, per the user's two
  questions. Say plainly in the report whether the answer is "yes, and here"
  or "no cut separates".
* Ask the Architect only where a choice changes what is measured; document
  everything else per the V-ledger convention.
