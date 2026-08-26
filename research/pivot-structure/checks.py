#!/usr/bin/env python3
"""Causality + wiring checks (DESIGN.md §1.1: "required").

Run before trusting any result. Mirrors intraday-mtf-smc/checks.py.
"""
import numpy as np, pandas as pd
import common as C, pivot

sym = "BTCUSDT"
d5 = C.load5m(sym)
h1 = C.resample_h1(d5)
K, k = 15, 4

# ---- 1. prefix stability (truncation invariance), Mode S
ps = pivot.pivot_structure(h1, K, k)
n = 30000
ps2 = pivot.pivot_structure(h1.iloc[:n].copy(), K, k)
cols = ["B", "flip", "MH", "ML", "mh", "ml", "X"]
ok = all(bool((ps[c].to_numpy()[:n] == ps2[c].to_numpy())
              [~(pd.isna(ps[c].to_numpy()[:n]) & pd.isna(ps2[c].to_numpy()))].all())
         for c in cols)
print(f"check1 Mode S prefix-stability over {cols}: {ok}")

# ---- 2. a flip at bar i must use only minor swings confirmed at or before i
sh_f, sl_f = pivot.ind.fractals(h1, k)
sh_f = sh_f.to_numpy(); sl_f = sl_f.to_numpy()
lo = h1.low.to_numpy(); hi = h1.high.to_numpy(); cl = h1.close.to_numpy()
bad = 0
fi = np.flatnonzero(ps.flip.to_numpy() != 0)
for i in fi:
    lvl = ps.flip_level.iloc[i]
    side = int(ps.flip.iloc[i])
    # the broken level must be a fractal extreme CONFIRMED at some j <= i,
    # i.e. taken from bar j-k where sl_f[j] (resp. sh_f[j]) is True
    src = np.flatnonzero((sl_f[:i + 1] if side == -1 else sh_f[:i + 1]))
    vals = (lo if side == -1 else hi)[np.maximum(src - k, 0)]
    if not np.any(np.isclose(vals, lvl)):
        bad += 1
print(f"check2 flips whose broken level is not a <=i-confirmed fractal: {bad}/{len(fi)}")

# ---- 3. the flip must be a genuine close beyond that level
v = 0
for i in fi:
    s = int(ps.flip.iloc[i]); lvl = ps.flip_level.iloc[i]
    if not ((s == -1 and cl[i] < lvl) or (s == 1 and cl[i] > lvl)):
        v += 1
print(f"check3 flips without a close beyond the broken minor swing: {v}/{len(fi)}")

# ---- 4. Mode M: the merged 1h major state must be the LAST COMPLETED 1h bar
mj_h = pivot.major_track(h1, K)
mm = pivot.merge_major_h1(d5, K)
h_idx = {t: i for i, t in enumerate(h1.ts)}
rng = np.random.default_rng(0)
mis = same = 0
for i in rng.choice(np.arange(20000, len(d5)), 4000, replace=False):
    j = h_idx[d5.ts.iloc[i].floor("h")]
    if j >= 1 and mm.mbias.iloc[i] != mj_h.mbias.iloc[j - 1]:
        mis += 1
    if mm.mbias.iloc[i] == mj_h.mbias.iloc[j]:
        same += 1
print(f"check4 Mode M one-bar-lag mismatches: {mis}/4000 "
      f"(agrees with CONCURRENT 1h bar {same}/4000 -- sticky col, must be < 4000)")

# ---- 5. Mode M prefix stability
psm = pivot.build(d5, K, k, "M")
m2 = 200000
psm2 = pivot.build(d5.iloc[:m2].copy(), K, k, "M")
okm = bool((psm.flip.to_numpy()[:m2] == psm2.flip.to_numpy()).all())
print(f"check5 Mode M flip prefix-stability: {okm}")

# ---- 6. rule-set signals inherit prefix stability
for arm in ("E1-T1", "E1-T2", "E2-T2", "C1"):
    a = pivot.ruleset(h1, ps, arm, "S")
    b = pivot.ruleset(h1.iloc[:n].copy(), ps2, arm, "S")
    print(f"check6 {arm:6s} prefix-stable: "
          f"{bool((a.sig.to_numpy()[:n] == b.sig.to_numpy()).all())}")

# ---- 7. frequency + long/short balance
yrs = (h1.ts.iloc[-1] - h1.ts.iloc[0]).total_seconds() / (365 * 86400)
f = ps.flip.to_numpy()
print(f"check7 {sym} 1h K={K} k={k}: {len(fi)} flips ({len(fi)/yrs:.0f}/yr), "
      f"long share {float((f == 1).sum()/len(fi)):.2f}, "
      f"alternating={bool((f[fi][1:] != f[fi][:-1]).all())}")
