#!/usr/bin/env python3
"""Data pull for the COIN-M inverse cash-and-carry pass
(ARCHITECT-NOTE-SUCCESSORS §1.4 "Data", §2.1).

Public `data.binance.vision` bulk archive + the public `dapi` REST endpoint,
no credentials.

  COIN-M perp 1h   data/futures/cm/monthly/klines/<SYM>/1h/
  COIN-M funding   data/futures/cm/monthly/fundingRate/<SYM>/   (2022-07 .. 2026-06)
  COIN-M funding   GET /dapi/v1/fundingRate                      (2020-08 .. now)
  COIN-M quarterly data/futures/cm/monthly/klines/<SYM_yymmdd>/1h/
  spot 1h          data/spot/monthly/klines/<SYM>/1h/
  USD-M funding    data/futures/um/monthly/fundingRate/<SYM>/    (the comparison row)

The REST funding stream is asserted against the archive on the 2022-07..2026-06
overlap by `data_audit.py` (Stage-0 gate).  Timestamp units are detected PER
FILE by digit count, exactly as the hedged-carry pass's §3.1 rule requires.

Output (gitignored):
    data/<SYM>-cmfund-archive.csv.gz   ts,funding_interval_hours,last_funding_rate
    data/<SYM>-cmfund-rest.csv.gz      ts,last_funding_rate
    data/<SYM>-cm1h.csv.gz             ts,open,high,low,close,volume
    data/<SPOT>-spot1h.csv.gz          ts,open,high,low,close,volume
    data/<SPOT>-umfund.csv.gz          ts,funding_interval_hours,last_funding_rate
    data/q/<QSYM>-1h.csv.gz            ts,open,high,low,close,volume
    results/fetch_log.csv
"""
from __future__ import annotations
import argparse, gzip, io, json, os, sys, time, zipfile
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
QDATA = os.path.join(DATA, "q")
OUT = os.path.join(HERE, "results")
for d in (DATA, QDATA, OUT):
    os.makedirs(d, exist_ok=True)

CM = "https://data.binance.vision/data/futures/cm/monthly"
UM = "https://data.binance.vision/data/futures/um/monthly"
SPOT = "https://data.binance.vision/data/spot/monthly"
S3 = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
REST = "https://dapi.binance.com/dapi/v1/fundingRate"

CM_PERPS = ["BTCUSD_PERP", "ETHUSD_PERP"]
SPOTS = {"BTCUSD_PERP": "BTCUSDT", "ETHUSD_PERP": "ETHUSDT"}
PROBE_START, PROBE_END = "2020-08", "2026-09"

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
            time.sleep(1.0)
    return None, "neterr"


def s3_keys(prefix: str):
    out, marker = [], None
    while True:
        url = f"{S3}?prefix={urllib.parse.quote(prefix)}&max-keys=1000"
        if marker:
            url += "&marker=" + urllib.parse.quote(marker)
        x = ET.fromstring(urlopen(url, timeout=120).read())
        ks = [c.find(NS + "Key").text for c in x.findall(NS + "Contents")]
        out += ks
        if x.find(NS + "IsTruncated").text == "true" and ks:
            marker = ks[-1]
        else:
            break
    return out


def s3_dirs(prefix: str):
    url = f"{S3}?delimiter=/&prefix={urllib.parse.quote(prefix)}"
    x = ET.fromstring(urlopen(url, timeout=120).read())
    return [p.find(NS + "Prefix").text for p in x.findall(NS + "CommonPrefixes")]


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
    """Timestamp unit PER FILE by digit count: 13 = ms, 16 = us.  Anything
    else, or a mixture inside one file, raises and stops the pull."""
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
        return _read_zip_csv(raw, cols), "ok"
    except Exception as e:                                    # noqa: BLE001
        return None, f"badzip:{type(e).__name__}"


def _fund_ts(series):
    v = pd.to_numeric(series, errors="coerce")
    unit = "us" if v.dropna().median() > 1e14 else "ms"
    return pd.to_datetime(v, unit=unit, utc=True)


def build_klines(symbol, ms, workers, base, kind):
    urls = [(m, f"{base}/klines/{symbol}/1h/{symbol}-1h-{m}.zip") for m in ms]
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
            parts.append(df[["ts", "open", "high", "low", "close",
                             "volume", "month"]])
        log.append(dict(symbol=symbol, dataset=kind, month=m, status=st,
                        rows=(0 if df is None else len(df)), ts_unit=unit))
    if not parts:
        return None, log
    kl = pd.concat(parts, ignore_index=True)
    for c in ("open", "high", "low", "close", "volume"):
        kl[c] = pd.to_numeric(kl[c], errors="coerce")
    kl = kl.sort_values("ts").reset_index(drop=True)
    return kl, log


def build_funding_archive(symbol, ms, workers, base, kind):
    urls = [(m, f"{base}/fundingRate/{symbol}/{symbol}-fundingRate-{m}.zip")
            for m in ms]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda mu: fetch(mu[1], FUND_COLS), urls))
    parts, log = [], []
    for (m, _), (df, st) in zip(urls, res):
        log.append(dict(symbol=symbol, dataset=kind, month=m, status=st,
                        rows=(0 if df is None else len(df)), ts_unit=""))
        if df is not None and len(df):
            df = df.copy()
            df["month"] = m
            parts.append(df)
    if not parts:
        return None, log
    fund = pd.concat(parts, ignore_index=True)
    fund["ts_raw"] = _fund_ts(fund["calc_time"])
    fund["ts"] = fund["ts_raw"].dt.round("min")
    fund = fund[["ts", "funding_interval_hours", "last_funding_rate", "month"]]
    return fund.sort_values("ts").reset_index(drop=True), log


def build_funding_rest(symbol, start_ms=1590000000000):
    """GET /dapi/v1/fundingRate, paginated forward, 1000 rows a call."""
    rows, t = [], start_ms
    while True:
        url = f"{REST}?symbol={symbol}&startTime={t}&limit=1000"
        raw, st = _get(url)
        if raw is None:
            raise RuntimeError(f"REST funding failed for {symbol}: {st}")
        page = json.loads(raw)
        if not page:
            break
        rows += page
        nt = int(page[-1]["fundingTime"]) + 1
        if len(page) < 1000 or nt <= t:
            break
        t = nt
        time.sleep(0.15)
    df = pd.DataFrame(rows)
    if not len(df):
        return None
    df["ts_raw"] = pd.to_datetime(pd.to_numeric(df["fundingTime"]),
                                  unit="ms", utc=True)
    df["ts"] = df["ts_raw"].dt.round("min")
    df["last_funding_rate"] = pd.to_numeric(df["fundingRate"], errors="coerce")
    df = df[["ts", "last_funding_rate"]].drop_duplicates("ts", keep="last")
    return df.sort_values("ts").reset_index(drop=True)


def quarterly_symbols(pair: str):
    """Every <pair>_yymmdd 1h kline directory on the COIN-M archive."""
    dirs = s3_dirs("data/futures/cm/monthly/klines/")
    out = []
    for d in dirs:
        sym = d.rstrip("/").split("/")[-1]
        if sym.startswith(pair + "_") and sym != pair + "_PERP":
            out.append(sym)
    return sorted(out)


def save(path, df):
    with gzip.open(path, "wt") as fh:
        df.to_csv(fh, index=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--skip-quarterly", action="store_true")
    a = ap.parse_args()
    ms = months(PROBE_START, PROBE_END)
    print(f"probe months: {ms[0]} .. {ms[-1]} ({len(ms)})", flush=True)
    logs = []

    for sym in CM_PERPS:
        sp = SPOTS[sym]
        paths = {
            "cmfund-archive": os.path.join(DATA, f"{sym}-cmfund-archive.csv.gz"),
            "cmfund-rest": os.path.join(DATA, f"{sym}-cmfund-rest.csv.gz"),
            "cm1h": os.path.join(DATA, f"{sym}-cm1h.csv.gz"),
            "spot1h": os.path.join(DATA, f"{sp}-spot1h.csv.gz"),
            "umfund": os.path.join(DATA, f"{sp}-umfund.csv.gz"),
        }
        if all(os.path.exists(p) for p in paths.values()) and not a.force:
            print(f"skip {sym} (exists)", flush=True)
            continue
        fa, lg = build_funding_archive(sym, ms, a.workers, CM, "cmfund-archive")
        logs += lg
        cm, lg = build_klines(sym, ms, a.workers, CM, "cm1h")
        logs += lg
        sk, lg = build_klines(sp, ms, a.workers, SPOT, "spot1h")
        logs += lg
        uf, lg = build_funding_archive(sp, ms, a.workers, UM, "umfund")
        logs += lg
        fr = build_funding_rest(sym)
        for k, df in (("cmfund-archive", fa), ("cmfund-rest", fr),
                      ("cm1h", cm), ("spot1h", sk), ("umfund", uf)):
            if df is None:
                print(f"{sym}: MISSING {k}", flush=True)
                continue
            save(paths[k], df)
            print(f"{sym}/{k}: {len(df):>7} rows "
                  f"{df.ts.iloc[0]} .. {df.ts.iloc[-1]}", flush=True)

    if not a.skip_quarterly:
        for pair in ("BTCUSD", "ETHUSD"):
            qs = quarterly_symbols(pair)
            print(f"{pair}: {len(qs)} quarterly contracts", flush=True)
            for q in qs:
                p = os.path.join(QDATA, f"{q}-1h.csv.gz")
                if os.path.exists(p) and not a.force:
                    continue
                kl, lg = build_klines(q, ms, a.workers, CM, "q1h")
                logs += lg
                if kl is None:
                    print(f"  {q}: NO DATA", flush=True)
                    continue
                save(p, kl)
                print(f"  {q}: {len(kl):>6} rows {kl.ts.iloc[0]} .. "
                      f"{kl.ts.iloc[-1]}", flush=True)

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
