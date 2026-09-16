#!/usr/bin/env python3
"""ARCHITECT-NOTE §8.2.1 — stage 1 of the two-stage pull.

For every admitted symbol: the 1d monthly archive month list (one S3 request),
then every 1d archive (small).  Writes

  data/1d/<SYM>.parquet        UTC daily bars, t_ms/o/h/l/c/volume/quote_volume
  results/universe.csv         symbol, first/last archive month, first/last bar,
                               n_days, and the 1m month list is derived later
  results/history_audit_1d.json

No R is computed here.
"""
from __future__ import annotations
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import fetch as F  # noqa: E402

DATA1D = os.path.join(PKG, "data", "1d")
RESULTS = os.path.join(PKG, "results")
os.makedirs(DATA1D, exist_ok=True)
DAY_MS = 86_400_000


def one(sym: str) -> dict:
    out = os.path.join(DATA1D, f"{sym}.parquet")
    try:
        months = F.list_months(sym, "klines", "1d")
    except Exception as e:  # noqa: BLE001
        return dict(symbol=sym, error=f"listing: {e}")
    if not months:
        return dict(symbol=sym, error="no 1d archives")
    if os.path.exists(out):
        df = pd.read_parquet(out)
    else:
        parts = [F.fetch_klines(sym, ym, "1d") for ym in months]
        df = F.norm_klines(parts)
        if not len(df):
            return dict(symbol=sym, error="empty")
        df.to_parquet(out, index=False)
    g = F.gaps(df.t_ms.values, DAY_MS)
    return dict(symbol=sym, first_month=months[0], last_month=months[-1],
                n_months=len(months),
                first_bar_ms=int(df.t_ms.iloc[0]), last_bar_ms=int(df.t_ms.iloc[-1]),
                first_bar=str(pd.Timestamp(int(df.t_ms.iloc[0]), unit="ms", tz="UTC").date()),
                last_bar=str(pd.Timestamp(int(df.t_ms.iloc[-1]), unit="ms", tz="UTC").date()),
                n_days=len(df), n_gaps=len(g),
                missing_days=int(sum(x["missing"] for x in g)))


def main() -> None:
    syms = json.load(open(os.path.join(RESULTS, "listing.json")))["admitted"]
    t0 = time.time()
    rows = []
    with ThreadPoolExecutor(max_workers=16) as ex:
        for i, r in enumerate(ex.map(one, syms)):
            rows.append(r)
            if (i + 1) % 50 == 0:
                print(f"  {i+1}/{len(syms)}  {time.time()-t0:.0f}s", flush=True)
    ok = [r for r in rows if "error" not in r]
    bad = [r for r in rows if "error" in r]
    u = pd.DataFrame(ok).sort_values("symbol").reset_index(drop=True)
    u.to_csv(os.path.join(RESULTS, "universe.csv"), index=False)
    with open(os.path.join(RESULTS, "history_audit_1d.json"), "w") as fh:
        json.dump(dict(n_admitted=len(syms), n_ok=len(ok), errors=bad,
                       total_daily_bars=int(u.n_days.sum()),
                       symbols_with_gaps=int((u.n_gaps > 0).sum())), fh, indent=1)
    print(f"universe.csv: {len(u)} symbols, {u.n_days.sum():,} daily bars, "
          f"{len(bad)} errors, {time.time()-t0:.0f}s")
    print(u.first_bar.min(), "..", u.last_bar.max())


if __name__ == "__main__":
    main()
