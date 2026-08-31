# research/session-liquidity — phase 1 (descriptive)

Frequency and magnitude study of session-liquidity sweeps on BTC/ETH/SOL/BNB,
5m, 2022-08 .. 2026-07. Descriptive only — no null model, no kill rule, no gate.

Start with **`REPORT.md`**. `HANDOFF.md` is the Architect's routing note.
`RUNBOOK.md` covers the TradingView indicator.

## Files

| File | What it is |
|---|---|
| `common.py` | data loading, session windows, causal columns. Imports `atr()`/`fractals()` from `research/intraday-mr-smc/indicators.py` — primitives are reused, not reimplemented |
| `engine.py` | level pool, take-out detection, iFVG + BoS confirmation, reverse-move measurement → `results/events_*.csv`, `results/uncond_*.csv.gz` |
| `tables.py` | all 13 aggregation tables → `results/t*.csv` and `results/TABLES.md` |
| `charts.py` | statistical charts → `viz/02..09_*.png` |
| `examples.py` | worked example events → `viz/ex01..ex08_*.png` |
| `checks.py` | correctness assertions for the hygiene claims in `REPORT.md` §0 — run it after `engine.py` |
| `session_liquidity.pine` | TradingView v6 **indicator** for the manual visual audit |
| `RUNBOOK.md` | how to run and verify the indicator |
| `REPORT.md` | the findings. §4 is `results/TABLES.md` pasted in — regenerate that file and re-paste if the engine changes |
| `HANDOFF.md` | Researcher → Architect |

`data/` is a symlink to the existing `research/intraday-mtf-smc/data/` 5m pull
(gitignored — recreate it before running, see `REPORT.md` §7).

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install pandas numpy matplotlib
cd research/session-liquidity
../../.venv/bin/python engine.py     # ~30s
../../.venv/bin/python tables.py
../../.venv/bin/python charts.py
../../.venv/bin/python examples.py
../../.venv/bin/python checks.py   # all assertions must pass
```

`results/uncond_*.csv.gz` (the unconditional yardstick, 1.68M rows/asset) is
gitignored — `engine.py` regenerates it.

## Definitions

All definitions come from `knowledge/session-liquidity.md`. The nine points that
file was silent on are pinned as D1–D9 in `REPORT.md` §1 and have been written
back into the knowledge file.
