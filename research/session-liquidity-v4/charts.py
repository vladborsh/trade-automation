#!/usr/bin/env python3
"""Distribution / comparison charts — session-liquidity **v4**.

Writes viz/01..08_*.png. Worked-example panels live in examples.py /
gallery.py (the gallery is the audit surface; these are the aggregate views).

Delta-style, like the tables: only the charts the confirmation layer changed
are redrawn. v2's window-length distribution, wick-magnitude and unconditional
charts are upstream of confirmation and stand as they are in
`../session-liquidity-v2/viz/`.

  01  the three-way delta v2 / v3-A / v4 — rate, selected-gap size, delay, R
  02  SAME-GAP AGREEMENT — v2 vs v4: how often the same gap, and how the
      disagreement looks when it happens
  03  state-machine diagnostics (candidates / replacements / two causes)
  04  confirmation rate — level_session x sweep_block, v4 beside v3-A
  05  from-confirmation geometry (MFE / MAE / stop / R)
  06  HOUR OF DAY — gap frequency by clock hour + confirmed-reversal rate by
      hour, window-length-stratified (the §5.1 required deliverable)
  07  monthly stability, all three algorithms
  08  what the deleted invalidation rule was costing — confirmation rate vs
      how many local extremes price printed beyond the take-out bar

Usage: .venv/bin/python research/session-liquidity-v4/charts.py
"""
from __future__ import annotations

import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

import common as C
import tables as T

SESS_ORD = T.SESS_ORD
BLOCK_ORD = T.BLOCK_ORD
CS = {"Asia": "#e08b3a", "London": "#3f7fbf", "NY": "#7b5ea7", "Late": "#9aa0a6"}
V2C, V3C, V4C = "#9aa0a6", "#c0392b", "#2e8b57"


def _save(fig, name):
    p = os.path.join(C.VIZ, name)
    fig.savefig(p, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print("wrote", p)


def ch01(p):
    """The three-way headline."""
    fig, axes = plt.subplots(1, 4, figsize=(19.5, 4.9))

    ax = axes[0]
    vals = [100 * p.v2_ifvg_confirmed.mean(), 100 * p.v3a_confirmed.mean(),
            100 * p.ifvg_confirmed.mean()]
    b = ax.bar(["v2\n(best-pick)", "v3-A\n(+invalidation)", "v4\n(no invalidation)"],
               vals, color=[V2C, V3C, V4C], width=.62)
    ax.bar_label(b, fmt="%.1f%%", fontsize=11)
    ax.set_ylabel("% of take-outs confirmed")
    ax.set_title(f"Confirmation rate\n(same {len(p):,} take-outs)")
    ax.set_ylim(0, 80); ax.grid(alpha=.3, axis="y")

    # v2 is drawn thick and v4 thin-dashed on top: the two are nearly
    # indistinguishable and that IS the finding, so neither may hide the other.
    ax = axes[1]
    bins = np.arange(0, 2.0, 0.05)
    for col, c_, lbl, lw, ls in ((("v2_ifvg_confirmed", "v2_ifvg_gap_atr"), V2C, "v2", 3.6, "-"),
                                 (("v3a_confirmed", "v3a_gap_atr"), V3C, "v3-A", 1.8, "-"),
                                 (("ifvg_confirmed", "ifvg_gap_atr"), V4C, "v4", 1.6, "--")):
        s = p.loc[p[col[0]], col[1]]
        ax.hist(s, bins=bins, density=True, histtype="step", lw=lw, ls=ls, color=c_,
                label=f"{lbl} (med {s.median():.2f})")
    ax.set_xlabel("gap height (ATR)"); ax.set_ylabel("density")
    ax.set_title("Selected-gap size\n(the small-gap-bias prediction)")
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    ax = axes[2]
    bins = np.arange(0, 80, 3)
    for col, c_, lbl, lw, ls in ((("v2_ifvg_confirmed", "v2_ifvg_delay_bars"), V2C, "v2", 3.6, "-"),
                                 (("v3a_confirmed", "v3a_delay_bars"), V3C, "v3-A", 1.8, "-"),
                                 (("ifvg_confirmed", "ifvg_delay_bars"), V4C, "v4", 1.6, "--")):
        ax.hist(p.loc[p[col[0]], col[1]], bins=bins, density=True,
                histtype="step", lw=lw, ls=ls, color=c_, label=lbl)
    ax.set_xlabel("bars from take-out to confirmation")
    ax.set_title("Confirmation delay")
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    ax = axes[3]
    bins = np.arange(0, 5, 0.2)
    for col, c_, lbl, lw, ls in ((("v2_ifvg_confirmed", "v2_ifvg_R"), V2C, "v2", 3.6, "-"),
                                 (("v3a_confirmed", "v3a_R"), V3C, "v3-A", 1.8, "-"),
                                 (("ifvg_confirmed", "ifvg_R"), V4C, "v4", 1.6, "--")):
        s = p.loc[p[col[0]], col[1]]
        ax.hist(s.clip(0, 5), bins=bins, density=True, histtype="step", lw=lw, ls=ls,
                color=c_, label=f"{lbl} (med {s.median():.2f})")
    ax.axvline(1, color="#111", ls="--", lw=1.2)
    ax.set_xlabel("R proxy (MFE / stop), clipped at 5")
    ax.set_title("R proxy at the confirmation bar")
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    fig.suptitle("01 — v2's retroactive best-pick, v3-A's fabricated invalidation, and the "
                 "v4 spec: same take-outs, one layer changed each time", fontsize=13)
    fig.tight_layout(rect=[0, 0, 1, .92])
    _save(fig, "01_three_way_delta.png")


def ch02(p):
    """The same-gap agreement analysis (DESIGN §2 required)."""
    both = p[p.ifvg_confirmed & p.v2_ifvg_confirmed]
    diff = both[~both.same_gap_selected]
    fig, axes = plt.subplots(1, 3, figsize=(17, 5))

    ax = axes[0]
    share = 100 * both.same_gap_selected.mean()
    b = ax.bar(["SAME gap\nselected", "DIFFERENT gap\nselected"],
               [share, 100 - share], color=[V4C, "#e08b3a"], width=.6)
    ax.bar_label(b, labels=[f"{share:.1f}%\nn={int(both.same_gap_selected.sum()):,}",
                            f"{100-share:.1f}%\nn={len(diff):,}"], fontsize=10)
    ax.set_ylabel("% of take-outs BOTH algorithms confirm")
    ax.set_title(f"Do v2 and v4 pick the same gap?\n(on the {len(both):,} both confirm)")
    ax.set_ylim(0, 112); ax.grid(alpha=.3, axis="y")

    ax = axes[1]
    lbls, vals, ns = [], [], []
    bins = [(1, 1), (2, 2), (3, 4), (5, 8), (9, 10 ** 9)]
    for a_, b_ in bins:
        g = both[(both.n_candidates >= a_) & (both.n_candidates <= b_)]
        if not len(g):
            continue
        lbls.append(f"{a_}" if a_ == b_ else (f"{a_}+" if b_ > 10 ** 8 else f"{a_}-{b_}"))
        vals.append(100 * g.same_gap_selected.mean()); ns.append(len(g))
    bb = ax.bar(lbls, vals, color="#7b5ea7", width=.6)
    ax.bar_label(bb, labels=[f"{v:.0f}%\nn={n:,}" for v, n in zip(vals, ns)], fontsize=8)
    ax.set_xlabel("qualifying gaps the window offered (v4's counter)")
    ax.set_ylabel("% same gap selected"); ax.set_ylim(0, 118)
    ax.set_title("Agreement falls only where there was\nsomething to disagree about")
    ax.grid(alpha=.3, axis="y")

    ax = axes[2]
    d = diff.dropna(subset=["ifvg_gap_atr", "v2_ifvg_gap_atr"])
    ax.scatter(d.v2_ifvg_gap_atr.clip(0, 3), d.ifvg_gap_atr.clip(0, 3), s=7,
               alpha=.30, color="#3f7fbf", edgecolors="none")
    ax.plot([0, 3], [0, 3], color="#111", ls="--", lw=1.2, label="same size")
    ax.set_xlabel("v2's selected gap (ATR, clipped at 3)")
    ax.set_ylabel("v4's selected gap (ATR, clipped at 3)")
    ax.set_title(f"Where they differ, v4's gap is the fresher one\n"
                 f"({100*(d.ifvg_gap_atr > d.v2_ifvg_gap_atr).mean():.0f}% of the "
                 f"{len(d):,} above the diagonal)")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3)

    fig.suptitle("02 — with invalidation deleted, the only residual v2-vs-v4 difference is "
                 "WHICH gap is named. The confirming BAR is identical in 100% of these "
                 "cases, so delay, MFE, stop and R are unchanged.", fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, .90])
    _save(fig, "02_same_gap_agreement.png")


def ch03(p):
    """What the state machine actually did, per take-out."""
    fig, axes = plt.subplots(1, 3, figsize=(16.5, 5))

    ax = axes[0]
    for col, col_c, lbl in (("n_candidates", "#3f7fbf", "qualifying gaps seen"),
                            ("n_replacements", V4C, "replacements")):
        v = p[col].clip(0, 12)
        h = np.bincount(v.astype(int), minlength=13) / len(p) * 100
        ax.plot(range(13), h, marker="o", ms=4, lw=1.8, color=col_c, label=lbl)
    ax.set_xlabel("count per take-out (clipped at 12)")
    ax.set_ylabel("% of primary take-outs")
    ax.set_title("State-machine activity per take-out\n(v4 has no third counter — "
                 "invalidation is gone)")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3)

    ax = axes[1]
    cols = {"confirmed": V4C, "no_candidate": "#9aa0a6", "live_at_block_end": "#e08b3a"}
    bottom = np.zeros(len(BLOCK_ORD))
    for c_ in T.CAUSE_ORD:
        v = np.array([100 * (p[p.sweep_block == b].unconf_cause == c_).mean()
                      for b in BLOCK_ORD])
        ax.bar(BLOCK_ORD, v, bottom=bottom, color=cols[c_], label=c_, width=.65)
        bottom += v
    ax.set_ylabel("% of that block's take-outs")
    ax.set_title("Outcome split by sweep block\n(three outcomes, not four)")
    ax.legend(fontsize=8); ax.grid(alpha=.3, axis="y")

    ax = axes[2]
    bins = [(0, 0), (1, 1), (2, 2), (3, 4), (5, 8), (9, 99)]
    lbls, rates, ns = [], [], []
    for a_, b_ in bins:
        g = p[(p.n_candidates >= a_) & (p.n_candidates <= b_)]
        lbls.append(f"{a_}" if a_ == b_ else (f"{a_}+" if b_ > 50 else f"{a_}-{b_}"))
        rates.append(100 * g.ifvg_confirmed.mean()); ns.append(len(g))
    b = ax.bar(lbls, rates, color="#7b5ea7", width=.6)
    ax.bar_label(b, labels=[f"{r:.0f}%\nn={n:,}" for r, n in zip(rates, ns)], fontsize=8)
    ax.set_xlabel("qualifying gaps seen during the window")
    ax.set_ylabel("% confirmed")
    ax.set_title("Once ONE candidate exists, ~9 in 10 confirm\n"
                 "(under v3 this curve sloped the other way)")
    ax.set_ylim(0, 110); ax.grid(alpha=.3, axis="y")

    fig.suptitle("03 — state-machine diagnostics (v4, primary sample)", fontsize=13)
    fig.tight_layout(rect=[0, 0, 1, .89])
    _save(fig, "03_state_machine.png")


def ch04(p):
    """The re-derived core rate table, drawn beside v3-A's."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5), sharey=True)
    x = np.arange(len(BLOCK_ORD)); w = .26
    for ax, col, ttl in ((axes[0], "ifvg_confirmed", "v4 — sequential, no invalidation"),
                         (axes[1], "v3a_confirmed", "v3-A — with the fabricated invalidation")):
        for k, s_ in enumerate(SESS_ORD):
            v = [100 * p[(p.level_session == s_) & (p.sweep_block == b)][col].mean()
                 for b in BLOCK_ORD]
            ax.bar(x + (k - 1) * w, v, w, color=CS[s_], label=f"{s_} level")
        ax.set_xticks(x); ax.set_xticklabels(BLOCK_ORD)
        ax.set_xlabel("sweep block (when the take-out happened)")
        ax.set_title(ttl); ax.grid(alpha=.3, axis="y")
    axes[0].set_ylabel("% of take-outs confirmed")
    axes[0].legend(fontsize=8.5)
    fig.suptitle("04 — confirmation rate, level_session x sweep_block (shared y-axis: "
                 "the shape is the same, the level is ~3x higher without invalidation)",
                 fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, .91])
    _save(fig, "04_rate_levelsession_x_block.png")


def ch05(p):
    """From-confirmation geometry — the tradable view."""
    c = p[p.ifvg_confirmed]
    fig, axes = plt.subplots(1, 3, figsize=(16.5, 5))

    ax = axes[0]
    bins = np.arange(0, 12, .4)
    ax.hist(c.ifvg_mfe_atr.clip(0, 12), bins=bins, histtype="step", lw=2,
            color=V4C, label=f"MFE (med {c.ifvg_mfe_atr.median():.2f})")
    ax.hist(c.ifvg_mae_atr.clip(0, 12), bins=bins, histtype="step", lw=2,
            color="#c0392b", label=f"MAE (med {c.ifvg_mae_atr.median():.2f})")
    ax.set_xlabel("ATR from the confirmation close"); ax.set_ylabel("events")
    ax.set_title("MFE vs MAE over the rest of the block")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3)

    ax = axes[1]
    for b in BLOCK_ORD:
        g = c[c.sweep_block == b]
        ax.hist(g.ifvg_R.clip(0, 4), bins=np.arange(0, 4, .2), density=True,
                histtype="step", lw=1.8, color=CS[b],
                label=f"{b} (med {g.ifvg_R.median():.2f}, n={len(g):,})")
    ax.axvline(1, color="#111", ls="--", lw=1.2)
    ax.set_xlabel("R proxy, clipped at 4"); ax.set_ylabel("density")
    ax.set_title("R proxy by sweep block")
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    ax = axes[2]
    x = np.arange(len(BLOCK_ORD)); w = .35
    ax.bar(x - w / 2, [100 * (c[c.sweep_block == b].ifvg_R >= 1).mean() for b in BLOCK_ORD],
           w, color=V4C, label="R >= 1")
    ax.bar(x + w / 2, [100 * (c[c.sweep_block == b].ifvg_R >= 2).mean() for b in BLOCK_ORD],
           w, color="#7b5ea7", label="R >= 2")
    ax.set_xticks(x); ax.set_xticklabels(BLOCK_ORD)
    ax.set_ylabel("% of confirmed events"); ax.set_title("Share reaching R >= 1 / 2")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3, axis="y")

    fig.suptitle("05 — geometry measured FROM the v4 confirmation close "
                 "(descriptive; MFE is a best-case exit, not a strategy)", fontsize=12.5)
    fig.tight_layout(rect=[0, 0, 1, .91])
    _save(fig, "05_from_confirmation.png")


def ch06(e, p):
    """THE §5.1 REQUIRED DELIVERABLE — hour of day, window-length-stratified."""
    fh = pd.read_csv(os.path.join(C.RESULTS, "fvg_hourly.csv"))
    h1 = fh.groupby("hour").agg(bars=("bars", "sum"), bull=("bull", "sum"),
                                bear=("bear", "sum")).reset_index()
    h1["per100"] = 100 * (h1.bull + h1.bear) / h1.bars

    fig, axes = plt.subplots(1, 3, figsize=(19, 5.4))
    hours = np.arange(24)

    def _blocks(ax):
        for b, (h0, h1_) in C.BLOCKS.items():
            ax.axvspan(h0 - .5, h1_ - .5, color=CS[b], alpha=.08, zorder=0)
            ax.text((h0 + h1_) / 2 - .5, ax.get_ylim()[1], b, ha="center", va="top",
                    fontsize=8.5, color=CS[b], zorder=5)

    # ---- panel 1: raw gap frequency by clock hour --------------------------
    ax = axes[0]
    ax.bar(hours, h1.per100, color="#3f7fbf", width=.75)
    ax.set_xticks(hours[::2])
    ax.set_xlabel("UTC hour"); ax.set_ylabel("3-candle FVGs per 100 bars")
    ax.set_title("Gap frequency by clock hour\n(every bar, 4 assets — no sweep required)")
    ax.set_ylim(0, h1.per100.max() * 1.25)
    ax.grid(alpha=.3, axis="y"); _blocks(ax)

    # ---- panel 2: take-outs and unstratified rate -------------------------
    ax = axes[1]
    n_by_h = np.array([len(p[p.hour == h]) for h in hours])
    ax.bar(hours, n_by_h, color="#dfe3e6", width=.75, label="take-outs (right)")
    ax2 = ax.twinx()
    ax2.plot(hours, [100 * p[p.hour == h].ifvg_confirmed.mean() for h in hours],
             color=V4C, marker="o", ms=4, lw=2, label="v4 confirmed rate")
    ax2.plot(hours, [100 * p[p.hour == h].v3a_confirmed.mean() for h in hours],
             color=V3C, marker="s", ms=3.5, lw=1.6, ls="--", label="v3-A rate")
    ax2.set_ylabel("% confirmed"); ax2.set_ylim(0, 90)
    ax.set_xticks(hours[::2]); ax.set_xlabel("UTC hour of the take-out")
    ax.set_ylabel("take-outs (primary sample)")
    ax.set_title("UNSTRATIFIED hourly rate\n(§6.1: this mostly rediscovers the clock)")
    h_, l_ = ax2.get_legend_handles_labels()
    ax2.legend(h_, l_, fontsize=8, loc="lower left")
    ax.grid(alpha=.3, axis="y"); _blocks(ax)

    # ---- panel 3: stratified by remaining window --------------------------
    ax = axes[2]
    colors = ["#c0392b", "#e08b3a", "#3f7fbf", V4C]
    for lbl, col in zip(T.HOUR_LBL, colors):
        v = []
        for h in hours:
            g = e[(e.hour == h) & (e.hour_bucket == lbl)]
            v.append(100 * g.ifvg_confirmed.mean() if len(g) >= 20 else np.nan)
        ax.plot(hours, v, marker="o", ms=5, lw=1.9, color=col,
                label=f"{lbl} bars left in block")
    ax.set_xticks(hours[::2]); ax.set_xlabel("UTC hour of the take-out")
    ax.set_ylabel("% confirmed (v4)"); ax.set_ylim(0, 90)
    ax.set_title("STRATIFIED by remaining window\n"
                 "(inside a stratum the hourly spread nearly vanishes)")
    ax.legend(fontsize=8); ax.grid(alpha=.3); _blocks(ax)

    fig.suptitle("06 — hour of day (knowledge/session-liquidity.md §5.1 required "
                 "deliverable): when gaps form, and when a swept level actually "
                 "gets a confirmed reversal", fontsize=12.5)
    fig.tight_layout(rect=[0, 0, 1, .90])
    _save(fig, "06_hour_of_day.png")


def ch07(p):
    """Monthly stability, all three algorithms."""
    m = p.groupby("month").agg(n=("bar", "size"),
                               v4=("ifvg_confirmed", "mean"),
                               v3a=("v3a_confirmed", "mean"),
                               v2=("v2_ifvg_confirmed", "mean"),
                               R=("ifvg_R", "median"))
    fig, axes = plt.subplots(2, 1, figsize=(15, 7.5), sharex=True)
    x = np.arange(len(m))
    ax = axes[0]
    ax.plot(x, 100 * m.v2, color=V2C, lw=2.6, ls="-", label="v2 rate")
    ax.plot(x, 100 * m.v4, color=V4C, lw=1.6, ls="--", marker="o", ms=3,
            label="v4 rate (identical to v2 in every month)")
    ax.plot(x, 100 * m.v3a, color=V3C, lw=1.8, marker="s", ms=3, label="v3-A rate")
    ax.set_ylabel("% confirmed"); ax.legend(fontsize=9); ax.grid(alpha=.3)
    ax.set_title("07 — monthly stability of the confirmation rate and the R proxy")
    ax = axes[1]
    ax.plot(x, m.R, color="#7b5ea7", lw=2, marker="o", ms=3.5)
    ax.axhline(m.R.median(), color="#111", ls=":", lw=1.2,
               label=f"median across months {m.R.median():.2f}")
    ax.set_ylabel("median R proxy (v4)"); ax.legend(fontsize=9); ax.grid(alpha=.3)
    ax.set_xticks(x[::3]); ax.set_xticklabels(m.index[::3], rotation=45, fontsize=8)
    fig.tight_layout()
    _save(fig, "07_monthly_stability.png")


def ch08(p):
    """What the deleted invalidation rule was costing, by the shape it punished."""
    fig, axes = plt.subplots(1, 3, figsize=(17, 5))

    ax = axes[0]
    x = np.arange(len(T.EXT_LBL)); w = .38
    v4v = [100 * p[p.ext_bucket == l].ifvg_confirmed.mean() for l in T.EXT_LBL]
    v3v = [100 * p[p.ext_bucket == l].v3a_confirmed.mean() for l in T.EXT_LBL]
    ns = [int((p.ext_bucket == l).sum()) for l in T.EXT_LBL]
    b1 = ax.bar(x - w / 2, v4v, w, color=V4C, label="v4 (no invalidation)")
    ax.bar(x + w / 2, v3v, w, color=V3C, label="v3-A (with invalidation)")
    ax.bar_label(b1, labels=[f"n={n:,}" for n in ns], fontsize=7.5, padding=1)
    ax.set_xticks(x); ax.set_xticklabels(T.EXT_LBL)
    ax.set_xlabel("local highs (lows) printed BEYOND the take-out bar's extreme")
    ax.set_ylabel("% confirmed"); ax.set_ylim(0, 108)
    ax.set_title("The shape the deleted rule punished")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3, axis="y")

    ax = axes[1]
    v = p.n_closes_beyond_extreme.clip(0, 60)
    ax.hist(v, bins=np.arange(0, 62, 2), color="#3f7fbf")
    ax.set_xlabel("closes beyond the take-out bar's extreme, per take-out (clipped at 60)")
    ax.set_ylabel("take-outs")
    ax.set_title(f"v3 killed the candidate on the FIRST of these\n"
                 f"({100*(p.n_closes_beyond_extreme > 0).mean():.0f}% of take-outs "
                 f"have at least one)")
    ax.grid(alpha=.3, axis="y")

    ax = axes[2]
    c4 = p[p.ifvg_confirmed]; c3 = p[p.v3a_confirmed]
    ax.hist(c4.ifvg_R.clip(0, 4), bins=np.arange(0, 4, .2), density=True,
            histtype="step", lw=2, color=V4C,
            label=f"v4 confirmations (n={len(c4):,}, med R {c4.ifvg_R.median():.2f})")
    ax.hist(c3.v3a_R.clip(0, 4), bins=np.arange(0, 4, .2), density=True,
            histtype="step", lw=2, color=V3C,
            label=f"v3-A confirmations (n={len(c3):,}, med R {c3.v3a_R.median():.2f})")
    ax.axvline(1, color="#111", ls="--", lw=1.2)
    ax.set_xlabel("R proxy, clipped at 4"); ax.set_ylabel("density")
    ax.set_title("The 3x extra signals are not worse signals")
    ax.legend(fontsize=7.8); ax.grid(alpha=.3)

    fig.suptitle("08 — the fabricated invalidation rule cost ~3/4 of all confirmations and "
                 "bought no quality: it fired on exactly the shape the user's own diagram "
                 "draws as a valid sweep.", fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, .90])
    _save(fig, "08_invalidation_cost.png")


def main():
    e = T.load_events()
    p = e[e.primary]
    ch01(p); ch02(p); ch03(p); ch04(p); ch05(p); ch06(e, p); ch07(p); ch08(p)


if __name__ == "__main__":
    main()
