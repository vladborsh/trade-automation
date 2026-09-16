#!/usr/bin/env python3
"""Build the six per-arm trade tables and the per-trade feature vector.

`DESIGN.md` §10 step 4's input. Builds:

  * the six pre-registered arms over fit + holdout + tail (`trades_all.parquet`);
  * the three fit-period-only sensitivities S3' / S4' / S5 of §5.6.

No crypto row, no weekend row, no pre-ETF row, no width sensitivity (width is
the axis now, not a sensitivity), no Study B.

Every arm's trigger window is [the arm's own range end, 12:00) NY —
09:35 / 09:40 / 09:45 to 12:00.

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


def main() -> None:
    main_days = C.nyse_days(C.FIT_START, C.TAIL_END)

    # ---------------- the six pre-registered arms -------------------------
    out = []
    for sym, orm in C.ARM_SPECS:
        q = E.build_arm(sym, orm, main_days)
        q = F.build(q)
        print(f"  {C.arm_name(sym, orm)}: {len(q)} trades "
              f"(fit {int((q.period=='fit').sum())}, hold {int((q.period=='holdout').sum())}, "
              f"tail {int((q.period=='tail').sum())})", flush=True)
        out.append(q)
    q = pd.concat(out, ignore_index=True)
    q.to_parquet(os.path.join(C.RESULTS, "trades_all.parquet"), index=False)

    # ---------------- §5.6 sensitivities, FIT PERIOD ONLY -----------------
    fit_days = C.nyse_days(C.FIT_START, C.FIT_END)
    sens = []
    specs = [("S3' stop at OR midpoint", dict(stop_mode="mid")),
             ("S4' re-entry once after a stop", dict(max_trades_per_day=2)),
             ("S5 trigger window ends 11:00 NY", dict(trig_end=C.TRIG_END_S5))]
    for lab, kw in specs:
        for sym, orm in C.ARM_SPECS:
            g = E.build_arm(sym, orm, fit_days, **kw)
            g = g[g.period == "fit"] if len(g) else g
            if not len(g):
                continue
            sens.append(dict(sensitivity=lab, arm=C.arm_name(sym, orm), n=len(g),
                             mean_netR_1=float(g.netR_1.mean()),
                             mean_netR_2=float(g.netR_2.mean()),
                             mean_grossR_1=float(g.grossR_1.mean()),
                             mean_cost_R=float(g.cost_R_1.mean()),
                             win_rate=float(100 * (g.netR_1 > 0).mean())))
        print(f"  sensitivity done: {lab}", flush=True)
    pd.DataFrame(sens).to_csv(os.path.join(C.RESULTS, "fit_sensitivities.csv"), index=False)

    # ---------------- the fixed-spread cost sensitivity basis (§5) --------
    # Median fit-period spread over the widest window any arm trades in:
    # 09:35 NY (the earliest trigger start) to 16:00 NY.
    fx = {}
    for sym in C.INSTRUMENTS:
        tp = E.Tape.get(sym)
        sp = []
        for d in fit_days:
            a = np.searchsorted(tp.t, C.ny_ms(d, *C.trig_start(min(C.OR_WIDTHS))), "left")
            b = np.searchsorted(tp.t, C.ny_ms(d, *C.FLAT), "left")
            if b > a:
                sp.append(tp.spread[a:b])
        fx[sym] = float(np.median(np.concatenate(sp)))
    pd.Series(fx).to_csv(os.path.join(C.RESULTS, "fixed_spread.csv"))
    print("  fit-period median spread 09:35-16:00 NY:", fx, flush=True)
    print("\nrows:", len(q))


if __name__ == "__main__":
    main()
