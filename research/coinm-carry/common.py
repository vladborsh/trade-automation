"""Shared plumbing for the COIN-M inverse cash-and-carry pass.

Pre-registration: `research/hedged-carry/ARCHITECT-NOTE-SUCCESSORS.md` §1.4,
§2.3, restated mechanically in `DESIGN.md`.  Self-contained: this package pulls
its own COIN-M, spot and funding tapes and depends on nothing outside
pandas/numpy.
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
QDATA = os.path.join(DATA, "q")
OUT = os.path.join(HERE, "results")
for d in (DATA, QDATA, OUT):
    os.makedirs(d, exist_ok=True)

# ---- universe (note §1.4 "Universe": BTC and ETH only) ---------------------
PERPS = ["BTCUSD_PERP", "ETHUSD_PERP"]
SPOT_OF = {"BTCUSD_PERP": "BTCUSDT", "ETHUSD_PERP": "ETHUSDT"}
PAIR_OF = {"BTCUSD_PERP": "BTCUSD", "ETHUSD_PERP": "ETHUSD"}
# contract multipliers, asserted from GET /dapi/v1/exchangeInfo (DESIGN §0.3)
CONTRACT_SIZE = {"BTCUSD": 100.0, "ETHUSD": 10.0}
# maintenance-margin rate, bracket 1, from the published COIN-M bracket table
MMR = {"BTCUSD": 0.004, "ETHUSD": 0.005}

# ---- windows (note §1.4 "Split") -------------------------------------------
FIT_END = pd.Timestamp("2024-08-01", tz="UTC")      # exclusive
HOLD_START = pd.Timestamp("2024-08-01", tz="UTC")
HOLD_END = pd.Timestamp("2026-08-01", tz="UTC")     # exclusive
TAIL_START = HOLD_END
TAIL_END = pd.Timestamp("2026-09-01", tz="UTC")     # exclusive
WARMUP_DAYS = 3                                     # 9 settlements

# ---- the funding-gate OVERLAY (fit-only, non-gating; note §1.4 "Arm A") ----
F9_WINDOW = 9            # settlements (3 days)
ON_LEVEL = 0.0002        # 0.02 %/8h
OFF_LEVEL = 0.00005      # 0.005 %/8h

# ---- sizing (note §1.4 "Account structure") --------------------------------
C_TIER = 100.0
SLOTS = 2
BUFFER_FRAC = 0.05       # b = 0.05 N, held as USD cash

# ---- costs (DESIGN §4; verified 2026-09-17) --------------------------------
SPOT_FEE = 0.0010        # Binance spot taker, VIP 0
CM_FEE = 0.0005          # Binance COIN-M taker, VIP 0 (NO BNB discount)
CM_MAKER = 0.0002        # COIN-M maker, VIP 0 (fit-only sensitivity)
SLIP = 0.0002            # per fill
SWEEP_COST = SPOT_FEE + SLIP    # 0.12 % on each coin<->USD sweep
# one round trip (4 fills) on notional N:
RT_COST = 2 * (SPOT_FEE + CM_FEE) + 4 * SLIP        # 0.0038

BASIS_ANOM = 0.05        # |b| > 5 % -> bar absent on both legs
MAX_ABSENT_HOURS = 24

# ---- arm B (note §2.3) ------------------------------------------------------
QB_THRESHOLD = 0.10      # annualised basis >= 10 % p.a. to enter
QB_MIN_DAYS = 14         # >= 14 days to expiry
QB_SENS = (0.07, 0.15)


def load_cm_funding(symbol: str, source: str = "merged") -> pd.DataFrame:
    """source in {'archive','rest','merged'}.

    'merged' is the PRIMARY stream: the archive where it exists
    (2022-07 .. 2026-06) and REST outside it, after `data_audit.py` has
    asserted the two identical on the overlap.
    """
    a = pd.read_csv(os.path.join(DATA, f"{symbol}-cmfund-archive.csv.gz"))
    a["ts"] = pd.to_datetime(a["ts"], utc=True)
    a["last_funding_rate"] = pd.to_numeric(a["last_funding_rate"], errors="coerce")
    a["funding_interval_hours"] = pd.to_numeric(a["funding_interval_hours"],
                                                errors="coerce")
    a = a.drop_duplicates("ts", keep="last").sort_values("ts")
    r = pd.read_csv(os.path.join(DATA, f"{symbol}-cmfund-rest.csv.gz"))
    r["ts"] = pd.to_datetime(r["ts"], utc=True)
    r["last_funding_rate"] = pd.to_numeric(r["last_funding_rate"], errors="coerce")
    r = r.drop_duplicates("ts", keep="last").sort_values("ts")
    if source == "archive":
        return a.reset_index(drop=True)
    if source == "rest":
        return r.reset_index(drop=True)
    # UNION, archive preferred where both carry a timestamp.  The monthly
    # archive file omits the last 2-3 settlements of each month (DESIGN §3.3
    # rule 2); REST supplies them, and every SHARED timestamp is identical to
    # 0.0 (Stage-0 gate G1).
    out = pd.concat([a[["ts", "last_funding_rate"]],
                     r[["ts", "last_funding_rate"]]], ignore_index=True)
    return out.drop_duplicates("ts", keep="first").sort_values("ts").reset_index(drop=True)


def load_um_funding(spot_symbol: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(DATA, f"{spot_symbol}-umfund.csv.gz"))
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df["last_funding_rate"] = pd.to_numeric(df["last_funding_rate"], errors="coerce")
    return df.drop_duplicates("ts", keep="last").sort_values("ts").reset_index(drop=True)


def load_klines(name: str, kind: str) -> pd.DataFrame:
    """kind in {'cm1h','spot1h','q1h'}."""
    if kind == "q1h":
        p = os.path.join(QDATA, f"{name}-1h.csv.gz")
    else:
        p = os.path.join(DATA, f"{name}-{kind}.csv.gz")
    df = pd.read_csv(p)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    for c in ("open", "high", "low", "close", "volume"):
        if c in df:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.drop_duplicates("ts", keep="last").sort_values("ts").reset_index(drop=True)


def block_bootstrap_p(daily: np.ndarray, block: int = 10, draws: int = 2000,
                      seed: int = 20260917):
    """10-day block bootstrap on the daily tier return series.
    Returns (p_one_sided_mean_le_0, lo90, hi90, se) of the ANNUALISED mean."""
    r = np.asarray(daily, float)
    n = len(r)
    if n < block * 2:
        return np.nan, np.nan, np.nan, np.nan
    rng = np.random.default_rng(seed)
    nb = int(np.ceil(n / block))
    starts = rng.integers(0, n - block + 1, size=(draws, nb))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]
           ).reshape(draws, -1)[:, :n]
    means = r[idx].mean(axis=1) * 365.0
    p = float((means <= 0).mean())
    lo, hi = np.percentile(means, [5, 95])
    return p, float(lo), float(hi), float(means.std(ddof=1))


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
