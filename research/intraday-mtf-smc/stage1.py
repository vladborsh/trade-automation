#!/usr/bin/env python3
"""STAGE 1 -- signal-level edge probe (MTF-SMC-DESIGN.md §5.3).

Same methodology as v1's `edge_probe.py`: direction-adjusted forward returns
measured on NON-OVERLAPPING triggers (kept >= horizon bars apart), no stops, no
targets, no costs -- purely "does the trigger see anything".

Pass bar, per rule-set, FIT WINDOW ONLY:
  * pooled (8 symbols) mean forward return positive with t > 2
  * at >= 2 ADJACENT horizons
  * on >= 1000 non-overlapping observations (A) / >= 400 (B)
A rule-set that fails here is dead: no backtest, no tuning to resurrect it.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
import rulesets

HORIZONS = [3, 6, 12, 24, 48, 96, 144]      # 5m bars: 15min .. 12h
MIN_N = {"A": 1000, "B_sweep": 400, "B_choch": 400}


def observations(d, sig, hz, lo, hi):
    """De-overlapped, direction-adjusted forward returns for triggers inside [lo,hi)."""
    c = d.close.to_numpy(); s = sig.sig.to_numpy()
    fwd = np.full(len(c), np.nan)
    fwd[:-hz] = c[hz:] / c[:-hz] - 1
    win = ((d.ts >= lo) & (d.ts < hi)).to_numpy()
    idx = np.flatnonzero((s != 0) & win)
    idx = idx[idx < len(c) - hz]
    keep, last = [], -10 ** 9
    for i in idx:
        if i - last >= hz:
            keep.append(i); last = i
    keep = np.asarray(keep, dtype=int)
    if len(keep) == 0:
        return np.array([]), np.array([])
    return fwd[keep] * s[keep], keep


def main():
    lo = pd.Timestamp(C.FIT[0], tz="UTC")
    hi = pd.Timestamp(C.FIT[1], tz="UTC")
    per_sym, pooled = [], []
    for name in rulesets.NAMES:
        pool = {h: [] for h in HORIZONS}
        for sym in C.SYMBOLS:
            d, sig = rulesets.get(sym, name)
            for hz in HORIZONS:
                r, _ = observations(d, sig, hz, lo, hi)
                if len(r) == 0:
                    continue
                pool[hz].append(r)
                t = r.mean() / (r.std(ddof=1) / np.sqrt(len(r))) if len(r) > 1 and r.std(ddof=1) > 0 else 0.0
                per_sym.append(dict(ruleset=name, symbol=sym, horizon=hz, n=len(r),
                                    mean_bps=r.mean() * 1e4, t_stat=t,
                                    hit_rate=float((r > 0).mean())))
        for hz in HORIZONS:
            if not pool[hz]:
                continue
            r = np.concatenate(pool[hz])
            t = r.mean() / (r.std(ddof=1) / np.sqrt(len(r))) if len(r) > 1 and r.std(ddof=1) > 0 else 0.0
            pooled.append(dict(ruleset=name, horizon=hz, n=len(r),
                               mean_bps=r.mean() * 1e4, t_stat=t,
                               hit_rate=float((r > 0).mean()),
                               pass_n=len(r) >= MIN_N[name], pass_t=bool(t > 2 and r.mean() > 0)))

    ps = pd.DataFrame(per_sym); pl = pd.DataFrame(pooled)
    ps.to_csv(f"{C.OUT}/stage1_per_symbol.csv", index=False)
    pl.to_csv(f"{C.OUT}/stage1_pooled.csv", index=False)
    pd.set_option("display.width", 200)
    print("=== POOLED (8 symbols), fit window only ===")
    print(pl.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))

    print("\n=== VERDICT (>=2 ADJACENT horizons with t>2 and mean>0, n above minimum) ===")
    for name in rulesets.NAMES:
        g = pl[pl.ruleset == name].sort_values("horizon").reset_index(drop=True)
        ok = (g.pass_t & g.pass_n).to_numpy()
        adj = any(ok[i] and ok[i + 1] for i in range(len(ok) - 1))
        print(f"  {name:8s} min_n={MIN_N[name]:>5} "
              f"max_n={int(g.n.max()):>7} horizons_passing={int(ok.sum())} "
              f"adjacent_pair={adj}  ->  {'PASS' if adj else 'FAIL'}")


if __name__ == "__main__":
    main()
