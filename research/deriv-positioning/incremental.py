#!/usr/bin/env python3
"""ONE post-mortem diagnostic, not a gate and not promotable.

§5.3 kills hypothesis (a): the price shadow (trailing 4h return percentile)
out-conditions ΔOI on the same trigger set. But `results/redundancy_correlations.
csv` shows the two series are nearly uncorrelated (Spearman rho ~0.12), so
"ΔOI *is* price" is not literally what is happening. The precise question §0
asks — does positioning add anything BEYOND price — is therefore worth one
direct measurement:

  hold the price shadow fixed (condition on the ret4h tercile), then split by
  ΔOI tercile inside it. If ΔOI carries independent information, the split
  survives inside a fixed price bucket.

This runs once, on the fit window, on the already-dead hypothesis. It cannot
resurrect anything: the kill rule has already fired and no threshold moves.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd

import common as C
import prep
import signals as S
import stage1 as S1

keep = json.load(open(f"{C.OUT}/symbols_kept.json"))["kept"]["a"]
rows = []
for hz in S1.HORIZONS:
    acc = {(p, o): [] for p in (0, 1, 2) for o in (0, 1, 2)}
    for sym in keep:
        d = prep.get(sym)
        sig = S.momentum_breakout(d)
        s = sig.sig.to_numpy()
        toi = S.tercile(d.dOI_4h_pct.to_numpy())
        tpx = S.tercile(d.ret4h_pct.to_numpy())
        f = S1.fwd_returns(d, hz)
        idx = S1.trigger_idx(d, sig, C.FIT, hz, gate="usable_a")
        idx = idx[(toi[idx] >= 0) & (tpx[idx] >= 0)]
        r = f[idx] * s[idx]
        ok = ~np.isnan(r)
        for p in (0, 1, 2):
            for o in (0, 1, 2):
                m = ok & (tpx[idx] == p) & (toi[idx] == o)
                if m.any():
                    acc[(p, o)].append(r[m])
    for p in (0, 1, 2):
        cell = {o: (np.concatenate(acc[(p, o)]) if acc[(p, o)] else np.array([]))
                for o in (0, 1, 2)}
        diff, t = S1.welch(cell[2], cell[0])
        rows.append(dict(horizon=hz, price_tercile=["bottom", "mid", "top"][p],
                         n_oi_bottom=len(cell[0]), n_oi_top=len(cell[2]),
                         mean_oi_bottom_bps=cell[0].mean() * 1e4 if len(cell[0]) else np.nan,
                         mean_oi_top_bps=cell[2].mean() * 1e4 if len(cell[2]) else np.nan,
                         oi_diff_bps=diff * 1e4 if diff == diff else np.nan, t_stat=t))

df = pd.DataFrame(rows)
df.to_csv(f"{C.OUT}/incremental_oi_within_price.csv", index=False)
pd.set_option("display.width", 220)
print("=== ΔOI tercile split INSIDE a fixed trailing-4h-return tercile, FIT ===")
print(df.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))
n_sig = int((df.t_stat.abs() > 2).sum())
print(f"\ncells with |t| > 2: {n_sig}/{len(df)}  "
      f"(positive and |t|>2: {int(((df.t_stat > 2)).sum())})")
