#!/usr/bin/env python3
"""Distribution / comparison charts — session-liquidity **v2**.

Writes viz/01..09_*.png. Worked-example panels live in examples.py / gallery.py
(the gallery is the audit surface; these are the aggregate views).

Usage: .venv/bin/python research/session-liquidity-v2/charts.py
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
REM_LBL = T.REM_LBL
CS = {"Asia": "#e08b3a", "London": "#3f7fbf", "NY": "#7b5ea7", "Late": "#9aa0a6"}


def _save(fig, name):
    p = os.path.join(C.VIZ, name)
    fig.savefig(p, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print("wrote", p)


def ch01(e):
    """The structural fact of v2: the horizon is no longer a constant."""
    fig, axes = plt.subplots(1, 2, figsize=(15, 5.4))
    ax = axes[0]
    for b in BLOCK_ORD:
        g = e[e.sweep_block == b]
        ax.hist(g.bars_remaining, bins=np.arange(0, 100, 3), histtype="step",
                lw=1.9, color=CS[b], label=f"{b} (n={len(g):,}, med {g.bars_remaining.median():.0f})")
    ax.axvline(C.MIN_BARS_REMAINING, color="#111", ls="--", lw=1.6)
    ax.text(C.MIN_BARS_REMAINING + 1, ax.get_ylim()[1] * .92,
            f" primary-sample cut\n ({C.MIN_BARS_REMAINING} bars = 1h)", fontsize=8.5)
    ax.set_xlabel("bars of 5m left in the block after the take-out")
    ax.set_ylabel("take-outs")
    ax.set_title("Window length by block")
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    ax = axes[1]
    x = np.arange(len(REM_LBL[1:])); w = .38
    rate = [100 * e.loc[e.rem_bucket == l, "ifvg_confirmed"].mean() for l in REM_LBL[1:]]
    short = 100 * e.loc[e.rem_bucket == REM_LBL[0], "ifvg_confirmed"].mean()
    b1 = ax.bar(x, rate, w * 1.6, color="#c0392b", label="iFVG confirmation rate")
    ax.bar_label(b1, fmt="%.0f%%", fontsize=9)
    ax.axhline(short, color="#9aa0a6", ls=":", lw=2,
               label=f"short-window bucket (<12 bars): {short:.0f}%")
    ax.set_xticks(x); ax.set_xticklabels(REM_LBL[1:])
    ax.set_xlabel("bars remaining in the block"); ax.set_ylabel("% confirmed")
    ax.set_title("Confirmation rate is largely a function of window length")
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)
    fig.suptitle("Chart 01 — the block-scoped horizon is a variable, not a constant "
                 "(v2's central structural change)", fontsize=13)
    _save(fig, "01_window_length.png")


def ch02(p):
    fig, axes = plt.subplots(1, 2, figsize=(15, 5.2))
    for ax, val, ttl, fmt, cmap in (
            (axes[0], "size", "Take-outs (count)", "{:.0f}", "Blues"),
            (axes[1], "mean", "iFVG confirmation rate (%)", "{:.0f}%", "Reds")):
        if val == "size":
            m = p.pivot_table(index="level_session", columns="sweep_block",
                              values="bar", aggfunc="size")
        else:
            m = p.pivot_table(index="level_session", columns="sweep_block",
                              values="ifvg_confirmed", aggfunc="mean") * 100
        m = m.reindex(index=SESS_ORD, columns=BLOCK_ORD)
        im = ax.imshow(m.values, cmap=cmap, aspect="auto")
        ax.set_xticks(range(len(BLOCK_ORD))); ax.set_xticklabels(BLOCK_ORD)
        ax.set_yticks(range(len(SESS_ORD))); ax.set_yticklabels(SESS_ORD)
        ax.set_xlabel("sweep_block — when the take-out happened")
        ax.set_ylabel("level_session — whose liquidity")
        for r in range(m.shape[0]):
            for c in range(m.shape[1]):
                v = m.values[r, c]
                ax.text(c, r, fmt.format(v), ha="center", va="center", fontsize=10,
                        color="white" if v > np.nanpercentile(m.values, 65) else "#111")
        ax.set_title(ttl)
        fig.colorbar(im, ax=ax, fraction=.045)
    fig.suptitle("Chart 02 — where sweeps happen and where they confirm "
                 "(primary sample; the two labels are never conflated)", fontsize=13)
    _save(fig, "02_frequency_and_rate.png")


def ch03(p):
    fig, axes = plt.subplots(1, 2, figsize=(15, 5.4), sharey=True)
    for ax, dr, nm in zip(axes, ["high_sweep", "low_sweep"],
                          ["High sweeps — downward reversal",
                           "Low sweeps — upward reversal"]):
        data = [p.loc[(p.direction == dr) & (p.level_session == s), "rev_atr"].dropna()
                for s in SESS_ORD]
        bp = ax.boxplot(data, tick_labels=SESS_ORD, showfliers=False, patch_artist=True,
                        medianprops=dict(color="#111", lw=1.8))
        for patch, s in zip(bp["boxes"], SESS_ORD):
            patch.set_facecolor(CS[s]); patch.set_alpha(.55)
        ax.set_title(f"{nm}  (n={sum(len(d) for d in data):,})")
        ax.grid(axis="y", alpha=.3)
        ax.set_xlabel("level_session — whose liquidity was taken")
    axes[0].set_ylabel("in-block reverse move from the take-out wick, ATR(14)")
    fig.suptitle("Chart 03 — reversal size from the WICK extreme, block-scoped "
                 "(primary sample; hindsight-anchored — see chart 04 for the tradable view)",
                 fontsize=13)
    _save(fig, "03_reverse_move_wick.png")


def ch04(p):
    c = p[p.ifvg_confirmed]
    fig, axes = plt.subplots(1, 3, figsize=(17, 5.2))
    ax = axes[0]
    bins = np.arange(0, 12, .35)
    ax.hist(c.ifvg_mfe_atr.dropna(), bins=bins, histtype="step", lw=2,
            color="#2e8b57", label=f"MFE (median {c.ifvg_mfe_atr.median():.2f})")
    ax.hist(c.ifvg_mae_atr.dropna(), bins=bins, histtype="step", lw=2,
            color="#c0392b", label=f"MAE (median {c.ifvg_mae_atr.median():.2f})")
    ax.set_xlabel("ATR(14) from the inversion close"); ax.set_ylabel("confirmed events")
    ax.set_title("MFE vs MAE after the iFVG confirms\n"
                 "— they sit almost on top of each other")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3)

    ax = axes[1]
    R = c.ifvg_R.dropna().sort_values()
    ax.plot(R.values, 1 - np.arange(len(R)) / len(R), lw=2, color="#7b5ea7")
    for k, col in ((1, "#2e8b57"), (2, "#c0392b")):
        sh = 100 * (R >= k).mean()
        ax.axvline(k, color=col, ls="--", lw=1.4)
        ax.text(k + .06, .82 - .09 * k, f" R>={k}: {sh:.0f}%", color=col, fontsize=9)
    ax.set_xlim(0, 6); ax.set_ylim(0, 1)
    ax.set_xlabel("R proxy = in-block MFE / stop proxy")
    ax.set_ylabel("share of confirmed events reaching at least this R")
    ax.set_title(f"R-proxy survival curve (median {R.median():.2f})\n"
                 "best case, no costs, no exit rule")
    ax.grid(alpha=.3)

    ax = axes[2]
    x = np.arange(len(BLOCK_ORD)); w = .38
    med = [c.loc[c.sweep_block == b, "ifvg_R"].median() for b in BLOCK_ORD]
    sh = [100 * (c.loc[c.sweep_block == b, "ifvg_R"] >= 1).mean() for b in BLOCK_ORD]
    b1 = ax.bar(x - w / 2, med, w, color="#7b5ea7", label="median R proxy")
    ax.bar_label(b1, fmt="%.2f", fontsize=8.5)
    ax2 = ax.twinx()
    b2 = ax2.bar(x + w / 2, sh, w, color="#e08b3a", label="% reaching R>=1")
    ax2.bar_label(b2, fmt="%.0f%%", fontsize=8.5)
    ax.set_xticks(x); ax.set_xticklabels(BLOCK_ORD)
    ax.set_ylabel("median R proxy"); ax2.set_ylabel("% of confirmed events with R>=1")
    ax.set_xlabel("sweep_block")
    ax.set_title("By block: the Late block is\nvisibly the weak one")
    h1, l1 = ax.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels()
    ax.legend(h1 + h2, l1 + l2, fontsize=8, loc="upper left")
    ax.grid(axis="y", alpha=.3)
    fig.suptitle("Chart 04 — the tradable view: everything measured from the iFVG "
                 "INVERSION CLOSE, not from the wick", fontsize=13)
    _save(fig, "04_from_confirmation.png")


def ch05(p, up):
    """The chart that re-answers the NY/Asia prior."""
    fig, axes = plt.subplots(1, 2, figsize=(15.5, 5.4))
    ax = axes[0]
    x = np.arange(len(BLOCK_ORD)); w = .38
    lt, lc = [], []
    for b in BLOCK_ORD:
        ub = up[up.sweep_block == b]
        g = p[p.sweep_block == b]
        base = np.mean([ub.down_atr.median(), ub.up_atr.median()])
        lt.append(g.rev_atr.median() / base)
        lc.append(g[g.ifvg_confirmed].rev_atr.median() / base)
    b1 = ax.bar(x - w / 2, lt, w, color="#3f7fbf", label="all take-outs")
    b2 = ax.bar(x + w / 2, lc, w, color="#c0392b", label="iFVG-confirmed take-outs")
    ax.bar_label(b1, fmt="%.2f", fontsize=8.5); ax.bar_label(b2, fmt="%.2f", fontsize=8.5)
    ax.axhline(1.0, color="#111", lw=1.8, ls="--")
    ax.text(len(BLOCK_ORD) - .55, 1.02, "no lift", fontsize=9)
    ax.set_xticks(x); ax.set_xticklabels(BLOCK_ORD)
    ax.set_xlabel("sweep_block"); ax.set_ylabel("median reverse move / block's own baseline")
    ax.set_title("Lift over each block's OWN unconditional baseline")
    ax.legend(fontsize=8.5); ax.grid(axis="y", alpha=.3)

    ax = axes[1]
    for b in BLOCK_ORD:
        ys, xs_ = [], []
        for k, lbl in enumerate(REM_LBL[1:]):
            g = p[(p.sweep_block == b) & (p.rem_bucket == lbl) & p.ifvg_confirmed]
            ub = up[(up.sweep_block == b) & (up.rem_bucket == lbl)]
            if len(g) < 50 or not len(ub):
                continue
            base = np.mean([ub.down_atr.median(), ub.up_atr.median()])
            ys.append(g.rev_atr.median() / base); xs_.append(k)
        ax.plot(xs_, ys, "o-", color=CS[b], lw=2, label=b)
    ax.axhline(1.0, color="#111", lw=1.8, ls="--")
    ax.set_xticks(range(len(REM_LBL[1:]))); ax.set_xticklabels(REM_LBL[1:])
    ax.set_xlabel("bars remaining in the block (window-matched)")
    ax.set_ylabel("confirmed-sweep lift")
    ax.set_title("Window-matched: the lift of a CONFIRMED sweep\nsits at ~1.0 almost everywhere")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3)
    fig.suptitle("Chart 05 — the honest comparison. A bar at 1.0 means the sweep told "
                 "you nothing the clock had not already told you.", fontsize=13)
    _save(fig, "05_lift.png")


def ch06(p):
    fig, axes = plt.subplots(1, 2, figsize=(15, 5.2))
    ax = axes[0]
    for b in BLOCK_ORD:
        g = p[(p.sweep_block == b) & p.ifvg_confirmed]
        ax.hist(g.ifvg_delay_bars, bins=np.arange(0, 70, 2), histtype="step",
                lw=1.9, color=CS[b], density=True,
                label=f"{b} (median {g.ifvg_delay_bars.median():.0f} bars)")
    ax.set_xlabel("bars of 5m from the take-out to the inversion close")
    ax.set_ylabel("density of confirmed events")
    ax.set_title("How long the iFVG makes you wait")
    ax.legend(fontsize=8.5); ax.grid(alpha=.3)

    ax = axes[1]
    x = np.arange(len(BLOCK_ORD)); w = .38
    unc = [100 * (1 - p.loc[p.sweep_block == b, "ifvg_confirmed"].mean()) for b in BLOCK_ORD]
    tr = [100 * p.loc[(p.sweep_block == b) & ~p.ifvg_confirmed,
                      "ifvg_would_confirm_extended"].mean() for b in BLOCK_ORD]
    b1 = ax.bar(x - w / 2, unc, w, color="#9aa0a6", label="% of take-outs left unconfirmed")
    b2 = ax.bar(x + w / 2, tr, w, color="#e08b3a",
                label="of those, % that WOULD confirm with 2h more block")
    ax.bar_label(b1, fmt="%.0f%%", fontsize=8.5); ax.bar_label(b2, fmt="%.0f%%", fontsize=8.5)
    ax.set_xticks(x); ax.set_xticklabels(BLOCK_ORD)
    ax.set_xlabel("sweep_block"); ax.set_ylabel("%")
    ax.set_title("What the block-scoped rule costs")
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)
    fig.suptitle("Chart 06 — confirmation delay and the block-truncation share",
                 fontsize=13)
    _save(fig, "06_delay_and_truncation.png")


def ch07(p):
    m = p.groupby("month").agg(n=("bar", "size"), rate=("ifvg_confirmed", "mean"),
                               R=("ifvg_R", "median"), rev=("rev_atr", "median"))
    x = np.arange(len(m))
    fig, axes = plt.subplots(3, 1, figsize=(15, 9), sharex=True)
    axes[0].bar(x, m.n, color="#3f7fbf"); axes[0].set_ylabel("take-outs")
    axes[0].set_title("Monthly take-outs (primary sample, 4 assets)")
    axes[1].plot(x, 100 * m.rate, "o-", color="#c0392b", lw=1.8)
    axes[1].axhline(100 * p.ifvg_confirmed.mean(), color="#111", ls="--", lw=1.4,
                    label=f"pooled {100*p.ifvg_confirmed.mean():.0f}%")
    axes[1].set_ylabel("iFVG rate, %"); axes[1].legend(fontsize=8.5)
    axes[2].plot(x, m.R, "o-", color="#7b5ea7", lw=1.8)
    axes[2].axhline(p.ifvg_R.median(), color="#111", ls="--", lw=1.4,
                    label=f"pooled {p.ifvg_R.median():.2f}")
    axes[2].axhline(1.0, color="#2e8b57", ls=":", lw=1.6, label="R = 1")
    axes[2].set_ylabel("median R proxy"); axes[2].legend(fontsize=8.5)
    axes[2].set_xticks(x[::3]); axes[2].set_xticklabels(m.index[::3], rotation=45, ha="right")
    for a in axes:
        a.grid(alpha=.3)
    fig.suptitle("Chart 07 — monthly stability. Frequency is steady; the R proxy "
                 "wanders around 1 without ever settling above it.", fontsize=13)
    _save(fig, "07_monthly_stability.png")


def ch08(p, e):
    fig, axes = plt.subplots(1, 3, figsize=(17, 5))
    ax = axes[0]
    k = sorted(p.n_levels_taken.unique())[:4]
    sh = [100 * (p.n_levels_taken == v).mean() for v in k]
    rt = [100 * p.loc[p.n_levels_taken == v, "ifvg_confirmed"].mean() for v in k]
    x = np.arange(len(k)); w = .38
    b1 = ax.bar(x - w / 2, sh, w, color="#3f7fbf", label="% of take-outs")
    b2 = ax.bar(x + w / 2, rt, w, color="#c0392b", label="iFVG rate, %")
    ax.bar_label(b1, fmt="%.1f", fontsize=8); ax.bar_label(b2, fmt="%.0f", fontsize=8)
    ax.set_xticks(x); ax.set_xticklabels([f"{v} level(s)" for v in k])
    ax.set_title("n_levels_taken split (V2 attribution)")
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)

    ax = axes[1]
    x = np.arange(2);
    b = ax.bar(x, [100 * p.ifvg_confirmed.mean(), 100 * p.ifvg_strict_confirmed.mean()],
               .5, color=["#c0392b", "#9aa0a6"])
    ax.bar_label(b, fmt="%.1f%%", fontsize=10)
    ax.set_xticks(x); ax.set_xticklabels(["relaxed (V5,\nused everywhere)",
                                          "strict (phase-1 D5,\nsensitivity only)"])
    ax.set_ylabel("% of take-outs confirmed")
    ax.set_title("iFVG location sensitivity")
    ax.grid(axis="y", alpha=.3)

    ax = axes[2]
    x = np.arange(3);
    q = e[~e.primary]
    vals = [100 * p.ifvg_confirmed.mean(), 100 * q.ifvg_confirmed.mean(),
            100 * e.ifvg_confirmed.mean()]
    b = ax.bar(x, vals, .5, color=["#2e8b57", "#e08b3a", "#3f7fbf"])
    ax.bar_label(b, fmt="%.1f%%", fontsize=10)
    ax.set_xticks(x)
    ax.set_xticklabels([f"primary\n(n={len(p):,})", f"short window\n(n={len(q):,})",
                        f"full sample\n(n={len(e):,})"])
    ax.set_ylabel("% confirmed")
    ax.set_title("Primary vs appendix sample")
    ax.grid(axis="y", alpha=.3)
    fig.suptitle("Chart 08 — the three pinned choices that move the numbers most, "
                 "each shown against its alternative", fontsize=13)
    _save(fig, "08_sensitivities.png")


def ch09(p):
    """Per-asset comparability: ATR vs raw %."""
    fig, axes = plt.subplots(1, 2, figsize=(14.5, 5.2), sharex=True)
    x = np.arange(len(C.SYMBOLS)); w = .38
    for ax, col, nm in ((axes[0], "rev_atr", "ATR(14) units — comparable"),
                        (axes[1], "rev_pct", "raw % — NOT comparable")):
        hi = [p.loc[(p.symbol == s) & (p.direction == "high_sweep"), col].median()
              for s in C.SYMBOLS]
        lo = [p.loc[(p.symbol == s) & (p.direction == "low_sweep"), col].median()
              for s in C.SYMBOLS]
        b1 = ax.bar(x - w / 2, hi, w, color="#c0392b", label="high sweeps")
        b2 = ax.bar(x + w / 2, lo, w, color="#2e8b57", label="low sweeps")
        ax.bar_label(b1, fmt="%.2f", fontsize=8); ax.bar_label(b2, fmt="%.2f", fontsize=8)
        ax.set_xticks(x); ax.set_xticklabels(C.SYMBOLS)
        ax.set_title(nm); ax.legend(fontsize=8.5); ax.grid(axis="y", alpha=.3)
    axes[0].set_ylabel("median in-block reverse move")
    fig.suptitle("Chart 09 — why ATR is the primary unit: in % SOL looks ~2x BTC, "
                 "in ATR the four assets are within a few percent of each other",
                 fontsize=13)
    _save(fig, "09_units.png")


def main():
    e = T.load_events()
    u = T.load_uncond()
    p = e[e.primary]
    up = u[u.bars_remaining >= C.MIN_BARS_REMAINING]
    ch01(e); ch02(p); ch03(p); ch04(p); ch05(p, up)
    ch06(p); ch07(p); ch08(p, e); ch09(p)


if __name__ == "__main__":
    main()
