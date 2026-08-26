"""The three pre-registered rule-sets of MTF-SMC-DESIGN.md, and their signal cache.

  A        -- §2: 1h bias + BOS freshness  ->  5m OB/FVG retest, fixed 3R
  B_sweep  -- §3: 1h OB/FVG/LIQ zone       ->  5m sweep-and-reclaim  (primary)
  B_choch  -- §3: 1h OB/FVG/LIQ zone       ->  5m CHoCH              (secondary)

B_sweep and B_choch are evaluated as two separate rule-sets, never OR-ed (§3.2.3).
Signals are generated once on the FULL frame and only then sliced into fit/holdout,
so the stateful zone machine never sees an artificial restart at the split (engine
state -- equity and the daily breaker -- does reset at the boundary, per §5.1).
"""
from __future__ import annotations
import os
import pandas as pd

import common as C
import mtf
import prep

NAMES = ["A", "B_sweep", "B_choch"]
CACHE = os.path.join(C.HERE, "cache")


def build(sym: str, name: str) -> pd.DataFrame:
    f = os.path.join(CACHE, f"{sym}-{name}.pkl")
    if os.path.exists(f):
        return pd.read_pickle(f)
    d = prep.get(sym)
    if name == "A":
        s = mtf.variant_a(d, mtf.P)
        s["ztypes"] = None
    else:
        s = mtf.variant_b(d, mtf.P, "sweep" if name == "B_sweep" else "choch")
    s.to_pickle(f)
    return s


def get(sym: str, name: str):
    return prep.get(sym), build(sym, name)
