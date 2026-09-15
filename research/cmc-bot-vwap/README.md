# `cmc-bot` VWAP band-reversal strategy — research package

**Stage:** Stage 0 (parity reproduction + signal inventory) complete. **No
performance number exists in this package** — no R, no win rate, no
expectancy, no verdict. Stage 1 (the pre-registered test of
`ARCHITECT-NOTE.md` §3) needs a separate Architect go-ahead.

Read in this order:

1. `ARCHITECT-NOTE.md` — the ruling: what the strategy is, thresholds, routing.
2. `knowledge/vwap-band-reversal-ict.md` (repo root) — the mechanic as pinned.
3. **`PARITY.md`** — the Stage-0 gate: both proofs, the disposition table for
   every code/data finding, and the live-vs-backtest divergences.
4. `results/COVERAGE.md` — what Capital.com history actually exists.
5. `results/INVENTORY.md` — signal counts, eligibility funnel, sample-size projection.
6. `results/CHECKS.md` — machine checks.
7. `HANDOFF.md` — Researcher → Architect routing note for Stage 1.

## The idea, in my words

Fade a stretch away from the day's volume-weighted average price. When a
1-minute bar opens outside a ±1σ band around the VWAP anchored at UTC
midnight, look for a local liquidity grab — the previous clock hour's
high (for a short) or low (for a long) taken out within the last six bars —
followed on this very bar by a proximal-edge inverse FVG back the other way,
with price on the premium (short) / discount (long) side of the last 200
bars' midpoint, the band neither too narrow nor too wide versus ATR, and the
iFVG not too small. Stop at the 200-bar extreme (shrunk if far), 3R target,
breakeven / +1R trail, flat at the end of a per-instrument clock window.

## Layout

| path | what |
|---|---|
| `ts_harness/package.json` | minimal pinned Node dependency set to run the bot's unmodified TypeScript outside the bot (`npm install` there; `node_modules` gitignored) |
| `ts_harness/probe_raw.ts`, `probe_bisect.ts` | raw `/prices` inspection (found D-01) and per-instrument history-depth bisection |
| `ts_harness/pull_1m.ts` | the data pull (bot's `CapitalComSession`; request identical to `CapitalComClient.realRequest`; raw payload kept) |
| `prep_data.py` | raw NDJSON → `data/<SYM>_1m.parquet` (bot's mid prices, `snapshotTimeUTC` timestamps) + `results/COVERAGE.md` |
| `common.py` | constants lifted from the TypeScript, timing windows, loaders |
| `engine.py` | the bug-faithful Python port (bar loop, indicators, RiskManager, Order) |
| `ts_parity/dump_vwap.ts` | TypeScript side of parity: `BacktestRunner`'s bar loop verbatim around the unmodified `VWapStrategy`, dumping every evaluated bar's intermediate values and every order event |
| `ts_parity/export_static.py`, `run_ts.sh`, `run_all.sh` | byte-identical tape export (sha256-fingerprinted) and the monthly-chunk driver |
| `ts_parity/unit_last_ifvg.ts` | D-03 unit check against the bot's own `calculateFVG` |
| `parity.py` | Python-vs-TypeScript diff, every evaluated bar + every order |
| `checks.py` | prefix-causality, invariants, parity summary, D-01 sizing |
| `inventory.py` | signal inventory and funnel (counts only) |
| `results/` | all outputs; `data/` and `ts_parity/{static,events}` are gitignored (large; fully regenerable) |

## Reproduce

```bash
PY=/Users/Vladyslav_Borsh/Documents/trade_automation/.venv/bin/python
cd research/cmc-bot-vwap/ts_harness && npm install && cd ../../../cmc-bot-main
for S in US100 US500 EURCHF GBPCHF; do
  TZ=UTC NODE_PATH=../research/cmc-bot-vwap/ts_harness/node_modules \
    ../research/cmc-bot-vwap/ts_harness/node_modules/.bin/ts-node --transpile-only \
    ../research/cmc-bot-vwap/ts_harness/pull_1m.ts $S 2023-12-20 2026-09-12 &
done; wait
cd ../research/cmc-bot-vwap
$PY prep_data.py
for S in US100 US500 EURCHF GBPCHF; do ts_parity/run_all.sh $S 2024-01 2026-09; done   # ~1 h for the two indices
$PY inventory.py && $PY checks.py
```

Requires `cmc-bot-main/.env` with the three Capital.com credentials (user-supplied,
gitignored). The pull takes ~35 min with four instruments in parallel
(latency-bound, ~1.5 s per request).
