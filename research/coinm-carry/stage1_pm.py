#!/usr/bin/env python3
"""Fit-only sensitivities (i) and (ii): Portfolio Margin / Multi-Assets Mode
with the USD-M perp and an UN-RE-CENTRED coin hedge (DESIGN §9.3).

This is the row that reproduces the `hedged-carry/REPORT.md` §6 **+28.40 %**
shape honestly, on the PUBLISHED 95 % haircut, with the uniMMR path modelled
and the negative-funding tail paid at the GROWN notional.  It is a
DESCRIPTIVE sensitivity.  It is NOT admissible in the primary and it is not an
arm.

Structure, per slot:
    q       = N / S_e coins of spot, posted as collateral at haircut h
    short   = N/P_e coins of the USD-M perp, entered at P_e, NEVER re-hedged
    C       = N + (1 - h) N          (the haircut shortfall met with cash)
    funding(j) = f_j * (N/P_e) * P_j     <-- the notional GROWS with price
    uniMMR  = (cash + h*S_t*q + uPnL) / (mmr * (N/P_e) * P_t),  liq at 1.05
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (PERPS, SPOT_OF, C_TIER, SLOTS, OUT, FIT_END,
                    SPOT_FEE, SLIP, load_um_funding, load_klines,
                    ann_mean, sharpe, max_drawdown, block_bootstrap_p)
import engine, portfolio

UM_FEE = 0.0005          # USD-M taker, VIP 0
UM_MMR = 0.005           # ~0.5 % maintenance margin on the USD-M perp
LIQ_UNIMMR = 1.05


def slot(sym, haircut, start, end):
    sp = SPOT_OF[sym]
    sk = load_klines(sp, "spot1h")[["ts", "close"]].rename(
        columns={"close": "S"})
    pk = load_klines(sp.replace("USDT", "USDT"), "spot1h")  # placeholder
    # the USD-M perp price tape: reuse the hedged-carry pass's convention of
    # the perp 1h close; here the USD-M perp tape is not pulled, so the COIN-M
    # mark stands in for it (median |basis| 0.02 %, DESIGN §11 (e)).
    cm = load_klines(sym, "cm1h")[["ts", "close"]].rename(columns={"close": "P"})
    uf = load_um_funding(sp)
    j = cm.merge(sk, on="ts", how="inner")
    j = j[(j.ts >= start) & (j.ts < end)].reset_index(drop=True)
    if not len(j):
        return None, None
    C = C_TIER / SLOTS
    N = C / (1.0 + (1.0 - haircut))
    S_e, P_e = float(j.S.iloc[0]), float(j.P.iloc[0])
    q = N / S_e                      # coins of spot
    n = N / P_e                      # coins short on the USD-M perp
    cash = C - N - N * (SPOT_FEE + SLIP) - N * (UM_FEE + SLIP)
    f = uf[(uf.ts > j.ts.iloc[0]) & (uf.ts < j.ts.iloc[-1])]
    fmap = dict(zip(f.ts, f.last_funding_rate))
    eq, unimmr, fund_tot = [], [], 0.0
    pos_at = {}
    for t, r in zip(j.ts, j.P):
        pos_at[t] = r
    cash_t = cash
    for t, S, P in zip(j.ts, j.S, j.P):
        if t in fmap:
            amt = fmap[t] * n * P            # notional GROWS with price
            cash_t += amt
            fund_tot += amt
        upnl = -n * (P - P_e)
        ae = cash_t + haircut * S * q + upnl
        mm = UM_MMR * n * P
        unimmr.append(ae / mm if mm else np.nan)
        eq.append(cash_t + S * q + upnl)
    e = pd.DataFrame(dict(ts=j.ts, eq=eq, unimmr=unimmr))
    info = dict(symbol=sym, N=N, C=C, S_e=S_e, P_e=P_e, funding=fund_tot,
                P_max=float(j.P.max()), notional_max=float(n * j.P.max()),
                notional_growth=float(j.P.max() / P_e),
                min_unimmr=float(np.nanmin(unimmr)),
                liq=bool(np.nanmin(unimmr) <= LIQ_UNIMMR),
                final_eq=float(eq[-1]))
    return e, info


def run(haircut, start, end):
    eqs, infos = [], []
    for s in PERPS:
        e, i = slot(s, haircut, start, end)
        if e is None:
            continue
        d = e.set_index("ts")["eq"].resample("1D").last().to_frame(s)
        d[s + "_mmr"] = e.set_index("ts")["unimmr"].resample("1D").min()
        eqs.append(d)
        infos.append(i)
    E = pd.concat(eqs, axis=1)
    idx = pd.date_range(start.normalize(),
                        (end - pd.Timedelta(hours=1)).normalize(),
                        freq="1D", tz="UTC")
    E = E.reindex(idx).ffill()
    E[list(PERPS)] = E[list(PERPS)].fillna(C_TIER / SLOTS)
    tot = E[list(PERPS)].sum(axis=1)
    r = ((tot - tot.shift(1).fillna(C_TIER)) / C_TIER).dropna()
    inf = pd.DataFrame(infos)
    years = len(r) / 365.0
    p, lo, hi, se = block_bootstrap_p(r.values)
    return dict(haircut=haircut, C_over_N=round(C_TIER / SLOTS / inf.N.iloc[0], 4),
                net_pa=round(100 * ann_mean(r.values), 4),
                funding_pa=round(100 * inf.funding.sum() / C_TIER / years, 4),
                sharpe=round(sharpe(r.values), 3),
                maxdd_pct=round(100 * max_drawdown(r.values), 3),
                p_boot=round(p, 4), ci90_lo=round(100 * lo, 3),
                ci90_hi=round(100 * hi, 3), boot_se_pa=round(100 * se, 4),
                min_unimmr=round(float(inf.min_unimmr.min()), 3),
                any_liquidation=bool(inf.liq.any()),
                max_notional_growth=round(float(inf.notional_growth.max()), 3),
                sd_daily_pct=round(100 * float(r.std(ddof=1)), 5)), inf


def main():
    start = portfolio.tier_start()
    rows, details = [], []
    for h in (0.95, 0.80, 0.60):
        r, inf = run(h, start, FIT_END)
        rows.append(r)
        inf["haircut"] = h
        details.append(inf)
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(OUT, "fit_pm_sensitivity.csv"), index=False)
    pd.concat(details, ignore_index=True).to_csv(
        os.path.join(OUT, "fit_pm_detail.csv"), index=False)
    pd.set_option("display.width", 250)
    print("--- (i)/(ii) PM / Multi-Assets, USD-M perp, un-re-centred, FIT ONLY ---")
    print(df.to_string(index=False))
    print()
    print(pd.concat(details, ignore_index=True).to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
