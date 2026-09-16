#!/usr/bin/env python3
"""STAGE 2 — HOLDOUT, READ ONCE (DESIGN §3.4, §10).

Runs ONLY the arms listed in results/screen.json as screened_in.  Refuses to
run if that file does not exist (the screen decision must be a commit first)
or if results/holdout.csv already exists (the holdout is read once).

Writes results/holdout.csv, results/holdout_margin.csv, results/tail.csv.
"""
from __future__ import annotations
import json, os, sys
from dataclasses import replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (TIERS, OUT, C_TIER, SLOTS, HOLD_START, HOLD_END, MMR,
                    TAIL_START, TAIL_END, ann_mean)
import engine, portfolio
from engine import Cfg

pd.set_option("display.width", 250, "display.max_columns", 80)
SCREEN = os.path.join(OUT, "screen.json")
OUTF = os.path.join(OUT, "holdout.csv")
if not os.path.exists(SCREEN):
    sys.exit("REFUSING: results/screen.json does not exist — the screen "
             "decision must be committed before the holdout is touched.")
if os.path.exists(OUTF) and "--force" not in sys.argv:
    sys.exit("REFUSING: results/holdout.csv already exists — the holdout is "
             "read ONCE.")
sc = json.load(open(SCREEN))
arms = [a for a, v in sc["arms"].items() if v["decision"] == "SCREENED IN"]
print(f"screened in: {arms}")
print(f"screened out (holdout NOT computed): "
      f"{[a for a, v in sc['arms'].items() if v['decision'] != 'SCREENED IN']}")

PRIM = Cfg()
rows, mrows, trows = [], [], []
for arm in arms:
    tier = arm.replace("H_", "")
    d, p, e = portfolio.run_tier(tier, "hysteresis", PRIM, HOLD_START, HOLD_END)
    s = portfolio.stats(d, p, e, tier, arm)
    rows.append(s)
    d.to_csv(os.path.join(OUT, f"holdout_daily_{tier}.csv"))
    p.to_csv(os.path.join(OUT, f"holdout_positions_{tier}.csv"), index=False)
    # mandatory benchmark on the same window
    for gate, cfg, lab in (("always", PRIM, "always-on benchmark (§9.1)"),
                           ("price", replace(PRIM, margin=False),
                            "price-gated shadow (§9.2)")):
        dd, pp, ee = portfolio.run_tier(tier, gate, cfg, HOLD_START, HOLD_END)
        rows.append(portfolio.stats(dd, pp, ee, tier, lab))
    # margin table on the holdout
    for L in (2.0, 3.0, 5.0):
        dd, pp, ee = portfolio.run_tier(tier, "hysteresis", replace(PRIM, lev=L),
                                        HOLD_START, HOLD_END)
        cl = pp[pp.why_out != "open_at_boundary"]
        nliq = int((ee.kind == "liquidation").sum()) if len(ee) else 0
        Lst = 1.0 / (cl.x_max * (1 + MMR) + MMR) if len(cl) else pd.Series(dtype=float)
        mrows.append(dict(tier=tier, L=L,
                          capital_pa=round(100 * ann_mean(dd.r.values), 3),
                          notional_pa=round(100 * ann_mean(dd.r.values) * (1 + 1 / L), 3),
                          n_positions=len(cl),
                          n_recentre=int((ee.kind == "recentre").sum()) if len(ee) else 0,
                          n_liquidation=nliq,
                          x_max_mean=round(float(cl.x_max.mean()), 4),
                          x_max_p90=round(float(cl.x_max.quantile(0.9)), 4),
                          x_max_p99=round(float(cl.x_max.quantile(0.99)), 4),
                          x_max_max=round(float(cl.x_max.max()), 4),
                          Lstar_min=round(float(Lst.min()), 3),
                          Lstar_p1=round(float(Lst.quantile(0.01)), 3)))
        if nliq:
            ee[ee.kind == "liquidation"].assign(tier=tier, L=L).to_csv(
                os.path.join(OUT, f"holdout_liquidations_{tier}_L{int(L)}.csv"),
                index=False)
    # tail (non-gating)
    dt, pt, et = portfolio.run_tier(tier, "hysteresis", PRIM, TAIL_START, TAIL_END)
    trows.append(portfolio.stats(dt, pt, et, tier, f"{arm} TAIL 2026-08", boot=False))

H = pd.DataFrame(rows)
H.to_csv(OUTF, index=False)
pd.DataFrame(mrows).to_csv(os.path.join(OUT, "holdout_margin.csv"), index=False)
pd.DataFrame(trows).to_csv(os.path.join(OUT, "tail.csv"), index=False)
cols = ["tier", "label", "days", "net_pa", "p_boot", "ci90_lo", "ci90_hi",
        "sharpe", "sd_daily_pct", "rho1", "maxdd_pct", "utilisation",
        "on_slot_days", "n_closed", "rt_per_symyear", "n_recentre",
        "n_liquidation", "funding_pa", "hedge_pa", "cost_pa", "cost_carry_ratio"]
print("\n=== HOLDOUT ===")
print(H[[c for c in cols if c in H.columns]].to_string(index=False))
print("\n=== holdout margin ===")
print(pd.DataFrame(mrows).to_string(index=False))
print("\n=== tail (non-gating) ===")
print(pd.DataFrame(trows)[[c for c in cols if c in pd.DataFrame(trows).columns]]
      .to_string(index=False))
