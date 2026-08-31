# Pine delta — `session_liquidity_v4_pdhpdl.pine`

**What it is:** the v4 indicator (`../../session-liquidity-v4/session_liquidity_v4.pine`)
plus one addition — an optional **PDH/PDL layer, default OFF**. The v4 file is not
modified. With `Draw prior-day high / low (PDH / PDL)` unchecked, this file plots
exactly what v4 plots; every added drawing is guarded by that input.

`diff` against the v4 file is **purely additive**: 118 added lines, and the only
lines that change are the header's "no PDH/PDL rays" sentence and the
`indicator()` title.

**Why a copy rather than an edit:** the v4 indicator is the audit surface the v4
report's numbers were checked against, and the user may still have it loaded on a
chart. A second script means the v4 audit and the new level class can sit on the
same chart at once, and an experiment with PDH/PDL can never silently change what
the v4 panel shows.

**Why it is rebased on v4 and not on v2:** the earlier drill-down attempt built
this delta on `session_liquidity_v2.pine`, whose iFVG drawing is the retroactive
best-pick that v4 replaced. That file is gone from this package. The state
machine drawn here is v4's — active candidate, replacement finality,
active-only confirmation, no invalidation line.

## The diff, piece by piece

| # | Where | What was added |
|---|---|---|
| 1 | header comment | The PDH/PDL definition (full prior UTC day, Late included), the measured 15.9% Late-sets-the-extreme share that justifies it, and the statement that it is a separate stream that the iFVG-v4 machine never sees. |
| 2 | `indicator(...)` | Title/short-title renamed to `SessLiq v4+PD` so the two scripts are distinguishable in the TradingView pane list. |
| 3 | new input group `grpP` | `showPD` (**default false**), `markPDSw`, `pdBand`, `cPD`. Everything below is gated on `showPD`. |
| 4 | new section before take-out detection | The PDH/PDL engine: a running `dHi`/`dLo` over the UTC day; on the first bar of a new day they are frozen into `pdH`/`pdL`, which is the same instant the rays are drawn — the level is a *closed* day's property and is never drawn before midnight, which is what makes the panel auditable for lookahead by eye. Two rays extended across the day, an optional shaded prior-day range box, per-side `pdHit_*` retirement on first take-out (V7), and take-out glyphs. |
| 5 | alerts | `alertcondition` for `pdTookH` / `pdTookL`. |

## What is deliberately NOT in it

* **No BoS.** Still out of scope (V6), neither computed nor drawn — same as v4.
* **PDH/PDL does not join the level pool.** `lvPx` / `lvHigh` / `lvExp` are
  untouched, so a PDH/PDL take-out never retires a session level and never
  changes a single thing the v4 panel does. This mirrors the Python side, where
  the day-level events go to their own file.
* **The iFVG-v4 state machine does not watch PDH/PDL take-outs.** On the chart it
  still starts only on a session-level take-out. The Python engine *does* run
  `ifvg_confirm_v4` against day-level take-outs — that is a research
  measurement, and wiring a second on-chart machine would double the drawing
  load for no audit value.
* **No de-duplication of coincident levels.** When a PDH sits at the same price
  as a still-alive session high — which is the *usual* case, 74.6% of day-level
  take-outs (`results/d5_coincidence.csv`) — both are drawn, and you will see two
  markers on one bar. That is correct: it is one excursion taking two levels, and
  hiding one of them would hide the most important diagnostic about the new class.

## How to check it against the Python side

1. Load `session_liquidity_v4_pdhpdl.pine` on BTCUSDT.P 5m, PDH/PDL toggle **on**.
2. Pick any row from `results/PD-GALLERY.md` (asset, UTC timestamp, side).
3. Jump the chart to that timestamp. The `PDH swept` / `PDL swept` glyph should be
   on that bar, and the ray it crossed should be the level in the manifest's panel.
4. The gallery panel for that row draws the prior UTC day as a band and marks the
   bar inside it where the extreme printed — compare that against the chart's own
   prior day. Discrepancies here are the bug class worth reporting.
