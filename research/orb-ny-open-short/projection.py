#!/usr/bin/env python3
"""`DESIGN.md` §8.1 — the fit-period trigger share, as a DATA NOTE.

The closed pass's power contingency (widen the trigger window to 13:30 NY if
the projected `n_holdout` falls below 150) is **retired for this family**
(follow-up note §4.4): with a 5-, 10- or 15-minute range the trigger lands
within minutes on nearly every eligible day, so the cutoff is inert. Nothing
here decides anything. It records, per arm and before the holdout is touched:

  * eligible fit-period days and why days were excluded;
  * the fit-period trigger share;
  * the projected `n_holdout` from that share and the holdout CALENDAR alone;
  * the distribution of how long after the range's end the trigger fires.

Contains no R, no win rate, no expectancy, and reads no holdout outcome.

    python projection.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import engine as E  # noqa: E402


def main() -> None:
    fit_days = C.nyse_days(C.FIT_START, C.FIT_END)
    hold_days = C.nyse_days(C.HOLD_START, C.HOLD_END)
    rows, ex = [], []
    for sym, orm in C.ARM_SPECS:
        arm = C.arm_name(sym, orm)
        ts = C.trig_start(orm)
        base = E.eligibility(sym, orm, fit_days)
        hel = E.eligibility(sym, orm, hold_days)
        n_h_elig = int(hel.eligible.sum())
        trig = base[base.triggered]
        # minutes from the RANGE END to the trigger bar's open
        lag = trig.tod_min.values - orm
        r = dict(arm=arm, symbol=sym, or_min=orm,
                 trigger_start_NY=f"{ts[0]:02d}:{ts[1]:02d}",
                 fit_calendar_days=len(fit_days),
                 fit_eligible=int(base.eligible.sum()),
                 fit_excluded=int((~base.eligible).sum()),
                 fit_triggered=int(base.triggered.sum()),
                 holdout_calendar_days=len(hold_days),
                 holdout_eligible=n_h_elig)
        r["trigger_share_fit"] = r["fit_triggered"] / max(r["fit_eligible"], 1)
        r["proj_n_holdout"] = r["trigger_share_fit"] * n_h_elig
        r["lag_from_range_end_median_min"] = float(np.median(lag)) if len(lag) else np.nan
        r["lag_from_range_end_p90_min"] = float(np.percentile(lag, 90)) if len(lag) else np.nan
        r["pct_triggered_within_30min_of_range_end"] = (
            float(100 * (lag <= 30).mean()) if len(lag) else np.nan)
        rows.append(r)
        print(f"  {arm:12s} trig@{r['trigger_start_NY']}  elig {r['fit_eligible']:4d}  "
              f"trig {r['fit_triggered']:4d} ({r['trigger_share_fit']:.3f})  "
              f"proj n_hold {r['proj_n_holdout']:6.1f}  "
              f"lag med {r['lag_from_range_end_median_min']:.0f}m", flush=True)
        for lab, days in (("fit", fit_days), ("holdout", hold_days)):
            e = E.eligibility(sym, orm, days)
            ex.append(dict(arm=arm, period=lab, calendar_days=len(days),
                           eligible=int(e.eligible.sum()),
                           excl_incomplete_or=int((e.reason == "incomplete opening range").sum()),
                           excl_no_session=int((e.reason == "no session after the range").sum())))
    t = pd.DataFrame(rows)
    t.to_csv(os.path.join(C.RESULTS, "power_projection.csv"), index=False)
    pd.DataFrame(ex).to_csv(os.path.join(C.RESULTS, "exclusions.csv"), index=False)
    print("\n=== §8.1 TRIGGER SHARE — DATA NOTE ONLY, NO DECISION ===")
    print(t[["arm", "trigger_start_NY", "fit_eligible", "fit_triggered",
             "trigger_share_fit", "proj_n_holdout",
             "lag_from_range_end_median_min"]]
          .to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    if (t.proj_n_holdout < C.MIN_TRADES).any():
        print("\n*** NOTE: an arm projects below the 150-trade floor. The widened-cutoff "
              "contingency is RETIRED for this family (note §4.4); if such an arm is "
              "screened in and realises n_holdout < 150, DESIGN §11 says STOP and return "
              "to the Architect. ***")


if __name__ == "__main__":
    main()
