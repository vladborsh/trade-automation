#!/usr/bin/env python3
"""Data pull for the funding-rate-signals pass (ARCHITECT-NOTE §3.1, DESIGN §3).

Two datasets from the public `data.binance.vision` bulk host, no credentials:

  funding  data/futures/um/monthly/fundingRate/<SYM>/<SYM>-fundingRate-<YYYY-MM>.zip
           columns: calc_time, funding_interval_hours, last_funding_rate
  klines   data/futures/um/monthly/klines/<SYM>/1h/<SYM>-1h-<YYYY-MM>.zip
           columns: open_time, open, high, low, close, volume, close_time, ...

Pull runs from each symbol's first archived month (probed, not assumed) through
the latest month the archive publishes.  Every month's HTTP outcome and row
count is logged to results/fetch_log.csv so that the Stage-0 audit can explain
every month's row count by listing date + logged gaps (§9 point 1).

Output (gitignored):
    data/<SYM>-funding.csv.gz   ts,funding_interval_hours,last_funding_rate
    data/<SYM>-1h.csv.gz        ts,open,high,low,close,volume
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
for d in (DATA, OUT):
    os.makedirs(d, exist_ok=True)

BASE = "https://data.binance.vision/data/futures/um/monthly"
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
           "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]

# Probe range: wide enough to contain every symbol's listing month and the
# latest published month.  Months outside a symbol's coverage return http_404
# and are logged as such; nothing is assumed about where coverage starts.
PROBE_START, PROBE_END = "2019-09", "2026-09"

FUND_COLS = ["calc_time", "funding_interval_hours", "last_funding_rate"]
KLINE_COLS = ["open_time", "open", "high", "low", "close", "volume",
              "close_time", "quote_volume", "count",
              "taker_buy_volume", "taker_buy_quote_volume", "ignore"]


def months(start: str, end: str):
    return [d.strftime("%Y-%m") for d in
            pd.period_range(start, end, freq="M").to_timestamp()]


def _get(url: str, retries: int = 3):
    for attempt in range(retries):
        try:
            return urlopen(url, timeout=180).read(), "ok"
        except HTTPError as e:
            return None, f"http_{e.code}"
        except (URLError, TimeoutError, OSError):
            if attempt == retries - 1:
                return None, "neterr"
    return None, "neterr"


def _read_zip_csv(raw: bytes, expect_cols):
    """Monthly archive files come with or without a header row depending on
    vintage; detect rather than assume."""
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with z.open(z.namelist()[0]) as f:
            head = f.readline().decode("utf-8", "replace")
    first = head.split(",")[0].strip().strip('"')
    has_header = not first.replace(".", "").replace("-", "").isdigit()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with z.open(z.namelist()[0]) as f:
            if has_header:
                df = pd.read_csv(f)
            else:
                df = pd.read_csv(f, header=None, names=expect_cols)
    return df


def fetch_funding(symbol: str, ym: str):
    url = f"{BASE}/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip"
    raw, status = _get(url)
    if raw is None:
        return None, status
    try:
        df = _read_zip_csv(raw, FUND_COLS)
    except Exception as e:                                    # noqa: BLE001
        return None, f"badzip:{type(e).__name__}"
    return df, "ok"


def fetch_kline(symbol: str, ym: str):
    url = f"{BASE}/klines/{symbol}/1h/{symbol}-1h-{ym}.zip"
    raw, status = _get(url)
    if raw is None:
        return None, status
    try:
        df = _read_zip_csv(raw, KLINE_COLS)
    except Exception as e:                                    # noqa: BLE001
        return None, f"badzip:{type(e).__name__}"
    return df, "ok"


def _ts(series):
    """Binance mixes ms and us epochs across vintages; detect by magnitude."""
    v = pd.to_numeric(series, errors="coerce")
    unit = "us" if v.dropna().median() > 1e14 else "ms"
    return pd.to_datetime(v, unit=unit, utc=True)


def build_symbol(symbol: str, ms, workers: int):
    log = []
    # ---- funding -----------------------------------------------------------
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda m: fetch_funding(symbol, m), ms))
    parts = []
    for m, (df, st) in zip(ms, res):
        log.append(dict(symbol=symbol, dataset="funding", month=m, status=st,
                        rows=(0 if df is None else len(df))))
        if df is not None and len(df):
            df = df.copy()
            df["month"] = m
            parts.append(df)
    fund = None
    if parts:
        fund = pd.concat(parts, ignore_index=True)
        fund["ts_raw"] = _ts(fund["calc_time"])
        # §3.2: calc_time carries sub-second jitter; round to the nearest minute.
        fund["ts"] = fund["ts_raw"].dt.round("min")
        fund = fund[["ts", "ts_raw", "funding_interval_hours",
                     "last_funding_rate", "month"]]
        fund = fund.sort_values(["ts", "ts_raw"]).reset_index(drop=True)

    # ---- klines ------------------------------------------------------------
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda m: fetch_kline(symbol, m), ms))
    parts = []
    for m, (df, st) in zip(ms, res):
        log.append(dict(symbol=symbol, dataset="klines", month=m, status=st,
                        rows=(0 if df is None else len(df))))
        if df is not None and len(df):
            df = df.copy()
            df["month"] = m
            parts.append(df)
    kl = None
    if parts:
        kl = pd.concat(parts, ignore_index=True)
        kl["ts"] = _ts(kl["open_time"])
        kl = kl[["ts", "open", "high", "low", "close", "volume", "month"]]
        for c in ("open", "high", "low", "close", "volume"):
            kl[c] = pd.to_numeric(kl[c], errors="coerce")
        kl = kl.sort_values("ts").reset_index(drop=True)
    return fund, kl, log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(SYMBOLS))
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    ms = months(PROBE_START, PROBE_END)
    print(f"probe months: {ms[0]} .. {ms[-1]} ({len(ms)})", flush=True)
    logs = []
    for s in a.symbols.split(","):
        fp = os.path.join(DATA, f"{s}-funding.csv.gz")
        kp = os.path.join(DATA, f"{s}-1h.csv.gz")
        if os.path.exists(fp) and os.path.exists(kp) and not a.force:
            print(f"skip {s} (exists)", flush=True)
            continue
        fund, kl, log = build_symbol(s, ms, a.workers)
        logs += log
        if fund is None or kl is None:
            print(f"{s}: NO DATA", flush=True)
            continue
        with gzip.open(fp, "wt") as fh:
            fund.drop(columns=["ts_raw"]).to_csv(fh, index=False)
        with gzip.open(kp, "wt") as fh:
            kl.to_csv(fh, index=False)
        print(f"{s}: funding {len(fund):>6} rows {fund.ts.iloc[0]} .. "
              f"{fund.ts.iloc[-1]} | klines {len(kl):>7} rows "
              f"{kl.ts.iloc[0]} .. {kl.ts.iloc[-1]}", flush=True)
    if logs:
        f = os.path.join(OUT, "fetch_log.csv")
        new = pd.DataFrame(logs)
        if os.path.exists(f):
            new = pd.concat([pd.read_csv(f), new], ignore_index=True)
            new = new.drop_duplicates(subset=["symbol", "dataset", "month"],
                                      keep="last")
        new.to_csv(f, index=False)
        print(f"wrote {f} ({len(new)} rows)", flush=True)


if __name__ == "__main__":
    main()
