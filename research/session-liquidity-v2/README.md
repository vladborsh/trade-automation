# `research/session-liquidity-v2/` — session-liquidity sweeps, v2 descriptive redo (iFVG only)

A **redo** of `research/session-liquidity/` under the definitions reissued in
`knowledge/session-liquidity.md` after the user rejected several phase-1
methodology choices (RESEARCH-LOG.md Запись 11). Phase-1's REPORT.md and
STRATEGY-DESIGN.md are provisionally invalidated; this package supersedes their
numbers. **BoS is out of scope** — it is not computed, tabulated or drawn here.

## Start here

| If you want… | Read |
|---|---|
| the findings | [`REPORT.md`](REPORT.md) — §2 headline, §5 what stands out, §6 doubts |
| to audit the mechanic on real charts | [`results/GALLERY.md`](results/GALLERY.md) + the `viz/{win,fail,unconf}*.png` panels |
| to audit it on TradingView | [`session_liquidity_v2.pine`](session_liquidity_v2.pine) + [`RUNBOOK.md`](RUNBOOK.md) |
| the routing note / what the Architect must decide | [`HANDOFF.md`](HANDOFF.md) |
| every table as data | `results/*.csv`, assembled in `results/TABLES.md` |
| the brief this executes | [`DESIGN.md`](DESIGN.md) |
| the authoritative definitions | `../../knowledge/session-liquidity.md` |

## What changed vs phase 1

1. Sessions are a **non-overlapping partition**: Asia 00–08, London 08–13,
   NY 13–21, Late 21–24 UTC. Late hosts sweeps but produces no levels.
2. The fixed 2h horizon is gone. Every window — magnitude **and** iFVG
   formation/inversion timing — is **block-scoped**: take-out bar → last bar of
   its `sweep_block`.
3. iFVG location is **relaxed** (the gap need only reach beyond the swept
   level); the strict phase-1 reading is a sensitivity row.
4. ATR(14, 5m) confirmed as the primary unit; raw % secondary.
5. BoS removed entirely, including from the Pine indicator.

## Layout

```
DESIGN.md                  the Architect's brief this executes
REPORT.md                  the findings
HANDOFF.md                 Researcher → Architect routing note
RUNBOOK.md                 delta runbook for the Pine indicator
session_liquidity_v2.pine  TradingView audit instrument (v6)
common.py                  loading, the v2 block partition, block_arrays(), session_frames()
engine.py                  take-out detection + block-scoped measurement + relaxed iFVG
checks.py                  19 correctness assertions (run after engine.py)
tables.py                  every table; the primary/appendix split lives here
charts.py                  charts 01–09
examples.py                draw_event() — the shared panel renderer — + 8 teaching panels
gallery.py                 the stratified 30-panel audit gallery
data -> ../intraday-mtf-smc/data   symlink; no new data pull
results/                   TABLES.md, GALLERY.md, events_*.csv, uncond_*.csv.gz, t*/w*/a* CSVs
viz/                       01..09 statistics charts, ex01..08 teaching panels, win/fail/unconf gallery
```

## Reproducing

```bash
cd research/session-liquidity-v2
python engine.py     # ~35s
python checks.py     # must print ALL CHECKS PASSED
python tables.py
python charts.py
python gallery.py
python examples.py
```

Phase-1 code was **forked, never modified** — nothing under
`research/session-liquidity/` is touched by anything in this package.
