#!/usr/bin/env python3
"""Data pull for the full-form squeeze pass (ARCHITECT-NOTE §2, §5; DESIGN §2).

Reuses, by import, the two pullers the note names:

  research/hedged-carry/fetch_data.py         -- archive fetch/zip reader, the
                                                 per-file ms/us timestamp rule
                                                 (detect_unit), Binance funding
  research/deriv-positioning/fetch_metrics.py -- Binance USD-M daily metrics

and adds what neither has:

  * perp 1m klines WITH taker_buy_volume (hedged-carry pulls 1h and drops it);
  * spot 15m klines WITH taker_buy_volume (spot CVD; the 15m archive bar is the
    exact UTC-aligned sum of its 1m bars -- checks.py re-proves that on a
    sample month rather than assuming it);
  * Bybit and OKX funding history over their public REST endpoints, paged
    backwards to the earliest row each will serve, with a per-page request log
    and a per-symbol depth summary (the STAGE-0 deliverable, note §2).

No credentials anywhere. Every endpoint is public.

Output (data/ is gitignored):
    data/<SYM>-perp1m.parquet       ts,open,high,low,close,volume,taker_buy_volume
    data/<SYM>-spot15m.parquet      same columns
    data/<SYM>-funding-binance.parquet  ts,rate,interval_h
    data/<SYM>-funding-bybit.parquet    ts,rate
    data/<SYM>-funding-okx.parquet      ts,rate
    data/<SYM>-metrics.parquet      ts + the eight metrics columns
    results/fetch_log.csv           every archive file's HTTP outcome, rows, ts unit
    results/venue_pages.csv         every Bybit/OKX request: url params, rows, oldest ts
    results/venue_depth.csv         per venue x symbol: first/last ts, n, intervals
"""
from __future__ import annotations
import argparse, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "results")
for d in (DATA, OUT):
    os.makedirs(d, exist_ok=True)

sys.path.insert(0, os.path.join(ROOT, "hedged-carry"))
sys.path.insert(0, os.path.join(ROOT, "deriv-positioning"))
import fetch_data as hc          # noqa: E402  hedged-carry puller
import fetch_metrics as dp       # noqa: E402  deriv-positioning puller

SYMBOLS = hc.SYMBOLS
FUT, SPOT = hc.FUT, hc.SPOT
PROBE_START, PROBE_END = "2019-09", "2026-08"          # monthly archive
METRICS_START, METRICS_END = "2020-09-01", "2026-08-31"  # first file 2020-09-01 (404 on 08-31)

OKX_INST = {s: f"{s[:-4]}-USDT-SWAP" for s in SYMBOLS}


# ---------------------------------------------------------------- klines ----
def build_klines_tb(symbol, ms, workers, base, interval, kind):
    """hedged-carry build_klines, but any interval and keeping taker_buy_volume."""
    urls = [(m, f"{base}/klines/{symbol}/{interval}/{symbol}-{interval}-{m}.zip")
            for m in ms]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda mu: hc.fetch(mu[1], hc.KLINE_COLS), urls))
    parts, log = [], []
    for (m, _), (df, st) in zip(urls, res):
        unit = ""
        if df is not None and len(df):
            unit = hc.detect_unit(df["open_time"])        # raises -> stops pull
            df = df.copy()
            df["ts"] = pd.to_datetime(pd.to_numeric(df["open_time"]),
                                      unit=unit, utc=True)
            parts.append(df[["ts", "open", "high", "low", "close", "volume",
                             "taker_buy_volume"]])
        log.append(dict(symbol=symbol, dataset=kind, month=m, status=st,
                        rows=(0 if df is None else len(df)), ts_unit=unit))
    if not parts:
        return None, log
    kl = pd.concat(parts, ignore_index=True)
    for c in ("open", "high", "low", "close", "volume", "taker_buy_volume"):
        kl[c] = pd.to_numeric(kl[c], errors="coerce").astype("float64")
    kl["ts"] = kl["ts"].astype("datetime64[ns, UTC]")
    kl = kl.drop_duplicates("ts", keep="last").sort_values("ts")
    return kl.reset_index(drop=True), log


# ------------------------------------------------------- venue funding -------
def _get_json(url, retries=4):
    for a in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "research-pull/1.0"})
            return json.loads(urlopen(req, timeout=60).read()), "ok"
        except HTTPError as e:
            if e.code in (429, 503) and a < retries - 1:
                time.sleep(2 + 3 * a)
                continue
            return None, f"http_{e.code}"
        except (URLError, TimeoutError, OSError, ValueError):
            if a == retries - 1:
                return None, "neterr"
            time.sleep(2)
    return None, "neterr"


def pull_bybit(symbol, pages_log):
    """GET /v5/market/funding/history, category=linear, limit 200, paged back by
    endTime = oldest_ts - 1 until an empty page or no progress."""
    base = "https://api.bybit.com/v5/market/funding/history"
    rows, end, page = [], None, 0
    while True:
        q = f"?category=linear&symbol={symbol}&limit=200"
        if end is not None:
            q += f"&endTime={end}"
        js, st = _get_json(base + q)
        n, oldest = 0, None
        if js is not None and js.get("retCode") == 0:
            lst = js["result"]["list"]
            n = len(lst)
            for r in lst:
                rows.append((int(r["fundingRateTimestamp"]), float(r["fundingRate"])))
            if lst:
                oldest = min(int(r["fundingRateTimestamp"]) for r in lst)
        elif js is not None:
            st = f"ret_{js.get('retCode')}:{js.get('retMsg')}"
        pages_log.append(dict(venue="bybit", symbol=symbol, page=page,
                              end_param=end, status=st, rows=n,
                              oldest=(pd.to_datetime(oldest, unit="ms", utc=True)
                                      if oldest else None)))
        page += 1
        if st != "ok" or n == 0 or (end is not None and oldest >= end):
            break
        end = oldest - 1
        time.sleep(0.12)
    return rows


def pull_okx(symbol, pages_log):
    """GET /api/v5/public/funding-rate-history, limit 100, paged back with
    after = oldest fundingTime until an empty page."""
    base = "https://www.okx.com/api/v5/public/funding-rate-history"
    inst = OKX_INST[symbol]
    rows, after, page = [], None, 0
    while True:
        q = f"?instId={inst}&limit=100"
        if after is not None:
            q += f"&after={after}"
        js, st = _get_json(base + q)
        n, oldest = 0, None
        if js is not None and js.get("code") == "0":
            lst = js["data"]
            n = len(lst)
            for r in lst:
                rate = r.get("realizedRate") or r["fundingRate"]
                rows.append((int(r["fundingTime"]), float(rate)))
            if lst:
                oldest = min(int(r["fundingTime"]) for r in lst)
        elif js is not None:
            st = f"code_{js.get('code')}:{js.get('msg')}"
        pages_log.append(dict(venue="okx", symbol=symbol, page=page,
                              end_param=after, status=st, rows=n,
                              oldest=(pd.to_datetime(oldest, unit="ms", utc=True)
                                      if oldest else None)))
        page += 1
        if st != "ok" or n == 0 or (after is not None and oldest >= after):
            break
        after = oldest
        time.sleep(0.25)          # 20 req / 2 s public limit
    return rows


def _venue_frame(rows):
    df = pd.DataFrame(rows, columns=["ms", "rate"]).drop_duplicates("ms")
    df["ts"] = pd.to_datetime(df["ms"], unit="ms", utc=True).dt.round("min")
    return df[["ts", "rate"]].sort_values("ts").reset_index(drop=True)


def depth_row(venue, symbol, df):
    if df is None or not len(df):
        return dict(venue=venue, symbol=symbol, n=0)
    gaps = df["ts"].diff().dt.total_seconds().div(3600).dropna()
    return dict(venue=venue, symbol=symbol, n=len(df),
                first_ts=df["ts"].iloc[0], last_ts=df["ts"].iloc[-1],
                days=round((df["ts"].iloc[-1] - df["ts"].iloc[0]).days, 1),
                interval_h_mode=(gaps.mode().iloc[0] if len(gaps) else None),
                interval_h_set=",".join(str(int(x)) if x == int(x) else str(x)
                                        for x in sorted(gaps.round(2).unique())[:8]),
                n_gt_8h=int((gaps > 8.01).sum()))


# ------------------------------------------------------------------ main -----
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(SYMBOLS))
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--only", default="funding,venues,metrics,perp1m,spot15m")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    only = set(a.only.split(","))
    ms = hc.months(PROBE_START, PROBE_END)
    logs, pages, depth = [], [], []

    def done(p):
        return os.path.exists(p) and not a.force

    for s in a.symbols.split(","):
        if "funding" in only:
            p = os.path.join(DATA, f"{s}-funding-binance.parquet")
            if not done(p):
                f, lg = hc.build_funding(s, ms, a.workers); logs += lg
                f = f.rename(columns={"last_funding_rate": "rate",
                                      "funding_interval_hours": "interval_h"})
                f["rate"] = pd.to_numeric(f["rate"], errors="coerce")
                f[["ts", "rate", "interval_h"]].to_parquet(p)
            depth.append(depth_row("binance", s, pd.read_parquet(p)))
        if "venues" in only:
            for venue, fn in (("bybit", pull_bybit), ("okx", pull_okx)):
                p = os.path.join(DATA, f"{s}-funding-{venue}.parquet")
                if not done(p):
                    rows = fn(s, pages)
                    _venue_frame(rows).to_parquet(p)
                depth.append(depth_row(venue, s, pd.read_parquet(p)))
        if "metrics" in only:
            p = os.path.join(DATA, f"{s}-metrics.parquet")
            if not done(p):
                days = dp.day_list(METRICS_START, METRICS_END)
                with ThreadPoolExecutor(max_workers=16) as ex:
                    res = list(ex.map(lambda d: dp.fetch_day(s, d), days))
                logs += [dict(symbol=s, dataset="metrics", month=d, status=st,
                              rows=(0 if df is None else len(df)), ts_unit="")
                         for d, (df, st) in zip(days, res)]
                parts = [df for df, st in res if df is not None and len(df)]
                df = pd.concat(parts, ignore_index=True)
                df["ts"] = pd.to_datetime(df["create_time"], utc=True)
                df = df.drop(columns=["create_time", "symbol"])
                for c in df.columns:
                    if c != "ts":
                        df[c] = pd.to_numeric(df[c], errors="coerce")
                df = df.sort_values("ts").drop_duplicates("ts", keep="first")
                df.reset_index(drop=True).to_parquet(p)
        for kind, base, iv in (("perp1m", FUT, "1m"), ("spot15m", SPOT, "15m")):
            if kind not in only:
                continue
            p = os.path.join(DATA, f"{s}-{kind}.parquet")
            if done(p):
                continue
            kl, lg = build_klines_tb(s, ms, a.workers, base, iv, kind); logs += lg
            kl.to_parquet(p)
            print(f"{s} {kind}: {len(kl)} {kl.ts.iloc[0]}..{kl.ts.iloc[-1]}",
                  flush=True)
        print(f"{s}: done", flush=True)

    if logs:
        f = os.path.join(OUT, "fetch_log.csv")
        new = pd.DataFrame(logs)
        if os.path.exists(f):
            new = pd.concat([pd.read_csv(f), new], ignore_index=True)
        new.drop_duplicates(["symbol", "dataset", "month"], keep="last").to_csv(f, index=False)
    if pages:
        f = os.path.join(OUT, "venue_pages.csv")
        new = pd.DataFrame(pages)
        if os.path.exists(f):
            new = pd.concat([pd.read_csv(f), new], ignore_index=True)
        new.to_csv(f, index=False)
    if depth:
        f = os.path.join(OUT, "venue_depth.csv")
        new = pd.DataFrame(depth)
        if os.path.exists(f):
            new = pd.concat([pd.read_csv(f), new], ignore_index=True)
        new.drop_duplicates(["venue", "symbol"], keep="last").to_csv(f, index=False)
        print(new.to_string(), flush=True)


if __name__ == "__main__":
    main()
