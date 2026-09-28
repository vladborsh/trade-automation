#!/usr/bin/env python3
"""Data pull for the spot-lead pass (ARCHITECT-NOTE §5).

Thin wrapper over `research/hedged-carry/fetch_data.py` in its 1m mode (the
extension this pass added): Binance spot and USD-M perp 1m klines with the
`taker_buy_volume` column, plus the perp funding history, for the 8-perp set,
2019-09 .. 2026-08 (the last month covers time stops of trades entered up to
the holdout's end, 2026-07-31).  Public `data.binance.vision`, no credentials.
The per-file ms/us timestamp rule (spot switched to us in 2025-01) is enforced
by the wrapped script and raises on an undeterminable unit.

Output (gitignored): research/spot-lead/data/<SYM>-{perp1m,spot1m}.parquet,
<SYM>-funding.csv.gz; research/spot-lead/results/fetch_log_1m.csv.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HC = os.path.join(HERE, "..", "hedged-carry", "fetch_data.py")

if __name__ == "__main__":
    args = [sys.executable, HC, "--interval", "1m",
            "--data-dir", os.path.join(HERE, "data"),
            "--log-dir", os.path.join(HERE, "results"),
            "--start", "2019-09", "--end", "2026-08"] + sys.argv[1:]
    sys.exit(subprocess.call(args))
