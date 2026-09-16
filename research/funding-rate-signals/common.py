"""Shared plumbing for the funding-rate-signals pass (DESIGN.md §3).

Self-contained: this package pulls its own 1h tape and its own funding tape and
depends on nothing outside pandas/numpy, so the audit and the engine can be read
end to end from this directory.
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "results")
CACHE = os.path.join(HERE, "cache")
for d in (DATA, OUT, CACHE):
    os.makedirs(d, exist_ok=True)

MAJORS = ["BTCUSDT", "ETHUSDT"]
ALTS = ["SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]
SYMBOLS = MAJORS + ALTS
TIERS = {"majors": MAJORS, "alts": ALTS}

# §3.4 windows (split by the entry bar's UTC date)
FIT_END = pd.Timestamp("2025-08-01", tz="UTC")      # exclusive
HOLD_START = pd.Timestamp("2025-08-01", tz="UTC")
HOLD_END = pd.Timestamp("2026-08-01", tz="UTC")     # exclusive
TAIL_START = HOLD_END
TAIL_END = pd.Timestamp("2026-09-01", tz="UTC")     # exclusive

# §1.2 funding state
PCT_WINDOW = 90          # settlements (30 days)
PCT_MINP = 45
PCT_HI, PCT_LO = 0.90, 0.10
FLOOR = 0.0003           # 0.03 % per 8h
LAPSE = 0.0001           # funding-lapse threshold
PERSIST = 2              # consecutive settlements
COOLDOWN_SETTLEMENTS = 3
MAX_SETTLEMENTS = 30

# §1.4 / §2.3 templates
A_STOP_DATR = 1.5
B_LOOKBACK = 12
B_STOP_ATR_BUF = 0.25
B_TIME_BARS = 48
B_TARGET_R = 1.0
B_DEOVERLAP = 12
RET_BARS = 24            # trailing 24h

# §7 costs
COST_RT = 0.001          # 0.10 % round trip taker
MAKER_RT = 0.0004        # fit-only sensitivity

WARMUP_DAYS = 15         # §3.4


def load_funding(symbol: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(DATA, f"{symbol}-funding.csv.gz"))
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df["last_funding_rate"] = pd.to_numeric(df["last_funding_rate"],
                                            errors="coerce")
    df["funding_interval_hours"] = pd.to_numeric(df["funding_interval_hours"],
                                                 errors="coerce")
    # §3.3 rule 3: two rows on one slot -> keep the last, count them.
    df = df.sort_values("ts")
    df["dup"] = df.duplicated(subset="ts", keep=False)
    n_dup = int(df["dup"].sum())
    df = df.drop_duplicates(subset="ts", keep="last").reset_index(drop=True)
    df.attrs["n_dup_rows"] = n_dup
    return df


def load_klines(symbol: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(DATA, f"{symbol}-1h.csv.gz"))
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.drop_duplicates(subset="ts", keep="last")
    df = df.sort_values("ts").reset_index(drop=True)
    return df


def settlement_grid(first: pd.Timestamp, last: pd.Timestamp,
                    interval_h: int = 8) -> pd.DatetimeIndex:
    """§3.3 rule 1: slots every `interval` hours on the 00/08/16 UTC grid."""
    return pd.date_range(first, last, freq=f"{interval_h}h", tz="UTC")


def wilder_atr(high, low, close, n=14):
    h, l, c = np.asarray(high, float), np.asarray(low, float), np.asarray(close, float)
    pc = np.concatenate([[np.nan], c[:-1]])
    tr = np.nanmax(np.vstack([h - l, np.abs(h - pc), np.abs(l - pc)]), axis=0)
    out = np.full(len(tr), np.nan)
    if len(tr) <= n:
        return out
    out[n] = np.nanmean(tr[1:n + 1])
    for i in range(n + 1, len(tr)):
        out[i] = (out[i - 1] * (n - 1) + tr[i]) / n
    return out


def daily_atr(kl: pd.DataFrame, n: int = 14) -> pd.Series:
    """Wilder ATR(14) on UTC-day bars built from the 1h tape, as of the PRIOR
    completed day (§1.4.1).  Returned indexed by UTC date, already shifted."""
    d = kl.set_index("ts").resample("1D").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    a = wilder_atr(d["high"], d["low"], d["close"], n)
    s = pd.Series(a, index=d.index).shift(1)   # prior completed day
    s.index = s.index.date
    return s


def rolling_pct_rank(x: pd.Series, window: int = PCT_WINDOW,
                     minp: int = PCT_MINP) -> pd.Series:
    """Percentile rank of the current value among the trailing `window` values,
    INCLUDING the current one (§1.2).  Prefix-stable by construction: uses only
    values at or before each index."""
    def _r(a):
        cur = a[-1]
        v = a[~np.isnan(a)]
        if len(v) < minp or np.isnan(cur):
            return np.nan
        return (v <= cur).sum() / len(v)
    return x.rolling(window, min_periods=minp).apply(_r, raw=True)


def welch_t(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    a, b = a[~np.isnan(a)], b[~np.isnan(b)]
    if len(a) < 2 or len(b) < 2:
        return np.nan
    va, vb = a.var(ddof=1) / len(a), b.var(ddof=1) / len(b)
    if va + vb <= 0:
        return np.nan
    return (a.mean() - b.mean()) / np.sqrt(va + vb)


def tstat(x):
    x = np.asarray(x, float)
    x = x[~np.isnan(x)]
    if len(x) < 2 or x.std(ddof=1) == 0:
        return np.nan
    return x.mean() / (x.std(ddof=1) / np.sqrt(len(x)))
