#!/usr/bin/env python3
"""STAGE 1c — the three rows that stage1_extras could not produce correctly:
the f-window sensitivity (window is now a real parameter), the Reading-B row
(step days excluded), the spot-as-collateral counterfactual with its
decomposition, and the SOL FTX-week counterfactual.  FIT ONLY.
"""
from __future__ import annotations
import os, sys
from dataclasses import replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (TIERS, OUT, C_TIER, SLOTS, FIT_END, SOL_BLACKOUT,
                    SOL_LAST_BAR_BEFORE, ann_mean, load_funding)
import engine, portfolio
from engine import Cfg

pd.set_option("display.width", 250, "display.max_columns", 80)
PRIM = Cfg()
KEEP = ["tier", "label", "net_pa", "p_boot", "sharpe", "maxdd_pct",
        "utilisation", "n_closed", "rt_per_symyear", "n_recentre",
        "n_liquidation", "funding_pa", "hedge_pa", "cost_pa"]

print("=== f9-window sensitivity (fit-only) ===")
rows = []
for tier in ("majors", "alts"):
    for w in (3, 9, 15):
        d, p, e = portfolio.run_tier(tier, "hysteresis", PRIM,
                                     portfolio.tier_start(tier), FIT_END,
                                     f9_window=w)
        s = portfolio.stats(d, p, e, tier,
                            f"f9 window {w} settlements" + (" (PRIMARY)" if w == 9 else ""))
        rows.append({k: s.get(k) for k in KEEP})
W = pd.DataFrame(rows)
W.to_csv(os.path.join(OUT, "fit_sens_window.csv"), index=False)
print(W.to_string(index=False))

print("\n=== Reading-B descriptive row, step days excluded (fit only) ===")
bro = []
for tier in ("majors", "alts"):
    syms, c_slot = TIERS[tier], C_TIER / SLOTS[tier]
    eqs = {}
    for sym in syms:
        b, f = portfolio.tape(sym)
        st = engine.gate_hysteresis(f)
        pos, eqf, ev = engine.simulate(sym, st, f, b, replace(PRIM, c_slot=c_slot),
                                       portfolio.fit_start(sym), FIT_END)
        eqs[sym] = portfolio.daily_from_bars(eqf)["eq"]
    E = pd.DataFrame(eqs)
    idx = pd.date_range(min(portfolio.fit_start(s) for s in syms),
                        FIT_END - pd.Timedelta(days=1), freq="1D", tz="UTC")
    E = E.reindex(idx).ffill()
    live = E.notna()
    # a slot contributes to day d only if it was live on BOTH d-1 and d, so a
    # newly listed slot never enters as a +C_slot jump.
    pair = live & live.shift(1).fillna(False)
    dE = (E.diff() * pair).sum(axis=1)
    denom = pair.sum(axis=1) * c_slot
    r = (dE / denom.replace(0, np.nan)).fillna(0.0)
    steps = live.sum(axis=1)
    ch = steps[steps.diff().fillna(steps.iloc[0]) != 0]
    bro.append(dict(tier=tier, days=len(r), first_day=str(idx[0].date()),
                    net_pa=round(100 * ann_mean(r.values), 3),
                    reading_A_net_pa=round(
                        100 * ann_mean(portfolio.run_tier(
                            tier, "hysteresis", PRIM, portfolio.tier_start(tier),
                            FIT_END)[0].r.values), 3),
                    slot_count_steps="; ".join(f"{d.date()}→{int(n)}"
                                               for d, n in ch.items()),
                    share_days_below_full=round(
                        float((steps < len(syms)).mean()), 4)))
B = pd.DataFrame(bro)
B.to_csv(os.path.join(OUT, "fit_readingB.csv"), index=False)
print(B.to_string(index=False))
print("Descriptive, non-gating (ARCHITECT-RULING-2026-09-16-tier-start §2).")

print("\n=== spot-as-collateral counterfactual, majors only (descriptive) ===")
crows = []
d0, p0, e0 = portfolio.run_tier("majors", "hysteresis", PRIM,
                                portfolio.tier_start("majors"), FIT_END)
s0 = portfolio.stats(d0, p0, e0, "majors", "primary", boot=False)
dC, pC, eC = portfolio.run_tier("majors", "hysteresis", replace(PRIM, margin=False),
                                portfolio.tier_start("majors"), FIT_END)
sC = portfolio.stats(dC, pC, eC, "majors", "no re-centre", boot=False)
clC = pC[pC.why_out != "open_at_boundary"]
crows.append(dict(row="primary L=2, isolated USDT, spot NOT collateral",
                  capital_basis="C_slot = 1.5 N",
                  net_pa=s0["net_pa"], funding_pa=s0["funding_pa"],
                  hedge_pa=s0["hedge_pa"], cost_pa=s0["cost_pa"],
                  n_closed=s0["n_closed"], n_recentre=s0["n_recentre"]))
crows.append(dict(row="same, re-centres removed (x_liq unbounded)",
                  capital_basis="C_slot = 1.5 N",
                  net_pa=sC["net_pa"], funding_pa=sC["funding_pa"],
                  hedge_pa=sC["hedge_pa"], cost_pa=sC["cost_pa"],
                  n_closed=sC["n_closed"], n_recentre=sC["n_recentre"]))
crows.append(dict(row="spot as collateral at a 90% haircut: N = C_slot/1.1",
                  capital_basis="C_slot = 1.1 N",
                  net_pa=round(sC["net_pa"] * 1.5 / 1.1, 3),
                  funding_pa=round(sC["funding_pa"] * 1.5 / 1.1, 3),
                  hedge_pa=round(sC["hedge_pa"] * 1.5 / 1.1, 3),
                  cost_pa=round(sC["cost_pa"] * 1.5 / 1.1, 3),
                  n_closed=sC["n_closed"], n_recentre=0))
C = pd.DataFrame(crows)
C.to_csv(os.path.join(OUT, "capital_collateral.csv"), index=False)
print(C.to_string(index=False))
big = clC.sort_values("funding", ascending=False).head(3)
print("\nWHERE THE LIFT COMES FROM — the three largest un-re-centred positions:")
print(big[["symbol", "entry_ts", "exit_ts", "P_e", "P_x", "n_settle",
           "funding", "hedge_pnl"]].to_string(index=False))
print(f"\nSlot capital is {C_TIER / SLOTS['majors']:.1f} USDT.  The lift is NOT the "
      f"1.5 -> 1.1 denominator (worth 1.364x); it is the perp notional "
      f"compounding with price while capital stays fixed: funding_pa goes "
      f"{s0['funding_pa']:.2f}% -> {sC['funding_pa']:.2f}% because a short that "
      f"is never re-hedged collects on a notional that grew with the rally.  "
      f"Those same positions reach x_max far beyond x_liq and are exactly the "
      f"ones the primary account cannot hold.  Descriptive only.")
print("The six alts are NOT eligible collateral in Binance Multi-Assets Mode "
      "as published, so this counterfactual does not apply to them (§9.4).")

print("\n=== §3.3 rule 3: SOL FTX-week blackout counterfactual ===")
f_all = load_funding("SOLUSDT")
a, z = SOL_BLACKOUT
bl = f_all[(f_all.ts >= a) & (f_all.ts < z)]
b, f = portfolio.tape("SOLUSDT")
bb = b.set_index("ts")
d, p, e = portfolio.run_tier("alts", "hysteresis", PRIM,
                             portfolio.tier_start("alts"), FIT_END)
sol = p[p.symbol == "SOLUSDT"]
open_at = sol[(sol.entry_ts <= SOL_LAST_BAR_BEFORE) &
              ((sol.exit_ts.isna()) | (sol.exit_ts >= SOL_LAST_BAR_BEFORE))]
N = C_TIER / SLOTS["alts"] / 1.5
# counterfactual: a position entered at the last bar before the blackout and
# held to the first normal settlement, at the printed rates
P_ref = float(bb.loc[SOL_LAST_BAR_BEFORE, "P_close"])
q_p = N / P_ref
cf = 0.0
for _, s in bl.iterrows():
    po = bb.P_open.get(s.ts, np.nan)
    if not np.isnan(po):
        cf += s.last_funding_rate * q_p * po
rows = [dict(
    blackout_span=f"{a} .. {z}",
    blackout_rows=len(bl),
    interval_hours=str(bl.funding_interval_hours.value_counts().to_dict()),
    rate_min=float(bl.last_funding_rate.min()),
    rate_max=float(bl.last_funding_rate.max()),
    n_rows_at_minus2pct_cap=int((bl.last_funding_rate <= -0.02 + 1e-12).sum()),
    sol_position_open_at_blackout_start=len(open_at),
    unwound_at=(str(open_at.exit_ts.iloc[0]) if len(open_at) else "n/a — the gate "
                "was OFF on SOL at 2022-11-09 19:00, so no position was unwound"),
    counterfactual_funding_usdt=round(cf, 6),
    counterfactual_pct_of_C_tier=round(100 * cf / C_TIER, 5),
    note="A SHORT perp PAYS when the rate is negative; the blackout rates are "
         "overwhelmingly negative and part of them sit at the -2% cap, so "
         "holding through would have COST this much.")]
SB = pd.DataFrame(rows)
SB.to_csv(os.path.join(OUT, "sol_blackout.csv"), index=False)
for k, v in rows[0].items():
    print(f"  {k}: {v}")
