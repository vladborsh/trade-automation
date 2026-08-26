#!/usr/bin/env python3
"""Pull Binance USD-M perpetual futures klines from the public data.binance.vision
monthly archives. No API key required (public bulk archive, anonymous HTTPS).

Usage:
    python fetch_data.py                      # default: BTC/ETH/SOL, 5m/15m/1h, 48 months
    python fetch_data.py --months 24
Output:
    data/<SYMBOL>-<INTERVAL>.csv.gz   (open_time_utc, open, high, low, close, volume)
"""
from __future__ import annotations
import argparse, gzip, io, os, sys, zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from urllib.request import urlopen
from urllib.error import HTTPError

import pandas as pd

BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
COLS = ["open_time", "open", "high", "low", "close", "volume", "close_time",
        "quote_volume", "count", "taker_buy_volume", "taker_buy_quote_volume", "ignore"]
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")


def month_list(n_months: int, end: date) -> list[str]:
    """Last n complete months ending before `end`'s month."""
    y, m = end.year, end.month
    out = []
    for _ in range(n_months):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append(f"{y:04d}-{m:02d}")
    return sorted(out)


def fetch_month(symbol: str, interval: str, ym: str) -> pd.DataFrame | None:
    url = f"{BASE}/{symbol}/{interval}/{symbol}-{interval}-{ym}.zip"
    try:
        raw = urlopen(url, timeout=120).read()
    except HTTPError as e:
        print(f"  MISS {symbol} {interval} {ym} ({e.code})", file=sys.stderr)
        return None
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with z.open(z.namelist()[0]) as f:
            head = f.read(64)
    skip = 1 if head.startswith(b"open_time") else 0
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with z.open(z.namelist()[0]) as f:
            df = pd.read_csv(f, header=None, names=COLS, skiprows=skip)
    return df


def build(symbol: str, interval: str, months: list[str], workers: int = 8) -> pd.DataFrame:
    with ThreadPoolExecutor(max_workers=workers) as ex:
        parts = list(ex.map(lambda ym: fetch_month(symbol, interval, ym), months))
    parts = [p for p in parts if p is not None and len(p)]
    if not parts:
        raise RuntimeError(f"no data for {symbol} {interval}")
    df = pd.concat(parts, ignore_index=True)
    # Binance switched open_time from ms to us in some 2025 archives; normalise.
    df["open_time"] = df["open_time"].astype("int64")
    df.loc[df["open_time"] > 10**14, "open_time"] //= 1000
    df = df.drop_duplicates("open_time").sort_values("open_time").reset_index(drop=True)
    df["ts"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    return df[["ts", "open", "high", "low", "close", "volume"]].astype(
        {"open": float, "high": float, "low": float, "close": float, "volume": float})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="BTCUSDT,ETHUSDT,SOLUSDT")
    ap.add_argument("--intervals", default="5m,15m,1h")
    ap.add_argument("--months", type=int, default=48)
    a = ap.parse_args()
    os.makedirs(DATA, exist_ok=True)
    months = month_list(a.months, date.today())
    print(f"months: {months[0]} .. {months[-1]} ({len(months)})")
    for s in a.symbols.split(","):
        for iv in a.intervals.split(","):
            out = os.path.join(DATA, f"{s}-{iv}.csv.gz")
            if os.path.exists(out):
                print(f"skip {out} (exists)"); continue
            df = build(s, iv, months)
            with gzip.open(out, "wt") as fh:
                df.to_csv(fh, index=False)
            print(f"{s} {iv}: {len(df):>8} bars  {df.ts.iloc[0]} .. {df.ts.iloc[-1]}")


if __name__ == "__main__":
    main()
