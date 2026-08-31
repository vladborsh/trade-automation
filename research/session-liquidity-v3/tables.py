#!/usr/bin/env python3
"""Aggregation tables — session-liquidity **v3** (corrected iFVG state machine).

Reads results/events_*.csv + results/uncond_*.csv.gz (engine.py output) and
writes CSVs plus a markdown block (results/TABLES.md) that REPORT.md embeds.

DELTA-STYLE PASS. Only the **confirmation-dependent** tables are re-derived
here; the upstream ones that the v3 change cannot touch (take-out frequency
T1/T1b, wick-anchored magnitude T4/T5, the unconditional yardstick T8, the
`n_levels_taken` frequency split, the window-length distribution W1) are
unchanged and stay in `../session-liquidity-v2/results/`. `checks.py` proves
the take-out stream is byte-identical, which is what licenses that.

Everything is descriptive (§8): counts, rates, quantiles. No hypothesis test,
no gate.

Table families:
  D*  v2 vs v3 — the bug's bias, quantified (incl. selected-gap-size)
  V*  variant comparison A (primary) / B / C — the pin-3 geometry finding
  S*  state-machine diagnostics (candidates, invalidations, replacements,
      unconfirmed-by-cause)
  T*  the re-derived core tables (rate, delay, from-confirmation geometry, R)
  H*  hour-of-day, window-length-stratified (§5.1 required deliverable)
  A*  appendix (short-window sample, full-sample versions)

Usage: .venv/bin/python research/session-liquidity-v3/tables.py
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

# v2's bars_remaining buckets — kept identical so the v3 lift tables stay
# comparable with v2's T9b.
REM_BINS = [0, 12, 24, 48, 96, 10 ** 9]
REM_LBL = ["<12 (appendix only)", "12-23", "24-47", "48-95", "96+"]

# DESIGN.md §2 pins a DIFFERENT stratification for the hour-of-day chart
# (12-24 / 24-48 / 48-72 / 72+). Both are kept, each where its brief asks for
# it, rather than silently reconciling them.
HOUR_BINS = [12, 24, 48, 72, 10 ** 9]
HOUR_LBL = ["12-23", "24-47", "48-71", "72+"]


def load_events() -> pd.DataFrame:
    fr = [pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"),
                      parse_dates=["ts"]) for s in C.SYMBOLS]
    e = pd.concat(fr, ignore_index=True)
    e["rem_bucket"] = pd.cut(e.bars_remaining, REM_BINS, right=False, labels=REM_LBL)
    e["hour_bucket"] = pd.cut(e.bars_remaining, HOUR_BINS, right=False, labels=HOUR_LBL)
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


def qtiles(g: pd.Series, pref: str) -> dict:
    g = g.dropna()
    if not len(g):
        return {f"{pref}_n": 0}
    return {f"{pref}_n": len(g), f"{pref}_p10": g.quantile(.10),
            f"{pref}_median": g.median(), f"{pref}_p90": g.quantile(.90),
            f"{pref}_mean": g.mean()}


def main():
    e = load_events()
    u = load_uncond()
    p = e[e.primary]                    # the primary sample
    up = u[u.bars_remaining >= MINB]    # window-matched baseline
    out = []
    A = out.append

    n_days = (e.ts.max() - e.ts.min()).days
    A(f"_Window: {e.ts.min():%Y-%m-%d} .. {e.ts.max():%Y-%m-%d} ({n_days} days), "
      f"4 symbols, 5m bars. **{len(e):,} take-outs** — byte-identical to v2's "
      f"event stream (checks.py) — of which **{len(p):,} "
      f"({100*len(p)/len(e):.1f}%)** are primary (>= {MINB} bars = 1h left in "
      f"the sweep block). Only the iFVG confirmation layer differs from v2. "
      f"iFVG only; no BoS, no PDH/PDL._\n")

    # ==================================================================== D
    A("## D. v2 vs v3 — what the retroactive-best-pick bug was buying\n")
    A("### D1. Headline metrics, both algorithms, same event rows (primary sample)\n")
    rows = []
    for tag, cf, dly, gp, mfe, mae, st, R in (
            ("v2 (retroactive best-pick — the bug)", "v2_ifvg_confirmed",
             "v2_ifvg_delay_bars", "v2_ifvg_gap_atr", "v2_ifvg_mfe_atr",
             "v2_ifvg_mae_atr", "v2_ifvg_stop_atr", "v2_ifvg_R"),
            ("v3 (sequential state machine, §5.1 / V9)", "ifvg_confirmed",
             "ifvg_delay_bars", "ifvg_gap_atr", "ifvg_mfe_atr",
             "ifvg_mae_atr", "ifvg_stop_atr", "ifvg_R")):
        g = p[p[cf]]
        rows.append(dict(algorithm=tag, n_confirmed=len(g),
                         confirm_rate_pct=100 * p[cf].mean(),
                         delay_median_bars=g[dly].median(),
                         gap_size_atr_median=g[gp].median(),
                         mfe_atr_median=g[mfe].median(),
                         mae_atr_median=g[mae].median(),
                         stop_atr_median=g[st].median(),
                         R_median=g[R].median(),
                         share_R_ge_1=100 * (g[R] >= 1).mean(),
                         share_R_ge_2=100 * (g[R] >= 2).mean()))
    d1 = pd.DataFrame(rows)
    delta = {"algorithm": "delta (v3 - v2)"}
    for c in d1.columns[1:]:
        delta[c] = d1[c].iloc[1] - d1[c].iloc[0]
    d1 = pd.concat([d1, pd.DataFrame([delta])], ignore_index=True)
    A(md(save(d1, "d1_v2_vs_v3_headline.csv")))
    A("\n_Same take-outs, same horizon, same geometry formulas — the ONLY "
      "difference is which gap (if any) each algorithm selects. Every row is "
      "computed on the confirmed subset of that algorithm, so `n_confirmed` "
      "differs by construction; that difference IS the finding._\n")

    A("### D2. Selected-gap-size distribution — the small-gap-bias prediction, tested\n")
    rows = []
    for tag, cf, gp in (("v2 (retroactive best-pick)", "v2_ifvg_confirmed", "v2_ifvg_gap_atr"),
                        ("v3 (sequential)", "ifvg_confirmed", "ifvg_gap_atr")):
        g = p.loc[p[cf], gp]
        rows.append(dict(algorithm=tag, n=len(g.dropna()),
                         **{k.replace("gap_", ""): v for k, v in qtiles(g, "gap").items() if k != "gap_n"}))
    both = p[p.ifvg_confirmed & p.v2_ifvg_confirmed]
    rows.append(dict(algorithm="v2, restricted to events v3 ALSO confirms",
                     n=int(both.v2_ifvg_gap_atr.notna().sum()),
                     **{k.replace("gap_", ""): v for k, v in
                        qtiles(both.v2_ifvg_gap_atr, "gap").items() if k != "gap_n"}))
    rows.append(dict(algorithm="v3, restricted to events v2 ALSO confirms",
                     n=int(both.ifvg_gap_atr.notna().sum()),
                     **{k.replace("gap_", ""): v for k, v in
                        qtiles(both.ifvg_gap_atr, "gap").items() if k != "gap_n"}))
    d2 = pd.DataFrame(rows)
    A(md(save(d2, "d2_selected_gap_size.csv"), "{:.3f}"))
    A(f"\n_Gap height of the SELECTED gap, in ATR(14, 5m) at the take-out bar. "
      f"The last two rows hold the event set fixed so the comparison is not "
      f"confounded by the two algorithms confirming different take-outs. "
      f"Agreement on WHICH gap: of the {len(both):,} take-outs both algorithms "
      f"confirm, **{100*both.same_gap_selected.mean():.1f}%** select the same "
      f"gap._\n")

    A("### D3. Where the two algorithms disagree (primary sample)\n")
    rows = [dict(case="both confirm, SAME gap selected",
                 n=int((p.ifvg_confirmed & p.v2_ifvg_confirmed & p.same_gap_selected).sum())),
            dict(case="both confirm, DIFFERENT gap selected",
                 n=int((p.ifvg_confirmed & p.v2_ifvg_confirmed & ~p.same_gap_selected).sum())),
            dict(case="v2 confirms, v3 does not",
                 n=int((~p.ifvg_confirmed & p.v2_ifvg_confirmed).sum())),
            dict(case="v3 confirms, v2 does not",
                 n=int((p.ifvg_confirmed & ~p.v2_ifvg_confirmed).sum())),
            dict(case="neither confirms",
                 n=int((~p.ifvg_confirmed & ~p.v2_ifvg_confirmed).sum()))]
    d3 = pd.DataFrame(rows)
    d3["share_pct"] = 100 * d3.n / len(p)
    A(md(save(d3, "d3_agreement.csv")))
    A("\n_v3's confirmed set is a strict SUBSET of v2's here — mechanically "
      "expected: v3 can only ever confirm through a gap v2 also saw, and v2 "
      "additionally accepts gaps v3 had already replaced or invalidated away._\n")

    # ==================================================================== V
    A("## V. The pin-3 geometry finding — three invalidation variants\n")
    A("### V1. Confirmation rate and geometry under A / B / C (primary sample)\n")
    rows = []
    specs = [("A — PRIMARY: pin 3 as written (invalidation wins the tie)",
              "ifvg_confirmed", "ifvg_delay_bars", "ifvg_mfe_atr", "ifvg_stop_atr", "ifvg_R"),
             ("B — sensitivity: confirmation wins the tie",
              "B_confirmed", "B_delay_bars", "B_mfe_atr", "B_stop_atr", "B_R"),
             ("C — sensitivity: reference = running extreme frozen at activation",
              "C_confirmed", "C_delay_bars", "C_mfe_atr", "C_stop_atr", "C_R"),
             ("v2 (the bug), for scale", "v2_ifvg_confirmed", "v2_ifvg_delay_bars",
              "v2_ifvg_mfe_atr", "v2_ifvg_stop_atr", "v2_ifvg_R")]
    for tag, cf, dly, mfe, st, R in specs:
        g = p[p[cf]]
        rows.append(dict(variant=tag, n_confirmed=len(g),
                         confirm_rate_pct=100 * p[cf].mean(),
                         delay_median_bars=g[dly].median(),
                         mfe_atr_median=g[mfe].median(),
                         stop_atr_median=g[st].median(),
                         R_median=g[R].median(),
                         share_R_ge_1=100 * (g[R] >= 1).mean()))
    A(md(save(pd.DataFrame(rows), "v1_variant_comparison.csv")))
    A(f"\n_**The tie is not rare and is not contradictory.** For a high sweep "
      f"the bullish candidate usually forms ABOVE the take-out bar's high, so "
      f"its lower edge sits above the invalidation reference and EVERY close "
      f"in between satisfies both tests at once — the gap inverts while price "
      f"is still above the sweep wick. It fires on "
      f"**{int(p.n_ties.sum()):,} bars** across "
      f"**{int((p.n_ties > 0).sum()):,} of the {len(p):,}** primary take-outs "
      f"({100*(p.n_ties>0).mean():.1f}%). DESIGN.md §1 pin 3 assumed it was "
      f"'near-impossible'; that assumption was wrong and was corrected "
      f"mid-pass (Architect ruling: keep A as primary, ship B and C as "
      f"labelled sensitivities)._\n")

    A("### V2. Above-extreme gaps — the geometry that creates the tie\n")
    rows = []
    for tag, cf, ga in (("A (primary)", "ifvg_confirmed", "gap_above_extreme"),
                        ("B", "B_confirmed", "B_gap_above_extreme"),
                        ("C", "C_confirmed", "C_gap_above_extreme")):
        g = p[p[cf]]
        rows.append(dict(variant=tag, n_confirmed=len(g),
                         confirm_rate_pct=100 * p[cf].mean(),
                         share_confirmed_via_above_extreme_gap_pct=100 * g[ga].mean(),
                         n_above_extreme=int(g[ga].sum())))
    v2t = pd.DataFrame(rows)
    A(md(save(v2t, "v2_above_extreme.csv")))
    A("\n_Under A, a confirmation whose gap lay entirely beyond the take-out "
      "extreme is only possible when price closed back below that extreme "
      "BEFORE inverting the gap — so the share is small by construction. Under "
      "B and C those confirmations are exactly what is added back._\n")

    # ==================================================================== S
    A("## S. State-machine diagnostics (primary sample, variant A)\n")
    A("### S1. Candidates seen / replacements / invalidations per take-out\n")
    rows = []
    for col, lbl in (("n_candidates", "qualifying gaps seen (candidates)"),
                     ("n_replacements", "replacements (a newer gap displaced a live one)"),
                     ("n_invalidations", "invalidations (close beyond the take-out extreme)"),
                     ("n_ties", "tie bars (invalidation AND inversion on one close)"),
                     ("orphan_breaches", "orphan breaches (beyond the extreme, nothing active)")):
        g = p[col]
        rows.append(dict(quantity=lbl, mean=g.mean(), p50=g.median(),
                         p90=g.quantile(.9), max=g.max(),
                         share_zero_pct=100 * (g == 0).mean()))
    A(md(save(pd.DataFrame(rows), "s1_state_machine_counts.csv")))
    A("")

    A("### S1b. Candidate-count histogram and the confirmation rate inside each bin\n")
    rows = []
    bins = [(0, 0), (1, 1), (2, 2), (3, 4), (5, 8), (9, 10 ** 9)]
    for a_, b_ in bins:
        g = p[(p.n_candidates >= a_) & (p.n_candidates <= b_)]
        if not len(g):
            continue
        lbl = f"{a_}" if a_ == b_ else (f"{a_}+" if b_ > 10 ** 8 else f"{a_}-{b_}")
        rows.append(dict(n_candidates=lbl, n=len(g), share_pct=100 * len(g) / len(p),
                         confirm_rate_pct=100 * g.ifvg_confirmed.mean(),
                         invalidations_median=g.n_invalidations.median(),
                         R_median=g.ifvg_R.median()))
    A(md(save(pd.DataFrame(rows), "s1b_candidate_histogram.csv")))
    A("")

    A("### S2. Unconfirmed take-outs, split by cause (primary sample)\n")
    rows = []
    order = ["confirmed", "invalidated_out", "no_candidate", "live_at_block_end"]
    for c_ in order:
        g = p[p.unconf_cause == c_]
        rows.append(dict(cause=c_, n=len(g), share_pct=100 * len(g) / len(p),
                         bars_remaining_median=g.bars_remaining.median(),
                         candidates_median=g.n_candidates.median(),
                         rev_atr_median=g.rev_atr.median(),
                         adv_atr_median=g.adv_atr.median(),
                         would_confirm_extended_pct=100 * g.ifvg_would_confirm_extended.mean()))
    A(md(save(pd.DataFrame(rows), "s2_unconfirmed_cause.csv")))
    A("\n_`invalidated_out` = at least one candidate existed and every one of "
      "them was invalidated (or replaced-then-invalidated) before the block "
      "ended. `no_candidate` = no gap satisfying the V5 location filter ever "
      "formed inside the window. `live_at_block_end` = a candidate was still "
      "alive, un-inverted, when the clock ran out. `rev_atr` is the "
      "wick-anchored reversal these take-outs still made — the column that "
      "says how much the rule leaves on the table._\n")

    A("### S3. Unconfirmed-by-cause x sweep_block\n")
    s3 = (p.pivot_table(index="unconf_cause", columns="sweep_block", values="bar",
                        aggfunc="size").reindex(index=order, columns=BLOCK_ORD).fillna(0))
    s3 = 100 * s3 / s3.sum(axis=0)
    A(md(save(s3.reset_index(), "s3_cause_by_block.csv")))
    A("\n_Column percentages: within each block, how its take-outs split across "
      "the four outcomes._\n")

    # ==================================================================== T
    A("## T. Re-derived core tables (variant A, primary sample)\n")
    A("### T2. iFVG confirmation rate — level_session x sweep_block\n")
    t2 = (p.pivot_table(index="level_session", columns="sweep_block",
                        values="ifvg_confirmed", aggfunc="mean")
           .reindex(index=SESS_ORD, columns=BLOCK_ORD) * 100)
    t2["ALL blocks"] = p.groupby("level_session").ifvg_confirmed.mean().reindex(SESS_ORD) * 100
    t2.loc["ALL levels"] = [100 * p.loc[p.sweep_block == b, "ifvg_confirmed"].mean()
                            for b in BLOCK_ORD] + [100 * p.ifvg_confirmed.mean()]
    A(md(save(t2.reset_index(), "t2_ifvg_rate_levelsession_x_block.csv")))
    A("\n_v2's counterpart table is `../session-liquidity-v2/results/"
      "t2_ifvg_rate_levelsession_x_block.csv` — same cells, ~3x higher._\n")

    A("### T2b. Confirmation rate — level_session x direction x asset\n")
    rows = []
    for (s_, dr), g in p.groupby(["level_session", "direction"]):
        r = dict(level_session=s_, direction=dr, n=len(g),
                 ifvg_rate_ALL=100 * g.ifvg_confirmed.mean(),
                 v2_rate_ALL=100 * g.v2_ifvg_confirmed.mean())
        for sym in C.SYMBOLS:
            gs = g[g.symbol == sym]
            r[sym] = 100 * gs.ifvg_confirmed.mean() if len(gs) else np.nan
        rows.append(r)
    t2b = pd.DataFrame(rows).set_index(["level_session", "direction"]).reindex(SESS_ORD, level=0)
    A(md(save(t2b.reset_index(), "t2b_ifvg_rate_by_asset.csv")))
    A("")

    A("### T2c. The full core cut — level_session x sweep_block x direction x asset\n")
    rows = []
    for (s_, b_, dr, sym), g in p.groupby(["level_session", "sweep_block",
                                           "direction", "symbol"]):
        if len(g) < 15:
            continue
        gc = g[g.ifvg_confirmed]
        rows.append(dict(level_session=s_, sweep_block=b_, direction=dr, symbol=sym,
                         n=len(g), confirm_rate_pct=100 * g.ifvg_confirmed.mean(),
                         delay_median=gc.ifvg_delay_bars.median(),
                         mfe_atr_median=gc.ifvg_mfe_atr.median(),
                         mae_atr_median=gc.ifvg_mae_atr.median(),
                         stop_atr_median=gc.ifvg_stop_atr.median(),
                         R_median=gc.ifvg_R.median(),
                         share_R_ge_1=100 * (gc.ifvg_R >= 1).mean()))
    t2c = pd.DataFrame(rows)
    save(t2c, "t2c_core_full_cut.csv")
    A(f"Full table in `results/t2c_core_full_cut.csv` — {len(t2c)} cells with "
      f"n >= 15 (of {p.groupby(['level_session','sweep_block','direction','symbol']).ngroups} "
      f"possible). Confirmation rate across cells: "
      f"min {t2c.confirm_rate_pct.min():.0f}%, median "
      f"{t2c.confirm_rate_pct.median():.0f}%, max {t2c.confirm_rate_pct.max():.0f}%; "
      f"median R proxy across cells "
      f"{t2c.R_median.min():.2f} / {t2c.R_median.median():.2f} / "
      f"{t2c.R_median.max():.2f}.\n")

    A("### T3. Take-out -> confirmation delay, and the block-truncation share\n")
    rows = []
    for b in BLOCK_ORD + ["ALL"]:
        g = p if b == "ALL" else p[p.sweep_block == b]
        dly = g.loc[g.ifvg_confirmed, "ifvg_delay_bars"]
        fdl = g.loc[g.ifvg_confirmed, "ifvg_form_delay_bars"]
        unc = g[~g.ifvg_confirmed]
        rows.append(dict(sweep_block=b, n=len(g),
                         confirmed_pct=100 * g.ifvg_confirmed.mean(),
                         form_delay_median=fdl.median(),
                         delay_median_bars=dly.median(), delay_p25=dly.quantile(.25),
                         delay_p75=dly.quantile(.75), delay_p90=dly.quantile(.9),
                         delay_median_min=dly.median() * C.BAR_MIN,
                         unconfirmed_n=len(unc),
                         truncated_share_pct=100 * unc.ifvg_would_confirm_extended.mean()
                         if len(unc) else np.nan))
    A(md(save(pd.DataFrame(rows), "t3_delay_and_truncation.csv")))
    A(f"\n_`form_delay_median` = bars from the take-out to the 3rd bar of the "
      f"gap that ended up confirming (new in v3 — under the state machine the "
      f"winning gap has an identity, not just an inversion time). "
      f"`truncated_share_pct` = of the UNCONFIRMED take-outs, the share that "
      f"would have confirmed had the block run "
      f"{C.TRUNCATION_PROBE_BARS * C.BAR_MIN / 60:.0f}h longer — a diagnostic "
      f"probe, not part of any definition._\n")

    A("### T6. Magnitude from the iFVG CONFIRMATION CLOSE — the tradable view\n")
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
      "close, in ATR units — what a trader entering on the signal actually has "
      "in front of them. `share_end_positive` = % still on the favourable side "
      "of the entry when the block closes._\n")

    A("### T7. Stop proxy and R proxy at the confirmation bar\n")
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
      "running extreme (take-out bar .. confirmation bar). `R` = block-scoped "
      "MFE / that stop. **Descriptive only** — no costs, no exit rule, and MFE "
      "is a best-case exit nobody hits systematically._\n")

    A("### T9. Lift over each block's OWN unconditional baseline\n")
    rows = []
    for b in BLOCK_ORD:
        ub = up[up.sweep_block == b]
        for dr, ucol in (("high_sweep", "down_atr"), ("low_sweep", "up_atr")):
            g = p[(p.sweep_block == b) & (p.direction == dr)]
            base = ub[ucol].median()
            gc = g[g.ifvg_confirmed]
            g2 = g[g.v2_ifvg_confirmed]
            rows.append(dict(sweep_block=b, direction=dr, n_takeouts=len(g),
                             takeout_rev_atr_median=g.rev_atr.median(),
                             uncond_atr_median=base,
                             lift_takeout=g.rev_atr.median() / base,
                             n_confirmed_v3=len(gc),
                             lift_confirmed_v3=gc.rev_atr.median() / base,
                             n_confirmed_v2=len(g2),
                             lift_confirmed_v2=g2.rev_atr.median() / base))
    A(md(save(pd.DataFrame(rows), "t9_lift_vs_unconditional.csv"), "{:.3f}"))
    A("\n_`lift` = conditional median / same-block unconditional median, both "
      "measured from the WICK extreme (so both are hindsight-flattered the same "
      "way — the comparison survives, the level does not). The v2 column is "
      "printed beside the v3 one because this is the table where the selection "
      "bias should show up as a difference in what the confirmed subset "
      "contains._\n")

    A("### T9b. Window-matched lift — inside bars_remaining buckets\n")
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
    A("")

    A("### W2. Confirmation rate by remaining-window bucket\n")
    rows = []
    for lbl in REM_LBL:
        g = e[e.rem_bucket == lbl]
        if not len(g):
            continue
        rows.append(dict(bars_remaining=lbl, n=len(g), share_pct=100 * len(g) / len(e),
                         ifvg_rate_v3=100 * g.ifvg_confirmed.mean(),
                         ifvg_rate_v2=100 * g.v2_ifvg_confirmed.mean(),
                         delay_median=g.ifvg_delay_bars.median(),
                         candidates_median=g.n_candidates.median(),
                         invalidations_median=g.n_invalidations.median()))
    A(md(save(pd.DataFrame(rows), "w2_by_window_bucket.csv")))
    A("\n_How much of the confirmation rate is just window length — and it is "
      "still a lot under v3. W1 (the window-length distribution itself) is "
      "upstream of confirmation and unchanged: see v2's `w1_window_length.csv`._\n")

    A("### T11. Sensitivity — relaxed (V5 default) vs strict iFVG location, under v3\n")
    t11 = pd.DataFrame([
        dict(variant="relaxed — gap merely reaches beyond the level (V5, used everywhere)",
             rate_pct=100 * p.ifvg_confirmed.mean(),
             n=int(p.ifvg_confirmed.sum()),
             delay_median=p.loc[p.ifvg_confirmed, "ifvg_delay_bars"].median(),
             rev_atr_median=p.loc[p.ifvg_confirmed, "rev_atr"].median()),
        dict(variant="strict — whole gap beyond the level (phase-1 D5, sensitivity)",
             rate_pct=100 * p.ifvg_strict_confirmed.mean(),
             n=int(p.ifvg_strict_confirmed.sum()),
             delay_median=p.loc[p.ifvg_strict_confirmed, "ifvg_strict_delay_bars"].median(),
             rev_atr_median=p.loc[p.ifvg_strict_confirmed, "rev_atr"].median())])
    A(md(save(t11, "t11_ifvg_location_sensitivity.csv")))
    A("")

    A("### T12. Monthly stability\n")
    m = p.groupby("month").agg(take_outs=("bar", "size"),
                               ifvg_rate=("ifvg_confirmed", "mean"),
                               v2_rate=("v2_ifvg_confirmed", "mean"),
                               rev_atr_median=("rev_atr", "median"),
                               conf_mfe_atr_median=("ifvg_mfe_atr", "median"),
                               conf_R_median=("ifvg_R", "median"))
    m["ifvg_rate"] *= 100; m["v2_rate"] *= 100
    save(m.reset_index(), "t12_monthly.csv")
    A(f"Full table in `results/t12_monthly.csv` ({len(m)} months). Monthly v3 "
      f"confirmation rate ranges **{m.ifvg_rate.min():.0f}–{m.ifvg_rate.max():.0f}%** "
      f"(median {m.ifvg_rate.median():.0f}%; v2's ranged "
      f"{m.v2_rate.min():.0f}–{m.v2_rate.max():.0f}%). Monthly median R proxy "
      f"**{m.conf_R_median.min():.2f}–{m.conf_R_median.max():.2f}** "
      f"(median {m.conf_R_median.median():.2f}). Worst / best month by rate: "
      f"{m.ifvg_rate.idxmin()} / {m.ifvg_rate.idxmax()}. See chart 07.\n")

    # ==================================================================== H
    A("## H. Hour of day (§5.1 required deliverable)\n")
    A("### H1. Gap frequency by UTC clock hour — every bar, no sweep required\n")
    fh = pd.read_csv(os.path.join(C.RESULTS, "fvg_hourly.csv"))
    h1 = fh.groupby("hour").agg(bars=("bars", "sum"), bull=("bull", "sum"),
                                bear=("bear", "sum")).reset_index()
    h1["fvg_per_100_bars"] = 100 * (h1.bull + h1.bear) / h1.bars
    h1["block"] = pd.cut(h1.hour, [0, 8, 13, 21, 24], right=False,
                         labels=["Asia", "London", "NY", "Late"])
    A(md(save(h1, "h1_fvg_frequency_by_hour.csv")))
    A("\n_Raw 3-candle FVG formation rate per clock hour, pooled over the 4 "
      "assets. This is the 'gap frequency by hour' half of the chart — it says "
      "nothing about sweeps, only about when the tape produces gaps at all._\n")

    A("### H2. Confirmed-reversal rate by hour, window-length-stratified\n")
    rows = []
    for hh in range(24):
        g = e[(e.hour == hh) & (e.bars_remaining >= MINB)]
        r = dict(hour=hh, n=len(g),
                 candidates_per_event=g.n_candidates.mean(),
                 rate_ALL=100 * g.ifvg_confirmed.mean() if len(g) else np.nan,
                 v2_rate_ALL=100 * g.v2_ifvg_confirmed.mean() if len(g) else np.nan)
        for lbl in HOUR_LBL:
            gs = g[g.hour_bucket == lbl]
            r[f"rate_{lbl}"] = 100 * gs.ifvg_confirmed.mean() if len(gs) >= 20 else np.nan
            r[f"n_{lbl}"] = len(gs)
        rows.append(r)
    A(md(save(pd.DataFrame(rows), "h2_rate_by_hour_stratified.csv")))
    A("\n_Take-out hour (UTC) on the rows; the `rate_*` columns are the v3 "
      "confirmation rate WITHIN a bars-remaining stratum (DESIGN.md §2 bins: "
      "12–24 / 24–48 / 48–72 / 72+), blank where the stratum has < 20 events. "
      "The stratification is the point: §6.1 warns that an unstratified hourly "
      "cut just rediscovers the clock, because a take-out's hour and its "
      "remaining window length are the same fact seen twice._\n")

    # ==================================================================== A
    A("## A. Appendix\n")
    A("### A1. Primary vs short-window sample\n")
    q = e[~e.primary]
    rows = [dict(sample="primary (>= 12 bars left)", n=len(p),
                 share_pct=100 * len(p) / len(e),
                 rem_median=p.bars_remaining.median(),
                 ifvg_rate_v3=100 * p.ifvg_confirmed.mean(),
                 ifvg_rate_v2=100 * p.v2_ifvg_confirmed.mean(),
                 rev_atr_median=p.rev_atr.median(),
                 conf_R_median=p.ifvg_R.median()),
            dict(sample="short window (< 12 bars left)", n=len(q),
                 share_pct=100 * len(q) / len(e),
                 rem_median=q.bars_remaining.median(),
                 ifvg_rate_v3=100 * q.ifvg_confirmed.mean(),
                 ifvg_rate_v2=100 * q.v2_ifvg_confirmed.mean(),
                 rev_atr_median=q.rev_atr.median(),
                 conf_R_median=q.ifvg_R.median()),
            dict(sample="FULL sample (both)", n=len(e), share_pct=100.0,
                 rem_median=e.bars_remaining.median(),
                 ifvg_rate_v3=100 * e.ifvg_confirmed.mean(),
                 ifvg_rate_v2=100 * e.v2_ifvg_confirmed.mean(),
                 rev_atr_median=e.rev_atr.median(),
                 conf_R_median=e.ifvg_R.median())]
    A(md(save(pd.DataFrame(rows), "a1_primary_vs_short_window.csv")))
    A("")

    A("### A2. Full-sample confirmation rate (no window filter)\n")
    a2 = (e.pivot_table(index="level_session", columns="sweep_block",
                        values="ifvg_confirmed", aggfunc="mean")
           .reindex(index=SESS_ORD, columns=BLOCK_ORD) * 100)
    a2["ALL blocks"] = e.groupby("level_session").ifvg_confirmed.mean().reindex(SESS_ORD) * 100
    A(md(save(a2.reset_index(), "a2_ifvg_rate_full_sample.csv")))
    A("")

    txt = "\n".join(out)
    with open(os.path.join(C.RESULTS, "TABLES.md"), "w") as fh:
        fh.write(txt)
    print(txt)


if __name__ == "__main__":
    main()
