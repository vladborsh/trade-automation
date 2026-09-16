#!/usr/bin/env python3
"""ARCHITECT-NOTE §2.2: record Binance's PUBLISHED USD-M leverage/maintenance
bracket table for the 8 symbols, as published on the pull date, with the source
URL, into results/margin_table.csv.

The primary pins mmr = 1.0 % uniformly; these published values are the §2.6
sensitivity, never the primary.
"""
from __future__ import annotations
import json, os, sys, datetime
from urllib.request import urlopen, Request
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SYMBOLS, OUT

URL = "https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets"

req = Request(URL, headers={"User-Agent": "Mozilla/5.0"})
data = json.loads(urlopen(req, timeout=60).read())["data"]["brackets"]
pull_date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")

rows = []
for b in data:
    if b["symbol"] not in SYMBOLS:
        continue
    for rb in b["riskBrackets"]:
        rows.append(dict(
            symbol=b["symbol"], bracket=rb["bracketSeq"],
            notional_floor=rb["bracketNotionalFloor"],
            notional_cap=rb["bracketNotionalCap"],
            mmr=rb["bracketMaintenanceMarginRate"],
            cum_maint_amount=rb["cumFastMaintenanceAmount"],
            max_open_pos_leverage=rb.get("maxOpenPosLeverage"),
            source_url=URL, pull_date_utc=pull_date,
            update_time=pd.to_datetime(b["updateTime"], unit="ms", utc=True),
        ))
df = pd.DataFrame(rows).sort_values(["symbol", "bracket"])
df.to_csv(os.path.join(OUT, "margin_table.csv"), index=False)
low = df[df.bracket == 1][["symbol", "notional_cap", "mmr",
                           "max_open_pos_leverage"]]
print(f"pulled {pull_date} from {URL}")
print("lowest bracket per symbol (the one a 100-USDT slot sits in):")
print(low.to_string(index=False))
print(f"\nprimary pins mmr = 1.0 % uniformly; max published lowest-bracket mmr "
      f"= {low.mmr.max():.4f}")
