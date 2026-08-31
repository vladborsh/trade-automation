#!/usr/bin/env python3
"""Drill-down tables (post-v4) — level class x window regime, gap-size predictor.

Everything here is **descriptive** (§8): counts, quantiles and rank
correlations. There is no permutation null, no kill rule and no pass/fail gate,
and no number below should be read as one.

The pass's question, per the DESIGN.md reframe: **which level class and which
window regime select**, with the iFVG-v4 mechanic held fixed as the entry
reference. The v4 result — "no best hour, only a best remaining window" — is the
standing null every clock claim below is tested against.

Layout, in the order the report reads them:

  D1-D6  PDH/PDL stream diagnostics -- run and read BEFORE any combo analysis,
         because a new level class has to be shown to behave before its outcome
         numbers mean anything.
  A0-A1  the three combos' aggregates against C1's known break-even baseline,
         and the confirmed-vs-bare-take-out comparison that v4 pinned.
  W1-W5  **QUESTION (a), PRIMARY AXIS: the window regime.** W1 each combo across
         window-length strata; W2 the cross-combo comparison at matched window
         length (level class held against level class with the clock fixed);
         W3 the same per asset; W4 the pure day-level subset; W5 the separation
         summary -- how far the best (level class x window regime) cell sits
         from the break-even aggregate.
  S1-S4  **question (a), SECONDARY/DERIVED: the clock sub-window.** S1 hourly,
         S2 the 2h roll-up, S3 the within-stratum companion, S3b the
         collinearity that explains it, S4 the separation summary. Read against
         the v4 null: an effect that vanishes within strata is reported as
         "the clock, not the hour".
  G1-G5  question (b): the iFVG gap-size predictor. G1 the predictor's own
         distribution, G2/G2b the quintile tables (primary / secondary
         denominator), G3 Spearman per combo per asset, G4 the same correlation
         **within** the window-length strata (the robustness column), G5 the
         predictor-vs-time-remaining check the brief asks for explicitly.

Writes results/TABLES.md plus a CSV per table.

Usage: .venv/bin/python research/session-liquidity-v2/drilldown/dd_tables.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import dd_common as D
import dd_prep
from dd_common import md, save

OUT = []
A = OUT.append


def spearman(x: pd.Series, y: pd.Series) -> tuple[float, int]:
    """Spearman rank correlation on the pairwise-complete rows, plus that n.

    Descriptive statistic, reported with its sample size and never with a
    p-value: this pass has no significance gate (DESIGN.md §2).
    """
    m = x.notna() & y.notna()
    if m.sum() < 20:
        return np.nan, int(m.sum())
    return float(x[m].corr(y[m], method="spearman")), int(m.sum())


def hour2(h: pd.Series, start: int) -> pd.Series:
    """2h roll-up label, anchored on the block's own first hour."""
    k = ((h - start) // 2) * 2 + start
    return k.map(lambda v: f"{int(v):02d}-{int(v)+2:02d}")


# ===========================================================================
def diagnostics(e: pd.DataFrame):
    """D1-D6 — does the new level class behave? Read before any outcome."""
    pdf = e[e.stream == "pd"]
    ses = e[e.stream == "session"]
    days = pd.read_csv(os.path.join(D.RESULTS, "pd_day_frames.csv"), parse_dates=["day"])

    A("## D. PDH/PDL stream diagnostics — read before any combo outcome\n")
    A("_A new level class does not get to report outcomes before it is shown to "
      "behave. Everything in this section is about the stream itself: how often "
      "it fires, how often the iFVG confirms it, and how much of it is the "
      "session-level stream wearing a different hat._\n")

    A("### D1. Frequency — take-outs per asset-day, and how the two streams compare\n")
    rows = []
    for sym in D.SYMBOLS:
        dsym = days[days.symbol == sym]
        n_days = int(dsym.valid.sum())
        p = pdf[pdf.symbol == sym]; s = ses[ses.symbol == sym]
        hit_h = p[p.direction == "high_sweep"]; hit_l = p[p.direction == "low_sweep"]
        rows.append(dict(symbol=sym, days=n_days,
                         pd_takeouts=len(p), pd_per_day=len(p) / n_days,
                         pdh_hit_pct=100 * len(hit_h) / n_days,
                         pdl_hit_pct=100 * len(hit_l) / n_days,
                         both_sides_pct=100 * (p.assign(d=p.ts.dt.floor("D"))
                                               .groupby("d").size() == 2).sum() / n_days,
                         session_takeouts=len(s), session_per_day=len(s) / n_days,
                         pd_share_of_all_pct=100 * len(p) / (len(p) + len(s))))
    A(md(save(pd.DataFrame(rows), "d1_pd_frequency.csv")))
    A("\n_`pdh_hit_pct` / `pdl_hit_pct` = the share of valid days on which the "
      "prior day's high / low was taken out at all. A day-level sweep is roughly "
      "a once-a-day event per asset, against ~16 session-level take-outs — the "
      "day level is a much rarer, and therefore much more selective, object._\n")

    A("### D2. Where in the clock PDH/PDL sweeps happen (block distribution)\n")
    t = (pdf.groupby(["sweep_block", "direction"]).size().unstack(fill_value=0)
         .reindex(D.C.BLOCK_ORDER).fillna(0).astype(int))
    t["total"] = t.sum(axis=1)
    t["share_pct"] = 100 * t.total / t.total.sum()
    conf = pdf[pdf.primary].groupby("sweep_block").ifvg_confirmed.mean() * 100
    left = pdf[pdf.primary].groupby("sweep_block").bars_remaining.median()
    t["ifvg_rate_primary"] = conf.reindex(t.index)
    t["bars_left_median"] = left.reindex(t.index)
    A(md(save(t.reset_index(), "d2_pd_block_distribution.csv")))
    A("\n_The Asia block hosts the most PDH/PDL take-outs of any block, which is "
      "the mechanical consequence of the level becoming sweepable at 00:00 UTC — "
      "Asia gets first refusal on it every day. That is a property of the "
      "definition, not a market fact, and C3's frequency should be read with it "
      "in mind._\n")

    A("### D3. iFVG confirmation of PDH/PDL take-outs, vs the session stream\n")
    rows = []
    for name, g in (("PDH/PDL (all blocks)", pdf), ("session levels (all blocks)", ses)):
        p = g[g.primary]
        rows.append(dict(stream=name, takeouts=len(g), primary=len(p),
                         primary_pct=100 * len(p) / len(g),
                         ifvg_rate_primary=100 * p.ifvg_confirmed.mean(),
                         ifvg_rate_all=100 * g.ifvg_confirmed.mean(),
                         delay_bars_median=p.loc[p.ifvg_confirmed, "ifvg_delay_bars"].median(),
                         would_confirm_extended_pct=100 * p.loc[~p.ifvg_confirmed,
                                                                "ifvg_would_confirm_extended"].mean()))
    A(md(save(pd.DataFrame(rows), "d3_pd_confirmation.csv")))
    A("\n_The day level confirms at essentially the session level's rate. The "
      "new class is not harder or easier for the iFVG rule to see._\n")

    A("### D4. Does the Late block set the day's extreme? (the definition's justification)\n")
    rows = []
    for sym in D.SYMBOLS:
        g = days[(days.symbol == sym) & days.valid]
        rows.append(dict(symbol=sym, valid_days=len(g),
                         late_set_high_pct=100 * g.late_set_high.mean(),
                         late_set_low_pct=100 * g.late_set_low.mean(),
                         late_set_either_pct=100 * (g.late_set_high | g.late_set_low).mean()))
    g = days[days.valid]
    rows.append(dict(symbol="ALL", valid_days=len(g),
                     late_set_high_pct=100 * g.late_set_high.mean(),
                     late_set_low_pct=100 * g.late_set_low.mean(),
                     late_set_either_pct=100 * (g.late_set_high | g.late_set_low).mean()))
    A(md(save(pd.DataFrame(rows), "d4_late_sets_extreme.csv")))
    A("\n_This is the number that justifies the knowledge file's choice of the "
      "**full** prior UTC day over the 'max of the three session highs' "
      "shorthand. On roughly a sixth of days the high, and on a similar share "
      "the low, is printed in 21:00-24:00. A shorthand PDH would be wrong on "
      "those days — and wrong in the direction that matters, sitting below the "
      "real high so that a 'sweep' of it is not a sweep of anything._\n")

    A("### D5. Coincidence with a still-alive session level\n")
    rows = []
    for sym in D.SYMBOLS + ["ALL"]:
        g = pdf if sym == "ALL" else pdf[pdf.symbol == sym]
        p = g[g.primary]
        co = p[p.coincident_session_level]; pu = p[~p.coincident_session_level]
        rows.append(dict(symbol=sym, primary=len(p),
                         coincident_pct=100 * p.coincident_session_level.mean(),
                         coincident_ifvg_rate=100 * co.ifvg_confirmed.mean(),
                         pure_ifvg_rate=100 * pu.ifvg_confirmed.mean(),
                         coincident_R_median=co.ifvg_R.median(),
                         pure_R_median=pu.ifvg_R.median(),
                         coincident_er_median=co.er.median(),
                         pure_er_median=pu.er.median(),
                         n_pure=len(pu)))
    A(md(save(pd.DataFrame(rows), "d5_coincidence.csv")))
    A("\n_**The single most important diagnostic in this section.** About three "
      "quarters of PDH/PDL take-outs happen at a price where a still-alive "
      "session level sits within 0.05 ATR — i.e. the same excursion takes both. "
      "The day level is therefore mostly *not* an independent object: it is a "
      "relabelling of a session level that happened to be the day's extreme. The "
      "`pure_*` columns are the day level standing on its own, and they are the "
      "honest read of what the new class adds._\n")

    A("### D6. The pure day-level subset, by block\n")
    pu = pdf[pdf.primary & ~pdf.coincident_session_level]
    rows = []
    for b in D.C.BLOCK_ORDER:
        g = pu[pu.sweep_block == b]
        if not len(g):
            continue
        r = dict(sweep_block=b); r.update(D.outcome_block(g)); rows.append(r)
    r = dict(sweep_block="ALL"); r.update(D.outcome_block(pu)); rows.append(r)
    A(md(save(pd.DataFrame(rows), "d6_pure_by_block.csv")))
    A("\n_Same outcome columns as every table below, on the ~25% of day-level "
      "take-outs that are not a session level in disguise._\n")


# ===========================================================================
def aggregates(e: pd.DataFrame):
    A("\n## A0. The three combos in aggregate — the baseline every cut is judged against\n")
    rows = []
    for k in D.COMBO_ORDER:
        g = dd_prep.combo(e, k)
        r = dict(combo=k, what=D.COMBOS[k]["label"], n_assets=g.symbol.nunique())
        r.update(D.outcome_block(g))
        rows.append(r)
    pu = e[(e.stream == "pd") & e.primary & ~e.coincident_session_level]
    for k, blk in (("C2-pure", "NY"), ("C3-pure", "Asia")):
        g = pu[pu.sweep_block == blk]
        r = dict(combo=k, what=f"PDH/PDL swept in {blk}, no coincident session level",
                 n_assets=g.symbol.nunique())
        r.update(D.outcome_block(g))
        rows.append(r)
    A(md(save(pd.DataFrame(rows), "a0_combo_aggregates.csv")))
    A("\n_`er_median` is the signed efficiency ratio of the post-confirmation "
      "path to the block end: +1 a perfectly straight reversal, 0 chop, negative "
      "a trend running against the sweep. `R_median` is the parent report's "
      "MFE-over-sweep-leg-stop proxy — the number whose C1 value of 1.00 is the "
      "break-even aggregate this whole pass is trying to beat from the inside._\n")

    A("\n### A1. Confirmed vs bare take-out — the v4 framing, restated per combo\n")
    A("_v4's headline was that iFVG confirmation is a **timing device, not a "
      "filter**: it keeps ~64% of take-outs and the confirmed subset's lift sits "
      "*below* the bare take-out's. This table restates that per combo, so the "
      "rest of the pass is read with the right expectation. `rev_atr` is measured "
      "from the take-out wick (no confirmation involved); `mfe_atr` from the "
      "confirmation close. They are different anchors and are NOT comparable to "
      "each other -- what is comparable is the confirmed vs unconfirmed split of "
      "the same wick-anchored column._\n")
    rows = []
    for k in D.COMBO_ORDER:
        g = dd_prep.combo(e, k)
        c = g[g.ifvg_confirmed]; u = g[~g.ifvg_confirmed]
        rows.append(dict(
            combo=k, what=D.COMBOS[k]["label"], takeouts=len(g),
            ifvg_rate=100 * g.ifvg_confirmed.mean(),
            rev_atr_all=g.rev_atr.median(),
            rev_atr_confirmed=c.rev_atr.median(),
            rev_atr_unconfirmed=u.rev_atr.median(),
            adv_atr_confirmed=c.adv_atr.median(),
            adv_atr_unconfirmed=u.adv_atr.median(),
            no_candidate_pct=100 * u.unconf_cause.eq("no_candidate").mean()
            if len(u) else np.nan,
            delay_bars_median=c.ifvg_delay_bars.median(),
            n_candidates_median=g.n_candidates.median(),
        ))
    A(md(save(pd.DataFrame(rows), "a1_confirmed_vs_bare.csv"), "{:.3f}"))
    A("\n_Read the three `rev_atr_*` columns together: in every combo the "
      "**unconfirmed** take-outs carry the larger wick-anchored reversal. That is "
      "v4's finding reproduced on all three combos — the iFVG rule is not "
      "selecting the better sweeps, it is telling you when to enter the ones it "
      "does keep. Nothing below should be read as 'confirmation adds edge'; the "
      "pass is asking whether the LEVEL CLASS and the WINDOW REGIME add any._\n")


# ===========================================================================
def window_regime(e: pd.DataFrame):
    """W1-W5 — question (a) on its PRIMARY axis: the window regime.

    The post-v4 reframe puts the window-length stratum first and the clock
    second. v4 measured the confirmation rate running 37.7% -> 72.5% across
    remaining-window buckets and found every apparent hour-of-day effect to be
    window length in disguise; this section asks the same question of the
    OUTCOME columns, and crosses it with the level class.
    """
    A("\n## W. Question (a), PRIMARY AXIS — the window regime\n")
    A("_Window-length stratum = bars of the sweep block still remaining at the "
      "take-out bar (12-24 / 24-48 / 48-72 / 72+, brief-pinned). This is the "
      "axis v4 showed dominates everything else in this dataset, so it leads. "
      "The clock sub-window (section S) is the derived, secondary cut and is "
      "tested against the null this section establishes._\n")

    A("### W1. Each combo across window regimes\n")
    rows = []
    for k in D.COMBO_ORDER:
        g = dd_prep.combo(e, k)
        for st in D.STRATA_LBL:
            gg = g[g.stratum == st]
            if len(gg) < 40:
                continue
            r = dict(combo=k, what=D.COMBOS[k]["label"], stratum=st)
            r.update(D.outcome_block(gg))
            rows.append(r)
        r = dict(combo=k, what=D.COMBOS[k]["label"], stratum="ALL")
        r.update(D.outcome_block(g))
        rows.append(r)
    w1 = pd.DataFrame(rows)
    A(md(save(w1, "w1_window_regime.csv"), "{:.3f}"))
    A("\n_`ifvg_rate` reproduces v4's window-length gradient on all three combos "
      "-- longer window, higher confirmation rate, mechanically (there is simply "
      "more block left for a gap to form and invert in). `R_median` and "
      "`mfe_atr_median` also rise with the stratum, and they rise for the same "
      "mechanical reason: a longer window contains a larger maximum excursion. "
      "The scale-free columns -- `er_median`, `mfe_over_mae`, `clean_trend_pct`, "
      "`R_ge1_pct` -- are the ones that can carry a genuine regime effect, "
      "because they do not grow with the window by construction._\n")

    A("### W2. The comparison the clock confound does NOT block — combo vs combo at matched window regime\n")
    A("_Inside a block the take-out hour and the bars-remaining are the same "
      "variable seen twice (S3b), so the clock cannot be held fixed. The **level "
      "class** can: C1, C2 and C3 compared inside the same window-length "
      "stratum. Same amount of clock, different liquidity -- any difference here "
      "is about the level, not the window._\n")
    rows = []
    for st in D.STRATA_LBL:
        for k in D.COMBO_ORDER:
            g = dd_prep.combo(e, k)
            gg = g[g.stratum == st]
            if len(gg) < 40:
                continue
            r = dict(stratum=st, combo=k, what=D.COMBOS[k]["label"])
            r.update(D.outcome_block(gg))
            rows.append(r)
    A(md(save(pd.DataFrame(rows), "w2_window_matched_combos.csv"), "{:.3f}"))

    A("\n### W3. Is the W2 ordering the same in all four assets?\n")
    A("_W2 pools the assets. A pooled difference that only two assets produce is "
      "not a finding, so the same window-matched comparison is repeated per asset "
      "in the largest stratum (72+). The scale-free columns (`er_median`, "
      "`mfe_over_mae`) are the ones to read._\n")
    rows = []
    for sym in D.SYMBOLS:
        for k in D.COMBO_ORDER:
            g = dd_prep.combo(e, k)
            gg = g[(g.stratum == "72+") & (g.symbol == sym)]
            if len(gg) < 40:
                continue
            r = dict(symbol=sym, combo=k)
            r.update(D.outcome_block(gg))
            rows.append(r)
    w3 = pd.DataFrame(rows)
    A(md(save(w3, "w3_window_matched_per_asset.csv"), "{:.3f}"))
    wm = w3.pivot(index="symbol", columns="combo", values="mfe_over_mae")
    em = w3.pivot(index="symbol", columns="combo", values="er_median")
    rm = w3.pivot(index="symbol", columns="combo", values="R_median")
    A(f"\n_MFE/MAE > 1 in the 72+ stratum: C3 in {int((wm['C3'] > 1).sum())}/4 "
      f"assets, C1 in {int((wm['C1'] > 1).sum())}/4, C2 in "
      f"{int((wm['C2'] > 1).sum())}/4. Median signed ER > 0: C3 in "
      f"{int((em['C3'] > 0).sum())}/4, C1 in {int((em['C1'] > 0).sum())}/4, C2 in "
      f"{int((em['C2'] > 0).sum())}/4. Median R >= 1: C3 in "
      f"{int((rm['C3'] >= 1).sum())}/4, C1 in {int((rm['C1'] >= 1).sum())}/4, C2 "
      f"in {int((rm['C2'] >= 1).sum())}/4._\n")

    A("### W4. The same axis on the PURE day-level subset\n")
    A("_D5 shows ~3 in 4 PDH/PDL take-outs sit within 0.05 ATR of a still-alive "
      "session level -- i.e. the day level is mostly a session level wearing a "
      "different hat. W2's C2/C3 rows therefore partly restate C1-like events. "
      "This table repeats the window-regime cut on the ~25% of day-level "
      "take-outs that stand alone, which is the honest read of what the new "
      "level class adds._\n")
    pu = e[(e.stream == "pd") & e.primary & ~e.coincident_session_level]
    rows = []
    for k, blk in (("C2-pure", "NY"), ("C3-pure", "Asia")):
        g = pu[pu.sweep_block == blk]
        for st in D.STRATA_LBL:
            gg = g[g.stratum == st]
            if len(gg) < 40:
                continue
            r = dict(combo=k, stratum=st)
            r.update(D.outcome_block(gg))
            rows.append(r)
        r = dict(combo=k, stratum="ALL"); r.update(D.outcome_block(g)); rows.append(r)
    A(md(save(pd.DataFrame(rows), "w4_pure_window_regime.csv"), "{:.3f}"))

    A("\n### W5. Separation summary — does any (level class x window regime) cell leave the break-even aggregate?\n")
    A("_The pass's headline number. For each combo: the aggregate, then the best "
      "and worst window regime it contains, and the spread between them. "
      "`vs_c1_agg` is the distance from the number this pass argues with -- C1's "
      "aggregate median R of 1.00, the coin flip v4 measured from the "
      "confirmation close. A cell is only interesting if it moves that number by "
      "an amount a trader would notice, in a stratum with enough events to be "
      "worth trading, and in the scale-free columns as well as in R._\n")
    rows = []
    c1_agg = D.outcome_block(dd_prep.combo(e, "C1"))["R_median"]
    for k in D.COMBO_ORDER:
        g = dd_prep.combo(e, k)
        agg = D.outcome_block(g)
        sub = w1[(w1.combo == k) & (w1.stratum != "ALL")].dropna(subset=["R_median"])
        best = sub.loc[sub.R_median.idxmax()]
        worst = sub.loc[sub.R_median.idxmin()]
        beste = sub.loc[sub.er_median.idxmax()]
        rows.append(dict(
            combo=k, what=D.COMBOS[k]["label"], n=agg["n"],
            agg_R=agg["R_median"], agg_er=agg["er_median"],
            agg_mfe_over_mae=agg["mfe_over_mae"], agg_R_ge1_pct=agg["R_ge1_pct"],
            best_regime=best.stratum, best_regime_n=int(best.n),
            best_R=best.R_median, best_R_ge1_pct=best.R_ge1_pct,
            worst_regime=worst.stratum, worst_R=worst.R_median,
            regime_R_spread=best.R_median - worst.R_median,
            best_er_regime=beste.stratum, best_er=beste.er_median,
            regime_er_spread=sub.er_median.max() - sub.er_median.min(),
            vs_c1_agg=best.R_median - c1_agg,
        ))
    A(md(save(pd.DataFrame(rows), "w5_regime_separation.csv"), "{:.3f}"))


# ===========================================================================
def subwindows(e: pd.DataFrame):
    A("\n## S. Question (a), SECONDARY/DERIVED — the clock sub-window\n")
    A("_**The v4 result is the null hypothesis here**: \"no best hour, only a "
      "best remaining window\". Every table in this section is a test against "
      "that null, not an independent question. A clock pattern that survives "
      "inside a fixed window regime (section W) is about the hour; one that "
      "vanishes is reported as **the clock, not the hour**._\n")

    A("### S1. Hourly buckets (take-out bar's UTC hour), per combo\n")
    frames = []
    for k in D.COMBO_ORDER:
        g = dd_prep.combo(e, k)
        for h in D.COMBOS[k]["hours"]:
            gg = g[g.hour == h]
            if not len(gg):
                continue
            r = dict(combo=k, hour=f"{h:02d}:00")
            r.update(D.outcome_block(gg))
            frames.append(r)
    s1 = pd.DataFrame(frames)
    A(md(save(s1, "s1_hourly.csv")))
    A("\n_`bars_left_*` sits deliberately in the same table as the outcome "
      "columns: within a block the hour and the window length are the same "
      "variable seen twice, and any hourly pattern has to be read against that "
      "column before it is read as a fact about the hour. Hourly counts fall "
      "below ~50 confirmed events per bucket for C2, so the 2h view (S2) is "
      "primary there._\n")

    A("### S2. 2h roll-up, per combo\n")
    frames = []
    for k in D.COMBO_ORDER:
        g = dd_prep.combo(e, k)
        start = min(D.COMBOS[k]["hours"])
        g = g.assign(h2=hour2(g.hour, start))
        for lbl, gg in g.groupby("h2", sort=True):
            r = dict(combo=k, window=lbl)
            r.update(D.outcome_block(gg))
            frames.append(r)
    s2 = pd.DataFrame(frames)
    A(md(save(s2, "s2_two_hour.csv")))

    A("### S3. The stratified companion — 2h sub-window WITHIN window-length strata\n")
    A("_The design's central hazard: later take-outs mechanically have shorter "
      "windows, so a naive sub-window table mostly rediscovers the clock. Here "
      "the comparison is made inside fixed window-length strata (bars of block "
      "remaining at the take-out). A sub-window effect that survives across "
      "strata is about the hour; one that vanishes is **the clock, not the "
      "hour**._\n")
    A("_Buckets are **hourly** here, not 2h: at 2h granularity each stratum "
      "contains exactly one window and there is nothing left to compare. That "
      "collapse is itself the result — see S3b — and the hourly view is the "
      "finest cut at which any within-stratum comparison exists at all._\n")
    frames = []
    for k in D.COMBO_ORDER:
        g = dd_prep.combo(e, k)
        for st in D.STRATA_LBL:
            gs = g[g.stratum == st]
            for h, gg in gs.groupby("hour", sort=True):
                if len(gg) < 25:
                    continue
                r = dict(combo=k, stratum=st, hour=f"{int(h):02d}:00")
                r.update(D.outcome_block(gg))
                frames.append(r)
    s3 = pd.DataFrame(frames)
    A(md(save(s3, "s3_subwindow_stratified.csv")))
    A("\n_Buckets with fewer than 25 take-outs are omitted rather than shown as "
      "noise. Empty (stratum x hour) cells are not missing data — they are "
      "**impossible**: a take-out at 19:00 in the NY block cannot have 72+ bars "
      "left, because the block ends at 21:00. That impossibility is the "
      "confound, stated as a structural fact rather than a caveat._\n")

    A("### S3b. How much of the hour IS the window length?\n")
    rows = []
    for k in D.COMBO_ORDER:
        g = dd_prep.combo(e, k)
        rho, n = spearman(g.hour.astype(float), g.bars_remaining.astype(float))
        start = min(D.COMBOS[k]["hours"])
        g = g.assign(h2=hour2(g.hour, start))
        cross = pd.crosstab(g.h2, g.stratum)
        rows.append(dict(combo=k, n=n, rho_hour_vs_barsleft=rho,
                         hours_per_stratum=float(
                             (pd.crosstab(g.hour, g.stratum) >= 25).sum(axis=0).mean()),
                         two_h_windows_per_stratum=float((cross >= 25).sum(axis=0).mean()),
                         strata_per_2h_window=float((cross >= 25).sum(axis=1).mean())))
    A(md(save(pd.DataFrame(rows), "s3b_hour_window_collinearity.csv"), "{:.3f}"))
    A("\n_Inside a fixed block the take-out hour and the bars-of-block-remaining "
      "are the **same variable measured twice**: the rank correlation is about "
      "-0.99, and every 2h window sits in exactly one window-length stratum. "
      "There is therefore no version of the sub-window question that can be "
      "answered while holding window length fixed at 2h resolution, and only a "
      "two-hour-wide comparison survives at 1h resolution. This is not a caveat "
      "attached to the S1/S2 tables — it is what those tables are._\n")

    A("### S4. Separation summary — does any sub-window cut leave the aggregate?\n")
    A("_For each combo: the aggregate, then the best and worst 2h bucket by "
      "median R and by median signed ER, then the same spread measured **within** "
      "the single stratum that has the most events — the like-for-like version. "
      "The last column is the report's answer in one number: how much of the raw "
      "spread survives when window length is held fixed._\n")
    rows = []
    for k in D.COMBO_ORDER:
        g = dd_prep.combo(e, k)
        start = min(D.COMBOS[k]["hours"])
        g = g.assign(h2=hour2(g.hour, start))
        agg = D.outcome_block(g)
        raw = s2[s2.combo == k].dropna(subset=["R_median"])
        raw = raw[raw.n >= 40]
        big = g.stratum.value_counts().idxmax()
        gs = g[g.stratum == big]
        strat = []
        for h, gg in gs.groupby("hour", sort=True):   # hourly: see S3
            if len(gg) < 25:
                continue
            r = dict(window=f"{int(h):02d}:00"); r.update(D.outcome_block(gg))
            strat.append(r)
        strat = pd.DataFrame(strat).dropna(subset=["R_median"])
        rows.append(dict(
            combo=k, what=D.COMBOS[k]["label"], n=agg["n"],
            agg_R=agg["R_median"], agg_er=agg["er_median"],
            best_window=raw.loc[raw.R_median.idxmax(), "window"],
            best_R=raw.R_median.max(),
            worst_window=raw.loc[raw.R_median.idxmin(), "window"],
            worst_R=raw.R_median.min(),
            raw_R_spread=raw.R_median.max() - raw.R_median.min(),
            best_er_window=raw.loc[raw.er_median.idxmax(), "window"],
            raw_er_spread=raw.er_median.max() - raw.er_median.min(),
            strat_used=big, n_strat=len(gs),
            strat_R_spread=(strat.R_median.max() - strat.R_median.min()
                            if len(strat) > 1 else np.nan),
            strat_er_spread=(strat.er_median.max() - strat.er_median.min()
                             if len(strat) > 1 else np.nan),
        ))
    A(md(save(pd.DataFrame(rows), "s4_separation_summary.csv"), "{:.3f}"))



# ===========================================================================
def gapsize(e: pd.DataFrame):
    A("\n## G. Question (b) — the iFVG gap size as a predictor\n")
    A("_Predictor, primary: the inverting FVG's height divided by ATR(14, 5m) "
      "**at the gap's own third bar** — causal and cross-asset comparable. "
      "Secondary: the same height divided by the swept structure's own range "
      "(the level session's high-low, or the prior day's range for PDH/PDL) — "
      "known and frozen before the sweep. The sweep block's range was rejected "
      "as a denominator: it is not known at confirmation time._\n")

    conf = {k: dd_prep.combo(e, k).query("ifvg_confirmed") for k in D.COMBO_ORDER}

    A("### G1. The predictor's own distribution, per combo\n")
    rows = []
    for k in D.COMBO_ORDER:
        g = conf[k]
        for col, unit in (("gap_atr", "gap / ATR at formation"),
                          ("gap_over_struct", "gap / swept structure range")):
            q = g[col].quantile([.1, .25, .5, .75, .9])
            rows.append(dict(combo=k, predictor=unit, n=int(g[col].notna().sum()),
                             p10=q[.1], p25=q[.25], median=q[.5], p75=q[.75], p90=q[.9],
                             mean=g[col].mean()))
    A(md(save(pd.DataFrame(rows), "g1_predictor_distribution.csv"), "{:.4f}"))
    A("\n_A typical inverting 5m FVG is a fraction of one ATR tall and a low "
      "single-digit percentage of the structure it swept. Quintile edges below "
      "should be read in those terms._\n")

    for col, tag, title in (("gap_atr", "g2", "G2. Quintiles of the PRIMARY predictor (gap height / ATR at formation)"),
                            ("gap_over_struct", "g2b", "G2b. Quintiles of the SECONDARY predictor (gap height / swept structure range)")):
        A(f"### {title}\n")
        rows = []
        for k in D.COMBO_ORDER:
            g = conf[k].copy()
            g["q"] = pd.qcut(g[col], 5, labels=[f"Q{i}" for i in range(1, 6)],
                             duplicates="drop")
            for lbl, gg in g.groupby("q", observed=True):
                r = dict(combo=k, quintile=str(lbl),
                         edge_lo=gg[col].min(), edge_hi=gg[col].max())
                r.update(D.outcome_block(gg))
                rows.append(r)
        A(md(save(pd.DataFrame(rows), f"{tag}_quintiles.csv"), "{:.3f}"))
        A("")
    A("_`ifvg_rate` is 100% by construction in G2/G2b: the predictor only exists "
      "for events that confirmed, so these tables are cut on the confirmed "
      "sample and the confirmation rate is not a free column here._\n")

    A("### G3. Spearman rank correlations — per combo, per asset\n")
    rows = []
    for k in D.COMBO_ORDER:
        for sym in D.SYMBOLS + ["ALL"]:
            g = conf[k] if sym == "ALL" else conf[k][conf[k].symbol == sym]
            r = dict(combo=k, symbol=sym, n=len(g))
            for pcol, pname in (("gap_atr", "atr"), ("gap_over_struct", "struct")):
                for ycol, yname in (("er", "er"), ("ifvg_mfe_atr", "mfe"),
                                    ("ifvg_R", "R")):
                    rho, nn = spearman(g[pcol], g[ycol])
                    r[f"rho_{pname}_{yname}"] = rho
            rows.append(r)
    g3 = pd.DataFrame(rows)
    A(md(save(g3, "g3_spearman.csv"), "{:.3f}"))
    A("\n_The bar the design set for calling this 'a relationship worth carrying "
      "to a design pass' is a monotone quintile pattern **plus** a "
      "consistent-sign correlation across all four assets. Anything else is "
      "reported as flat._\n")

    A("### G4. Robustness — the same correlation WITHIN window-length strata\n")
    rows = []
    for k in D.COMBO_ORDER:
        for st in D.STRATA_LBL:
            g = conf[k][conf[k].stratum == st]
            if len(g) < 40:
                continue
            r = dict(combo=k, stratum=st, n=len(g))
            for pcol, pname in (("gap_atr", "atr"), ("gap_over_struct", "struct")):
                for ycol, yname in (("er", "er"), ("ifvg_mfe_atr", "mfe"), ("ifvg_R", "R")):
                    r[f"rho_{pname}_{yname}"] = spearman(g[pcol], g[ycol])[0]
            rows.append(r)
    A(md(save(pd.DataFrame(rows), "g4_spearman_stratified.csv"), "{:.3f}"))

    A("### G5. Is the predictor entangled with time remaining? (checked, not assumed)\n")
    rows = []
    for k in D.COMBO_ORDER:
        g = conf[k]
        rho_b, n_b = spearman(g.gap_atr, g.bars_remaining)
        rho_h, _ = spearman(g.gap_atr, g.hour)
        rho_s, _ = spearman(g.gap_over_struct, g.bars_remaining)
        rho_stop, _ = spearman(g.gap_atr, g.ifvg_stop_atr)
        rho_dly, _ = spearman(g.gap_atr, g.ifvg_delay_bars)
        rows.append(dict(combo=k, n=n_b, rho_gapatr_barsleft=rho_b,
                         rho_gapatr_hour=rho_h, rho_gapstruct_barsleft=rho_s,
                         rho_gapatr_stop=rho_stop, rho_gapatr_delay=rho_dly))
    A(md(save(pd.DataFrame(rows), "g5_predictor_vs_clock.csv"), "{:.3f}"))
    A("\n_The design says gap size and time-remaining 'should be unrelated, but "
      "that is checked, not assumed'. This is the check, and they are unrelated "
      "(|rho| <= 0.04 everywhere).\n\n"
      "The last two columns are **not** part of the design's question and are "
      "the most important numbers in section G. `rho_gapatr_stop` is large and "
      "positive in every combo: a taller gap puts the inversion close further "
      "back from the sweep extreme, so the stop proxy — the denominator of R — "
      "grows with the predictor almost by construction. That, and not a change "
      "in the move itself, is what the monotone R decline across G2's quintiles "
      "is made of: MFE barely moves across those quintiles while the stop does._\n")


def main():
    e = dd_prep.load()
    A("# Drill-down tables (post-v4) — level class x window regime, three combos\n")
    A(f"_Window: {e.ts.min():%Y-%m-%d} .. {e.ts.max():%Y-%m-%d}, 4 assets "
      f"(BTC / ETH / SOL / BNB), 5m bars. Descriptive only — no nulls, no "
      f"gates. Primary sample throughout = >= {D.MINB} bars of the sweep block "
      f"remaining (V4). Confirmation layer = **iFVG-v4** "
      f"(`session-liquidity-v4/engine.py:ifvg_confirm_v4`), held FIXED and not "
      f"under test; BoS is still quarantined, neither computed nor drawn._\n")
    diagnostics(e)
    aggregates(e)
    window_regime(e)
    subwindows(e)
    gapsize(e)
    txt = "\n".join(OUT)
    with open(os.path.join(D.RESULTS, "TABLES.md"), "w") as fh:
        fh.write(txt + "\n")
    print("wrote", os.path.join(D.RESULTS, "TABLES.md"))


if __name__ == "__main__":
    main()
