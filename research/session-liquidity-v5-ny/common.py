"""Shared plumbing for the session-liquidity **v5-NY** pass.

Canonical spec: `knowledge/session-liquidity.md` (authoritative for every
inherited definition) and this package's `DESIGN.md` (the PRE-REGISTRATION —
written and committed before any result existed).

This file is a FORK of `research/session-liquidity-bos/common.py` and is
**behaviourally identical to it** for everything it inherits: sessions,
blocks, block-scoped horizon geometry, level admission, ATR units and the k=3
fractal pivot layer. It is forked rather than imported so this package stands
alone and an edit here can never reach back into v2/v3/v4/BoS.

What is ADDED here, all of it pinned by `DESIGN.md` §2 / §4 / §5:

  * `NY_WIN_*`   — the 09:40-11:20 New York window at a FIXED UTC offset
                   (DESIGN §2.2). Primary UTC-4; UTC-5 kept as a sensitivity.
  * `H24_BARS`   — the 24h secondary measurement horizon (DESIGN §2.1).
  * `FIT_END` / `HOLDOUT_START` — the chronological split (DESIGN §5).
  * `COST_ROUNDTRIP` — the 0.10% round-trip cost model (DESIGN §4).

Data (DESIGN §1.1): Binance USD-M perp 5m klines, 2022-08-01 .. 2026-07-31,
reached through the `data/` symlinks. BTC/ETH/SOL point at
`research/intraday-mr-smc/data/`; BNB was re-pulled from the identical public
archive because no local copy existed in this worktree.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
V1 = os.path.join(REPO, "research", "intraday-mr-smc")
if V1 not in sys.path:
    sys.path.insert(0, V1)

from indicators import atr, fractals  # noqa: E402  the real, un-reimplemented primitives

DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")
VIZ = os.path.join(HERE, "viz")
GALLERY_NY = os.path.join(RESULTS, "gallery_ny")
os.makedirs(RESULTS, exist_ok=True)
os.makedirs(VIZ, exist_ok=True)
os.makedirs(GALLERY_NY, exist_ok=True)

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
# DESIGN §2.3: the report body, every chart and the gallery foreground these
# two; SOL/BNB are computed identically and reported in the robustness
# appendix. The pre-registered test of DESIGN §3 runs on this pair pooled.
FOREGROUND = ["BTCUSDT", "ETHUSDT"]

# knowledge/session-liquidity.md §1: four contiguous, NON-OVERLAPPING UTC
# blocks partitioning the day. (start_hour, end_hour), end exclusive.
BLOCKS = {
    "Asia":   (0, 8),
    "London": (8, 13),
    "NY":     (13, 21),
    "Late":   (21, 24),
}
BLOCK_ORDER = ["Asia", "London", "NY", "Late"]
LEVEL_SESSIONS = ["Asia", "London", "NY"]

BAR_MIN = 5
LOOKBACK_HOURS = 48      # V8: level lifetime, 48h from session close
ATR_N = 14

# V4: primary tables use events with at least this many bars left in the block.
MIN_BARS_REMAINING = 12  # 12 * 5m = 1h

TRUNCATION_PROBE_BARS = 24   # diagnostic only, never part of a definition
PIVOT_K = 3                  # DESIGN/knowledge §5.2 spec value, not a tunable
STALE_ANCHOR_BARS = int(LOOKBACK_HOURS * 60 / BAR_MIN)

# ==========================================================================
# DESIGN §2.2 — THE NY WINDOW, AS A FIXED UTC WINDOW
# ==========================================================================
# House convention is fixed UTC with no DST handling (24/7 crypto tape,
# knowledge §1). 09:40-11:20 New York is therefore mapped through ONE fixed
# offset, chosen in advance:
#
#   UTC-4 (EDT)  -> 13:40-15:20 UTC   <- PINNED PRIMARY (EDT covers ~8 months)
#   UTC-5 (EST)  -> 14:40-16:20 UTC   <- sensitivity row only
#
# CAVEAT, to be repeated in REPORT.md: a fixed UTC-4 window is NOT 09:40-11:20
# New York wall clock all year. During EST months it is really 08:40-10:20 NY.
# These numbers are a fixed 100-minute UTC window, not wall-clock precision
# around the 09:30 NYSE open.
NY_LOCAL_START_MIN = 9 * 60 + 40      # 09:40 New York
NY_LOCAL_END_MIN = 11 * 60 + 20       # 11:20 New York (exclusive)
NY_OFFSET_PRIMARY = -4                # EDT — pinned
NY_OFFSET_SENSITIVITY = -5            # EST — sensitivity row


def ny_window_utc_minutes(offset_h: int = NY_OFFSET_PRIMARY) -> tuple[int, int]:
    """The NY window expressed as [start, end) minutes-of-day in UTC."""
    return (NY_LOCAL_START_MIN - offset_h * 60,
            NY_LOCAL_END_MIN - offset_h * 60)


NY_WIN_UTC = ny_window_utc_minutes(NY_OFFSET_PRIMARY)          # (820, 920)
NY_WIN_UTC_EST = ny_window_utc_minutes(NY_OFFSET_SENSITIVITY)  # (880, 980)
NY_WIN_BARS = (NY_WIN_UTC[1] - NY_WIN_UTC[0]) // BAR_MIN       # 20 bars

# DESIGN §2.1 — the secondary long horizon: 24h from the TAKE-OUT bar.
H24_BARS = int(24 * 60 / BAR_MIN)      # 288

# DESIGN §5 — the chronological fit/holdout split, by take-out UTC date.
FIT_END = pd.Timestamp("2025-07-31 23:59:59", tz="UTC")
HOLDOUT_START = pd.Timestamp("2025-08-01 00:00:00", tz="UTC")

# DESIGN §4 — cost model: 0.10% round trip (2 x 5bp Binance USD-M taker).
COST_ROUNDTRIP = 0.001

# DESIGN §6 — null / bootstrap sizes, pinned so they are not tuned to a p-value.
N_PERM_A = 1000
N_PERM_B = 250
N_BOOT = 2000
SEED = 20260901


def load(sym: str, iv: str = "5m") -> pd.DataFrame:
    f = os.path.join(DATA, f"{sym}-{iv}.csv.gz")
    if not os.path.exists(f):
        raise SystemExit(f"missing {f} (see DESIGN.md §1.1 for the data note)")
    d = pd.read_csv(f)
    d["ts"] = pd.to_datetime(d["ts"], utc=True)
    return d.sort_values("ts").reset_index(drop=True)


def prep(d: pd.DataFrame) -> pd.DataFrame:
    """Attach the causal columns every downstream step needs.

    ATR(14) is read AS OF the bar it is attached to — never over the forward
    window — which is what keeps the unit causal.
    """
    d = d.copy()
    d["atr"] = atr(d, ATR_N)
    d["month"] = d["ts"].dt.strftime("%Y-%m")
    d["block"] = block_label_series(d["ts"])
    return d


def minute_of_day(ts: pd.Series) -> pd.Series:
    return ts.dt.hour * 60 + ts.dt.minute


def in_ny_window(minutes: np.ndarray, win: tuple[int, int] = NY_WIN_UTC) -> np.ndarray:
    """DESIGN §2.2's live filter, as a pure function of a bar's UTC open time.

    Deliberately depends on NOTHING but the clock: it can never look forward,
    and `checks.py` asserts that by re-deriving the flag from the timestamp
    column alone.
    """
    return (minutes >= win[0]) & (minutes < win[1])


def pivots(d: pd.DataFrame, k: int = PIVOT_K) -> dict[str, np.ndarray]:
    """k=3 fractal pivots, in the two forms the BoS anchor needs.

    `fractals(d, k)` returns flags ALREADY SHIFTED by k, i.e. the flag on bar
    `j` says "the pivot at bar `j - k` is now confirmed" — which is exactly
    knowledge §5.2's "the most recent pivot confirmed AS OF `t0`".
    """
    sh, sl = fractals(d, k)
    hi_conf = sh.fillna(False).to_numpy()
    lo_conf = sl.fillna(False).to_numpy()
    hi_px = d["high"].shift(k).where(pd.Series(hi_conf, index=d.index)).to_numpy()
    lo_px = d["low"].shift(k).where(pd.Series(lo_conf, index=d.index)).to_numpy()
    n = len(d)
    idx = np.arange(n)
    hi_bar = np.where(hi_conf, idx - k, -1)
    lo_bar = np.where(lo_conf, idx - k, -1)
    return dict(hi_conf=hi_conf, lo_conf=lo_conf, hi_px=hi_px, lo_px=lo_px,
                hi_bar=hi_bar, lo_bar=lo_bar)


def block_label_series(ts: pd.Series) -> pd.Series:
    """Vectorised block label. The partition is total: every bar has exactly
    one block."""
    h = ts.dt.hour
    out = pd.Series("Late", index=ts.index, dtype=object)
    out[h < 21] = "NY"
    out[h < 13] = "London"
    out[h < 8] = "Asia"
    return out


def block_arrays(d: pd.DataFrame) -> dict[str, np.ndarray]:
    """Per-bar block geometry — the backbone of the block-scoped horizon."""
    blk = d["block"].to_numpy()
    day = d["ts"].dt.floor("D").to_numpy()
    n = len(d)
    new = np.ones(n, dtype=bool)
    new[1:] = (blk[1:] != blk[:-1]) | (day[1:] != day[:-1])
    block_id = np.cumsum(new) - 1
    last_of_run = np.zeros(block_id[-1] + 1, dtype=np.int64)
    idx = np.arange(n)
    np.maximum.at(last_of_run, block_id, idx)
    block_end = last_of_run[block_id]
    bars_left = block_end - idx
    complete = block_id < block_id[-1]
    return dict(block_id=block_id, block_end=block_end,
                bars_left=bars_left, block_complete=complete)


def session_frames(d: pd.DataFrame) -> pd.DataFrame:
    """One row per (UTC date, level-producing session): high/low reached and
    the window bounds. V1: a level is usable only once its window has closed."""
    hours = d["ts"].dt.hour.to_numpy()
    day = d["ts"].dt.floor("D")
    rows = []
    for name in LEVEL_SESSIONS:
        h0, h1 = BLOCKS[name]
        m = (hours >= h0) & (hours < h1)
        sub = d.loc[m, ["ts", "high", "low"]].copy()
        sub["day"] = day[m]
        g = sub.groupby("day", sort=True)
        agg = g.agg(high=("high", "max"), low=("low", "min"),
                    t_start=("ts", "min"), t_end=("ts", "max")).reset_index()
        agg["session"] = name
        rows.append(agg)
    s = pd.concat(rows, ignore_index=True)
    idx_of_ts = pd.Series(np.arange(len(d)), index=d["ts"])
    s["end_idx"] = s["t_end"].map(idx_of_ts).astype("int64")
    s["known_from"] = s["end_idx"] + 1
    s = s.sort_values(["t_end", "session"]).reset_index(drop=True)
    return s
