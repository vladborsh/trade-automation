#!/usr/bin/env python3
"""The mandatory DESCRIPTIVE rows — none of them carries a verdict word.

  * §4.3 the weekend row (both arms, NY clock, Saturdays and Sundays, RVOL
    denominator over the prior 14 CALENDAR days' same window — which is why it
    is read off the `nyall` panel and filtered, not off a weekend-only panel);
  * §6.4 (a) the dollar-neutral signed-TR24 basket, (b) the beta-hedged row
    for each primary arm, (c) the portfolio-risk description;
  * the exclusions row: days lost to `N_elig < 50`, legs lost to `r30 == 0`,
    to a path missing more than 30 minutes, and the §9 delisting shares.

Fit period only: DESIGN §13 says that with both arms screened out the holdout
is not computed for anything, and that includes these rows.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import basket as B  # noqa: E402
from analysis import ARMS, stats, boot_mean  # noqa: E402
from xselect import Panel  # noqa: E402


def weekend_rows() -> list[dict]:
    lg = pd.read_parquet(os.path.join(C.RESULTS, "legs_nyall.parquet"))
    dow = pd.to_datetime(lg.date).dt.dayofweek
    out = []
    for name, mask in (("weekend (Sat/Sun)", dow >= 5), ("weekdays, all-calendar panel", dow <= 4)):
        sub = lg[mask].reset_index(drop=True)
        for arm, sel in ARMS.items():
            s = sub if sel == "RVOL" else sub[np.isfinite(sub.tr24.values)].reset_index(drop=True)
            P = Panel(s, sel)
            i, _ = P.top()
            out.append({**stats(P.legs, i, f"{arm} — {name} (descriptive)"), "arm": arm})
    return out


def exclusions() -> dict:
    n = pd.read_csv(os.path.join(C.RESULTS, "n_elig.csv"))
    a = json.load(open(os.path.join(C.RESULTS, "legs_audit_base.json")))
    pan = pd.read_parquet(os.path.join(C.RESULTS, "panel.parquet"))
    fails = {f"rule {k}": int((~pan[c]).sum()) for k, c in
             ((1, "r1_listed"), (2, "r2_window"), (3, "r3_rvol_den"), (4, "r4_atr"),
              (5, "r5_liq"), (6, "r6_tape"), (7, "r7_tr24"))}
    return dict(nyse_full_days=len(n), tradable_days=int(n.tradable.sum()),
                days_lost_to_N_elig_lt_50=int((~n.tradable).sum()),
                panel_rows=len(pan), eligible_A=int(pan.elig_A.sum()),
                eligible_B=int(pan.elig_B.sum()),
                eligibility_rule_failures=fails,
                legs_dropped_r30_zero=a["dropped_r30_zero"],
                legs_dropped_path_missing_gt_30=a["dropped_path_missing_gt_30"],
                instrument_days=a["n_instrument_days"],
                exit_cause=a["exit_cause"])


def baskets() -> dict:
    legs = pd.read_parquet(os.path.join(C.RESULTS, "instrument_days.parquet"))
    fit = legs[legs.period == "fit"].reset_index(drop=True)
    dn = B.dollar_neutral(fit)
    dn["year"] = dn.date.str[:4]
    sd60 = dn.ret_bp.rolling(60).std()
    ann = float(dn.ret_bp.mean() / dn.ret_bp.std(ddof=1) * np.sqrt(252)) if len(dn) > 2 else np.nan
    out = dict(dollar_neutral=dict(
        n_days=len(dn), mean_ret_bp=float(dn.ret_bp.mean()),
        mean_gross_bp=float(dn.gross_bp.mean()), sd_bp=float(dn.ret_bp.std(ddof=1)),
        mean_ret_in_sd_units=float((dn.ret_bp / sd60).mean()),
        annualised_sharpe=ann,
        by_year={k: dict(n=int(v.size), mean_ret_bp=float(v.mean()))
                 for k, v in dn.groupby("year").ret_bp}))
    # (b) beta-hedged: BTCUSDT horizon return per day
    btc = fit[fit.symbol == "BTCUSDT"].copy()
    btc["hz_ret"] = B._unstopped_ret(btc)
    bh = {}
    for arm, sel in ARMS.items():
        s = fit if sel == "RVOL" else fit[np.isfinite(fit.tr24.values)].reset_index(drop=True)
        P = Panel(s, sel)
        i, _ = P.top()
        bh[arm] = B.beta_hedged(fit, i, P.legs, btc[["date", "hz_ret"]])
    out["beta_hedged"] = bh
    # (c) portfolio risk
    pr = {}
    for arm, sel in ARMS.items():
        s = fit if sel == "RVOL" else fit[np.isfinite(fit.tr24.values)].reset_index(drop=True)
        P = Panel(s, sel)
        i, _ = P.top()
        pr[arm] = B.portfolio_risk(P.legs.date.values[i], P.legs.netR.values[i])
    out["portfolio_risk"] = pr
    return out


def main() -> None:
    out = dict(weekend=weekend_rows(), exclusions=exclusions(), baskets=baskets())
    with open(os.path.join(C.RESULTS, "descriptive_fit.json"), "w") as fh:
        json.dump(out, fh, indent=1, default=str)
    w = pd.DataFrame(out["weekend"])
    print(w[["row", "n_legs", "n_days", "mean_netR", "mean_dATR", "mean_grossR",
             "boot_lo", "boot_hi"]].to_string(index=False))
    print("\nexclusions:", json.dumps(out["exclusions"], indent=1))
    print("\nbaskets:", json.dumps(out["baskets"], indent=1, default=str))


if __name__ == "__main__":
    main()
