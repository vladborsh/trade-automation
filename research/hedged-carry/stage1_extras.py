#!/usr/bin/env python3
"""STAGE 1b — sensitivities, nulls and the remaining descriptive rows (FIT ONLY).

Writes results/fit_sensitivities.csv, results/fit_nulls.csv,
results/sol_blackout.csv, results/fit_readingB.csv, results/capital_eff.csv.
"""
from __future__ import annotations
import os, sys
from dataclasses import replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SYMBOLS, TIERS, OUT, C_TIER, SLOTS, FIT_END, MMR,
                    load_funding, SOL_BLACKOUT, ann_mean, x_liq_of)
import engine, portfolio
from engine import Cfg

pd.set_option("display.width", 250, "display.max_columns", 80)
PRIM = Cfg()
KEEP = ["tier", "label", "net_pa", "p_boot", "sharpe", "maxdd_pct",
        "utilisation", "n_closed", "rt_per_symyear", "n_recentre",
        "n_liquidation", "funding_pa", "hedge_pa", "cost_pa"]


def row(tier, gate, cfg, label, gate_kw=None):
    d, p, e = portfolio.run_tier(tier, gate, cfg, portfolio.tier_start(tier),
                                 FIT_END, gate_kw=gate_kw)
    s = portfolio.stats(d, p, e, tier, label)
    return {k: s.get(k) for k in KEEP}, d


# ---------------------------------------------------------- sensitivities --
print("=== §9.4 sensitivities — ALL FIT-ONLY, NOT A RESCUE ===")
rows = []
for tier in ("majors", "alts"):
    rows.append(row(tier, "hysteresis", PRIM, "PRIMARY (reference)")[0])
    # gate
    for on, off, lab in ((0.00015, 0.00005, "gate ON 0.015%"),
                         (0.0003, 0.00005, "gate ON 0.03%"),
                         (0.0002, 0.0, "gate OFF 0%"),
                         (0.0002, 0.0001, "gate OFF 0.01%")):
        rows.append(row(tier, "hysteresis", PRIM, lab,
                        gate_kw=dict(on=on, off=off))[0])
    for w, lab in ((3, "f-window 3 settlements"), (15, "f-window 15 settlements")):
        import engine as _e
        old = _e.F9_WINDOW if hasattr(_e, "F9_WINDOW") else None
        # window is a module-level constant used inside settlements(); rebuild
        import common
        common.F9_WINDOW = w
        portfolio._CACHE.clear()
        rows.append(row(tier, "hysteresis", PRIM, lab)[0])
        common.F9_WINDOW = 9
        portfolio._CACHE.clear()
    # costs
    rows.append(row(tier, "hysteresis", replace(PRIM, perp_maker_fee=0.0002),
                    "perp MAKER on entry + gate-OFF exit (~0.30% RT)")[0])
    rows.append(row(tier, "hysteresis",
                    replace(PRIM, spot_fee=0.00075, perp_fee=0.00045),
                    "BNB fee discount")[0])
    rows.append(row(tier, "hysteresis", replace(PRIM, slip=0.0004),
                    "slippage doubled (0.16%)")[0])
    rows.append(row(tier, "hysteresis",
                    replace(PRIM, spot_fee=0.0, perp_fee=0.0, slip=0.0,
                            liq_fee=0.0), "ZERO cost (= gross)")[0])
    rows.append(row(tier, "hysteresis", replace(PRIM, exit_fee_on_exit_notional=True),
                    "fees on ACTUAL exit notional (ruling §4(b))")[0])
    # margin
    for L in (3.0, 5.0):
        rows.append(row(tier, "hysteresis", replace(PRIM, lev=L), f"L = {L:.0f}")[0])
    rows.append(row(tier, "hysteresis", replace(PRIM, rc_frac=0.75),
                    "re-centre at 0.75 x buffer")[0])
    # published mmr table: worst (highest) lowest-bracket value on each tier
    mt = pd.read_csv(os.path.join(OUT, "margin_table.csv"))
    low = mt[mt.bracket == 1].set_index("symbol").mmr
    worst = float(low[TIERS[tier]].max())
    rows.append(row(tier, "hysteresis", replace(PRIM, mmr=worst),
                    f"published mmr (worst on tier = {worst:.2%})")[0])
S = pd.DataFrame(rows)
S.to_csv(os.path.join(OUT, "fit_sensitivities.csv"), index=False)
print(S.to_string(index=False))

# --------------------------------------------- capital efficiency table ----
print("\n=== §9.6 capital efficiency: return on capital vs on notional ===")
ce = []
for tier in ("majors", "alts"):
    for L in (2.0, 3.0, 5.0):
        d, p, e = portfolio.run_tier(tier, "hysteresis", replace(PRIM, lev=L),
                                     portfolio.tier_start(tier), FIT_END)
        cap = 100 * ann_mean(d.r.values)
        ce.append(dict(tier=tier, L=L, capital_pa=round(cap, 3),
                       notional_pa=round(cap * (1 + 1 / L), 3),
                       n_liq=int((e.kind == "liquidation").sum()) if len(e) else 0))
    # spot-as-collateral counterfactual: N = C_slot/1.1, no re-centres
    if tier == "majors":
        d, p, e = portfolio.run_tier(tier, "hysteresis",
                                     replace(PRIM, margin=False), 
                                     portfolio.tier_start(tier), FIT_END)
        # rescale: capital = 1.1 N instead of 1.5 N
        ce.append(dict(tier=tier, L="spot-as-collateral (N=C/1.1, no re-centres)",
                       capital_pa=round(100 * ann_mean(d.r.values) * 1.5 / 1.1, 3),
                       notional_pa=round(100 * ann_mean(d.r.values) * 1.5, 3),
                       n_liq=0))
CE = pd.DataFrame(ce)
CE.to_csv(os.path.join(OUT, "capital_eff.csv"), index=False)
print(CE.to_string(index=False))
print("NOTE: the six alts are NOT eligible collateral in Binance Multi-Assets "
      "Mode as published, so the spot-as-collateral row is majors only (§9.4).")

# ------------------------------------------------------- Reading-B row -----
print("\n=== Reading-B descriptive row (time-varying denominator, fit only) ===")
bro = []
for tier in ("majors", "alts"):
    syms, c_slot = TIERS[tier], C_TIER / SLOTS[tier]
    eqs = []
    for sym in syms:
        b, f = portfolio.tape(sym)
        st = engine.gate_hysteresis(f)
        pos, eqf, ev = engine.simulate(sym, st, f, b, replace(PRIM, c_slot=c_slot),
                                       portfolio.fit_start(sym), FIT_END)
        eqs.append(portfolio.daily_from_bars(eqf).rename(
            columns={"eq": sym, "open_share": sym + "_on"})[[sym]])
    E = pd.concat(eqs, axis=1)
    idx = pd.date_range(min(portfolio.fit_start(s) for s in syms),
                        FIT_END - pd.Timedelta(days=1), freq="1D", tz="UTC")
    E = E.reindex(idx)
    live = E.notna().cumsum().gt(0)
    E = E.ffill()
    denom = live.sum(axis=1) * c_slot
    tot = (E * live).sum(axis=1)
    r = (tot - tot.shift(1)) / denom.replace(0, np.nan)
    r = r.fillna(0.0)
    steps = live.sum(axis=1)
    bro.append(dict(tier=tier, days=len(r), net_pa=round(100 * ann_mean(r.values), 3),
                    first_day=str(idx[0].date()),
                    slot_count_steps="; ".join(
                        f"{d.date()}→{int(n)}" for d, n in
                        steps[steps.diff().fillna(steps.iloc[0]) != 0].items())))
B = pd.DataFrame(bro)
B.to_csv(os.path.join(OUT, "fit_readingB.csv"), index=False)
print(B.to_string(index=False))

# ------------------------------------------------ SOL blackout row ---------
print("\n=== §3.3 rule 3: SOL FTX-week counterfactual ===")
f_all = load_funding("SOLUSDT")
a, z = SOL_BLACKOUT
bl = f_all[(f_all.ts >= a) & (f_all.ts < z)]
b, _ = portfolio.tape("SOLUSDT")
bb = b.set_index("ts")
# the position that was unwound at 2022-11-09 19:00: what would holding have paid?
d, p, e = portfolio.run_tier("alts", "hysteresis", PRIM,
                             portfolio.tier_start("alts"), FIT_END)
sol = p[(p.symbol == "SOLUSDT") & (p.why_out == "sol_blackout")]
rows = []
if len(sol):
    q = sol.iloc[0]
    N = C_TIER / SLOTS["alts"] / 1.5
    q_p = N / q.P_e
    cf = 0.0
    for _, s in bl.iterrows():
        po = bb.P_open.get(s.ts, np.nan)
        if not np.isnan(po):
            cf += s.last_funding_rate * q_p * po
    rows.append(dict(
        blackout_rows=len(bl),
        intervals=str(bl.funding_interval_hours.value_counts().to_dict()),
        rate_min=float(bl.last_funding_rate.min()),
        rate_max=float(bl.last_funding_rate.max()),
        n_at_cap=int((bl.last_funding_rate <= -0.02 + 1e-12).sum()),
        unwound_position_entry=str(q.entry_ts), unwound_at=str(q.exit_ts),
        counterfactual_funding_usdt=round(cf, 6),
        counterfactual_pct_of_C_tier=round(100 * cf / C_TIER, 5)))
SB = pd.DataFrame(rows)
SB.to_csv(os.path.join(OUT, "sol_blackout.csv"), index=False)
print(SB.to_string(index=False))

# ------------------------------------------------------------- nulls -------
print("\n=== §7.1 Null A (timing placebo, 1000 draws) and §7.2 Null B (250) ===")
rng = np.random.default_rng(20260916)
nrows = []
for tier in ("majors", "alts"):
    d0, p0, e0 = portfolio.run_tier(tier, "hysteresis", PRIM,
                                    portfolio.tier_start(tier), FIT_END)
    obs = ann_mean(d0.r.values)
    real_state = {}
    for sym in TIERS[tier]:
        b, f = portfolio.tape(sym)
        real_state[sym] = engine.gate_hysteresis(f)

    def draws(kind, n):
        out = []
        for i in range(n):
            state = {}
            for sym in TIERS[tier]:
                b, f = portfolio.tape(sym)
                st = real_state[sym]
                m = ((f.ts >= portfolio.tier_start(tier)) & (f.ts < FIT_END)).values
                idx = np.where(m)[0]
                seg = st[m]
                if kind == "A":
                    # segment lengths, re-placed at random non-overlapping starts
                    lens, cur = [], 0
                    for v in seg:
                        if v:
                            cur += 1
                        elif cur:
                            lens.append(cur); cur = 0
                    if cur:
                        lens.append(cur)
                    new = np.zeros(len(seg), bool)
                    free = len(seg) - sum(lens)
                    if free > 0 and lens:
                        gaps = rng.multinomial(free, np.ones(len(lens) + 1)
                                               / (len(lens) + 1))
                        pos_ = 0
                        for g, L in zip(gaps[:-1], rng.permutation(lens)):
                            pos_ += g
                            new[pos_:pos_ + L] = True
                            pos_ += L
                    s2 = st.copy(); s2[idx] = new
                else:
                    k = rng.integers(1, 251) * 3      # k days = 3k settlements
                    s2 = np.roll(st, k)
                state[sym] = s2
            dd, _, _ = portfolio.run_tier(tier, "hysteresis", PRIM,
                                          portfolio.tier_start(tier), FIT_END,
                                          state_override=state)
            out.append(ann_mean(dd.r.values))
        return np.array(out)

    for kind, n in (("A", 1000), ("B", 250)):
        v = draws(kind, n)
        p = float((v >= obs).mean())
        nrows.append(dict(tier=tier, null=kind, draws=n,
                          observed_pa=round(100 * obs, 4),
                          null_mean_pa=round(100 * v.mean(), 4),
                          null_p95_pa=round(100 * float(np.percentile(v, 95)), 4),
                          p_value=round(p, 4),
                          label=("TIMED CARRY" if (kind == "A" and p <= 0.05)
                                 else "PASSIVE CARRY" if kind == "A" else "")))
        print(nrows[-1])
N = pd.DataFrame(nrows)
N.to_csv(os.path.join(OUT, "fit_nulls.csv"), index=False)
print(N.to_string(index=False))
