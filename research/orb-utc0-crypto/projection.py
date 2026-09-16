#!/usr/bin/env python3
"""DESIGN.md §7.2 — the data note. **No power contingency exists in this
family** (§3.2: there is no widened trigger window); this script therefore
only records the fit-period trigger share per arm and the exclusions table,
so that the projected holdout count is on the record before any holdout number
is computed.

Contains no R, no win rate, no expectancy: only day counts and shares.

    python projection.py
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import engine as E  # noqa: E402

TF = C.TFS[0]


def main() -> None:
    fit_days = C.all_days(C.FIT_START, C.FIT_END)
    hold_days = C.all_days(C.HOLD_START, C.HOLD_END)
    rows, ex = [], []
    for sym in C.INSTRUMENTS:
        base = E.eligibility(sym, TF, fit_days)
        hel = E.eligibility(sym, TF, hold_days)
        n_h_elig = int(hel.eligible.sum())
        r = dict(arm=f"{sym}-{TF}m",
                 fit_calendar_days=len(fit_days),
                 fit_eligible=int(base.eligible.sum()),
                 fit_excluded=int((~base.eligible).sum()),
                 fit_triggered=int(base.triggered.sum()),
                 holdout_calendar_days=len(hold_days),
                 holdout_eligible=n_h_elig)
        r["trigger_share"] = r["fit_triggered"] / max(r["fit_eligible"], 1)
        r["proj_n_holdout"] = r["trigger_share"] * n_h_elig
        r["projection_below_150"] = r["proj_n_holdout"] < C.MIN_TRADES
        rows.append(r)
        print(f"  {r['arm']:14s} elig {r['fit_eligible']:5d}  trig "
              f"{r['fit_triggered']:5d} ({r['trigger_share']:.3f})  "
              f"proj n_holdout {r['proj_n_holdout']:6.1f}", flush=True)
        for lab, days in (("fit", fit_days), ("holdout", hold_days)):
            e = E.eligibility(sym, TF, days)
            ex.append(dict(arm=f"{sym}-{TF}m", period=lab, calendar_days=len(days),
                           eligible=int(e.eligible.sum()),
                           excl_incomplete_or=int((e.reason == "incomplete opening range").sum()),
                           excl_no_session=int((e.reason == "no session after the range").sum())))
    t = pd.DataFrame(rows)
    t.to_csv(os.path.join(C.RESULTS, "power_projection.csv"), index=False)
    pd.DataFrame(ex).to_csv(os.path.join(C.RESULTS, "exclusions.csv"), index=False)
    print("\n=== §7.2 PROJECTION (no contingency exists; the UNDERPOWERED row "
          "applies if it is wrong) ===")
    print(t.to_string(index=False, float_format=lambda x: f"{x:.3f}"))


if __name__ == "__main__":
    main()
