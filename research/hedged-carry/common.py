"""Shared plumbing for the hedged spot-perp carry pass (ARCHITECT-NOTE §1-§5).

Self-contained: this package pulls its own spot, perp and funding tapes and
depends on nothing outside pandas/numpy.
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "results")
for d in (DATA, OUT):
    os.makedirs(d, exist_ok=True)

# ---- §7.1 universe ---------------------------------------------------------
MAJORS = ["BTCUSDT", "ETHUSDT"]
ALTS = ["SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]
SYMBOLS = MAJORS + ALTS
TIERS = {"majors": MAJORS, "alts": ALTS}

# ---- §3.4 windows ----------------------------------------------------------
FIT_END = pd.Timestamp("2024-08-01", tz="UTC")      # exclusive
HOLD_START = pd.Timestamp("2024-08-01", tz="UTC")
HOLD_END = pd.Timestamp("2026-08-01", tz="UTC")     # exclusive
TAIL_START = HOLD_END
TAIL_END = pd.Timestamp("2026-09-01", tz="UTC")     # exclusive
WARMUP_DAYS = 3                                     # 9 settlements

# ---- §1.2 the funding gate -------------------------------------------------
F9_WINDOW = 9            # settlements (3 days)
ON_LEVEL = 0.0002        # 0.02 %/8h
OFF_LEVEL = 0.00005      # 0.005 %/8h

# ---- §1.4 sizing -----------------------------------------------------------
C_TIER = 100.0
SLOTS = {"majors": 2, "alts": 6}

# ---- §2 margin -------------------------------------------------------------
LEV = 2.0
MMR = 0.01
LIQ_FEE = 0.01
RC_FRAC = 0.5            # re-centre at half the buffer


def x_liq_of(lev: float, f_over_n: float = 0.0, mmr: float = MMR) -> float:
    """§2.3: x_liq = (M/N + F/N - mmr) / (1 + mmr), M/N = 1/L."""
    return (1.0 / lev + f_over_n - mmr) / (1.0 + mmr)


# ---- §4 costs --------------------------------------------------------------
SPOT_FEE = 0.0010        # taker, VIP 0
PERP_FEE = 0.0005        # taker, VIP 0
SLIP = 0.0002            # per fill
# one round trip (4 fills) on notional N:
RT_COST = 2 * (SPOT_FEE + PERP_FEE) + 4 * SLIP      # 0.0038

# ---- §3.3 rule 3: SOL FTX-week blackout ------------------------------------
SOL_BLACKOUT = (pd.Timestamp("2022-11-09 20:00", tz="UTC"),
                pd.Timestamp("2022-11-18 16:00", tz="UTC"))   # [start, end)
SOL_LAST_BAR_BEFORE = pd.Timestamp("2022-11-09 19:00", tz="UTC")

BASIS_ANOM = 0.05        # §3.2 |b| > 5 % -> bar absent on both legs
MAX_ABSENT_HOURS = 24    # §3.2


def load_funding(symbol: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(DATA, f"{symbol}-funding.csv.gz"))
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df["last_funding_rate"] = pd.to_numeric(df["last_funding_rate"],
                                            errors="coerce")
    df["funding_interval_hours"] = pd.to_numeric(df["funding_interval_hours"],
                                                 errors="coerce")
    df = df.sort_values("ts")
    df["dup"] = df.duplicated(subset="ts", keep=False)
    n_dup = int(df["dup"].sum())
    df = df.drop_duplicates(subset="ts", keep="last").reset_index(drop=True)
    df.attrs["n_dup_rows"] = n_dup
    return df


def load_klines(symbol: str, leg: str) -> pd.DataFrame:
    """leg in {'perp1h','spot1h'}."""
    df = pd.read_csv(os.path.join(DATA, f"{symbol}-{leg}.csv.gz"))
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.drop_duplicates(subset="ts", keep="last")
    return df.sort_values("ts").reset_index(drop=True)


def blackout_mask(symbol: str, ts) -> np.ndarray:
    ts = pd.DatetimeIndex(ts)
    if symbol != "SOLUSDT":
        return np.zeros(len(ts), bool)
    a, b = SOL_BLACKOUT
    return ((ts >= a) & (ts < b)).values


def settlement_grid(first, last, interval_h: int = 8) -> pd.DatetimeIndex:
    return pd.date_range(first, last, freq=f"{interval_h}h", tz="UTC")


def block_bootstrap_p(daily: np.ndarray, block: int = 10, draws: int = 2000,
                      seed: int = 20260916):
    """§6.3: 10-day block bootstrap on the daily tier return series.

    Returns (p_one_sided_mean_le_0, lo90, hi90) of the ANNUALISED mean."""
    r = np.asarray(daily, float)
    n = len(r)
    if n < block * 2:
        return np.nan, np.nan, np.nan
    rng = np.random.default_rng(seed)
    nb = int(np.ceil(n / block))
    starts = rng.integers(0, n - block + 1, size=(draws, nb))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(draws, -1)[:, :n]
    means = r[idx].mean(axis=1) * 365.0
    p = float((means <= 0).mean())
    lo, hi = np.percentile(means, [5, 95])
    return p, float(lo), float(hi)


def ann_mean(daily) -> float:
    return float(np.mean(daily) * 365.0)


def max_drawdown(daily) -> float:
    eq = np.cumsum(np.asarray(daily, float))
    peak = np.maximum.accumulate(np.concatenate([[0.0], eq]))[1:]
    return float(np.max(peak - eq))


def sharpe(daily) -> float:
    r = np.asarray(daily, float)
    s = r.std(ddof=1)
    return float(r.mean() / s * np.sqrt(365.0)) if s > 0 else np.nan


def lag1_autocorr(daily) -> float:
    r = np.asarray(daily, float)
    if len(r) < 3:
        return np.nan
    return float(np.corrcoef(r[:-1], r[1:])[0, 1])
