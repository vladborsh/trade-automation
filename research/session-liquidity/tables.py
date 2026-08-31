#!/usr/bin/env python3
"""Aggregation tables for the session-liquidity descriptive study.

Reads results/events_*.csv + results/uncond_*.csv.gz (engine.py output) and
writes both CSVs and a markdown block (results/TABLES.md) that REPORT.md embeds.

Everything here is descriptive: counts, rates, quantiles. No hypothesis tests,
no pass/fail gate -- by explicit protocol decision for this pass.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C

Q = [0.25, 0.5, 0.75, 0.9]
SESS_ORD = ["Asia", "London", "NY"]
SWEEP_ORD = ["Asia", "London", "London/NY overlap", "NY", "off-session"]


def load_events() -> pd.DataFrame:
    fr = [pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"),
                      parse_dates=["ts"]) for s in C.SYMBOLS]
    e = pd.concat(fr, ignore_index=True)
    e["both"] = e.ifvg_confirmed & e.bos_confirmed
    e["only_ifvg"] = e.ifvg_confirmed & ~e.bos_confirmed
    e["only_bos"] = e.bos_confirmed & ~e.ifvg_confirmed
    e["neither"] = ~e.ifvg_confirmed & ~e.bos_confirmed
    e["offset_bars"] = np.where(e.both, e.ifvg_delay_bars - e.bos_delay_bars, np.nan)
    return e


def load_uncond() -> pd.DataFrame:
    fr = [pd.read_csv(os.path.join(C.RESULTS, f"uncond_{s}.csv.gz"))
          for s in C.SYMBOLS]
    return pd.concat(fr, ignore_index=True)


def dist(g: pd.Series) -> dict:
    q = g.quantile(Q)
    return {"n": int(g.notna().sum()), "median": q[0.5], "p25": q[0.25],
            "p75": q[0.75], "p90": q[0.9], "mean": g.mean()}


def md(df: pd.DataFrame, floatfmt="{:.2f}") -> str:
    d = df.copy()
    for c in d.columns:
        if pd.api.types.is_float_dtype(d[c]):
            d[c] = d[c].map(lambda v: "" if pd.isna(v) else floatfmt.format(v))
    head = "| " + " | ".join(str(c) for c in d.columns) + " |"
    sep = "|" + "|".join(["---"] * len(d.columns)) + "|"
    rows = ["| " + " | ".join(str(v) for v in r) + " |" for r in d.values]
    return "\n".join([head, sep] + rows)


def save(df: pd.DataFrame, name: str) -> pd.DataFrame:
    df.to_csv(os.path.join(C.RESULTS, name), index=False)
    return df


def main():
    e = load_events()
    u = load_uncond()
    out = []
    A = out.append

    n_days = (e.ts.max() - e.ts.min()).days
    A(f"_Window: {e.ts.min():%Y-%m-%d} .. {e.ts.max():%Y-%m-%d} "
      f"({n_days} days), 4 symbols, 5m bars, {len(e):,} sweep events._\n")

    # ---------------------------------------------------------------- T1
    A("### T1. Sweep (take-out) frequency — level session x direction x asset\n")
    t1 = (e.groupby(["level_session", "direction", "symbol"])
            .size().rename("events").reset_index())
    t1["per_day"] = t1.events / n_days
    t1 = t1.pivot_table(index=["level_session", "direction"], columns="symbol",
                        values="events", aggfunc="sum").reindex(SESS_ORD, level=0)
    t1["TOTAL"] = t1.sum(axis=1)
    t1["per_day_all"] = t1["TOTAL"] / n_days
    A(md(save(t1.reset_index(), "t1_frequency_by_level_session.csv"), "{:.0f}")
      .replace("| per_day_all |", "| per_day_all |"))
    A("")

    # ---------------------------------------------------------------- T2
    A("### T2. Confirmation rate by method — level session x direction\n")
    t2 = (e.groupby(["level_session", "direction"])
            .agg(events=("bos_confirmed", "size"),
                 ifvg_rate=("ifvg_confirmed", "mean"),
                 bos_rate=("bos_confirmed", "mean"),
                 both=("both", "mean"), only_ifvg=("only_ifvg", "mean"),
                 only_bos=("only_bos", "mean"), neither=("neither", "mean"))
            .reset_index())
    for c in ["ifvg_rate", "bos_rate", "both", "only_ifvg", "only_bos", "neither"]:
        t2[c] = t2[c] * 100
    A(md(save(t2, "t2_confirmation_rates.csv")))
    A("\n_Rates in %. `both`/`only_*`/`neither` partition the same events — they sum to 100._\n")

    # ---------------------------------------------------------------- T3
    A("### T3. iFVG x BoS agreement matrix (all events, all sessions)\n")
    t3 = pd.DataFrame({
        "cell": ["both fire", "only iFVG", "only BoS", "neither"],
        "events": [e.both.sum(), e.only_ifvg.sum(), e.only_bos.sum(), e.neither.sum()],
    })
    t3["share_pct"] = t3.events / len(e) * 100
    A(md(save(t3, "t3_agreement_matrix.csv")))
    off = e.loc[e.both, "offset_bars"]
    A(f"\n**Timing offset when both fire** (iFVG delay − BoS delay, bars of 5m; "
      f"negative = iFVG first): n={len(off):,}, median {off.median():.0f}, "
      f"p25 {off.quantile(.25):.0f}, p75 {off.quantile(.75):.0f}, "
      f"iFVG-first {100*(off<0).mean():.1f}%, same-bar {100*(off==0).mean():.1f}%, "
      f"BoS-first {100*(off>0).mean():.1f}%.\n")

    t3b = (e.loc[e.both].groupby("level_session")["offset_bars"]
             .apply(lambda g: pd.Series(dist(g))).unstack().reindex(SESS_ORD))
    A(md(save(t3b.reset_index(), "t3b_offset_by_session.csv")))
    A("")

    # ---------------------------------------------------------------- T4
    A("### T4. Reverse move from the sweep's own wick extreme, 2h horizon "
      "(ALL take-outs, unconditional on confirmation)\n")
    rows = []
    for (s, dr), g in e.groupby(["level_session", "direction"]):
        rows.append(dict(level_session=s, direction=dr,
                         **{f"rev_atr_{k}": v for k, v in dist(g.rev_atr).items()},
                         rev_pct_median=g.rev_pct.median(),
                         adv_atr_median=g.adv_atr.median(),
                         end_atr_median=g.end_atr.median()))
    t4 = pd.DataFrame(rows).sort_values(["level_session", "direction"])
    A(md(save(t4, "t4_reverse_move_all.csv")))
    A("\n_`rev` = max favourable excursion away from the swept level (the reversal), "
      "`adv` = max continuation past the wick extreme, `end` = signed close at +2h. "
      "ATR = ATR(14) on 5m as of the take-out bar._\n")

    # ---------------------------------------------------------------- T5
    A("### T5. Reverse move split by confirmation method\n")
    rows = []
    for meth, mask in (("iFVG", e.ifvg_confirmed), ("BoS", e.bos_confirmed),
                       ("both", e.both), ("neither", e.neither),
                       ("ALL take-outs", pd.Series(True, index=e.index))):
        for s in SESS_ORD:
            g = e.loc[mask & (e.level_session == s)]
            rows.append(dict(method=meth, level_session=s, n=len(g),
                             rev_atr_median=g.rev_atr.median(),
                             rev_atr_p75=g.rev_atr.quantile(.75),
                             rev_atr_p90=g.rev_atr.quantile(.9),
                             rev_pct_median=g.rev_pct.median(),
                             adv_atr_median=g.adv_atr.median(),
                             end_atr_median=g.end_atr.median()))
    t5 = pd.DataFrame(rows)
    A(md(save(t5, "t5_reverse_move_by_method.csv")))
    A("")

    # ---------------------------------------------------------------- T6
    A("### T6. Reverse move by asset (all take-outs)\n")
    rows = []
    for (sym, dr), g in e.groupby(["symbol", "direction"]):
        rows.append(dict(symbol=sym, direction=dr, n=len(g),
                         rev_atr_median=g.rev_atr.median(),
                         rev_atr_p90=g.rev_atr.quantile(.9),
                         rev_pct_median=g.rev_pct.median(),
                         rev_pct_p90=g.rev_pct.quantile(.9),
                         adv_atr_median=g.adv_atr.median()))
    A(md(save(pd.DataFrame(rows), "t6_reverse_move_by_asset.csv")))
    A("\n_The ATR column is the comparable one; the % column shows why "
      "(raw % differs across assets purely through volatility)._\n")

    # ---------------------------------------------------------------- T7
    A("### T7. Session in which the take-out HAPPENS (vs. which session's level)\n")
    rows = []
    for sw, g in e.groupby("sweep_session"):
        rows.append(dict(sweep_session=sw, n=len(g),
                         share_pct=len(g) / len(e) * 100,
                         ifvg_rate=100 * g.ifvg_confirmed.mean(),
                         bos_rate=100 * g.bos_confirmed.mean(),
                         rev_atr_median=g.rev_atr.median(),
                         rev_atr_p90=g.rev_atr.quantile(.9),
                         adv_atr_median=g.adv_atr.median(),
                         end_atr_median=g.end_atr.median()))
    t7 = pd.DataFrame(rows).set_index("sweep_session").reindex(SWEEP_ORD).reset_index()
    A(md(save(t7, "t7_by_sweep_clock_session.csv")))
    A("")

    # ---------------------------------------------------------------- T7b
    A("### T7b. Lift over the unconditional baseline, by clock session\n")
    rows = []
    for sw in SWEEP_ORD:
        ub = u[u.sweep_session == sw]
        for dr, ucol in (("high_sweep", "down_atr"), ("low_sweep", "up_atr")):
            g = e[(e.sweep_session == sw) & (e.direction == dr)]
            base = ub[ucol].median()
            rows.append(dict(clock_session=sw, direction=dr, n=len(g),
                             cond_rev_atr_median=g.rev_atr.median(),
                             uncond_atr_median=base,
                             lift=g.rev_atr.median() / base))
    t7b = pd.DataFrame(rows)
    A(md(save(t7b, "t7b_lift_vs_unconditional.csv"), "{:.3f}"))
    A("\n_`lift` = conditional median / same-clock-session unconditional median. "
      "This is the honest way to read the user's NY/Asia prior: raw medians are "
      "confounded by how volatile each clock session is to begin with._\n")

    # ---------------------------------------------------------------- T8
    A("### T8. Take-out → confirmation delay (bars of 5m; window capped at 24 = 2h)\n")
    rows = []
    for meth, col, mask in (("iFVG", "ifvg_delay_bars", e.ifvg_confirmed),
                            ("BoS", "bos_delay_bars", e.bos_confirmed)):
        for s in ["ALL"] + SESS_ORD:
            g = e if s == "ALL" else e[e.level_session == s]
            g = g.loc[g.index.intersection(e.index[mask])]
            d_ = g[col].dropna()
            rows.append(dict(method=meth, level_session=s, n=len(d_),
                             median_bars=d_.median(), p25=d_.quantile(.25),
                             p75=d_.quantile(.75), p90=d_.quantile(.9),
                             median_min=d_.median() * C.BAR_MIN))
    A(md(save(pd.DataFrame(rows), "t8_confirmation_delay.csv")))
    A("")

    # ---------------------------------------------------------------- T9
    A("### T9. Unconditional yardstick — same 2h horizon, measured from EVERY bar\n")
    rows = []
    for sw in SWEEP_ORD:
        g = u[u.sweep_session == sw]
        rows.append(dict(clock_session=sw, bars=len(g),
                         down_atr_median=g.down_atr.median(),
                         down_atr_p90=g.down_atr.quantile(.9),
                         up_atr_median=g.up_atr.median(),
                         up_atr_p90=g.up_atr.quantile(.9)))
    g = u
    rows.append(dict(clock_session="ALL BARS", bars=len(g),
                     down_atr_median=g.down_atr.median(),
                     down_atr_p90=g.down_atr.quantile(.9),
                     up_atr_median=g.up_atr.median(),
                     up_atr_p90=g.up_atr.quantile(.9)))
    A(md(save(pd.DataFrame(rows), "t9_unconditional.csv")))
    A("\n_Context only, not a gate: `down_atr` is the drop from a bar's high over the "
      "next 2h (the high-sweep analogue), `up_atr` the rise from a bar's low._\n")

    cond_hi = e.loc[e.direction == "high_sweep", "rev_atr"]
    cond_lo = e.loc[e.direction == "low_sweep", "rev_atr"]
    A(f"Side by side — high-sweep reverse move median **{cond_hi.median():.2f} ATR** "
      f"vs unconditional down-move median **{u.down_atr.median():.2f} ATR**; "
      f"low-sweep **{cond_lo.median():.2f} ATR** vs unconditional up-move "
      f"**{u.up_atr.median():.2f} ATR**.\n")

    # ---------------------------------------------------------------- T10
    A("### T10. Monthly sweep counts (all assets, both directions)\n")
    t10 = (e.groupby(["month", "level_session"]).size().unstack()
             .reindex(columns=SESS_ORD).fillna(0))
    t10["TOTAL"] = t10.sum(axis=1)
    save(t10.reset_index(), "t10_monthly_counts.csv")
    A(f"Full table in `results/t10_monthly_counts.csv` ({len(t10)} months). "
      f"Per-month totals: median {t10.TOTAL.median():.0f}, "
      f"min {t10.TOTAL.min():.0f}, max {t10.TOTAL.max():.0f}; "
      f"monthly iFVG rate ranges "
      f"{100*e.groupby('month').ifvg_confirmed.mean().min():.0f}–"
      f"{100*e.groupby('month').ifvg_confirmed.mean().max():.0f}%, "
      f"BoS {100*e.groupby('month').bos_confirmed.mean().min():.0f}–"
      f"{100*e.groupby('month').bos_confirmed.mean().max():.0f}%. See chart 07.\n")

    # ---------------------------------------------------------------- T11
    A("### T11. Sensitivity — strict vs relaxed iFVG location test\n")
    t11 = pd.DataFrame([dict(
        variant="strict (whole gap beyond the level)",
        rate_pct=100 * e.ifvg_confirmed.mean(),
        rev_atr_median=e.loc[e.ifvg_confirmed, "rev_atr"].median()),
        dict(variant="relaxed (gap merely reaches beyond)",
             rate_pct=100 * e.ifvg_lax_confirmed.mean(),
             rev_atr_median=e.loc[e.ifvg_lax_confirmed, "rev_atr"].median())])
    A(md(save(t11, "t11_ifvg_sensitivity.csv")))
    A("")

    # ---------------------------------------------------------------- T12
    A("### T12. Reverse move measured from each method's CONFIRMATION close "
      "(secondary — what a trader entering on the signal would see)\n")
    rows = []
    for meth in ("ifvg", "bos"):
        for s in ["ALL"] + SESS_ORD:
            g = e if s == "ALL" else e[e.level_session == s]
            mfe = g[f"{meth}_mfe_atr"].dropna(); mae = g[f"{meth}_mae_atr"].dropna()
            rows.append(dict(method=meth.upper(), level_session=s, n=len(mfe),
                             mfe_atr_median=mfe.median(), mfe_atr_p90=mfe.quantile(.9),
                             mae_atr_median=mae.median(),
                             mfe_over_mae=mfe.median() / mae.median()))
    A(md(save(pd.DataFrame(rows), "t12_from_confirmation.csv")))
    A("\n_MFE/MAE over the 2h following the confirmation bar's close, in ATR(14) units._\n")

    # ---------------------------------------------------------------- T13
    A("### T13. Stop distance and R proxy at the confirmation bar\n")
    rows = []
    for meth in ("ifvg", "bos"):
        for s in ["ALL"] + SESS_ORD:
            g = e if s == "ALL" else e[e.level_session == s]
            st = g[f"{meth}_stop_atr"].dropna(); R = g[f"{meth}_R"].dropna()
            rows.append(dict(method=meth.upper(), level_session=s, n=len(st),
                             stop_atr_median=st.median(), stop_atr_p90=st.quantile(.9),
                             R_median=R.median(), R_p75=R.quantile(.75),
                             share_R_ge_1=100 * (R >= 1).mean(),
                             share_R_ge_2=100 * (R >= 2).mean()))
    A(md(save(pd.DataFrame(rows), "t13_stop_and_R.csv")))
    A("\n_Stop = distance from the confirmation close back to the sweep leg's running "
      "extreme (take-out bar .. confirmation bar). `R` = 2h MFE / that stop distance. "
      "`share_R_ge_1` = % of confirmed events where price travelled at least one stop "
      "distance in the favourable direction within 2h. Descriptive only — no costs, "
      "no exit rule, not a backtest._\n")

    txt = "\n".join(out)
    with open(os.path.join(C.RESULTS, "TABLES.md"), "w") as fh:
        fh.write(txt)
    print(txt)


if __name__ == "__main__":
    main()
