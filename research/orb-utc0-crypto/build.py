#!/usr/bin/env python3
"""Build every trade table this pass needs. `DESIGN.md` §10 step 4's input.

  * the two pre-registered arms `BTCUSDT-5m`, `ETHUSDT-5m` at the 00:00 UTC
    anchor, over fit + holdout + tail  -> `results/trades_all.parquet`;
  * the three §8.3 placebo-anchor rows (08:00, 16:00, 04:00 UTC), **fit period
    only** -> `results/trades_placebo.parquet`;
  * the §8.4 fit-only OR-width sensitivities S1 (15m) and S2 (60m)
    -> `results/fit_sensitivities.csv`.

The weekday/weekend halves (§8.1), the Tokyo-holiday row (§8.2) and the era
rows (§7.4) are **cuts of the pre-registered arm's own trades**, not separate
builds — every trade in them is a trade the arm actually took. They are
labelled here (`weekend`, `dow`, `era_break`, `era_etf` columns come out of
`engine._evaluate`) and cut in `analysis.py`.

No R is read by this script's caller before `DESIGN.md` is committed.

    python build.py
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import engine as E  # noqa: E402

TF = C.TFS[0]
ARMS = [(s, TF) for s in C.INSTRUMENTS]


def main() -> None:
    # every UTC calendar day — no holiday calendar, no weekday filter (§3.1)
    main_days = C.all_days(C.FIT_START, C.TAIL_END)
    fit_days = C.all_days(C.FIT_START, C.FIT_END)

    # ---------------- the two pre-registered arms -------------------------
    out = []
    for sym, tf in ARMS:
        q = E.build_arm(sym, tf, main_days)
        n_we = int(q.weekend.sum())
        print(f"  {sym}-{tf}m: {len(q)} trades "
              f"(fit {int((q.period=='fit').sum())}, "
              f"hold {int((q.period=='holdout').sum())}, "
              f"tail {int((q.period=='tail').sum())}; weekend {n_we})", flush=True)
        out.append(q)
    q = pd.concat(out, ignore_index=True)
    q.to_parquet(os.path.join(C.RESULTS, "trades_all.parquet"), index=False)

    # ---------------- §8.3 placebo anchors, FIT PERIOD ONLY ---------------
    # Never the holdout. `analysis.py:holdout_pass` does not read this file.
    pb = []
    for anchor in C.PLACEBO_ANCHORS:
        for sym, tf in ARMS:
            g = E.build_arm(sym, tf, fit_days, anchor=anchor)
            if not len(g):
                continue
            g = g[g.period == "fit"].copy()
            g["anchor"] = f"{anchor[0]:02d}:{anchor[1]:02d}"
            g["anchor_label"] = C.PLACEBO_LABEL[anchor]
            pb.append(g)
            print(f"  placebo {anchor[0]:02d}:{anchor[1]:02d} {sym}-{tf}m: "
                  f"{len(g)} fit trades", flush=True)
    pd.concat(pb, ignore_index=True).to_parquet(
        os.path.join(C.RESULTS, "trades_placebo.parquet"), index=False)

    # ---------------- §8.4 width sensitivities, FIT PERIOD ONLY -----------
    sens = []
    for w in C.OR_WIDTH_SENS:
        for sym, tf in ARMS:
            g = E.build_arm(sym, tf, fit_days, or_minutes=w)
            g = g[g.period == "fit"] if len(g) else g
            if not len(g):
                continue
            sens.append(dict(sensitivity=f"S OR width {w}m", arm=f"{sym}-{tf}m",
                             or_minutes=w, n=len(g),
                             mean_netR_1=float(g.netR_1.mean()),
                             mean_netR_2=float(g.netR_2.mean()),
                             mean_grossR_1=float(g.grossR_1.mean()),
                             mean_cost_R=float(g.cost_R_1.mean()),
                             win_rate=float(100 * (g.netR_1 > 0).mean())))
        print(f"  sensitivity done: OR width {w}m", flush=True)
    # the registered width, on the same fit population, for comparison
    for sym, tf in ARMS:
        g = q[(q.arm == f"{sym}-{tf}m") & (q.period == "fit")]
        sens.append(dict(sensitivity="registered OR width 30m", arm=f"{sym}-{tf}m",
                         or_minutes=30, n=len(g),
                         mean_netR_1=float(g.netR_1.mean()),
                         mean_netR_2=float(g.netR_2.mean()),
                         mean_grossR_1=float(g.grossR_1.mean()),
                         mean_cost_R=float(g.cost_R_1.mean()),
                         win_rate=float(100 * (g.netR_1 > 0).mean())))
    pd.DataFrame(sens).to_csv(os.path.join(C.RESULTS, "fit_sensitivities.csv"),
                              index=False)
    print("\nrows:", len(q))


if __name__ == "__main__":
    main()
