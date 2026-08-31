#!/usr/bin/env python3
"""Comparison charts for the drill-down pass.

Reads the CSVs written by `dd_tables.py` — nothing is recomputed here, so a
chart can never disagree with the table it illustrates.

Chart conventions (kept deliberately narrow so the seven figures read as one
set):
  * three combos, three fixed hues, assigned once and never cycled;
  * **no dual-axis panels** — where an outcome has to be read against window
    length, the window length gets its own panel next to it rather than a second
    y-scale on the same one, because a second scale is exactly where a
    clock-driven pattern gets to look like a market one;
  * every bar carries its value, and every figure has a CSV of the same name in
    results/, so nothing depends on reading a colour;
  * a dashed reference line marks the number the pass is arguing with — C1's
    aggregate median R of 1.00 — wherever R is plotted.

Figure order follows the post-v4 reframe: the stream diagnostics first, then the
**window regime** (the primary axis), then the clock sub-window (the secondary,
derived cut), then the gap-size predictor.

Usage: .venv/bin/python research/session-liquidity-v2/drilldown/dd_charts.py
"""
from __future__ import annotations

import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

import dd_common as D

# categorical slots 1-3 of the project's validated palette, fixed order
CC = {"C1": "#2a78d6", "C2": "#eb6834", "C3": "#1baf7a"}
GREY = "#6b6a66"
INK = "#1a1a19"
C1_BASELINE = 1.0            # the break-even aggregate this pass argues with


def rd(name: str) -> pd.DataFrame:
    return pd.read_csv(os.path.join(D.RESULTS, name))


def barlabels(ax, bars, fmt="{:.2f}", size=7.5):
    for b in bars:
        h = b.get_height()
        if not np.isfinite(h):
            continue
        ax.annotate(fmt.format(h), (b.get_x() + b.get_width() / 2, h),
                    ha="center", va="bottom" if h >= 0 else "top",
                    fontsize=size, color=INK,
                    xytext=(0, 2 if h >= 0 else -2), textcoords="offset points")


def finish(ax, title, ylab=None, xlab=None):
    ax.set_title(title, fontsize=10, pad=7)
    if ylab:
        ax.set_ylabel(ylab, fontsize=8.5)
    if xlab:
        ax.set_xlabel(xlab, fontsize=8.5)
    ax.grid(axis="y", alpha=.22, lw=.7)
    ax.set_axisbelow(True)
    ax.tick_params(labelsize=8)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)


def save(fig, name):
    p = os.path.join(D.VIZ, name)
    fig.savefig(p, dpi=125)
    plt.close(fig)
    print("wrote", p)


# ---------------------------------------------------------------- 01 -------
def chart01():
    d2 = rd("d2_pd_block_distribution.csv")
    d4 = rd("d4_late_sets_extreme.csv")
    d5 = rd("d5_coincidence.csv")
    fig, ax = plt.subplots(1, 4, figsize=(19, 4.4))

    b = ax[0].bar(d2.sweep_block, d2.share_pct, color=CC["C3"], width=.62)
    barlabels(ax[0], b, "{:.1f}%")
    finish(ax[0], "Where PDH/PDL sweeps happen\n(share of all day-level take-outs)", "% of take-outs")
    ax[0].text(.5, .93, "Asia gets first refusal: the level\nis sweepable from 00:00 UTC",
               transform=ax[0].transAxes, ha="center", va="top", fontsize=7.5, color=GREY)

    g = d4[d4.symbol != "ALL"]
    x = np.arange(len(g)); w = .38
    b1 = ax[1].bar(x - w / 2, g.late_set_high_pct, w, color=CC["C1"], label="Late set the day HIGH")
    b2 = ax[1].bar(x + w / 2, g.late_set_low_pct, w, color=CC["C2"], label="Late set the day LOW")
    barlabels(ax[1], b1, "{:.0f}%"); barlabels(ax[1], b2, "{:.0f}%")
    ax[1].set_xticks(x); ax[1].set_xticklabels([s[:3] for s in g.symbol])
    ax[1].legend(fontsize=7.5, frameon=False)
    finish(ax[1], "Why PDH/PDL is the FULL prior day\n(share of days where 21-24 UTC set the extreme)", "% of days")

    g = d5[d5.symbol != "ALL"]
    x = np.arange(len(g))
    b = ax[2].bar(x, g.coincident_pct, color=CC["C2"], width=.62)
    barlabels(ax[2], b, "{:.0f}%")
    ax[2].set_xticks(x); ax[2].set_xticklabels([s[:3] for s in g.symbol])
    ax[2].set_ylim(0, 100)
    finish(ax[2], "How much of the new class is NEW\n(day level within 0.05 ATR of an alive session level)",
           "% of day-level take-outs")
    ax[2].text(.5, .5, "~3 in 4 day-level sweeps are\na session level in disguise",
               transform=ax[2].transAxes, ha="center", fontsize=8, color=INK)

    g = d5[d5.symbol == "ALL"]
    lbl = ["median R", "iFVG rate /100", "median signed ER"]
    pure = [float(g.pure_R_median.iloc[0]), float(g.pure_ifvg_rate.iloc[0]) / 100, float(g.pure_er_median.iloc[0])]
    coin = [float(g.coincident_R_median.iloc[0]), float(g.coincident_ifvg_rate.iloc[0]) / 100,
            float(g.coincident_er_median.iloc[0])]
    x = np.arange(3)
    b1 = ax[3].bar(x - w / 2, pure, w, color=CC["C3"], label=f"pure day level (n={int(g.n_pure.iloc[0])})")
    b2 = ax[3].bar(x + w / 2, coin, w, color=GREY, label="coincident with a session level")
    barlabels(ax[3], b1); barlabels(ax[3], b2)
    ax[3].set_xticks(x); ax[3].set_xticklabels(lbl, fontsize=8)
    ax[3].legend(fontsize=7.5, frameon=False)
    finish(ax[3], "The pure day level is the slightly better half\n(all blocks, primary sample)")

    fig.suptitle("01 — PDH/PDL stream diagnostics: does the new level class behave? "
                 "(read before any outcome table)", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .93))
    save(fig, "01_pd_stream_diagnostics.png")

# ---------------------------------------------------------------- 02 -------
def chart02():
    """THE PRIMARY AXIS. Window regime per combo, in the four columns that
    matter: the confirmation rate (which v4 already showed is a window-length
    gradient), the R proxy, the scale-free excursion symmetry, and the
    trendiness metric. The first two rise with the window partly by
    construction; the last two do not, which is why they are drawn alongside."""
    w1 = rd("w1_window_regime.csv")
    w1 = w1[w1.stratum != "ALL"]
    strata = D.STRATA_LBL
    x = np.arange(len(strata)); w = .26
    panels = [("ifvg_rate", "% of take-outs confirmed",
               "iFVG-v4 confirmation rate", None),
              ("R_median", "median R proxy",
               "median R proxy", C1_BASELINE),
              ("mfe_over_mae", "median MFE / median MAE",
               "excursion symmetry (scale-free)", 1.0),
              ("er_median", "median signed ER",
               "trendiness (scale-free)", 0.0)]
    fig, ax = plt.subplots(1, 4, figsize=(18, 5.0))
    for j, (col, ylab, title, ref) in enumerate(panels):
        for i, k in enumerate(D.COMBO_ORDER):
            g = w1[w1.combo == k].set_index("stratum").reindex(strata)
            b = ax[j].bar(x + (i - 1) * w, g[col], w, color=CC[k],
                          label=f"{k} — {D.COMBOS[k]['label']}")
            if col != "ifvg_rate":       # rate labels collide; the axis is enough
                barlabels(ax[j], b,
                          "{:+.3f}" if col == "er_median" else "{:.2f}", 7)
        if ref is not None:
            ax[j].axhline(ref, color=INK, ls="--" if ref else "-",
                          lw=1.1 if ref else .9)
        ax[j].set_xticks(x); ax[j].set_xticklabels(strata)
        finish(ax[j], title, ylab, "window regime (bars left)")
    ax[0].legend(fontsize=7.5, frameon=False, loc="upper left",
                 bbox_to_anchor=(0.0, -0.17), ncol=3)
    fig.suptitle("02 — THE PRIMARY AXIS: the window regime. Confirmation rate and R rise with the "
                 "window in every combo — but so does the window's own capacity for a large "
                 "excursion.\nThe two right-hand panels are the scale-free view, and they are "
                 "nearly flat: the regime buys you a longer window, not a better sweep.",
                 fontsize=12)
    fig.tight_layout(rect=(0, .06, 1, .89))
    save(fig, "02_window_regime.png")


# ---------------------------------------------------------------- 02 -------
def chart05():
    s1 = rd("s1_hourly.csv")
    fig, ax = plt.subplots(3, 3, figsize=(16, 11), sharex="row")
    for i, k in enumerate(D.COMBO_ORDER):
        g = s1[s1.combo == k]
        col = CC[k]
        b = ax[i][0].bar(g.hour, g.R_median, color=col, width=.62)
        barlabels(ax[i][0], b)
        ax[i][0].axhline(C1_BASELINE, color=INK, ls="--", lw=1.1)
        ax[i][0].text(0.99, C1_BASELINE, "C1 aggregate = 1.00 ",
                      transform=ax[i][0].get_yaxis_transform(),
                      fontsize=7, va="bottom", ha="right", color=INK)
        finish(ax[i][0], f"{k} — {D.COMBOS[k]['label']}: median R by hour", "median R proxy")

        b = ax[i][1].bar(g.hour, g.er_median, color=col, width=.62)
        barlabels(ax[i][1], b, "{:+.3f}")
        ax[i][1].axhline(0, color=INK, lw=.9)
        ax[i][1].set_ylim(-0.12, 0.12)
        finish(ax[i][1], f"{k}: median signed efficiency ratio by hour",
               "median signed ER  (+1 trend, 0 chop)")

        b = ax[i][2].bar(g.hour, g.bars_left_median, color=GREY, width=.62)
        barlabels(ax[i][2], b, "{:.0f}")
        finish(ax[i][2], f"{k}: median bars of block REMAINING by hour", "bars left (5m)")
    for a in ax[-1]:
        a.set_xlabel("take-out hour (UTC)", fontsize=8.5)
    fig.suptitle("05 — Sub-windows inside the sweeping block. Left: the outcome that moves. "
                 "Middle: the trendiness metric, which does not.\nRight: the window length — "
                 "the same shape as the left panel, which is the whole problem "
                 "(deliberately a separate panel, never a second axis).", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .93))
    save(fig, "05_subwindow_hourly.png")


# ---------------------------------------------------------------- 03 -------
def chart06():
    s4 = rd("s4_separation_summary.csv")
    s3 = rd("s3_subwindow_stratified.csv")
    fig, ax = plt.subplots(1, 3, figsize=(16, 4.8))

    x = np.arange(len(s4)); w = .38
    b1 = ax[0].bar(x - w / 2, s4.raw_R_spread, w, color=GREY,
                   label="raw: best 2h bucket − worst")
    b2 = ax[0].bar(x + w / 2, s4.strat_R_spread, w, color=CC["C1"],
                   label="within one window-length stratum")
    barlabels(ax[0], b1); barlabels(ax[0], b2)
    ax[0].set_xticks(x); ax[0].set_xticklabels(s4.combo)
    ax[0].legend(fontsize=7.5, frameon=False)
    finish(ax[0], "Spread in median R across sub-windows", "R spread (max − min)")

    b1 = ax[1].bar(x - w / 2, s4.raw_er_spread, w, color=GREY, label="raw")
    b2 = ax[1].bar(x + w / 2, s4.strat_er_spread, w, color=CC["C1"], label="within a stratum")
    barlabels(ax[1], b1, "{:.3f}"); barlabels(ax[1], b2, "{:.3f}")
    ax[1].set_xticks(x); ax[1].set_xticklabels(s4.combo)
    ax[1].legend(fontsize=7.5, frameon=False)
    finish(ax[1], "Spread in median signed ER across sub-windows", "ER spread")

    for k in D.COMBO_ORDER:
        g = s3[s3.combo == k]
        ax[2].scatter(g.bars_left_median, g.R_median, s=42, color=CC[k],
                      label=f"{k} ({D.COMBOS[k]['label']})", zorder=3)
        for _, r in g.iterrows():
            ax[2].annotate(r.hour[:2], (r.bars_left_median, r.R_median), fontsize=7,
                           xytext=(4, 2), textcoords="offset points", color=INK)
    ax[2].axhline(C1_BASELINE, color=INK, ls="--", lw=1.1)
    ax[2].legend(fontsize=7.5, frameon=False, loc="lower right")
    finish(ax[2], "Every hourly bucket, plotted against its own window length\n"
                  "(the points are labelled by hour)", "median R proxy", "median bars of block remaining")

    fig.suptitle("06 — \"The clock, not the hour\": the sub-window spread that survives when "
                 "window length is held fixed", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .9))
    save(fig, "06_clock_not_hour.png")


# ---------------------------------------------------------------- 04 -------
def chart07():
    g2 = rd("g2_quintiles.csv")
    fig, ax = plt.subplots(1, 4, figsize=(19, 4.6))
    panels = [("R_median", "median R proxy", "median R by gap-size quintile"),
              ("er_median", "median signed ER", "median signed ER — flat everywhere"),
              ("mfe_atr_median", "median MFE (ATR)", "median MFE — barely moves"),
              ("stop_atr_median", "median stop proxy (ATR)", "median stop — moves a lot")]
    x = np.arange(5); w = .26
    for j, (col, ylab, title) in enumerate(panels):
        for i, k in enumerate(D.COMBO_ORDER):
            g = g2[g2.combo == k].sort_values("quintile")
            ax[j].bar(x + (i - 1) * w, g[col], w, color=CC[k],
                      label=f"{k} — {D.COMBOS[k]['label']}")
        ax[j].set_xticks(x); ax[j].set_xticklabels([f"Q{i}" for i in range(1, 6)])
        if col == "R_median":
            ax[j].axhline(C1_BASELINE, color=INK, ls="--", lw=1.1)
        if col == "er_median":
            ax[j].axhline(0, color=INK, lw=.9); ax[j].set_ylim(-0.06, 0.06)
        finish(ax[j], title, ylab, "quintile of gap height / ATR at formation (Q5 = tallest)")
    ax[0].legend(fontsize=7.5, frameon=False)
    fig.suptitle("07 — The gap-size predictor. R falls monotonically with gap size in all three "
                 "combos — but the two right-hand panels show why:\nthe move (MFE) is unchanged "
                 "and it is the STOP, R's denominator, that grows with the gap.", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .9))
    save(fig, "07_gap_quintiles.png")


# ---------------------------------------------------------------- 05 -------
def chart08():
    g3 = rd("g3_spearman.csv")
    g5 = rd("g5_predictor_vs_clock.csv")
    fig, ax = plt.subplots(1, 3, figsize=(16, 4.6))
    syms = [s for s in D.SYMBOLS]
    x = np.arange(len(syms)); w = .26
    for j, (col, title, ylab) in enumerate(
            [("rho_atr_R", "gap size vs the R proxy — negative in 12/12 asset-combos", "Spearman rho"),
             ("rho_atr_er", "gap size vs signed ER — no consistent sign", "Spearman rho")]):
        for i, k in enumerate(D.COMBO_ORDER):
            g = g3[(g3.combo == k) & (g3.symbol.isin(syms))].set_index("symbol").loc[syms]
            ax[j].bar(x + (i - 1) * w, g[col], w, color=CC[k], label=f"{k}")
        ax[j].axhline(0, color=INK, lw=.9)
        ax[j].set_xticks(x); ax[j].set_xticklabels([s[:3] for s in syms])
        ax[j].set_ylim(-0.30, 0.30)
        finish(ax[j], title, ylab)
    ax[0].legend(fontsize=7.5, frameon=False, ncol=3)

    lbls = ["vs bars left", "vs hour", "vs the STOP proxy"]
    cols = ["rho_gapatr_barsleft", "rho_gapatr_hour", "rho_gapatr_stop"]
    x = np.arange(3)
    for i, k in enumerate(D.COMBO_ORDER):
        g = g5[g5.combo == k].iloc[0]
        b = ax[2].bar(x + (i - 1) * w, [g[c] for c in cols], w, color=CC[k], label=k)
        barlabels(ax[2], b, "{:.2f}", 7)
    ax[2].axhline(0, color=INK, lw=.9)
    ax[2].set_xticks(x); ax[2].set_xticklabels(lbls, fontsize=8)
    ax[2].legend(fontsize=7.5, frameon=False, ncol=3)
    finish(ax[2], "What the gap size IS correlated with", "Spearman rho")

    fig.suptitle("08 — Gap size as a predictor, per asset. The only consistent relationship is with "
                 "R, and the right-hand panel\nshows it is a relationship with R's denominator, "
                 "not with the move.", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .9))
    save(fig, "08_gap_spearman.png")


# ---------------------------------------------------------------- 06 -------
def chart03():
    s5 = rd("w2_window_matched_combos.csv")
    fig, ax = plt.subplots(1, 3, figsize=(16, 4.8))
    strata = D.STRATA_LBL
    x = np.arange(len(strata)); w = .26
    panels = [("R_median", "median R proxy", "median R at matched window length"),
              ("mfe_over_mae", "median MFE / median MAE", "excursion symmetry — the scale-free view"),
              ("er_median", "median signed ER", "trendiness at matched window length")]
    for j, (col, ylab, title) in enumerate(panels):
        for i, k in enumerate(D.COMBO_ORDER):
            g = s5[s5.combo == k].set_index("stratum").reindex(strata)
            b = ax[j].bar(x + (i - 1) * w, g[col], w, color=CC[k],
                          label=f"{k} — {D.COMBOS[k]['label']}")
            barlabels(ax[j], b, "{:.3f}" if col == "er_median" else "{:.2f}", 7)
        ax[j].set_xticks(x); ax[j].set_xticklabels(strata)
        if col == "R_median":
            ax[j].axhline(C1_BASELINE, color=INK, ls="--", lw=1.1)
        if col == "mfe_over_mae":
            ax[j].axhline(1.0, color=INK, ls="--", lw=1.1)
        if col == "er_median":
            ax[j].axhline(0, color=INK, lw=.9)
        finish(ax[j], title, ylab, "window-length stratum (bars of block remaining)")
    ax[0].legend(fontsize=7.5, frameon=False, loc="upper left",
                 bbox_to_anchor=(0.0, -0.16), ncol=3)
    fig.suptitle("03 — The comparison the confound does not block: combo vs combo inside the same "
                 "window-length stratum.\nC1 wins on R (a tighter stop); C3 is the only combo whose "
                 "MFE exceeds its MAE.", fontsize=12)
    fig.tight_layout(rect=(0, .07, 1, .9))
    save(fig, "03_window_matched_combos.png")


# ---------------------------------------------------------------- 07 -------
def chart04():
    s6 = rd("w3_window_matched_per_asset.csv")
    fig, ax = plt.subplots(1, 2, figsize=(13, 4.8))
    syms = D.SYMBOLS
    x = np.arange(len(syms)); w = .26
    for j, (col, ylab, title, ref) in enumerate(
            [("mfe_over_mae", "median MFE / median MAE",
              "Excursion symmetry per asset (72+ stratum)", 1.0),
             ("er_median", "median signed ER",
              "Trendiness per asset (72+ stratum)", 0.0)]):
        for i, k in enumerate(D.COMBO_ORDER):
            g = s6[s6.combo == k].set_index("symbol").reindex(syms)
            b = ax[j].bar(x + (i - 1) * w, g[col], w, color=CC[k],
                          label=f"{k} — {D.COMBOS[k]['label']}")
            barlabels(ax[j], b, "{:.2f}", 7)
        ax[j].axhline(ref, color=INK, ls="--", lw=1.1)
        ax[j].set_xticks(x); ax[j].set_xticklabels([s[:3] for s in syms])
        finish(ax[j], title, ylab)
    ax[0].legend(fontsize=7.5, frameon=False)
    fig.suptitle("04 — The one interior cut that is consistent across all four assets: PDH/PDL swept "
                 "in Asia (C3)\nis the only combo with MFE > MAE in 4/4 assets and a positive median "
                 "ER in 4/4, at matched window length.", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .88))
    save(fig, "04_per_asset_consistency.png")


if __name__ == "__main__":
    chart01(); chart02(); chart03(); chart04(); chart05(); chart06(); chart07()
    chart08()
