#!/usr/bin/env python3
"""Backfill truncated-monthly 1h kline days from the DAILY prefix of the SAME
public archive (ARCHITECT-NOTE §3.3 rule 4; funding-family Stage-0 ruling (2)).

Not interpolation and not a second source: `daily/klines/` is the same archive
at a finer partition.  Authorised for truncated months only.  Runs on BOTH legs
(perp and spot) and logs every filled day to results/data_audit_fills.csv.

Neighbour-day identity check (ruling (2) condition): for one neighbouring day
per gap that exists in both the monthly and the daily file, the two must be
identical row-for-row; a disagreement stops and escalates.
"""
from __future__ import annotations
import gzip, os, sys
from urllib.request import urlopen
from urllib.error import HTTPError
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import DATA, OUT, SYMBOLS, load_klines
from fetch_data import KLINE_COLS, _read_zip_csv, detect_unit

BASE = {"perp1h": "https://data.binance.vision/data/futures/um/daily/klines",
        "spot1h": "https://data.binance.vision/data/spot/daily/klines"}


def _day(sym, leg, d):
    url = f"{BASE[leg]}/{sym}/1h/{sym}-1h-{d}.zip"
    try:
        raw = urlopen(url, timeout=120).read()
    except HTTPError as e:
        return None, f"http_{e.code}"
    df = _read_zip_csv(raw, KLINE_COLS)
    unit = detect_unit(df["open_time"])
    df = df.copy()
    df["ts"] = pd.to_datetime(pd.to_numeric(df["open_time"], errors="coerce"),
                              unit=unit, utc=True)
    df["month"] = d[:7]
    return df[["ts", "open", "high", "low", "close", "volume", "month"]], "ok"


def main():
    logs, escalate = [], []
    for leg in ("perp1h", "spot1h"):
        for sym in SYMBOLS:
            k = load_klines(sym, leg)
            grid = pd.date_range(k.ts.iloc[0], k.ts.iloc[-1], freq="1h", tz="UTC")
            miss = grid.difference(pd.DatetimeIndex(k.ts))
            days = sorted({d.strftime("%Y-%m-%d") for d in miss})
            if not days:
                continue
            parts = []
            for d in days:
                df, st = _day(sym, leg, d)
                logs.append(dict(symbol=sym, leg=leg, dataset="daily_backfill",
                                 day=d, status=st, rows=(0 if df is None else len(df))))
                if df is not None and len(df):
                    parts.append(df)
                # neighbour-day identity check
                nb = (pd.Timestamp(d) - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
                have = k[k.ts.dt.strftime("%Y-%m-%d") == nb]
                if len(have) == 24:
                    ndf, nst = _day(sym, leg, nb)
                    if ndf is not None and len(ndf) == 24:
                        a = have[["ts", "open", "high", "low", "close"]].reset_index(drop=True)
                        b = ndf[["ts", "open", "high", "low", "close"]].reset_index(drop=True)
                        for c in ("open", "high", "low", "close"):
                            a[c] = pd.to_numeric(a[c]); b[c] = pd.to_numeric(b[c])
                        ok = a.equals(b)
                        logs.append(dict(symbol=sym, leg=leg,
                                         dataset="neighbour_identity", day=nb,
                                         status=("identical" if ok else "MISMATCH"),
                                         rows=24))
                        if not ok:
                            escalate.append((sym, leg, nb))
            if not parts:
                print(f"{sym}/{leg}: NO backfill available for {days}")
                continue
            add = pd.concat(parts, ignore_index=True)
            add = add[add.ts.isin(miss)]
            for c in ("open", "high", "low", "close", "volume"):
                add[c] = pd.to_numeric(add[c], errors="coerce")
            out = pd.concat([k, add], ignore_index=True)
            out = out.drop_duplicates(subset="ts", keep="first").sort_values("ts")
            with gzip.open(os.path.join(DATA, f"{sym}-{leg}.csv.gz"), "wt") as fh:
                out.to_csv(fh, index=False)
            g2 = pd.date_range(out.ts.iloc[0], out.ts.iloc[-1], freq="1h", tz="UTC")
            print(f"{sym}/{leg}: filled {len(add)} bars over {len(days)} days; "
                  f"remaining missing {len(g2.difference(pd.DatetimeIndex(out.ts)))}")
    if logs:
        f = os.path.join(OUT, "data_audit_fills.csv")
        pd.DataFrame(logs).to_csv(f, index=False)
        print(f"wrote {f}")
    if escalate:
        print("ESCALATE: neighbour-day mismatch", escalate)
        sys.exit(2)


if __name__ == "__main__":
    main()
