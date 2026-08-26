#!/usr/bin/env python3
"""Harness validation, both ways (DESIGN.md §6 stage 2 (ii)).

Stage 1's verdict is a KILL, so -- exactly as in intraday-mtf-smc/§2.4 -- the
probe must first be shown capable of finding a signal when one exists, and of
returning ~0 when one does not. Both controls run through the SAME
`stage1.observations()` code path, same 8 symbols, same fit window, on the 1h
frame this package derives from the shared 5m pull:

  * momentum_breakout @ 1h -- v2's one signed-positive rule-set  (positive control)
  * single-timeframe `smc` @ 1h -- v1's measured zero            (negative control)
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
from common import st
import strategies_v2 as sv          # noqa: E402  (v2, unchanged)
from stage1 import observations, tstat

LO = pd.Timestamp(C.FIT[0], tz="UTC"); HI = pd.Timestamp(C.FIT[1], tz="UTC")
HZ = [3, 6, 12, 24]                 # 1h bars, matching v1/v2's 1h grid

rows = []
for cand in ("momentum_breakout", "smc"):
    pool = {h: [] for h in HZ}
    for sym in C.SYMBOLS:
        h1 = C.resample_h1(C.load5m(sym))
        p = dict(st.DEFAULTS); p.update(sv.EXTRA_DEFAULTS)
        q = st.prepare(h1, p)
        fn = sv.CANDIDATES_V2.get(cand) or st.CANDIDATES[cand]
        sig = fn(q, p)
        s = sig.sig.to_numpy()
        idx = np.flatnonzero(s != 0)
        for hz in HZ:
            r = observations(q, idx, s[idx].astype(float), hz, LO, HI)
            if len(r):
                pool[hz].append(r)
    for hz in HZ:
        r = np.concatenate(pool[hz])
        rows.append(dict(control=cand, horizon_1h=hz, n=len(r),
                         mean_bps=r.mean() * 1e4, t_stat=tstat(r)))

df = pd.DataFrame(rows)
df.to_csv(f"{C.OUT}/stage1_controls.csv", index=False)
print(df.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))
