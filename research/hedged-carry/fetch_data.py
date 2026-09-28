#!/usr/bin/env python3
"""Data pull for the hedged spot-perp carry pass (ARCHITECT-NOTE §3.1, §9 p1).

Three datasets from the public `data.binance.vision` bulk host, no credentials:

  funding  data/futures/um/monthly/fundingRate/<SYM>/<SYM>-fundingRate-<YYYY-MM>.zip
  perp 1h  data/futures/um/monthly/klines/<SYM>/1h/<SYM>-1h-<YYYY-MM>.zip
  spot 1h  data/spot/monthly/klines/<SYM>/1h/<SYM>-1h-<YYYY-MM>.zip

The funding/perp fetch reproduces `research/funding-rate-signals/fetch_data.py`
verbatim in behaviour so that §6.7.1's audit identity can be checked.

NEW DATA RULE (§3.1): the spot archive switched kline open_time/close_time from
milliseconds to MICROSECONDS in files from 2025-01 onward (16-digit values).
The unit is detected PER FILE by digit count; a file whose unit cannot be
determined stops the pull (raises).

Output (gitignored):
    data/<SYM>-funding.csv.gz   ts,funding_interval_hours,last_funding_rate
    data/<SYM>-perp1h.csv.gz    ts,open,high,low,close,volume
    data/<SYM>-spot1h.csv.gz    ts,open,high,low,close,volume
    results/fetch_log.csv       every month's HTTP outcome, rows, ts unit

1m MODE (added 2026-09-28 for research/spot-lead, ARCHITECT-NOTE §5): with
`--interval 1m` the same two kline paths are pulled at 1m and the
`taker_buy_volume` column is KEPT (the 1h mode drops it, unchanged).  Output
goes to `--data-dir` as parquet (a 1m tape is ~3.6 M rows per leg):
    <data-dir>/<SYM>-funding.csv.gz  as above
    <data-dir>/<SYM>-perp1m.parquet  ts,open,high,low,close,volume,taker_buy_volume
    <data-dir>/<SYM>-spot1m.parquet  same
    <log-dir>/fetch_log_1m.csv
The per-file us/ms unit rule applies unchanged.  The default invocation (no
flags) behaves exactly as before.
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

FUT = "https://data.binance.vision/data/futures/um/monthly"
SPOT = "https://data.binance.vision/data/spot/monthly"
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
           "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]

# Probe range for funding/perp: identical to the funding family's, so the
# audit identity is like-for-like.  Spot lists earlier but coverage is bound by
# the funding start (§3.1), so the same probe range is sufficient and is used
# for all three datasets.
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


def detect_unit(series) -> str:
    """§3.1 timestamp-unit rule, PER FILE, by digit count.

    A 1h bar open in [2017-01-01, 2030-01-01) is 13 digits in ms and 16 in us.
    Every value in the file must agree; anything else raises and stops the pull.
    """
    v = pd.to_numeric(series, errors="coerce").dropna().astype("int64")
    if len(v) == 0:
        raise ValueError("empty timestamp column")
    d = v.astype(str).str.len().unique()
    if len(d) != 1:
        raise ValueError(f"mixed timestamp digit counts in one file: {sorted(d)}")
    n = int(d[0])
    if n == 13:
        return "ms"
    if n == 16:
        return "us"
    raise ValueError(f"undeterminable timestamp unit: {n}-digit values")


def fetch(url, cols):
    raw, status = _get(url)
    if raw is None:
        return None, status
    try:
        df = _read_zip_csv(raw, cols)
    except Exception as e:                                    # noqa: BLE001
        return None, f"badzip:{type(e).__name__}"
    return df, "ok"


def _fund_ts(series):
    v = pd.to_numeric(series, errors="coerce")
    unit = "us" if v.dropna().median() > 1e14 else "ms"
    return pd.to_datetime(v, unit=unit, utc=True)


def build_klines(symbol, ms, workers, base, kind, interval="1h"):
    """kind: 'perp' -> futures/um path, 'spot' -> spot path.

    interval '1h' keeps ts,OHLCV (original behaviour); '1m' also keeps
    taker_buy_volume."""
    keep = ["ts", "open", "high", "low", "close", "volume"]
    if interval != "1h":
        keep = keep + ["taker_buy_volume"]
    urls = [(m, f"{base}/klines/{symbol}/{interval}/{symbol}-{interval}-{m}.zip")
            for m in ms]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda mu: fetch(mu[1], KLINE_COLS), urls))
    parts, log = [], []
    for (m, _), (df, st) in zip(urls, res):
        unit = ""
        if df is not None and len(df):
            unit = detect_unit(df["open_time"])          # raises -> stops pull
            df = df.copy()
            df["ts"] = pd.to_datetime(
                pd.to_numeric(df["open_time"], errors="coerce"),
                unit=unit, utc=True)
            df["month"] = m
            parts.append(df[keep + ["month"]])
        log.append(dict(symbol=symbol, dataset=kind, month=m, status=st,
                        rows=(0 if df is None else len(df)), ts_unit=unit))
    if not parts:
        return None, log
    kl = pd.concat(parts, ignore_index=True)
    for c in keep[1:]:
        kl[c] = pd.to_numeric(kl[c], errors="coerce")
    kl = kl.sort_values("ts").reset_index(drop=True)
    return kl, log


def build_funding(symbol, ms, workers):
    urls = [(m, f"{FUT}/fundingRate/{symbol}/{symbol}-fundingRate-{m}.zip")
            for m in ms]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda mu: fetch(mu[1], FUND_COLS), urls))
    parts, log = [], []
    for (m, _), (df, st) in zip(urls, res):
        log.append(dict(symbol=symbol, dataset="funding", month=m, status=st,
                        rows=(0 if df is None else len(df)), ts_unit=""))
        if df is not None and len(df):
            df = df.copy()
            df["month"] = m
            parts.append(df)
    if not parts:
        return None, log
    fund = pd.concat(parts, ignore_index=True)
    fund["ts_raw"] = _fund_ts(fund["calc_time"])
    fund["ts"] = fund["ts_raw"].dt.round("min")     # §3.2 jitter rule
    fund = fund[["ts", "funding_interval_hours", "last_funding_rate", "month"]]
    return fund.sort_values("ts").reset_index(drop=True), log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(SYMBOLS))
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--interval", default="1h", choices=["1h", "1m"])
    ap.add_argument("--data-dir", default=DATA)
    ap.add_argument("--log-dir", default=OUT)
    ap.add_argument("--start", default=PROBE_START)
    ap.add_argument("--end", default=PROBE_END)
    a = ap.parse_args()
    if a.interval == "1m":
        return main_1m(a)
    ms = months(PROBE_START, PROBE_END)
    print(f"probe months: {ms[0]} .. {ms[-1]} ({len(ms)})", flush=True)
    logs = []
    for s in a.symbols.split(","):
        paths = {k: os.path.join(DATA, f"{s}-{k}.csv.gz")
                 for k in ("funding", "perp1h", "spot1h")}
        if all(os.path.exists(p) for p in paths.values()) and not a.force:
            print(f"skip {s} (exists)", flush=True)
            continue
        fund, lg = build_funding(s, ms, a.workers); logs += lg
        perp, lg = build_klines(s, ms, a.workers, FUT, "perp1h"); logs += lg
        spot, lg = build_klines(s, ms, a.workers, SPOT, "spot1h"); logs += lg
        if fund is None or perp is None or spot is None:
            print(f"{s}: NO DATA (fund={fund is not None} "
                  f"perp={perp is not None} spot={spot is not None})", flush=True)
            continue
        for k, df in (("funding", fund), ("perp1h", perp), ("spot1h", spot)):
            with gzip.open(paths[k], "wt") as fh:
                df.to_csv(fh, index=False)
        print(f"{s}: funding {len(fund):>6} {fund.ts.iloc[0]}..{fund.ts.iloc[-1]}"
              f" | perp {len(perp):>7} {perp.ts.iloc[0]}..{perp.ts.iloc[-1]}"
              f" | spot {len(spot):>7} {spot.ts.iloc[0]}..{spot.ts.iloc[-1]}",
              flush=True)
    if logs:
        f = os.path.join(OUT, "fetch_log.csv")
        new = pd.DataFrame(logs)
        if os.path.exists(f):
            new = pd.concat([pd.read_csv(f), new], ignore_index=True)
            new = new.drop_duplicates(subset=["symbol", "dataset", "month"],
                                      keep="last")
        new.to_csv(f, index=False)
        print(f"wrote {f} ({len(new)} rows)", flush=True)


def main_1m(a):
    """1m + taker-buy pull (spot-lead).  One symbol at a time: a 1m leg is
    ~3.6 M rows, and holding 16 of them at once is not needed."""
    os.makedirs(a.data_dir, exist_ok=True)
    os.makedirs(a.log_dir, exist_ok=True)
    ms = months(a.start, a.end)
    print(f"1m probe months: {ms[0]} .. {ms[-1]} ({len(ms)})", flush=True)
    logf = os.path.join(a.log_dir, "fetch_log_1m.csv")
    for s in a.symbols.split(","):
        paths = {"funding": os.path.join(a.data_dir, f"{s}-funding.csv.gz"),
                 "perp1m": os.path.join(a.data_dir, f"{s}-perp1m.parquet"),
                 "spot1m": os.path.join(a.data_dir, f"{s}-spot1m.parquet")}
        if all(os.path.exists(p) for p in paths.values()) and not a.force:
            print(f"skip {s} (exists)", flush=True)
            continue
        logs = []
        fund, lg = build_funding(s, ms, a.workers); logs += lg
        perp, lg = build_klines(s, ms, a.workers, FUT, "perp1m", "1m"); logs += lg
        spot, lg = build_klines(s, ms, a.workers, SPOT, "spot1m", "1m"); logs += lg
        new = pd.DataFrame(logs)
        if os.path.exists(logf):
            new = pd.concat([pd.read_csv(logf), new], ignore_index=True)
            new = new.drop_duplicates(subset=["symbol", "dataset", "month"],
                                      keep="last")
        new.to_csv(logf, index=False)
        if fund is None or perp is None or spot is None:
            print(f"{s}: NO DATA (fund={fund is not None} "
                  f"perp={perp is not None} spot={spot is not None})", flush=True)
            continue
        with gzip.open(paths["funding"], "wt") as fh:
            fund.to_csv(fh, index=False)
        for k, df in (("perp1m", perp), ("spot1m", spot)):
            df.drop(columns=["month"]).to_parquet(paths[k], index=False)
        print(f"{s}: funding {len(fund):>6} | perp1m {len(perp):>8} "
              f"{perp.ts.iloc[0]}..{perp.ts.iloc[-1]} | spot1m {len(spot):>8} "
              f"{spot.ts.iloc[0]}..{spot.ts.iloc[-1]}", flush=True)


if __name__ == "__main__":
    main()
