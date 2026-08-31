#!/usr/bin/env python3
"""Aggregation tables — session-liquidity **v2** descriptive study (iFVG only).

Reads results/events_*.csv + results/uncond_*.csv.gz (engine.py output) and
writes both CSVs and a markdown block (results/TABLES.md) that REPORT.md embeds.

Everything here is descriptive: counts, rates, quantiles. No hypothesis tests,
no pass/fail gate — by explicit protocol decision for this pass.

The v2 rule that shapes every magnitude table: the horizon is block-scoped, so
**primary tables use only events with >= 12 bars (1h) left in their block**, and
the full sample is reported in the appendix rather than silently dropped
(knowledge/session-liquidity.md §Measurement horizon).
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C

Q = [0.25, 0.5, 0.75, 0.9]
SESS_ORD = C.LEVEL_SESSIONS              # whose level: Asia / London / NY
BLOCK_ORD = C.BLOCK_ORDER                # where the take-out happened, + Late
MINB = C.MIN_BARS_REMAINING

# bars_remaining buckets used for the window-matched lift (T9b) — a take-out
# 20 bars from the block close and one 90 bars from it are not comparable.
REM_BINS = [0, 12, 24, 48, 96, 10 ** 9]
REM_LBL = ["<12 (appendix only)", "12-23", "24-47", "48-95", "96+"]


def load_events() -> pd.DataFrame:
    fr = [pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"),
                      parse_dates=["ts"]) for s in C.SYMBOLS]
    e = pd.concat(fr, ignore_index=True)
    e["rem_bucket"] = pd.cut(e.bars_remaining, REM_BINS, right=False, labels=REM_LBL)
    e["primary"] = e.bars_remaining >= MINB
    return e


def load_uncond() -> pd.DataFrame:
    fr = [pd.read_csv(os.path.join(C.RESULTS, f"uncond_{s}.csv.gz"))
          for s in C.SYMBOLS]
    u = pd.concat(fr, ignore_index=True)
    u["rem_bucket"] = pd.cut(u.bars_remaining, REM_BINS, right=False, labels=REM_LBL)
    return u


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
    p = e[e.primary]                    # the primary sample, used everywhere below
    up = u[u.bars_remaining >= MINB]    # window-matched baseline
    out = []
    A = out.append

    n_days = (e.ts.max() - e.ts.min()).days
    A(f"_Window: {e.ts.min():%Y-%m-%d} .. {e.ts.max():%Y-%m-%d} ({n_days} days), "
      f"4 symbols, 5m bars. **{len(e):,} take-outs** in total; "
      f"**{len(p):,} ({100*len(p)/len(e):.1f}%)** are in the primary sample "
      f"(>= {MINB} bars = 1h left in the sweep block). Sessions are "
      f"non-overlapping (Asia 00-08 / London 08-13 / NY 13-21 / Late 21-24 UTC); "
      f"Late produces no levels but hosts take-outs. iFVG only — BoS is out of "
      f"scope for this pass._\n")

    # ================================================================ WINDOW
    A("### W1. Window-length distribution — how much block is left after a take-out\n")
    rows = []
    for b in BLOCK_ORD:
        g = e[e.sweep_block == b]
        rows.append(dict(sweep_block=b, take_outs=len(g),
                         share_pct=100 * len(g) / len(e),
                         rem_median=g.bars_remaining.median(),
                         rem_p25=g.bars_remaining.quantile(.25),
                         rem_p75=g.bars_remaining.quantile(.75),
                         window_min_median=g.window_min.median(),
                         share_primary_pct=100 * g.primary.mean(),
                         share_zero_window_pct=100 * (g.bars_remaining == 0).mean()))
    g = e
    rows.append(dict(sweep_block="ALL", take_outs=len(g), share_pct=100.0,
                     rem_median=g.bars_remaining.median(),
                     rem_p25=g.bars_remaining.quantile(.25),
                     rem_p75=g.bars_remaining.quantile(.75),
                     window_min_median=g.window_min.median(),
                     share_primary_pct=100 * g.primary.mean(),
                     share_zero_window_pct=100 * (g.bars_remaining == 0).mean()))
    A(md(save(pd.DataFrame(rows), "w1_window_length.csv")))
    A("\n_`rem_*` are bars of 5m remaining in the block after the take-out bar; "
      "`window_min_median` is the same in minutes. `share_primary_pct` is the "
      "fraction that clears the >= 12-bar rule; the rest are the appendix "
      "sample (A1/A2). A zero window means the take-out printed on the block's "
      "very last bar — counted as a take-out, no magnitude measurable._\n")

    A("### W2. Take-outs and confirmation rate by remaining-window bucket\n")
    rows = []
    for lbl in REM_LBL:
        g = e[e.rem_bucket == lbl]
        if not len(g):
            continue
        rows.append(dict(bars_remaining=lbl, n=len(g), share_pct=100 * len(g) / len(e),
                         ifvg_rate=100 * g.ifvg_confirmed.mean(),
                         ifvg_delay_median=g.ifvg_delay_bars.median(),
                         rev_atr_median=g.rev_atr.median(),
                         adv_atr_median=g.adv_atr.median()))
    A(md(save(pd.DataFrame(rows), "w2_by_window_bucket.csv")))
    A("\n_This is the table that says how much of the confirmation rate is just "
      "window length. It is also why lift is computed bucket-matched (T9b)._\n")

    # ============================================================= FREQUENCY
    A("### T1. Take-out frequency — level_session x sweep_block "
      "(primary sample, all assets, both directions)\n")
    t1 = (p.pivot_table(index="level_session", columns="sweep_block",
                        values="bar", aggfunc="size")
           .reindex(index=SESS_ORD, columns=BLOCK_ORD).fillna(0))
    t1["TOTAL"] = t1.sum(axis=1)
    t1.loc["TOTAL"] = t1.sum(axis=0)
    A(md(save(t1.reset_index(), "t1_freq_levelsession_x_block.csv"), "{:.0f}"))
    A(f"\n_Rows = whose liquidity was taken; columns = the clock block it was "
      f"taken in. {len(p)/n_days:.1f} take-outs/day across the 4 assets._\n")

    A("### T1b. Take-out frequency — level_session x direction x asset (primary)\n")
    t1b = (p.pivot_table(index=["level_session", "direction"], columns="symbol",
                         values="bar", aggfunc="size").reindex(SESS_ORD, level=0))
    t1b["TOTAL"] = t1b.sum(axis=1)
    t1b["per_day"] = t1b["TOTAL"] / n_days
    A(md(save(t1b.reset_index(), "t1b_freq_by_asset.csv"), "{:.2f}"))
    A("")

    # ========================================================== CONFIRMATION
    A("### T2. iFVG confirmation rate — level_session x sweep_block (primary)\n")
    t2 = (p.pivot_table(index="level_session", columns="sweep_block",
                        values="ifvg_confirmed", aggfunc="mean")
           .reindex(index=SESS_ORD, columns=BLOCK_ORD) * 100)
    t2["ALL blocks"] = p.groupby("level_session").ifvg_confirmed.mean().reindex(SESS_ORD) * 100
    t2.loc["ALL levels"] = [100 * p.loc[p.sweep_block == b, "ifvg_confirmed"].mean()
                            for b in BLOCK_ORD] + [100 * p.ifvg_confirmed.mean()]
    A(md(save(t2.reset_index(), "t2_ifvg_rate_levelsession_x_block.csv")))
    A("\n_% of take-outs whose sweep is confirmed by a relaxed, block-scoped iFVG._\n")

    A("### T2b. iFVG confirmation rate — direction x asset x level_session (primary)\n")
    rows = []
    for (s_, dr), g in p.groupby(["level_session", "direction"]):
        r = dict(level_session=s_, direction=dr, n=len(g),
                 ifvg_rate_ALL=100 * g.ifvg_confirmed.mean())
        for sym in C.SYMBOLS:
            gs = g[g.symbol == sym]
            r[sym] = 100 * gs.ifvg_confirmed.mean() if len(gs) else np.nan
        rows.append(r)
    t2b = pd.DataFrame(rows).set_index(["level_session", "direction"]).reindex(SESS_ORD, level=0)
    A(md(save(t2b.reset_index(), "t2b_ifvg_rate_by_asset.csv")))
    A("")

    A("### T3. Take-out -> iFVG confirmation delay, and the block-truncation share\n")
    rows = []
    for b in BLOCK_ORD + ["ALL"]:
        g = p if b == "ALL" else p[p.sweep_block == b]
        dly = g.loc[g.ifvg_confirmed, "ifvg_delay_bars"]
        unc = g[~g.ifvg_confirmed]
        rows.append(dict(sweep_block=b, n=len(g),
                         confirmed_pct=100 * g.ifvg_confirmed.mean(),
                         delay_median_bars=dly.median(), delay_p25=dly.quantile(.25),
                         delay_p75=dly.quantile(.75), delay_p90=dly.quantile(.9),
                         delay_median_min=dly.median() * C.BAR_MIN,
                         unconfirmed_n=len(unc),
                         truncated_share_pct=100 * unc.ifvg_would_confirm_extended.mean()
                         if len(unc) else np.nan))
    A(md(save(pd.DataFrame(rows), "t3_delay_and_truncation.csv")))
    A(f"\n_`truncated_share_pct` = of the take-outs left UNCONFIRMED, the share "
      f"that WOULD have confirmed had the block run "
      f"{C.TRUNCATION_PROBE_BARS * C.BAR_MIN / 60:.0f}h longer. That is the price "
      f"of the block-scoped rule, quantified rather than assumed. It is a "
      f"diagnostic probe, not part of any definition — those events stay "
      f"unconfirmed everywhere else in this report._\n")

    # ======================================================= MAGNITUDE (WICK)
    A("### T4. Magnitude from the sweep's own WICK EXTREME, block-scoped "
      "(primary sample, ALL take-outs regardless of confirmation)\n")
    rows = []
    for s_ in SESS_ORD:
        for dr in ("high_sweep", "low_sweep"):
            g = p[(p.level_session == s_) & (p.direction == dr)]
            rows.append(dict(level_session=s_, direction=dr,
                             **{f"rev_atr_{k}": v for k, v in dist(g.rev_atr).items()},
                             rev_pct_median=g.rev_pct.median(),
                             adv_atr_median=g.adv_atr.median(),
                             adv_atr_p90=g.adv_atr.quantile(.9),
                             share_no_continuation=100 * g.no_continuation.mean(),
                             end_atr_median=g.end_atr.median()))
    A(md(save(pd.DataFrame(rows), "t4_wick_magnitude.csv")))
    A("\n_`rev` = max FAVOURABLE excursion away from the swept level within the "
      "block (the reversal); `adv` = max ADVERSE continuation past the wick "
      "extreme; `end` = signed value at the block's closing bar (positive = "
      "still on the reversal side); `share_no_continuation` = % of take-outs "
      "where price NEVER traded past the take-out wick again before the block "
      "closed (excursions are floored at 0, so this column carries what the "
      "floor hides). ATR = ATR(14) 5m read at the take-out bar. "
      "Measured from the wick, this table is contaminated by hindsight — the "
      "wick extreme is only knowable after the fact. T6/T7 are the tradable view._\n")

    A("### T5. Magnitude from the wick extreme, by asset and by sweep_block (primary)\n")
    rows = []
    for sym in C.SYMBOLS:
        for b in BLOCK_ORD:
            g = p[(p.symbol == sym) & (p.sweep_block == b)]
            if not len(g):
                continue
            rows.append(dict(symbol=sym, sweep_block=b, n=len(g),
                             rev_atr_median=g.rev_atr.median(),
                             rev_atr_p90=g.rev_atr.quantile(.9),
                             rev_pct_median=g.rev_pct.median(),
                             adv_atr_median=g.adv_atr.median(),
                             end_atr_median=g.end_atr.median()))
    A(md(save(pd.DataFrame(rows), "t5_wick_magnitude_by_asset_block.csv")))
    A("\n_The ATR column is the cross-asset-comparable one; the % column is kept "
      "beside it to show why (raw % differs across assets purely through "
      "volatility — SOL looks ~2x BTC in % and does not in ATR)._\n")

    # =============================================== MAGNITUDE (CONFIRMATION)
    A("### T6. Magnitude from the iFVG CONFIRMATION CLOSE — the tradable view "
      "(primary sample, confirmed events only)\n")
    rows = []
    for s_ in ["ALL"] + SESS_ORD:
        for dr in ["ALL", "high_sweep", "low_sweep"]:
            g = p[p.ifvg_confirmed]
            if s_ != "ALL":
                g = g[g.level_session == s_]
            if dr != "ALL":
                g = g[g.direction == dr]
            mfe = g.ifvg_mfe_atr.dropna(); mae = g.ifvg_mae_atr.dropna()
            rows.append(dict(level_session=s_, direction=dr, n=len(mfe),
                             mfe_atr_median=mfe.median(), mfe_atr_p75=mfe.quantile(.75),
                             mfe_atr_p90=mfe.quantile(.9),
                             mae_atr_median=mae.median(), mae_atr_p90=mae.quantile(.9),
                             mfe_over_mae=mfe.median() / mae.median() if mae.median() else np.nan,
                             end_atr_median=g.ifvg_end_atr.median(),
                             share_end_positive=100 * (g.ifvg_end_atr > 0).mean(),
                             conf_bars_left_median=g.conf_bars_remaining.median()))
    A(md(save(pd.DataFrame(rows), "t6_from_confirmation.csv")))
    A("\n_MFE/MAE over what is LEFT of the block after the confirmation bar's "
      "close (median `conf_bars_left_median` bars), in ATR units. This is what a "
      "trader entering on the signal actually has in front of them — the "
      "uncontaminated comparison. `share_end_positive` = % of confirmed events "
      "still on the favourable side of the entry when the block closes._\n")

    A("### T7. Stop proxy and R proxy at the iFVG confirmation bar (primary, confirmed)\n")
    rows = []
    for s_ in ["ALL"] + SESS_ORD:
        for b in ["ALL"] + BLOCK_ORD:
            g = p[p.ifvg_confirmed]
            if s_ != "ALL":
                g = g[g.level_session == s_]
            if b != "ALL":
                g = g[g.sweep_block == b]
            st = g.ifvg_stop_atr.dropna(); R = g.ifvg_R.dropna()
            if not len(st):
                continue
            rows.append(dict(level_session=s_, sweep_block=b, n=len(st),
                             stop_atr_median=st.median(), stop_atr_p90=st.quantile(.9),
                             R_median=R.median(), R_p75=R.quantile(.75),
                             share_R_ge_1=100 * (R >= 1).mean(),
                             share_R_ge_2=100 * (R >= 2).mean()))
    A(md(save(pd.DataFrame(rows), "t7_stop_and_R.csv")))
    A("\n_Stop = distance from the confirmation close back to the sweep leg's "
      "running extreme (take-out bar .. confirmation bar) — where a protective "
      "stop would sit. `R` = (block-scoped MFE) / (that stop distance). "
      "`share_R_ge_1` = % of confirmed events where price travelled at least one "
      "stop distance favourably before the block closed. **Descriptive only** — "
      "no costs, no exit rule, no slippage, not a backtest, and MFE is a "
      "best-case exit nobody can hit systematically._\n")

    # ==================================================== BASELINE  &  LIFT
    A("### T8. Unconditional yardstick — the same block-scoped horizon, from EVERY bar\n")
    rows = []
    for b in BLOCK_ORD:
        g = up[up.sweep_block == b]
        rows.append(dict(sweep_block=b, bars=len(g),
                         down_atr_median=g.down_atr.median(),
                         down_atr_p90=g.down_atr.quantile(.9),
                         up_atr_median=g.up_atr.median(),
                         up_atr_p90=g.up_atr.quantile(.9)))
    rows.append(dict(sweep_block="ALL", bars=len(up),
                     down_atr_median=up.down_atr.median(),
                     down_atr_p90=up.down_atr.quantile(.9),
                     up_atr_median=up.up_atr.median(),
                     up_atr_p90=up.up_atr.quantile(.9)))
    A(md(save(pd.DataFrame(rows), "t8_unconditional.csv")))
    A(f"\n_Context, not a gate: `down_atr` is the drop from a bar's high to the "
      f"end of that bar's own block (the high-sweep analogue), `up_atr` the rise "
      f"from a bar's low. Restricted to bars with >= {MINB} bars left, to match "
      f"the primary sample. NOTE the asymmetry this bakes in: a block's early "
      f"bars have long windows and its late bars short ones, in the baseline "
      f"exactly as in the events — which is why T9b exists._\n")

    A("### T9. Lift over each block's OWN unconditional baseline (primary sample)\n")
    rows = []
    for b in BLOCK_ORD:
        ub = up[up.sweep_block == b]
        for dr, ucol in (("high_sweep", "down_atr"), ("low_sweep", "up_atr")):
            g = p[(p.sweep_block == b) & (p.direction == dr)]
            base = ub[ucol].median()
            gc = g[g.ifvg_confirmed]
            rows.append(dict(sweep_block=b, direction=dr, n_takeouts=len(g),
                             takeout_rev_atr_median=g.rev_atr.median(),
                             uncond_atr_median=base,
                             lift_takeout=g.rev_atr.median() / base,
                             n_confirmed=len(gc),
                             confirmed_rev_atr_median=gc.rev_atr.median(),
                             lift_confirmed=gc.rev_atr.median() / base))
    A(md(save(pd.DataFrame(rows), "t9_lift_vs_unconditional.csv"), "{:.3f}"))
    A("\n_`lift` = conditional median / same-block unconditional median. This is "
      "the honest way to read the user's NY/Asia prior: raw medians are "
      "confounded by how volatile each block is to begin with, and by how long "
      "its windows are. A lift near 1.0 means the sweep told you nothing the "
      "clock did not already tell you. Both columns measure from the WICK "
      "extreme, so both are hindsight-flattered in the same way — the comparison "
      "survives, the level does not._\n")

    A("### T9b. Window-matched lift — same comparison, inside bars_remaining buckets\n")
    rows = []
    for b in BLOCK_ORD:
        for lbl in REM_LBL[1:]:
            g = p[(p.sweep_block == b) & (p.rem_bucket == lbl)]
            ub = up[(up.sweep_block == b) & (up.rem_bucket == lbl)]
            if len(g) < 50 or not len(ub):
                continue
            gh = g[g.direction == "high_sweep"]; gl = g[g.direction == "low_sweep"]
            rows.append(dict(sweep_block=b, bars_remaining=lbl, n=len(g),
                             hi_lift=gh.rev_atr.median() / ub.down_atr.median(),
                             lo_lift=gl.rev_atr.median() / ub.up_atr.median(),
                             hi_conf_lift=gh[gh.ifvg_confirmed].rev_atr.median() / ub.down_atr.median(),
                             lo_conf_lift=gl[gl.ifvg_confirmed].rev_atr.median() / ub.up_atr.median()))
    A(md(save(pd.DataFrame(rows), "t9b_lift_window_matched.csv"), "{:.3f}"))
    A("\n_Removes the last confound in T9: within a block, an early take-out has "
      "a long window and a late one a short window, and so does the baseline bar "
      "it is compared against. Matching on the bucket compares like with like._\n")

    # ================================================================ SPLITS
    A("### T10. `n_levels_taken` split — how often one bar clears several levels\n")
    rows = []
    for k in sorted(p.n_levels_taken.unique()):
        g = p[p.n_levels_taken == k]
        rows.append(dict(n_levels_taken=int(k), n=len(g),
                         share_pct=100 * len(g) / len(p),
                         ifvg_rate=100 * g.ifvg_confirmed.mean(),
                         excursion_atr_median=g.excursion_atr.median(),
                         rev_atr_median=g.rev_atr.median(),
                         adv_atr_median=g.adv_atr.median(),
                         conf_mfe_atr_median=g.ifvg_mfe_atr.median(),
                         conf_R_median=g.ifvg_R.median()))
    A(md(save(pd.DataFrame(rows), "t10_n_levels_taken.csv")))
    A("\n_V2 attribution: when one bar takes out several levels the event is "
      "credited to the deepest one and all of them are retired, so a multi-level "
      "bar produces ONE event, not N correlated ones. This table is what that "
      "choice costs / buys._\n")

    A("### T11. Sensitivity — relaxed (V5 default) vs strict iFVG location\n")
    t11 = pd.DataFrame([
        dict(variant="relaxed — gap merely reaches beyond the level (V5, used everywhere above)",
             rate_pct=100 * p.ifvg_confirmed.mean(),
             n=int(p.ifvg_confirmed.sum()),
             delay_median=p.loc[p.ifvg_confirmed, "ifvg_delay_bars"].median(),
             rev_atr_median=p.loc[p.ifvg_confirmed, "rev_atr"].median()),
        dict(variant="strict — whole gap beyond the level (phase-1 D5, sensitivity only)",
             rate_pct=100 * p.ifvg_strict_confirmed.mean(),
             n=int(p.ifvg_strict_confirmed.sum()),
             delay_median=p.loc[p.ifvg_strict_confirmed, "ifvg_strict_delay_bars"].median(),
             rev_atr_median=p.loc[p.ifvg_strict_confirmed, "rev_atr"].median())])
    A(md(save(t11, "t11_ifvg_location_sensitivity.csv")))
    A("")

    # ============================================================= STABILITY
    A("### T12. Monthly stability\n")
    m = p.groupby("month").agg(take_outs=("bar", "size"),
                               ifvg_rate=("ifvg_confirmed", "mean"),
                               rev_atr_median=("rev_atr", "median"),
                               conf_mfe_atr_median=("ifvg_mfe_atr", "median"),
                               conf_R_median=("ifvg_R", "median"))
    m["ifvg_rate"] *= 100
    save(m.reset_index(), "t12_monthly.csv")
    ms = p.groupby(["month", "level_session"]).size().unstack().reindex(columns=SESS_ORD)
    save(ms.reset_index(), "t12b_monthly_by_level_session.csv")
    A(f"Full tables in `results/t12_monthly.csv` and "
      f"`results/t12b_monthly_by_level_session.csv` ({len(m)} months). "
      f"Per-month take-outs: median {m.take_outs.median():.0f}, "
      f"min {m.take_outs.min():.0f}, max {m.take_outs.max():.0f}. "
      f"Monthly iFVG rate ranges **{m.ifvg_rate.min():.0f}–{m.ifvg_rate.max():.0f}%** "
      f"(median {m.ifvg_rate.median():.0f}%). Monthly median R proxy ranges "
      f"**{m.conf_R_median.min():.2f}–{m.conf_R_median.max():.2f}** "
      f"(median {m.conf_R_median.median():.2f}). "
      f"Worst / best month by iFVG rate: "
      f"{m.ifvg_rate.idxmin()} / {m.ifvg_rate.idxmax()}. See chart 07.\n")

    # ============================================================== APPENDIX
    A("### A1. APPENDIX — the short-window sample that the primary tables exclude\n")
    q = e[~e.primary]
    rows = [dict(sample="primary (>= 12 bars left)", n=len(p),
                 share_pct=100 * len(p) / len(e),
                 rem_median=p.bars_remaining.median(),
                 ifvg_rate=100 * p.ifvg_confirmed.mean(),
                 rev_atr_median=p.rev_atr.median(),
                 adv_atr_median=p.adv_atr.median(),
                 conf_R_median=p.ifvg_R.median()),
            dict(sample="short window (< 12 bars left)", n=len(q),
                 share_pct=100 * len(q) / len(e),
                 rem_median=q.bars_remaining.median(),
                 ifvg_rate=100 * q.ifvg_confirmed.mean(),
                 rev_atr_median=q.rev_atr.median(),
                 adv_atr_median=q.adv_atr.median(),
                 conf_R_median=q.ifvg_R.median()),
            dict(sample="FULL sample (both)", n=len(e), share_pct=100.0,
                 rem_median=e.bars_remaining.median(),
                 ifvg_rate=100 * e.ifvg_confirmed.mean(),
                 rev_atr_median=e.rev_atr.median(),
                 adv_atr_median=e.adv_atr.median(),
                 conf_R_median=e.ifvg_R.median())]
    A(md(save(pd.DataFrame(rows), "a1_primary_vs_short_window.csv")))
    A("\n_The short-window events are not noise to be discarded — they are real "
      "take-outs whose measurement window the clock cut short. Their lower "
      "confirmation rate and smaller magnitudes are an artefact of window "
      "length, which is exactly why they are reported separately rather than "
      "pooled in._\n")

    A("### A2. APPENDIX — full-sample versions of T2 and T4 (no window filter)\n")
    a2 = (e.pivot_table(index="level_session", columns="sweep_block",
                        values="ifvg_confirmed", aggfunc="mean")
           .reindex(index=SESS_ORD, columns=BLOCK_ORD) * 100)
    a2["ALL blocks"] = e.groupby("level_session").ifvg_confirmed.mean().reindex(SESS_ORD) * 100
    A(md(save(a2.reset_index(), "a2_ifvg_rate_full_sample.csv")))
    A("")
    rows = []
    for s_ in SESS_ORD:
        for dr in ("high_sweep", "low_sweep"):
            g = e[(e.level_session == s_) & (e.direction == dr)]
            rows.append(dict(level_session=s_, direction=dr, n=len(g),
                             rev_atr_median=g.rev_atr.median(),
                             rev_atr_p90=g.rev_atr.quantile(.9),
                             adv_atr_median=g.adv_atr.median(),
                             end_atr_median=g.end_atr.median()))
    A(md(save(pd.DataFrame(rows), "a2b_wick_magnitude_full_sample.csv")))
    A("")

    txt = "\n".join(out)
    with open(os.path.join(C.RESULTS, "TABLES.md"), "w") as fh:
        fh.write(txt)
    print(txt)


if __name__ == "__main__":
    main()
