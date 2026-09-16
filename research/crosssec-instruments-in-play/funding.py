"""§6.2 — realised funding, attached to every instrument-day.

A position entered at A + 30 min (17:30/18:30 UTC minus 4 h) and exited at
A + 4 h 30 min is open across the 16:00 UTC settlement on every eligible day
(the note's §6.2 arithmetic; `checks.py` asserts it per leg). The payment is

    funding_R = side * (-rate) * entry / stop_dist

for the settlement whose timestamp lies strictly inside (entry, exit].
A missing rate is 0 and counted.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C


def attach(legs: pd.DataFrame) -> pd.DataFrame:
    """Adds `funding_R`, `netR_fund`, `n_settlements`, `funding_missing`."""
    legs = legs.copy()
    fr = np.zeros(len(legs))
    nset = np.zeros(len(legs), int)
    miss = np.zeros(len(legs), bool)
    entry_ms = legs.anchor_ms.values + C.WINDOW_MIN * C.MIN_MS
    exit_ms = legs.exit_ms.values
    for sym, g in legs.groupby("symbol", sort=False):
        p = os.path.join(C.DATA_FUND, f"{sym}.parquet")
        pos = g.index.values
        if not os.path.exists(p):
            miss[pos] = True
            continue
        f = pd.read_parquet(p)
        if not len(f):
            miss[pos] = True
            continue
        t = f.t_ms.values.astype(np.int64)
        rate = f.rate.values.astype(float)
        lo = np.searchsorted(t, entry_ms[pos], "right")
        hi = np.searchsorted(t, exit_ms[pos], "right")
        cs = np.concatenate([[0.0], np.cumsum(rate)])
        s = cs[np.clip(hi, 0, len(t))] - cs[np.clip(lo, 0, len(t))]
        n = np.clip(hi, 0, len(t)) - np.clip(lo, 0, len(t))
        fr[pos] = s
        nset[pos] = n
        miss[pos] = n == 0
    legs["funding_rate_sum"] = fr
    legs["n_settlements"] = nset
    legs["funding_missing"] = miss
    legs["funding_R"] = legs.side.values * (-fr) * legs.entry.values / legs.stop_dist.values
    legs["netR_fund"] = legs.netR.values + legs.funding_R.values
    return legs
