#!/usr/bin/env python3
"""POST-MORTEM diagnostics for a stage-1 kill (MTF-SMC-DESIGN.md §5.2 + §5.5).

All three rule-sets failed stage 1, so under §5.3 they are dead and stages 2-3 are
NOT run: the holdout window is never touched here. What follows is documentation
of HOW they died, not an attempt to resurrect them -- nothing below can change the
verdict, and no parameter is varied.

Everything is FIT WINDOW ONLY. Produces:
  * cost_R from realised stop distances (§5.2) -- the number §0 demanded be
    measured rather than inherited from v1's 1h figure
  * per-symbol stage-1 breadth
  * Variant B zone-type split (OB / FVG / LIQ) at signal level
  * long/short split
  * engine-level: trades/symbol/year, skipped-signal rate, breaker-bind
    frequency, median hold time, realised R distribution
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
import mtf
import rulesets
from stage1 import observations, HORIZONS

LO = pd.Timestamp(C.FIT[0], tz="UTC"); HI = pd.Timestamp(C.FIT[1], tz="UTC")
YEARS = (HI - LO).total_seconds() / (365 * 86400)
import backtest as bt


def fitmask(d):
    return ((d.ts >= LO) & (d.ts < HI)).to_numpy()


# ---------------------------------------------------------------- cost in R
cost_rows, ztype_rows, side_rows, eng_rows, rdist = [], [], [], [], {}
for name in rulesets.NAMES:
    stops, all_tr = [], []
    for sym in C.SYMBOLS:
        d, sig = rulesets.get(sym, name)
        m = fitmask(d) & (sig.sig.to_numpy() != 0)
        sd = np.abs(d.close.to_numpy()[m] - sig.stop.to_numpy()[m]) / d.close.to_numpy()[m]
        stops.append(sd)

        # ---- engine, fit window only
        df = d.loc[m | ~m].loc[fitmask(d)].reset_index(drop=True)
        sf = sig.loc[fitmask(d), ["sig", "stop", "target"]].reset_index(drop=True)
        res = bt.run(df, sf, mtf.P["time_stop"])
        tr = res["trades"]
        eq = res["equity"]
        # breaker-bind: a UTC day whose intraday equity path fell 2% below its open
        e = pd.DataFrame({"eq": eq.to_numpy()}, index=eq.index)
        g = e.groupby(e.index.floor("D")).eq
        halted = (g.min() <= g.first() * (1 - bt.DAILY_STOP_PCT))
        raw = int(m.sum())
        eng_rows.append(dict(ruleset=name, symbol=sym, raw_signals=raw,
                             trades=len(tr), skipped_rate=1 - len(tr) / raw if raw else np.nan,
                             trades_per_year=len(tr) / YEARS,
                             halted_days=int(halted.sum()), days=int(len(halted)),
                             breaker_bind=float(halted.mean()),
                             median_hold_h=float((tr.exit_ts - tr.entry_ts).dt.total_seconds().median() / 3600) if len(tr) else np.nan,
                             win_rate=float((tr.pnl > 0).mean()) if len(tr) else np.nan,
                             net_pf=C.summarise(tr)["profit_factor"],
                             expectancy_R=float(tr.r.mean()) if len(tr) else np.nan))
        if len(tr):
            all_tr.append(tr.assign(symbol=sym))

        # ---- zone-type + side splits at signal level (horizon 12 = 1h forward)
        if name != "A":
            zt = sig.ztypes.to_numpy()
            for t in ("OB", "FVG", "LIQ"):
                sub = sig.copy()
                keep = np.array([isinstance(x, str) and t in x for x in zt])
                sub.loc[~keep, "sig"] = 0
                for hz in (12, 48):
                    r, _ = observations(d, sub, hz, LO, HI)
                    if len(r) > 30:
                        ztype_rows.append(dict(ruleset=name, symbol=sym, ztype=t, horizon=hz,
                                               n=len(r), mean_bps=r.mean() * 1e4,
                                               t_stat=r.mean() / (r.std(ddof=1) / np.sqrt(len(r)))))
        for sd_name, want in (("long", 1), ("short", -1)):
            sub = sig.copy()
            sub.loc[sub.sig != want, "sig"] = 0
            for hz in (12, 48):
                r, _ = observations(d, sub, hz, LO, HI)
                if len(r) > 30:
                    side_rows.append(dict(ruleset=name, symbol=sym, side=sd_name, horizon=hz,
                                          n=len(r), mean_bps=r.mean() * 1e4,
                                          t_stat=r.mean() / (r.std(ddof=1) / np.sqrt(len(r)))))
    sd = np.concatenate(stops)
    cr = C.COST_RT / sd
    cost_rows.append(dict(ruleset=name, n=len(sd),
                          stop_pct_median=float(np.median(sd) * 100),
                          stop_pct_q25=float(np.percentile(sd, 25) * 100),
                          stop_pct_q75=float(np.percentile(sd, 75) * 100),
                          cost_R_median=float(np.median(cr)),
                          cost_R_q25=float(np.percentile(cr, 25)),
                          cost_R_q75=float(np.percentile(cr, 75))))
    if all_tr:
        t = pd.concat(all_tr, ignore_index=True)
        rdist[name] = t
        t.to_csv(f"{C.OUT}/trades_fit_{name}.csv", index=False)

cost = pd.DataFrame(cost_rows); cost.to_csv(f"{C.OUT}/cost_R.csv", index=False)
eng = pd.DataFrame(eng_rows); eng.to_csv(f"{C.OUT}/engine_fit.csv", index=False)
pd.DataFrame(ztype_rows).to_csv(f"{C.OUT}/zone_type_split.csv", index=False)
pd.DataFrame(side_rows).to_csv(f"{C.OUT}/side_split.csv", index=False)

pd.set_option("display.width", 220)
print("=== §5.2 realised stop distance and cost in R (fit, all signals) ===")
print(cost.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))

print("\n=== engine diagnostics, FIT ONLY, pooled per rule-set ===")
agg = eng.groupby("ruleset").apply(lambda g: pd.Series(dict(
    raw_signals=g.raw_signals.sum(), trades=g.trades.sum(),
    skipped_rate=1 - g.trades.sum() / g.raw_signals.sum(),
    trades_per_symbol_year=g.trades_per_year.mean(),
    breaker_bind=g.breaker_bind.mean(),
    median_hold_h=g.median_hold_h.median(),
    win_rate=np.average(g.win_rate, weights=g.trades),
    net_pf_median=g.net_pf.median(),
    expectancy_R=np.average(g.expectancy_R, weights=g.trades))))
print(agg.to_string(float_format=lambda x: f"{x:9.3f}"))

print("\n=== realised R-multiple distribution (fit, engine trades) ===")
for k, t in rdist.items():
    q = t.r.quantile([.05, .25, .5, .75, .95])
    print(f"  {k:8s} n={len(t):>6}  mean {t.r.mean():+.3f}  "
          f"p05 {q[.05]:+.2f} p25 {q[.25]:+.2f} med {q[.5]:+.2f} p75 {q[.75]:+.2f} p95 {q[.95]:+.2f}  "
          f"| exits: stop {float((t.reason=='stop').mean()):.0%} "
          f"target {float((t.reason=='target').mean()):.0%} time {float((t.reason=='time').mean()):.0%}")

print("\n=== per-symbol stage-1 (horizon 12 = 1h forward), fit ===")
ps = pd.read_csv(f"{C.OUT}/stage1_per_symbol.csv")
print(ps[ps.horizon == 12].pivot(index="symbol", columns="ruleset", values="mean_bps")
      .to_string(float_format=lambda x: f"{x:8.2f}"))

print("\n=== Variant B zone-type split (pooled over symbols) ===")
zt = pd.DataFrame(ztype_rows)
if len(zt):
    p = zt.groupby(["ruleset", "ztype", "horizon"]).apply(lambda g: pd.Series(dict(
        n=g.n.sum(), mean_bps=np.average(g.mean_bps, weights=g.n),
        median_t=g.t_stat.median())))
    print(p.to_string(float_format=lambda x: f"{x:9.3f}"))

print("\n=== long/short split (pooled) ===")
sp = pd.DataFrame(side_rows)
p = sp.groupby(["ruleset", "side", "horizon"]).apply(lambda g: pd.Series(dict(
    n=g.n.sum(), mean_bps=np.average(g.mean_bps, weights=g.n), median_t=g.t_stat.median())))
print(p.to_string(float_format=lambda x: f"{x:9.3f}"))
