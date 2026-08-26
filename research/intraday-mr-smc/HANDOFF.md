# Hand-off: Researcher → Architect

**Idea:** intraday perpetual-futures rule-set (long + short) for BTC / ETH / SOL,
same rules applied independently per asset. Three candidates compared:
pure mean reversion, pure SMC, and an SMC-filtered mean-reversion hybrid.

**Read first:** `research/intraday-mr-smc/REPORT.md` (findings) then
`research/intraday-mr-smc/README.md` (how to rerun anything in it).

## Bottom line for your routing decision

Across 48 months of Binance USD-M perp data (2022-08 → 2026-07), 3 assets,
3 intervals, 192 parameter configurations, with 1%-per-trade sizing and the 2%
daily circuit-breaker enforced inside the engine:

* **No candidate × interval × asset combination met the targets** (PF > 1.2 and
  win rate > 50%). Best PF found anywhere was 1.10, on 184 trades.
* **Removing all fees and slippage does not fix it** — gross profit factors sit
  at 0.83–1.27. The signals themselves carry no reliable forward edge
  (`edge_probe.py`: median t-stat between −0.9 and +0.8, essentially no cells
  significant).
* The negative result is uniform across regimes (trend and chop both lose) and
  across four consecutive 12-month blocks, so it is not a tuning artefact or a
  single bad window.
* The one real *structural* finding: **1h dominates 15m dominates 5m** for all
  three candidates. 5m is unviable at retail taker cost regardless of rule-set.
* The one candidate with signs of life: **the hybrid**. Its SMC gates do what
  the idea claimed — win rate 46% → 55–68%, max drawdown 50–100% → 6–10% — but
  the surviving sample (~16 trades/symbol/year at 1h) is both unprofitable and
  too small to conclude much.

## My recommendation to you

Do **not** route any of the three to Implementation as specified. The two
options I would put in front of you:

1. **Cheap follow-up research (my preference).** The MR trigger's forward
   return is *negative* at 1h, which is evidence for continuation rather than
   reversion at these thresholds. Probing the momentum inversion of the same
   trigger reuses this harness almost unchanged. Send it back to Researcher.
2. **Tighten the hybrid's filter and pre-commit to a minimum sample.** Worth
   doing only if you accept up front that the answer may be "too few trades to
   tell". Also Researcher, not Implementation.

Routing to **Critique & Refinement** before either is reasonable — the SMC
encoding is the part of this package most worth a second opinion (see REPORT.md
§9: a different but equally defensible encoding of order blocks / sweeps could
give different numbers, and I want that challenged before the idea is shelved).

## What is in the package

| path | what |
|---|---|
| `research/intraday-mr-smc/REPORT.md` | Findings, comparison tables, pros/cons, doubts, implementation guidelines. |
| `research/intraday-mr-smc/README.md` | Data provenance, script map, reproduction commands, the risk rules as coded. |
| `research/intraday-mr-smc/*.py` | Runnable data pull + analytics: `fetch_data`, `indicators`, `strategies`, `backtest`, `run_sweep`, `param_scan`, `edge_probe`, `stability`. |
| `research/intraday-mr-smc/results/` | All CSV outputs backing every number in the report. |
| `research/intraday-mr-smc/data/` | 48 months of klines (gitignored; regenerate with `fetch_data.py`, no credentials needed). |

**Infra note for you to flag onward:** nothing here needed credentials — the
Binance public bulk archive was sufficient for 48 months at 5m granularity, and
33 MB gzipped per full pull. If this pipeline ever runs regularly, that archive
is a cheap S3-backed ingestion path for the DevOps role to consider.
