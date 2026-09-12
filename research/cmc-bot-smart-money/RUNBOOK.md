# RUNBOOK — Stage 0

Everything here is reproducible from an empty checkout. Total wall clock:
~25 minutes, almost all of it the 1m data pull and the four TypeScript parity
runs.

## 0. Prerequisites

| | |
|---|---|
| Python | the repo's `.venv`, plus `numba` and `pyarrow` (`.venv/bin/pip install numba pyarrow`) |
| Node | any modern Node; `npm` reachable |
| network | `data.binance.vision` (no API key — public bulk archive) and `registry.npmjs.org` |

**`TZ=UTC` is load-bearing** for anything that touches the TypeScript. The
bot's `startOfDay(new Date(ts))` is the *host machine's* local midnight and is
only then reinterpreted as New York (`PARITY.md` D-07), so running the parity
harness under any other timezone silently shifts every session boundary and
every true-open level. `ts_parity/run_ts.sh` exports it; do not remove that
line.

## 1. Data

```bash
cd research/cmc-bot-smart-money
../../.venv/bin/python fetch_1m.py
```

Pulls 2022-08 .. 2026-07 monthly 1m klines for BTCUSDT / ETHUSDT / SOLUSDT /
BNBUSDT into `data/*.parquet` (2,103,840 bars each, ~210 MB total, gitignored).
Idempotent — existing files are skipped. The 1h frame is **not** pulled; it is
resampled from the 1m frame by `common.resample_1h`.

## 2. The bot's TypeScript, for the parity check

The bot's own `npm run backtest` cannot run here — `BacktestRunner.init()`
needs native `canvas`, a `.env` and AWS SSM, and `BacktestReporter` renders
PNGs. None of that touches signal generation. Install only what the signal path
actually imports, without writing to the bot's `package.json`:

```bash
cd cmc-bot-main
npm install --no-save --ignore-scripts --legacy-peer-deps \
  date-fns@2.30.0 date-fns-tz@1.3.8 lodash@4.17.21 rxjs@7.8.1 \
  uuid@11.0.3 ts-node@10.9.1 typescript@5.0.4 @types/node@18.16.3 \
  @types/lodash@4.14.194
```

`--no-save` is deliberate: nothing in `cmc-bot-main/` is modified by this pass.

## 3. Parity — gate 1

```bash
cd research/cmc-bot-smart-money
./ts_parity/run_all.sh          # ~15 min: 4 windows, export -> TS -> diff
```

Per window it (a) writes the bot's `StaticDataSource` JSON from our own archive
rows, (b) runs `ts_parity/dump_signals.ts` through `ts-node`, (c) runs
`parity.py`, which exits non-zero on any discrepancy. Output:
`results/parity_*.txt`, `results/parity_all.log`,
`ts_parity/ts_events_*.jsonl`.

To add a window, append a `run <SYMBOL> <start> <end>` line to
`ts_parity/run_all.sh`. Keep every window ≥ 30 trading days.

## 4. Inventory and funnel

```bash
../../.venv/bin/python tables.py        # ~30 s
```

Writes `results/INVENTORY.md`, `results/signals.parquet`,
`results/trades_primary.parquet`, `results/trades_capped.parquet`.

## 5. Checks — gate 2 and the rest

```bash
../../.venv/bin/python checks.py        # ~8 min (C4/C5 dominate)
../../.venv/bin/python checks.py C4     # just one
```

Writes `results/CHECKS.md` and `results/C5_h1_lookahead.txt`. Exits non-zero if
any check fails. **Run `tables.py` first** — C6 through C12 read
`results/signals.parquet` and `results/trades_primary.parquet`.

## 6. What to look at if a number moves

| symptom | first place to look |
|---|---|
| parity breaks after a data re-pull | the two sides must share tape — re-run `export_static.py` for that window, not just `run_ts.sh` |
| signal count changes | the funnel in `results/INVENTORY.md`; stage S2 (D-01) and S5 (the ATR gate) are the two that discard most |
| C1 fails | `engine.py`'s fast path has drifted from `reference.py`'s literal transcription. Trust `reference.py` |
| C4 fails | something window-end-relative leaked into the M1 path. `PARITY.md` §2 lists the helpers that would do it |
| C5's count moves a lot | that is D-06, the H1 lookahead, and it is expected to be noisy at n = 240 — it is a measurement, not a gate |
