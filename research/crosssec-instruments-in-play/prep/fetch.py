#!/usr/bin/env python3
"""Shared monthly-archive fetch — adapted directly from
`research/orb-utc0-crypto/prep/extend_history.py` (same URL family, same
header handling, same microsecond-timestamp normalisation), generalised to N
symbols, N intervals and to the paginated S3 listing (ARCHITECT-NOTE §8.1).
"""
from __future__ import annotations
import io, os, time, zipfile
import xml.etree.ElementTree as ET
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import numpy as np
import pandas as pd

BASE = "https://data.binance.vision/data/futures/um"
S3 = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"

KLINE_COLS = ["open_time", "open", "high", "low", "close", "volume", "close_time",
              "quote_volume", "count", "taker_buy_volume", "taker_buy_quote_volume",
              "ignore"]
FUND_COLS = ["calc_time", "funding_interval_hours", "last_funding_rate"]


def _get(url: str, timeout: int = 180, tries: int = 4) -> bytes:
    for k in range(tries):
        try:
            return urlopen(url, timeout=timeout).read()
        except HTTPError as e:
            if e.code == 404:
                raise
            if k == tries - 1:
                raise
        except (URLError, TimeoutError, OSError):
            if k == tries - 1:
                raise
        time.sleep(1.5 * (k + 1))
    raise RuntimeError(url)


def list_months(symbol: str, kind: str = "klines", interval: str = "1d") -> list[str]:
    """Every monthly archive month that exists for (symbol, kind, interval),
    from the S3 key listing. One request per symbol."""
    if kind == "klines":
        prefix = f"data/futures/um/monthly/klines/{symbol}/{interval}/"
    else:
        prefix = f"data/futures/um/monthly/{kind}/{symbol}/"
    out, marker = [], None
    while True:
        url = f"{S3}?prefix={prefix}"
        if marker:
            url += f"&marker={marker}"
        root = ET.fromstring(_get(url, timeout=120))
        keys = [e.findtext(NS + "Key") for e in root.findall(NS + "Contents")]
        out += [k for k in keys if k.endswith(".zip")]
        if root.findtext(NS + "IsTruncated") != "true":
            break
        marker = root.findtext(NS + "NextMarker") or (keys[-1] if keys else None)
        if marker is None:
            break
    months = sorted({os.path.basename(k)[:-4].rsplit("-", 2)[-2] + "-" +
                     os.path.basename(k)[:-4].rsplit("-", 2)[-1] for k in out})
    return months


def _read_zip(raw: bytes, cols: list[str], first_col: bytes) -> pd.DataFrame:
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with z.open(z.namelist()[0]) as f:
            data = f.read()
    if not data.strip():
        return pd.DataFrame(columns=cols)
    skip = 1 if data.startswith(first_col) else 0
    return pd.read_csv(io.BytesIO(data), header=None, names=cols, skiprows=skip)


def fetch_klines(symbol: str, ym: str, interval: str) -> pd.DataFrame | None:
    url = f"{BASE}/monthly/klines/{symbol}/{interval}/{symbol}-{interval}-{ym}.zip"
    try:
        raw = _get(url)
    except HTTPError:
        return None
    return _read_zip(raw, KLINE_COLS, b"open_time")


def fetch_funding(symbol: str, ym: str) -> pd.DataFrame | None:
    url = f"{BASE}/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{ym}.zip"
    try:
        raw = _get(url)
    except HTTPError:
        return None
    return _read_zip(raw, FUND_COLS, b"calc_time")


def norm_klines(parts: list[pd.DataFrame]) -> pd.DataFrame:
    """Concatenate, normalise timestamps (ms vs us), de-duplicate, sort.
    Verbatim logic from extend_history.build()."""
    parts = [p for p in parts if p is not None and len(p)]
    if not parts:
        return pd.DataFrame(columns=["t_ms", "open", "high", "low", "close",
                                     "volume", "quote_volume"])
    df = pd.concat(parts, ignore_index=True)
    df = df[pd.to_numeric(df["open_time"], errors="coerce").notna()]
    df["open_time"] = df["open_time"].astype("int64")
    df.loc[df["open_time"] > 10 ** 14, "open_time"] //= 1000
    df = df.drop_duplicates("open_time").sort_values("open_time").reset_index(drop=True)
    out = df[["open", "high", "low", "close", "volume", "quote_volume"]].astype(float)
    out.insert(0, "t_ms", df["open_time"].values)
    return out


def norm_funding(parts: list[pd.DataFrame]) -> pd.DataFrame:
    parts = [p for p in parts if p is not None and len(p)]
    if not parts:
        return pd.DataFrame(columns=["t_ms", "rate"])
    df = pd.concat(parts, ignore_index=True)
    df = df[pd.to_numeric(df["calc_time"], errors="coerce").notna()]
    df["calc_time"] = df["calc_time"].astype("int64")
    df.loc[df["calc_time"] > 10 ** 14, "calc_time"] //= 1000
    df = df.drop_duplicates("calc_time").sort_values("calc_time").reset_index(drop=True)
    return pd.DataFrame(dict(t_ms=df["calc_time"].values,
                             rate=df["last_funding_rate"].astype(float).values))


def gaps(t_ms: np.ndarray, step_ms: int) -> list[dict]:
    d = np.diff(t_ms)
    idx = np.where(d != step_ms)[0]
    return [dict(after=str(pd.Timestamp(int(t_ms[i]), unit="ms", tz="UTC")),
                 before=str(pd.Timestamp(int(t_ms[i + 1]), unit="ms", tz="UTC")),
                 missing=int(d[i] // step_ms - 1)) for i in idx]
