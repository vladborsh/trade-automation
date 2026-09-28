"""Constants and shared helpers for the full-form squeeze pass (DESIGN.md).

The two numerical helpers the funding family defined -- `rolling_pct_rank`
(funding state, §1.2) and `wilder_atr` -- are imported from
`research/funding-rate-signals/common.py` by path, not copied, so the
definitions cannot drift.
"""
from __future__ import annotations
import importlib.util, os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "results")
CACHE = os.path.join(DATA, "cache")
for d in (DATA, OUT, CACHE):
    os.makedirs(d, exist_ok=True)

_spec = importlib.util.spec_from_file_location(
    "frs_common", os.path.join(os.path.dirname(HERE), "funding-rate-signals", "common.py"))
_frs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_frs)
rolling_pct_rank = _frs.rolling_pct_rank
wilder_atr = _frs.wilder_atr

# ---- §1 universe -----------------------------------------------------------
MAJORS = ["BTCUSDT", "ETHUSDT"]
ALTS = ["SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]
SYMBOLS = MAJORS + ALTS
TIERS = {"M": MAJORS, "A": ALTS}
ARMS = ["P1-M", "P1-A", "P2-M", "P2-A"]
ALPHA = 0.05 / 4

# ---- §2.4 windows (entry instant decides) ------------------------------------
FIT_END = pd.Timestamp("2025-08-01", tz="UTC")
HOLD_START, HOLD_END = FIT_END, pd.Timestamp("2026-08-01", tz="UTC")
TAIL_START, TAIL_END = HOLD_END, pd.Timestamp("2026-09-01", tz="UTC")

# ---- §3 funding state ------------------------------------------------------
PCT_WINDOW, PCT_MINP = 90, 45
PCT_HI, PCT_LO = 0.90, 0.10
FLOOR = 0.0003
VENUE_STALE = pd.Timedelta(hours=16)
VENUES = ["binance", "bybit", "okx"]
SOL_BLACKOUT = (pd.Timestamp("2022-11-09 20:00", tz="UTC"),
                pd.Timestamp("2022-11-18 16:00", tz="UTC"))

# ---- §3 / §4 observables ---------------------------------------------------
W15 = 96                        # 24 h of 15m bars
FH_ATR = 0.5
OI_LAG = pd.Timedelta(minutes=5)
OI_STALE = pd.Timedelta(minutes=15)
P1_OI, P2_OI = 0.05, 0.03
P2_FLAT = -0.01
COMP_ATR = 1.0
ARM_BARS_4H = 8                 # armed window 32 h
ARM_WINDOW = pd.Timedelta(hours=32)
P2_VOL_Q = 0.70

# ---- §5 / §6 trade template -------------------------------------------------
STOP_ATR_BUF = 0.2
TIME_STOP = pd.Timedelta(days=5)
COST_RT = 0.001
TARGETS = {"T1R": 1.0, "T3R": 3.0, "TVWAP": None}

SEED = 20260928
N_PLACEBO = 1000
N_BOOT = 2000
FLOOR_N_FIT = 60
N_HOLD_MIN = 150
SCREEN_MEAN = 0.05
SCREEN_MARGIN = 0.05
BUILD_MEAN = 0.10

NS_MIN = 60_000_000_000
NS_15M = 15 * NS_MIN
NS_H = 60 * NS_MIN


def tier_of(sym: str) -> str:
    return "M" if sym in MAJORS else "A"


def ns(ts) -> int:
    return int(pd.Timestamp(ts).value)


def day_block_boot(values, days, draws=N_BOOT, seed=SEED):
    """90 % interval of the mean, whole UTC days resampled with replacement."""
    v = np.asarray(values, float)
    d = np.asarray(days)
    if len(v) < 2:
        return np.nan, np.nan
    uniq, inv = np.unique(d, return_inverse=True)
    sums = np.bincount(inv, weights=v, minlength=len(uniq))
    cnts = np.bincount(inv, minlength=len(uniq)).astype(float)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(uniq), size=(draws, len(uniq)))
    means = sums[idx].sum(1) / cnts[idx].sum(1)
    lo, hi = np.percentile(means, [5, 95])
    return float(lo), float(hi)


def diff_boot(v1, d1, v2, d2, draws=N_BOOT, seed=SEED):
    """90 % interval of mean(v1) - mean(v2), days resampled independently."""
    out = []
    rng = np.random.default_rng(seed)
    parts = []
    for v, d in ((v1, d1), (v2, d2)):
        v, d = np.asarray(v, float), np.asarray(d)
        if len(v) < 1:
            return np.nan, np.nan
        u, inv = np.unique(d, return_inverse=True)
        parts.append((np.bincount(inv, weights=v, minlength=len(u)),
                      np.bincount(inv, minlength=len(u)).astype(float), len(u)))
    for s, c, n in parts:
        idx = rng.integers(0, n, size=(draws, n))
        out.append(s[idx].sum(1) / c[idx].sum(1))
    diff = out[0] - out[1]
    lo, hi = np.percentile(diff, [5, 95])
    return float(lo), float(hi)


def tstat(x):
    x = np.asarray(x, float)
    x = x[~np.isnan(x)]
    if len(x) < 2 or x.std(ddof=1) == 0:
        return np.nan
    return float(x.mean() / (x.std(ddof=1) / np.sqrt(len(x))))
