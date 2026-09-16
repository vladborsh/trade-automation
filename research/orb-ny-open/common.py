"""Shared plumbing for the ORB NY-open pass.

Canonical spec: `ARCHITECT-NOTE.md` (this package, 2026-09-16, commit 7ff19fc)
and its mechanical restatement `DESIGN.md`. Where this file and `DESIGN.md`
disagree, `DESIGN.md` is the pre-registration and this file is the bug.

Nothing here is tuned. Every constant below was fixed by the Architect's note
before any R existed on any arm.

Data: the cached, audited 1-minute tapes of the sibling package
`research/cmc-bot-vwap/data/` (Capital.com mids for the indices via
`prep_data.py`, Binance USD-M perps for crypto). This package **reads** them
and never copies or rewrites them (ARCHITECT-NOTE §3.1).
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC_DATA = os.path.join(REPO, "research", "cmc-bot-vwap", "data")
DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")
os.makedirs(DATA, exist_ok=True)
os.makedirs(RESULTS, exist_ok=True)

MIN_MS = 60_000
DAY_MS = 86_400_000
SESSION_TZ = "America/New_York"

# ---------------------------------------------------------------- §1 mechanic
OR_START = (9, 30)                 # opening range start, NY wall clock
OR_END = (10, 0)                   # opening range end, exclusive
OR_BINS = 6                        # six 5-minute bins must each hold >=1 1m bar
TRIG_START = (10, 0)               # first eligible trigger bar opens here
TRIG_END_BASE = (12, 0)            # base cutoff, exclusive (ARCHITECT-NOTE §1.3)
TRIG_END_WIDE = (13, 30)           # the one pre-registered contingency, §4.5
FLAT = (16, 0)                     # forced flat, NY wall clock

TFS = (5, 15)                      # the two timeframes, in minutes
INSTRUMENTS = ("US100", "US500", "BTCUSDT", "ETHUSDT")
VENUE = {"US100": "cc", "US500": "cc", "BTCUSDT": "bn", "ETHUSDT": "bn"}

# non-gating, fit-only OR-width sensitivities (§1.2)
OR_WIDTH_SENS = (15, 60)

# ---------------------------------------------------------------- §3.3 split
FIT_START, FIT_END = "2024-01-01", "2025-07-31"
HOLD_START, HOLD_END = "2025-08-01", "2026-07-31"
TAIL_START, TAIL_END = "2026-08-01", "2026-09-11"
PREETF_START, PREETF_END = "2022-08-01", "2023-12-31"

# ---------------------------------------------------------------- §4.4 ladder
N_ARMS = 8
ALPHA = 0.05 / N_ARMS              # 0.00625
MIN_TRADES = 150
KILL_MEAN = 0.05
BUILD_MEAN = 0.10
P_INCONCLUSIVE = 0.20

# ---------------------------------------------------------------- §4.3 nulls
SEED = 20260916
N_PERM_A = 1000
N_PERM_B = 250
N_BOOT = 2000
BOOT_LO, BOOT_HI = 5.0, 95.0       # 90 % interval

# ---------------------------------------------------------------- §4.2 costs
BINANCE_RT = 0.0010                # 0.10 % round trip (2 x 5 bp taker)
BINANCE_RT_SENS = 0.0004           # maker, non-gating sensitivity

# ---------------------------------------------------------------- §6.2 Study B
LGB_PARAMS = dict(
    objective="regression_l2",
    num_leaves=7,
    max_depth=3,
    min_data_in_leaf=30,
    learning_rate=0.03,
    feature_fraction=0.8,
    bagging_fraction=0.8,
    bagging_freq=1,
    lambda_l2=10.0,
    cat_smooth=10,
    verbose=-1,
)
LGB_N_EST_CAP = 2000
LGB_PATIENCE = 100
LGB_FOLDS = 5
LGB_PURGE_SESSIONS = 5
LGB_SEEDS = (0, 1, 2, 3, 4)
PERM_SHUFFLES = 100
NULL_REFITS = 200
NULL_PCTL = 95.0

# ==========================================================================
# NYSE calendar — ARCHITECT-NOTE §1.1
# ==========================================================================
# Full-day closures, verbatim from the NYSE published holiday calendar.
# Covers 2022-2026 because the crypto pre-ETF control row (§2.3) reaches back
# to 2022-08-01.
NYSE_HOLIDAYS = [
    # 2022
    "2022-01-17", "2022-02-21", "2022-04-15", "2022-05-30", "2022-06-20",
    "2022-07-04", "2022-09-05", "2022-11-24", "2022-12-26",
    # 2023
    "2023-01-02", "2023-01-16", "2023-02-20", "2023-04-07", "2023-05-29",
    "2023-06-19", "2023-07-04", "2023-09-04", "2023-11-23", "2023-12-25",
    # 2024
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27",
    "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
    # 2025  (2025-01-09: National Day of Mourning, President Carter — NYSE closed)
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18",
    "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27",
    "2025-12-25",
    # 2026
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]

# 1:00 pm ET early closes. Excluded as full days (§1.1) because the 16:00 NY
# forced flat does not exist on them.
NYSE_EARLY_CLOSES = [
    "2022-11-25",
    "2023-07-03", "2023-11-24",
    "2024-07-03", "2024-11-29", "2024-12-24",
    "2025-07-03", "2025-11-28", "2025-12-24",
    "2026-11-27", "2026-12-24",
]

NYSE_EXCLUDED = set(NYSE_HOLIDAYS) | set(NYSE_EARLY_CLOSES)


def nyse_days(start: str, end: str) -> list[str]:
    """Full NYSE trading days (weekday, not a holiday, not an early close) as
    'YYYY-MM-DD' NY calendar dates."""
    d = pd.date_range(start, end, freq="D")
    d = d[d.dayofweek <= 4]
    s = d.strftime("%Y-%m-%d")
    return [x for x in s if x not in NYSE_EXCLUDED]


def weekend_days(start: str, end: str) -> list[str]:
    """Saturdays and Sundays — the crypto weekend control row (§2.3)."""
    d = pd.date_range(start, end, freq="D")
    return list(d[d.dayofweek >= 5].strftime("%Y-%m-%d"))


def ny_ms(date_str: str, hh: int, mm: int) -> int:
    """NY wall-clock hh:mm on the NY calendar date `date_str`, as epoch ms.
    DST-aware; mirrors `research/cmc-bot-vwap/common.py:ny_window_utc_ms`."""
    y, m, d = (int(x) for x in date_str.split("-"))
    return int(pd.Timestamp(year=y, month=m, day=d, hour=hh, minute=mm,
                            tz=SESSION_TZ).value // 10 ** 6)


def period_of(dates: np.ndarray) -> np.ndarray:
    """Split label by NY session date (§3.3). Never re-cut."""
    d = pd.to_datetime(pd.Series(dates))
    out = np.full(len(d), "pre", dtype=object)
    out[(d >= PREETF_START) & (d <= PREETF_END)] = "pre-etf"
    out[(d >= FIT_START) & (d <= FIT_END)] = "fit"
    out[(d >= HOLD_START) & (d <= HOLD_END)] = "holdout"
    out[(d >= TAIL_START) & (d <= TAIL_END)] = "tail"
    return out


# ==========================================================================
# Tapes
# ==========================================================================
def load_1m(symbol: str) -> pd.DataFrame:
    """The sibling package's prepared 1m frame. Read-only."""
    df = pd.read_parquet(os.path.join(SRC_DATA, f"{symbol}_1m.parquet"))
    df = df.drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)
    return df


def resample(df: pd.DataFrame, tf_min: int) -> pd.DataFrame:
    """ARCHITECT-NOTE §3.2 — bins of `tf_min` minutes on the UTC quarter-hour
    grid (epoch-aligned, hence identical to the NY-anchored grid under either
    DST offset, §1.1), labelled by OPEN time.

      open  = first 1m open      high = max      low = min
      close = last 1m close      volume = sum
      spread_close = the bin's LAST 1m bar's spread_close

    A bin with no 1m bar is ABSENT — not forward-filled, not zero-filled.
    """
    step = tf_min * MIN_MS
    b = (df.t_ms.values // step) * step
    g = df.groupby(b, sort=True)
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    if "spread_close" in df.columns:
        agg["spread_close"] = "last"
    out = g.agg(agg)
    out.index.name = "t_ms"
    out = out.reset_index()
    # Positional index into the 1m frame of the bin's last / first 1m bar.
    # `df` is sorted and RangeIndexed, and the bins are contiguous in it, so a
    # running count is exact. Needed for the entry minute's spread and for the
    # 1m path walk (§1.5).
    sz = g.size().values.astype(np.int64)
    out["i_last"] = np.cumsum(sz) - 1
    out["i_first"] = np.cumsum(sz) - sz
    return out


def fmt(t_ms) -> str:
    return pd.Timestamp(int(t_ms), unit="ms", tz="UTC").tz_convert(SESSION_TZ) \
        .strftime("%Y-%m-%d %H:%M %Z")


__all__ = [n for n in dir() if not n.startswith("_")]
