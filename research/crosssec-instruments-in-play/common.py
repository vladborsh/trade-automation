"""Shared plumbing and every pre-registered constant for the cross-sectional
"instruments in play" pass.

Canonical spec: `ARCHITECT-NOTE.md` (this package, 2026-09-16, commit 02c1a96)
and its mechanical restatement `DESIGN.md`. Where this file and `DESIGN.md`
disagree, `DESIGN.md` is the pre-registration and this file is the bug.

Nothing here is tuned. Every constant was fixed by the Architect's note
before any R existed on any row.

The NYSE calendar and the DST-aware NY clock are carried from
`research/orb-ny-open/common.py` and extended back to 2020 (this family's fit
period starts in 2020, that package's in 2022).
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(HERE, "data")
DATA_1D = os.path.join(DATA, "1d")
DATA_1M = os.path.join(DATA, "1m")
DATA_FUND = os.path.join(DATA, "funding")
RESULTS = os.path.join(HERE, "results")
# the already-audited BTC/ETH tapes the new puller is validated against (§8.2.1)
# The audited tapes are gitignored, so they live in the main checkout rather
# than in this git worktree; ORCA_MAIN_REPO overrides.
AUDITED = os.environ.get("AUDITED_TAPES", os.path.join(REPO, "research", "cmc-bot-vwap", "data"))
if not os.path.isdir(AUDITED):
    _alt = "/Users/Vladyslav_Borsh/Documents/trade_automation/research/cmc-bot-vwap/data"
    if os.path.isdir(_alt):
        AUDITED = _alt
for d in (DATA, DATA_1D, DATA_1M, DATA_FUND, RESULTS):
    os.makedirs(d, exist_ok=True)

MIN_MS = 60_000
DAY_MS = 86_400_000
SESSION_TZ = "America/New_York"

# ------------------------------------------------------------ §3 the anchor
ANCHOR_NY = (9, 30)               # 09:30 America/New_York, DST-aware
WINDOW_MIN = 30                   # [A, A+30) — selector window and reader window
HORIZON_MIN = 240                 # entry + 4 h  ->  exit at A + 4 h 30 min
# fit-only placebo anchors (§3.3), expressed as fixed UTC hours
PLACEBO_UTC = (0, 4)

# --------------------------------------------------- §1.3 per-day eligibility
MIN_LISTED_DAYS = 30
RVOL_LOOKBACK = 14                # prior anchor days for the RVOL denominator
RVOL_MIN_DAYS = 10                # of the 14, at least this many must be present
LIQ_LOOKBACK = 14                 # complete UTC days for the liquidity median
LIQ_FLOOR = 10_000_000.0          # USDT median daily quote volume (causal)
LIQ_FLOOR_SENS = 50_000_000.0     # fit-only sensitivity
N_ELIG_MIN = 50                   # a day is tradable iff >= 50 eligible symbols
MAX_MISSING_PATH_MIN = 30         # §5.3: a path with more than this is excluded

# ------------------------------------------------------------- §2 selectors
K_SELECT = 5                      # top-5 / bottom-5 / middle-5
K_SENS = (3, 10)                  # fit-only
TR_HOURS = 24                     # selector B window; 12/48 fit-only
TR_HOURS_SENS = (12, 48)
PRICE_TOL_MIN = 5                 # P(t) = close of last bar opening in [t-5min, t)

# ----------------------------------------------------- §5 stop / exit ladder
STOP_GATE = 0.5                   # x dATR14 — THE gating cell, never moves
STOP_SENS = (0.25, 1.0, 0.10)     # fit-only (0.10 = the 2024 paper's stop)
ATR_N = 14
HORIZON_SENS_MIN = (120,)         # fit-only +2 h; plus the 16:00 NY row

# ------------------------------------------------------------------ §6 costs
BINANCE_RT = 0.0010               # 0.10 % round trip taker — gating
BINANCE_RT_SENS = (0.0004, 0.0020)  # maker / thin-book, fit-only
FUNDING_UTC_HOUR = 16             # the settlement every trade crosses

# ------------------------------------------------------------------ §7 split
FIT_START, FIT_END = "2020-01-01", "2025-07-31"
HOLD_START, HOLD_END = "2025-08-01", "2026-07-31"
FWD_START, FWD_END = "2026-08-01", "2026-10-31"   # NOT read in this pass

# ----------------------------------------------------------------- §10 ladder
N_ARMS = 2
ALPHA = 0.05 / N_ARMS             # 0.025 — this family's own count
MIN_LEGS = 150
MIN_TRADE_DAYS = 150
KILL_MEAN = 0.05
BUILD_MEAN = 0.10
P_INCONCLUSIVE = 0.20
SCREEN_MEAN = 0.05                # §10.1 fit screen
SCREEN_P = 0.05
FWD_MEAN, FWD_P = 0.05, 0.05      # §7.3 forward confirmation
FWD_MIN_DAYS, FWD_MIN_LEGS = 60, 250
# prior use of the holdout window, declared verbatim (§7.1)
LEDGER_PRIOR = dict(orb_arms_registered=22, orb_arms_read=11, crypto_reads=4,
                    cmc_bot_crypto_reads=2)

# ------------------------------------------------------------------- §2.3 nulls
SEED = 20260916
N_RANDOM_K = 1000                 # Null A — random-5 draws, supplies p
N_DAYSHIFT = 250                  # Null B — selection day-shift
N_BOOT = 2000
BOOT_LO, BOOT_HI = 5.0, 95.0      # 90 % interval

# ==========================================================================
# NYSE calendar — §3.1.  Full-day closures, from the NYSE published calendar.
# 2022-2026 verbatim from research/orb-ny-open/common.py; 2020-2021 added.
# ==========================================================================
NYSE_HOLIDAYS = [
    # 2020
    "2020-01-01", "2020-01-20", "2020-02-17", "2020-04-10", "2020-05-25",
    "2020-07-03", "2020-09-07", "2020-11-26", "2020-12-25",
    # 2021
    "2021-01-01", "2021-01-18", "2021-02-15", "2021-04-02", "2021-05-31",
    "2021-07-05", "2021-09-06", "2021-11-25", "2021-12-24",
    # 2022
    "2022-01-17", "2022-02-21", "2022-04-15", "2022-05-30", "2022-06-20",
    "2022-07-04", "2022-09-05", "2022-11-24", "2022-12-26",
    # 2023
    "2023-01-02", "2023-01-16", "2023-02-20", "2023-04-07", "2023-05-29",
    "2023-06-19", "2023-07-04", "2023-09-04", "2023-11-23", "2023-12-25",
    # 2024
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27",
    "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
    # 2025  (2025-01-09: National Day of Mourning, President Carter)
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18",
    "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27",
    "2025-12-25",
    # 2026
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]

# 1:00 pm ET early closes — excluded as full days (§3.1), because the
# A + 4 h 30 min exit (14:00 NY) does not exist on them.
NYSE_EARLY_CLOSES = [
    "2020-11-27", "2020-12-24",
    "2021-11-26",
    "2022-11-25",
    "2023-07-03", "2023-11-24",
    "2024-07-03", "2024-11-29", "2024-12-24",
    "2025-07-03", "2025-11-28", "2025-12-24",
    "2026-11-27", "2026-12-24",
]

NYSE_EXCLUDED = set(NYSE_HOLIDAYS) | set(NYSE_EARLY_CLOSES)


def nyse_days(start: str, end: str) -> list[str]:
    """Full NYSE trading days (weekday, not a holiday, not an early close)."""
    d = pd.date_range(start, end, freq="D")
    d = d[d.dayofweek <= 4]
    return [x for x in d.strftime("%Y-%m-%d") if x not in NYSE_EXCLUDED]


def weekend_days(start: str, end: str) -> list[str]:
    d = pd.date_range(start, end, freq="D")
    return list(d[d.dayofweek >= 5].strftime("%Y-%m-%d"))


def ny_ms(date_str: str, hh: int = 9, mm: int = 30) -> int:
    """NY wall-clock hh:mm on NY calendar date `date_str` as epoch ms.
    DST-aware; verbatim convention from orb-ny-open/common.py:ny_ms."""
    y, m, d = (int(x) for x in date_str.split("-"))
    return int(pd.Timestamp(year=y, month=m, day=d, hour=hh, minute=mm,
                            tz=SESSION_TZ).value // 10 ** 6)


def utc_ms(date_str: str, hh: int = 0, mm: int = 0) -> int:
    y, m, d = (int(x) for x in date_str.split("-"))
    return int(pd.Timestamp(year=y, month=m, day=d, hour=hh, minute=mm,
                            tz="UTC").value // 10 ** 6)


def period_of(dates) -> np.ndarray:
    """Split label by the NY calendar date of the anchor (§7.1). Never re-cut."""
    d = pd.to_datetime(pd.Series(np.asarray(dates)))
    out = np.full(len(d), "pre", dtype=object)
    out[(d >= FIT_START) & (d <= FIT_END)] = "fit"
    out[(d >= HOLD_START) & (d <= HOLD_END)] = "holdout"
    out[(d >= FWD_START) & (d <= FWD_END)] = "forward"
    return out


# ==========================================================================
# Wilder ATR — verbatim from research/orb-utc0-crypto/indicators.py
# ==========================================================================
def wilder_rma(x: np.ndarray, k: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    v = x[~np.isnan(x)]
    if len(v) < k:
        return out
    off = int(np.argmax(~np.isnan(x)))
    out[off + k - 1] = x[off:off + k].mean()
    for i in range(off + k, len(x)):
        out[i] = (out[i - 1] * (k - 1) + x[i]) / k
    return out


def atr_wilder(h, l, c, k=ATR_N) -> np.ndarray:
    tr = np.full(len(h), np.nan)
    tr[1:] = np.maximum(h[1:] - l[1:],
                        np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    return wilder_rma(tr, k)


def cost_R(entry, dist, rt=BINANCE_RT):
    """§6.1 — Binance USD-M taker round trip on notional, over stop_dist.
    Identical to orb-ny-open/engine.py:cost_R, Binance branch."""
    return rt * np.asarray(entry, float) / np.asarray(dist, float)


def fmt(t_ms) -> str:
    return pd.Timestamp(int(t_ms), unit="ms", tz="UTC").tz_convert(SESSION_TZ) \
        .strftime("%Y-%m-%d %H:%M %Z")


__all__ = [n for n in dir() if not n.startswith("_")]
