#!/usr/bin/env python3
"""Pull the 1-minute Binance USD-M perpetual klines this pass needs.

ARCHITECT-NOTE §5.3 pins the data source: **this project's own archive loader**
(`research/intraday-mr-smc/fetch_data.py`, the public `data.binance.vision`
monthly bulk archive), *not* the bot's `npm run scrap`. This file is a thin
wrapper around that loader's `build()` — it adds nothing but an explicit month
list (the shared loader counts months back from "today", which does not land on
the pinned 2022-08 .. 2026-07 window) and a parquet writer, because 2.1M rows
per symbol through `csv.gz` is slow to re-read on every run.

The 1h frame is **derived by resampling the 1m frame** (house convention,
`research/intraday-mtf-smc/fetch_mtf.py`); it is never pulled separately, so
the H1 bias can never disagree with the M1 tape it is supposed to describe.

    python fetch_1m.py                    # all four symbols
    python fetch_1m.py --symbols BTCUSDT

Output: data/<SYMBOL>-1m.parquet   (ts, open, high, low, close, volume)
"""
from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
MR = os.path.join(REPO, "research", "intraday-mr-smc")
if MR not in sys.path:
    sys.path.insert(0, MR)

from fetch_data import build  # noqa: E402  the shared, un-reimplemented puller

DATA = os.path.join(HERE, "data")

# ARCHITECT-NOTE §3.2 / §5.3 — the pinned period, inclusive of both ends.
MONTHS = [f"{y:04d}-{m:02d}"
          for y in range(2022, 2027)
          for m in range(1, 13)
          if (y, m) >= (2022, 8) and (y, m) <= (2026, 7)]

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(SYMBOLS))
    a = ap.parse_args()
    os.makedirs(DATA, exist_ok=True)
    print(f"months: {MONTHS[0]} .. {MONTHS[-1]} ({len(MONTHS)})", flush=True)
    for sym in a.symbols.split(","):
        out = os.path.join(DATA, f"{sym}-1m.parquet")
        if os.path.exists(out):
            print(f"skip {out} (exists)", flush=True)
            continue
        df = build(sym, "1m", MONTHS, workers=6)
        df = df[(df.ts >= "2022-08-01") & (df.ts < "2026-08-01")].reset_index(drop=True)
        df.to_parquet(out, index=False)
        print(f"{sym} 1m: {len(df):>9} bars  {df.ts.iloc[0]} .. {df.ts.iloc[-1]}", flush=True)


if __name__ == "__main__":
    main()
