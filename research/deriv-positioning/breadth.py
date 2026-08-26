#!/usr/bin/env python3
"""Per-symbol breadth of the stage-1 results (the "is it 8/8 or one asset" check).

Pooling 8 correlated USDT perps hides whether a pooled number is one asset or
eight. Every prior package reports this; so does this one.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd

import common as C
import prep
import signals as S
import stage1 as S1

keep = json.load(open(f"{C.OUT}/symbols_kept.json"))["kept"]
rows = []

for cond, label in (("dOI_4h_pct", "a_dOI_4h"), ("ret4h_pct", "a_shadow_ret4h")):
    for sym in keep["a"]:
        d = prep.get(sym)
        sig = S.momentum_breakout(d)
        terc = S.tercile(d[cond].to_numpy())
        s = sig.sig.to_numpy()
        for hz in S1.HORIZONS:
            f = S1.fwd_returns(d, hz)
            idx = S1.trigger_idx(d, sig, C.FIT, hz, gate="usable_a")
            idx = idx[terc[idx] >= 0]
            r = f[idx] * s[idx]
            ok = ~np.isnan(r)
            top, bot = r[ok & (terc[idx] == 2)], r[ok & (terc[idx] == 0)]
            diff, t = S1.welch(top, bot)
            rows.append(dict(hypothesis=label, symbol=sym, horizon=hz,
                             n_top=len(top), n_bottom=len(bot),
                             diff_bps=diff * 1e4 if diff == diff else np.nan, t_stat=t))

for name in ("b1_crowd", "b2_taker"):
    win = C.fit_win(name)
    gate = "usable_b1" if name.startswith("b1") else "usable_b2"
    for sym in keep[C.hyp_of(name)]:
        d = prep.get(sym)
        sig = S.build_event(d, name)
        s = sig.sig.to_numpy()
        for hz in S1.HORIZONS:
            f = S1.fwd_returns(d, hz)
            idx = S1.trigger_idx(d, sig, win, hz, gap=C.BREAK_N, gate=gate)
            r = f[idx] * s[idx]
            r = r[~np.isnan(r)]
            rows.append(dict(hypothesis=name, symbol=sym, horizon=hz,
                             n_top=len(r), n_bottom=np.nan,
                             diff_bps=r.mean() * 1e4 if len(r) else np.nan,
                             t_stat=S1.tstat(r)))

df = pd.DataFrame(rows)
df.to_csv(f"{C.OUT}/stage1_per_symbol.csv", index=False)
pd.set_option("display.width", 240)
print("=== per-symbol breadth, fit window (diff_bps = top-minus-bottom for (a), "
      "pooled mean for (b)) ===")
for h in df.hypothesis.unique():
    g = df[df.hypothesis == h]
    piv = g.pivot(index="symbol", columns="horizon", values="diff_bps")
    piv = piv.reindex([s for s in C.SYMBOLS if s in piv.index])
    print(f"\n-- {h}")
    print(piv.to_string(float_format=lambda x: f"{x:9.1f}"))
    pos = (piv > 0).sum()
    print("  symbols with positive sign per horizon:",
          ", ".join(f"{h_}:{int(v)}/8" for h_, v in pos.items()))
