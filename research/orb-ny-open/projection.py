#!/usr/bin/env python3
"""DESIGN.md §8.2 — the one pre-registered power contingency.

Computed **on the fit period only** and **before the holdout is touched**.
Contains no R, no win rate, no expectancy: only day counts and the share of
eligible fit-period days that produced a trigger.

    projected n_holdout = (fit days triggered / fit days eligible)
                          x (eligible holdout days, from the CALENDAR alone)

An arm whose projection is < 150 runs on the widened [10:00, 13:30) NY trigger
window — the one and only alternative, fixed in ARCHITECT-NOTE §4.5. The
decision is written into DESIGN.md §8.2.1 and committed before any holdout
number exists.

    python projection.py
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import engine as E  # noqa: E402


def main() -> None:
    fit_days = C.nyse_days(C.FIT_START, C.FIT_END)
    hold_days = C.nyse_days(C.HOLD_START, C.HOLD_END)
    rows = []
    for sym in C.INSTRUMENTS:
        for tf in C.TFS:
            base = E.eligibility(sym, tf, fit_days, C.TRIG_END_BASE)
            wide = E.eligibility(sym, tf, fit_days, C.TRIG_END_WIDE)
            # eligible holdout days: the calendar + the opening-range
            # completeness rule only. No trade outcome is read.
            hel = E.eligibility(sym, tf, hold_days, C.TRIG_END_BASE)
            n_h_elig = int(hel.eligible.sum())
            r = dict(arm=f"{sym}-{tf}m",
                     fit_calendar_days=len(fit_days),
                     fit_eligible=int(base.eligible.sum()),
                     fit_excluded=int((~base.eligible).sum()),
                     fit_triggered_1200=int(base.triggered.sum()),
                     fit_triggered_1330=int(wide.triggered.sum()),
                     holdout_calendar_days=len(hold_days),
                     holdout_eligible=n_h_elig)
            r["share_1200"] = r["fit_triggered_1200"] / max(r["fit_eligible"], 1)
            r["share_1330"] = r["fit_triggered_1330"] / max(r["fit_eligible"], 1)
            r["proj_n_holdout_1200"] = r["share_1200"] * n_h_elig
            r["proj_n_holdout_1330"] = r["share_1330"] * n_h_elig
            r["cutoff"] = "12:00" if r["proj_n_holdout_1200"] >= C.MIN_TRADES else "13:30"
            r["still_short"] = (r["cutoff"] == "13:30"
                                and r["proj_n_holdout_1330"] < C.MIN_TRADES)
            rows.append(r)
            print(f"  {r['arm']:16s} elig {r['fit_eligible']:4d}  trig12 "
                  f"{r['fit_triggered_1200']:4d} ({r['share_1200']:.3f})  "
                  f"trig13:30 {r['fit_triggered_1330']:4d} ({r['share_1330']:.3f})  "
                  f"proj {r['proj_n_holdout_1200']:6.1f} / {r['proj_n_holdout_1330']:6.1f}"
                  f"  -> {r['cutoff']}", flush=True)
    t = pd.DataFrame(rows)
    t.to_csv(os.path.join(C.RESULTS, "power_projection.csv"), index=False)
    # the exclusions table, same pass, no R
    ex = []
    for sym in C.INSTRUMENTS:
        for tf in C.TFS:
            for lab, days in (("fit", fit_days), ("holdout", hold_days)):
                e = E.eligibility(sym, tf, days, C.TRIG_END_BASE)
                ex.append(dict(arm=f"{sym}-{tf}m", period=lab, calendar_days=len(days),
                               eligible=int(e.eligible.sum()),
                               excl_incomplete_or=int((e.reason == "incomplete opening range").sum()),
                               excl_no_session=int((e.reason == "no session after the range").sum())))
    pd.DataFrame(ex).to_csv(os.path.join(C.RESULTS, "exclusions.csv"), index=False)
    print("\n=== §8.2 CUTOFF DECISION ===")
    print(t[["arm", "fit_eligible", "share_1200", "proj_n_holdout_1200",
             "share_1330", "proj_n_holdout_1330", "cutoff", "still_short"]]
          .to_string(index=False, float_format=lambda x: f"{x:.3f}"))


if __name__ == "__main__":
    main()
