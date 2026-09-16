"""ATR14 on the arm's own bars — the one indicator this package needs.

`ARCHITECT-NOTE-CRYPTO-INVESTIGATION.md` §4.10 drops Study B and the
24-feature vector. What remains from `research/orb-ny-open/features.py` is
Wilder's ATR14, because Null A sizes its placebo stops in ATR units
(`DESIGN.md` §6.1) and the forward-lift reference normalises MFE by it
(§6.3). The code below is **verbatim** from the closed pass's
`features.py` — same seeding, same recursion — so that a placebo stop here is
the same object as a placebo stop there.

Every value is strictly causal: the value at bar index j depends only on bars
<= j, so evaluating globally and indexing at the entry bar is identical to
truncating the tape there.
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import Tape  # noqa: E402


def wilder_rma(x: np.ndarray, k: int) -> np.ndarray:
    """Wilder's smoothed moving average, seeded with the mean of the first k
    non-NaN values. `x` may start with a NaN (true range)."""
    out = np.full(len(x), np.nan)
    v = x[~np.isnan(x)]
    if len(v) < k:
        return out
    off = int(np.argmax(~np.isnan(x)))
    out[off + k - 1] = x[off:off + k].mean()
    for i in range(off + k, len(x)):
        out[i] = (out[i - 1] * (k - 1) + x[i]) / k
    return out


def atr_wilder(h, l, c, k=14) -> np.ndarray:
    tr = np.full(len(h), np.nan)
    tr[1:] = np.maximum(h[1:] - l[1:],
                        np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    return wilder_rma(tr, k)


class Ind:
    """ATR14 over the arm's full bar sequence, cached per (symbol, tf)."""

    _cache: dict = {}

    def __init__(self, symbol: str, tf: int):
        B = Tape.get(symbol).bars[tf]
        self.atr14 = atr_wilder(B["h"], B["l"], B["c"], 14)

    @classmethod
    def get(cls, symbol, tf):
        key = (symbol, int(tf))
        if key not in cls._cache:
            cls._cache[key] = Ind(symbol, int(tf))
        return cls._cache[key]
