#!/usr/bin/env python3
"""§6.2 — the `fundingRate` monthly archives for every symbol with at least
one candidate month, over those months. Writes data/funding/<SYM>.parquet and
results/funding_audit.json. A missing rate is treated as 0 and counted (§6.2).
"""
from __future__ import annotations
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
sys.path.insert(0, HERE); sys.path.insert(0, PKG)
import fetch as F  # noqa: E402
import common as C  # noqa: E402


def one(item):
    sym, months = item
    out = os.path.join(C.DATA_FUND, f"{sym}.parquet")
    if os.path.exists(out):
        df = pd.read_parquet(out)
    else:
        with ThreadPoolExecutor(max_workers=6) as ex:
            parts = list(ex.map(lambda ym: F.fetch_funding(sym, ym), months))
        df = F.norm_funding(parts)
        df.to_parquet(out, index=False)
    return dict(symbol=sym, months=len(months), settlements=len(df))


def main() -> None:
    need = json.load(open(os.path.join(C.RESULTS, "eligible_months.json")))
    items = sorted(need.items())
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=6) as ex:
        rows = list(ex.map(one, items))
    with open(os.path.join(C.RESULTS, "funding_audit.json"), "w") as fh:
        json.dump(rows, fh, indent=1)
    print(f"funding: {len(rows)} symbols, "
          f"{sum(r['settlements'] for r in rows):,} settlements, {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
