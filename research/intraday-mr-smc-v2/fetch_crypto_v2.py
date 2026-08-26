#!/usr/bin/env python3
"""THREAD 2 data pull -- additional liquid Binance USD-M perpetuals.

Reuses fetch_data.py from the v1 package verbatim (same public
data.binance.vision monthly archive, no credentials), only redirecting the
output into this package's data/ directory.
"""
from __future__ import annotations
import argparse, gzip, os
from datetime import date

import common as C          # noqa: F401  (sets up sys.path to the v1 package)
import fetch_data as fd


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,LINKUSDT")
    ap.add_argument("--intervals", default="1h,15m")
    ap.add_argument("--months", type=int, default=48)
    a = ap.parse_args()
    months = fd.month_list(a.months, date.today())
    print(f"months: {months[0]} .. {months[-1]} ({len(months)})")
    for s in a.symbols.split(","):
        for iv in a.intervals.split(","):
            out = os.path.join(C.DATA_V2, f"{s}-{iv}.csv.gz")
            if os.path.exists(out):
                print(f"skip {out} (exists)"); continue
            df = fd.build(s, iv, months)
            with gzip.open(out, "wt") as fh:
                df.to_csv(fh, index=False)
            print(f"{s} {iv}: {len(df):>8} bars  {df.ts.iloc[0]} .. {df.ts.iloc[-1]}", flush=True)


if __name__ == "__main__":
    main()
