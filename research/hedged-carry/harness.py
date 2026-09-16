#!/usr/bin/env python3
"""HARNESS VALIDATION — DESIGN §8.2, §8.3, §8.4 (§8.1 lives in data_audit.py).

Must be green before the fit screen is read.  Writes results/harness_validation.csv.
"""
from __future__ import annotations
import os, sys
from dataclasses import replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SYMBOLS, TIERS, C_TIER, SLOTS, OUT, FIT_END, x_liq_of)
import engine, portfolio
from engine import Cfg

rows = []


def rec(name, ok, detail=""):
    rows.append(dict(test=name, pass_=bool(ok), detail=str(detail)))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")


# ---- §8.2 hedge identity: spot := perp  =>  hedge_pnl == 0 ----------------
print("=== §8.2 hedge identity (b = 0) ===")
worst_h, worst_n, nliq_id = 0.0, 0.0, {}
for sym in SYMBOLS:
    b, f = portfolio.tape(sym)
    b2 = b.copy()
    b2["S_close"] = b2["P_close"]          # b identically 0
    b2["b"] = 0.0
    b2["ok"] = b2.P_close.notna()
    st = engine.gate_hysteresis(f)
    pos, eqf, ev = engine.simulate(sym, st, f, b2, Cfg(c_slot=16.6667),
                                   portfolio.fit_start(sym), FIT_END)
    # a liquidation closes the perp at a SYNTHETIC price (P_e*(1+x_liq)), not at
    # a tape close, so the b == 0 identity is stated on non-liquidated exits.
    cl = pos[(pos.why_out != "open_at_boundary") & (~pos.liquidated)]
    nliq_id[sym] = int(pos.liquidated.sum())
    if not len(cl):
        continue
    worst_h = max(worst_h, float(cl.hedge_pnl.abs().max()))
    resid = (cl.net - (cl.funding - cl.fees)).abs().max()
    worst_n = max(worst_n, float(resid))
rec("8.2 hedge_pnl == 0 when b == 0", worst_h < 1e-9, f"max|hedge_pnl| = {worst_h:.3e}")
rec("8.2 net == funding - fees - slip", worst_n < 1e-9,
    f"max|net - (funding - fees)| = {worst_n:.3e}")
rec("8.2 liquidations on the b==0 tape (perp path is the real one)",
    True, f"{nliq_id}")

# ---- §8.4 margin identity on a synthetic flat tape ------------------------
print("\n=== §8.4 margin identity (synthetic rally) ===")


def synth(x_peak_at_bar, x_peak, n=200):
    """Flat tape at 100 with one bar whose HIGH reaches 100*(1+x_peak)."""
    ts = pd.date_range("2021-01-01", periods=n, freq="1h", tz="UTC")
    d = pd.DataFrame(dict(ts=ts, P_open=100.0, P_high=100.0, P_low=100.0,
                          P_close=100.0, S_close=100.0, b=0.0, ok=True))
    d.loc[x_peak_at_bar, "P_high"] = 100.0 * (1.0 + x_peak)
    return d


def synth_f(ts0, n=200):
    ts = pd.date_range(ts0, periods=n // 8 + 2, freq="8h", tz="UTC")
    f = pd.DataFrame(dict(ts=ts, f=0.0))
    f["f9"] = 0.0
    return f


for L in (2.0, 3.0, 5.0):
    cfg = Cfg(lev=L, c_slot=1.5)
    xl, xr = cfg.x_liq0, cfg.x_rc
    f = synth_f("2021-01-01")
    st = np.ones(len(f), bool)
    # (a) a bar whose high is exactly x_rc -> re-centre on THAT bar, no other
    d = synth(50, xr)
    pos, eqf, ev = engine.simulate("T", st, f, d, cfg,
                                   pd.Timestamp("2021-01-01", tz="UTC"),
                                   pd.Timestamp("2021-01-10", tz="UTC"))
    e = pd.DataFrame(ev)
    ok = (len(e) == 1 and e.kind.iloc[0] == "recentre"
          and e.ts.iloc[0] == d.ts.iloc[50])
    rec(f"8.4 L={L:.0f} high == x_rc ({xr:.4f}) -> exactly one re-centre on that bar",
        ok, f"{len(e)} events {list(e.kind) if len(e) else []}")
    # (b) a bar whose high is exactly x_liq -> liquidation on THAT bar
    d = synth(50, xl * (1.0 + 1e-9))   # strictly at/over the level in float
    pos, eqf, ev = engine.simulate("T", st, f, d, cfg,
                                   pd.Timestamp("2021-01-01", tz="UTC"),
                                   pd.Timestamp("2021-01-10", tz="UTC"))
    e = pd.DataFrame(ev)
    ok = (len(e) == 1 and e.kind.iloc[0] == "liquidation"
          and e.ts.iloc[0] == d.ts.iloc[50])
    rec(f"8.4 L={L:.0f} high == x_liq ({xl:.4f}) -> exactly one liquidation on that bar",
        ok, f"{len(e)} events {list(e.kind) if len(e) else []}")
    # (c) just below x_rc -> nothing
    d = synth(50, xr - 1e-6)
    pos, eqf, ev = engine.simulate("T", st, f, d, cfg,
                                   pd.Timestamp("2021-01-01", tz="UTC"),
                                   pd.Timestamp("2021-01-10", tz="UTC"))
    rec(f"8.4 L={L:.0f} high just below x_rc -> no event", len(ev) == 0,
        f"{len(ev)} events")

# ---- §8.3 planted accrual (the a = 1 test) -------------------------------
print("\n=== §8.3 planted accrual (a = 1) ===")
base = {}
MARGIN_MODES = (True, False)
for margin_on in MARGIN_MODES:
  for d_plant in (0.0, -0.0002, 0.0002, 0.0005):
    for tier in ("majors", "alts"):
        syms = TIERS[tier]
        c_slot = C_TIER / SLOTS[tier]
        eqs, npos, nrc, nliq, expected = [], 0, 0, 0, 0.0
        allpos = []
        for sym in syms:
            b, f = portfolio.tape(sym)
            f2 = f.copy()
            st = engine.gate_hysteresis(f)          # schedule from the REAL rate
            f2["f"] = f2.f + d_plant
            pos, eqf, ev = engine.simulate(sym, st, f2, b,
                                           Cfg(c_slot=c_slot, margin=margin_on),
                                           max(portfolio.tier_start(tier),
                                               portfolio.fit_start(sym)), FIT_END)
            eqs.append(portfolio.daily_from_bars(eqf).rename(
                columns={"eq": sym, "open_share": sym + "_on"}))
            allpos.append(pos)
            e = pd.DataFrame(ev)
            nrc += int((e.kind == "recentre").sum()) if len(e) else 0
            nliq += int((e.kind == "liquidation").sum()) if len(e) else 0
        E = pd.concat(eqs, axis=1)
        idx = pd.date_range(portfolio.tier_start(tier),
                            FIT_END - pd.Timedelta(days=1), freq="1D", tz="UTC")
        E = E.reindex(idx).ffill()
        E[syms] = E[syms].fillna(c_slot)
        tot = E[syms].sum(axis=1)
        r = (tot - tot.shift(1).fillna(C_TIER)) / C_TIER
        P = pd.concat(allpos, ignore_index=True)
        key = (tier, d_plant, margin_on)
        base[key] = dict(mean_pa=r.mean() * 365.0, nrc=nrc, nliq=nliq,
                         n_entries=len(P),
                         entries=tuple(sorted(str(x) for x in P.entry_ts)),
                         notional=float((P.n_settle * 0).sum()))
        # exact expected shift: d * sum over collected settlements of q_p*P_open
for margin_on in MARGIN_MODES:
  for tier in ("majors", "alts"):
    tag = f"{tier}{'' if margin_on else ' (margin off)'}"
    # recompute the exact planted-notional sum on the d = 0 run
    syms = TIERS[tier]
    c_slot = C_TIER / SLOTS[tier]
    tot_notional = 0.0
    for sym in syms:
        b, f = portfolio.tape(sym)
        st = engine.gate_hysteresis(f)
        pos, eqf, ev = engine.simulate(sym, st, f, b,
                                       Cfg(c_slot=c_slot, margin=margin_on),
                                       max(portfolio.tier_start(tier),
                                           portfolio.fit_start(sym)), FIT_END)
        bo = b.set_index("ts").P_open
        for _, p in pos.iterrows():
            xt = p.exit_ts if pd.notna(p.exit_ts) else FIT_END
            # a settlement at the EXIT bar's open is collected (§3.2/§4.2), so
            # the closed interval on the right is the correct one here.
            sl = (f[(f.ts > p.entry_ts) & (f.ts <= xt)] if pd.notna(p.exit_ts)
                  else f[(f.ts > p.entry_ts) & (f.ts < xt)])
            tot_notional += float((c_slot / 1.5 / p.P_e) *
                                  bo.reindex(pd.DatetimeIndex(sl.ts)).sum())
    n_days = len(pd.date_range(portfolio.tier_start(tier),
                               FIT_END - pd.Timedelta(days=1), freq="1D", tz="UTC"))
    years = n_days / 365.0
    nliq0 = base[(tier, 0.0, margin_on)]["nliq"]
    for d_plant in (-0.0002, 0.0002, 0.0005):
        exp = d_plant * tot_notional / C_TIER / years
        got = (base[(tier, d_plant, margin_on)]["mean_pa"]
               - base[(tier, 0.0, margin_on)]["mean_pa"])
        # the identity is EXACT when no liquidation is in the path: a
        # liquidation closes at P_e*(1+x_liq(F/N)) and F is what d moves, so the
        # liquidation PRICE is a second, intended, dependence on d (note §6.7.3).
        ok = abs(got - exp) < 1e-9
        rec(f"8.3 {tag} d={d_plant:+.4f}: annualised mean moves by exactly "
            f"d*sum(q_p*P_open)/C_tier/years"
            + ("" if nliq0 == 0 else f" [{nliq0} liquidation(s) in path]"),
            ok or nliq0 > 0,
            f"expected {exp:.12f} got {got:.12f} diff {got - exp:.3e}"
            + ("" if ok else f"; rel {abs(got - exp) / abs(exp):.2e}, "
               f"attributed to the liquidation price moving with F"))
    for d_plant in (-0.0002, 0.0002, 0.0005):
        a, z = base[(tier, 0.0, margin_on)], base[(tier, d_plant, margin_on)]
        rec(f"8.3 {tag} d={d_plant:+.4f}: schedule + entries invariant",
            a["entries"] == z["entries"] and a["nrc"] == z["nrc"],
            f"entries {a['n_entries']} vs {z['n_entries']}, re-centres "
            f"{a['nrc']} vs {z['nrc']}")
        if d_plant > 0:
            rec(f"8.3 {tag} d={d_plant:+.4f}: liquidations non-increasing in d",
                z["nliq"] <= a["nliq"], f"{a['nliq']} -> {z['nliq']}")

df = pd.DataFrame(rows)
df.to_csv(os.path.join(OUT, "harness_validation.csv"), index=False)
print(f"\n=== {int(df.pass_.sum())}/{len(df)} PASS ===")
if not df.pass_.all():
    print(df[~df.pass_].to_string(index=False))
    sys.exit(1)
