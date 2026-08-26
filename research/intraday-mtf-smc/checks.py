#!/usr/bin/env python3
"""Causality + wiring checks. Run before trusting any result below."""
import numpy as np, pandas as pd
import common as C, mtf, prep

d = prep.get("BTCUSDT")
h = mtf.resample_h1(C.load("BTCUSDT", "5m"), mtf.P)
sh = mtf.ind.structure(h, mtf.P["k"])

# 1. every 5m bar in hour T must carry the 1h state as of the close of hour T-2's
#    bar... precisely: the state of the last COMPLETED 1h bar, i.e. hour T-1.
h_idx = {t: i for i, t in enumerate(h.ts)}
rng = np.random.default_rng(0)
bad = 0
for i in rng.choice(np.arange(20000, len(d)), 4000, replace=False):
    t = d.ts.iloc[i].floor("h")
    j = h_idx[t]
    if j >= 1 and d.h1_bias.iloc[i] != sh.bias.iloc[j - 1]:
        bad += 1
print(f"check1 h1 one-bar-lag merge mismatches: {bad}/4000")

# 2. the merged value must NEVER equal a state that is not yet known: compare
#    against the CURRENT (same-hour) 1h bar and confirm they differ sometimes
#    (i.e. we are not accidentally using the concurrent bar).
same = 0
for i in rng.choice(np.arange(20000, len(d)), 4000, replace=False):
    t = d.ts.iloc[i].floor("h"); j = h_idx[t]
    if d.h1_bias.iloc[i] == sh.bias.iloc[j]:
        same += 1
print(f"check2 agrees with CONCURRENT 1h bar in {same}/4000 (sticky col; must be <4000)")

# 3. shifting the whole 5m frame's future away must not change any signal
sa = mtf.variant_a(d, mtf.P)
sa2 = mtf.variant_a(d.iloc[:300000].copy(), mtf.P)
print("check3 variant A prefix-stability:",
      bool((sa.sig.to_numpy()[:300000] == sa2.sig.to_numpy()).all()))
sb = mtf.variant_b(d, mtf.P, "sweep")
sb2 = mtf.variant_b(d.iloc[:300000].copy(), mtf.P, "sweep")
print("check3b variant B prefix-stability:",
      bool((sb.sig.to_numpy()[:300000] == sb2.sig.to_numpy()).all()))

# 4. frequency sanity
for nm, s in (("A", sa), ("B-sweep", sb)):
    yrs = (d.ts.iloc[-1] - d.ts.iloc[0]).total_seconds() / (365 * 86400)
    print(f"check4 {nm}: {int((s.sig!=0).sum())} raw signals "
          f"({(s.sig!=0).sum()/yrs:.0f}/yr) long share "
          f"{float((s.sig==1).sum()/max(1,(s.sig!=0).sum())):.2f}")

# 5. sim_R vs the v1 engine should agree on trade count and R sign
import backtest as bt
r = bt.run(d, sa[["sig", "stop", "target"]], mtf.P["time_stop"])
q = mtf.sim_R(d, sa, mtf.P)
print(f"check5 engine trades {len(r['trades'])} vs sim_R trades {len(q)} "
      f"(engine halts on the daily breaker, so sim_R >= engine)")
print(f"       engine expectancy_R {r['trades'].r.mean():+.4f} | sim_R net_R {q.net_R.mean():+.4f}")
