#!/usr/bin/env python3
"""Data pull for the derivatives-positioning pass (DESIGN.md §1).

Binance USD-M futures *metrics* archive, 5m granularity, from the same public
`data.binance.vision` bulk host used by every prior package. No credentials.

DESIGN.md §1 specifies `futures/um/monthly/metrics/<SYMBOL>/` with a fall back to
daily files "where a month is missing". Measured 2026-08-26: the monthly metrics
prefix does not exist at all (HTTP 404 for every symbol/month probed), while the
daily prefix returns 200 across the whole 2022-08 .. 2026-07 window. The pull
therefore runs entirely on the pre-committed daily fall-back path — this is the
design's own contingency, not a deviation from it.

Columns of record (verified against the files, not assumed):
    create_time, symbol, sum_open_interest, sum_open_interest_value,
    count_toptrader_long_short_ratio, sum_toptrader_long_short_ratio,
    count_long_short_ratio, sum_taker_long_short_vol_ratio

Output: data/<SYMBOL>-metrics.csv.gz   (gitignored, like every prior data dir)
        results/fetch_log.csv          (per symbol/day HTTP outcome, for §1)
"""
from __future__ import annotations
import argparse, gzip, io, os, sys, zipfile
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "results")
os.makedirs(DATA, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

BASE = "https://data.binance.vision/data/futures/um/daily/metrics"
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
           "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]
START, END = "2022-08-01", "2026-07-31"


def day_list(start: str, end: str) -> list[str]:
    return [d.strftime("%Y-%m-%d") for d in pd.date_range(start, end, freq="D")]


def fetch_day(symbol: str, day: str, retries: int = 3):
    """Returns (DataFrame|None, status_string)."""
    url = f"{BASE}/{symbol}/{symbol}-metrics-{day}.zip"
    for attempt in range(retries):
        try:
            raw = urlopen(url, timeout=120).read()
        except HTTPError as e:
            return None, f"http_{e.code}"
        except (URLError, TimeoutError, OSError):
            if attempt == retries - 1:
                return None, "neterr"
            continue
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                with z.open(z.namelist()[0]) as f:
                    df = pd.read_csv(f)
        except Exception:
            return None, "badzip"
        return df, "ok"
    return None, "neterr"


def build(symbol: str, days: list[str], workers: int = 16):
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda d: fetch_day(symbol, d), days))
    log = [dict(symbol=symbol, day=d, status=s, rows=(0 if p is None else len(p)))
           for d, (p, s) in zip(days, res)]
    parts = [p for p, s in res if p is not None and len(p)]
    if not parts:
        return None, log
    df = pd.concat(parts, ignore_index=True)
    df["ts"] = pd.to_datetime(df["create_time"], utc=True)
    df = df.drop(columns=["create_time", "symbol"]).sort_values("ts")
    df = df.drop_duplicates(subset="ts", keep="first").reset_index(drop=True)
    return df, log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(SYMBOLS))
    ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()
    days = day_list(START, END)
    print(f"days: {days[0]} .. {days[-1]} ({len(days)})", flush=True)
    logs = []
    for s in a.symbols.split(","):
        out = os.path.join(DATA, f"{s}-metrics.csv.gz")
        if os.path.exists(out):
            print(f"skip {out} (exists)", flush=True)
            continue
        df, log = build(s, days, a.workers)
        logs += log
        if df is None:
            print(f"{s}: NO DATA", flush=True)
            continue
        with gzip.open(out, "wt") as fh:
            df.to_csv(fh, index=False)
        miss = sum(1 for r in log if r["status"] != "ok")
        print(f"{s}: {len(df):>8} rows  {df.ts.iloc[0]} .. {df.ts.iloc[-1]}  "
              f"missing_days {miss}/{len(days)}", flush=True)
    if logs:
        f = os.path.join(OUT, "fetch_log.csv")
        old = pd.read_csv(f) if os.path.exists(f) else None
        new = pd.DataFrame(logs)
        pd.concat([old, new]) if old is not None else new
        (pd.concat([old, new], ignore_index=True) if old is not None else new).to_csv(f, index=False)


if __name__ == "__main__":
    main()
