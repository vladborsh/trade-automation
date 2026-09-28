#!/usr/bin/env python3
"""Stage 1 — fit period only (DESIGN §5, §6.1).  Writes results/fit_*.csv and
prints the screen decision.  The holdout is never simulated here.
"""
from __future__ import annotations
import json, os
import numpy as np
import pandas as pd

from common import OUT, LABELS, L_SPOT, L_INVALID
from engine import load_all, select, summary, placebo
from analysis import evaluate, breakdown, MARGIN

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 40)

O, B = load_all()
assert set(O.window.unique()) == {"fit"}, "stage 1 must not see the holdout"

tab, trades, M = evaluate(O, "fit")
tab.to_csv(os.path.join(OUT, "fit_arms.csv"), index=False)
bd = pd.concat([breakdown(trades, a, s) for a in ("L1", "L1c", "L2", "L3", "L4B", "L4F")
                for s in (False, True) if not (a == "L4B" and s)])
bd.to_csv(os.path.join(OUT, "fit_breakdown.csv"), index=False)
with open(os.path.join(OUT, "fit_margins.json"), "w") as fh:
    json.dump(M, fh, indent=1, default=float)
print(tab.round(4).to_string())
print(json.dumps(M, indent=1, default=float))

# ---- screen (DESIGN §6.1) -------------------------------------------------------
def row(arm, var="real"):
    return tab[(tab.arm == arm) & (tab.variant == var)].iloc[0]

from common import FIT_END as _FE
SYM_YEARS = sum((_FE - pd.Timestamp(g.t_entry.min())).days / 365.25
                for _, g in O.groupby("symbol"))
def proj(n):          # projected pooled holdout n: fit rate per symbol-year x 8
    return n / SYM_YEARS * 8

screen = {}
for arm in ("L1", "L2", "L3"):
    r = row(arm)
    m = M[f"{arm}_shadow_margin"]
    c = dict(floor=r.n >= 60, stat=r.netR >= MARGIN, placebo=r.placebo_p <= 0.20,
             shadow_i=m["diff"] >= MARGIN, shadow_ii=m["lo"] > 0)
    if arm == "L1":
        k = M["L1_contrast_vs_L1c"]
        c.update(contrast_i=k["diff"] >= MARGIN, contrast_ii=k["lo"] > 0)
    c["proj_holdout_n"] = proj(r.n)
    screen[arm] = c
F, Bs = row("L4F"), row("L4B")
m, d = M["L4_shadow_margin"], M["L4_delta"]
screen["L4"] = dict(floor=F.n >= 60, stat=d["diff"] >= MARGIN, keep=d["keep"] >= 0.5,
                    placebo=F.placebo_p <= 0.20, shadow_i=m["diff"] >= MARGIN,
                    shadow_ii=m["lo"] > 0,
                    proj_holdout_n=proj(F.n))
for a, c in screen.items():
    c["SCREEN_IN"] = all(v for k, v in c.items() if k != "proj_holdout_n")
    print(a, c)
with open(os.path.join(OUT, "fit_screen.json"), "w") as fh:
    json.dump(screen, fh, indent=1, default=lambda x: bool(x) if isinstance(x, np.bool_) else float(x))

# ---- descriptive (DESIGN §5.5, fit only) ------------------------------------------
from common import FIT_END
V = B[B.valid & (pd.DatetimeIndex(B.t_close) < FIT_END)].copy()
names = {i: n for i, n in enumerate(LABELS)}
V["lab"] = V.label.map(names)
freq = V.groupby("symbol").lab.value_counts(normalize=True).unstack().round(4)
freq.loc["pooled"] = V.lab.value_counts(normalize=True).round(4)
freq.to_csv(os.path.join(OUT, "fit_label_freq.csv"))
print(freq)

B2 = B.copy()
B2["lab"] = B2.label.map(names).where(B2.label != L_INVALID, "INVALID")
B2 = B2[pd.DatetimeIndex(B2.t_close) < FIT_END]
tr_rows = []
for s, g in B2.groupby("symbol"):
    a, b = g.lab.to_numpy()[:-1], g.lab.to_numpy()[1:]
    tr_rows.append(pd.DataFrame({"from": a, "to": b}))
T = pd.concat(tr_rows)
T = T[(T["from"] != "INVALID") & (T["to"] != "INVALID")]
trans = pd.crosstab(T["from"], T["to"], normalize="index").round(3)
trans.to_csv(os.path.join(OUT, "fit_transition_matrix.csv"))
print(trans)

pers = []
for s, g in B2.groupby("symbol"):
    lab = g.lab.to_numpy()
    runs = (lab[1:] != lab[:-1]).cumsum()
    rl = pd.DataFrame({"lab": lab[1:], "run": runs}).groupby("run").agg(
        lab=("lab", "first"), n=("lab", "size"))
    pers.append(rl)
pers = pd.concat(pers).groupby("lab").n.mean().round(3)
pers.to_csv(os.path.join(OUT, "fit_persistence.csv"))
print("mean run length (bars):", pers.to_dict())

V["ret_atr"] = V.ret * V.close / V.atr
cont = V.groupby("lab").ret_atr.describe()[["count", "mean", "25%", "50%", "75%"]].round(3)
cont.to_csv(os.path.join(OUT, "fit_contemporaneous_ret.csv"))
print(cont)

fw = []
for s, g in B[B.symbol == B.symbol].groupby("symbol"):
    g = g.reset_index(drop=True)
    for h in (6, 12, 18, 24, 30):
        f = (g.close.shift(-h) - g.close) / g.atr
        # a forward window may not read a price at/after the fit boundary
        endT = pd.DatetimeIndex(g.t_close).shift(4 * h, freq="h")
        f[endT >= FIT_END] = np.nan
        fw.append(pd.DataFrame({"symbol": s, "h": h, "label": g.label, "valid": g.valid,
                                "t": g.t_close, "fwd_atr": f}))
fw = pd.concat(fw)
fw = fw[fw.valid & (pd.DatetimeIndex(fw.t) < FIT_END)]
fw["lab"] = fw.label.map(names)
prof = fw.groupby(["lab", "h"]).fwd_atr.agg(["count", "mean", "median"]).round(4)
prof.to_csv(os.path.join(OUT, "fit_forward_profile.csv"))
print(prof.unstack("h"))

# §1.4 descriptive variant: SPOT_LED and spot CVD > perp CVD
Bv = B[["symbol", "bar", "cvd_spot", "cvd_perp"]]
Ov = O.merge(Bv, on=["symbol", "bar"])
tv, _ = select(Ov, "fit", 1, lambda d: (d.label == L_SPOT) & (d.cvd_spot > d.cvd_perp))
pv, _ = placebo(Ov, tv, lambda d: np.ones(len(d), bool))
var = dict(summary(tv), placebo_p=pv)
print("variant spot>perp:", var)
pd.DataFrame([var]).to_csv(os.path.join(OUT, "fit_variant_spot_gt_perp.csv"), index=False)
