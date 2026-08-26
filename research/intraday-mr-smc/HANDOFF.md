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

---

## Addendum — example-trade charts for the retired `smc` candidate (`VIZ-SPEC-SMC.md` pass, 2026-08-26)

**Researcher → Architect.** Separate, visualisation-only pass executing the
Architect's `VIZ-SPEC-SMC.md`. Nothing about the engine, the rule-set, the
parameters or the reported numbers changed; no new backtest was run beyond the
reproduction gate, and the candidate's retirement (`REPORT.md` §8,
`ARCHITECT-NOTE.md` §2.2) is not re-litigated.

* **New:** `viz_trades_smc.py`, `viz/trade_01…10_*.png`,
  `viz/selected_trades.csv`, `viz/CAPTIONS.md`. `README.md` gained one row and
  one rerun line.
* **Gate (§5) reproduced the REPORT.md §3 `smc / 1h` rows exactly**, before any
  trade was selected: BTC 2408 / 37.7% / PF 0.713, ETH 2387 / 38.0% / PF 0.814,
  SOL 2415 / 38.6% / PF 0.914.
* **Selection:** quotas 3 target / 5 stop / 2 time. Seed 42 was rejected (the
  two time-stop trades shared a symbol; only 1 of 3 target trades was
  `textbook`); **seed 43** satisfied every §3.5 sub-quota and §3.7 constraint
  and won. No trade was hand-picked or swapped. Drawn set: 3 symbols, entry
  years 2022/2023/2024/2025/2026, 5 long / 5 short, 3 FVG-only triggers,
  4 textbook stops, 2 textbook targets.
* **The number worth carrying to the user:** across the full pooled ledger
  (7,207 trades, `eod` dropped), **4,512 (62.6%) are `textbook`** — an
  order-block retest of a break of structure ≤ 20 bars old — and their win rate
  is **35.3%**, against a full-ledger **38.1%** and a 2R break-even line of
  **33.3%**. The pattern is neither rare nor visibly wrong; it simply does not
  discriminate. That is the failure the charts make visible, and it is
  consistent with the −0.03 bp / 46,045-observation edge probe (`REPORT.md` §4).
* **Mechanical detail the charts expose:** `smc()` anchors the stop to the
  order block whenever `ob_dir` matches the trade side, even when only the FVG
  condition fired. Three of the ten selected trades are exactly that case; the
  charts draw the triggering FVG at full alpha and the stop-basis OB faintly,
  and `zone_trigger` / `stop_basis` are recorded separately in the audit CSV.
* **Nothing here changes any routing recommendation.** The charts are a
  communication artefact for the user, not new evidence.
