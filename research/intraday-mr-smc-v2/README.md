# Intraday MR / SMC / hybrid — v2 refinement (timing, other assets, indices)

Continuation of `research/intraday-mr-smc/`. That package concluded that pure
mean reversion, pure SMC and an SMC-filtered hybrid all fail the targets
(PF > 1.2, win rate > 50%) on BTC/ETH/SOL perps, and that a zero-fee rerun shows
this is an **absent edge**, not a cost problem. This package attacks three
dimensions that package did not test.

**This is exploratory feasibility work, not a backtest.** See `REPORT.md` for
findings and `agents/roles/researcher.md` for the scope boundary.
Nothing in `research/intraday-mr-smc/` is modified — its `indicators.py`,
`strategies.py`, `backtest.py` and `fetch_data.py` are imported unchanged, so
every v1 number reproduces exactly here (`results/summary_assets.csv`, rows for
BTC/ETH/SOL, match `REPORT.md` §3 to three decimals).

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install pandas numpy
cd research/intraday-mr-smc-v2
../../.venv/bin/python fetch_crypto_v2.py --intervals 1h   # BNB/XRP/DOGE/ADA/LINK, 48 months
../../.venv/bin/python fetch_index.py                      # SPY/QQQ/^GSPC/^NDX, 1h + 1d
```

Crypto data also needs the v1 pull (`../intraday-mr-smc/fetch_data.py`) for
BTC/ETH/SOL; `common.load()` resolves `data/` here first, then the v1 `data/`.

**No credentials are used anywhere.** Crypto: the public
`data.binance.vision` monthly archive. Indices: Yahoo Finance's anonymous
`v8/finance/chart` endpoint. stooq.com was tried first and now sits behind a
JavaScript proof-of-work interstitial, so it was dropped rather than worked
around. Nothing synthetic is used.

## Scripts

| file | what it does |
|---|---|
| `common.py` | Imports the v1 modules, resolves data, wraps the engine, and implements the hour/day signal mask. |
| `strategies_v2.py` | The v2 candidates: `momentum` (sign-inversion of the MR trigger), `momentum_breakout`, `momentum_smc`. |
| `engine_v2.py` | Gap-aware copy of the v1 engine — a stop/target the bar OPENS beyond fills at the open. Needed for session-gapped index series. |
| `fetch_crypto_v2.py` | THREAD 2 data pull: BNB / XRP / DOGE / ADA / LINK USD-M perps, same 48 months. |
| `fetch_index.py` | THREAD 3 data pull: SPY, QQQ, ^GSPC, ^NDX at 1h (rolling ~730 trading days) and 1d (15 years). |
| `tod_dow.py` | THREAD 1: hour-of-day / day-of-week allow-lists chosen on a 32-month fit period, evaluated on a 16-month holdout, with a permutation null. |
| `run_assets.py` | THREAD 2: every candidate × 8 perps at 1h, net and gross. `--engine-check` compares the v1 and gap-aware engines. |
| `run_index.py` | THREAD 3: every candidate × 4 index products, 1h and 1d, two hold horizons. |
| `mom_scan.py` | Parameter scan of the momentum-inversion family on the fit period, best configs re-run once on the holdout. |

## Reproducing

```bash
../../.venv/bin/python tod_dow.py --perm 200         # results/tod_*.csv
../../.venv/bin/python run_assets.py                 # results/summary_assets.csv
../../.venv/bin/python run_assets.py --fee-bps 0 --tag assets_nofee
../../.venv/bin/python run_assets.py --engine-check  # results/engine_check.csv
../../.venv/bin/python run_index.py                  # results/summary_index.csv
../../.venv/bin/python run_index.py --fee-bps 0 --tag index_nofee --intervals 1h --time-stops 24
../../.venv/bin/python mom_scan.py                   # results/mom_scan_*.csv
```

## Risk rules — unchanged from v1

`RISK_PCT = 0.01` per trade sized off the stop distance, `MAX_LEVERAGE = 10×`
notional cap, and the `DAILY_STOP_PCT = 0.02` circuit-breaker evaluated on
realised + open PnL against the day's opening equity, halting new entries for
the rest of that UTC day. `engine_v2.py` reproduces all of it verbatim and only
changes gap fills. Costs: 5 bp/side for crypto perps (as v1), 2 bp/side for the
index products (retail zero-commission plus ~1 bp spread/slippage), 0 bp in the
explicit gross-of-cost diagnostics.

## Out-of-sample protocol

Both `tod_dow.py` and `mom_scan.py` use the same split, fixed before any
holdout number was read:

* **fit** `2022-08-01 .. 2025-04-01` (32 months)
* **holdout** `2025-04-01 .. 2026-08-01` (16 months)

Filters and parameters are chosen on the fit period pooled across symbols, then
run once on the holdout with fresh equity. Every configuration tried is counted
in the report, and `tod_dow.py` additionally places each selected hour filter
inside a 200-draw permutation null of random allow-lists of the same size.
