#!/usr/bin/env python3
"""DESIGN.md §5.2 — extend the audited Binance 1m tapes back to the earliest
month `data.binance.vision` actually publishes, and audit the result.

The audited tape `research/cmc-bot-vwap/data/<SYM>_1m.parquet` (2022-08-01 ..
2026-09-11) is **never modified**; other packages depend on it. This script
pulls the USD-M perpetual monthly 1m archives from the first available month
through 2022-07 and writes

    research/cmc-bot-vwap/data/<SYM>_1m_2020.parquet

= extension ++ the audited file, and asserts that the 2022-08-01-onward slice
of the new file is **byte-identical** to the audited file (same row count,
same t_ms sequence, same OHLCV values bit for bit).

    python prep/extend_history.py [--symbols BTCUSDT,ETHUSDT]

Writes `results/history_audit.json` — first available month, row counts,
duplicate count, monotonicity, the full gap list, and the identity check.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from urllib.request import urlopen

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(PKG, "..", ".."))
DATA = os.path.join(REPO, "research", "cmc-bot-vwap", "data")
RESULTS = os.path.join(PKG, "results")
os.makedirs(RESULTS, exist_ok=True)

BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
COLS = ["open_time", "open", "high", "low", "close", "volume", "close_time",
        "quote_volume", "count", "taker_buy_volume", "taker_buy_quote_volume", "ignore"]
PROBE_FROM = "2019-06"          # comfortably before the USD-M launch
CUT = "2022-08-01"              # the audited tape's first day


def head_ok(symbol: str, ym: str) -> bool:
    import urllib.request
    req = urllib.request.Request(f"{BASE}/{symbol}/1m/{symbol}-1m-{ym}.zip", method="HEAD")
    try:
        urlopen(req, timeout=60)
        return True
    except HTTPError:
        return False


def first_month(symbol: str) -> str:
    """The earliest monthly 1m archive that exists for `symbol`. Probed, not
    assumed (DESIGN §5.2)."""
    months = [p.strftime("%Y-%m") for p in pd.period_range(PROBE_FROM, "2022-07", freq="M")]
    for ym in months:
        if head_ok(symbol, ym):
            return ym
    raise RuntimeError(f"no monthly archive found for {symbol} before 2022-08")


def fetch_month(symbol: str, ym: str) -> pd.DataFrame | None:
    url = f"{BASE}/{symbol}/1m/{symbol}-1m-{ym}.zip"
    try:
        raw = urlopen(url, timeout=180).read()
    except HTTPError as e:
        print(f"  MISS {symbol} {ym} ({e.code})", file=sys.stderr)
        return None
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with z.open(z.namelist()[0]) as f:
            data = f.read()
    skip = 1 if data.startswith(b"open_time") else 0
    return pd.read_csv(io.BytesIO(data), header=None, names=COLS, skiprows=skip)


def build(symbol: str, months: list[str]) -> pd.DataFrame:
    with ThreadPoolExecutor(max_workers=6) as ex:
        parts = list(ex.map(lambda ym: fetch_month(symbol, ym), months))
    parts = [p for p in parts if p is not None and len(p)]
    df = pd.concat(parts, ignore_index=True)
    df["open_time"] = df["open_time"].astype("int64")
    df.loc[df["open_time"] > 10 ** 14, "open_time"] //= 1000
    df = df.drop_duplicates("open_time").sort_values("open_time").reset_index(drop=True)
    df["ts"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    out = df[["ts", "open", "high", "low", "close", "volume"]].astype(
        {"open": float, "high": float, "low": float, "close": float, "volume": float})
    out["t_ms"] = out.ts.values.astype("datetime64[ms]").astype("int64")
    return out


def gaps(t_ms: np.ndarray) -> list[dict]:
    d = np.diff(t_ms)
    idx = np.where(d != 60_000)[0]
    return [dict(after=str(pd.Timestamp(int(t_ms[i]), unit="ms", tz="UTC")),
                 before=str(pd.Timestamp(int(t_ms[i + 1]), unit="ms", tz="UTC")),
                 missing_minutes=int(d[i] // 60_000 - 1)) for i in idx]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="BTCUSDT,ETHUSDT")
    a = ap.parse_args()
    audit = {}
    for sym in a.symbols.split(","):
        base = pd.read_parquet(os.path.join(DATA, f"{sym}_1m.parquet"))
        fm = first_month(sym)
        print(f"{sym}: first available monthly 1m archive = {fm}", flush=True)
        months = [p.strftime("%Y-%m") for p in pd.period_range(fm, "2022-07", freq="M")]
        ext = build(sym, months)
        ext = ext[ext.ts < CUT].reset_index(drop=True)
        full = pd.concat([ext, base], ignore_index=True)
        assert full.t_ms.is_monotonic_increasing, f"{sym}: not sorted"
        ndup = int(full.t_ms.duplicated().sum())
        # the identity check: the 2022-08+ slice must reproduce the audited file
        tail = full[full.ts >= CUT].reset_index(drop=True)
        same = (len(tail) == len(base)
                and bool((tail.t_ms.values == base.t_ms.values).all())
                and all(bool((tail[c].values == base[c].values).all())
                        for c in ("open", "high", "low", "close", "volume")))
        g = gaps(full.t_ms.values)
        out = os.path.join(DATA, f"{sym}_1m_2020.parquet")
        full.to_parquet(out, index=False)
        audit[sym] = dict(
            first_month_available=fm,
            first_bar=str(full.ts.iloc[0]), last_bar=str(full.ts.iloc[-1]),
            rows_extension=len(ext), rows_audited_segment=len(base), rows_total=len(full),
            duplicates=ndup, monotonic=True,
            audited_segment_reproduces_byte_identical=same,
            n_gaps=len(g), missing_minutes_total=int(sum(x["missing_minutes"] for x in g)),
            gaps=g)
        print(f"  {sym}: {len(full)} rows {full.ts.iloc[0]} .. {full.ts.iloc[-1]}  "
              f"dup={ndup} gaps={len(g)} identical={same}", flush=True)
    with open(os.path.join(RESULTS, "history_audit.json"), "w") as fh:
        json.dump(audit, fh, indent=2)
    print("\nwrote results/history_audit.json")
    if not all(v["audited_segment_reproduces_byte_identical"] for v in audit.values()):
        raise SystemExit("STOP RULE (DESIGN §12): the audited 2022-08+ segment "
                         "does not reproduce. Return to Architect.")


if __name__ == "__main__":
    main()
