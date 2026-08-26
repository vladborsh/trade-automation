"""Candidate rule-sets added in v2, on top of the three from v1.

The first report's §8 recommendation was to "invert the question": the MR
trigger's forward return at 1h is *negative*, which is evidence for
continuation rather than reversion at those thresholds. These candidates probe
that, plus an SMC-gated version of it, reusing the same prepared frame and the
same engine so numbers stay comparable.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import strategies as st
from strategies import _pack

EXTRA_DEFAULTS = dict(
    mom_rr=1.5,        # reward:risk for the continuation candidates
    brk_z=2.0,         # z threshold for the breakout variant
)


def _p(p: dict) -> dict:
    q = dict(EXTRA_DEFAULTS)
    q.update(p)
    return q


def momentum(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Exact sign-inversion of candidate 1's trigger.

    Where mean_reversion buys the failed -Z stretch, this SELLS it: the claim
    being tested is that a 2-sigma push in crypto is information, not noise, and
    the pullback that ends the stretch is a continuation entry.
    Stop: stop_atr * ATR against the trade. Target: mom_rr multiples of risk.
    """
    p = _p(p)
    z, zp = d.z, d.z.shift(1)
    fade_long = (zp <= -p["mr_z"]) & (z > -p["mr_z"]) & (d.rsi < 40)
    fade_short = (zp >= p["mr_z"]) & (z < p["mr_z"]) & (d.rsi > 60)
    sig = np.where(fade_long, -1, np.where(fade_short, 1, 0))
    return _rr_exits(d, sig, p)


def momentum_breakout(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Trade the stretch itself while it is still extending: close crosses
    beyond +/- brk_z sigma and keeps going in that direction."""
    p = _p(p)
    z, zp = d.z, d.z.shift(1)
    long_ = (zp < p["brk_z"]) & (z >= p["brk_z"])
    short = (zp > -p["brk_z"]) & (z <= -p["brk_z"])
    sig = np.where(long_, 1, np.where(short, -1, 0))
    return _rr_exits(d, sig, p)


def momentum_smc(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Momentum inversion, gated the way the hybrid gates mean reversion:
    higher-timeframe structure must agree with the continuation direction, and
    no opposing liquidity sweep may be fresh."""
    p = _p(p)
    lb = p["sweep_lookback"]
    sweep_up = (d.sweep == 1).rolling(lb, min_periods=1).max().astype(bool)
    sweep_dn = (d.sweep == -1).rolling(lb, min_periods=1).max().astype(bool)
    base = momentum(d, p).sig.to_numpy()
    ok_long = (d.htf_bias >= 0).to_numpy() & ~sweep_up.to_numpy()
    ok_short = (d.htf_bias <= 0).to_numpy() & ~sweep_dn.to_numpy()
    sig = np.where((base == 1) & ok_long, 1, np.where((base == -1) & ok_short, -1, 0))
    return _rr_exits(d, sig, p)


def _rr_exits(d: pd.DataFrame, sig, p: dict) -> pd.DataFrame:
    stop = np.where(sig == 1, d.low - p["stop_atr"] * d.atr,
                    np.where(sig == -1, d.high + p["stop_atr"] * d.atr, np.nan))
    risk = np.abs(d.close - stop)
    target = np.where(sig == 1, d.close + p["mom_rr"] * risk,
                      np.where(sig == -1, d.close - p["mom_rr"] * risk, np.nan))
    return _pack(d, sig, stop, target)


CANDIDATES_V2 = {
    "momentum": momentum,
    "momentum_breakout": momentum_breakout,
    "momentum_smc": momentum_smc,
}
ALL_CANDIDATES = list(st.CANDIDATES) + list(CANDIDATES_V2)
