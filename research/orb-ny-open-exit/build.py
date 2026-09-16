#!/usr/bin/env python3
"""Build the six per-arm trade tables, the §8.2 fit-only ladders, and the
quoted +1R corner.

`DESIGN.md` §10 step 4's input. Builds:

  * the six pre-registered arms — {US100, US500} x {E0, E1, E2} — over
    fit + holdout + tail (`results/trades_all.parquet`);
  * `results/exclusions.csv`: the triggered days a 'datr' arm (E2) loses
    because dATR14 is undefined in the Wilder warm-up at the start of the tape
    (`DESIGN.md` §3.6);
  * the five FIT-PERIOD-ONLY descriptive ladders S-T / S-K / S-C / S-D / S-P
    (`results/fit_sensitivities.csv`). None can create, upgrade or downgrade a
    verdict and none is ever computed on the holdout;
  * `results/quoted_corner.csv`: the killed +1R cell, READ from
    `research/orb-ny-open-short/results/fit_describe.csv`, fit period only,
    never recomputed and with **no holdout column**.

No Study B, no crypto, no width sensitivity (the width axis is closed), no
side-split arm.

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
    fit_days = C.nyse_days(C.FIT_START, C.FIT_END)

    # ---------------- the six pre-registered arms -------------------------
    out = []
    for sym, k in C.ARM_SPECS:
        q = E.build_arm(sym, k, main_days)
        q = F.build(q)
        print(f"  {C.arm_name(sym, k)}: {len(q)} trades "
              f"(fit {int((q.period=='fit').sum())}, "
              f"hold {int((q.period=='holdout').sum())}, "
              f"tail {int((q.period=='tail').sum())})", flush=True)
        out.append(q)
    q = pd.concat(out, ignore_index=True)
    q.to_parquet(os.path.join(C.RESULTS, "trades_all.parquet"), index=False)

    # ---------------- E2's dATR warm-up exclusions (§3.6) -----------------
    ex = [E.datr_exclusions(sym, main_days) for sym in C.INSTRUMENTS]
    ex = pd.concat([x for x in ex if len(x)], ignore_index=True) if any(
        len(x) for x in ex) else pd.DataFrame(columns=["symbol", "date", "side", "reason"])
    ex["period"] = C.period_of(ex.date.values) if len(ex) else []
    ex.to_csv(os.path.join(C.RESULTS, "exclusions.csv"), index=False)
    print(f"  E2 dATR warm-up exclusions: {len(ex)} triggered days "
          f"({dict(ex.groupby('symbol').size()) if len(ex) else {}}), "
          f"all in period(s) {sorted(set(ex.period)) if len(ex) else []}", flush=True)

    # ---------------- §8.2 fit-only ladders -------------------------------
    sens = []

    def row(lad, cell, sym, g, registered=False):
        if not len(g):
            return
        sens.append(dict(ladder=lad, cell=cell, symbol=sym, n=len(g),
                         registered_cell=registered,
                         mean_netR=float(g.netR.mean()),
                         median_netR=float(g.netR.median()),
                         mean_grossR=float(g.grossR.mean()),
                         mean_cost_R=float(g.cost_R.mean()),
                         median_cost_R=float(g.cost_R.median()),
                         p90_cost_R=float(g.cost_R.quantile(0.90)),
                         win_rate=float(100 * (g.netR > 0).mean()),
                         median_stop_dist=float(g.stop_dist.median()),
                         median_hold_min=float(g.hold_min.median()),
                         median_harvest=float(g.harvest.median()),
                         mean_win_R=float(g.netR[g.netR > 0].mean()) if (g.netR > 0).any() else np.nan,
                         mean_loss_R=float(g.netR[g.netR <= 0].mean()) if (g.netR <= 0).any() else np.nan))

    def fit_only(g):
        return g[g.period == "fit"] if len(g) else g

    for sym in C.INSTRUMENTS:
        # --- S-T fixed target, on the range stop (E0) and the dATR stop (E2)
        for base in ("E0", "E2"):
            row(f"S-T target on {base}", "EoD (the arm)", sym,
                fit_only(E.build_arm(sym, base, fit_days)), registered=True)
            for t in C.S_T_TARGETS:
                row(f"S-T target on {base}", f"{t:g}R", sym,
                    fit_only(E.build_arm(sym, base, fit_days, target_r=t)))
        # --- S-K stop fraction of dATR14, EoD exit
        row("S-K stop fraction", "range (= E0)", sym,
            fit_only(E.build_arm(sym, "E0", fit_days)), registered=True)
        for fr in C.S_K_FRACS:
            row("S-K stop fraction", f"{fr:g} dATR14", sym,
                fit_only(E.build_arm(sym, "E2", fit_days, datr_frac=fr)),
                registered=(fr == C.DATR_FRAC))
        # --- S-C time exit, on E0 and E1
        for base in ("E0", "E1"):
            row(f"S-C time exit on {base}", "16:00 NY (the arm)", sym,
                fit_only(E.build_arm(sym, base, fit_days)), registered=True)
            for hh, mm in C.S_C_FLATS:
                row(f"S-C time exit on {base}", f"{hh:02d}:{mm:02d} NY", sym,
                    fit_only(E.build_arm(sym, base, fit_days, flat_at=(hh, mm))))
        # --- S-D trail distance, on E1
        row("S-D trail distance", "1R (the arm)", sym,
            fit_only(E.build_arm(sym, "E1", fit_days)), registered=True)
        for tr in C.S_D_TRAILS:
            row("S-D trail distance", f"{tr:g}R", sym,
                fit_only(E.build_arm(sym, "E1", fit_days, trail_r=tr)))
        print(f"  ladders done: {sym}", flush=True)

    # --- S-P scale-out, DERIVED per trade with BOTH exits' spreads ---------
    # Half off at +1R (the killed corner's exit), remainder per E1. Note §4.2
    # item 6: the remainder's ratchet path does not depend on the partial, so
    # the per-trade net R is exactly the half-and-half average of the two
    # exits, each carrying its OWN entry+exit spread. Computed properly, not
    # asserted.
    sp = []
    for sym in C.INSTRUMENTS:
        e1 = fit_only(E.build_arm(sym, "E1", fit_days))
        t1 = fit_only(E.build_arm(sym, "E0", fit_days, target_r=C.S_P_PARTIAL_R))
        m = e1.merge(t1[["date", "netR", "grossR", "cost_R", "exit"]], on="date",
                     suffixes=("_e1", "_t1"))
        half = 0.5 * m.netR_t1 + 0.5 * m.netR_e1
        sp.append(dict(ladder="S-P scale-out (derived)",
                       cell=f"half off at +{C.S_P_PARTIAL_R:g}R, remainder per E1",
                       symbol=sym, n=len(m), registered_cell=False,
                       mean_netR=float(half.mean()), median_netR=float(half.median()),
                       mean_grossR=float((0.5 * m.grossR_t1 + 0.5 * m.grossR_e1).mean()),
                       mean_cost_R=float((0.5 * m.cost_R_t1 + 0.5 * m.cost_R_e1).mean()),
                       win_rate=float(100 * (half > 0).mean()),
                       component_mean_netR_partial=float(m.netR_t1.mean()),
                       component_mean_netR_runner=float(m.netR_e1.mean())))
    sens += sp
    pd.DataFrame(sens).to_csv(os.path.join(C.RESULTS, "fit_sensitivities.csv"), index=False)
    print("  S-P scale-out done", flush=True)

    # ---------------- the quoted +1R corner (§5.2) ------------------------
    # READ, never recomputed. `fit_describe.csv` of the short pass carries
    # template 1 (+1R, range stop) and template 2 (no target) on OR5; template
    # 1 is the quoted corner, template 2 is the same construction as E0 and is
    # quoted alongside as the cross-pass consistency row.
    d = pd.read_csv(os.path.join(C.SHORT_RESULTS, "fit_describe.csv"))
    d = d[(d.period == "fit") & (d.arm.isin(C.QUOTED_CORNER.values()))]
    d.insert(0, "source", "research/orb-ny-open-short/results/fit_describe.csv")
    d.insert(1, "holdout", "NEVER COMPUTED — killed arm (note §5.2)")
    d.to_csv(os.path.join(C.RESULTS, "quoted_corner.csv"), index=False)
    print("  quoted +1R corner read from the short pass:")
    print(d[["arm", "template", "n", "mean_netR"]].to_string(index=False))

    # ---------------- the fixed-spread cost sensitivity basis (§5) --------
    fx = {}
    for sym in C.INSTRUMENTS:
        tp = E.Tape.get(sym)
        sp_ = []
        for dd in fit_days:
            a = np.searchsorted(tp.t, C.ny_ms(dd, *C.TRIG_START), "left")
            b = np.searchsorted(tp.t, C.ny_ms(dd, *C.FLAT), "left")
            if b > a:
                sp_.append(tp.spread[a:b])
        fx[sym] = float(np.median(np.concatenate(sp_)))
    pd.Series(fx).to_csv(os.path.join(C.RESULTS, "fixed_spread.csv"))
    print("  fit-period median spread 09:35-16:00 NY:", fx, flush=True)
    print("\nrows:", len(q))


if __name__ == "__main__":
    main()
