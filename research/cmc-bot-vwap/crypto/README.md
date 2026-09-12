# Crypto extension — the `VWapStrategy` mechanic on BTCUSDT / ETHUSDT perps

**What this is:** a Stage-0-equivalent pass (bug-faithful reproduction +
signal/order logs + counts) of the bot's VWAP band-reversal mechanic on a
tape the bot was never configured for — Binance USD-M perpetuals, 1-minute,
**2022-08-01 .. 2026-09-11**. **No performance number, no verdict.**

**What this is not:** a test of anything the user ever deployed. `StrategyProvider`
builds `VWapStrategy` only for US100/US500/EURCHF/GBPCHF on Capital.com. There
is no live BTC/ETH VWAP history to compare with, and no shipped timing
configuration for crypto — both conditions below are research choices.

## The two entry-window conditions (the fork the Architect decides)

| condition | clock gates | why it exists |
|---|---|---|
| **`win`** | the US100/US500 windows verbatim: entry 09:40–11:40 NY, alive 09:40–14:30 NY (forced flat after), Mon–Fri by UTC weekday — exactly how the bot's code evaluates `timings`/`orderAliveTimings` | directly comparable to the CFD indices and to the already-killed session-liquidity-v5-ny NY-window result on BTC/ETH (Запись 18) |
| **`all`** | none: every minute of every day is entry-valid, nothing is ever force-closed | crypto has no cash session to anchor a window to; forcing one may import an assumption that does not belong on this tape |

Everything else — VWAP/ATR band [2.5, 11.5], iFVG ATR cap 8, 200-bar range,
prior-hour sweep, stop-shrink table, 3R target, BE/+1R trail, 2-loss/1-win
daily caps, one open order per direction — is the bot's, unchanged.

## Files

| path | what |
|---|---|
| `crypto/fetch_binance_1m.py` | pull (wrapper over `research/intraday-mr-smc/fetch_data.py`; monthly + current-month daily archives) |
| `crypto/chunks.py` | TypeScript parity chunk plan: months for `win`; ~7-day chunks cut only at UTC midnights with no open order for `all` |
| `crypto/inventory_crypto.py` | order logs + counts + funnels → `results/crypto/` |
| `crypto/checks_crypto.py` | prefix-causality, invariants, parity summary → `results/crypto/CHECKS_CRYPTO.md` |
| `results/crypto/signals_<SYM>_<win|all>.parquet` | **the four requested order logs** (as-deployed, caps on); `signals_nocaps_*` = caps removed. Same schema as `results/signals_*.parquet` |
| `results/crypto/PARITY_CRYPTO.md` | parity report for this extension |
| `results/parity_<SYM>_<win|all>.csv/.log` | per-chunk parity rows |

`engine.py`, `parity.py`, `ts_parity/*` are shared with the Capital.com pass;
the extension added a `timing` argument (`engine.run(..., timing=CRYPTO_WINDOW | engine.ALWAYS)`)
and a `mode` argument to the harness. The Capital.com parity battery was
re-run after the refactor: 132/132 months, 0 problems, identical order logs.

## Reproduce

```bash
PY=/Users/Vladyslav_Borsh/Documents/trade_automation/.venv/bin/python
cd research/cmc-bot-vwap
$PY crypto/fetch_binance_1m.py --end 2026-09-12
for S in BTCUSDT ETHUSDT; do $PY crypto/chunks.py $S; done
cat data/chunks_*_win.txt data/chunks_*_all.txt | xargs -P 10 -L 1 ts_parity/run_ts.sh   # ~1.5 h
for S in BTCUSDT ETHUSDT; do for M in win all; do $PY parity.py --mode $M $S all; done; done
$PY crypto/inventory_crypto.py && $PY crypto/checks_crypto.py
```
