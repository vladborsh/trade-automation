#!/usr/bin/env python3
"""§5.5 gross-economics and breadth numbers for the record.

Computed with mtf.sim_R (same fill/exit mechanics as the engine, no sizing and no
daily breaker) so gross and net R are separable per trade. FIT WINDOW ONLY -- the
rule-sets are already dead at stage 1; this just prices how far from the §5.5 bar
they were.
"""
import numpy as np, pandas as pd
import common as C, mtf, rulesets

LO = pd.Timestamp(C.FIT[0], tz="UTC"); HI = pd.Timestamp(C.FIT[1], tz="UTC")
rows = []
for name in rulesets.NAMES:
    per = []
    for sym in C.SYMBOLS:
        d, sig = rulesets.get(sym, name)
        m = ((d.ts >= LO) & (d.ts < HI)).to_numpy()
        q = mtf.sim_R(d.loc[m].reset_index(drop=True),
                      sig.loc[m, ["sig", "stop", "target"]].reset_index(drop=True), mtf.P)
        gw = q.gross_R[q.gross_R > 0].sum(); gl = -q.gross_R[q.gross_R <= 0].sum()
        nw = q.net_R[q.net_R > 0].sum(); nl = -q.net_R[q.net_R <= 0].sum()
        per.append(dict(ruleset=name, symbol=sym, trades=len(q),
                        gross_exp_R=q.gross_R.mean(), net_exp_R=q.net_R.mean(),
                        gross_pf=gw / gl if gl else np.inf, net_pf=nw / nl if nl else np.inf,
                        cost_R_median=float(np.median(C.COST_RT / q.stop_pct))))
    p = pd.DataFrame(per)
    rows.append(p)
    n = p.trades.sum()
    ge = float(np.average(p.gross_exp_R, weights=p.trades))
    ne = float(np.average(p.net_exp_R, weights=p.trades))
    cr = float(p.cost_R_median.median())
    print(f"{name:8s} trades {n:>6}  gross_exp {ge:+.4f} R  net_exp {ne:+.4f} R  "
          f"median cost_R {cr:.3f}  bar(3x cost_R)={3*cr:+.3f} R  "
          f"gross PF>1 on {int((p.gross_pf > 1).sum())}/8  "
          f"net PF median {p.net_pf.median():.3f}  -> gross bar {'MET' if ge >= 3*cr else 'MISSED'}")
pd.concat(rows).to_csv(f"{C.OUT}/gross_breadth_fit.csv", index=False)
