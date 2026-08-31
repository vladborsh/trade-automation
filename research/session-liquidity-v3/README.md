# `research/session-liquidity-v3/` — corrected iFVG confirmation, core numbers redo

A **delta pass** over `research/session-liquidity-v2/`: it replaces one layer —
how a swept level's reversal gets confirmed — and re-derives only the numbers
that depend on it. v2's `ifvg_confirm` retroactively best-picked the
earliest-inverting gap across the whole block window; `knowledge/session-liquidity.md`
§5.1 (V9) replaces that with a **sequential state machine** (one active
candidate, latest formation wins, replacement is final, close-based
invalidation against the take-out bar's own extreme).

Everything upstream of confirmation is unchanged and lives in v2 — and that is
proved, not assumed: `checks.py` asserts the v3 take-out stream reproduces v2's
committed `events_*.csv` exactly.

## Start here

| If you want… | Read |
|---|---|
| the findings | [`REPORT.md`](REPORT.md) — **§2 first** (a premise of the brief was wrong), then §3 |
| to audit the mechanic on real charts | [`results/GALLERY.md`](results/GALLERY.md) + the 28 `viz/{conf1,confrep,confinv,above,uncinv,unclive,uncnone}*.png` panels |
| to audit it on TradingView | [`session_liquidity_v3.pine`](session_liquidity_v3.pine) + [`RUNBOOK.md`](RUNBOOK.md) |
| the routing note / what the Architect must decide | [`HANDOFF.md`](HANDOFF.md) |
| every table as data | `results/*.csv`, assembled in `results/TABLES.md` |
| the brief this executes | [`DESIGN.md`](DESIGN.md) |
| the authoritative definitions | `../../knowledge/session-liquidity.md` |

## Headline

* Confirmation rate **64.4 % → 20.7 %** on the identical 21,118-event primary
  sample.
* v2's central conclusion — a confirmed sweep is a coin flip from the
  confirmation close — **survives**: MFE > MAE in 50.1 % of confirmed events
  (v2: 49.7 %). The bug bought volume, not edge.
* One v2 conclusion is **overturned**: confirmed lift over the block baseline
  goes from 0.97–1.23× (v2) to **1.28–1.75×** (v3).
* DESIGN §1 pin 3's "near-impossible" tie case is **common (13.2 % of
  events)** and is the biggest single lever in the study — see REPORT §2.

## Layout

```
DESIGN.md                  the Architect's brief this executes
REPORT.md                  the findings (delta-style; §2 is the one to read first)
HANDOFF.md                 Researcher → Architect routing note
RUNBOOK.md                 delta runbook for the Pine indicator
session_liquidity_v3.pine  TradingView audit instrument (v6), state machine drawn
common.py                  fork of v2's; behaviourally identical, verified by diff
engine.py                  the v3 state machine + v2's algorithm, run side by side
checks.py                  26 assertions + 2 counted diagnostics (run after engine.py)
tables.py                  D* v2-vs-v3, V* variants, S* diagnostics, T* core, H* hour, A* appendix
charts.py                  charts 01-07 (06 is the required hour-of-day chart)
examples.py                draw_event() — the transition-drawing renderer — + 8 teaching panels
gallery.py                 the stratified 28-panel audit gallery, 7 strata
data -> ../intraday-mtf-smc/data   symlink; no new data pull
results/                   TABLES.md, GALLERY.md, events_*.csv, transitions_*.csv.gz, CSVs
viz/                       01..07 charts, ex01..08 teaching panels, the 28 gallery panels
```

## Reproducing

```bash
cd research/session-liquidity-v3
python engine.py     # ~40s
python checks.py     # must print ALL CHECKS PASSED
python tables.py
python charts.py
python examples.py
python gallery.py
```

v2 code was **forked, never modified** — nothing under
`research/session-liquidity-v2/` or `research/session-liquidity/` is touched by
anything in this package.
