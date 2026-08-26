#!/usr/bin/env python3
"""Build and cache the prepared 5m+1h-context frames (mtf.prepare) once per symbol.

`indicators.structure()` is a bar-by-bar state machine over ~420k bars per symbol
and is run twice (5m and the resampled 1h frame); every downstream stage reuses
this cache instead of recomputing it.
"""
from __future__ import annotations
import os, sys, time
import pandas as pd

import common as C
import mtf

CACHE = os.path.join(C.HERE, "cache")
os.makedirs(CACHE, exist_ok=True)

KEEP = ["ts", "open", "high", "low", "close", "volume", "atr",
        "bias", "bos", "choch", "sweep", "swing_high", "swing_low",
        "ob_low", "ob_high", "ob_dir", "fvg_low", "fvg_high", "fvg_dir",
        "h1_bias", "h1_bos", "h1_choch", "h1_sweep", "h1_swing_high", "h1_swing_low",
        "h1_ob_low", "h1_ob_high", "h1_ob_dir", "h1_fvg_low", "h1_fvg_high",
        "h1_fvg_dir", "h1_atr", "h1_bos_recent_up", "h1_bos_recent_dn"]


def path(sym: str) -> str:
    return os.path.join(CACHE, f"{sym}-prepared.pkl")


def get(sym: str) -> pd.DataFrame:
    f = path(sym)
    if os.path.exists(f):
        return pd.read_pickle(f)
    d = mtf.prepare(C.load(sym, "5m"), mtf.P)[KEEP]
    d.to_pickle(f)
    return d


if __name__ == "__main__":
    syms = sys.argv[1].split(",") if len(sys.argv) > 1 else C.SYMBOLS
    for s in syms:
        t = time.time()
        d = get(s)
        print(f"{s}: {len(d)} bars, {time.time()-t:.1f}s, "
              f"5m sig-cols ok, h1_bias nonzero {float((d.h1_bias!=0).mean()):.1%}", flush=True)
