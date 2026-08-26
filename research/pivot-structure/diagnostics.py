#!/usr/bin/env python3
"""POST-MORTEM diagnostics (DESIGN.md §5) -- FIT WINDOW ONLY.

This is NOT stage 3. Stage 1 killed the engine, so no arm is being evaluated
against the §6 economic bar and the holdout window is never read here. The
design lists these diagnostics as required, and the intraday-mtf-smc pass ran
the equivalent set post-mortem (its REPORT §4) because they say *how* the
engine fails, and because the measured `cost_R` is what a future design in this
family has to clear. Same convention, same formats.

Produces: trade counts, long/short split, skipped-signal rate, breaker-bind
frequency, median hold time, realised R-distribution, cost_R off realised
stops, and per-(K, k) trade counts.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
import pivot, engine

ARMS = ["E1-T1", "E1-T2", "E2-T2"]
LO, HI = C.FIT
K0, k0, _ = pivot.PRIMARY


def frame(sym, mode, K):
    d5 = C.load5m(sym)
    if mode == "S":
        return C.resample_h1(d5), None
    return d5, pivot.merge_major_h1(d5, K)


def run_arm(sym, mode, K, k, arm):
    base, mj = frame(sym, mode, K)
    base = base.reset_index(drop=True)
    ps = pivot.pivot_structure(base, K, k, major=mj)
    sig = pivot.ruleset(base, ps, arm, mode)
    m = ((base.ts >= pd.Timestamp(LO, tz="UTC")) & (base.ts < pd.Timestamp(HI, tz="UTC"))).to_numpy()
    b = base.loc[m].reset_index(drop=True)
    s = sig.loc[m].reset_index(drop=True)
    fl = ps.flip.to_numpy()[m]
    ts = pivot.P["time_stop_S"] if mode == "S" else pivot.P["time_stop_M"]
    res = engine.run_flip(b, s, ts, flip=fl)
    return b, s, fl, res


def main():
    rows, per_sym_rows, alltr = [], [], []
    for mode in ("S", "M"):
        for arm in ARMS + (["C1"] if mode == "S" else []):
            tr_all, sig_n, bind, days = [], 0, [], 0
            for sym in C.SYMBOLS:
                b, s, fl, res = run_arm(sym, mode, K0, k0, arm)
                tr = res["trades"]
                tr["symbol"] = sym
                tr_all.append(tr)
                sig_n += int((s.sig != 0).sum())
                bind.append(engine.breaker_bind(b, res))
                days += b.ts.dt.floor("D").nunique()
                per_sym_rows.append(dict(mode=mode, arm=arm, symbol=sym,
                                         **C.summarise(tr)))
            tr = pd.concat(tr_all, ignore_index=True)
            tr["arm"] = arm; tr["mode"] = mode
            alltr.append(tr)
            cost_R = C.COST_RT * tr.entry / tr.risk_px
            bars_h = tr.bars * (1.0 if mode == "S" else 1 / 12)
            gross_R = tr.r + cost_R
            rows.append(dict(
                mode=mode, arm=arm, trades=len(tr), signals=sig_n,
                skipped_rate=1 - len(tr) / max(1, sig_n),
                long_share=float((tr.side == 1).mean()),
                exp_R_net=float(tr.r.mean()), exp_R_gross=float(gross_R.mean()),
                exp_R_long=float(tr.r[tr.side == 1].mean()),
                exp_R_short=float(tr.r[tr.side == -1].mean()),
                win_rate=float((tr.pnl > 0).mean()),
                pf_net=float(tr.pnl[tr.pnl > 0].sum() / max(1e-9, -tr.pnl[tr.pnl <= 0].sum())),
                cost_R_med=float(cost_R.median()),
                bar_3x_cost=3 * float(cost_R.median()),
                median_hold_h=float(bars_h.median()),
                breaker_bind=float(np.mean(bind)),
                r_p10=float(tr.r.quantile(.10)), r_med=float(tr.r.median()),
                r_p90=float(tr.r.quantile(.90)),
                exit_stop=float((tr.reason == "stop").mean()),
                exit_target=float((tr.reason == "target").mean()),
                exit_flip=float((tr.reason == "flip").mean()),
                exit_time=float((tr.reason == "time").mean()),
            ))
            print(f"  {mode} {arm}: {len(tr)} trades", flush=True)

    d = pd.DataFrame(rows)
    d.to_csv(f"{C.OUT}/diagnostics_fit.csv", index=False)
    pd.DataFrame(per_sym_rows).to_csv(f"{C.OUT}/diagnostics_per_symbol.csv", index=False)
    tr = pd.concat(alltr, ignore_index=True)
    tr.to_csv(f"{C.OUT}/trades_fit_primary.csv.gz", index=False, compression="gzip")

    pd.set_option("display.width", 260)
    print("\n=== POST-MORTEM, fit window, primary config K=15 k=4 ===")
    print(d.to_string(index=False, float_format=lambda x: f"{x:8.3f}"))

    # per-(K, k) trade counts, arm E1-T2, Mode S (§5 requirement)
    cnt = []
    for K in pivot.GRID_K:
        for k in pivot.GRID_k:
            n = 0; e = []
            for sym in C.SYMBOLS:
                _, _, _, res = run_arm(sym, "S", K, k, "E1-T2")
                t = res["trades"]; n += len(t)
                if len(t):
                    e.append(t.r.mean())
            cnt.append(dict(K=K, k=k, trades_fit=n, exp_R_net=float(np.mean(e))))
    cd = pd.DataFrame(cnt)
    cd.to_csv(f"{C.OUT}/grid_trade_counts.csv", index=False)
    print("\n=== per-(K,k) trade counts + net expectancy, arm E1-T2, Mode S, fit ===")
    print(cd.pivot(index="k", columns="K", values="trades_fit").to_string())
    print(cd.pivot(index="k", columns="K", values="exp_R_net").to_string(
        float_format=lambda x: f"{x:+.4f}"))


if __name__ == "__main__":
    main()
