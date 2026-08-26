#!/usr/bin/env python3
"""STAGE 1 -- flip-event edge probe (DESIGN.md §6, stage 1). The gate.

Same methodology as v1's `edge_probe.py` / the MTF pass's `stage1.py`:
direction-adjusted forward returns on NON-OVERLAPPING events, no stops, no
targets, no costs -- "does the event see anything".

Two event classes are probed separately:
  * `flip`   -- the minor-CHoCH flip itself (arms E1-*)
  * `retest` -- the E2 retest touch after a flip (arm E2-T2)

Pass bar for the PRIMARY config (K=15, k=4, Mode S), fit window only:
  pooled mean positive with t > 2 at >= 2 ADJACENT horizons, on >= 1000 flips.
Grid interpretation rule (§6): a passing cell is credible only if its (K, k)
neighbours share the sign; an isolated passing cell is reported as noise.
"""
from __future__ import annotations
import sys, time
import numpy as np
import pandas as pd

import common as C
import pivot

HZ = {"S": [3, 6, 12, 24, 48], "M": [3, 6, 12, 24, 48, 96, 144]}
MIN_N = 1000
LO = pd.Timestamp(C.FIT[0], tz="UTC"); HI = pd.Timestamp(C.FIT[1], tz="UTC")


def observations(d, ev_idx, ev_dir, hz, lo, hi):
    """De-overlapped, direction-adjusted forward returns for events in [lo, hi)."""
    c = d.close.to_numpy()
    fwd = np.full(len(c), np.nan)
    fwd[:-hz] = c[hz:] / c[:-hz] - 1
    win = ((d.ts >= lo) & (d.ts < hi)).to_numpy()
    keep, last = [], -10 ** 9
    for j, i in enumerate(ev_idx):
        if i >= len(c) - hz:
            continue
        if not win[i]:
            continue
        if i - last >= hz:
            keep.append(j); last = i
    if not keep:
        return np.array([])
    keep = np.asarray(keep)
    return fwd[ev_idx[keep]] * ev_dir[keep]


def events(df, ps, mode, kind):
    """Event bar indices and their direction."""
    fl = ps.flip.to_numpy()
    idx = np.flatnonzero(fl != 0)
    if kind == "flip":
        return idx, fl[idx].astype(float)
    # retest touch: reuse the arm's own entry bars so probe and arm share an event
    sig = pivot.ruleset(df, ps, "E2-T2", mode)
    s = sig.sig.to_numpy()
    ridx = np.flatnonzero(s != 0)
    return ridx, s[ridx].astype(float)


def tstat(r):
    if len(r) < 2 or r.std(ddof=1) == 0:
        return 0.0
    return float(r.mean() / (r.std(ddof=1) / np.sqrt(len(r))))


def main():
    modes = sys.argv[1].split(",") if len(sys.argv) > 1 else ["S", "M"]
    rows, per_sym = [], []
    for mode in modes:
        pool = {}
        for sym in C.SYMBOLS:
            t0 = time.time()
            d5 = C.load5m(sym)
            base = C.resample_h1(d5) if mode == "S" else d5
            for K in pivot.GRID_K:
                mj = None if mode == "S" else pivot.merge_major_h1(d5, K)
                for k in pivot.GRID_k:
                    ps = pivot.pivot_structure(base, K, k, major=mj)
                    for kind in ("flip", "retest"):
                        ei, ed = events(base, ps, mode, kind)
                        for hz in HZ[mode]:
                            r = observations(base, ei, ed, hz, LO, HI)
                            if len(r) == 0:
                                continue
                            pool.setdefault((K, k, kind, hz), []).append(r)
                            per_sym.append(dict(mode=mode, K=K, k=k, kind=kind,
                                                symbol=sym, horizon=hz, n=len(r),
                                                mean_bps=r.mean() * 1e4, t_stat=tstat(r)))
            print(f"  {mode} {sym}: {time.time()-t0:.1f}s", flush=True)
        for (K, k, kind, hz), lst in pool.items():
            r = np.concatenate(lst)
            rows.append(dict(mode=mode, K=K, k=k, kind=kind, horizon=hz, n=len(r),
                             mean_bps=r.mean() * 1e4, t_stat=tstat(r),
                             hit_rate=float((r > 0).mean()),
                             pass_n=bool(len(r) >= MIN_N),
                             pass_t=bool(tstat(r) > 2 and r.mean() > 0)))

    pl = pd.DataFrame(rows).sort_values(["mode", "kind", "K", "k", "horizon"])
    ps_ = pd.DataFrame(per_sym)
    tag = "" if len(modes) == 2 else "_" + "".join(modes)
    pl.to_csv(f"{C.OUT}/stage1_pooled{tag}.csv", index=False)
    ps_.to_csv(f"{C.OUT}/stage1_per_symbol{tag}.csv", index=False)

    pd.set_option("display.width", 220)
    print("\n=== PRIMARY CONFIG K=15 k=4 Mode S, pooled, fit window ===")
    g = pl[(pl["mode"] == "S") & (pl.K == 15) & (pl.k == 4)]
    print(g.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))

    print("\n=== VERDICT per (mode, kind, K, k): >=2 ADJACENT horizons t>2, mean>0, n>=1000 ===")
    ver = []
    for (mode, kind, K, k), g in pl.groupby(["mode", "kind", "K", "k"]):
        g = g.sort_values("horizon").reset_index(drop=True)
        ok = (g.pass_t & g.pass_n).to_numpy()
        adj = any(ok[i] and ok[i + 1] for i in range(len(ok) - 1))
        ver.append(dict(mode=mode, kind=kind, K=K, k=k, n=int(g.n.max()),
                        mean_bps_med=float(g.mean_bps.median()),
                        t_max=float(g.t_stat.max()), t_min=float(g.t_stat.min()),
                        horizons_passing=int(ok.sum()), adjacent=bool(adj),
                        verdict="PASS" if adj else "FAIL"))
    v = pd.DataFrame(ver).sort_values(["mode", "kind", "K", "k"])
    v.to_csv(f"{C.OUT}/stage1_verdict{tag}.csv", index=False)
    print(v.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))
    print(f"\nPASS cells: {int((v.verdict=='PASS').sum())} / {len(v)}")


if __name__ == "__main__":
    main()
