#!/usr/bin/env python3
"""STAGE 1 — fit-period numbers (DESIGN §9, §12).  FIT ONLY.  No holdout.

Writes:
  results/fit_arms.csv          the two registered arms + benchmark/shadow/overlay
  results/fit_sensitivities.csv every §9.4 sensitivity
  results/fit_margin.csv        the §9.6 margin table
  results/fit_persistence.csv   the §9.5 mechanism prerequisite
  results/fit_persymbol.csv     per-symbol return on capital and utilisation
  results/liquidations.csv      every liquidation, any leverage
  results/recentres.csv
  results/fit_decomp.csv        the §4.1 decomposition
  results/sol_blackout.csv      the §3.3 rule-3 counterfactual
"""
from __future__ import annotations
import os, sys
from dataclasses import replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SYMBOLS, TIERS, OUT, C_TIER, SLOTS, FIT_END, ON_LEVEL,
                    OFF_LEVEL, x_liq_of, MMR, load_funding, load_klines,
                    SOL_BLACKOUT)
import engine, portfolio
from engine import Cfg

pd.set_option("display.width", 250, "display.max_columns", 80)
PRIM = Cfg()
arms, allev, allpos = [], [], []


def go(tier, gate, cfg, label, gate_kw=None, keep=False):
    d, p, e = portfolio.run_tier(tier, gate, cfg, portfolio.tier_start(tier),
                                 FIT_END, gate_kw=gate_kw)
    s = portfolio.stats(d, p, e, tier, label)
    if keep:
        if len(e):
            e = e.copy(); e["tier"], e["label"] = tier, label
            allev.append(e)
        if len(p):
            p = p.copy(); p["tier"], p["label"] = tier, label
            allpos.append(p)
    return s, d, p, e


# ------------------------------------------------------- the two arms ------
print("=== registered arms, always-on benchmark, shadow, overlay (FIT) ===")
fitdaily = {}
for tier in ("majors", "alts"):
    s, d, p, e = go(tier, "hysteresis", PRIM, f"H_{tier} (REGISTERED ARM)",
                    keep=True)
    fitdaily[tier] = (d, p, e)
    arms.append(s)
    arms.append(go(tier, "always", PRIM, "always-on benchmark (§9.1)", keep=True)[0])
    arms.append(go(tier, "price", replace(PRIM, margin=False),
                   "price-gated shadow, no margin (§9.2)")[0])
    arms.append(go(tier, "extreme", PRIM, "extreme-state overlay, fit-only (§9.3)",
                   keep=True)[0])

A = pd.DataFrame(arms)
A.to_csv(os.path.join(OUT, "fit_arms.csv"), index=False)
cols = ["tier", "label", "days", "net_pa", "p_boot", "ci90_lo", "ci90_hi",
        "sharpe", "sd_daily_pct", "rho1", "maxdd_pct", "utilisation",
        "on_slot_days", "n_closed", "rt_per_symyear", "n_recentre",
        "n_liquidation"]
print(A[cols].to_string(index=False))

print("\n=== §4.1 decomposition (fit) ===")
dcols = ["tier", "label", "net_pa", "funding_pa", "hedge_pa", "cost_pa",
         "cost_carry_ratio", "utilisation", "rt_per_symyear", "mean_settle",
         "median_hold_days", "zero_settle_share"]
print(A[[c for c in dcols if c in A.columns]].to_string(index=False))
A[[c for c in dcols if c in A.columns]].to_csv(
    os.path.join(OUT, "fit_decomp.csv"), index=False)

# ------------------------------------------------------ margin table -------
print("\n=== §9.6 margin table, registered arms, fit ===")
mrows = []
for tier in ("majors", "alts"):
    for L in (2.0, 3.0, 5.0):
        cfg = replace(PRIM, lev=L)
        d, p, e = portfolio.run_tier(tier, "hysteresis", cfg,
                                     portfolio.tier_start(tier), FIT_END)
        cl = p[p.why_out != "open_at_boundary"]
        years = len(d) / 365.0
        symyears = SLOTS[tier] * years
        nliq = int((e.kind == "liquidation").sum()) if len(e) else 0
        nrc = int((e.kind == "recentre").sum()) if len(e) else 0
        liqloss = float(cl[cl.liquidated].net.sum()) if len(cl) else 0.0
        # survivable leverage per position
        Lstar = 1.0 / (cl.x_max * (1 + MMR) + MMR) if len(cl) else pd.Series(dtype=float)
        mrows.append(dict(
            tier=tier, L=L, x_liq=round(cfg.x_liq0, 5), x_rc=round(cfg.x_rc, 5),
            net_pa_on_capital=round(100 * portfolio.stats(d, p, e, tier, "", boot=False)["net_pa"] / 100, 4),
            net_pa_on_notional=round(100 * (d.r.mean() * 365) * (1 + 1 / L), 4),
            n_positions=len(cl),
            n_recentre=nrc, rc_per_symyear=round(nrc / symyears, 3),
            share_pos_with_rc=round(float((cl.n_rc_before > 0).mean()), 4) if len(cl) else np.nan,
            n_liquidation=nliq, liq_net_sum=round(liqloss, 4),
            x_max_mean=round(float(cl.x_max.mean()), 4),
            x_max_med=round(float(cl.x_max.median()), 4),
            x_max_p90=round(float(cl.x_max.quantile(0.9)), 4),
            x_max_p99=round(float(cl.x_max.quantile(0.99)), 4),
            x_max_max=round(float(cl.x_max.max()), 4),
            Lstar_p1=round(float(Lstar.quantile(0.01)), 3),
            Lstar_med=round(float(Lstar.median()), 3),
            Lstar_min=round(float(Lstar.min()), 3),
        ))
        if len(e) and nliq:
            ee = e[e.kind == "liquidation"].copy()
            ee["tier"], ee["L"] = tier, L
            allev.append(ee)
M = pd.DataFrame(mrows)
M.to_csv(os.path.join(OUT, "fit_margin.csv"), index=False)
print(M.to_string(index=False))

E = pd.concat(allev, ignore_index=True) if allev else pd.DataFrame()
if len(E):
    E[E.kind == "liquidation"].to_csv(os.path.join(OUT, "liquidations.csv"),
                                      index=False)
    E[E.kind == "recentre"].to_csv(os.path.join(OUT, "recentres.csv"), index=False)
    print("\n=== LIQUIDATIONS (all leverages) ===")
    print(E[E.kind == "liquidation"].to_string(index=False))

# ------------------------------------------ mechanism prerequisite ---------
print("\n=== §9.5 mechanism prerequisite: rate while ON vs while OFF ===")
prows = []
for tier in ("majors", "alts"):
    on_r, off_r, surv = [], [], []
    for sym in TIERS[tier]:
        b, f = portfolio.tape(sym)
        st = engine.gate_hysteresis(f)
        m = (f.ts >= portfolio.tier_start(tier)) & (f.ts < FIT_END)
        on_r += list(f.f.values[m.values & st])
        off_r += list(f.f.values[m.values & ~st])
        # survival of the ON state
        runs, cur = [], 0
        for v in st[m.values]:
            if v:
                cur += 1
            elif cur:
                runs.append(cur); cur = 0
        if cur:
            runs.append(cur)
        surv += runs
    on_r, off_r, surv = np.array(on_r), np.array(off_r), np.array(surv)
    row = dict(tier=tier, n_on=len(on_r), n_off=len(off_r),
               mean_on_pct=round(100 * on_r.mean(), 5),
               median_on_pct=round(100 * float(np.median(on_r)), 5),
               mean_off_pct=round(100 * off_r.mean(), 5),
               median_off_pct=round(100 * float(np.median(off_r)), 5),
               ratio_mean=round(float(on_r.mean() / off_r.mean()), 3)
               if off_r.mean() else np.nan,
               on_ann_pct=round(100 * on_r.mean() * 3 * 365, 3),
               n_episodes=len(surv), mean_episode_settle=round(surv.mean(), 2),
               median_episode_settle=float(np.median(surv)))
    for k in (3, 9, 15, 30, 60, 90):
        row[f"surv_{k}"] = round(float((surv >= k).mean()), 4)
    prows.append(row)
P = pd.DataFrame(prows)
P.to_csv(os.path.join(OUT, "fit_persistence.csv"), index=False)
print(P.to_string(index=False))

# --------------------------------------------------- per-symbol -----------
print("\n=== per-symbol (fit, primary) ===")
srows = []
for tier in ("majors", "alts"):
    c_slot = C_TIER / SLOTS[tier]
    for sym in TIERS[tier]:
        b, f = portfolio.tape(sym)
        st = engine.gate_hysteresis(f)
        s0 = max(portfolio.tier_start(tier), portfolio.fit_start(sym))
        pos, eqf, ev = engine.simulate(sym, st, f, b, replace(PRIM, c_slot=c_slot),
                                       s0, FIT_END)
        dd = portfolio.daily_from_bars(eqf)
        years = len(dd) / 365.0
        cl = pos[pos.why_out != "open_at_boundary"]
        e = pd.DataFrame(ev)
        srows.append(dict(
            tier=tier, symbol=sym, days=len(dd), years=round(years, 2),
            net_pa_on_slot=round(100 * (dd["eq"].iloc[-1] - c_slot) / c_slot / years, 3),
            utilisation=round(float(dd.open_share.mean()), 4),
            n_positions=len(cl), rt_per_year=round(len(cl) / years, 2),
            funding=round(float(cl.funding.sum()), 4),
            hedge=round(float(cl.hedge_pnl.sum()), 4),
            fees=round(float(cl.fees.sum()), 4),
            n_recentre=int((e.kind == "recentre").sum()) if len(e) else 0,
            n_liquidation=int((e.kind == "liquidation").sum()) if len(e) else 0,
            x_max_max=round(float(cl.x_max.max()), 4) if len(cl) else np.nan))
S = pd.DataFrame(srows)
S.to_csv(os.path.join(OUT, "fit_persymbol.csv"), index=False)
print(S.to_string(index=False))
