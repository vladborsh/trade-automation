# Intraday MR / SMC / Hybrid — exploratory research

Feasibility research for an intraday perpetual-futures rule-set on BTC, ETH and
SOL. Three candidate rule-sets are compared head-to-head across three bar
intervals. **This is exploratory analysis, not a backtest** — see `REPORT.md`
for the findings and `agents/roles/researcher.md` for the scope boundary.

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install pandas numpy
cd research/intraday-mr-smc
../../.venv/bin/python fetch_data.py          # ~48 months, 3 symbols, 3 intervals
```

Data source: **Binance USD-M perpetual futures monthly kline archives**
(`data.binance.vision`). Public bulk archive — **no API key or credential is
required**, nothing synthetic is used anywhere in this package.
Coverage pulled: `2022-08-01 .. 2026-07-31`, complete bars, no gaps
(420,768 × 5m / 140,256 × 15m / 35,064 × 1h per symbol).

## Scripts

| file | what it does |
|---|---|
| `fetch_data.py` | Pulls and normalises the kline archives into `data/<SYM>-<IV>.csv.gz`. |
| `indicators.py` | ATR/RSI/session-VWAP/ADX plus the SMC state machine (swings, BOS, CHoCH, order blocks, FVGs, liquidity sweeps). All causal. |
| `strategies.py` | The three candidate rule-sets as `sig / stop / target` intents. No money management lives here, so the candidates stay comparable. |
| `backtest.py` | Trade engine: next-bar-open fills, fees, **1%-of-equity per-trade risk sizing**, **2% daily circuit-breaker**, pessimistic intrabar resolution. Metrics: PF, win rate, Sharpe, Sortino, max DD, Calmar. |
| `run_sweep.py` | Runs candidate × interval × symbol and writes `results/summary_*.csv` (+ `--regimes` split). |
| `param_scan.py` | Parameter sensitivity grid per candidate, aggregated across the three symbols. |
| `edge_probe.py` | Measures raw conditional forward return of each trigger, independent of exit mechanics. |
| `stability.py` | Splits the 48 months into four 12-month blocks and reruns the best configuration of each candidate. |

## Reproducing the headline numbers

```bash
../../.venv/bin/python run_sweep.py --regimes --tag main     # the comparison table
../../.venv/bin/python run_sweep.py --fee-bps 0 --tag nofee  # gross-of-cost diagnostic
../../.venv/bin/python param_scan.py --candidate hybrid      # sensitivity grid
../../.venv/bin/python edge_probe.py
../../.venv/bin/python stability.py
```

Runtime: full sweep ≈ 3 min, each param scan ≈ 3 min on a laptop.

## Risk rules baked into the engine (`backtest.py`)

* `RISK_PCT = 0.01` — position size = `1% × current equity / |entry − stop|`,
  capped at `MAX_LEVERAGE = 10×` notional so a very tight stop cannot buy
  unbounded size.
* `DAILY_STOP_PCT = 0.02` — at every bar the engine compares
  `equity + open PnL` to the day's opening equity; once the day is −2% it sets
  `halted = True` and **no new entry is opened for the rest of that UTC day**.
  Existing positions are still managed to their stop/target.
* `FEE_BPS = 5.0` per side (Binance USD-M taker ≈ 4 bp + ≈ 1 bp slippage).
* Signals fire on bar close, fill at the **next bar's open**. When a bar spans
  both stop and target, the stop is assumed to be hit first.
