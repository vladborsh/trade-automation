"""Shared plumbing for the session-liquidity descriptive study.

Canonical spec: knowledge/session-liquidity.md (authoritative for every
definition). Pinned mechanical defaults for the points the spec leaves open are
documented in REPORT.md section "Pinned defaults" and mirrored back into the
knowledge file.

Data: the already-cached Binance USD-M perp 5m klines pulled by
research/intraday-mtf-smc/fetch_mtf.py -- reached here through the `data/`
symlink. No new data pull.
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
os.makedirs(RESULTS, exist_ok=True)
os.makedirs(VIZ, exist_ok=True)

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]

# knowledge/session-liquidity.md -- Sessions (UTC, fixed wide windows).
# (start_hour, end_hour); end is exclusive. NY overlaps London 13:00-16:00.
SESSIONS = {
    "Asia":   (0, 8),
    "London": (8, 16),
    "NY":     (13, 21),
}
SESSION_ORDER = ["Asia", "London", "NY"]

BAR_MIN = 5
HORIZON_BARS = 24        # 2h reverse-move horizon (spec)
CONFIRM_BARS = 24        # PINNED: confirmation must land within 2h of the take-out
LOOKBACK_HOURS = 48      # spec: unswept levels from the last 2 days
K = 3                    # spec: pivot k=3
ATR_N = 14


def load(sym: str, iv: str = "5m") -> pd.DataFrame:
    f = os.path.join(DATA, f"{sym}-{iv}.csv.gz")
    if not os.path.exists(f):
        raise SystemExit(f"missing {f} (data/ symlink -> intraday-mtf-smc/data)")
    d = pd.read_csv(f)
    d["ts"] = pd.to_datetime(d["ts"], utc=True)
    return d.sort_values("ts").reset_index(drop=True)


def prep(d: pd.DataFrame) -> pd.DataFrame:
    """Attach the causal columns every downstream step needs."""
    d = d.copy()
    d["atr"] = atr(d, ATR_N)
    sh, sl = fractals(d, K)          # already shifted by k -> confirmed, causal
    d["piv_hi_conf"] = sh.fillna(False).to_numpy()
    d["piv_lo_conf"] = sl.fillna(False).to_numpy()
    # price of the pivot that the flag on bar i confirms (the bar i-K extreme)
    d["piv_hi_px"] = d["high"].shift(K).where(d["piv_hi_conf"])
    d["piv_lo_px"] = d["low"].shift(K).where(d["piv_lo_conf"])
    d["month"] = d["ts"].dt.strftime("%Y-%m")
    return d


def session_frames(d: pd.DataFrame) -> pd.DataFrame:
    """One row per (UTC date, session): high/low reached and the window bounds.

    A session's level only becomes usable once its window has closed -- the
    `known_from` index is the first bar strictly after the session's last bar,
    which is what keeps the study free of lookahead.
    """
    hours = d["ts"].dt.hour.to_numpy()
    day = d["ts"].dt.floor("D")
    rows = []
    for name, (h0, h1) in SESSIONS.items():
        m = (hours >= h0) & (hours < h1)
        sub = d.loc[m, ["ts", "high", "low"]].copy()
        sub["day"] = day[m]
        g = sub.groupby("day", sort=True)
        agg = g.agg(high=("high", "max"), low=("low", "min"),
                    t_start=("ts", "min"), t_end=("ts", "max"))
        agg = agg.reset_index()
        agg["session"] = name
        rows.append(agg)
    s = pd.concat(rows, ignore_index=True)
    # index of the first bar after the session closes (level becomes tradable)
    idx_of_ts = pd.Series(np.arange(len(d)), index=d["ts"])
    s["end_idx"] = s["t_end"].map(idx_of_ts).astype("int64")
    s["known_from"] = s["end_idx"] + 1
    s = s.sort_values(["t_end", "session"]).reset_index(drop=True)
    return s
