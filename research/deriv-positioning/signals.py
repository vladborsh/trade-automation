"""The three pre-registered hypotheses of DESIGN.md §3–§4, and their §5.3 shadows.

Nothing here is swept. Every threshold (95 / 90-sensitivity, 12-bar break window,
0.25 ATR buffer, 3R, 48-bar time stop, 33/67 tercile cuts) is the number written
into DESIGN.md before any of this data was looked at.

Each event rule and its price-derived shadow run through the SAME function with a
different input column, so the redundancy control differs from the real test in
exactly one place — which is the whole point of §5.3.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C


# ------------------------------------------------------------ hypothesis (a)
def momentum_breakout(d: pd.DataFrame) -> pd.DataFrame:
    """v2's `momentum_breakout` at v2 defaults, untouched (DESIGN.md §3)."""
    return C.sv.momentum_breakout(d, C.P)


def tercile(pct: np.ndarray) -> np.ndarray:
    """Pre-registered ΔOI tercile cut on the rolling percentile: 0 = bottom
    (<= 33), 1 = middle, 2 = top (>= 67); -1 where undefined."""
    out = np.full(len(pct), -1, dtype=int)
    ok = ~np.isnan(pct)
    out[ok & (pct <= 33)] = 0
    out[ok & (pct > 33) & (pct < 67)] = 1
    out[ok & (pct >= 67)] = 2
    return out


# --------------------------------------------------------- hypotheses (b1/b2)
def _levels(d: pd.DataFrame, n: int = C.BREAK_N):
    """Prior-n-bar extremes, strictly excluding the decision bar itself."""
    hh = d.high.shift(1).rolling(n).max().to_numpy()
    ll = d.low.shift(1).rolling(n).min().to_numpy()
    return hh, ll


def _pack_event(d: pd.DataFrame, sig: np.ndarray) -> pd.DataFrame:
    """Structural stop (the level whose reclaim refutes the event) + fixed 3R."""
    hh, ll = _levels(d)
    atr = d.atr.to_numpy(); c = d.close.to_numpy()
    stop = np.where(sig == -1, hh + C.STOP_BUF * atr,
                    np.where(sig == 1, ll - C.STOP_BUF * atr, np.nan))
    risk = np.abs(c - stop)
    target = np.where(sig == 1, c + C.EVENT_RR * risk,
                      np.where(sig == -1, c - C.EVENT_RR * risk, np.nan))
    return C.st._pack(d, sig, stop, target)


def crowding_squeeze(d: pd.DataFrame, col: str = "crowd",
                     thr: float = C.EXTREME, gate: str = "usable_b1") -> pd.DataFrame:
    """§4 b1. Short: crowd at/above `thr` percentile AND this bar closes below the
    prior 12-bar low (the adverse break that starts marking crowded longs
    underwater). Long: the exact mirror (crowd at/below 100-thr, close above the
    prior 12-bar high).

    §5.3 shadow: pass col="ret24h_pct" — trailing 24h return percentile as the
    price-only crowding proxy. Same code, one different input.
    """
    x = d[col].to_numpy()
    hh, ll = _levels(d)
    c = d.close.to_numpy(); u = d[gate].to_numpy()
    short = u & (x >= thr) & (c < ll)
    long_ = u & (x <= 100 - thr) & (c > hh)
    sig = np.where(short, -1, np.where(long_, 1, 0))
    return _pack_event(d, sig)


def taker_continuation(d: pd.DataFrame, col: str = "taker",
                       thr: float = C.EXTREME, gate: str = "usable_b2") -> pd.DataFrame:
    """§4 b2. Long: taker imbalance at/above `thr` percentile AND the bar closes
    up with close > the prior bar's high. Short: the mirror.

    §5.3 shadow: pass col="vol_pct" — same-bar volume percentile. Volume is
    unsigned, so BOTH sides of the shadow take the high tail (>= thr); the price
    condition supplies the direction, exactly as `taker`'s tails do for the real
    rule. Stated here because it is the one place the shadow is not a literal
    substitution.
    """
    x = d[col].to_numpy()
    c = d.close.to_numpy(); o = d.open.to_numpy()
    ph = d.high.shift(1).to_numpy(); pl = d.low.shift(1).to_numpy()
    u = d[gate].to_numpy()
    if col == "vol_pct":
        hi_tail, lo_tail = (x >= thr), (x >= thr)
    else:
        hi_tail, lo_tail = (x >= thr), (x <= 100 - thr)
    long_ = u & hi_tail & (c > o) & (c > ph)
    short = u & lo_tail & (c < o) & (c < pl)
    sig = np.where(long_, 1, np.where(short, -1, 0))
    return _pack_event(d, sig)


# ------------------------------------------------------------------ registry
# name -> (builder, kwargs). "_shadow" entries are the §5.3 redundancy controls.
EVENTS = {
    "b1_crowd":         (crowding_squeeze, dict(col="crowd", thr=C.EXTREME)),
    "b1_crowd_p90":     (crowding_squeeze, dict(col="crowd", thr=C.EXTREME_SENS)),
    "b1_shadow":        (crowding_squeeze, dict(col="ret24h_pct", thr=C.EXTREME)),
    "b2_taker":         (taker_continuation, dict(col="taker", thr=C.EXTREME)),
    "b2_taker_p90":     (taker_continuation, dict(col="taker", thr=C.EXTREME_SENS)),
    "b2_shadow":        (taker_continuation, dict(col="vol_pct", thr=C.EXTREME)),
}
PRIMARY = ["b1_crowd", "b2_taker"]
SHADOW = {"b1_crowd": "b1_shadow", "b2_taker": "b2_shadow"}


def build_event(d: pd.DataFrame, name: str) -> pd.DataFrame:
    fn, kw = EVENTS[name]
    return fn(d, **kw)
