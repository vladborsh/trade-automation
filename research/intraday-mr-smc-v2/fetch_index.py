#!/usr/bin/env python3
"""THREAD 3 data pull -- equity index products, no credentials.

Source: Yahoo Finance's public chart endpoint
(`query1.finance.yahoo.com/v8/finance/chart/<SYM>`). Anonymous HTTPS, no API
key, no account -- verified before use. stooq.com was tried first and is now
behind a JavaScript proof-of-work interstitial, so it was dropped.

Coverage limits imposed by the source (documented, not worked around):
  * 1h bars: rolling ~730 TRADING days only  -> ~2026-08 back to ~2023-09.
    That is ~35 months versus the 48 months of crypto history, so index and
    crypto numbers are NOT over an identical window; the report says so.
  * 1d bars: decades available; pulled back to 2010 for a long-window check.

Regular trading hours only (13:30-20:00 UTC under EDT, 14:30-21:00 under EST),
so the series has overnight gaps and no weekend bars -- see engine_v2.py for
the gap-aware fill handling that this requires.
"""
from __future__ import annotations
import argparse, gzip, json, os, time
from urllib.request import Request, urlopen

import pandas as pd

import common as C

UA = {"User-Agent": "Mozilla/5.0 (research; exploratory feasibility study)"}
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval={iv}"


def fetch(sym: str, iv: str, rng: str) -> pd.DataFrame:
    u = URL.format(sym=sym.replace("^", "%5E"), iv=iv, rng=rng)
    raw = json.load(urlopen(Request(u, headers=UA), timeout=90))["chart"]
    if raw.get("error"):
        raise RuntimeError(f"{sym} {iv}: {raw['error']}")
    r = raw["result"][0]
    q = r["indicators"]["quote"][0]
    df = pd.DataFrame({
        "ts": pd.to_datetime(r["timestamp"], unit="s", utc=True),
        "open": q["open"], "high": q["high"], "low": q["low"],
        "close": q["close"], "volume": q.get("volume"),
    })
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0.0)
    df = df.dropna(subset=["open", "high", "low", "close"])
    return df.drop_duplicates("ts").sort_values("ts").reset_index(drop=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="SPY,QQQ,^GSPC,^NDX")
    ap.add_argument("--intervals", default="1h,1d")
    a = ap.parse_args()
    for s in a.symbols.split(","):
        for iv in a.intervals.split(","):
            name = s.replace("^", "IDX_")
            out = os.path.join(C.DATA_V2, f"{name}-{iv}.csv.gz")
            if os.path.exists(out):
                print(f"skip {out} (exists)"); continue
            rng = "730d" if iv == "1h" else "15y"
            df = fetch(s, iv, rng)
            with gzip.open(out, "wt") as fh:
                df.to_csv(fh, index=False)
            print(f"{name} {iv}: {len(df):>7} bars  {df.ts.iloc[0]} .. {df.ts.iloc[-1]}", flush=True)
            time.sleep(1.0)


if __name__ == "__main__":
    main()
