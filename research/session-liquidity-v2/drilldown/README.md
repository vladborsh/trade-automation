# session-liquidity drill-down (post-v4)

Which **level class** and which **window regime** select, with the **iFVG-v4**
mechanic held fixed as the entry reference.

Read in this order: `DESIGN.md` (the brief, with its 2026-08-31 REFRAMED header
governing) → `REPORT.md` (findings) → `results/TABLES.md` (every number) →
`HANDOFF.md` (what the Architect needs).

| file | what |
|---|---|
| `dd_common.py` | shared plumbing, the DD1–DD10 ledger, signed ER, gap-size predictor. Imports the **v4** package; forks nothing. |
| `pd_engine.py` | the PDH/PDL level class (§3.2) as a **separate** event stream, confirmed by `ifvg_confirm_v4` |
| `dd_prep.py` | both streams + derived causal columns → `results/dd_events.csv.gz` |
| `dd_checks.py` | 27 assertions, incl. **PD0** (the v4 wiring check) and PD18 (causality) |
| `dd_tables.py` | D (stream diagnostics) → A (aggregates) → **W (window regime, primary)** → S (clock, secondary) → G (gap size) |
| `dd_charts.py` | `viz/01`–`08` |
| `dd_gallery.py` | 18-panel PDH/PDL worked-example gallery (no wick star marker) |
| `session_liquidity_v4_pdhpdl.pine` | the v4 indicator + optional PDH/PDL layer, default off (`PINE-DELTA.md`) |

Answer in one line: **no cut separates once window-length scaling is removed**;
the only consistent structural signal is C3 (PDH/PDL swept in Asia) having
MFE > MAE and positive ER in 4/4 assets, at the cost of a wider stop.

Reproduce: see `REPORT.md` §9.
