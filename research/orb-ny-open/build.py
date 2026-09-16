#!/usr/bin/env python3
"""Build the per-arm trade tables and the 24-feature vector.

DESIGN.md §10 step 5's input. Builds:

  * the eight pre-registered arms over fit + holdout + tail (`trades_all.parquet`),
    with features;
  * the descriptive crypto weekend rows and pre-ETF rows;
  * the four fit-period-only mechanic sensitivities of §3.6.

The eligibility window is [10:00, 12:00) NY on every arm — DESIGN §8.2.1, the
contingency did not fire.

    python build.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import engine as E  # noqa: E402
import features as F  # noqa: E402

ARMS = [(s, tf) for s in C.INSTRUMENTS for tf in C.TFS]
CRYPTO = [s for s in C.INSTRUMENTS if C.VENUE[s] == "bn"]


def main() -> None:
    main_days = C.nyse_days(C.FIT_START, C.TAIL_END)

    # ---------------- the eight pre-registered arms -----------------------
    out = []
    for sym, tf in ARMS:
        q = E.build_arm(sym, tf, main_days)
        q = F.build(q)
        print(f"  {sym}-{tf}m: {len(q)} trades "
              f"(fit {int((q.period=='fit').sum())}, hold {int((q.period=='holdout').sum())}, "
              f"tail {int((q.period=='tail').sum())})", flush=True)
        out.append(q)
    q = pd.concat(out, ignore_index=True)
    q.to_parquet(os.path.join(C.RESULTS, "trades_all.parquet"), index=False)

    # ---------------- descriptive: crypto weekend rows --------------------
    wk = []
    for sym in CRYPTO:
        for tf in C.TFS:
            d = C.weekend_days(C.FIT_START, C.HOLD_END)
            g = E.build_arm(sym, tf, d)
            if len(g):
                g["row"] = "weekend"
                wk.append(g)
            print(f"  weekend {sym}-{tf}m: {len(g)}", flush=True)
    if wk:
        pd.concat(wk, ignore_index=True).to_parquet(
            os.path.join(C.RESULTS, "trades_weekend.parquet"), index=False)

    # ---------------- descriptive: crypto pre-ETF rows --------------------
    pe = []
    for sym in CRYPTO:
        for tf in C.TFS:
            d = C.nyse_days(C.PREETF_START, C.PREETF_END)
            g = E.build_arm(sym, tf, d)
            if len(g):
                g["row"] = "pre-etf"
                pe.append(g)
            print(f"  pre-ETF {sym}-{tf}m: {len(g)}", flush=True)
    if pe:
        pd.concat(pe, ignore_index=True).to_parquet(
            os.path.join(C.RESULTS, "trades_preetf.parquet"), index=False)

    # ---------------- §3.6 mechanic sensitivities, FIT PERIOD ONLY --------
    fit_days = C.nyse_days(C.FIT_START, C.FIT_END)
    sens = []
    specs = [("S1 OR width 15m", dict(or_minutes=15)),
             ("S2 OR width 60m", dict(or_minutes=60)),
             ("S3 stop at OR midpoint", dict(stop_mode="mid")),
             ("S4 re-entry once after a stop", dict(max_trades_per_day=2))]
    for lab, kw in specs:
        for sym, tf in ARMS:
            g = E.build_arm(sym, tf, fit_days, **kw)
            g = g[g.period == "fit"] if len(g) else g
            if not len(g):
                continue
            sens.append(dict(sensitivity=lab, arm=f"{sym}-{tf}m", n=len(g),
                             mean_netR_1=float(g.netR_1.mean()),
                             mean_netR_2=float(g.netR_2.mean()),
                             mean_grossR_1=float(g.grossR_1.mean()),
                             mean_cost_R=float(g.cost_R_1.mean()),
                             win_rate=float(100 * (g.netR_1 > 0).mean())))
        print(f"  sensitivity done: {lab}", flush=True)
    pd.DataFrame(sens).to_csv(os.path.join(C.RESULTS, "fit_sensitivities.csv"), index=False)

    # ---------------- the fixed-spread cost sensitivity basis (§5) --------
    fx = {}
    for sym in ("US100", "US500"):
        tp = E.Tape.get(sym)
        sp = []
        for d in fit_days:
            a = np.searchsorted(tp.t, C.ny_ms(d, 10, 0), "left")
            b = np.searchsorted(tp.t, C.ny_ms(d, 16, 0), "left")
            if b > a:
                sp.append(tp.spread[a:b])
        fx[sym] = float(np.median(np.concatenate(sp)))
    pd.Series(fx).to_csv(os.path.join(C.RESULTS, "fixed_spread.csv"))
    print("  fit-period median spread 10:00-16:00 NY:", fx, flush=True)
    print("\nrows:", len(q))


if __name__ == "__main__":
    main()
