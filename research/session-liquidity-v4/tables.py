#!/usr/bin/env python3
"""Aggregation tables — session-liquidity **v4** (iFVG, no invalidation).

Reads results/events_*.csv + results/uncond_*.csv.gz (engine.py output) and
writes CSVs plus a markdown block (results/TABLES.md) that REPORT.md embeds.

DELTA-STYLE PASS, second in a row. Only the **confirmation-dependent** tables
are re-derived here; the upstream ones the confirmation layer cannot touch
(take-out frequency T1/T1b, wick-anchored magnitude T4/T5, the unconditional
yardstick T8, the `n_levels_taken` split T10, the window-length distribution
W1) are unchanged and stay in `../session-liquidity-v2/results/`. `checks.py`
proves the take-out stream is byte-identical to v2's, which is what licenses
that.

Everything is descriptive (§8): counts, rates, quantiles. No hypothesis test,
no gate.

Table families:
  D*  the three-way delta v2 / v3-A / v4 — including the same-gap agreement
      analysis and what the deleted invalidation rule was costing
  S*  state-machine diagnostics (candidates, replacements, TWO unconfirmed
      causes — `invalidated_out` no longer exists)
  T*  the re-derived core tables (rate, delay, from-confirmation geometry, R)
  H*  hour-of-day, window-length-stratified (§5.1 required deliverable)
  A*  appendix (short-window sample, full-sample versions)

Usage: .venv/bin/python research/session-liquidity-v4/tables.py
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

# v2's bars_remaining buckets — kept identical so the lift tables stay
# comparable with v2's T9b and v3's.
REM_BINS = [0, 12, 24, 48, 96, 10 ** 9]
REM_LBL = ["<12 (appendix only)", "12-23", "24-47", "48-95", "96+"]

# The hour-of-day stratification (carried from v3's DESIGN §2 bins).
HOUR_BINS = [12, 24, 48, 72, 10 ** 9]
HOUR_LBL = ["12-24", "24-48", "48-72", "72+"]

# Outcome causes under v4. `invalidated_out` is GONE — there is no rule left
# that can discard a candidate other than a fresher gap replacing it.
CAUSE_ORD = ["confirmed", "no_candidate", "live_at_block_end"]

# How many local highs (lows) price printed beyond the take-out bar's own
# extreme before it reversed — the shape the deleted v3 rule punished.
EXT_BINS = [0, 1, 2, 3, 5, 10 ** 9]
EXT_LBL = ["0", "1", "2", "3-4", "5+"]


def load_events() -> pd.DataFrame:
    fr = [pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"),
                      parse_dates=["ts"]) for s in C.SYMBOLS]
    e = pd.concat(fr, ignore_index=True)
    e["rem_bucket"] = pd.cut(e.bars_remaining, REM_BINS, right=False, labels=REM_LBL)
    e["hour_bucket"] = pd.cut(e.bars_remaining, HOUR_BINS, right=False, labels=HOUR_LBL)
    e["ext_bucket"] = pd.cut(e.n_local_extremes_beyond, EXT_BINS, right=False,
                             labels=EXT_LBL)
    e["primary"] = e.bars_remaining >= MINB
    return e


def load_uncond() -> pd.DataFrame:
    fr = [pd.read_csv(os.path.join(C.RESULTS, f"uncond_{s}.csv.gz"))
          for s in C.SYMBOLS]
    u = pd.concat(fr, ignore_index=True)
    u["rem_bucket"] = pd.cut(u.bars_remaining, REM_BINS, right=False, labels=REM_LBL)
    return u


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


# The three algorithms, in one place, so no table can quietly use a different
# column set for one of them than for another.
ALGOS = [
    ("v2 — retroactive best-pick (the original bug)",
     dict(conf="v2_ifvg_confirmed", delay="v2_ifvg_delay_bars",
          gap="v2_ifvg_gap_atr", mfe="v2_ifvg_mfe_atr", mae="v2_ifvg_mae_atr",
          stop="v2_ifvg_stop_atr", R="v2_ifvg_R", end="v2_ifvg_end_atr")),
    ("v3-A — sequential + the fabricated invalidation rule",
     dict(conf="v3a_confirmed", delay="v3a_delay_bars", gap="v3a_gap_atr",
          mfe="v3a_mfe_atr", mae="v3a_mae_atr", stop="v3a_stop_atr",
          R="v3a_R", end="v3a_end_atr")),
    ("v4 — sequential, NO invalidation (§5.1, current spec)",
     dict(conf="ifvg_confirmed", delay="ifvg_delay_bars", gap="ifvg_gap_atr",
          mfe="ifvg_mfe_atr", mae="ifvg_mae_atr", stop="ifvg_stop_atr",
          R="ifvg_R", end="ifvg_end_atr")),
]


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
      f"and v3's event stream (checks.py) — of which **{len(p):,} "
      f"({100*len(p)/len(e):.1f}%)** are primary (>= {MINB} bars = 1h left in "
      f"the sweep block). Only the iFVG confirmation layer differs from v2/v3. "
      f"iFVG only; no BoS, no PDH/PDL._\n")

    # ==================================================================== D
    A("## D. The three-way delta — v2 / v3-A / v4 on the same take-outs\n")
    A("### D1. Headline metrics, all three algorithms, same event rows (primary sample)\n")
    rows = []
    for tag, col in ALGOS:
        g = p[p[col["conf"]]]
        rows.append(dict(algorithm=tag, n_confirmed=len(g),
                         confirm_rate_pct=100 * p[col["conf"]].mean(),
                         delay_median_bars=g[col["delay"]].median(),
                         gap_size_atr_median=g[col["gap"]].median(),
                         mfe_atr_median=g[col["mfe"]].median(),
                         mae_atr_median=g[col["mae"]].median(),
                         stop_atr_median=g[col["stop"]].median(),
                         R_median=g[col["R"]].median(),
                         share_R_ge_1=100 * (g[col["R"]] >= 1).mean(),
                         share_R_ge_2=100 * (g[col["R"]] >= 2).mean()))
    d1 = pd.DataFrame(rows)
    for lbl, i_, j_ in (("delta (v4 - v2)", 2, 0), ("delta (v4 - v3-A)", 2, 1)):
        d = {"algorithm": lbl}
        for c in d1.columns[1:]:
            d[c] = d1[c].iloc[i_] - d1[c].iloc[j_]
        d1 = pd.concat([d1, pd.DataFrame([d])], ignore_index=True)
    A(md(save(d1, "d1_three_way_headline.csv")))
    A("\n_Same take-outs, same horizon, same geometry formulas — the ONLY "
      "difference is which gap (if any) each algorithm selects. Each row is "
      "computed on that algorithm's own confirmed subset, so `n_confirmed` "
      "differs by construction; that difference IS the finding._\n")

    A("### D2. Selected-gap-size distribution — the small-gap-bias prediction, retested\n")
    rows = []
    for tag, col in ALGOS:
        g = p.loc[p[col["conf"]], col["gap"]]
        rows.append(dict(algorithm=tag, n=int(g.notna().sum()),
                         **{k.replace("gap_", ""): v
                            for k, v in qtiles(g, "gap").items() if k != "gap_n"}))
    both = p[p.ifvg_confirmed & p.v2_ifvg_confirmed]
    rows.append(dict(algorithm="v2, restricted to take-outs v4 ALSO confirms",
                     n=int(both.v2_ifvg_gap_atr.notna().sum()),
                     **{k.replace("gap_", ""): v for k, v in
                        qtiles(both.v2_ifvg_gap_atr, "gap").items() if k != "gap_n"}))
    rows.append(dict(algorithm="v4, restricted to take-outs v2 ALSO confirms",
                     n=int(both.ifvg_gap_atr.notna().sum()),
                     **{k.replace("gap_", ""): v for k, v in
                        qtiles(both.ifvg_gap_atr, "gap").items() if k != "gap_n"}))
    diff = both[~both.same_gap_selected]
    for tag, c_ in (("v2, ONLY where the two pick different gaps", "v2_ifvg_gap_atr"),
                    ("v4, ONLY where the two pick different gaps", "ifvg_gap_atr")):
        rows.append(dict(algorithm=tag, n=int(diff[c_].notna().sum()),
                         **{k.replace("gap_", ""): v for k, v in
                            qtiles(diff[c_], "gap").items() if k != "gap_n"}))
    A(md(save(pd.DataFrame(rows), "d2_selected_gap_size.csv"), "{:.3f}"))
    A(f"\n_Gap height of the SELECTED gap, in ATR(14, 5m) at the take-out bar. "
      f"Rows 4-5 hold the event set fixed so the comparison is not confounded "
      f"by the algorithms confirming different take-outs; rows 6-7 narrow "
      f"further to the {len(diff):,} take-outs where they pick a **different** "
      f"gap, which is the only place a size difference can come from at all._\n")

    A("### D3. Outcome agreement — who confirms what (primary sample)\n")
    rows = []
    for lbl, x, y in (("v2 vs v4", "v2_ifvg_confirmed", "ifvg_confirmed"),
                      ("v3-A vs v4", "v3a_confirmed", "ifvg_confirmed")):
        a_, b_ = p[x], p[y]
        rows += [dict(pair=lbl, case="both confirm", n=int((a_ & b_).sum())),
                 dict(pair=lbl, case="only the older algorithm confirms",
                      n=int((a_ & ~b_).sum())),
                 dict(pair=lbl, case="only v4 confirms", n=int((~a_ & b_).sum())),
                 dict(pair=lbl, case="neither confirms", n=int((~a_ & ~b_).sum()))]
    d3 = pd.DataFrame(rows)
    d3["share_pct"] = 100 * d3.n / len(p)
    A(md(save(d3, "d3_outcome_agreement.csv")))
    A("\n_v4's confirmed set is a subset of v2's **by construction** (v4 can only "
      "ever confirm through a gap v2 also saw and also inverted). Whether the "
      "reverse holds is an empirical question, and the row above answers it._\n")

    # ---- D4: THE same-gap agreement analysis (DESIGN §2 required) ----------
    A("### D4. SAME-GAP AGREEMENT — where v2 and v4 both confirm, do they pick the same gap?\n")
    rows = [dict(scope="all take-outs both confirm", n=len(both),
                 same_gap_pct=100 * both.same_gap_selected.mean(),
                 delay_median_v2=both.v2_ifvg_delay_bars.median(),
                 delay_median_v4=both.ifvg_delay_bars.median(),
                 gap_atr_median_v2=both.v2_ifvg_gap_atr.median(),
                 gap_atr_median_v4=both.ifvg_gap_atr.median(),
                 R_median_v2=both.v2_ifvg_R.median(),
                 R_median_v4=both.ifvg_R.median())]
    for lbl, g in (("...where the SAME gap is selected", both[both.same_gap_selected]),
                   ("...where a DIFFERENT gap is selected", diff)):
        rows.append(dict(scope=lbl, n=len(g),
                         same_gap_pct=100 * g.same_gap_selected.mean(),
                         delay_median_v2=g.v2_ifvg_delay_bars.median(),
                         delay_median_v4=g.ifvg_delay_bars.median(),
                         gap_atr_median_v2=g.v2_ifvg_gap_atr.median(),
                         gap_atr_median_v4=g.ifvg_gap_atr.median(),
                         R_median_v2=g.v2_ifvg_R.median(),
                         R_median_v4=g.ifvg_R.median()))
    A(md(save(pd.DataFrame(rows), "d4_same_gap_agreement.csv"), "{:.3f}"))
    A(f"\n_With invalidation gone, the ONLY residual difference between v2 and "
      f"v4 is **which** gap gets picked: v2 takes whichever qualifying gap "
      f"inverts EARLIEST anywhere in the window (a comparison no one watching "
      f"the tape can make); v4 takes whichever qualifying gap formed LAST "
      f"before the inverting close. They agree on "
      f"**{100*both.same_gap_selected.mean():.1f}%** of the {len(both):,} "
      f"take-outs both confirm._\n")

    A("#### D4b. Where they differ — the size of the disagreement\n")
    dd = diff.copy()
    dd["delay_delta"] = dd.ifvg_delay_bars - dd.v2_ifvg_delay_bars
    dd["form_delta"] = dd.ifvg_form_bar - dd.v2_ifvg_form_bar
    dd["gap_delta"] = dd.ifvg_gap_atr - dd.v2_ifvg_gap_atr
    dd["R_delta"] = dd.ifvg_R - dd.v2_ifvg_R
    dd["mfe_delta"] = dd.ifvg_mfe_atr - dd.v2_ifvg_mfe_atr
    rows = []
    for lbl, c_ in (("confirmation delay, v4 - v2 (bars)", "delay_delta"),
                    ("gap FORMATION bar, v4 - v2 (bars)", "form_delta"),
                    ("selected gap height, v4 - v2 (ATR)", "gap_delta"),
                    ("MFE from the confirmation close, v4 - v2 (ATR)", "mfe_delta"),
                    ("R proxy, v4 - v2", "R_delta")):
        g = dd[c_].dropna()
        rows.append(dict(quantity=lbl, n=len(g), p10=g.quantile(.10),
                         median=g.median(), mean=g.mean(), p90=g.quantile(.90),
                         share_positive_pct=100 * (g > 0).mean(),
                         share_zero_pct=100 * (g == 0).mean()))
    A(md(save(pd.DataFrame(rows), "d4b_disagreement_size.csv"), "{:.3f}"))
    A("\n_Positive = v4's number is larger. **The confirmation BAR is identical "
      "in every one of these cases** (delay delta 0 throughout), and so is all "
      "downstream geometry — MFE, R, stop. The two algorithms are inverting "
      "two DIFFERENT gaps on the SAME closing bar: v2 names the earliest-formed "
      "of them, v4 the latest-formed. That is why only the gap-height row moves. "
      "The mechanism is close to a theorem: if no bar before `u` closed below "
      "the older gap's lower edge, then every later bar's high — and hence "
      "every later bullish gap's lower edge — sits at or above it, so a close "
      "that inverts the old gap inverts the fresh one too. Mirror for lows._\n")

    A("#### D4c. Same-gap agreement by how busy the window was\n")
    rows = []
    bins = [(1, 1), (2, 2), (3, 4), (5, 8), (9, 10 ** 9)]
    for a_, b_ in bins:
        g = both[(both.n_candidates >= a_) & (both.n_candidates <= b_)]
        if not len(g):
            continue
        lbl = f"{a_}" if a_ == b_ else (f"{a_}+" if b_ > 10 ** 8 else f"{a_}-{b_}")
        gd = g[~g.same_gap_selected]
        rows.append(dict(n_candidates=lbl, n=len(g),
                         share_of_both_pct=100 * len(g) / len(both),
                         same_gap_pct=100 * g.same_gap_selected.mean(),
                         delay_delta_median=(gd.ifvg_delay_bars
                                             - gd.v2_ifvg_delay_bars).median(),
                         gap_delta_median=(gd.ifvg_gap_atr
                                           - gd.v2_ifvg_gap_atr).median()))
    A(md(save(pd.DataFrame(rows), "d4c_agreement_by_candidates.csv"), "{:.3f}"))
    A("\n_The two algorithms can only disagree when the window offered more "
      "than one qualifying gap, so agreement falls monotonically with how many "
      "candidates formed. `n_candidates` is v4's counter._\n")

    # ---- D5: what the deleted invalidation rule was costing ----------------
    A("### D5. What the deleted invalidation rule was costing\n")
    rows = []
    for lbl in EXT_LBL:
        g = p[p.ext_bucket == lbl]
        if not len(g):
            continue
        rows.append(dict(local_extremes_beyond_boundary=lbl, n=len(g),
                         share_pct=100 * len(g) / len(p),
                         v4_rate_pct=100 * g.ifvg_confirmed.mean(),
                         v3a_rate_pct=100 * g.v3a_confirmed.mean(),
                         v2_rate_pct=100 * g.v2_ifvg_confirmed.mean(),
                         closes_beyond_median=g.n_closes_beyond_extreme.median(),
                         rev_atr_median=g.rev_atr.median(),
                         v4_R_median=g.ifvg_R.median()))
    A(md(save(pd.DataFrame(rows), "d5_invalidation_cost.csv")))
    A("\n_Rows: how many local highs (for a high sweep; lows for a low sweep) "
      "price printed **beyond the take-out bar's own extreme** during the "
      "window — a 2-bar pivot count, diagnostic only, never a filter. This is "
      "exactly the shape the user's diagram shows and exactly what the deleted "
      "v3 rule punished: v3-A's rate collapses as soon as price makes a single "
      "further local high, while v4's does not move, because under v4 the "
      "boundary is the swept level and nothing else._\n")

    # ==================================================================== S
    A("## S. State-machine diagnostics (primary sample)\n")
    A("### S1. Candidates seen and replacements per take-out\n")
    rows = []
    for col, lbl in (("n_candidates", "qualifying gaps seen (candidates)"),
                     ("n_replacements", "replacements (a newer gap displaced a live one)"),
                     ("n_closes_beyond_extreme",
                      "closes beyond the take-out extreme (v3 would have killed the "
                      "candidate on the first of these; v4 ignores them)"),
                     ("n_local_extremes_beyond",
                      "local extremes printed beyond the take-out extreme")):
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
                         replacements_median=g.n_replacements.median(),
                         delay_median=g.ifvg_delay_bars.median(),
                         R_median=g.ifvg_R.median()))
    A(md(save(pd.DataFrame(rows), "s1b_candidate_histogram.csv")))
    A("\n_Unlike v3, where more candidates meant a LOWER rate (each new gap "
      "arrived alongside more chances to breach the invalidation line), under "
      "v4 more candidates simply means more chances to confirm._\n")

    A("### S2. Take-outs split by outcome cause — TWO unconfirmed causes now\n")
    rows = []
    for c_ in CAUSE_ORD:
        g = p[p.unconf_cause == c_]
        rows.append(dict(cause=c_, n=len(g), share_pct=100 * len(g) / len(p),
                         bars_remaining_median=g.bars_remaining.median(),
                         candidates_median=g.n_candidates.median(),
                         rev_atr_median=g.rev_atr.median(),
                         adv_atr_median=g.adv_atr.median(),
                         would_confirm_extended_pct=100 * g.ifvg_would_confirm_extended.mean()))
    A(md(save(pd.DataFrame(rows), "s2_unconfirmed_cause.csv")))
    A("\n_`no_candidate` = no gap satisfying the V5 location filter ever formed "
      "inside the window. `live_at_block_end` = a candidate was alive and "
      "un-inverted when the clock ran out. v3's third cause, "
      "`invalidated_out` — which accounted for **45%** of its primary sample — "
      "**cannot occur under v4**: there is no rule left that discards a "
      "candidate. `rev_atr` is the wick-anchored reversal these take-outs still "
      "made, i.e. what the rule leaves on the table._\n")

    A("### S3. Outcome cause x sweep_block (column percentages)\n")
    s3 = (p.pivot_table(index="unconf_cause", columns="sweep_block", values="bar",
                        aggfunc="size").reindex(index=CAUSE_ORD,
                                                columns=BLOCK_ORD).fillna(0))
    s3 = 100 * s3 / s3.sum(axis=0)
    A(md(save(s3.reset_index(), "s3_cause_by_block.csv")))
    A("\n_Within each block, how its take-outs split across the three outcomes._\n")

    # ==================================================================== T
    A("## T. Re-derived core tables (v4, primary sample)\n")
    A("### T2. iFVG confirmation rate — level_session x sweep_block\n")
    t2 = (p.pivot_table(index="level_session", columns="sweep_block",
                        values="ifvg_confirmed", aggfunc="mean")
           .reindex(index=SESS_ORD, columns=BLOCK_ORD) * 100)
    t2["ALL blocks"] = p.groupby("level_session").ifvg_confirmed.mean().reindex(SESS_ORD) * 100
    t2.loc["ALL levels"] = [100 * p.loc[p.sweep_block == b, "ifvg_confirmed"].mean()
                            for b in BLOCK_ORD] + [100 * p.ifvg_confirmed.mean()]
    A(md(save(t2.reset_index(), "t2_ifvg_rate_levelsession_x_block.csv")))
    A("\n_v3's counterpart is `../session-liquidity-v3/results/"
      "t2_ifvg_rate_levelsession_x_block.csv` — same cells, ~3x lower._\n")

    A("### T2b. Confirmation rate — level_session x direction x asset\n")
    rows = []
    for (s_, dr), g in p.groupby(["level_session", "direction"]):
        r = dict(level_session=s_, direction=dr, n=len(g),
                 ifvg_rate_ALL=100 * g.ifvg_confirmed.mean(),
                 v3a_rate_ALL=100 * g.v3a_confirmed.mean(),
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
      f"gap that ended up confirming. `truncated_share_pct` = of the "
      f"UNCONFIRMED take-outs, the share that would have confirmed had the "
      f"block run {C.TRUNCATION_PROBE_BARS * C.BAR_MIN / 60:.0f}h longer — a "
      f"diagnostic probe, not part of any definition._\n")

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
            rows.append(dict(sweep_block=b, direction=dr, n_takeouts=len(g),
                             takeout_rev_atr_median=g.rev_atr.median(),
                             uncond_atr_median=base,
                             lift_takeout=g.rev_atr.median() / base,
                             n_confirmed_v4=int(g.ifvg_confirmed.sum()),
                             lift_confirmed_v4=g[g.ifvg_confirmed].rev_atr.median() / base,
                             n_confirmed_v3a=int(g.v3a_confirmed.sum()),
                             lift_confirmed_v3a=g[g.v3a_confirmed].rev_atr.median() / base,
                             n_confirmed_v2=int(g.v2_ifvg_confirmed.sum()),
                             lift_confirmed_v2=g[g.v2_ifvg_confirmed].rev_atr.median() / base))
    A(md(save(pd.DataFrame(rows), "t9_lift_vs_unconditional.csv"), "{:.3f}"))
    A("\n_`lift` = conditional median / same-block unconditional median, both "
      "measured from the WICK extreme (so both are hindsight-flattered the same "
      "way — the comparison survives, the level does not)._\n")

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
                         ifvg_rate_v4=100 * g.ifvg_confirmed.mean(),
                         ifvg_rate_v3a=100 * g.v3a_confirmed.mean(),
                         ifvg_rate_v2=100 * g.v2_ifvg_confirmed.mean(),
                         delay_median=g.ifvg_delay_bars.median(),
                         candidates_median=g.n_candidates.median()))
    A(md(save(pd.DataFrame(rows), "w2_by_window_bucket.csv")))
    A("\n_How much of the confirmation rate is just window length. W1 (the "
      "window-length distribution itself) is upstream of confirmation and "
      "unchanged: see v2's `w1_window_length.csv`._\n")

    A("### T11. Sensitivity — relaxed (V5 default) vs strict iFVG location, under v4\n")
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
    A(f"\n_Strict-but-not-relaxed confirmations: "
      f"**{int((p.ifvg_strict_confirmed & ~p.ifvg_confirmed).sum()):,}** of "
      f"{int(p.ifvg_strict_confirmed.sum()):,}. A sequential machine does not "
      f"guarantee that strict is a subset of relaxed — the stricter filter "
      f"admits fewer candidates, so a gap the relaxed run would have REPLACED "
      f"never exists and an earlier strict-qualifying gap could in principle "
      f"survive to confirm where the relaxed run got churned out. It is "
      f"counted rather than assumed; under v4 it is empirically zero (it was "
      f"non-zero under v3, where invalidation supplied the second way for the "
      f"relaxed run to lose a candidate)._\n")

    A("### T12. Monthly stability\n")
    m = p.groupby("month").agg(take_outs=("bar", "size"),
                               ifvg_rate=("ifvg_confirmed", "mean"),
                               v3a_rate=("v3a_confirmed", "mean"),
                               v2_rate=("v2_ifvg_confirmed", "mean"),
                               rev_atr_median=("rev_atr", "median"),
                               conf_mfe_atr_median=("ifvg_mfe_atr", "median"),
                               conf_R_median=("ifvg_R", "median"))
    m["ifvg_rate"] *= 100; m["v3a_rate"] *= 100; m["v2_rate"] *= 100
    save(m.reset_index(), "t12_monthly.csv")
    A(f"Full table in `results/t12_monthly.csv` ({len(m)} months). Monthly v4 "
      f"confirmation rate ranges **{m.ifvg_rate.min():.0f}-{m.ifvg_rate.max():.0f}%** "
      f"(median {m.ifvg_rate.median():.0f}%; v3-A's ranged "
      f"{m.v3a_rate.min():.0f}-{m.v3a_rate.max():.0f}%). Monthly median R proxy "
      f"**{m.conf_R_median.min():.2f}-{m.conf_R_median.max():.2f}** "
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
                 v3a_rate_ALL=100 * g.v3a_confirmed.mean() if len(g) else np.nan)
        for lbl in HOUR_LBL:
            gs = g[g.hour_bucket == lbl]
            r[f"rate_{lbl}"] = 100 * gs.ifvg_confirmed.mean() if len(gs) >= 20 else np.nan
            r[f"n_{lbl}"] = len(gs)
        rows.append(r)
    A(md(save(pd.DataFrame(rows), "h2_rate_by_hour_stratified.csv")))
    A("\n_Take-out hour (UTC) on the rows; the `rate_*` columns are the v4 "
      "confirmation rate WITHIN a bars-remaining stratum (bins 12-24 / 24-48 / "
      "48-72 / 72+), blank where the stratum has < 20 events. The "
      "stratification is the point: §6.1 warns that an unstratified hourly cut "
      "just rediscovers the clock, because a take-out's hour and its remaining "
      "window length are the same fact seen twice._\n")

    # ==================================================================== A
    A("## A. Appendix\n")
    A("### A1. Primary vs short-window sample\n")
    q = e[~e.primary]
    rows = []
    for lbl, g in (("primary (>= 12 bars left)", p),
                   ("short window (< 12 bars left)", q),
                   ("FULL sample (both)", e)):
        rows.append(dict(sample=lbl, n=len(g), share_pct=100 * len(g) / len(e),
                         rem_median=g.bars_remaining.median(),
                         ifvg_rate_v4=100 * g.ifvg_confirmed.mean(),
                         ifvg_rate_v3a=100 * g.v3a_confirmed.mean(),
                         ifvg_rate_v2=100 * g.v2_ifvg_confirmed.mean(),
                         rev_atr_median=g.rev_atr.median(),
                         conf_R_median=g.ifvg_R.median()))
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
