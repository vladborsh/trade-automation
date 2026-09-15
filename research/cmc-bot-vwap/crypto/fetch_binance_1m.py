#!/usr/bin/env python3
"""Pull BTCUSDT / ETHUSDT USD-M perpetual 1-minute klines, 2022-08-01 .. present.

Thin wrapper over this project's shared puller
(`research/intraday-mr-smc/fetch_data.py:build`, public data.binance.vision
monthly archives, no key). It adds only (a) an explicit month list starting
2022-08 instead of "N months back from today", (b) the current month's DAILY
archives, which the monthly archive does not yet contain, and (c) a parquet
writer in the same column layout `engine.py` reads for the Capital.com tape.
No 1-minute cache existed anywhere in the project (only 5m/15m/1h), so this is
a fresh pull.

    python crypto/fetch_binance_1m.py [--symbols BTCUSDT,ETHUSDT] [--end 2026-09-12]

Output: data/<SYMBOL>_1m.parquet  (ts, t_ms, open, high, low, close, volume)
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import zipfile
from urllib.error import HTTPError
from urllib.request import urlopen

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(PKG, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "research", "intraday-mr-smc"))
from fetch_data import COLS, build  # noqa: E402

DATA = os.path.join(PKG, "data")
DAILY = "https://data.binance.vision/data/futures/um/daily/klines"


def fetch_day(symbol: str, day: str) -> pd.DataFrame | None:
    url = f"{DAILY}/{symbol}/1m/{symbol}-1m-{day}.zip"
    try:
        raw = urlopen(url, timeout=120).read()
    except HTTPError as e:
        print(f"  MISS daily {symbol} {day} ({e.code})", file=sys.stderr)
        return None
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with z.open(z.namelist()[0]) as f:
            data = f.read()
    skip = 1 if data.startswith(b"open_time") else 0
    return pd.read_csv(io.BytesIO(data), header=None, names=COLS, skiprows=skip)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="BTCUSDT,ETHUSDT")
    ap.add_argument("--end", default=pd.Timestamp.utcnow().strftime("%Y-%m-%d"), help="exclusive UTC date")
    a = ap.parse_args()
    end = pd.Timestamp(a.end, tz="UTC")
    month_end = end.normalize().replace(day=1)
    months = [p.strftime("%Y-%m") for p in pd.period_range("2022-08", month_end.tz_localize(None) - pd.Timedelta("1D"), freq="M")]
    days = [d.strftime("%Y-%m-%d") for d in pd.date_range(month_end, end - pd.Timedelta("1D"), freq="D")]
    os.makedirs(DATA, exist_ok=True)
    for sym in a.symbols.split(","):
        out = os.path.join(DATA, f"{sym}_1m.parquet")
        if os.path.exists(out):
            print(f"skip {out} (exists)", flush=True)
            continue
        df = build(sym, "1m", months, workers=6)
        extra = [fetch_day(sym, d) for d in days]
        extra = [x for x in extra if x is not None and len(x)]
        if extra:
            x = pd.concat(extra, ignore_index=True)
            x["open_time"] = x["open_time"].astype("int64")
            x.loc[x["open_time"] > 10**14, "open_time"] //= 1000
            x["ts"] = pd.to_datetime(x["open_time"], unit="ms", utc=True)
            x = x[["ts", "open", "high", "low", "close", "volume"]].astype(
                {"open": float, "high": float, "low": float, "close": float, "volume": float})
            df = pd.concat([df, x], ignore_index=True)
        df = df.drop_duplicates("ts").sort_values("ts")
        df = df[(df.ts >= "2022-08-01") & (df.ts < end)].reset_index(drop=True)
        df["t_ms"] = df.ts.values.astype("datetime64[ms]").astype("int64")
        df.to_parquet(out, index=False)
        print(f"{sym} 1m: {len(df):>9} bars  {df.ts.iloc[0]} .. {df.ts.iloc[-1]}  "
              f"({len(months)} monthly + {len(extra)} daily archives)", flush=True)


if __name__ == "__main__":
    main()
