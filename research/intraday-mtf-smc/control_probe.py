#!/usr/bin/env python3
"""Positive/negative controls for the stage-1 harness.

The stage-1 verdict is a KILL, so the probe itself has to be shown to be capable
of finding a signal when one exists. Two controls, both run through the exact
`stage1.observations()` code path, same 8 symbols, same fit window:

  * momentum_breakout @ 1h -- v2's one signed-positive rule-set (gross PF > 1 on
    8/8 perps). The 1h frame is the SAME resampled frame this package derives
    from 5m, so this also cross-checks the resampler.
  * single-timeframe `smc` @ 1h -- v1's measured zero (-0.03 bp), the negative
    control: it should come back ~0.
"""
from __future__ import annotations
import sys
import numpy as np
import pandas as pd

import common as C
import mtf
from stage1 import observations

sys.path.insert(0, C.HERE + "/../intraday-mr-smc-v2")
import strategies_v2 as sv          # noqa: E402
import strategies as st             # noqa: E402

LO = pd.Timestamp(C.FIT[0], tz="UTC"); HI = pd.Timestamp(C.FIT[1], tz="UTC")
HZ = [3, 6, 12, 24]                 # 1h bars, matching v1/v2's 1h grid

rows = []
for cand in ("momentum_breakout", "smc"):
    pool = {h: [] for h in HZ}
    for sym in C.SYMBOLS:
        h1 = mtf.resample_h1(C.load(sym, "5m"), mtf.P)
        p = dict(st.DEFAULTS); p.update(sv.EXTRA_DEFAULTS)
        q = st.prepare(h1, p)
        fn = sv.CANDIDATES_V2.get(cand) or st.CANDIDATES[cand]
        sig = fn(q, p)
        for hz in HZ:
            r, _ = observations(q, sig, hz, LO, HI)
            if len(r):
                pool[hz].append(r)
    for hz in HZ:
        r = np.concatenate(pool[hz])
        t = r.mean() / (r.std(ddof=1) / np.sqrt(len(r)))
        rows.append(dict(control=cand, horizon_1h=hz, n=len(r),
                         mean_bps=r.mean() * 1e4, t_stat=t))
df = pd.DataFrame(rows)
df.to_csv(f"{C.OUT}/stage1_controls.csv", index=False)
print(df.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))
