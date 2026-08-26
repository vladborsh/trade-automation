#!/usr/bin/env python3
"""Data pull for the MTF-SMC pass (MTF-SMC-DESIGN.md §1.1).

5m Binance USD-M perp klines for all 8 symbols, 2022-08 .. 2026-07, from the
same public data.binance.vision monthly archive used by v1/v2. Reuses
`fetch_data.py:build` from the v1 package verbatim -- no new download logic,
only a different output directory and symbol/interval set.

1h bars are NOT pulled: they are derived by resampling the 5m frame (§1.2).
"""
from __future__ import annotations
import argparse, gzip, os

import common as C          # noqa: F401  (sets sys.path to the v1 package)
import fetch_data as fd

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
           "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]


def months_between(start="2022-08", end="2026-07") -> list[str]:
    y, m = (int(x) for x in start.split("-"))
    ey, em = (int(x) for x in end.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(SYMBOLS))
    ap.add_argument("--interval", default="5m")
    a = ap.parse_args()
    months = months_between()
    print(f"months: {months[0]} .. {months[-1]} ({len(months)})", flush=True)
    for s in a.symbols.split(","):
        out = os.path.join(C.DATA, f"{s}-{a.interval}.csv.gz")
        if os.path.exists(out):
            print(f"skip {out} (exists)", flush=True); continue
        df = fd.build(s, a.interval, months, workers=12)
        with gzip.open(out, "wt") as fh:
            df.to_csv(fh, index=False)
        print(f"{s} {a.interval}: {len(df):>8} bars  {df.ts.iloc[0]} .. {df.ts.iloc[-1]}", flush=True)


if __name__ == "__main__":
    main()
