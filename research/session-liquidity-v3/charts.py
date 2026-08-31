#!/usr/bin/env python3
"""Distribution / comparison charts — session-liquidity **v3**.

Writes viz/01..07_*.png. Worked-example panels live in examples.py /
gallery.py (the gallery is the audit surface; these are the aggregate views).

Delta-style, like the tables: only the charts the confirmation layer changed
are redrawn. v2's window-length distribution (its chart 01 left panel), its
wick-magnitude and unconditional charts are upstream of confirmation and stand
as they are in `../session-liquidity-v2/viz/`.

  01  v2 vs v3 — rate, selected-gap size, delay, R (the bug's bias)
  02  the three invalidation variants A / B / C, and the tie geometry
  03  state-machine diagnostics (candidates / invalidations / cause split)
  04  confirmation rate — level_session x sweep_block, v3 beside v2
  05  from-confirmation geometry (MFE / MAE / stop / R)
  06  HOUR OF DAY — gap frequency by clock hour + confirmed-reversal rate by
      hour, window-length-stratified (the §5.1 required deliverable)
  07  monthly stability, v3 beside v2

Usage: .venv/bin/python research/session-liquidity-v3/charts.py
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
V2C, V3C = "#9aa0a6", "#c0392b"


def _save(fig, name):
    p = os.path.join(C.VIZ, name)
    fig.savefig(p, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print("wrote", p)


def ch01(p):
    """The headline: what the retroactive best-pick was buying."""
    fig, axes = plt.subplots(1, 4, figsize=(19, 4.8))

    ax = axes[0]
    vals = [100 * p.v2_ifvg_confirmed.mean(), 100 * p.ifvg_confirmed.mean()]
    b = ax.bar(["v2\n(best-pick)", "v3\n(sequential)"], vals, color=[V2C, V3C], width=.6)
    ax.bar_label(b, fmt="%.1f%%", fontsize=11)
    ax.set_ylabel("% of take-outs confirmed")
    ax.set_title("Confirmation rate\n(same 21,118 take-outs)")
    ax.set_ylim(0, 75); ax.grid(alpha=.3, axis="y")

    ax = axes[1]
    bins = np.arange(0, 2.0, 0.05)
    ax.hist(p.loc[p.v2_ifvg_confirmed, "v2_ifvg_gap_atr"], bins=bins, density=True,
            histtype="step", lw=2, color=V2C, label="v2 selected gap")
    ax.hist(p.loc[p.ifvg_confirmed, "ifvg_gap_atr"], bins=bins, density=True,
            histtype="step", lw=2, color=V3C, label="v3 selected gap")
    ax.axvline(p.loc[p.v2_ifvg_confirmed, "v2_ifvg_gap_atr"].median(), color=V2C, ls=":")
    ax.axvline(p.loc[p.ifvg_confirmed, "ifvg_gap_atr"].median(), color=V3C, ls=":")
    ax.set_xlabel("gap height (ATR)"); ax.set_ylabel("density")
    ax.set_title("Selected-gap size\n(the small-gap-bias prediction)")
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    ax = axes[2]
    bins = np.arange(0, 80, 3)
    ax.hist(p.loc[p.v2_ifvg_confirmed, "v2_ifvg_delay_bars"], bins=bins, density=True,
            histtype="step", lw=2, color=V2C, label="v2")
    ax.hist(p.loc[p.ifvg_confirmed, "ifvg_delay_bars"], bins=bins, density=True,
            histtype="step", lw=2, color=V3C, label="v3")
    ax.set_xlabel("bars from take-out to confirmation")
    ax.set_title("Confirmation delay")
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    ax = axes[3]
    bins = np.arange(0, 5, 0.2)
    ax.hist(p.loc[p.v2_ifvg_confirmed, "v2_ifvg_R"].clip(0, 5), bins=bins, density=True,
            histtype="step", lw=2, color=V2C, label=f"v2 (med {p.v2_ifvg_R.median():.2f})")
    ax.hist(p.loc[p.ifvg_confirmed, "ifvg_R"].clip(0, 5), bins=bins, density=True,
            histtype="step", lw=2, color=V3C, label=f"v3 (med {p.ifvg_R.median():.2f})")
    ax.axvline(1, color="#111", ls="--", lw=1.2)
    ax.set_xlabel("R proxy (MFE / stop), clipped at 5")
    ax.set_title("R proxy at the confirmation bar")
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    fig.suptitle("01 — v2's retroactive best-pick vs v3's sequential state machine: "
                 "same take-outs, one layer changed", fontsize=13)
    fig.tight_layout(rect=[0, 0, 1, .93])
    _save(fig, "01_v2_vs_v3.png")


def ch02(p):
    """The pin-3 geometry finding, and the three variants it forces apart."""
    fig, axes = plt.subplots(1, 3, figsize=(16.5, 5))

    ax = axes[0]
    names = ["A (primary)\ninvalidation\nwins the tie", "B\nconfirmation\nwins the tie",
             "C\nreference frozen\nat activation", "v2\n(the bug)"]
    vals = [100 * p.ifvg_confirmed.mean(), 100 * p.B_confirmed.mean(),
            100 * p.C_confirmed.mean(), 100 * p.v2_ifvg_confirmed.mean()]
    b = ax.bar(names, vals, color=[V3C, "#e08b3a", "#3f7fbf", V2C], width=.62)
    ax.bar_label(b, fmt="%.1f%%", fontsize=11)
    ax.set_ylabel("% of take-outs confirmed"); ax.set_ylim(0, 75)
    ax.set_title("Confirmation rate by invalidation variant")
    ax.grid(alpha=.3, axis="y")

    ax = axes[1]
    share = 100 * (p.n_ties > 0).mean()
    b = ax.bar(["take-outs with\n>=1 tie bar", "take-outs with\nno tie bar"],
               [share, 100 - share], color=["#c0392b", "#dfe3e6"], width=.6)
    ax.bar_label(b, fmt="%.1f%%", fontsize=11)
    ax.set_ylabel("% of primary take-outs")
    ax.set_title(f"How often the 'near-impossible' tie fires\n"
                 f"({int(p.n_ties.sum()):,} tie bars in total)")
    ax.grid(alpha=.3, axis="y")

    ax = axes[2]
    x = np.arange(3)
    ax.bar(x, [100 * p.loc[p.ifvg_confirmed, "gap_above_extreme"].mean(),
               100 * p.loc[p.B_confirmed, "B_gap_above_extreme"].mean(),
               100 * p.loc[p.C_confirmed, "C_gap_above_extreme"].mean()],
           color=[V3C, "#e08b3a", "#3f7fbf"], width=.6)
    ax.set_xticks(x); ax.set_xticklabels(["A", "B", "C"])
    ax.set_ylabel("% of confirmations")
    ax.set_title("Share of confirmations whose gap lay\nBEYOND the take-out extreme")
    ax.grid(alpha=.3, axis="y")

    fig.suptitle("02 — DESIGN §1 pin 3 assumed a bar cannot both invert the gap and close "
                 "beyond the take-out extreme. Geometrically it can, and often does.",
                 fontsize=12.5)
    fig.tight_layout(rect=[0, 0, 1, .91])
    _save(fig, "02_variants_and_tie.png")


def ch03(p):
    """What the state machine actually did, per take-out."""
    fig, axes = plt.subplots(1, 3, figsize=(16.5, 5))

    ax = axes[0]
    for col, col_c, lbl in (("n_candidates", "#3f7fbf", "qualifying gaps seen"),
                            ("n_invalidations", "#c0392b", "invalidations"),
                            ("n_replacements", "#2e8b57", "replacements")):
        v = p[col].clip(0, 12)
        h = np.bincount(v.astype(int), minlength=13) / len(p) * 100
        ax.plot(range(13), h, marker="o", ms=4, lw=1.8, color=col_c, label=lbl)
    ax.set_xlabel("count per take-out (clipped at 12)")
    ax.set_ylabel("% of primary take-outs")
    ax.set_title("State-machine activity per take-out")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3)

    ax = axes[1]
    order = ["confirmed", "invalidated_out", "no_candidate", "live_at_block_end"]
    cols = {"confirmed": "#2e8b57", "invalidated_out": "#c0392b",
            "no_candidate": "#9aa0a6", "live_at_block_end": "#e08b3a"}
    bottom = np.zeros(len(BLOCK_ORD))
    for c_ in order:
        v = np.array([100 * (p[p.sweep_block == b].unconf_cause == c_).mean()
                      for b in BLOCK_ORD])
        ax.bar(BLOCK_ORD, v, bottom=bottom, color=cols[c_], label=c_, width=.65)
        bottom += v
    ax.set_ylabel("% of that block's take-outs")
    ax.set_title("Outcome split by sweep block")
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
    ax.set_title("More candidates = LOWER confirmation rate\n"
                 "(churn means price kept running away)")
    ax.grid(alpha=.3, axis="y")

    fig.suptitle("03 — state-machine diagnostics (variant A, primary sample)", fontsize=13)
    fig.tight_layout(rect=[0, 0, 1, .90])
    _save(fig, "03_state_machine.png")


def ch04(p):
    """The re-derived core rate table, drawn beside v2's."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5), sharey=True)
    x = np.arange(len(BLOCK_ORD)); w = .26
    for ax, col, ttl in ((axes[0], "ifvg_confirmed", "v3 — sequential state machine"),
                         (axes[1], "v2_ifvg_confirmed", "v2 — retroactive best-pick")):
        for k, s_ in enumerate(SESS_ORD):
            v = [100 * p[(p.level_session == s_) & (p.sweep_block == b)][col].mean()
                 for b in BLOCK_ORD]
            ax.bar(x + (k - 1) * w, v, w, color=CS[s_], label=f"{s_} level")
        ax.set_xticks(x); ax.set_xticklabels(BLOCK_ORD)
        ax.set_xlabel("sweep block (when the take-out happened)")
        ax.set_title(ttl); ax.grid(alpha=.3, axis="y")
    axes[0].set_ylabel("% of take-outs confirmed")
    axes[0].legend(fontsize=8.5)
    fig.suptitle("04 — confirmation rate, level_session x sweep_block "
                 "(note the shared y-axis: the v3 panel is not a different shape, "
                 "it is the same shape three times lower)", fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, .91])
    _save(fig, "04_rate_levelsession_x_block.png")


def ch05(p):
    """From-confirmation geometry — the tradable view."""
    c = p[p.ifvg_confirmed]
    fig, axes = plt.subplots(1, 3, figsize=(16.5, 5))

    ax = axes[0]
    bins = np.arange(0, 12, .4)
    ax.hist(c.ifvg_mfe_atr.clip(0, 12), bins=bins, histtype="step", lw=2,
            color="#2e8b57", label=f"MFE (med {c.ifvg_mfe_atr.median():.2f})")
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
           w, color="#2e8b57", label="R >= 1")
    ax.bar(x + w / 2, [100 * (c[c.sweep_block == b].ifvg_R >= 2).mean() for b in BLOCK_ORD],
           w, color="#7b5ea7", label="R >= 2")
    ax.set_xticks(x); ax.set_xticklabels(BLOCK_ORD)
    ax.set_ylabel("% of confirmed events"); ax.set_title("Share reaching R >= 1 / 2")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3, axis="y")

    fig.suptitle("05 — geometry measured FROM the v3 confirmation close "
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
             color=V3C, marker="o", ms=4, lw=2, label="v3 confirmed rate")
    ax2.plot(hours, [100 * p[p.hour == h].v2_ifvg_confirmed.mean() for h in hours],
             color=V2C, marker="s", ms=3.5, lw=1.6, ls="--", label="v2 rate")
    ax2.set_ylabel("% confirmed"); ax2.set_ylim(0, 80)
    ax.set_xticks(hours[::2]); ax.set_xlabel("UTC hour of the take-out")
    ax.set_ylabel("take-outs (primary sample)")
    ax.set_title("UNSTRATIFIED hourly rate\n(§6.1: this mostly rediscovers the clock)")
    h_, l_ = ax2.get_legend_handles_labels()
    ax2.legend(h_, l_, fontsize=8, loc="lower left")
    ax.grid(alpha=.3, axis="y"); _blocks(ax)

    # ---- panel 3: stratified by remaining window --------------------------
    ax = axes[2]
    colors = ["#c0392b", "#e08b3a", "#3f7fbf", "#2e8b57"]
    for lbl, col in zip(T.HOUR_LBL, colors):
        v = []
        for h in hours:
            g = e[(e.hour == h) & (e.hour_bucket == lbl)]
            v.append(100 * g.ifvg_confirmed.mean() if len(g) >= 20 else np.nan)
        ax.plot(hours, v, marker="o", ms=4, lw=1.9, color=col,
                label=f"{lbl} bars left in block")
    ax.set_xticks(hours[::2]); ax.set_xlabel("UTC hour of the take-out")
    ax.set_ylabel("% confirmed (v3)"); ax.set_ylim(0, 45)
    ax.set_title("STRATIFIED by remaining window\n"
                 "(within a stratum, the hour effect largely flattens)")
    ax.legend(fontsize=8); ax.grid(alpha=.3); _blocks(ax)

    fig.suptitle("06 — hour of day (knowledge/session-liquidity.md §5.1 required "
                 "deliverable): when gaps form, and when a swept level actually "
                 "gets a confirmed reversal", fontsize=12.5)
    fig.tight_layout(rect=[0, 0, 1, .90])
    _save(fig, "06_hour_of_day.png")


def ch07(p):
    """Monthly stability, v3 beside v2."""
    m = p.groupby("month").agg(n=("bar", "size"),
                               v3=("ifvg_confirmed", "mean"),
                               v2=("v2_ifvg_confirmed", "mean"),
                               R=("ifvg_R", "median"))
    fig, axes = plt.subplots(2, 1, figsize=(15, 7.5), sharex=True)
    x = np.arange(len(m))
    ax = axes[0]
    ax.plot(x, 100 * m.v2, color=V2C, lw=1.8, ls="--", marker="s", ms=3, label="v2 rate")
    ax.plot(x, 100 * m.v3, color=V3C, lw=2.2, marker="o", ms=3.5, label="v3 rate")
    ax.set_ylabel("% confirmed"); ax.legend(fontsize=9); ax.grid(alpha=.3)
    ax.set_title("07 — monthly stability of the confirmation rate and the R proxy")
    ax = axes[1]
    ax.plot(x, m.R, color="#7b5ea7", lw=2, marker="o", ms=3.5)
    ax.axhline(m.R.median(), color="#111", ls=":", lw=1.2,
               label=f"median across months {m.R.median():.2f}")
    ax.set_ylabel("median R proxy (v3)"); ax.legend(fontsize=9); ax.grid(alpha=.3)
    ax.set_xticks(x[::3]); ax.set_xticklabels(m.index[::3], rotation=45, fontsize=8)
    fig.tight_layout()
    _save(fig, "07_monthly_stability.png")


def main():
    e = T.load_events()
    p = e[e.primary]
    ch01(p); ch02(p); ch03(p); ch04(p); ch05(p); ch06(e, p); ch07(p)


if __name__ == "__main__":
    main()
