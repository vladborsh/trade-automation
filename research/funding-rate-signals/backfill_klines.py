#!/usr/bin/env python3
"""Backfill the 10 truncated-monthly 1h kline days from the DAILY prefix of the
SAME public archive (DESIGN §5.6, Architect ruling).

Not interpolation and not a second source: `data/futures/um/daily/klines/` is
the same archive at finer granularity.  Every filled day is logged to
results/data_audit_fills.csv.
"""
from __future__ import annotations
import gzip, io, os, sys, zipfile
from urllib.request import urlopen
from urllib.error import HTTPError
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import DATA, OUT, load_klines
from fetch_data import KLINE_COLS, _read_zip_csv, _ts

BASE = "https://data.binance.vision/data/futures/um/daily/klines"


def main():
    logs = []
    for sym in sys.argv[1:] or ["SOLUSDT", "XRPUSDT"]:
        k = load_klines(sym)
        grid = pd.date_range(k.ts.iloc[0], k.ts.iloc[-1], freq="1h", tz="UTC")
        miss = grid.difference(pd.DatetimeIndex(k.ts))
        days = sorted({d.strftime("%Y-%m-%d") for d in miss})
        if not days:
            print(f"{sym}: nothing missing")
            continue
        parts = []
        for d in days:
            url = f"{BASE}/{sym}/1h/{sym}-1h-{d}.zip"
            try:
                raw = urlopen(url, timeout=120).read()
                df = _read_zip_csv(raw, KLINE_COLS)
                st, n = "ok", len(df)
            except HTTPError as e:
                df, st, n = None, f"http_{e.code}", 0
            logs.append(dict(symbol=sym, dataset="klines_daily_backfill",
                             day=d, status=st, rows=n))
            if df is not None and len(df):
                df["ts"] = _ts(df["open_time"])
                df["month"] = d[:7]
                parts.append(df[["ts", "open", "high", "low", "close",
                                 "volume", "month"]])
        if not parts:
            print(f"{sym}: NO backfill available")
            continue
        add = pd.concat(parts, ignore_index=True)
        add = add[add.ts.isin(miss)]
        out = pd.concat([k, add], ignore_index=True)
        out = out.drop_duplicates(subset="ts", keep="first").sort_values("ts")
        with gzip.open(os.path.join(DATA, f"{sym}-1h.csv.gz"), "wt") as fh:
            out.to_csv(fh, index=False)
        g2 = pd.date_range(out.ts.iloc[0], out.ts.iloc[-1], freq="1h", tz="UTC")
        print(f"{sym}: filled {len(add)} bars over {len(days)} days; "
              f"remaining missing {len(g2.difference(pd.DatetimeIndex(out.ts)))}")
    if logs:
        f = os.path.join(OUT, "data_audit_fills.csv")
        new = pd.DataFrame(logs)
        if os.path.exists(f):
            new = pd.concat([pd.read_csv(f), new], ignore_index=True)
        new.to_csv(f, index=False)
        print(f"wrote {f}")


if __name__ == "__main__":
    main()
