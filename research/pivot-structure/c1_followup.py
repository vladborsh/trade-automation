#!/usr/bin/env python3
"""Follow-up on the one anomaly in the post-mortem: control arm C1 (DESIGN.md
§3.1's option-(b) control) is the only cell with positive fit expectancy.

Nothing here promotes C1 -- stage 1 killed the flip event, the holdout is not
read, and C1 is a single control cell. What this does is subject C1's ENTRY
EVENT to the same stage-1 probe the flip event failed, so the Architect gets a
measurement rather than my opinion, plus the per-symbol breadth the §6 economic
bar would have asked for. FIT WINDOW ONLY.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
import pivot, engine
from stage1 import observations, tstat

K0, k0, _ = pivot.PRIMARY
LO = pd.Timestamp(C.FIT[0], tz="UTC"); HI = pd.Timestamp(C.FIT[1], tz="UTC")
HZ = [3, 6, 12, 24, 48]

# ---- 1. stage-1 probe of the C1 entry event (and, for contrast, E1-T2's)
rows = []
for arm in ("C1", "E1-T2"):
    pool = {h: [] for h in HZ}
    for sym in C.SYMBOLS:
        h1 = C.resample_h1(C.load5m(sym))
        ps = pivot.build(h1, K0, k0, "S")
        sig = pivot.ruleset(h1, ps, arm, "S")
        s = sig.sig.to_numpy(); idx = np.flatnonzero(s != 0)
        for hz in HZ:
            r = observations(h1, idx, s[idx].astype(float), hz, LO, HI)
            if len(r):
                pool[hz].append(r)
    for hz in HZ:
        r = np.concatenate(pool[hz])
        rows.append(dict(event=arm, horizon=hz, n=len(r), mean_bps=r.mean() * 1e4,
                         t_stat=tstat(r), pass_t=bool(tstat(r) > 2 and r.mean() > 0)))
p = pd.DataFrame(rows)
p.to_csv(f"{C.OUT}/c1_event_probe.csv", index=False)
pd.set_option("display.width", 200)
print("=== stage-1 probe applied to the C1 entry event (fit, K=15 k=4 Mode S) ===")
print(p.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))

# ---- 2. per-symbol breadth of C1 on the fit window
import diagnostics as D
out = []
for sym in C.SYMBOLS:
    b, s, fl, res = D.run_arm(sym, "S", K0, k0, "C1")
    tr = res["trades"]
    if not len(tr):
        continue
    cost_R = C.COST_RT * tr.entry / tr.risk_px
    g = tr.r + cost_R
    gp = g[g > 0].sum(); gl = -g[g <= 0].sum()
    out.append(dict(symbol=sym, trades=len(tr),
                    exp_R_net=float(tr.r.mean()), exp_R_gross=float(g.mean()),
                    gross_PF=float(gp / gl) if gl > 0 else np.inf,
                    net_PF=float(tr.pnl[tr.pnl > 0].sum() / max(1e-9, -tr.pnl[tr.pnl <= 0].sum())),
                    win_rate=float((tr.pnl > 0).mean())))
b = pd.DataFrame(out)
b.to_csv(f"{C.OUT}/c1_per_symbol.csv", index=False)
print("\n=== C1 per-symbol, fit window (the §6 stage-3 breadth test, for reference only) ===")
print(b.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))
print(f"\ngross PF > 1.0 on {int((b.gross_PF > 1).sum())}/8 symbols; "
      f"pooled trades {int(b.trades.sum())}")

# ---- 3. attribution: is C1's sign the two-tier machinery, or just the major
#         break on its own? Probe the bare major-break event (no flip condition).
rows = []
for K in pivot.GRID_K:
    pool = {h: [] for h in HZ}
    for sym in C.SYMBOLS:
        h1 = C.resample_h1(C.load5m(sym))
        mj = pivot.major_track(h1, K)
        mb = mj.mbreak.to_numpy()
        idx = np.flatnonzero(mb != 0)
        for hz in HZ:
            r = observations(h1, idx, mb[idx].astype(float), hz, LO, HI)
            if len(r):
                pool[hz].append(r)
    for hz in HZ:
        r = np.concatenate(pool[hz])
        rows.append(dict(event=f"major_break_K{K}", horizon=hz, n=len(r),
                         mean_bps=r.mean() * 1e4, t_stat=tstat(r),
                         pass_t=bool(tstat(r) > 2 and r.mean() > 0)))
mbp = pd.DataFrame(rows)
mbp.to_csv(f"{C.OUT}/major_break_probe.csv", index=False)
print("\n=== attribution: the BARE major-break event, no flip condition (fit, 1h) ===")
print(mbp.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))

# ---- 4. breadth of that post-hoc event: per-symbol sign at the two horizons
#         where K=20 clears the stage-1 t-bar. Reported so the Architect can see
#         whether it is one symbol carrying it. Still post-hoc; still fit-only.
rows = []
for sym in C.SYMBOLS:
    h1 = C.resample_h1(C.load5m(sym))
    mj = pivot.major_track(h1, 20)
    mb = mj.mbreak.to_numpy(); idx = np.flatnonzero(mb != 0)
    for hz in (6, 12):
        r = observations(h1, idx, mb[idx].astype(float), hz, LO, HI)
        rows.append(dict(symbol=sym, horizon=hz, n=len(r),
                         mean_bps=r.mean() * 1e4, t_stat=tstat(r)))
bs = pd.DataFrame(rows)
bs.to_csv(f"{C.OUT}/major_break_per_symbol.csv", index=False)
print("\n=== breadth of the post-hoc major-break event, K=20, per symbol (fit) ===")
print(bs.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))
print("positive-mean symbols: "
      + ", ".join(f"h={h}: {int((g.mean_bps>0).sum())}/8" for h, g in bs.groupby("horizon")))
